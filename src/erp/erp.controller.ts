import { Controller, Get, Post, Query, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ErpHealthIndicator } from './erp.health';
import { ErpCacheWarmerService } from './services/erp-cache-warmer.service';
import { ErpDataService } from './services/erp-data.service';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';

/**
 * ERP Controller
 * 
 * Provides endpoints for ERP database health checks, cache management,
 * and administrative functions.
 */
@ApiTags('📊 Reports')
@Controller('erp')
@UseGuards(AuthGuard, RoleGuard)
@ApiBearerAuth()
export class ErpController {
	private readonly logger = new Logger(ErpController.name);
	
	// ✅ Request throttling state (with priority support)
	private activeRequests = 0;
	private readonly MAX_CONCURRENT_REQUESTS = 10; // Max 10 concurrent ERP requests
	private requestQueue: Array<{ resolve: () => void; timestamp: number; priority: 'high' | 'normal' | 'low' }> = [];
	private readonly REQUEST_TIMEOUT = 60000; // 60 second max wait in queue
	
	// ✅ Endpoint priority mapping
	private readonly ENDPOINT_PRIORITIES: Record<string, 'high' | 'normal' | 'low'> = {
		'health': 'high',
		'connection/health': 'high',
		'stats': 'normal',
		'cache/stats': 'normal',
		'connection/pool': 'normal',
		'cache/health': 'normal',
		'cache/warm': 'low',
		'cache/refresh': 'low',
		'cache/clear': 'low',
	};

	constructor(
		private readonly erpHealthIndicator: ErpHealthIndicator,
		private readonly erpCacheWarmerService: ErpCacheWarmerService,
		private readonly erpDataService: ErpDataService,
	) {}

	/**
	 * ✅ Request throttling: Acquire slot for request (with priority)
	 */
	private async acquireRequestSlot(operationId: string, priority: 'high' | 'normal' | 'low' = 'normal'): Promise<void> {
		const startWait = Date.now();
		
		// High priority requests bypass queue if slots available
		if (priority === 'high' && this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
			this.activeRequests++;
			this.logger.log(
				`[${operationId}] High priority request slot acquired immediately (${this.activeRequests}/${this.MAX_CONCURRENT_REQUESTS} active)`,
			);
			return;
		}
		
		// Add to queue with priority
		const queueEntry = { resolve: () => {}, timestamp: Date.now(), priority };
		const queuePromise = new Promise<void>((resolve) => {
			queueEntry.resolve = resolve;
		});
		
		// Insert based on priority (high first, then normal, then low)
		let insertIndex = this.requestQueue.length;
		for (let i = 0; i < this.requestQueue.length; i++) {
			const currentPriority = this.requestQueue[i].priority;
			if (
				(priority === 'high' && currentPriority !== 'high') ||
				(priority === 'normal' && currentPriority === 'low')
			) {
				insertIndex = i;
				break;
			}
		}
		this.requestQueue.splice(insertIndex, 0, queueEntry);
		
		// Wait for slot
		while (this.activeRequests >= this.MAX_CONCURRENT_REQUESTS) {
			const waitTime = Date.now() - startWait;
			
			if (waitTime > this.REQUEST_TIMEOUT) {
				// Remove from queue
				const index = this.requestQueue.indexOf(queueEntry);
				if (index > -1) this.requestQueue.splice(index, 1);
				throw new Error(`Request timeout: waited ${waitTime}ms for available slot`);
			}
			
			this.logger.debug(
				`[${operationId}] Request queue: ${this.activeRequests}/${this.MAX_CONCURRENT_REQUESTS} active, ${this.requestQueue.length} queued (priority: ${priority}), waiting...`,
			);
			
			await new Promise((resolve) => setTimeout(resolve, 200)); // Wait 200ms
		}
		
		// Remove from queue and acquire slot
		const index = this.requestQueue.indexOf(queueEntry);
		if (index > -1) this.requestQueue.splice(index, 1);
		
		this.activeRequests++;
		this.logger.log(
			`[${operationId}] Request slot acquired (${this.activeRequests}/${this.MAX_CONCURRENT_REQUESTS} active, priority: ${priority})`,
		);
	}

