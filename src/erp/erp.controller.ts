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
				this.logger.log(`[${operationId}] 🔍 Fetching sales from tblsalesheader WHERE sales_code = "${erpSalesRepCode}" AND sale_date BETWEEN '${periodStartDate}' AND '${periodEndDate}'`);

				// ✅ CRITICAL: Call getSalesPersonAggregations with salesPersonId filter
				// This queries tblsalesheader WHERE sales_code = erpSalesRepCode
				// Returns ONLY sales headers made by this specific sales person (like CEB01)
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
					this.logger.log(`[${operationId}]    💡 No records found in tblsalesheader WHERE sales_code = "${erpSalesRepCode}"`);
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
				this.logger.log(`[${operationId}] 🔍 Fetching sales from tblsalesheader WHERE sales_code = "${erpSalesRepCode}" AND sale_date BETWEEN '${periodStartDate}' AND '${periodEndDate}'`);

				// ✅ Call getSalesPersonAggregations with salesPersonId filter
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
					this.logger.log(`[${operationId}]    💡 No records found in tblsalesheader WHERE sales_code = "${erpSalesRepCode}"`);
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
}

