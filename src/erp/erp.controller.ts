import { Controller, Get, Post, Query, Logger, UseGuards, Req, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { ErpHealthIndicator } from './erp.health';
import { ErpCacheWarmerService } from './services/erp-cache-warmer.service';
import { ErpDataService } from './services/erp-data.service';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { UserService } from '../user/user.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

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
		'profile/sales': 'high',
		'team/targets': 'high', // Bulk endpoint for team management - high priority
	};

	constructor(
		private readonly erpHealthIndicator: ErpHealthIndicator,
		private readonly erpCacheWarmerService: ErpCacheWarmerService,
		private readonly erpDataService: ErpDataService,
		private readonly userService: UserService,
	) {}

	/**
	 * Get organization ID from authenticated request
	 */
	private getOrgId(request: AuthenticatedRequest): number | undefined {
		return request.user?.org?.uid || request.user?.organisationRef;
	}

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
	async getHealth(@Req() request: AuthenticatedRequest) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Getting ERP health for org ${orgId}`);
		
		return this.executeWithThrottling('health', async () => {
			try {
				const health = await this.erpHealthIndicator.isHealthy();
				return {
					success: health.status === 'up',
					erp: health,
					orgId,
				};
			} catch (error) {
				this.logger.error(`Health check error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					orgId,
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
	async getStats(@Req() request: AuthenticatedRequest) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Getting ERP stats for org ${orgId}`);
		
		return this.executeWithThrottling('stats', async () => {
			try {
				const stats = await this.erpHealthIndicator.getErpStats();
				return {
					success: true,
					data: stats,
					orgId,
				};
			} catch (error) {
				this.logger.error(`Stats error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					orgId,
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
	async warmCache(@Req() request: AuthenticatedRequest) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Triggering cache warming for org ${orgId}`);
		
		return this.executeWithThrottling('cache-warm', async () => {
			try {
				const result = await this.erpCacheWarmerService.triggerCacheWarming();
				return {
					...result,
					orgId,
				};
			} catch (error) {
				this.logger.error(`Cache warming error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					message: error.message,
					orgId,
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
	async refreshCache(@Req() request: AuthenticatedRequest) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Refreshing cache for org ${orgId}`);
		
		return this.executeWithThrottling('cache-refresh', async () => {
			try {
				const result = await this.erpCacheWarmerService.refreshCache();
				return {
					...result,
					orgId,
				};
			} catch (error) {
				this.logger.error(`Cache refresh error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					message: error.message,
					orgId,
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
		@Req() request: AuthenticatedRequest,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Clearing cache for org ${orgId}${startDate && endDate ? ` (${startDate} to ${endDate})` : ''}`);
		
		return this.executeWithThrottling('cache-clear', async () => {
			try {
				await this.erpDataService.clearCache(startDate, endDate);
				return {
					success: true,
					message: startDate && endDate
						? `Cache cleared for ${startDate} to ${endDate}`
						: 'All cache cleared',
					orgId,
				};
			} catch (error) {
				this.logger.error(`Cache clear error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					message: error.message,
					orgId,
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
	async getCacheStats(@Req() request: AuthenticatedRequest) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Getting cache stats for org ${orgId}`);
		
		return this.executeWithThrottling('cache-stats', async () => {
			try {
				const stats = await this.erpDataService.getCacheStats();
				return {
					success: true,
					data: stats,
					orgId,
				};
			} catch (error) {
				this.logger.error(`Cache stats error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					orgId,
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
	async getConnectionPoolInfo(@Req() request: AuthenticatedRequest) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Getting connection pool info for org ${orgId}`);
		
		return this.executeWithThrottling('connection-pool', async () => {
			try {
				const poolInfo = this.erpDataService.getConnectionPoolInfo();
				return {
					success: true,
					data: poolInfo,
					timestamp: new Date().toISOString(),
					orgId,
				};
			} catch (error) {
				this.logger.error(`Connection pool info error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					orgId,
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
	async getConnectionHealth(@Req() request: AuthenticatedRequest) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Getting connection health for org ${orgId}`);
		
		return this.executeWithThrottling('connection-health', async () => {
			try {
				const health = await this.erpDataService.checkConnectionHealth();
				return {
					success: true,
					data: health,
					timestamp: new Date().toISOString(),
					orgId,
				};
			} catch (error) {
				this.logger.error(`Connection health check error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					orgId,
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
		@Req() request: AuthenticatedRequest,
		@Query('startDate') startDate: string,
		@Query('endDate') endDate: string,
		@Query('storeCode') storeCode?: string,
		@Query('category') category?: string,
	) {
		const orgId = this.getOrgId(request);
		this.logger.log(`Getting cache health for org ${orgId} (${startDate} to ${endDate})`);
		
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
					orgId,
				};
			} catch (error) {
				this.logger.error(`Cache health check error for org ${orgId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					orgId,
				};
			}
		}, 'cache/health');
	}

	/**
	 * Get profile sales data for logged-in user
	 * 
	 * ✅ CRITICAL: Always returns sales data for CURRENT MONTH (not target period)
	 * Filters ERP sales data by user's ERP sales rep code
	 * Returns totalRevenue, transactionCount, uniqueCustomers for current month only
	 */
	@Get('profile/sales')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get user-specific sales data from ERP for current month' })
	@ApiResponse({ status: 200, description: 'User sales data for current month' })
	@ApiResponse({ status: 404, description: 'User target or ERP code not found' })
	async getProfileSales(@Req() request: AuthenticatedRequest) {
		const userId = request.user?.uid;
		const orgId = this.getOrgId(request);
		const operationId = 'profile-sales';
		
		this.logger.log(`[${operationId}] Getting profile sales for user ${userId}, org ${orgId}`);
		
		return this.executeWithThrottling(operationId, async () => {
			try {
				if (!userId) {
					throw new BadRequestException('User ID not found in request');
				}

				// Get user's target to extract ERP code and date range
				const userTargetResult = await this.userService.getUserTarget(userId, orgId);
				
				if (!userTargetResult?.userTarget) {
					throw new NotFoundException(`No targets found for user ${userId}`);
				}

				// ✅ Check if user is active - skip inactive users
				const userResult = await this.userService.findOne(userId, orgId);
				if (!userResult?.user || userResult.user.status !== 'active') {
					this.logger.warn(`[${operationId}] ⚠️  User ${userId} is inactive (status: ${userResult?.user?.status || 'not found'}), skipping target processing`);
					return {
						success: false,
						message: `User is inactive (status: ${userResult?.user?.status || 'not found'}). Target processing skipped.`,
						data: null,
						userId,
						orgId,
					};
				}

				const userTarget = userTargetResult.userTarget;
				// Try to get erpSalesRepCode from multiple possible locations:
				// 1. Top level of response object
				// 2. From personalTargets object
				const erpSalesRepCode = userTarget.erpSalesRepCode || 
					(userTarget.personalTargets as any)?.erpSalesRepCode || 
					null;

				this.logger.log(`[${operationId}] 🔍 ERP Sales Rep Code lookup for user ${userId}:`);
				this.logger.debug(`[${operationId}]    Checking userTarget.erpSalesRepCode: ${userTarget.erpSalesRepCode || '❌ not found'}`);
				this.logger.debug(`[${operationId}]    Checking personalTargets.erpSalesRepCode: ${(userTarget.personalTargets as any)?.erpSalesRepCode || '❌ not found'}`);
				
				if (erpSalesRepCode) {
					this.logger.log(`[${operationId}] ✅ Found ERP Sales Rep Code: "${erpSalesRepCode}"`);
				} else {
					this.logger.warn(`[${operationId}] ⚠️  No ERP Sales Rep Code found for user ${userId}`);
					this.logger.warn(`[${operationId}]    💡 Action required: Set erpSalesRepCode in user_targets table for user ${userId}`);
					return {
						success: false,
						message: 'ERP sales rep code not configured for this user',
						data: null,
						userId,
						orgId,
					};
				}

				// ✅ Use period dates from user_targets entity (single source of truth)
				// Get dates from personalTargets (which comes from user_targets.periodStartDate and periodEndDate)
				const personalTargets = userTarget.personalTargets as any;
				const periodStartDateRaw = personalTargets?.periodStartDate;
				const periodEndDateRaw = personalTargets?.periodEndDate;

				if (!periodStartDateRaw || !periodEndDateRaw) {
					this.logger.warn(`[${operationId}] ⚠️  No period dates found in user target for user ${userId}`);
					this.logger.warn(`[${operationId}]    💡 Target period dates (periodStartDate/periodEndDate) must be set in user_targets table`);
					return {
						success: false,
						message: 'Target period dates not configured. Please set periodStartDate and periodEndDate in user targets.',
						data: null,
						userId,
						orgId,
					};
				}

				// Format dates to YYYY-MM-DD format
				const periodStartDate = new Date(periodStartDateRaw).toISOString().split('T')[0];
				const periodEndDate = new Date(periodEndDateRaw).toISOString().split('T')[0];
				
				this.logger.log(`[${operationId}] 📅 Using Target Period Dates from user_targets:`);
				this.logger.log(`[${operationId}]    📅 Period Start: ${periodStartDate} (from user_targets.periodStartDate)`);
				this.logger.log(`[${operationId}]    📅 Period End: ${periodEndDate} (from user_targets.periodEndDate)`);
				this.logger.log(`[${operationId}] 🔍 Fetching sales from tblsaleslines WHERE rep_code = "${erpSalesRepCode}" AND sale_date BETWEEN '${periodStartDate}' AND '${periodEndDate}' AND doc_type IN (1,2) AND type = 'I'`);

				// ✅ CRITICAL: Call getSalesPersonAggregations with salesPersonId filter
				// This queries tblsaleslines WHERE rep_code = erpSalesRepCode AND type = 'I' AND doc_type IN (1,2)
				// JOINs with tblsalesman to get rep names
				// Returns ONLY sales lines made by this specific sales person (like CEB01)
				// Same method used in performance dashboard "Sales Per Salesperson" chart
				const salesData = await this.erpDataService.getSalesPersonAggregations({
					startDate: periodStartDate,
					endDate: periodEndDate,
					salesPersonId: erpSalesRepCode, // ✅ Filters: header.sales_code IN (erpSalesRepCode)
				});

				this.logger.log(`[${operationId}] 📦 Query Result: ${salesData.length} sales record(s) found for code "${erpSalesRepCode}"`);

				// ✅ When salesPersonId filter is applied, query filters header.sales_code IN (erpSalesRepCode)
				// This means salesData should contain ONLY this user's sales (or be empty)
				// Find exact match to ensure we have the right data
				const userSalesData = salesData.find(agg => 
					agg.salesCode?.toUpperCase() === erpSalesRepCode.toUpperCase()
				);

				if (!userSalesData || salesData.length === 0) {
					this.logger.warn(`[${operationId}] ⚠️  No sales found for ERP code "${erpSalesRepCode}" in period ${periodStartDate} → ${periodEndDate}`);
					this.logger.log(`[${operationId}]    💡 No records found in tblsaleslines WHERE rep_code = "${erpSalesRepCode}" AND doc_type IN (1,2) AND type = 'I'`);
					this.logger.log(`[${operationId}]    📊 Returning zero values:`);
					this.logger.log(`[${operationId}]       💰 Revenue: R0 | 📝 Transactions: 0 | 👥 Customers: 0`);
					
					return {
						success: true,
						message: 'No sales data found for this period',
						data: {
							totalRevenue: 0,
							transactionCount: 0,
							uniqueCustomers: 0,
							salesCode: erpSalesRepCode,
							salesName: erpSalesRepCode, // Will be populated if sales exist via getSalesPersonNames
						},
						periodStartDate,
						periodEndDate,
						userId,
						orgId,
					};
				}

				// ✅ Return ONLY this user's sales data
				// salesName is already populated by getSalesPersonAggregations → getSalesPersonNames → tblsalesman.Description
				this.logger.log(`[${operationId}] ✅ Sales Data Retrieved Successfully:`);
				this.logger.log(`[${operationId}]    👤 Sales Person: ${userSalesData.salesName || userSalesData.salesCode} (${userSalesData.salesCode})`);
				this.logger.log(`[${operationId}]    💰 Total Revenue: R${(userSalesData.totalRevenue || 0).toLocaleString('en-ZA')}`);
				this.logger.log(`[${operationId}]    📝 Transactions: ${userSalesData.transactionCount || 0}`);
				this.logger.log(`[${operationId}]    👥 Unique Customers: ${userSalesData.uniqueCustomers || 0}`);
				this.logger.log(`[${operationId}]    📅 Period: ${periodStartDate} → ${periodEndDate}`);

				// ✅ Return ONLY this user's sales data (already filtered by salesPersonId in getSalesPersonAggregations)
				// The salesName is already populated by getSalesPersonAggregations using getSalesPersonNames
				return {
					success: true,
					data: {
						totalRevenue: userSalesData.totalRevenue || 0,
						transactionCount: userSalesData.transactionCount || 0,
						uniqueCustomers: userSalesData.uniqueCustomers || 0,
						salesCode: userSalesData.salesCode,
						salesName: userSalesData.salesName || userSalesData.salesCode, // ✅ Name from tblsalesman table
					},
					periodStartDate,
					periodEndDate,
					userId,
					orgId,
				};
			} catch (error) {
				this.logger.error(`[${operationId}] Error getting profile sales for user ${userId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					userId,
					orgId,
				};
			}
		}, 'profile/sales');
	}

	/**
	 * Get profile sales data for a specific user (for team members)
	 * 
	 * ✅ CRITICAL: Always returns sales data for CURRENT MONTH (not target period)
	 * Filters ERP sales data by user's ERP sales rep code
	 * Returns totalRevenue, transactionCount, uniqueCustomers for current month only
	 * 
	 * @param userId - User ID to fetch sales for (must be a team member the current user manages)
	 */
	@Get('user/:userId/sales')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get sales data for a specific user (for team members)' })
	@ApiParam({ name: 'userId', type: Number, description: 'User ID to fetch sales for' })
	@ApiResponse({ status: 200, description: 'User sales data for current month' })
	@ApiResponse({ status: 404, description: 'User target or ERP code not found' })
	async getUserSales(
		@Req() request: AuthenticatedRequest,
		@Param('userId', ParseIntPipe) targetUserId: number,
	) {
		const currentUserId = request.user?.uid;
		const orgId = this.getOrgId(request);
		const operationId = 'user-sales';
		
		this.logger.log(`[${operationId}] Getting sales for user ${targetUserId} (requested by ${currentUserId}), org ${orgId}`);
		
		return this.executeWithThrottling(operationId, async () => {
			try {
				if (!targetUserId) {
					throw new BadRequestException('User ID parameter is required');
				}

				// ✅ Check if target user is active - skip inactive users
				const targetUserResult = await this.userService.findOne(targetUserId, orgId);
				if (!targetUserResult?.user || targetUserResult.user.status !== 'active') {
					this.logger.warn(`[${operationId}] ⚠️  Target user ${targetUserId} is inactive (status: ${targetUserResult?.user?.status || 'not found'}), skipping target processing`);
					return {
						success: false,
						message: `Target user is inactive (status: ${targetUserResult?.user?.status || 'not found'}). Target processing skipped.`,
						data: null,
						userId: targetUserId,
						orgId,
					};
				}

				// Verify that the current user has access to view this user's sales
				// Check if targetUserId is in the current user's managed staff
				const currentUserTargetResult = await this.userService.getUserTarget(currentUserId, orgId);
				const currentUserTarget = currentUserTargetResult?.userTarget;
				const managedStaff = currentUserTarget?.managedStaff || [];
				
				const isManagedStaff = managedStaff.some((staff: any) => staff.uid === targetUserId);
				const isSelf = currentUserId === targetUserId;
				const isElevated = request.user?.accessLevel === AccessLevel.ADMIN || 
					request.user?.accessLevel === AccessLevel.OWNER || 
					request.user?.accessLevel === AccessLevel.MANAGER;

				if (!isSelf && !isManagedStaff && !isElevated) {
					throw new NotFoundException(`You do not have permission to view sales for user ${targetUserId}`);
				}

				// Get target user's target to extract ERP code and date range
				const userTargetResult = await this.userService.getUserTarget(targetUserId, orgId);
				
				if (!userTargetResult?.userTarget) {
					throw new NotFoundException(`No targets found for user ${targetUserId}`);
				}

				const userTarget = userTargetResult.userTarget;
				// Try to get erpSalesRepCode from multiple possible locations:
				const erpSalesRepCode = userTarget.erpSalesRepCode || 
					(userTarget.personalTargets as any)?.erpSalesRepCode || 
					null;

				this.logger.log(`[${operationId}] 🔍 ERP Sales Rep Code lookup for user ${targetUserId}:`);
				this.logger.debug(`[${operationId}]    Checking userTarget.erpSalesRepCode: ${userTarget.erpSalesRepCode || '❌ not found'}`);
				this.logger.debug(`[${operationId}]    Checking personalTargets.erpSalesRepCode: ${(userTarget.personalTargets as any)?.erpSalesRepCode || '❌ not found'}`);
				
				if (erpSalesRepCode) {
					this.logger.log(`[${operationId}] ✅ Found ERP Sales Rep Code: "${erpSalesRepCode}"`);
				} else {
					this.logger.warn(`[${operationId}] ⚠️  No ERP Sales Rep Code found for user ${targetUserId}`);
					this.logger.warn(`[${operationId}]    💡 Action required: Set erpSalesRepCode in user_targets table for user ${targetUserId}`);
					return {
						success: false,
						message: 'ERP sales rep code not configured for this user',
						data: null,
						userId: targetUserId,
						orgId,
					};
				}

				// ✅ Use period dates from user_targets entity (single source of truth)
				const personalTargets = userTarget.personalTargets as any;
				const periodStartDateRaw = personalTargets?.periodStartDate;
				const periodEndDateRaw = personalTargets?.periodEndDate;

				if (!periodStartDateRaw || !periodEndDateRaw) {
					this.logger.warn(`[${operationId}] ⚠️  No period dates found in user target for user ${targetUserId}`);
					this.logger.warn(`[${operationId}]    💡 Target period dates (periodStartDate/periodEndDate) must be set in user_targets table`);
					return {
						success: false,
						message: 'Target period dates not configured. Please set periodStartDate and periodEndDate in user targets.',
						data: null,
						userId: targetUserId,
						orgId,
					};
				}

				// Format dates to YYYY-MM-DD format
				const periodStartDate = new Date(periodStartDateRaw).toISOString().split('T')[0];
				const periodEndDate = new Date(periodEndDateRaw).toISOString().split('T')[0];
				
				this.logger.log(`[${operationId}] 📅 Using Target Period Dates from user_targets:`);
				this.logger.log(`[${operationId}]    📅 Period Start: ${periodStartDate} (from user_targets.periodStartDate)`);
				this.logger.log(`[${operationId}]    📅 Period End: ${periodEndDate} (from user_targets.periodEndDate)`);
				this.logger.log(`[${operationId}] 🔍 Fetching sales from tblsaleslines WHERE rep_code = "${erpSalesRepCode}" AND sale_date BETWEEN '${periodStartDate}' AND '${periodEndDate}' AND doc_type IN (1,2) AND type = 'I'`);

				// ✅ Call getSalesPersonAggregations with salesPersonId filter
				// Queries tblsaleslines JOIN tblsalesman WHERE rep_code = erpSalesRepCode AND type = 'I' AND doc_type IN (1,2)
				const salesData = await this.erpDataService.getSalesPersonAggregations({
					startDate: periodStartDate,
					endDate: periodEndDate,
					salesPersonId: erpSalesRepCode,
				});

				this.logger.log(`[${operationId}] 📦 Query Result: ${salesData.length} sales record(s) found for code "${erpSalesRepCode}"`);

				// Find exact match to ensure we have the right data
				const userSalesData = salesData.find(agg => 
					agg.salesCode?.toUpperCase() === erpSalesRepCode.toUpperCase()
				);

				if (!userSalesData || salesData.length === 0) {
					this.logger.warn(`[${operationId}] ⚠️  No sales found for ERP code "${erpSalesRepCode}" in period ${periodStartDate} → ${periodEndDate}`);
					this.logger.log(`[${operationId}]    💡 No records found in tblsaleslines WHERE rep_code = "${erpSalesRepCode}" AND doc_type IN (1,2) AND type = 'I'`);
					this.logger.log(`[${operationId}]    📊 Returning zero values:`);
					this.logger.log(`[${operationId}]       💰 Revenue: R0 | 📝 Transactions: 0 | 👥 Customers: 0`);
					
					return {
						success: true,
						message: 'No sales data found for this period',
						data: {
							totalRevenue: 0,
							transactionCount: 0,
							uniqueCustomers: 0,
							salesCode: erpSalesRepCode,
							salesName: erpSalesRepCode,
						},
						periodStartDate,
						periodEndDate,
						userId: targetUserId,
						orgId,
					};
				}

				// ✅ Return this user's sales data
				this.logger.log(`[${operationId}] ✅ Sales Data Retrieved Successfully:`);
				this.logger.log(`[${operationId}]    👤 Sales Person: ${userSalesData.salesName || userSalesData.salesCode} (${userSalesData.salesCode})`);
				this.logger.log(`[${operationId}]    💰 Total Revenue: R${(userSalesData.totalRevenue || 0).toLocaleString('en-ZA')}`);
				this.logger.log(`[${operationId}]    📝 Transactions: ${userSalesData.transactionCount || 0}`);
				this.logger.log(`[${operationId}]    👥 Unique Customers: ${userSalesData.uniqueCustomers || 0}`);
				this.logger.log(`[${operationId}]    📅 Period: ${periodStartDate} → ${periodEndDate}`);

				return {
					success: true,
					data: {
						totalRevenue: userSalesData.totalRevenue || 0,
						transactionCount: userSalesData.transactionCount || 0,
						uniqueCustomers: userSalesData.uniqueCustomers || 0,
						salesCode: userSalesData.salesCode,
						salesName: userSalesData.salesName || userSalesData.salesCode,
					},
					periodStartDate,
					periodEndDate,
					userId: targetUserId,
					orgId,
				};
			} catch (error) {
				this.logger.error(`[${operationId}] Error getting sales for user ${targetUserId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					userId: targetUserId,
					orgId,
				};
			}
		}, 'user-sales');
	}

	/**
	 * Get commission breakdown by category for a specific user (for team members)
	 * Groups commission data by commission percentage instead of category
	 */
	@Get('user/:userId/commissions-by-category')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get commission breakdown by category for a specific user (for team members)' })
	@ApiParam({ name: 'userId', type: Number, description: 'User ID to fetch commission breakdown for' })
	@ApiResponse({ status: 200, description: 'Commission breakdown by category data' })
	@ApiResponse({ status: 404, description: 'User target or ERP code not found' })
	async getUserCommissionsByCategory(
		@Req() request: AuthenticatedRequest,
		@Param('userId', ParseIntPipe) targetUserId: number,
	) {
		const currentUserId = request.user?.uid;
		const orgId = this.getOrgId(request);
		const operationId = 'user-commissions-by-category';
		
		this.logger.log(`[${operationId}] Getting commission breakdown by category for user ${targetUserId} (requested by ${currentUserId}), org ${orgId}`);
		
		return this.executeWithThrottling(operationId, async () => {
			try {
				if (!targetUserId) {
					throw new BadRequestException('User ID parameter is required');
				}

				// Verify that the current user has access to view this user's commission data
				const currentUserTargetResult = await this.userService.getUserTarget(currentUserId, orgId);
				const currentUserTarget = currentUserTargetResult?.userTarget;
				const managedStaff = currentUserTarget?.managedStaff || [];
				
				const isManagedStaff = managedStaff.some((staff: any) => staff.uid === targetUserId);
				const isSelf = currentUserId === targetUserId;
				const isElevated = request.user?.accessLevel === AccessLevel.ADMIN || 
					request.user?.accessLevel === AccessLevel.OWNER || 
					request.user?.accessLevel === AccessLevel.MANAGER;

				if (!isSelf && !isManagedStaff && !isElevated) {
					throw new NotFoundException(`You do not have permission to view commission data for user ${targetUserId}`);
				}

				// Get target user's target to extract ERP code and date range
				const userTargetResult = await this.userService.getUserTarget(targetUserId, orgId);
				
				if (!userTargetResult?.userTarget) {
					throw new NotFoundException(`No targets found for user ${targetUserId}`);
				}

				const userTarget = userTargetResult.userTarget;
				const erpSalesRepCode = userTarget.erpSalesRepCode || 
					(userTarget.personalTargets as any)?.erpSalesRepCode || 
					null;

				if (!erpSalesRepCode) {
					this.logger.warn(`[${operationId}] ⚠️  No ERP Sales Rep Code found for user ${targetUserId}`);
					return {
						success: false,
						message: 'ERP sales rep code not configured for this user',
						data: [],
						userId: targetUserId,
						orgId,
					};
				}

				// Get period dates from user_targets
				const personalTargets = userTarget.personalTargets as any;
				const periodStartDateRaw = personalTargets?.periodStartDate;
				const periodEndDateRaw = personalTargets?.periodEndDate;

				if (!periodStartDateRaw || !periodEndDateRaw) {
					this.logger.warn(`[${operationId}] ⚠️  No period dates found in user target for user ${targetUserId}`);
					return {
						success: false,
						message: 'Target period dates not configured',
						data: [],
						userId: targetUserId,
						orgId,
					};
				}

				// Format dates to YYYY-MM-DD format
				const periodStartDate = new Date(periodStartDateRaw).toISOString().split('T')[0];
				const periodEndDate = new Date(periodEndDateRaw).toISOString().split('T')[0];
				
				this.logger.log(`[${operationId}] 📅 Fetching commission breakdown by category for period: ${periodStartDate} → ${periodEndDate}`);
				this.logger.log(`[${operationId}] 🔍 Filtering by rep_code: ${erpSalesRepCode}`);

				// Fetch sales lines filtered by rep_code
				const salesLines = await this.erpDataService.getSalesLinesByDateRange({
					startDate: periodStartDate,
					endDate: periodEndDate,
					salesPersonId: erpSalesRepCode, // Filters by rep_code
				}, ['1', '2']); // Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)

				if (!salesLines || salesLines.length === 0) {
					this.logger.log(`[${operationId}] No sales lines found for rep_code ${erpSalesRepCode}`);
					return {
						success: true,
						data: [],
						periodStartDate,
						periodEndDate,
						userId: targetUserId,
						orgId,
					};
				}

				// Helper function to normalize commission percentage (round to 2 decimals for grouping)
				const normalizeCommissionPercent = (percent: number): number => {
					return Math.round(percent * 100) / 100;
				};

				// Helper function to map commission percentage to group name dynamically
				// Maps known percentages to specific names, others get generic names
				const getCommissionGroupName = (commissionPercent: number): string => {
					const normalized = normalizeCommissionPercent(commissionPercent);
					
					// Map to group names based on specific commission percentages (with tolerance for floating point)
					if (Math.abs(normalized - 0.5) < 0.01) {
						return 'Rhinolite & 6.4mm';
					} else if (Math.abs(normalized - 3.0) < 0.01) {
						return 'Fuse & BitLite';
					} else if (Math.abs(normalized - 1.5) < 0.01) {
						return 'Other Drywall Products';
					}
					
					// For any other commission percentage, use the percentage as the name
					// This makes it dynamic - if percentages change (e.g., 0.4%), they'll still be grouped
					return `${normalized.toFixed(2)}% Commission`;
				};

				// Group by commission percentage (normalized) and calculate commission data
				const commissionMap = new Map<number, {
					commissionPercent: number;
					totalSales: number;
					totalCommission: number;
				}>();

				for (const line of salesLines) {
					// ✅ Use incl_line_total - tax to match sales revenue calculation
					const tax = parseFloat(String(line.tax || 0));
					const inclLineTotal = parseFloat(String(line.incl_line_total || 0));
					const netSales = inclLineTotal - tax; // ✅ Match sales query: SUM(incl_line_total - tax)
					const commissionPer = parseFloat(String(line.commission_per || 0));
					
					if (commissionPer <= 0) {
						continue; // Skip items with no commission
					}
					
					const normalizedPercent = normalizeCommissionPercent(commissionPer);
					
					// Calculate commission amount based on net sales (excl tax)
					const commissionAmount = (netSales * commissionPer) / 100;

					if (commissionMap.has(normalizedPercent)) {
						const existing = commissionMap.get(normalizedPercent)!;
						existing.totalSales += netSales; // ✅ Use net sales (excl tax)
						existing.totalCommission += commissionAmount;
					} else {
						commissionMap.set(normalizedPercent, {
							commissionPercent: normalizedPercent,
							totalSales: netSales, // ✅ Use net sales (excl tax)
							totalCommission: commissionAmount,
						});
					}
				}

				// Convert map to array, map to group names, and sort by total commission (descending)
				const commissionData = Array.from(commissionMap.values())
					.map(item => {
						const groupName = getCommissionGroupName(item.commissionPercent);
						
						return {
							category: groupName,
							commissionPercent: item.commissionPercent,
							totalSales: item.totalSales,
							totalCommission: item.totalCommission,
						};
					})
					.sort((a, b) => b.totalCommission - a.totalCommission);

				this.logger.log(`[${operationId}] ✅ Generated commission breakdown by commission percentage for ${commissionData.length} groups`);

				return {
					success: true,
					data: commissionData,
					periodStartDate,
					periodEndDate,
					userId: targetUserId,
					orgId,
				};
			} catch (error) {
				this.logger.error(`[${operationId}] Error getting commission breakdown by category for user ${targetUserId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					data: [],
					userId: targetUserId,
					orgId,
				};
			}
		}, 'user-commissions-by-category');
	}

	/**
	 * Get commission data per product for logged-in user
	 * 
	 * Returns sales per product with commission calculations:
	 * - Items (item name)
	 * - Units Sold (quantity)
	 * - Commission % (commission_per)
	 * - Total Sales (incl_line_total)
	 * - Total Commission (calculated from commission_per)
	 * 
	 * Uses target period dates from user_targets table
	 */
	@Get('profile/commissions')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get commission data per product for logged-in user' })
	@ApiResponse({ status: 200, description: 'Commission data per product' })
	@ApiResponse({ status: 404, description: 'User target or ERP code not found' })
	async getProfileCommissions(@Req() request: AuthenticatedRequest) {
		const userId = request.user?.uid;
		const orgId = this.getOrgId(request);
		const operationId = 'profile-commissions';
		
		this.logger.log(`[${operationId}] Getting commission data for user ${userId}, org ${orgId}`);
		
		return this.executeWithThrottling(operationId, async () => {
			try {
				if (!userId) {
					throw new BadRequestException('User ID not found in request');
				}

				// Get user's target to extract ERP code and date range
				const userTargetResult = await this.userService.getUserTarget(userId, orgId);
				
				if (!userTargetResult?.userTarget) {
					throw new NotFoundException(`No targets found for user ${userId}`);
				}

				const userTarget = userTargetResult.userTarget;
				const erpSalesRepCode = userTarget.erpSalesRepCode || 
					(userTarget.personalTargets as any)?.erpSalesRepCode || 
					null;

				if (!erpSalesRepCode) {
					this.logger.warn(`[${operationId}] ⚠️  No ERP Sales Rep Code found for user ${userId}`);
					return {
						success: false,
						message: 'ERP sales rep code not configured for this user',
						data: [],
						userId,
						orgId,
					};
				}

				// Get period dates from user_targets
				const personalTargets = userTarget.personalTargets as any;
				const periodStartDateRaw = personalTargets?.periodStartDate;
				const periodEndDateRaw = personalTargets?.periodEndDate;

				if (!periodStartDateRaw || !periodEndDateRaw) {
					this.logger.warn(`[${operationId}] ⚠️  No period dates found in user target for user ${userId}`);
					return {
						success: false,
						message: 'Target period dates not configured',
						data: [],
						userId,
						orgId,
					};
				}

				// Format dates to YYYY-MM-DD format
				const periodStartDate = new Date(periodStartDateRaw).toISOString().split('T')[0];
				const periodEndDate = new Date(periodEndDateRaw).toISOString().split('T')[0];
				
				this.logger.log(`[${operationId}] 📅 Fetching commission data for period: ${periodStartDate} → ${periodEndDate}`);
				this.logger.log(`[${operationId}] 🔍 Filtering by rep_code: ${erpSalesRepCode}`);

				// Fetch sales lines filtered by rep_code
				const salesLines = await this.erpDataService.getSalesLinesByDateRange({
					startDate: periodStartDate,
					endDate: periodEndDate,
					salesPersonId: erpSalesRepCode, // Filters by rep_code
				}, ['1', '2']); // Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)

				if (!salesLines || salesLines.length === 0) {
					this.logger.log(`[${operationId}] No sales lines found for rep_code ${erpSalesRepCode}`);
					return {
						success: true,
						data: [],
						periodStartDate,
						periodEndDate,
						userId,
						orgId,
					};
				}

				// Group by item_code and calculate commission data
				const commissionMap = new Map<string, {
					itemCode: string;
					itemName: string;
					unitsSold: number;
					commissionPercent: number;
					totalSales: number;
					totalCommission: number;
				}>();

				for (const line of salesLines) {
					const itemCode = line.item_code || 'UNKNOWN';
					const itemName = line.description || itemCode;
					const quantity = parseFloat(String(line.quantity || 0));
					// ✅ Use incl_line_total - tax to match sales revenue calculation
					const tax = parseFloat(String(line.tax || 0));
					const inclLineTotal = parseFloat(String(line.incl_line_total || 0));
					const netSales = inclLineTotal - tax; // ✅ Match sales query: SUM(incl_line_total - tax)
					const commissionPer = parseFloat(String(line.commission_per || 0));
					
					// Calculate commission amount based on net sales (excl tax)
					const commissionAmount = (netSales * commissionPer) / 100;

					if (commissionMap.has(itemCode)) {
						const existing = commissionMap.get(itemCode)!;
						existing.unitsSold += quantity;
						existing.totalSales += netSales; // ✅ Use net sales (excl tax)
						existing.totalCommission += commissionAmount;
						// Use the highest commission % if multiple exist (or average - you can adjust this logic)
						if (commissionPer > existing.commissionPercent) {
							existing.commissionPercent = commissionPer;
						}
					} else {
						commissionMap.set(itemCode, {
							itemCode,
							itemName,
							unitsSold: quantity,
							commissionPercent: commissionPer,
							totalSales: netSales, // ✅ Use net sales (excl tax)
							totalCommission: commissionAmount,
						});
					}
				}

				// Convert map to array and sort by total sales (descending)
				const commissionData = Array.from(commissionMap.values())
					.sort((a, b) => b.totalSales - a.totalSales);

				this.logger.log(`[${operationId}] ✅ Generated commission data for ${commissionData.length} products`);

				return {
					success: true,
					data: commissionData,
					periodStartDate,
					periodEndDate,
					userId,
					orgId,
				};
			} catch (error) {
				this.logger.error(`[${operationId}] Error getting commission data for user ${userId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					data: [],
					userId,
					orgId,
				};
			}
		}, 'profile/commissions');
	}

	/**
	 * Get sales by category for logged-in user
	 * Filters ERP sales data by user's ERP sales rep code and groups by category
	 */
	@Get('profile/sales-by-category')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get sales by category for logged-in user' })
	@ApiResponse({ status: 200, description: 'Sales data grouped by category' })
	@ApiResponse({ status: 404, description: 'User target or ERP code not found' })
	async getProfileSalesByCategory(@Req() request: AuthenticatedRequest) {
		const userId = request.user?.uid;
		const orgId = this.getOrgId(request);
		const operationId = 'profile-sales-by-category';
		
		this.logger.log(`[${operationId}] Getting sales by category for user ${userId}, org ${orgId}`);
		
		return this.executeWithThrottling(operationId, async () => {
			try {
				if (!userId) {
					throw new BadRequestException('User ID not found in request');
				}

				// Get user's target to extract ERP code and date range
				const userTargetResult = await this.userService.getUserTarget(userId, orgId);
				
				if (!userTargetResult?.userTarget) {
					throw new NotFoundException(`No targets found for user ${userId}`);
				}

				const userTarget = userTargetResult.userTarget;
				const erpSalesRepCode = userTarget.erpSalesRepCode || 
					(userTarget.personalTargets as any)?.erpSalesRepCode || 
					null;

				if (!erpSalesRepCode) {
					this.logger.warn(`[${operationId}] ⚠️  No ERP Sales Rep Code found for user ${userId}`);
					return {
						success: false,
						message: 'ERP sales rep code not configured for this user',
						data: [],
						userId,
						orgId,
					};
				}

				// Get period dates from user_targets
				const personalTargets = userTarget.personalTargets as any;
				const periodStartDateRaw = personalTargets?.periodStartDate;
				const periodEndDateRaw = personalTargets?.periodEndDate;

				if (!periodStartDateRaw || !periodEndDateRaw) {
					this.logger.warn(`[${operationId}] ⚠️  No period dates found in user target for user ${userId}`);
					return {
						success: false,
						message: 'Target period dates not configured',
						data: [],
						userId,
						orgId,
					};
				}

				// Format dates to YYYY-MM-DD format
				const periodStartDate = new Date(periodStartDateRaw).toISOString().split('T')[0];
				const periodEndDate = new Date(periodEndDateRaw).toISOString().split('T')[0];
				
				this.logger.log(`[${operationId}] 📅 Fetching sales by category for period: ${periodStartDate} → ${periodEndDate}`);
				this.logger.log(`[${operationId}] 🔍 Filtering by rep_code: ${erpSalesRepCode}`);

				// Get category aggregations filtered by sales person
				const categoryData = await this.erpDataService.getCategoryAggregations({
					startDate: periodStartDate,
					endDate: periodEndDate,
					salesPersonId: erpSalesRepCode, // Filters by rep_code
				});

				if (!categoryData || categoryData.length === 0) {
					this.logger.log(`[${operationId}] No category data found for rep_code ${erpSalesRepCode}`);
					return {
						success: true,
						data: [],
						periodStartDate,
						periodEndDate,
						userId,
						orgId,
					};
				}

				// Transform to chart format
				const salesByCategory = categoryData.map(item => ({
					label: item.category || 'Unknown',
					value: parseFloat(String(item.totalRevenue || 0)),
					color: undefined, // Will be assigned by chart component
				}));

				this.logger.log(`[${operationId}] ✅ Generated sales by category data for ${salesByCategory.length} categories`);

				return {
					success: true,
					data: salesByCategory,
					total: salesByCategory.reduce((sum, item) => sum + item.value, 0),
					periodStartDate,
					periodEndDate,
					userId,
					orgId,
				};
			} catch (error) {
				this.logger.error(`[${operationId}] Error getting sales by category for user ${userId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					data: [],
					userId,
					orgId,
				};
			}
		}, 'profile/sales-by-category');
	}

	/**
	 * Get targets and sales data for all team members (bulk endpoint)
	 * 
	 * ✅ BULK ENDPOINT: Returns targets, sales data, and commission breakdowns for all managed staff
	 * This endpoint consolidates multiple API calls into a single request for better performance.
	 * 
	 * Returns:
	 * - User target data (from user_targets table)
	 * - ERP sales data (totalRevenue, transactionCount, uniqueCustomers)
	 * - Commission breakdown by category for each team member
	 * - Team summary statistics
	 * 
	 * Use this endpoint instead of making individual calls to:
	 * - GET /erp/user/:userId/sales
	 * - GET /erp/user/:userId/commissions-by-category
	 * 
	 * @returns Consolidated team targets and sales data
	 */
	@Get('team/targets')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: 'Get targets and sales data for all team members (bulk endpoint)',
		description: `
Returns consolidated targets, sales data, and commission breakdowns for all managed staff members in a single request.

**Performance Benefits:**
- Reduces API calls from N+1 to 1 (where N = number of team members)
- Batch fetches sales data efficiently using single ERP query
- Leverages existing caching mechanisms

**Response Structure:**
- \`teamMembers\`: Array of team member data including:
  - User information (uid, fullName, email, avatar, branchName)
  - Target data (sales targets, progress, remaining amounts)
  - ERP sales data (totalRevenue, transactionCount, uniqueCustomers)
  - Commission breakdown by category
- \`summary\`: Team-wide aggregated statistics
- \`periodDates\`: Target period dates used for calculations

**Access Control:**
- Only returns data for users managed by the requesting user
- Requires MANAGER, ADMIN, or OWNER access level
- Respects organization and branch-level access controls

**Example Use Case:**
Mobile team tab can replace multiple individual API calls with this single bulk endpoint.
		`
	})
	@ApiResponse({ 
		status: 200, 
		description: 'Team targets and sales data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				data: {
					type: 'object',
					properties: {
						teamMembers: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									userId: { type: 'number', example: 123 },
									fullName: { type: 'string', example: 'John Doe' },
									email: { type: 'string', example: 'john.doe@example.com' },
									avatar: { type: 'string', nullable: true },
									branchName: { type: 'string', nullable: true, example: 'Cape Town Branch' },
									branchUid: { type: 'number', nullable: true },
									hasTargets: { type: 'boolean', example: true },
									targets: {
										type: 'object',
										properties: {
											sales: {
												type: 'object',
												properties: {
													target: { type: 'number', example: 50000 },
													current: { type: 'number', example: 35000 },
													remaining: { type: 'number', example: 15000 },
													progress: { type: 'number', example: 70 },
													currency: { type: 'string', example: 'ZAR' }
												}
											}
										}
									},
									sales: {
										type: 'object',
										properties: {
											totalRevenue: { type: 'number', example: 35000 },
											transactionCount: { type: 'number', example: 45 },
											uniqueCustomers: { type: 'number', example: 12 },
											salesCode: { type: 'string', example: 'CEB01' },
											salesName: { type: 'string', example: 'John Doe' }
										},
										nullable: true
									},
									commissionsByCategory: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												category: { type: 'string', example: 'Rhinolite & 6.4mm' },
												commissionPercent: { type: 'number', example: 0.5 },
												totalSales: { type: 'number', example: 20000 },
												totalCommission: { type: 'number', example: 100 }
											}
										}
									}
								}
							}
						},
						summary: {
							type: 'object',
							properties: {
								totalTarget: { type: 'number', example: 200000 },
								totalAchieved: { type: 'number', example: 150000 },
								teamSize: { type: 'number', example: 5 },
								currency: { type: 'string', example: 'ZAR' }
							}
						},
						periodStartDate: { type: 'string', example: '2024-01-01' },
						periodEndDate: { type: 'string', example: '2024-01-31' }
					}
				},
				orgId: { type: 'number', example: 1 }
			}
		}
	})
	@ApiResponse({ 
		status: 404, 
		description: 'No targets found for requesting user or no managed staff',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'No targets found for user or no managed staff' },
				data: { type: 'object', nullable: true },
				orgId: { type: 'number' }
			}
		}
	})
	async getTeamTargets(@Req() request: AuthenticatedRequest) {
		const userId = request.user?.uid;
		const orgId = this.getOrgId(request);
		const operationId = 'team-targets';
		
		this.logger.log(`[${operationId}] Getting team targets for user ${userId}, org ${orgId}`);
		
		return this.executeWithThrottling(operationId, async () => {
			try {
				if (!userId) {
					throw new BadRequestException('User ID not found in request');
				}

				// Get current user's targets to extract managed staff and period dates
				const userTargetResult = await this.userService.getUserTarget(userId, orgId);
				
				if (!userTargetResult?.userTarget) {
					throw new NotFoundException(`No targets found for user ${userId}`);
				}

				const userTarget = userTargetResult.userTarget;
				const managedStaff = userTarget.managedStaff || [];

				if (!managedStaff || managedStaff.length === 0) {
					this.logger.log(`[${operationId}] No managed staff found for user ${userId}`);
					return {
						success: true,
						data: {
							teamMembers: [],
							summary: {
								totalTarget: 0,
								totalAchieved: 0,
								teamSize: 0,
								currency: 'ZAR',
							},
							periodStartDate: null,
							periodEndDate: null,
						},
						orgId,
					};
				}

				// Get period dates from current user's personal targets (single source of truth)
				const personalTargets = userTarget.personalTargets as any;
				const periodStartDateRaw = personalTargets?.periodStartDate;
				const periodEndDateRaw = personalTargets?.periodEndDate;

				if (!periodStartDateRaw || !periodEndDateRaw) {
					this.logger.warn(`[${operationId}] ⚠️  No period dates found in user target for user ${userId}`);
					return {
						success: false,
						message: 'Target period dates not configured. Please set periodStartDate and periodEndDate in user targets.',
						data: {
							teamMembers: [],
							summary: {
								totalTarget: 0,
								totalAchieved: 0,
								teamSize: managedStaff.length,
								currency: 'ZAR',
							},
							periodStartDate: null,
							periodEndDate: null,
						},
						orgId,
					};
				}

				// Format dates to YYYY-MM-DD format
				const periodStartDate = new Date(periodStartDateRaw).toISOString().split('T')[0];
				const periodEndDate = new Date(periodEndDateRaw).toISOString().split('T')[0];
				
				this.logger.log(`[${operationId}] 📅 Using Target Period Dates: ${periodStartDate} → ${periodEndDate}`);
				this.logger.log(`[${operationId}] 👥 Processing ${managedStaff.length} team members`);

				// Extract ERP codes from managed staff (filter out inactive users and those without ERP codes)
				const staffWithErpCodes: Array<{
					staff: any;
					erpSalesRepCode: string;
					userId: number;
				}> = [];

				for (const staff of managedStaff) {
					// Check if user is active
					const staffUserResult = await this.userService.findOne(staff.uid, orgId);
					if (!staffUserResult?.user || staffUserResult.user.status !== 'active') {
						this.logger.debug(`[${operationId}] ⚠️  Skipping inactive user ${staff.uid} (status: ${staffUserResult?.user?.status || 'not found'})`);
						continue;
					}

					// Get staff member's target to extract ERP code
					const staffTargetResult = await this.userService.getUserTarget(staff.uid, orgId);
					if (!staffTargetResult?.userTarget) {
						this.logger.debug(`[${operationId}] ⚠️  No targets found for staff member ${staff.uid}`);
						continue;
					}

					const staffTarget = staffTargetResult.userTarget;
					const erpSalesRepCode = staffTarget.erpSalesRepCode || 
						(staffTarget.personalTargets as any)?.erpSalesRepCode || 
						null;

					if (erpSalesRepCode) {
						staffWithErpCodes.push({
							staff,
							erpSalesRepCode,
							userId: staff.uid,
						});
					} else {
						this.logger.debug(`[${operationId}] ⚠️  No ERP Sales Rep Code found for staff member ${staff.uid}`);
					}
				}

				this.logger.log(`[${operationId}] ✅ Found ${staffWithErpCodes.length} team members with ERP codes`);

				// Batch fetch sales data for all team members at once
				const salesPersonIds = staffWithErpCodes.map(item => item.erpSalesRepCode);
				let salesData: any[] = [];
				
				if (salesPersonIds.length > 0) {
					this.logger.log(`[${operationId}] 📊 Batch fetching sales data for ${salesPersonIds.length} sales persons...`);
					salesData = await this.erpDataService.getSalesPersonAggregations({
						startDate: periodStartDate,
						endDate: periodEndDate,
						salesPersonId: salesPersonIds, // ✅ Batch fetch with array
					});
					this.logger.log(`[${operationId}] ✅ Retrieved ${salesData.length} sales records`);
				}

				// Create a map of ERP code -> sales data for quick lookup
				const salesDataMap = new Map<string, any>();
				for (const salesRecord of salesData) {
					const code = salesRecord.salesCode?.toUpperCase();
					if (code) {
						salesDataMap.set(code, salesRecord);
					}
				}

				// Batch fetch commission breakdowns for all team members
				// Fetch all sales lines for all team members, then group by user
				let allSalesLines: any[] = [];
				
				if (salesPersonIds.length > 0) {
					this.logger.log(`[${operationId}] 📊 Batch fetching sales lines for commission breakdowns...`);
					allSalesLines = await this.erpDataService.getSalesLinesByDateRange({
						startDate: periodStartDate,
						endDate: periodEndDate,
						salesPersonId: salesPersonIds, // ✅ Batch fetch with array
					}, ['1', '2']); // Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
					this.logger.log(`[${operationId}] ✅ Retrieved ${allSalesLines.length} sales lines`);
				}

				// Group sales lines by rep_code (ERP code) for commission calculations
				const salesLinesByRepCode = new Map<string, any[]>();
				for (const line of allSalesLines) {
					const repCode = line.rep_code?.toUpperCase();
					if (repCode) {
						if (!salesLinesByRepCode.has(repCode)) {
							salesLinesByRepCode.set(repCode, []);
						}
						salesLinesByRepCode.get(repCode)!.push(line);
					}
				}

				// Helper function to normalize commission percentage
				const normalizeCommissionPercent = (percent: number): number => {
					return Math.round(percent * 100) / 100;
				};

				// Helper function to map commission percentage to group name
				const getCommissionGroupName = (commissionPercent: number): string => {
					const normalized = normalizeCommissionPercent(commissionPercent);
					
					if (Math.abs(normalized - 0.5) < 0.01) {
						return 'Rhinolite & 6.4mm';
					} else if (Math.abs(normalized - 3.0) < 0.01) {
						return 'Fuse & BitLite';
					} else if (Math.abs(normalized - 1.5) < 0.01) {
						return 'Other Drywall Products';
					}
					
					return `${normalized.toFixed(2)}% Commission`;
				};

				// Process commission breakdowns for each team member
				const commissionsByRepCode = new Map<string, any[]>();
				
				for (const [repCode, lines] of salesLinesByRepCode.entries()) {
					const commissionMap = new Map<number, {
						commissionPercent: number;
						totalSales: number;
						totalCommission: number;
					}>();

					for (const line of lines) {
						const tax = parseFloat(String(line.tax || 0));
						const inclLineTotal = parseFloat(String(line.incl_line_total || 0));
						const netSales = inclLineTotal - tax;
						const commissionPer = parseFloat(String(line.commission_per || 0));
						
						if (commissionPer <= 0) {
							continue;
						}
						
						const normalizedPercent = normalizeCommissionPercent(commissionPer);
						const commissionAmount = (netSales * commissionPer) / 100;

						if (commissionMap.has(normalizedPercent)) {
							const existing = commissionMap.get(normalizedPercent)!;
							existing.totalSales += netSales;
							existing.totalCommission += commissionAmount;
						} else {
							commissionMap.set(normalizedPercent, {
								commissionPercent: normalizedPercent,
								totalSales: netSales,
								totalCommission: commissionAmount,
							});
						}
					}

					// Convert to array and sort
					const commissionData = Array.from(commissionMap.values())
						.map(item => ({
							category: getCommissionGroupName(item.commissionPercent),
							commissionPercent: item.commissionPercent,
							totalSales: item.totalSales,
							totalCommission: item.totalCommission,
						}))
						.sort((a, b) => b.totalCommission - a.totalCommission);

					commissionsByRepCode.set(repCode, commissionData);
				}

				// Build response: merge staff data with sales and commission data
				const teamMembers = managedStaff.map((staff) => {
					const staffWithCode = staffWithErpCodes.find(item => item.userId === staff.uid);
					
					if (!staffWithCode) {
						// Staff member without ERP code or inactive
						return {
							userId: staff.uid,
							fullName: staff.fullName,
							email: staff.email,
							avatar: staff.avatar,
							branchName: staff.branchName,
							branchUid: staff.branchUid,
							hasTargets: staff.hasTargets,
							targets: staff.targets,
							sales: null, // No ERP data available
							commissionsByCategory: [],
						};
					}

					const erpCode = staffWithCode.erpSalesRepCode.toUpperCase();
					const salesRecord = salesDataMap.get(erpCode);
					const commissionData = commissionsByRepCode.get(erpCode) || [];

					// Update sales target with ERP data
					let updatedTargets = { ...staff.targets };
					if (updatedTargets?.sales && salesRecord) {
						const currentSalesAmount = salesRecord.totalRevenue || 0;
						updatedTargets = {
							...updatedTargets,
							sales: {
								...updatedTargets.sales,
								current: currentSalesAmount,
								progress: updatedTargets.sales.target 
									? Math.min(100, Math.round((currentSalesAmount / updatedTargets.sales.target) * 100))
									: 0,
								remaining: updatedTargets.sales.target 
									? Math.max(0, updatedTargets.sales.target - currentSalesAmount)
									: 0,
							},
						};
					}

					return {
						userId: staff.uid,
						fullName: staff.fullName,
						email: staff.email,
						avatar: staff.avatar,
						branchName: staff.branchName,
						branchUid: staff.branchUid,
						hasTargets: staff.hasTargets,
						targets: updatedTargets,
						sales: salesRecord ? {
							totalRevenue: salesRecord.totalRevenue || 0,
							transactionCount: salesRecord.transactionCount || 0,
							uniqueCustomers: salesRecord.uniqueCustomers || 0,
							salesCode: salesRecord.salesCode,
							salesName: salesRecord.salesName || salesRecord.salesCode,
						} : null,
						commissionsByCategory: commissionData,
					};
				});

				// Calculate team summary
				const summary = teamMembers.reduce(
					(acc, member) => {
						if (member.hasTargets && member.targets?.sales) {
							acc.totalTarget += member.targets.sales.target || 0;
							acc.totalAchieved += member.targets.sales.current || 0;
							acc.currency = member.targets.sales.currency || 'ZAR';
						}
						return acc;
					},
					{
						totalTarget: 0,
						totalAchieved: 0,
						teamSize: teamMembers.length,
						currency: 'ZAR',
					}
				);

				this.logger.log(`[${operationId}] ✅ Team Targets Retrieved Successfully:`);
				this.logger.log(`[${operationId}]    👥 Team Size: ${summary.teamSize} members`);
				this.logger.log(`[${operationId}]    💰 Total Target: R${summary.totalTarget.toLocaleString('en-ZA')}`);
				this.logger.log(`[${operationId}]    📊 Total Achieved: R${summary.totalAchieved.toLocaleString('en-ZA')}`);
				this.logger.log(`[${operationId}]    📅 Period: ${periodStartDate} → ${periodEndDate}`);

				return {
					success: true,
					data: {
						teamMembers,
						summary,
						periodStartDate,
						periodEndDate,
					},
					orgId,
				};
			} catch (error) {
				this.logger.error(`[${operationId}] Error getting team targets for user ${userId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					data: {
						teamMembers: [],
						summary: {
							totalTarget: 0,
							totalAchieved: 0,
							teamSize: 0,
							currency: 'ZAR',
						},
						periodStartDate: null,
						periodEndDate: null,
					},
					orgId,
				};
			}
		}, 'team/targets');
	}

	/**
	 * Get commission breakdown by category for logged-in user
	 * Groups commission data by category instead of product
	 */
	@Get('profile/commissions-by-category')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get commission breakdown by category for logged-in user' })
	@ApiResponse({ status: 200, description: 'Commission data grouped by category' })
	@ApiResponse({ status: 404, description: 'User target or ERP code not found' })
	async getProfileCommissionsByCategory(@Req() request: AuthenticatedRequest) {
		const userId = request.user?.uid;
		const orgId = this.getOrgId(request);
		const operationId = 'profile-commissions-by-category';
		
		this.logger.log(`[${operationId}] Getting commission breakdown by category for user ${userId}, org ${orgId}`);
		
		return this.executeWithThrottling(operationId, async () => {
			try {
				if (!userId) {
					throw new BadRequestException('User ID not found in request');
				}

				// Get user's target to extract ERP code and date range
				const userTargetResult = await this.userService.getUserTarget(userId, orgId);
				
				if (!userTargetResult?.userTarget) {
					throw new NotFoundException(`No targets found for user ${userId}`);
				}

				const userTarget = userTargetResult.userTarget;
				const erpSalesRepCode = userTarget.erpSalesRepCode || 
					(userTarget.personalTargets as any)?.erpSalesRepCode || 
					null;

				if (!erpSalesRepCode) {
					this.logger.warn(`[${operationId}] ⚠️  No ERP Sales Rep Code found for user ${userId}`);
					return {
						success: false,
						message: 'ERP sales rep code not configured for this user',
						data: [],
						userId,
						orgId,
					};
				}

				// Get period dates from user_targets
				const personalTargets = userTarget.personalTargets as any;
				const periodStartDateRaw = personalTargets?.periodStartDate;
				const periodEndDateRaw = personalTargets?.periodEndDate;

				if (!periodStartDateRaw || !periodEndDateRaw) {
					this.logger.warn(`[${operationId}] ⚠️  No period dates found in user target for user ${userId}`);
					return {
						success: false,
						message: 'Target period dates not configured',
						data: [],
						userId,
						orgId,
					};
				}

				// Format dates to YYYY-MM-DD format
				const periodStartDate = new Date(periodStartDateRaw).toISOString().split('T')[0];
				const periodEndDate = new Date(periodEndDateRaw).toISOString().split('T')[0];
				
				this.logger.log(`[${operationId}] 📅 Fetching commission breakdown by category for period: ${periodStartDate} → ${periodEndDate}`);
				this.logger.log(`[${operationId}] 🔍 Filtering by rep_code: ${erpSalesRepCode}`);

				// Fetch sales lines filtered by rep_code
				const salesLines = await this.erpDataService.getSalesLinesByDateRange({
					startDate: periodStartDate,
					endDate: periodEndDate,
					salesPersonId: erpSalesRepCode, // Filters by rep_code
				}, ['1', '2']); // Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)

				if (!salesLines || salesLines.length === 0) {
					this.logger.log(`[${operationId}] No sales lines found for rep_code ${erpSalesRepCode}`);
					return {
						success: true,
						data: [],
						periodStartDate,
						periodEndDate,
						userId,
						orgId,
					};
				}

				// Helper function to normalize commission percentage (round to 2 decimals for grouping)
				const normalizeCommissionPercent = (percent: number): number => {
					return Math.round(percent * 100) / 100;
				};

				// Helper function to map commission percentage to group name dynamically
				// Maps known percentages to specific names, others get generic names
				const getCommissionGroupName = (commissionPercent: number): string => {
					const normalized = normalizeCommissionPercent(commissionPercent);
					
					// Map to group names based on specific commission percentages (with tolerance for floating point)
					if (Math.abs(normalized - 0.5) < 0.01) {
						return 'Rhinolite & 6.4mm';
					} else if (Math.abs(normalized - 3.0) < 0.01) {
						return 'Fuse & BitLite';
					} else if (Math.abs(normalized - 1.5) < 0.01) {
						return 'Other Drywall Products';
					}
					
					// For any other commission percentage, use the percentage as the name
					// This makes it dynamic - if percentages change (e.g., 0.4%), they'll still be grouped
					return `${normalized.toFixed(2)}% Commission`;
				};

				// Group by commission percentage (normalized) and calculate commission data
				const commissionMap = new Map<number, {
					commissionPercent: number;
					totalSales: number;
					totalCommission: number;
				}>();

				for (const line of salesLines) {
					// ✅ Use incl_line_total - tax to match sales revenue calculation
					const tax = parseFloat(String(line.tax || 0));
					const inclLineTotal = parseFloat(String(line.incl_line_total || 0));
					const netSales = inclLineTotal - tax; // ✅ Match sales query: SUM(incl_line_total - tax)
					const commissionPer = parseFloat(String(line.commission_per || 0));
					
					if (commissionPer <= 0) {
						continue; // Skip items with no commission
					}
					
					const normalizedPercent = normalizeCommissionPercent(commissionPer);
					
					// Calculate commission amount based on net sales (excl tax)
					const commissionAmount = (netSales * commissionPer) / 100;

					if (commissionMap.has(normalizedPercent)) {
						const existing = commissionMap.get(normalizedPercent)!;
						existing.totalSales += netSales; // ✅ Use net sales (excl tax)
						existing.totalCommission += commissionAmount;
					} else {
						commissionMap.set(normalizedPercent, {
							commissionPercent: normalizedPercent,
							totalSales: netSales, // ✅ Use net sales (excl tax)
							totalCommission: commissionAmount,
						});
					}
				}

				// Convert map to array, map to group names, and sort by total commission (descending)
				const commissionData = Array.from(commissionMap.values())
					.map(item => {
						const groupName = getCommissionGroupName(item.commissionPercent);
						
						return {
							category: groupName,
							commissionPercent: item.commissionPercent,
							totalSales: item.totalSales,
							totalCommission: item.totalCommission,
						};
					})
					.sort((a, b) => b.totalCommission - a.totalCommission);

				this.logger.log(`[${operationId}] ✅ Generated commission breakdown by commission percentage for ${commissionData.length} groups`);

				return {
					success: true,
					data: commissionData,
					periodStartDate,
					periodEndDate,
					userId,
					orgId,
				};
			} catch (error) {
				this.logger.error(`[${operationId}] Error getting commission breakdown by category for user ${userId}: ${error.message}`);
				return {
					success: false,
					error: error.message,
					data: [],
					userId,
					orgId,
				};
			}
		}, 'profile/commissions-by-category');
	}
}