	/**
	 * ✅ Request throttling: Release slot after request
	 */
	private releaseRequestSlot(operationId: string): void {
		this.activeRequests--;
		this.logger.log(
			`[${operationId}] Request slot released (${this.activeRequests}/${this.MAX_CONCURRENT_REQUESTS} active)`,
		);
	}

	/**
	 * ✅ Wrap endpoint execution with request throttling (with priority and graceful degradation)
	 */
	private async executeWithThrottling<T>(
		operationId: string,
		operation: () => Promise<T>,
		endpointName?: string,
	): Promise<T> {
		const priority = endpointName ? (this.ENDPOINT_PRIORITIES[endpointName] || 'normal') : 'normal';
		
		try {
			await this.acquireRequestSlot(operationId, priority);
			return await operation();
		} catch (error) {
			// Graceful degradation: Return partial response for cache operations
			if (endpointName?.startsWith('cache/') && error.message?.includes('timeout')) {
				this.logger.warn(`[${operationId}] Cache operation timeout, returning partial response`);
				return {
					success: false,
					message: 'Operation timed out, some cache entries may be incomplete',
					error: error.message,
				} as T;
			}
			throw error;
		} finally {
			this.releaseRequestSlot(operationId);
		}
	}

	/**
	 * Get ERP health status
	 */
	@Get('health')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Check ERP database health' })
	@ApiResponse({ status: 200, description: 'ERP health status' })
	async getHealth() {
		return this.executeWithThrottling('health', async () => {
			try {
				const health = await this.erpHealthIndicator.isHealthy();
				return {
					success: health.status === 'up',
					erp: health,
				};
			} catch (error) {
				this.logger.error(`Health check error: ${error.message}`);
				return {
					success: false,
					error: error.message,
				};
			}
		}, 'health');
	}

	/**
	 * Get detailed ERP statistics
	 */
	@Get('stats')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Get detailed ERP statistics' })
	@ApiResponse({ status: 200, description: 'ERP statistics' })
	async getStats() {
		return this.executeWithThrottling('stats', async () => {
			try {
				const stats = await this.erpHealthIndicator.getErpStats();
				return {
					success: true,
					data: stats,
				};
			} catch (error) {
				this.logger.error(`Stats error: ${error.message}`);
				return {
					success: false,
					error: error.message,
				};
			}
		}, 'stats');
	}

	/**
	 * Trigger cache warming
	 */
	@Post('cache/warm')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Manually trigger cache warming' })
	@ApiResponse({ status: 200, description: 'Cache warming triggered' })
	async warmCache() {
		return this.executeWithThrottling('cache-warm', async () => {
			try {
				const result = await this.erpCacheWarmerService.triggerCacheWarming();
				return result;
			} catch (error) {
				this.logger.error(`Cache warming error: ${error.message}`);
				return {
					success: false,
					message: error.message,
				};
			}
		}, 'cache/warm');
	}

	/**
	 * Clear and refresh cache
	 */
	@Post('cache/refresh')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Clear and refresh ERP cache' })
	@ApiResponse({ status: 200, description: 'Cache refreshed' })
	async refreshCache() {
		return this.executeWithThrottling('cache-refresh', async () => {
			try {
				const result = await this.erpCacheWarmerService.refreshCache();
				return result;
			} catch (error) {
				this.logger.error(`Cache refresh error: ${error.message}`);
				return {
					success: false,
					message: error.message,
				};
			}
		}, 'cache/refresh');
	}

	/**
	 * Clear cache for specific date range
	 */
	@Post('cache/clear')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Clear cache for specific date range' })
	@ApiQuery({ name: 'startDate', required: false, example: '2024-01-01' })
	@ApiQuery({ name: 'endDate', required: false, example: '2024-01-31' })
	@ApiResponse({ status: 200, description: 'Cache cleared' })
	async clearCache(
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	) {
		return this.executeWithThrottling('cache-clear', async () => {
			try {
				await this.erpDataService.clearCache(startDate, endDate);
				return {
					success: true,
					message: startDate && endDate
						? `Cache cleared for ${startDate} to ${endDate}`
						: 'All cache cleared',
				};
			} catch (error) {
				this.logger.error(`Cache clear error: ${error.message}`);
				return {
					success: false,
					message: error.message,
				};
			}
		}, 'cache/clear');
	}

	/**
	 * Get cache statistics
	 */
	@Get('cache/stats')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Get cache statistics' })
	@ApiResponse({ status: 200, description: 'Cache statistics' })
	async getCacheStats() {
		return this.executeWithThrottling('cache-stats', async () => {
			try {
				const stats = await this.erpDataService.getCacheStats();
				return {
					success: true,
					data: stats,
				};
			} catch (error) {
				this.logger.error(`Cache stats error: ${error.message}`);
				return {
					success: false,
					error: error.message,
				};
			}
		}, 'cache/stats');
	}

	/**
	 * Get connection pool information for monitoring
	 */
	@Get('connection/pool')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Get ERP database connection pool information' })
	@ApiResponse({ status: 200, description: 'Connection pool statistics' })
	async getConnectionPoolInfo() {
		return this.executeWithThrottling('connection-pool', async () => {
			try {
				const poolInfo = this.erpDataService.getConnectionPoolInfo();
				return {
					success: true,
					data: poolInfo,
					timestamp: new Date().toISOString(),
				};
			} catch (error) {
				this.logger.error(`Connection pool info error: ${error.message}`);
				return {
					success: false,
					error: error.message,
				};
			}
		}, 'connection/pool');
	}

	/**
	 * Get connection health check
	 */
	@Get('connection/health')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Check ERP database connection health' })
	@ApiResponse({ status: 200, description: 'Connection health status' })
	async getConnectionHealth() {
		return this.executeWithThrottling('connection-health', async () => {
			try {
				const health = await this.erpDataService.checkConnectionHealth();
				return {
					success: true,
					data: health,
					timestamp: new Date().toISOString(),
				};
			} catch (error) {
				this.logger.error(`Connection health check error: ${error.message}`);
				return {
					success: false,
					error: error.message,
				};
			}
		}, 'connection/health');
	}

	/**
	 * ✅ PHASE 3: Get cache health check for a specific date range
	 */
	@Get('cache/health')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Check cache health for a date range' })
	@ApiQuery({ name: 'startDate', required: true, example: '2024-01-01' })
	@ApiQuery({ name: 'endDate', required: true, example: '2024-01-31' })
	@ApiQuery({ name: 'storeCode', required: false })
	@ApiQuery({ name: 'category', required: false })
	@ApiResponse({ status: 200, description: 'Cache health status' })
	async getCacheHealth(
		@Query('startDate') startDate: string,
		@Query('endDate') endDate: string,
		@Query('storeCode') storeCode?: string,
		@Query('category') category?: string,
	) {
		return this.executeWithThrottling('cache-health', async () => {
			try {
				const filters = {
					startDate,
					endDate,
					storeCode,
					category,
				};
				
				const health = await this.erpDataService.verifyCacheHealth(filters);
				
				// Calculate completeness percentage
				const totalChecks = Object.keys(health).length;
				const cachedCount = Object.values(health).filter(Boolean).length;
				const completeness = (cachedCount / totalChecks) * 100;
				
				return {
					success: true,
					data: {
						...health,
						completeness: `${completeness.toFixed(1)}%`,
						cachedCount,
						totalChecks,
					},
					timestamp: new Date().toISOString(),
				};
			} catch (error) {
				this.logger.error(`Cache health check error: ${error.message}`);
				return {
					success: false,
					error: error.message,
				};
			}
		}, 'cache/health');
	}
}

