import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityTarget } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { TblSalesHeader } from '../entities/tblsalesheader.entity';
import { TblSalesLines } from '../entities/tblsaleslines.entity';
import { TblCustomers } from '../entities/tblcustomers.entity';
import { TblCustomerCategories } from '../entities/tblcustomercategories.entity';
import { TblSalesman } from '../entities/tblsalesman.entity';
import { TblMultistore } from '../entities/tblmultistore.entity';
import { ErpConnectionManagerService } from './erp-connection-manager.service';
import {
	DailyAggregation,
	BranchAggregation,
	SalesPersonAggregation,
	CategoryAggregation,
	BranchCategoryAggregation,
	ProductAggregation,
	ErpQueryFilters,
	TblSalesLinesWithCategory,
} from '../interfaces/erp-data.interface';
import { ConfigService } from '@nestjs/config';
import { getBranchName } from '../config/category-mapping.config';

/**
 * ERP Data Service
 *
 * Handles all queries to the ERP database with aggressive caching
 * and sequential query execution for optimal reliability.
 * 
 * ========================================================================
 * PERFORMANCE & SCALABILITY FEATURES (Optimized for Remote Servers)
 * ========================================================================
 * 
 * 1. **Circuit Breaker Pattern**
 *    - Automatically stops queries after 5 consecutive failures
 *    - Prevents cascading failures and database overload
 *    - Auto-recovery after 60 seconds
 * 
 * 2. **Automatic Retry with Exponential Backoff**
 *    - Up to 3 retry attempts for transient failures
 *    - Intelligent error detection (retries network issues, not SQL errors)
 *    - Exponential backoff: 1s → 2s → 4s (with jitter)
 * 
 * 3. **Query Concurrency Control**
 *    - Sequential query execution (one query at a time)
 *    - Prevents connection pool exhaustion
 *    - Request queuing for overflow
 *    - Connection pool monitoring
 * 
 * 4. **Aggressive Caching Strategy**
 *    - 10-minute TTL for all queries (reduced from 4 hours for faster updates)
 *    - Cache-first approach reduces database load
 *    - Individual cache keys for different query combinations
 *    - Today's data refreshed every 5 minutes for real-time accuracy
 * 
 * 5. **Extended Timeouts for Remote Servers**
 *    - 90 seconds for headers queries
 *    - 120 seconds for lines and aggregations
 *    - Accounts for network latency on remote databases
 * 
 * 6. **Sequential Query Execution**
 *    - All queries execute one after another (not in parallel)
 *    - Prevents connection pool saturation
 *    - Ensures all queries complete successfully
 *    - Critical queries run first in sequence
 * 
 * 7. **Enhanced Error Diagnostics**
 *    - Detailed logging of error type, code, and stack trace
 *    - Connection pool state logging
 *    - Circuit breaker state tracking
 *    - Query parameter logging for debugging
 * 
 * 8. **Pagination Strategy**
 *    - Current: Caching + sequential execution (optimal for this use case)
 *    - Result sets are aggregated, not raw transactional data
 *    - Most queries return summary data (< 1000 rows)
 *    - If pagination needed: Use LIMIT/OFFSET in TypeORM with .take()/.skip()
 * 
 * ========================================================================
 */
@Injectable()
export class ErpDataService implements OnModuleInit {
	private readonly logger = new Logger(ErpDataService.name);
	private readonly CACHE_TTL = 600; // 10 minutes in seconds (reduced from 4 hours for faster updates)
	
	// ✅ Circuit Breaker State (More resilient for remote servers)
	private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
	private failureCount = 0;
	private networkFailureCount = 0; // Track network errors separately
	private sqlFailureCount = 0; // Track SQL errors separately
	private lastFailureTime: number = 0;
	private readonly FAILURE_THRESHOLD = 5; // Open circuit after 5 consecutive failures (increased from 3)
	private readonly NETWORK_FAILURE_THRESHOLD = 5; // Network errors trigger circuit breaker
	private readonly SQL_FAILURE_THRESHOLD = 10; // SQL errors need more failures (likely data issues, not server)
	private readonly CIRCUIT_RESET_TIMEOUT = 60000; // 60 seconds (increased from 30s)
	private readonly HALF_OPEN_MAX_REQUESTS = 2; // Allow 2 test requests in half-open state (increased from 1)
	private halfOpenRequests = 0;
	
	// ✅ Query Semaphore for limiting concurrent queries
	private activeQueries = 0;
	private readonly MAX_CONCURRENT_QUERIES = 3; // Max 3 concurrent queries (legacy, now using sequential)
	private queryQueue: Array<() => Promise<any>> = [];
	
	// ✅ Retry Configuration for transient failures (Adaptive)
	private readonly MAX_RETRIES_NETWORK = 5; // More retries for network errors
	private readonly MAX_RETRIES_SQL = 1; // Fewer retries for SQL errors (likely permanent)
	private readonly MAX_RETRIES_DEFAULT = 3; // Default retries for unknown errors
	private readonly INITIAL_RETRY_DELAY = 1000; // Start with 1 second
	private readonly MAX_RETRY_DELAY = 10000; // Max 10 seconds between retries

	constructor(
		@InjectRepository(TblSalesHeader, 'erp')
		private salesHeaderRepo: Repository<TblSalesHeader>,
		@InjectRepository(TblSalesLines, 'erp')
		private salesLinesRepo: Repository<TblSalesLines>,
		@InjectRepository(TblCustomers, 'erp')
		private customersRepo: Repository<TblCustomers>,
		@InjectRepository(TblCustomerCategories, 'erp')
		private customerCategoriesRepo: Repository<TblCustomerCategories>,
		@InjectRepository(TblSalesman, 'erp')
		private salesmanRepo: Repository<TblSalesman>,
		@InjectDataSource('erp')
		private erpDataSource: DataSource,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly connectionManager: ErpConnectionManagerService,
	) {}

	/**
	 * Log ERP database configuration on module initialization
	 */
	async onModuleInit() {
		const operationId = this.generateOperationId('INIT');
		this.logger.log(`[${operationId}] ===== ERP Data Service Initialization =====`);

		try {
			// Log connection details (without password)
			const host = this.configService.get<string>('ERP_DATABASE_HOST');
			const port = this.configService.get<string>('ERP_DATABASE_PORT');
			const database = this.configService.get<string>('ERP_DATABASE_NAME');
			const user = this.configService.get<string>('ERP_DATABASE_USER');
			const connectionLimit = this.configService.get<string>('ERP_DB_CONNECTION_LIMIT') || '100';

			this.logger.log(`[${operationId}] ERP Database Configuration:`);
			this.logger.log(`[${operationId}]   Host: ${host || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Port: ${port || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Database: ${database || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   User: ${user || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Connection Pool Size: ${connectionLimit}`);
			this.logger.log(`[${operationId}]   Cache TTL: ${this.CACHE_TTL}s (10 minutes)`);
			this.logger.log(`[${operationId}]   Query Timeout: 120s (default, adaptive)`);
			this.logger.log(`[${operationId}]   Max Retries: Network=${this.MAX_RETRIES_NETWORK}, SQL=${this.MAX_RETRIES_SQL}, Default=${this.MAX_RETRIES_DEFAULT}`);
			this.logger.log(`[${operationId}]   Circuit Breaker Threshold: ${this.FAILURE_THRESHOLD} failures`);

			// ✅ Log connection pool information
			const poolInfo = this.getConnectionPoolInfo();
			this.logger.log(`[${operationId}] Connection Pool Info:`);
			this.logger.log(`[${operationId}]   Pool Size: ${poolInfo.poolSize}`);
			this.logger.log(`[${operationId}]   Active Connections: ${poolInfo.activeConnections}`);
			this.logger.log(`[${operationId}]   Idle Connections: ${poolInfo.idleConnections}`);

			// Test connection with retry
			this.logger.log(`[${operationId}] Testing ERP database connection...`);
			const testStart = Date.now();

			await this.testDatabaseConnection(operationId);

			const testDuration = Date.now() - testStart;
			this.logger.log(`[${operationId}] ✅ ERP database connection successful (${testDuration}ms)`);
			this.logger.log(`[${operationId}] ===== ERP Data Service Ready =====`);
		} catch (error) {
			this.logger.error(`[${operationId}] ❌ ERP database connection FAILED`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
			this.logger.error(`[${operationId}] ===== ERP Data Service NOT Ready =====`);
		}
	}

	/**
	 * ✅ Test database connection with retry logic
	 */
	private async testDatabaseConnection(operationId: string): Promise<void> {
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				// Use default connection for health check
				const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, 'SA');
				await salesLinesRepo.count({ take: 1 });
				if (attempt > 1) {
					this.logger.log(`[${operationId}] Connection test succeeded on attempt ${attempt}`);
				}
				return;
			} catch (error) {
				if (attempt < 3) {
					const delay = 2000 * attempt;
					this.logger.warn(
						`[${operationId}] Connection test attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`,
					);
					await new Promise(resolve => setTimeout(resolve, delay));
				} else {
					throw error;
				}
			}
		}
	}

	/**
	 * ✅ Check connection pool health
	 */
	async checkConnectionHealth(): Promise<{
		healthy: boolean;
		poolInfo: ReturnType<typeof this.getConnectionPoolInfo>;
		circuitBreakerState: string;
		activeQueries: number;
	}> {
		const poolInfo = this.getConnectionPoolInfo();
		const healthy = this.circuitBreakerState === 'CLOSED' && poolInfo.poolSize !== 'error';
		
		return {
			healthy,
			poolInfo,
			circuitBreakerState: this.circuitBreakerState,
			activeQueries: this.activeQueries,
		};
	}

	/**
	 * Get connection pool information for monitoring
	 */
	getConnectionPoolInfo(): {
		poolSize: number | string;
		activeConnections: number | string;
		idleConnections: number | string;
	} {
		try {
			const driver = this.erpDataSource?.driver as any;
			const pool = driver?.pool;

			if (!pool) {
				return {
					poolSize: 'N/A',
					activeConnections: 'N/A',
					idleConnections: 'N/A',
				};
			}

			const poolSize = pool?.config?.connectionLimit || 'unknown';
			const allConnections = pool?._allConnections?.length || 0;
			const freeConnections = pool?._freeConnections?.length || 0;
			const activeConnections = allConnections - freeConnections;

			return {
				poolSize,
				activeConnections,
				idleConnections: freeConnections,
			};
		} catch (error) {
			this.logger.warn(`Failed to get connection pool info: ${error.message}`);
			return {
				poolSize: 'error',
				activeConnections: 'error',
				idleConnections: 'error',
			};
		}
	}

	/**
	 * Generate unique operation ID for tracking
	 */
	private generateOperationId(operation: string): string {
		return `${operation}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
	}

	/**
	 * ✅ Circuit Breaker: Check if circuit is open
	 */
	private isCircuitOpen(): boolean {
		if (this.circuitBreakerState === 'OPEN') {
			const timeSinceLastFailure = Date.now() - this.lastFailureTime;
			
			// Try to move to HALF_OPEN after timeout
			if (timeSinceLastFailure >= this.CIRCUIT_RESET_TIMEOUT) {
				this.logger.warn('Circuit breaker moving to HALF_OPEN state');
				this.circuitBreakerState = 'HALF_OPEN';
				this.halfOpenRequests = 0;
				return false;
			}
			
			return true;
		}
		
		return false;
	}

	/**
	 * ✅ Circuit Breaker: Record success
	 */
	private recordSuccess(operationId: string): void {
		if (this.circuitBreakerState === 'HALF_OPEN') {
			this.logger.log(`[${operationId}] Circuit breaker test request succeeded - closing circuit`);
			this.circuitBreakerState = 'CLOSED';
			this.failureCount = 0;
			this.networkFailureCount = 0;
			this.sqlFailureCount = 0;
			this.halfOpenRequests = 0;
		} else if (this.circuitBreakerState === 'CLOSED') {
			// Reset failure counts on success
			if (this.failureCount > 0 || this.networkFailureCount > 0 || this.sqlFailureCount > 0) {
				this.logger.debug(`[${operationId}] Resetting failure counts (network: ${this.networkFailureCount}, sql: ${this.sqlFailureCount})`);
				this.failureCount = 0;
				this.networkFailureCount = 0;
				this.sqlFailureCount = 0;
			}
		}
	}

	/**
	 * ✅ Circuit Breaker: Record failure (with error type tracking)
	 */
	private recordFailure(operationId: string, error: Error): void {
		this.failureCount++;
		this.lastFailureTime = Date.now();

		// Classify error type
		const isNetworkError = this.isRetryableError(error);
		const isSqlError = !isNetworkError && (
			error.message?.toLowerCase().includes('syntax') ||
			error.message?.toLowerCase().includes('unknown column') ||
			error.message?.toLowerCase().includes('unknown table') ||
			error.message?.toLowerCase().includes('foreign key')
		);

		if (isNetworkError) {
			this.networkFailureCount++;
		} else if (isSqlError) {
			this.sqlFailureCount++;
		}

		this.logger.warn(
			`[${operationId}] Query failure recorded (total: ${this.failureCount}, network: ${this.networkFailureCount}, sql: ${this.sqlFailureCount}) - ${error.message}`,
		);

		if (this.circuitBreakerState === 'HALF_OPEN') {
			this.logger.error(`[${operationId}] Circuit breaker test request failed - reopening circuit`);
			this.circuitBreakerState = 'OPEN';
		} else if (
			this.networkFailureCount >= this.NETWORK_FAILURE_THRESHOLD ||
			this.sqlFailureCount >= this.SQL_FAILURE_THRESHOLD ||
			this.failureCount >= this.FAILURE_THRESHOLD
		) {
			const reason = this.networkFailureCount >= this.NETWORK_FAILURE_THRESHOLD 
				? `network errors (${this.networkFailureCount})`
				: this.sqlFailureCount >= this.SQL_FAILURE_THRESHOLD
				? `SQL errors (${this.sqlFailureCount})`
				: `total failures (${this.failureCount})`;
			
			this.logger.error(
				`[${operationId}] ⚠️ CIRCUIT BREAKER OPENED after ${reason}. Will retry in ${this.CIRCUIT_RESET_TIMEOUT / 1000}s`,
			);
			this.circuitBreakerState = 'OPEN';
		}
	}

	/**
	 * ✅ Calculate exponential backoff delay for retries
	 */
	private calculateRetryDelay(attempt: number): number {
		const exponentialDelay = this.INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
		const jitter = Math.random() * 500; // Add 0-500ms jitter to avoid thundering herd
		return Math.min(exponentialDelay + jitter, this.MAX_RETRY_DELAY);
	}

	/**
	 * ✅ Determine if error is retryable (transient failure vs permanent error)
	 */
	private isRetryableError(error: any): boolean {
		const errorMessage = error.message?.toLowerCase() || '';
		
		// Retryable: Network issues, timeouts, connection problems
		const retryablePatterns = [
			'timeout',
			'etimedout',
			'econnreset',
			'econnrefused',
			'ehostunreach',
			'enetunreach',
			'socket hang up',
			'connection lost',
			'too many connections',
			'connection pool',
		];
		
		// Non-retryable: SQL errors, authentication issues
		const nonRetryablePatterns = [
			'syntax error',
			'access denied',
			'unknown column',
			'unknown table',
			'foreign key constraint',
		];
		
		// Check if error is non-retryable
		if (nonRetryablePatterns.some(pattern => errorMessage.includes(pattern))) {
			return false;
		}
		
		// Check if error is retryable
		return retryablePatterns.some(pattern => errorMessage.includes(pattern));
	}

	/**
	 * ✅ Query Semaphore: Execute query with concurrency control
	 */
	private async executeWithSemaphore<T>(
		queryFn: () => Promise<T>,
		operationId: string,
	): Promise<T> {
		// Wait if too many active queries
		while (this.activeQueries >= this.MAX_CONCURRENT_QUERIES) {
			this.logger.debug(
				`[${operationId}] Query queue: ${this.activeQueries}/${this.MAX_CONCURRENT_QUERIES} active, waiting...`,
			);
			await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms
		}

		this.activeQueries++;
		const poolInfo = this.getConnectionPoolInfo();
		this.logger.debug(
			`[${operationId}] Starting query (${this.activeQueries}/${this.MAX_CONCURRENT_QUERIES} active) - Pool: ${poolInfo.activeConnections}/${poolInfo.poolSize} connections`,
		);

		try {
			const result = await queryFn();
			return result;
		} finally {
			this.activeQueries--;
			this.logger.debug(
				`[${operationId}] Query completed (${this.activeQueries}/${this.MAX_CONCURRENT_QUERIES} active)`,
			);
		}
	}

	/**
	 * ✅ Calculate adaptive timeout based on date range size
	 */
	private calculateTimeout(dateRangeDays: number, baseTimeout: number = 120000): number {
		// Scale timeout: 90s base, +30s per 60 days
		if (dateRangeDays <= 30) return baseTimeout * 0.75; // 90s for small ranges
		if (dateRangeDays <= 60) return baseTimeout; // 120s for medium ranges
		if (dateRangeDays <= 180) return baseTimeout * 1.5; // 180s for large ranges
		return baseTimeout * 2; // 240s for very large ranges
	}

	/**
	 * ✅ Determine max retries based on error type
	 */
	private getMaxRetries(error: Error | null): number {
		if (!error) return this.MAX_RETRIES_DEFAULT;
		
		if (this.isRetryableError(error)) {
			return this.MAX_RETRIES_NETWORK; // More retries for network errors
		}
		
		const errorMessage = error.message?.toLowerCase() || '';
		if (
			errorMessage.includes('syntax') ||
			errorMessage.includes('unknown column') ||
			errorMessage.includes('unknown table') ||
			errorMessage.includes('foreign key')
		) {
			return this.MAX_RETRIES_SQL; // Fewer retries for SQL errors
		}
		
		return this.MAX_RETRIES_DEFAULT;
	}

	/**
	 * ✅ Wrap query execution with circuit breaker, timeout, and retry logic
	 */
	private async executeQueryWithProtection<T>(
		queryFn: () => Promise<T>,
		operationId: string,
		timeoutMs: number = 120000, // 120 second default timeout (increased from 60s for remote servers)
		dateRangeDays?: number, // Optional: for adaptive timeout
	): Promise<T> {
		// Use adaptive timeout if date range provided
		const adaptiveTimeout = dateRangeDays ? this.calculateTimeout(dateRangeDays, timeoutMs) : timeoutMs;
		// Check circuit breaker
		if (this.isCircuitOpen()) {
			const error = new Error(
				`Circuit breaker is OPEN - ERP queries temporarily disabled. Will retry in ${Math.ceil((this.CIRCUIT_RESET_TIMEOUT - (Date.now() - this.lastFailureTime)) / 1000)}s`,
			);
			this.logger.error(`[${operationId}] ${error.message}`);
			throw error;
		}

		// Check half-open state
		if (this.circuitBreakerState === 'HALF_OPEN') {
			if (this.halfOpenRequests >= this.HALF_OPEN_MAX_REQUESTS) {
				const error = new Error('Circuit breaker is HALF_OPEN - max test requests reached');
				this.logger.warn(`[${operationId}] ${error.message}`);
				throw error;
			}
			this.halfOpenRequests++;
		}

		// ✅ Retry loop with exponential backoff (adaptive retries)
		let lastError: Error | null = null;
		let maxRetries = this.MAX_RETRIES_DEFAULT;
		
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				// Determine max retries based on previous error (if any)
				if (attempt === 1 && lastError) {
					maxRetries = this.getMaxRetries(lastError);
				} else if (attempt === 1) {
					maxRetries = this.MAX_RETRIES_DEFAULT;
				}
				
				this.logger.debug(
					`[${operationId}] Query attempt ${attempt}/${maxRetries} (timeout: ${adaptiveTimeout}ms)`,
				);
				
				// Execute with timeout protection
				const result = await Promise.race([
					this.executeWithSemaphore(queryFn, operationId),
					new Promise<T>((_, reject) =>
						setTimeout(() => reject(new Error(`Query timeout after ${adaptiveTimeout}ms`)), adaptiveTimeout),
					),
				]);

				// Success! Record and return
				this.recordSuccess(operationId);
				
				if (attempt > 1) {
					this.logger.log(`[${operationId}] ✅ Query succeeded on retry attempt ${attempt}`);
				}
				
				return result;
			} catch (error) {
				lastError = error;
				
				// Update max retries based on error type
				maxRetries = this.getMaxRetries(error);
				
				// Check if we should retry
				const isLastAttempt = attempt >= maxRetries;
				const shouldRetry = this.isRetryableError(error) && !isLastAttempt;
				
				if (shouldRetry) {
					const delay = this.calculateRetryDelay(attempt);
					this.logger.warn(
						`[${operationId}] Query attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms... (max retries: ${maxRetries})`,
					);
					await new Promise(resolve => setTimeout(resolve, delay));
				} else {
					// Final failure - record it
					this.logger.error(
						`[${operationId}] Query failed after ${attempt} attempt(s): ${error.message}`,
					);
					this.recordFailure(operationId, error);
					throw error;
				}
			}
		}
		
		// Should never reach here, but TypeScript needs this
		throw lastError || new Error('Query failed with unknown error');
	}

	/**
	 * Get repository for a specific country
	 */
	private async getRepositoryForCountry<T>(
		entity: EntityTarget<T>,
		countryCode: string = 'SA',
	): Promise<Repository<T>> {
		const connection = await this.connectionManager.getConnection(countryCode);
		return connection.getRepository(entity);
	}

	/**
	 * Build cache key with all filtering dimensions (including country code)
	 */
	private buildCacheKey(dataType: string, filters: ErpQueryFilters, docTypes?: string[], countryCode: string = 'SA'): string {
		const salesPersonKey = filters.salesPersonId 
			? (Array.isArray(filters.salesPersonId) ? filters.salesPersonId.sort().join('-') : filters.salesPersonId)
			: 'all';
		
		// Include customer category filters in cache key
		const includeCustomerCategoriesKey = filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0
			? filters.includeCustomerCategories.sort().join('-')
			: 'all';
		const excludeCustomerCategoriesKey = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0
			? filters.excludeCustomerCategories.sort().join('-')
			: 'all';
		
		return [
			'erp',
			'v2', // Version for cache busting
			countryCode, // ✅ Include country code in cache key
			dataType,
			filters.startDate,
			filters.endDate,
			filters.storeCode || 'all',
			filters.category || 'all',
			salesPersonKey,
			docTypes ? docTypes.join('-') : 'all',
			`inc_cat:${includeCustomerCategoriesKey}`,
			`exc_cat:${excludeCustomerCategoriesKey}`,
		].join(':');
	}

	/**
	 * ✅ PRE-FILTERING: Build base cache key (without customer category filters)
	 * Used for pre-grouped data cache that can be filtered in memory
	 */
	private buildBaseCacheKey(dataType: string, filters: ErpQueryFilters, docTypes?: string[]): string {
		const salesPersonKey = filters.salesPersonId 
			? (Array.isArray(filters.salesPersonId) ? filters.salesPersonId.sort().join('-') : filters.salesPersonId)
			: 'all';
		
		return [
			'erp',
			'v2',
			'pre_grouped', // Mark as pre-grouped data
			dataType,
			filters.startDate,
			filters.endDate,
			filters.storeCode || 'all',
			filters.category || 'all',
			salesPersonKey,
			docTypes ? docTypes.join('-') : 'all',
		].join(':');
	}

	/**
	 * ✅ PRE-FILTERING: Get customer codes by category (cached)
	 * Pre-filters customers before JOIN to improve query performance
	 */
	private async getCustomerCodesByCategory(
		categories: string[],
		operationId: string,
	): Promise<string[]> {
		const cacheKey = `customer_codes_by_category:${categories.sort().join('-')}`;
		
		// Check cache first
		const cached = await this.cacheManager.get<string[]>(cacheKey);
		if (cached) {
			this.logger.debug(`[${operationId}] Customer codes cache HIT: ${cached.length} codes`);
			return cached;
		}
		
		// Query database
		const customers = await this.customersRepo
			.createQueryBuilder('customer')
			.select('customer.Code', 'code')
			.where('customer.Category IN (:...categories)', { categories })
			.andWhere('customer.Code IS NOT NULL')
			.andWhere('customer.Code != :empty', { empty: '' })
			.getRawMany();
		
		const codes = customers.map(c => c.code).filter(Boolean);
		
		// Cache for 1 hour (category assignments don't change often)
		await this.cacheManager.set(cacheKey, codes, 3600);
		
		this.logger.debug(`[${operationId}] Customer codes cache MISS: ${codes.length} codes`);
		return codes;
	}

	/**
	 * ✅ PRE-FILTERING: Get pre-grouped sales headers by customer category
	 * Groups sales data by customer category and caches it for fast filtering
	 */
	private async getPreGroupedSalesHeaders(
		filters: ErpQueryFilters,
		operationId: string,
	): Promise<Map<string, TblSalesHeader[]>> {
		const baseCacheKey = this.buildBaseCacheKey('headers', filters, ['1']);
		
		// Check if pre-grouped data is cached
		const cached = await this.cacheManager.get<Map<string, TblSalesHeader[]>>(baseCacheKey);
		if (cached) {
			this.logger.log(`[${operationId}] ✅ Pre-grouped cache HIT - Using cached grouped data`);
			return cached;
		}
		
		this.logger.log(`[${operationId}] Pre-grouped cache MISS - Building grouped data from database...`);
		
		// Query all sales headers (without customer category filters)
		const query = this.salesHeaderRepo
			.createQueryBuilder('header')
			.where('header.sale_date BETWEEN :startDate AND :endDate', {
				startDate: filters.startDate,
				endDate: filters.endDate,
			})
			.andWhere('header.doc_type = :docType', { docType: 1 });
		
		if (filters.storeCode) {
			query.andWhere('header.store = :store', { store: filters.storeCode });
		}
		
		if (filters.salesPersonId) {
			const salesPersonIds = Array.isArray(filters.salesPersonId) 
				? filters.salesPersonId 
				: [filters.salesPersonId];
			query.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
		}
		
		const headers = await query.getMany();
		
		// Get customer categories for each header
		const customerCodes = [...new Set(headers.map(h => h.customer).filter(Boolean))];
		const customerMap = new Map<string, string>();
		
		if (customerCodes.length > 0) {
			const customers = await this.customersRepo
				.createQueryBuilder('customer')
				.select('customer.Code', 'code')
				.addSelect('customer.Category', 'category')
				.where('customer.Code IN (:...codes)', { codes: customerCodes })
				.getRawMany();
			
			for (const cust of customers) {
				customerMap.set(cust.code, cust.category || 'NULL');
			}
		}
		
		// Group by customer category
		const grouped = new Map<string, TblSalesHeader[]>();
		
		for (const header of headers) {
			const category = customerMap.get(header.customer) || 'NULL';
			if (!grouped.has(category)) {
				grouped.set(category, []);
			}
			grouped.get(category)!.push(header);
		}
		
		this.logger.log(`[${operationId}] Pre-grouped ${headers.length} headers into ${grouped.size} categories`);
		
		// Cache grouped data (10 minute TTL)
		await this.cacheManager.set(baseCacheKey, grouped, this.CACHE_TTL);
		
		return grouped;
	}

	/**
	 * ✅ PRE-FILTERING: Get pre-grouped sales lines by customer category
	 * Groups sales lines by customer category and caches it for fast filtering
	 */
	private async getPreGroupedSalesLines(
		filters: ErpQueryFilters,
		includeDocTypes: string[],
		operationId: string,
	): Promise<Map<string, TblSalesLines[]>> {
		const baseCacheKey = this.buildBaseCacheKey('lines', filters, includeDocTypes);
		
		// Check if pre-grouped data is cached
		const cached = await this.cacheManager.get<Map<string, TblSalesLines[]>>(baseCacheKey);
		if (cached) {
			this.logger.log(`[${operationId}] ✅ Pre-grouped cache HIT - Using cached grouped data`);
			return cached;
		}
		
		this.logger.log(`[${operationId}] Pre-grouped cache MISS - Building grouped data from database...`);
		
		// Query all sales lines (without customer category filters)
		const query = this.salesLinesRepo
			.createQueryBuilder('line')
			.where('line.sale_date BETWEEN :startDate AND :endDate', {
				startDate: filters.startDate,
				endDate: filters.endDate,
			})
			.andWhere('line.doc_type IN (:...docTypes)', { docTypes: includeDocTypes });
		
		if (filters.storeCode) {
			query.andWhere('line.store = :store', { store: filters.storeCode });
		}
		
		if (filters.category) {
			query.andWhere('line.category = :category', { category: filters.category });
		}
		
		if (filters.salesPersonId) {
			const salesPersonIds = Array.isArray(filters.salesPersonId) 
				? filters.salesPersonId 
				: [filters.salesPersonId];
			query.andWhere('line.rep_code IN (:...salesPersonIds)', { salesPersonIds });
		}
		
		query.andWhere('line.item_code IS NOT NULL');
		query.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' });
		
		const lines = await query.getMany();
		
		// Get customer categories for each line
		const customerCodes = [...new Set(lines.map(l => l.customer).filter(Boolean))];
		const customerMap = new Map<string, string>();
		
		if (customerCodes.length > 0) {
			const customers = await this.customersRepo
				.createQueryBuilder('customer')
				.select('customer.Code', 'code')
				.addSelect('customer.Category', 'category')
				.where('customer.Code IN (:...codes)', { codes: customerCodes })
				.getRawMany();
			
			for (const cust of customers) {
				customerMap.set(cust.code, cust.category || 'NULL');
			}
		}
		
		// Group by customer category
		const grouped = new Map<string, TblSalesLines[]>();
		
		for (const line of lines) {
			const category = customerMap.get(line.customer) || 'NULL';
			if (!grouped.has(category)) {
				grouped.set(category, []);
			}
			grouped.get(category)!.push(line);
		}
		
		this.logger.log(`[${operationId}] Pre-grouped ${lines.length} lines into ${grouped.size} categories`);
		
		// Cache grouped data (10 minute TTL)
		await this.cacheManager.set(baseCacheKey, grouped, this.CACHE_TTL);
		
		return grouped;
	}

	/**
	 * ✅ PRE-FILTERING: Filter pre-grouped data by customer category
	 * Filters in-memory grouped data instead of querying database
	 */
	private filterPreGroupedData<T>(
		grouped: Map<string, T[]>,
		filters: ErpQueryFilters,
		operationId: string,
	): T[] {
		let results: T[] = [];
		
		if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
			// Include only specified categories
			for (const category of filters.includeCustomerCategories) {
				const categoryData = grouped.get(category) || [];
				results.push(...categoryData);
			}
			this.logger.log(`[${operationId}] ✅ Pre-filtered: Included ${filters.includeCustomerCategories.length} categories, ${results.length} records`);
		} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
			// ✅ FIXED: Exclude specified categories - properly remove sales from excluded categories
			const excludedCounts = new Map<string, number>();
			for (const [category, data] of grouped.entries()) {
				if (filters.excludeCustomerCategories.includes(category)) {
					// This category is excluded - skip it
					excludedCounts.set(category, data.length);
					this.logger.log(`[${operationId}] 🚫 Excluding category "${category}": ${data.length} records removed`);
				} else {
					// This category is NOT in exclusion list - include it
					results.push(...data);
				}
			}
			// Include NULL category (customers without category) - these should be included when excluding other categories
			if (grouped.has('NULL')) {
				results.push(...grouped.get('NULL')!);
			}
			const totalExcluded = Array.from(excludedCounts.values()).reduce((sum, count) => sum + count, 0);
			this.logger.log(`[${operationId}] ✅ Pre-filtered: Excluded ${filters.excludeCustomerCategories.length} categories (${totalExcluded} records removed), ${results.length} records remaining`);
		} else {
			// No category filter - return all
			for (const data of grouped.values()) {
				results.push(...data);
			}
		}
		
		return results;
	}

	/**
	 * ✅ PHASE 2: Calculate date range in days
	 */
	private calculateDateRangeDays(startDate: string, endDate: string): number {
		const start = new Date(startDate);
		const end = new Date(endDate);
		const diffTime = Math.abs(end.getTime() - start.getTime());
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		return diffDays;
	}

	/**
	 * ✅ PHASE 2: Split large date ranges into smaller chunks
	 * Returns array of date range chunks (max 15 days per chunk for faster queries)
	 */
	private splitDateRange(startDate: string, endDate: string, chunkSizeDays: number = 15): Array<{ startDate: string; endDate: string }> {
		const start = new Date(startDate);
		const end = new Date(endDate);
		const chunks: Array<{ startDate: string; endDate: string }> = [];
		
		let currentStart = new Date(start);
		
		while (currentStart < end) {
			const currentEnd = new Date(currentStart);
			currentEnd.setDate(currentEnd.getDate() + chunkSizeDays - 1);
			
			// Don't go past the end date
			if (currentEnd > end) {
				currentEnd.setTime(end.getTime());
			}
			
			chunks.push({
				startDate: currentStart.toISOString().split('T')[0],
				endDate: currentEnd.toISOString().split('T')[0],
			});
			
			currentStart = new Date(currentEnd);
			currentStart.setDate(currentStart.getDate() + 1);
		}
		
		return chunks;
	}

	/**
	 * ✅ PHASE 2: Log slow query warning
	 */
	private logSlowQuery(operationId: string, queryDuration: number, dateRangeDays: number, startDate: string, endDate: string): void {
		if (queryDuration > 5000) {
			this.logger.warn(`[${operationId}] ⚠️ Slow query detected: ${queryDuration}ms`);
			this.logger.warn(`[${operationId}] Date range: ${startDate} to ${endDate} (${dateRangeDays} days)`);
			this.logger.warn(`[${operationId}] Consider using date range chunking for ranges > 60 days`);
		}
	}

	/**
	 * Get sales headers by date range with optional filters
	 * Only returns Tax Invoices (doc_type = 1) by default
	 * ✅ PHASE 2: Supports date range chunking for large ranges (>60 days)
	 * 
	 * Sales Person Filtering: Uses tblsalesheader.sales_code field
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getSalesHeadersByDateRange(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<TblSalesHeader[]> {
		const operationId = this.generateOperationId('GET_HEADERS');
		const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}
		
		// ✅ PHASE 2: Use chunking for large date ranges (>60 days)
		if (dateRangeDays > 60) {
			this.logger.log(`[${operationId}] Large date range detected (${dateRangeDays} days) - using chunking`);
			return await this.getSalesHeadersBatched(filters, countryCode);
		}
		
		const cacheKey = this.buildCacheKey('headers', filters, ['1'], countryCode);

		this.logger.log(`[${operationId}] Starting getSalesHeadersByDateRange operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);
		this.logger.log(`[${operationId}] Cache key: ${cacheKey}`);

		const startTime = Date.now();

		try {
			// ✅ PRE-FILTERING: Check if customer category filters are present
			const hasCustomerCategoryFilters = (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) ||
				(filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0);
			
			if (hasCustomerCategoryFilters) {
				// ✅ PRE-FILTERING: Try to use pre-grouped cache first
				try {
					const grouped = await this.getPreGroupedSalesHeaders(filters, operationId);
					const filteredResults = this.filterPreGroupedData(grouped, filters, operationId);
					
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Pre-filtered cache used - Retrieved ${filteredResults.length} headers (${duration}ms)`);
					
					// Cache the filtered results for future requests
					await this.cacheManager.set(cacheKey, filteredResults, this.CACHE_TTL);
					
					return filteredResults;
				} catch (preFilterError) {
					this.logger.warn(`[${operationId}] Pre-filtering failed, falling back to DB query: ${preFilterError.message}`);
					// Fall through to existing DB query
				}
			}
			
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				this.logger.debug(`[${operationId}] Checking cache...`);
				const cached = await this.cacheManager.get<TblSalesHeader[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} headers (${duration}ms)`);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying database...`);
			this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);

			const queryStart = Date.now();
			
			// ✅ Execute with circuit breaker and timeout protection (adaptive timeout)
			const results = await this.executeQueryWithProtection(
				async () => {
					// ✅ Get repository for country
					const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);
					
					const query = salesHeaderRepo
						.createQueryBuilder('header');

					query.where('header.sale_date BETWEEN :startDate AND :endDate', {
						startDate: filters.startDate,
						endDate: filters.endDate,
					})
						// ✅ CRITICAL: Only Tax Invoices (doc_type = 1)
						.andWhere('header.doc_type = :docType', { docType: 1 });

					if (filters.storeCode) {
						this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
						query.andWhere('header.store = :store', { store: filters.storeCode });
					}

					if (filters.salesPersonId) {
						const salesPersonIds = Array.isArray(filters.salesPersonId) 
							? filters.salesPersonId 
							: [filters.salesPersonId];
						this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
						// Use sales_code from tblsalesheader for header queries
						query.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
					}

					// ✅ Customer category filtering using EXISTS to prevent row multiplication
					if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
						this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
						query.andWhere(
							`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
							{ includeCustomerCategories: filters.includeCustomerCategories }
						);
					} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
						this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
						this.logger.log(`[${operationId}] Filter logic: Removing sales lines where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
						// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
						query.andWhere(
							`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
							{ excludeCustomerCategories: filters.excludeCustomerCategories }
						);
					}

					return await query.getMany();
				},
				operationId,
				90000, // 90 second base timeout for headers
				dateRangeDays, // Pass date range for adaptive timeout
			);
			
			const queryDuration = Date.now() - queryStart;
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			this.logger.log(`[${operationId}] Database query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Retrieved ${results.length} sales headers`);

			// Cache results
			this.logger.debug(`[${operationId}] Caching results with TTL: ${this.CACHE_TTL}s`);
			await this.cacheManager.set(cacheKey, results, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return results;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics for remote debugging
			this.logger.error(`[${operationId}] ❌ Error fetching sales headers (${duration}ms)`);
			this.logger.error(`[${operationId}] Error Type: ${error.constructor?.name || 'Unknown'}`);
			this.logger.error(`[${operationId}] Error Message: ${error.message}`);
			this.logger.error(`[${operationId}] Error Code: ${error.code || 'N/A'}`);
			
			// Log connection state
			const poolInfo = this.getConnectionPoolInfo();
			this.logger.error(`[${operationId}] Connection Pool State: ${JSON.stringify(poolInfo)}`);
			this.logger.error(`[${operationId}] Circuit Breaker State: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Active Queries: ${this.activeQueries}/${this.MAX_CONCURRENT_QUERIES}`);
			
			// Log query parameters
			this.logger.error(`[${operationId}] Query Parameters: ${JSON.stringify({
				startDate: filters.startDate,
				endDate: filters.endDate,
				storeCode: filters.storeCode || 'all',
			})}`);
			
			this.logger.error(`[${operationId}] Stack Trace: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * ✅ PHASE 2: Get sales headers using batched processing for large date ranges
	 * Processes date range in chunks and combines results
	 * Note: This method bypasses chunking check to avoid infinite recursion
	 */
	private async getSalesHeadersBatched(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<TblSalesHeader[]> {
		const operationId = this.generateOperationId('GET_HEADERS_BATCHED');
		const chunks = this.splitDateRange(filters.startDate, filters.endDate, 30);
		
		this.logger.log(`[${operationId}] Processing ${chunks.length} date range chunks...`);
		
		const allResults: TblSalesHeader[] = [];
		
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			this.logger.log(`[${operationId}] Processing chunk ${i + 1}/${chunks.length}: ${chunk.startDate} to ${chunk.endDate}`);
			
			const chunkFilters: ErpQueryFilters = {
				...filters,
				startDate: chunk.startDate,
				endDate: chunk.endDate,
			};
			
			// Directly call the internal query method to avoid chunking check recursion
			const chunkCacheKey = this.buildCacheKey('headers', chunkFilters, ['1'], countryCode);
			
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = chunkFilters.excludeCustomerCategories && chunkFilters.excludeCustomerCategories.length > 0;
			const cached = hasExclusionFilters ? null : await this.cacheManager.get<TblSalesHeader[]>(chunkCacheKey);
			
			if (cached) {
				this.logger.log(`[${operationId}] Chunk ${i + 1} cache HIT: ${cached.length} records`);
				allResults.push(...cached);
			} else {
				if (hasExclusionFilters) {
					this.logger.log(`[${operationId}] Chunk ${i + 1} cache BYPASSED - Exclusion filters detected`);
				}
				// Query directly without chunking check (chunks are already small)
				const chunkDateRangeDays = this.calculateDateRangeDays(chunkFilters.startDate, chunkFilters.endDate);
				const chunkResults = await this.executeQueryWithProtection(
					async () => {
						// ✅ Get repository for country
						const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);
						
						const query = salesHeaderRepo
							.createQueryBuilder('header');

						query.where('header.sale_date BETWEEN :startDate AND :endDate', {
							startDate: chunkFilters.startDate,
							endDate: chunkFilters.endDate,
						})
							.andWhere('header.doc_type = :docType', { docType: 1 });

						if (chunkFilters.storeCode) {
							query.andWhere('header.store = :store', { store: chunkFilters.storeCode });
						}

						if (chunkFilters.salesPersonId) {
							const salesPersonIds = Array.isArray(chunkFilters.salesPersonId) 
								? chunkFilters.salesPersonId 
								: [chunkFilters.salesPersonId];
							// Use sales_code from tblsalesheader for header queries
							query.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
						}

						// ✅ Customer category filtering using EXISTS to prevent row multiplication
						if (chunkFilters.includeCustomerCategories && chunkFilters.includeCustomerCategories.length > 0) {
							query.andWhere(
								`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
								{ includeCustomerCategories: chunkFilters.includeCustomerCategories }
							);
						} else if (chunkFilters.excludeCustomerCategories && chunkFilters.excludeCustomerCategories.length > 0) {
							query.andWhere(
								`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
								{ excludeCustomerCategories: chunkFilters.excludeCustomerCategories }
							);
						}

						return await query.getMany();
					},
					operationId,
					90000,
					chunkDateRangeDays, // Adaptive timeout for chunk
				);
				
				await this.cacheManager.set(chunkCacheKey, chunkResults, this.CACHE_TTL);
				allResults.push(...chunkResults);
				this.logger.log(`[${operationId}] Chunk ${i + 1} completed: ${chunkResults.length} records`);
			}
		}
		
		this.logger.log(`[${operationId}] ✅ Batched processing complete: ${allResults.length} total records`);
		return allResults;
	}

	/**
	 * Get sales lines by date range with doc_type filtering
	 *
	 * @param filters - Query filters
	 * @param includeDocTypes - Document types to include (defaults to Tax Invoices only)
	 * @param countryCode - Country code for database switching (defaults to 'SA')
	 * @returns Sales lines matching criteria
	 * ✅ PHASE 2: Supports date range chunking for large ranges (>60 days)
	 * 
	 * Sales Person Filtering: Uses tblsaleslines.rep_code field directly (not joined with header)
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getSalesLinesByDateRange(
		filters: ErpQueryFilters,
		includeDocTypes: string[] = ['1'], // Default: Tax Invoices only
		countryCode: string = 'SA',
	): Promise<TblSalesLines[]> {
		const operationId = this.generateOperationId('GET_LINES');
		const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}
		
		// ✅ PHASE 2: Use chunking for large date ranges (>60 days)
		if (dateRangeDays > 60) {
			this.logger.log(`[${operationId}] Large date range detected (${dateRangeDays} days) - using chunking`);
			return await this.getSalesLinesBatched(filters, includeDocTypes, countryCode);
		}
		
		const cacheKey = this.buildCacheKey('lines', filters, includeDocTypes, countryCode);

		this.logger.log(`[${operationId}] Starting getSalesLinesByDateRange operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);
		this.logger.log(`[${operationId}] Doc Types: ${includeDocTypes.join(',')}`);
		this.logger.log(`[${operationId}] Cache key: ${cacheKey}`);

		const startTime = Date.now();

		try {
			// ✅ PRE-FILTERING: Check if customer category filters are present
			const hasCustomerCategoryFilters = (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) ||
				(filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0);
			
			if (hasCustomerCategoryFilters) {
				// ✅ PRE-FILTERING: Try to use pre-grouped cache first
				try {
					const grouped = await this.getPreGroupedSalesLines(filters, includeDocTypes, operationId);
					const filteredResults = this.filterPreGroupedData(grouped, filters, operationId);
					
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Pre-filtered cache used - Retrieved ${filteredResults.length} lines (${duration}ms)`);
					
					// Cache the filtered results for future requests
					await this.cacheManager.set(cacheKey, filteredResults, this.CACHE_TTL);
					
					return filteredResults;
				} catch (preFilterError) {
					this.logger.warn(`[${operationId}] Pre-filtering failed, falling back to DB query: ${preFilterError.message}`);
					// Fall through to existing DB query
				}
			}
			
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get<TblSalesLines[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} lines (${duration}ms)`);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying database...`);

			const queryStart = Date.now();
			
			// ✅ Execute with circuit breaker and timeout protection (adaptive timeout)
			const results = await this.executeQueryWithProtection(
				async () => {
					// ✅ Get repository for country
					const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
					
					const query = salesLinesRepo
						.createQueryBuilder('line');

					query.where('line.sale_date BETWEEN :startDate AND :endDate', {
						startDate: filters.startDate,
						endDate: filters.endDate,
					})
						// ✅ CRITICAL: Filter by document type
						.andWhere('line.doc_type IN (:...docTypes)', { docTypes: includeDocTypes });

					// Apply additional filters
					if (filters.storeCode) {
						this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
						query.andWhere('line.store = :store', { store: filters.storeCode });
					}

					if (filters.category) {
						this.logger.debug(`[${operationId}] Filtering by category: ${filters.category}`);
						query.andWhere('line.category = :category', { category: filters.category });
					}

					// ✅ Sales person filtering: Use rep_code directly from tblsaleslines
					if (filters.salesPersonId) {
						const salesPersonIds = Array.isArray(filters.salesPersonId) 
							? filters.salesPersonId 
							: [filters.salesPersonId];
						this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
						query.andWhere('line.rep_code IN (:...salesPersonIds)', { salesPersonIds });
					}

					// ✅ Customer category filtering using EXISTS to prevent row multiplication
					if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
						this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
						query.andWhere(
							`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...includeCustomerCategories))`,
							{ includeCustomerCategories: filters.includeCustomerCategories }
						);
					} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
						this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
						this.logger.log(`[${operationId}] Filter logic: Removing sales lines where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
						// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
						query.andWhere(
							`(line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
							{ excludeCustomerCategories: filters.excludeCustomerCategories }
						);
					}

					// ✅ Data quality filters - using gross amounts (incl_line_total) without discount subtraction
					query.andWhere('line.item_code IS NOT NULL');
					query.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' });
					// ✅ CRITICAL: Only inventory items (type = 'I') - matches sales query
					query.andWhere('line.type = :type', { type: 'I' });

					return await query.getMany();
				},
				operationId,
				120000, // 120 second base timeout for lines
				dateRangeDays, // Pass date range for adaptive timeout
			);
			
			const queryDuration = Date.now() - queryStart;
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			this.logger.log(`[${operationId}] Database query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Retrieved ${results.length} sales lines`);
			this.logger.log(`[${operationId}] Doc types included: ${includeDocTypes.join(', ')}`);

			// Cache results
			await this.cacheManager.set(cacheKey, results, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return results;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics for remote debugging
			this.logger.error(`[${operationId}] ❌ Error fetching sales lines (${duration}ms)`);
			this.logger.error(`[${operationId}] Error Type: ${error.constructor?.name || 'Unknown'}`);
			this.logger.error(`[${operationId}] Error Message: ${error.message}`);
			this.logger.error(`[${operationId}] Error Code: ${error.code || 'N/A'}`);
			
			// Log connection state
			const poolInfo = this.getConnectionPoolInfo();
			this.logger.error(`[${operationId}] Connection Pool State: ${JSON.stringify(poolInfo)}`);
			this.logger.error(`[${operationId}] Circuit Breaker State: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Active Queries: ${this.activeQueries}/${this.MAX_CONCURRENT_QUERIES}`);
			
			// Log query parameters
			this.logger.error(`[${operationId}] Query Parameters: ${JSON.stringify({
				startDate: filters.startDate,
				endDate: filters.endDate,
				storeCode: filters.storeCode || 'all',
				category: filters.category || 'all',
				docTypes: includeDocTypes,
			})}`);
			
			this.logger.error(`[${operationId}] Stack Trace: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * ✅ PHASE 2: Get sales lines using batched processing for large date ranges
	 * Processes date range in chunks and combines results
	 * Note: This method bypasses chunking check to avoid infinite recursion
	 */
	private async getSalesLinesBatched(
		filters: ErpQueryFilters,
		includeDocTypes: string[],
		countryCode: string = 'SA',
	): Promise<TblSalesLines[]> {
		const operationId = this.generateOperationId('GET_LINES_BATCHED');
		const chunks = this.splitDateRange(filters.startDate, filters.endDate, 30);
		
		this.logger.log(`[${operationId}] Processing ${chunks.length} date range chunks...`);
		
		const allResults: TblSalesLines[] = [];
		
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			this.logger.log(`[${operationId}] Processing chunk ${i + 1}/${chunks.length}: ${chunk.startDate} to ${chunk.endDate}`);
			
			const chunkFilters: ErpQueryFilters = {
				...filters,
				startDate: chunk.startDate,
				endDate: chunk.endDate,
			};
			
			// Directly call the internal query method to avoid chunking check recursion
			const chunkCacheKey = this.buildCacheKey('lines', chunkFilters, includeDocTypes, countryCode);
			
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = chunkFilters.excludeCustomerCategories && chunkFilters.excludeCustomerCategories.length > 0;
			const cached = hasExclusionFilters ? null : await this.cacheManager.get<TblSalesLines[]>(chunkCacheKey);
			
			if (cached) {
				this.logger.log(`[${operationId}] Chunk ${i + 1} cache HIT: ${cached.length} records`);
				allResults.push(...cached);
			} else {
				if (hasExclusionFilters) {
					this.logger.log(`[${operationId}] Chunk ${i + 1} cache BYPASSED - Exclusion filters detected`);
				}
				// Query directly without chunking check (chunks are already small)
				const chunkDateRangeDays = this.calculateDateRangeDays(chunkFilters.startDate, chunkFilters.endDate);
				const chunkResults = await this.executeQueryWithProtection(
					async () => {
						// ✅ Get repository for country
						const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
						
						const query = salesLinesRepo
							.createQueryBuilder('line');

						query.where('line.sale_date BETWEEN :startDate AND :endDate', {
							startDate: chunkFilters.startDate,
							endDate: chunkFilters.endDate,
						})
							.andWhere('line.doc_type IN (:...docTypes)', { docTypes: includeDocTypes });

						if (chunkFilters.storeCode) {
							query.andWhere('line.store = :store', { store: chunkFilters.storeCode });
						}

						if (chunkFilters.category) {
							query.andWhere('line.category = :category', { category: chunkFilters.category });
						}

						if (chunkFilters.salesPersonId) {
							const salesPersonIds = Array.isArray(chunkFilters.salesPersonId) 
								? chunkFilters.salesPersonId 
								: [chunkFilters.salesPersonId];
							// Use rep_code directly from tblsaleslines
							query.andWhere('line.rep_code IN (:...salesPersonIds)', { salesPersonIds });
						}

						// ✅ Customer category filtering using EXISTS to prevent row multiplication
						if (chunkFilters.includeCustomerCategories && chunkFilters.includeCustomerCategories.length > 0) {
							query.andWhere(
								`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...includeCustomerCategories))`,
								{ includeCustomerCategories: chunkFilters.includeCustomerCategories }
							);
						} else if (chunkFilters.excludeCustomerCategories && chunkFilters.excludeCustomerCategories.length > 0) {
							query.andWhere(
								`(line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
								{ excludeCustomerCategories: chunkFilters.excludeCustomerCategories }
							);
						}

						query.andWhere('line.item_code IS NOT NULL');
						query.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' });

						return await query.getMany();
					},
					operationId,
					120000,
					chunkDateRangeDays, // Adaptive timeout for chunk
				);
				
				await this.cacheManager.set(chunkCacheKey, chunkResults, this.CACHE_TTL);
				allResults.push(...chunkResults);
				this.logger.log(`[${operationId}] Chunk ${i + 1} completed: ${chunkResults.length} records`);
			}
		}
		
		this.logger.log(`[${operationId}] ✅ Batched processing complete: ${allResults.length} total records`);
		return allResults;
	}

	/**
	 * Get credit notes (returns/refunds) by date range
	 *
	 * @param filters - Query filters
	 * @returns Credit note lines
	 */
	async getCreditNotesByDateRange(filters: ErpQueryFilters): Promise<TblSalesLines[]> {
		const operationId = this.generateOperationId('GET_CREDIT_NOTES');
		this.logger.log(`[${operationId}] Fetching credit notes for ${filters.startDate} to ${filters.endDate}`);

		// Use doc_type = '2' for credit notes
		return this.getSalesLinesByDateRange(filters, ['2']);
	}

	/**
	 * Get sales lines with customer category information
	 * Uses LEFT JOINs to link tblsaleslines → tblcustomers → tblcustomercategories
	 * 
	 * Relationship chain:
	 * - tblsaleslines.customer → tblcustomers.Code
	 * - tblcustomers.Category → tblcustomercategories.cust_cat_code
	 * 
	 * @param filters - Query filters (supports customerCategoryCode and customerCategoryDescription filters)
	 * @param includeDocTypes - Document types to include (default: ['1'] for Tax Invoices)
	 * @param countryCode - Country code for database switching (defaults to 'SA')
	 * @returns Sales lines with customer category code and description
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getSalesLinesWithCustomerCategories(
		filters: ErpQueryFilters,
		includeDocTypes: string[] = ['1'], // Default: Tax Invoices only
		countryCode: string = 'SA',
	): Promise<TblSalesLinesWithCategory[]> {
		const operationId = this.generateOperationId('GET_LINES_WITH_CATEGORY');
		const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}
		
		// ✅ PHASE 2: Use chunking for large date ranges (>60 days)
		if (dateRangeDays > 60) {
			this.logger.log(`[${operationId}] Large date range detected (${dateRangeDays} days) - using chunking`);
			return await this.getSalesLinesWithCustomerCategoriesBatched(filters, includeDocTypes, countryCode);
		}
		
		const cacheKey = this.buildCacheKey('lines_with_category', filters, includeDocTypes, countryCode);

		this.logger.log(`[${operationId}] Starting getSalesLinesWithCustomerCategories operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);
		this.logger.log(`[${operationId}] Doc Types: ${includeDocTypes.join(',')}`);
		this.logger.log(`[${operationId}] Cache key: ${cacheKey}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get<TblSalesLinesWithCategory[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} lines (${duration}ms)`);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying database...`);

			const queryStart = Date.now();
			
			// ✅ Execute with circuit breaker and timeout protection (adaptive timeout)
			const results = await this.executeQueryWithProtection(
				async () => {
					// ✅ Get repository for country
					const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
					
					// Get all column names from the entity metadata for explicit selection
					const lineColumns = salesLinesRepo.metadata.columns.map(col => `line.${col.databaseName} as line_${col.propertyName}`);
					
					const query = salesLinesRepo
						.createQueryBuilder('line')
						.leftJoin('tblcustomers', 'customer', 'line.customer = customer.Code')
						.leftJoin('tblcustomercategories', 'category', 'customer.Category = category.cust_cat_code')
						.select(lineColumns.join(', '))
						.addSelect('customer.Category', 'customer_category_code')
						.addSelect('category.cust_cat_description', 'customer_category_description')
						.where('line.sale_date BETWEEN :startDate AND :endDate', {
							startDate: filters.startDate,
							endDate: filters.endDate,
						})
						// ✅ CRITICAL: Filter by document type
						.andWhere('line.doc_type IN (:...docTypes)', { docTypes: includeDocTypes });

					// Apply additional filters
					if (filters.storeCode) {
						this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
						query.andWhere('line.store = :store', { store: filters.storeCode });
					}

					if (filters.category) {
						this.logger.debug(`[${operationId}] Filtering by category: ${filters.category}`);
						query.andWhere('line.category = :category', { category: filters.category });
					}

					// ✅ Sales person filtering: Use rep_code directly from tblsaleslines
					if (filters.salesPersonId) {
						const salesPersonIds = Array.isArray(filters.salesPersonId) 
							? filters.salesPersonId 
							: [filters.salesPersonId];
						this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
						query.andWhere('line.rep_code IN (:...salesPersonIds)', { salesPersonIds });
					}

					// ✅ Customer category code filtering (legacy single category)
					if (filters.customerCategoryCode) {
						this.logger.debug(`[${operationId}] Filtering by customer category code: ${filters.customerCategoryCode}`);
						query.andWhere('customer.Category = :customerCategoryCode', { customerCategoryCode: filters.customerCategoryCode });
					}

					// ✅ Customer category description filtering
					if (filters.customerCategoryDescription) {
						this.logger.debug(`[${operationId}] Filtering by customer category description: ${filters.customerCategoryDescription}`);
						query.andWhere('category.cust_cat_description = :customerCategoryDescription', { customerCategoryDescription: filters.customerCategoryDescription });
					}

					// ✅ Include customer categories (IN filter)
					if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
						this.logger.debug(`[${operationId}] Including customer categories: ${filters.includeCustomerCategories.join(', ')}`);
						query.andWhere('customer.Category IN (:...includeCustomerCategories)', { includeCustomerCategories: filters.includeCustomerCategories });
					}

					// ✅ Exclude customer categories (NOT IN filter)
					if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
						this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
						this.logger.log(`[${operationId}] Filter logic: Removing sales lines where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
						// ✅ FIXED: Properly exclude sales lines where customer category is in exclusion list
						// Include NULL categories (customers without category assignment) but exclude specified categories
						query.andWhere('(customer.Category IS NULL OR customer.Category NOT IN (:...excludeCustomerCategories))', { excludeCustomerCategories: filters.excludeCustomerCategories });
					}

					// ✅ Data quality filters
					query.andWhere('line.item_code IS NOT NULL');
					query.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' });

					const rawResults = await query.getRawMany();
					
					// Map raw results to TblSalesLinesWithCategory interface
					// Remove 'line_' prefix from aliased fields and map to proper property names
					return rawResults.map((row: any) => {
						const mappedRow: any = {
							customer_category_code: row.customer_category_code || null,
							customer_category_description: row.customer_category_description || null,
						};
						
						// Map all line fields (remove 'line_' prefix from aliases)
						salesLinesRepo.metadata.columns.forEach(col => {
							const aliasKey = `line_${col.propertyName}`;
							if (row[aliasKey] !== undefined) {
								mappedRow[col.propertyName] = row[aliasKey];
							}
						});
						
						return mappedRow;
					}) as TblSalesLinesWithCategory[];
				},
				operationId,
				120000, // 120 second base timeout for lines
				dateRangeDays, // Pass date range for adaptive timeout
			);
			
			const queryDuration = Date.now() - queryStart;
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			this.logger.log(`[${operationId}] Database query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Retrieved ${results.length} sales lines with customer categories`);
			this.logger.log(`[${operationId}] Doc types included: ${includeDocTypes.join(', ')}`);

			// Log data quality warnings
			const linesWithCategory = results.filter(r => r.customer_category_description).length;
			const linesWithoutCategory = results.length - linesWithCategory;
			if (linesWithoutCategory > 0) {
				this.logger.warn(`[${operationId}] ⚠️ ${linesWithoutCategory} sales lines have no customer category (customer not found or category missing)`);
			}

			// Cache results
			await this.cacheManager.set(cacheKey, results, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return results;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics for remote debugging
			this.logger.error(`[${operationId}] ❌ Error fetching sales lines with customer categories (${duration}ms)`);
			this.logger.error(`[${operationId}] Error Type: ${error.constructor?.name || 'Unknown'}`);
			this.logger.error(`[${operationId}] Error Message: ${error.message}`);
			this.logger.error(`[${operationId}] Error Code: ${error.code || 'N/A'}`);
			
			// Log connection state
			const poolInfo = this.getConnectionPoolInfo();
			this.logger.error(`[${operationId}] Connection Pool State: ${JSON.stringify(poolInfo)}`);
			this.logger.error(`[${operationId}] Circuit Breaker State: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Active Queries: ${this.activeQueries}/${this.MAX_CONCURRENT_QUERIES}`);
			
			// Log query parameters
			this.logger.error(`[${operationId}] Query Parameters: ${JSON.stringify({
				startDate: filters.startDate,
				endDate: filters.endDate,
				storeCode: filters.storeCode || 'all',
				category: filters.category || 'all',
				customerCategoryCode: filters.customerCategoryCode || 'all',
				customerCategoryDescription: filters.customerCategoryDescription || 'all',
				docTypes: includeDocTypes,
			})}`);
			
			this.logger.error(`[${operationId}] Stack Trace: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * ✅ PHASE 2: Get sales lines with customer categories using batched processing for large date ranges
	 * Processes date range in chunks and combines results
	 */
	private async getSalesLinesWithCustomerCategoriesBatched(
		filters: ErpQueryFilters,
		includeDocTypes: string[],
		countryCode: string = 'SA',
	): Promise<TblSalesLinesWithCategory[]> {
		const operationId = this.generateOperationId('GET_LINES_WITH_CATEGORY_BATCHED');
		const chunks = this.splitDateRange(filters.startDate, filters.endDate, 30);
		
		this.logger.log(`[${operationId}] Processing ${chunks.length} date range chunks...`);
		
		const allResults: TblSalesLinesWithCategory[] = [];
		
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			this.logger.log(`[${operationId}] Processing chunk ${i + 1}/${chunks.length}: ${chunk.startDate} to ${chunk.endDate}`);
			
			const chunkFilters: ErpQueryFilters = {
				...filters,
				startDate: chunk.startDate,
				endDate: chunk.endDate,
			};
			
			// Recursively call the main method (it will skip chunking check since chunks are small)
			const chunkResults = await this.getSalesLinesWithCustomerCategories(chunkFilters, includeDocTypes, countryCode);
			allResults.push(...chunkResults);
		}
		
		this.logger.log(`[${operationId}] ✅ Batched processing complete: ${allResults.length} total records`);
		return allResults;
	}

	/**
	 * Get daily aggregations - optimized query
	 * 
	 * ✅ REVISED: Now uses tblsalesheader.total_incl for revenue calculation
	 * Uses doc_type IN (1, 2) - Tax Invoices and Credit Notes
	 * 
	 * Sales Person Filtering: Uses tblsalesheader.sales_code field
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getDailyAggregations(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<DailyAggregation[]> {
		const operationId = this.generateOperationId('GET_DAILY_AGG');
		const cacheKey = this.buildCacheKey('daily_agg', filters, undefined, countryCode);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Starting getDailyAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get<DailyAggregation[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(
						`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} aggregations (${duration}ms)`,
					);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing daily aggregations...`);

			const queryStart = Date.now();
			const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
			
			// ✅ REVISED: Use tblsalesheader instead of tblsaleslines
			// Sum total_incl - total_tax for revenue (exclusive of tax), count transactions and customers
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication

			// ✅ Get repository for country
			const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);
			
			const query = salesHeaderRepo
				.createQueryBuilder('header');

			query.select([
				'DATE(header.sale_date) as date',
				'header.store as store',
				'SUM(header.total_incl) - SUM(header.total_tax) as totalRevenue', // ✅ Subtract tax: matches SQL query exactly
				'CAST(0 AS DECIMAL(19,2)) as totalCost', // Cost not available in header table
				'COUNT(DISTINCT header.doc_number) as transactionCount',
				'COUNT(DISTINCT header.customer) as uniqueCustomers',
				'0 as totalQuantity', // Quantity not available in header table (integer)
			])
				.where('header.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2) for revenue calculations
				.andWhere('header.doc_type IN (:...docTypes)', { docTypes: [1, 2] })
				.andWhere('header.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('DATE(header.sale_date), header.store')
				.orderBy('DATE(header.sale_date)', 'ASC')
				.limit(10000); // ✅ PHASE 2: Max 10k records per aggregation

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('header.store = :store', { store: filters.storeCode });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use sales_code from tblsalesheader for header queries
				query.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			}

			if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				this.logger.log(`[${operationId}] Filter logic: Excluding sales where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
				// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
				// Include NULL customers and customers without matching excluded categories
				query.andWhere(
					`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;
			
			// Log detailed results for debugging exclusion filters
			if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				const totalRevenueAfterFilter = results.reduce((sum, r) => sum + (parseFloat(r.totalRevenue) || 0), 0);
				const totalTransactionsAfterFilter = results.reduce((sum, r) => sum + (parseInt(r.transactionCount, 10) || 0), 0);
				this.logger.log(`[${operationId}] 📊 After exclusion filter: ${results.length} aggregations, Total Revenue: R${totalRevenueAfterFilter.toFixed(2)}, Total Transactions: ${totalTransactionsAfterFilter}`);
				if (results.length > 0 && results.length <= 10) {
					results.forEach((agg, idx) => {
						this.logger.log(`[${operationId}]   [${idx + 1}] Date: ${agg.date} | Store: ${agg.store} | Revenue: R${parseFloat(agg.totalRevenue || 0).toFixed(2)} | Transactions: ${parseInt(agg.transactionCount, 10) || 0}`);
					});
				}
			}
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			// Process results to ensure correct types
			const processedResults = results.map((row) => ({
				date: row.date,
				store: row.store,
				totalRevenue: parseFloat(row.totalRevenue) || 0,
				totalCost: 0, // Not available from header table
				transactionCount: parseInt(row.transactionCount, 10) || 0,
				uniqueCustomers: parseInt(row.uniqueCustomers, 10) || 0,
				totalQuantity: 0, // Not available from header table
			}));

			this.logger.log(`[${operationId}] Aggregation query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Computed ${processedResults.length} daily aggregations`);

			// Cache results
			await this.cacheManager.set(cacheKey, processedResults, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return processedResults;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics
			this.logger.error(`[${operationId}] ❌ Error computing daily aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			this.logger.error(`[${operationId}] Circuit Breaker: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Connection Pool: ${JSON.stringify(this.getConnectionPoolInfo())}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * Get branch aggregations - optimized query
	 * 
	 * ✅ REVISED: Uses tblsalesheader instead of tblsaleslines
	 * Revenue calculation: SUM(total_incl) - SUM(total_tax) grouped by store
	 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
	 * Sales Person Filtering: Uses tblsalesheader.sales_code field
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getBranchAggregations(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<BranchAggregation[]> {
		const operationId = this.generateOperationId('GET_BRANCH_AGG');
		const cacheKey = this.buildCacheKey('branch_agg', filters, undefined, countryCode);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Starting getBranchAggregations operation`);
		this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get<BranchAggregation[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(
						`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} branch aggregations (${duration}ms)`,
					);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing branch aggregations...`);

			const queryStart = Date.now();
			const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
			
			// ✅ REVISED: Use tblsalesheader instead of tblsaleslines
			// Sum total_incl - total_tax for revenue (exclusive of tax), grouped by store
			// Matches SQL: SELECT store, SUM(total_incl) - SUM(total_tax) AS total_sum FROM tblsalesheader WHERE doc_type IN (1, 2) GROUP BY store
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication

			// ✅ Get repository for country
			const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);
			
			const query = salesHeaderRepo
				.createQueryBuilder('header');

			query.select([
				'header.store as store',
				'SUM(header.total_incl) - SUM(header.total_tax) as totalRevenue', // ✅ Subtract tax: matches SQL query exactly
				'CAST(0 AS DECIMAL(19,2)) as totalCost', // Cost not available in header table
				'COUNT(DISTINCT header.doc_number) as transactionCount',
				'COUNT(DISTINCT header.customer) as uniqueCustomers',
				'0 as totalQuantity', // Quantity not available in header table (integer)
			])
				.where('header.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2) for revenue calculations
				.andWhere('header.doc_type IN (:...docTypes)', { docTypes: [1, 2] })
				.andWhere('header.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('header.store')
				.orderBy('totalRevenue', 'DESC')
				.limit(10000); // ✅ PHASE 2: Max 10k records per aggregation

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('header.store = :store', { store: filters.storeCode });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use sales_code from tblsalesheader for header queries
				query.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			}

			if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				this.logger.log(`[${operationId}] Filter logic: Removing sales where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
				// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
				query.andWhere(
					`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			this.logger.log(`[${operationId}] Aggregation query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Computed ${results.length} branch aggregations`);

			// Cache results
			await this.cacheManager.set(cacheKey, results, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return results;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics
			this.logger.error(`[${operationId}] ❌ Error computing branch aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			this.logger.error(`[${operationId}] Circuit Breaker: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Connection Pool: ${JSON.stringify(this.getConnectionPoolInfo())}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * Get sales person aggregations - optimized query
	 * 
	 * ✅ REVISED: Uses tblsalesheader instead of tblsaleslines
	 * Revenue calculation: SUM(total_incl) - SUM(total_tax) grouped by sales_code
	 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
	 * Groups by sales_code to show how much each sales rep sold
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getSalesPersonAggregations(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<SalesPersonAggregation[]> {
		const operationId = this.generateOperationId('GET_SALES_PERSON_AGG');
		const cacheKey = this.buildCacheKey('sales_person_agg', filters, undefined, countryCode);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Starting getSalesPersonAggregations operation`);
		this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get<SalesPersonAggregation[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(
						`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} sales person aggregations (${duration}ms)`,
					);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing sales person aggregations...`);

			const queryStart = Date.now();
			const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
			
			// ✅ REVISED: Use tblsaleslines with JOIN to tblsalesman (matches user's SQL query exactly)
			// Matches SQL: SELECT m.Description as rep, SUM(incl_line_total - tax) as total 
			//              FROM tblsaleslines AS s JOIN tblsalesman AS m ON s.rep_code = m.code
			//              WHERE doc_type IN (1, 2) AND s.type = 'I'
			//              GROUP BY s.rep_code
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN for customer category filtering to prevent row multiplication

			// ✅ Get repository for country - use tblsaleslines instead of tblsalesheader
			const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
			
			const query = salesLinesRepo
				.createQueryBuilder('line')
				// ✅ LEFT JOIN with tblsalesman to get rep name (no filtering by crm_uid)
				.leftJoin('tblsalesman', 'salesman', 'line.rep_code = salesman.Code');

			query.select([
				'line.rep_code as salesCode',
				'salesman.Description as salesName',
				'SUM(line.incl_line_total - line.tax) as totalRevenue', // ✅ Exact match: SUM(incl_line_total - tax)
				'CAST(0 AS DECIMAL(19,2)) as totalCost', // Cost not available in lines table
				'COUNT(DISTINCT line.doc_number) as transactionCount',
				'COUNT(DISTINCT line.customer) as uniqueCustomers',
				'SUM(line.quantity) as totalQuantity', // Quantity available in lines table
			])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2) for revenue calculations
				.andWhere('line.doc_type IN (:...docTypes)', { docTypes: [1, 2] })
				// ✅ CRITICAL: Only inventory items (type = 'I') - matches user's SQL query
				.andWhere('line.type = :type', { type: 'I' })
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' })
				.andWhere('line.rep_code IS NOT NULL')
				.andWhere('line.rep_code != :empty', { empty: '' })
				.andWhere('line.item_code IS NOT NULL') // Data quality filter
				.groupBy('line.rep_code')
				.orderBy('totalRevenue', 'DESC')
				.limit(10000); // ✅ PHASE 2: Max 10k records per aggregation

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('line.store = :store', { store: filters.storeCode });
			}

			// Filter by salesPersonId using rep_code from tblsaleslines
			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use rep_code from tblsaleslines
				query.andWhere('line.rep_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				this.logger.log(`[${operationId}] Filter logic: Removing sales where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
				// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
				query.andWhere(
					`(line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			const results = await this.executeQueryWithProtection(
				async () => query.getRawMany(),
				operationId,
				120000, // 120 second base timeout
				dateRangeDays, // Adaptive timeout
			);
			const queryDuration = Date.now() - queryStart;
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			// Process results to ensure correct types
			// ✅ salesName is already included from the JOIN, so we don't need to fetch it separately
			const processedResults = results.map((row) => ({
				salesCode: row.salesCode || 'UNKNOWN',
				salesName: row.salesName || row.salesCode || 'UNKNOWN', // ✅ Already included from JOIN
				totalRevenue: parseFloat(row.totalRevenue) || 0,
				totalCost: 0, // Not available from lines table
				transactionCount: parseInt(row.transactionCount, 10) || 0,
				uniqueCustomers: parseInt(row.uniqueCustomers, 10) || 0,
				totalQuantity: parseFloat(row.totalQuantity) || 0, // ✅ Available from lines table
			}));

			// ✅ Sales rep names are already included from the JOIN, no need to fetch separately
			const resultsWithNames = processedResults;

			this.logger.log(`[${operationId}] Aggregation query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Computed ${resultsWithNames.length} sales person aggregations`);

			// Cache results
			await this.cacheManager.set(cacheKey, resultsWithNames, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return resultsWithNames;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics
			this.logger.error(`[${operationId}] ❌ Error computing sales person aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			this.logger.error(`[${operationId}] Circuit Breaker: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Connection Pool: ${JSON.stringify(this.getConnectionPoolInfo())}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * Get category aggregations - optimized query
	 * 
	 * Sales Person Filtering: Uses tblsaleslines.rep_code field directly
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getCategoryAggregations(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<CategoryAggregation[]> {
		const operationId = this.generateOperationId('GET_CATEGORY_AGG');
		const cacheKey = this.buildCacheKey('category_agg', filters, undefined, countryCode);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Starting getCategoryAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get<CategoryAggregation[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(
						`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} category aggregations (${duration}ms)`,
					);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing category aggregations...`);

			const queryStart = Date.now();
			const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
			
			// ✅ Sales by category - aggregated across all stores (totals per category)
			// ✅ Revenue excludes tax: SUM(incl_line_total) - SUM(tax)
			// ✅ Query matches: SELECT line.category, SUM(line.incl_line_total) - SUM(tax) as totalRevenue, ...
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication

			// ✅ Get repository for country
			const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
			
			const query = salesLinesRepo
				.createQueryBuilder('line');

			query.select([
				'line.category as category',
				'SUM(line.incl_line_total) - SUM(line.tax) as totalRevenue',
				'SUM(line.cost_price * line.quantity) as totalCost',
				'SUM(line.quantity) as totalQuantity',
			])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				.andWhere('line.doc_type IN (:...docTypes)', { docTypes: [1, 2] })
				.andWhere('line.item_code NOT IN (:...excludedItemCodes)', { excludedItemCodes: ['.'] })
				.andWhere('line.type = :type', { type: 'I' })
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' });

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			}

			if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				this.logger.log(`[${operationId}] Filter logic: Removing sales where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
				// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
				query.andWhere(
					`(line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			// ✅ Sales person filtering: Use rep_code directly from tblsaleslines
			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				query.andWhere('line.rep_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			query.groupBy('line.category');

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			this.logger.log(`[${operationId}] Aggregation query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Computed ${results.length} category aggregations`);

			// Cache results
			await this.cacheManager.set(cacheKey, results, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return results;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics
			this.logger.error(`[${operationId}] ❌ Error computing category aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			this.logger.error(`[${operationId}] Circuit Breaker: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Connection Pool: ${JSON.stringify(this.getConnectionPoolInfo())}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * Get branch × category aggregations - combines store and category performance
	 * 
	 * ✅ NEW: Uses tblsaleslines for category data (category is only in lines table)
	 * Revenue calculation: SUM(incl_line_total) - SUM(tax) grouped by store and category
	 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
	 * This provides Branch X Category performance metrics
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getBranchCategoryAggregations(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<BranchCategoryAggregation[]> {
		const operationId = this.generateOperationId('GET_BRANCH_CATEGORY_AGG');
		const cacheKey = this.buildCacheKey('branch_category_agg', filters, undefined, countryCode);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Starting getBranchCategoryAggregations operation`);
		this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get<BranchCategoryAggregation[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(
						`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} branch-category aggregations (${duration}ms)`,
					);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing branch-category aggregations...`);

			const queryStart = Date.now();
			const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
			
			// ✅ Branch × Category aggregation: Uses tblsaleslines grouped by store and category
			// Revenue calculation: SUM(incl_line_total) - SUM(tax) grouped by store, category
			// Matches SQL: SELECT store, category, SUM(incl_line_total) - SUM(tax) AS totalRevenue, ... FROM tblsaleslines WHERE doc_type IN (1, 2) GROUP BY store, category
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication

			// ✅ Get repository for country
			const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
			
			const query = salesLinesRepo
				.createQueryBuilder('line');

			query.select([
				'line.store as store',
				'line.category as category',
				'SUM(line.incl_line_total) - SUM(line.tax) as totalRevenue', // ✅ Subtract tax: matches SQL query exactly
				'SUM(line.cost_price * line.quantity) as totalCost',
				'COUNT(DISTINCT line.doc_number) as transactionCount',
				'COUNT(DISTINCT line.customer) as uniqueCustomers',
				'SUM(line.quantity) as totalQuantity',
			])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2) for revenue calculations
				.andWhere('line.doc_type IN (:...docTypes)', { docTypes: ['1', '2'] })
				.andWhere('line.item_code IS NOT NULL')
				.andWhere('line.item_code != :excludeItemCode', { excludeItemCode: '.' })
				.andWhere('line.type = :itemType', { itemType: 'I' })
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' });

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('line.store = :store', { store: filters.storeCode });
			}

			if (filters.category) {
				this.logger.debug(`[${operationId}] Filtering by category: ${filters.category}`);
				query.andWhere('line.category = :category', { category: filters.category });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use rep_code directly from tblsaleslines
				query.andWhere('line.rep_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			}

			if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				this.logger.log(`[${operationId}] Filter logic: Removing sales where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
				// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
				query.andWhere(
					`(line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			query.groupBy('line.store, line.category')
				.orderBy('totalRevenue', 'DESC')
				.limit(10000); // ✅ PHASE 2: Max 10k records per aggregation

			const results = await this.executeQueryWithProtection(
				async () => query.getRawMany(),
				operationId,
				120000, // 120 second base timeout
				dateRangeDays, // Adaptive timeout
			);
			const queryDuration = Date.now() - queryStart;
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			// Process results to ensure correct types
			const processedResults = results.map((row) => ({
				store: String(row.store || '').trim().padStart(3, '0'),
				category: String(row.category || 'Uncategorized').trim(),
				totalRevenue: parseFloat(row.totalRevenue) || 0,
				totalCost: parseFloat(row.totalCost) || 0,
				transactionCount: parseInt(row.transactionCount, 10) || 0,
				uniqueCustomers: parseInt(row.uniqueCustomers, 10) || 0,
				totalQuantity: parseFloat(row.totalQuantity) || 0,
			}));

			this.logger.log(`[${operationId}] Aggregation query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Computed ${processedResults.length} branch-category aggregations`);

			// Cache results
			await this.cacheManager.set(cacheKey, processedResults, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return processedResults;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics
			this.logger.error(`[${operationId}] ❌ Error computing branch-category aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			this.logger.error(`[${operationId}] Circuit Breaker: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Connection Pool: ${JSON.stringify(this.getConnectionPoolInfo())}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * Get product aggregations - top products by revenue
	 * 
	 * ✅ REVISED: Uses SUM(incl_line_total) - SUM(tax) for revenue calculation
	 * Filters: item_code != '.', type = 'I' (inventory items), groups by description
	 * Sales Person Filtering: Uses tblsaleslines.rep_code field directly
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getProductAggregations(filters: ErpQueryFilters, limit: number = 50, countryCode: string = 'SA'): Promise<ProductAggregation[]> {
		const operationId = this.generateOperationId('GET_PRODUCT_AGG');
		const cacheKey = this.buildCacheKey('product_agg', filters, undefined, countryCode) + `:${limit}`;
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Starting getProductAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}, Limit: ${limit}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get<ProductAggregation[]>(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(
						`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} product aggregations (${duration}ms)`,
					);
					return cached;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing product aggregations...`);

			const queryStart = Date.now();
			const dateRangeDays = this.calculateDateRangeDays(filters.startDate, filters.endDate);
			
			// ✅ REVISED: Use SUM(incl_line_total) - SUM(tax) for revenue, filter item_code != '.', type = 'I', group by description
			// Matches SQL: SELECT SUM(incl_line_total) - SUM(tax) as totalRevenue FROM tblsaleslines WHERE item_code != '.' AND type = 'I' GROUP BY description
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication

			// ✅ Get repository for country
			const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
			
			const query = salesLinesRepo
				.createQueryBuilder('line');

			query.select([
				'line.item_code as itemCode',
				'line.description as description',
				'line.category as category',
				'SUM(line.incl_line_total) - SUM(line.tax) as totalRevenue', // ✅ Subtract tax: matches SQL query exactly
				'SUM(line.cost_price * line.quantity) as totalCost',
				'SUM(line.quantity) as totalQuantity',
				'COUNT(DISTINCT line.doc_number) as transactionCount',
			])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2) for revenue calculations
				.andWhere('line.doc_type IN (:...docTypes)', { docTypes: ['1', '2'] })
				// ✅ Data quality filters
				.andWhere('line.item_code IS NOT NULL')
				.andWhere('line.item_code != :excludeItemCode', { excludeItemCode: '.' }) // ✅ Exclude '.' item codes
				.andWhere('line.type = :itemType', { itemType: 'I' }) // ✅ Only inventory items
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('line.description') // ✅ Group by description (product name)
				.orderBy('totalRevenue', 'DESC')
				.limit(Math.min(limit, 10000)); // ✅ PHASE 2: Cap at 10k even if limit is higher

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('line.store = :store', { store: filters.storeCode });
			}

			if (filters.category) {
				this.logger.debug(`[${operationId}] Filtering by category: ${filters.category}`);
				query.andWhere('line.category = :category', { category: filters.category });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use rep_code directly from tblsaleslines
				query.andWhere('line.rep_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				this.logger.log(`[${operationId}] Filter logic: Removing sales where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
				// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
				query.andWhere(
					`(line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;
			
			// ✅ PHASE 2: Log slow query warning
			this.logSlowQuery(operationId, queryDuration, dateRangeDays, filters.startDate, filters.endDate);

			this.logger.log(`[${operationId}] Aggregation query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Computed ${results.length} product aggregations`);

			// Cache results
			await this.cacheManager.set(cacheKey, results, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return results;
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics
			this.logger.error(`[${operationId}] ❌ Error computing product aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			this.logger.error(`[${operationId}] Circuit Breaker: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}] Connection Pool: ${JSON.stringify(this.getConnectionPoolInfo())}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * Execute multiple aggregation queries sequentially (one after another)
	 * ✅ IMPROVED: Sequential execution to prevent connection pool exhaustion
	 * Executes queries one at a time to ensure reliability and prevent database overload
	 */
	async getAllAggregationsParallel(filters: ErpQueryFilters): Promise<{
		daily: DailyAggregation[];
		branch: BranchAggregation[];
		salesPerson: SalesPersonAggregation[];
		category: CategoryAggregation[];
		products: ProductAggregation[];
	}> {
		const operationId = this.generateOperationId('GET_ALL_AGG_SEQUENTIAL');

		this.logger.log(`[${operationId}] ===== Starting Sequential Aggregations =====`);
		this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);
		this.logger.log(`[${operationId}] Executing queries sequentially (one after another)...`);

		const startTime = Date.now();

		try {
			// ✅ Sequential execution - queries run one after another
			this.logger.log(`[${operationId}] Step 1/5: Getting daily aggregations...`);
			const step1Start = Date.now();
			const daily = await this.getDailyAggregations(filters);
			const step1Duration = Date.now() - step1Start;
			this.logger.log(`[${operationId}] Step 1 completed in ${step1Duration}ms (${daily.length} records)`);

			this.logger.log(`[${operationId}] Step 2/5: Getting branch aggregations...`);
			const step2Start = Date.now();
			const branch = await this.getBranchAggregations(filters);
			const step2Duration = Date.now() - step2Start;
			this.logger.log(`[${operationId}] Step 2 completed in ${step2Duration}ms (${branch.length} records)`);

			this.logger.log(`[${operationId}] Step 3/5: Getting sales person aggregations...`);
			const step3Start = Date.now();
			const salesPerson = await this.getSalesPersonAggregations(filters);
			const step3Duration = Date.now() - step3Start;
			this.logger.log(`[${operationId}] Step 3 completed in ${step3Duration}ms (${salesPerson.length} records)`);

			this.logger.log(`[${operationId}] Step 4/5: Getting category aggregations...`);
			const step4Start = Date.now();
			const category = await this.getCategoryAggregations(filters);
			const step4Duration = Date.now() - step4Start;
			this.logger.log(`[${operationId}] Step 4 completed in ${step4Duration}ms (${category.length} records)`);

			this.logger.log(`[${operationId}] Step 5/5: Getting product aggregations...`);
			const step5Start = Date.now();
			const products = await this.getProductAggregations(filters);
			const step5Duration = Date.now() - step5Start;
			this.logger.log(`[${operationId}] Step 5 completed in ${step5Duration}ms (${products.length} records)`);

			const duration = Date.now() - startTime;

			this.logger.log(`[${operationId}] ===== Sequential Aggregations Results =====`);
			this.logger.log(`[${operationId}] Daily aggregations: ${daily.length} records`);
			this.logger.log(`[${operationId}] Branch aggregations: ${branch.length} records`);
			this.logger.log(`[${operationId}] Sales person aggregations: ${salesPerson.length} records`);
			this.logger.log(`[${operationId}] Category aggregations: ${category.length} records`);
			this.logger.log(`[${operationId}] Product aggregations: ${products.length} records`);
			this.logger.log(`[${operationId}] ✅ All sequential aggregations completed in ${duration}ms`);
			this.logger.log(`[${operationId}] Circuit breaker state: ${this.circuitBreakerState}`);

			return { daily, branch, salesPerson, category, products };
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics for sequential operations
			this.logger.error(`[${operationId}] ❌ Error executing sequential aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error Type: ${error.constructor?.name || 'Unknown'}`);
			this.logger.error(`[${operationId}] Error Message: ${error.message}`);
			this.logger.error(`[${operationId}] Error Code: ${error.code || 'N/A'}`);
			
			// Log system state
			const poolInfo = this.getConnectionPoolInfo();
			this.logger.error(`[${operationId}] System State:`);
			this.logger.error(`[${operationId}]   Circuit Breaker: ${this.circuitBreakerState}`);
			this.logger.error(`[${operationId}]   Failure Count: ${this.failureCount}/${this.FAILURE_THRESHOLD}`);
			this.logger.error(`[${operationId}]   Active Queries: ${this.activeQueries}/${this.MAX_CONCURRENT_QUERIES}`);
			this.logger.error(`[${operationId}]   Connection Pool: ${JSON.stringify(poolInfo)}`);
			
			// Log query parameters
			this.logger.error(`[${operationId}] Query Parameters: ${JSON.stringify(filters)}`);
			
			this.logger.error(`[${operationId}] Stack Trace: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * Clear cache for specific date range
	 */
	async clearCache(startDate?: string, endDate?: string): Promise<void> {
		const operationId = this.generateOperationId('CLEAR_CACHE');

		this.logger.log(`[${operationId}] Starting cache clear operation`);

		const startTime = Date.now();
		let clearedCount = 0;

		try {
			if (startDate && endDate) {
				const patterns = [
					`erp:v2:headers:${startDate}:${endDate}:*`,
					`erp:v2:lines:${startDate}:${endDate}:*`,
					`erp:v2:daily_agg:${startDate}:${endDate}:*`,
					`erp:v2:branch_agg:${startDate}:${endDate}:*`,
					`erp:v2:category_agg:${startDate}:${endDate}:*`,
					`erp:v2:product_agg:${startDate}:${endDate}:*`,
				];

				this.logger.log(`[${operationId}] Clearing cache for date range: ${startDate} to ${endDate}`);
				this.logger.log(`[${operationId}] Patterns to clear: ${patterns.length}`);

				for (const pattern of patterns) {
					try {
						await this.cacheManager.del(pattern);
						clearedCount++;
						this.logger.debug(`[${operationId}] Cleared pattern: ${pattern}`);
					} catch (error) {
						this.logger.warn(`[${operationId}] Failed to clear cache pattern ${pattern}: ${error.message}`);
					}
				}

				const duration = Date.now() - startTime;
				this.logger.log(
					`[${operationId}] ✅ Cleared ${clearedCount}/${patterns.length} cache patterns (${duration}ms)`,
				);
			} else {
				this.logger.log(`[${operationId}] Clearing ALL ERP cache...`);
				await this.cacheManager.reset();
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ All ERP cache cleared (${duration}ms)`);
			}
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error clearing cache (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get cache statistics
	 */
	async getCacheStats(): Promise<{ keys: number }> {
		try {
			const store = await this.cacheManager.store;
			// This depends on the cache implementation
			return { keys: 0 }; // Placeholder
		} catch (error) {
			this.logger.error(`Error getting cache stats: ${error.message}`);
			return { keys: 0 };
		}
	}

	/**
	 * ✅ PHASE 1 & 3: Verify cache health for a given date range
	 * Checks that all required cache keys exist
	 */
	async verifyCacheHealth(filters: ErpQueryFilters): Promise<{
		aggregations: boolean;
		salesPersonAggregations: boolean;
		hourlySales: boolean;
		paymentTypes: boolean;
		conversionRate: boolean;
		masterData: boolean;
		salesLines: boolean;
		salesHeaders: boolean;
	}> {
		// Build cache keys using the same logic as buildCacheKey
		const buildKey = (dataType: string, docTypes?: string[]) => {
			const salesPersonKey = filters.salesPersonId 
				? (Array.isArray(filters.salesPersonId) ? filters.salesPersonId.sort().join('-') : filters.salesPersonId)
				: 'all';
			
			return [
				'erp',
				'v2',
				dataType,
				filters.startDate,
				filters.endDate,
				filters.storeCode || 'all',
				filters.category || 'all',
				salesPersonKey,
				docTypes ? docTypes.join('-') : 'all',
			].join(':');
		};

		// Check each cache key
		const aggregationsKey = buildKey('daily_agg');
		const salesPersonAggregationsKey = buildKey('sales_person_agg');
		const hourlySalesKey = buildKey('hourly_sales', ['1', '2']); // Tax Invoices (1) AND Credit Notes (2)
		const paymentTypesKey = buildKey('payment_types', ['1', '2']); // Tax Invoices (1) AND Credit Notes (2)
		const conversionRateKey = buildKey('conversion_rate');
		const masterDataKey = buildKey('master_data');
		const salesLinesKey = buildKey('lines', ['1']); // Raw data queries still use doc_type 1 only
		const salesHeadersKey = buildKey('headers', ['1']); // Raw data queries still use doc_type 1 only

		const [aggregations, salesPersonAggregations, hourlySales, paymentTypes, conversionRate, masterData, salesLines, salesHeaders] = await Promise.all([
			this.cacheManager.get(aggregationsKey),
			this.cacheManager.get(salesPersonAggregationsKey),
			this.cacheManager.get(hourlySalesKey),
			this.cacheManager.get(paymentTypesKey),
			this.cacheManager.get(conversionRateKey),
			this.cacheManager.get(masterDataKey),
			this.cacheManager.get(salesLinesKey),
			this.cacheManager.get(salesHeadersKey),
		]);

		return {
			aggregations: !!aggregations,
			salesPersonAggregations: !!salesPersonAggregations,
			hourlySales: !!hourlySales,
			paymentTypes: !!paymentTypes,
			conversionRate: !!conversionRate,
			masterData: !!masterData,
			salesLines: !!salesLines,
			salesHeaders: !!salesHeaders,
		};
	}

	/**
	 * Get hourly sales pattern using real sale_time data
	 * 
	 * Aggregates sales by hour of day to identify peak sales hours
	 * Only includes records with sale_time data
	 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
	 * 
	 * ✅ REVISED: Uses tblsalesheader table with SUM(total_incl) - SUM(total_tax) formula
	 *
	 * @param filters - Query filters (date range, store, etc.)
	 * @param countryCode - Country code for database switching (defaults to 'SA')
	 * @returns Hourly sales data aggregated by hour
	 * 
	 * Sales Person Filtering: Uses tblsalesheader.sales_code field
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getHourlySalesPattern(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<
		Array<{
			hour: number;
			transactionCount: number;
			totalRevenue: number;
			uniqueCustomers: number;
		}>
	> {
		const operationId = this.generateOperationId('GET_HOURLY_SALES');
		const cacheKey = this.buildCacheKey('hourly_sales', filters, ['1', '2'], countryCode); // Tax Invoices (1) AND Credit Notes (2)
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Getting hourly sales pattern for ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
					return cached as any;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying hourly pattern...`);

			const queryStart = Date.now();

			// ✅ REVISED: Uses tblsalesheader with SUM(total_incl) - SUM(total_tax) formula
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication

			// ✅ Get repository for country
			const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);
			
			const query = salesHeaderRepo
				.createQueryBuilder('header');

			query.select([
				'HOUR(header.sale_time) as hour',
				'COUNT(DISTINCT header.doc_number) as transactionCount',
				'CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) - SUM(CAST(header.total_tax AS DECIMAL(19,3))) AS DECIMAL(19,2)) as totalRevenue', // ✅ SUM(total_incl) - SUM(total_tax)
				'COUNT(DISTINCT header.customer) as uniqueCustomers',
			])
				.where('header.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				.andWhere('header.doc_type IN (:...docTypes)', { docTypes: [1, 2] }) // ✅ Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
				.andWhere('header.sale_time IS NOT NULL') // ✅ Only records with time
				.andWhere('header.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('HOUR(header.sale_time)')
				.orderBy('HOUR(header.sale_time)', 'ASC');

			if (filters.storeCode) {
				query.andWhere('header.store = :store', { store: filters.storeCode });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use sales_code from tblsalesheader
				query.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.debug(`[${operationId}] Including customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.debug(`[${operationId}] Excluding customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				query.andWhere(
					`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;

			// Process results
			const processedResults = results.map((row) => ({
				hour: parseInt(row.hour, 10),
				transactionCount: parseInt(row.transactionCount, 10) || 0,
				totalRevenue: parseFloat(row.totalRevenue) || 0,
				uniqueCustomers: parseInt(row.uniqueCustomers, 10) || 0,
			}));

			this.logger.log(`[${operationId}] Query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Found ${processedResults.length} hours with sales data`);

			// Find peak hours
			const sortedByRevenue = [...processedResults].sort((a, b) => b.totalRevenue - a.totalRevenue);
			if (sortedByRevenue.length > 0) {
				this.logger.log(
					`[${operationId}] Peak hour: ${
						sortedByRevenue[0].hour
					}:00 (R${sortedByRevenue[0].totalRevenue.toFixed(2)})`,
				);
			}

			// Cache results
			await this.cacheManager.set(cacheKey, processedResults, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);

			return processedResults;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error getting hourly sales (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get payment type aggregations from tblsalesheader
	 * 
	 * Aggregates payment amounts by payment type (cash, credit_card, eft, etc.)
	 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
	 * 
	 * ✅ REVISED: Uses tax exclusion approach matching base query
	 * - Base calculation: SUM(total_incl) - SUM(total_tax) AS total_sum
	 * - Payment methods are calculated proportionally based on tax-excluded total
	 * - Cash amount = SUM(cash) - SUM(change_amnt) (net cash received)
	 * - All payment methods scaled to match tax-excluded revenue total
	 * 
	 * @param filters - Query filters (date range, store, etc.)
	 * @param countryCode - Country code for database switching (defaults to 'SA')
	 * @returns Array of payment type aggregations (tax-excluded amounts)
	 * 
	 * Sales Person Filtering: Uses tblsalesheader.sales_code field
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getPaymentTypeAggregations(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<
		Array<{
			paymentType: string;
			totalAmount: number;
			transactionCount: number;
		}>
	> {
		const operationId = this.generateOperationId('GET_PAYMENT_TYPES');
		const cacheKey = this.buildCacheKey('payment_types', filters, ['1', '2'], countryCode); // Tax Invoices (1) AND Credit Notes (2)
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Getting payment type aggregations for ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
					return cached as any;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying payment types...`);

			const queryStart = Date.now();

		// Build base query
		// ✅ REVISED: Use tax exclusion approach - calculate payment methods proportionally based on SUM(total_incl) - SUM(total_tax)
		// This matches the base query: SELECT SUM(total_incl) - SUM(total_tax) AS total_sum FROM tblsalesheader WHERE doc_type IN (1, 2)
		// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication

		// ✅ Get repository for country
		const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);
		
		let query = salesHeaderRepo
			.createQueryBuilder('header');

		query.select([
			'CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) - SUM(CAST(header.total_tax AS DECIMAL(19,3))) AS DECIMAL(19,2)) as taxExcludedTotal', // ✅ Tax-excluded total
			'CAST(SUM(CAST(header.cash AS DECIMAL(19,3))) - SUM(CAST(header.change_amnt AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cash', // ✅ Cash minus change
			'CAST(SUM(CAST(header.credit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as credit_card',
			'CAST(SUM(CAST(header.eft AS DECIMAL(19,3))) AS DECIMAL(19,2)) as eft',
			'CAST(SUM(CAST(header.debit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as debit_card',
			'CAST(SUM(CAST(header.cheque AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cheque',
			'CAST(SUM(CAST(header.voucher AS DECIMAL(19,3))) AS DECIMAL(19,2)) as voucher',
			'CAST(SUM(CAST(header.account AS DECIMAL(19,3))) AS DECIMAL(19,2)) as account',
			'CAST(SUM(CAST(header.snap_scan AS DECIMAL(19,3))) AS DECIMAL(19,2)) as snap_scan',
			'CAST(SUM(CAST(header.zapper AS DECIMAL(19,3))) AS DECIMAL(19,2)) as zapper',
			'CAST(SUM(CAST(header.extra AS DECIMAL(19,3))) AS DECIMAL(19,2)) as extra',
			'CAST(SUM(CAST(header.offline_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as offline_card',
			'CAST(SUM(CAST(header.fnb_qr AS DECIMAL(19,3))) AS DECIMAL(19,2)) as fnb_qr',
			'COUNT(*) as totalTransactions',
		])
			.where('header.sale_date BETWEEN :startDate AND :endDate', {
				startDate: filters.startDate,
				endDate: filters.endDate,
			})
			.andWhere('header.doc_type IN (:...docTypes)', { docTypes: [1, 2] }) // Tax Invoices (1) AND Credit Notes (2)
			.andWhere('header.sale_date >= :minDate', { minDate: '2020-01-01' });

			if (filters.storeCode) {
				query = query.andWhere('header.store = :store', { store: filters.storeCode });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use sales_code from tblsalesheader for header queries
				query = query.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query = query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				this.logger.log(`[${operationId}] Filter logic: Removing sales where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
				// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
				query = query.andWhere(
					`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			const results = await query.getRawOne();
			const queryDuration = Date.now() - queryStart;

			this.logger.log(`[${operationId}] Query completed in ${queryDuration}ms`);

			// ✅ REVISED: Calculate tax-excluded payment methods proportionally
			// Get raw payment method totals (including tax)
			const rawPaymentMethods = {
				cash: parseFloat(results?.cash || 0),
				credit_card: parseFloat(results?.credit_card || 0),
				eft: parseFloat(results?.eft || 0),
				debit_card: parseFloat(results?.debit_card || 0),
				cheque: parseFloat(results?.cheque || 0),
				voucher: parseFloat(results?.voucher || 0),
				account: parseFloat(results?.account || 0),
				snap_scan: parseFloat(results?.snap_scan || 0),
				zapper: parseFloat(results?.zapper || 0),
				extra: parseFloat(results?.extra || 0),
				offline_card: parseFloat(results?.offline_card || 0),
				fnb_qr: parseFloat(results?.fnb_qr || 0),
			};

			// Calculate total payment received (sum of all payment methods)
			const totalPaymentReceived = Object.values(rawPaymentMethods).reduce((sum, val) => sum + val, 0);
			
			// Get tax-excluded total
			const taxExcludedTotal = parseFloat(results?.taxExcludedTotal || 0);

			// Calculate scaling factor to convert payment methods to tax-excluded amounts
			// If totalPaymentReceived is 0, use 1.0 to avoid division by zero
			const scalingFactor = totalPaymentReceived > 0 ? taxExcludedTotal / totalPaymentReceived : 1.0;

			this.logger.log(`[${operationId}] Tax-excluded total: R${taxExcludedTotal.toFixed(2)}, Total payment received: R${totalPaymentReceived.toFixed(2)}, Scaling factor: ${scalingFactor.toFixed(4)}`);

			// Apply scaling factor to each payment method to get tax-excluded amounts
			const paymentTypes = [
				{ paymentType: 'Cash', totalAmount: rawPaymentMethods.cash * scalingFactor },
				{ paymentType: 'Credit Card', totalAmount: rawPaymentMethods.credit_card * scalingFactor },
				{ paymentType: 'EFT', totalAmount: rawPaymentMethods.eft * scalingFactor },
				{ paymentType: 'Debit Card', totalAmount: rawPaymentMethods.debit_card * scalingFactor },
				{ paymentType: 'Cheque', totalAmount: rawPaymentMethods.cheque * scalingFactor },
				{ paymentType: 'Voucher', totalAmount: rawPaymentMethods.voucher * scalingFactor },
				{ paymentType: 'Account', totalAmount: rawPaymentMethods.account * scalingFactor },
				{ paymentType: 'SnapScan', totalAmount: rawPaymentMethods.snap_scan * scalingFactor },
				{ paymentType: 'Zapper', totalAmount: rawPaymentMethods.zapper * scalingFactor },
				{ paymentType: 'Extra', totalAmount: rawPaymentMethods.extra * scalingFactor },
				{ paymentType: 'Offline Card', totalAmount: rawPaymentMethods.offline_card * scalingFactor },
				{ paymentType: 'FNB QR', totalAmount: rawPaymentMethods.fnb_qr * scalingFactor },
			];

			// Filter out payment types with zero amounts and calculate transaction counts
			const nonZeroPayments = paymentTypes.filter((pt) => pt.totalAmount > 0);
			const totalAmount = nonZeroPayments.reduce((sum, pt) => sum + pt.totalAmount, 0);

			// Calculate approximate transaction count per payment type based on proportion
			const totalTransactions = parseInt(results?.totalTransactions || 0, 10);
			const processedResults = nonZeroPayments.map((pt) => ({
				paymentType: pt.paymentType,
				totalAmount: pt.totalAmount,
				transactionCount: Math.round((pt.totalAmount / totalAmount) * totalTransactions),
			}));

			// Sort by total amount descending
			processedResults.sort((a, b) => b.totalAmount - a.totalAmount);

			this.logger.log(`[${operationId}] Found ${processedResults.length} payment types with non-zero amounts`);
			if (processedResults.length > 0) {
				this.logger.log(
					`[${operationId}] Top payment type: ${processedResults[0].paymentType} (R${processedResults[0].totalAmount.toFixed(2)})`,
				);
			}

			// Cache results
			await this.cacheManager.set(cacheKey, processedResults, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);

			return processedResults;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error getting payment type aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get conversion rate data (Quotations vs Converted Invoices)
	 * 
	 * Tracks:
	 * - Total quotations (doc_type = 3)
	 * - Converted quotations (doc_type = 1 with invoice_used = 1)
	 * - Conversion rate percentage
	 * 
	 * @param filters - Query filters (date range, store, etc.)
	 * @param countryCode - Country code for database switching (defaults to 'SA')
	 * @returns Conversion rate data
	 * 
	 * Sales Person Filtering: Uses tblsalesheader.sales_code field
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getConversionRateData(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<{
		totalQuotations: number;
		totalQuotationValue: number;
		convertedInvoices: number;
		convertedInvoiceValue: number;
		conversionRate: number;
	}> {
		const operationId = this.generateOperationId('GET_CONVERSION');
		const cacheKey = this.buildCacheKey('conversion_rate', filters, undefined, countryCode);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Getting conversion rate data for ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
					return cached as any;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying conversion data...`);

			const queryStart = Date.now();

			// ✅ Add customer category filtering when needed
			const hasCustomerCategoryFilters = (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) ||
				(filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0);

			// ✅ Get repository for country
			const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);

			// Query 1: Get quotations (doc_type = 3)
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication
			let quotationsQuery = salesHeaderRepo
				.createQueryBuilder('header');

			quotationsQuery.select([
				'COUNT(*) as totalQuotations',
				'CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) as totalQuotationValue',
			])
				.where('header.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				.andWhere('header.doc_type = :docType', { docType: 3 }) // Quotations
				.andWhere('header.sale_date >= :minDate', { minDate: '2020-01-01' });

			if (filters.storeCode) {
				quotationsQuery = quotationsQuery.andWhere('header.store = :store', { store: filters.storeCode });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering quotations by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use sales_code from tblsalesheader for header queries
				quotationsQuery = quotationsQuery.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				quotationsQuery = quotationsQuery.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				quotationsQuery = quotationsQuery.andWhere(
					`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			// Query 2: Get converted invoices (doc_type = 1 with invoice_used = 1)
			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication
			let invoicesQuery = salesHeaderRepo
				.createQueryBuilder('header');

			invoicesQuery.select([
				'COUNT(*) as convertedInvoices',
				'CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) as convertedInvoiceValue',
			])
				.where('header.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				.andWhere('header.doc_type = :docType', { docType: 1 }) // Tax Invoices
				.andWhere('header.invoice_used = :invoiceUsed', { invoiceUsed: 1 }) // Converted from quotation
				.andWhere('header.sale_date >= :minDate', { minDate: '2020-01-01' });

			if (filters.storeCode) {
				invoicesQuery = invoicesQuery.andWhere('header.store = :store', { store: filters.storeCode });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering invoices by sales person(s): ${salesPersonIds.join(', ')}`);
				// Use sales_code from tblsalesheader for header queries
				invoicesQuery = invoicesQuery.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				invoicesQuery = invoicesQuery.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				invoicesQuery = invoicesQuery.andWhere(
					`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			// ✅ PHASE 3: Sequential execution with individual step timing
			this.logger.log(`[${operationId}] Step 1/2: Getting quotations data...`);
			const step1Start = Date.now();
			const quotationsResult = await quotationsQuery.getRawOne();
			const step1Duration = Date.now() - step1Start;
			this.logger.log(`[${operationId}] Step 1 completed in ${step1Duration}ms`);
			
			this.logger.log(`[${operationId}] Step 2/2: Getting converted invoices data...`);
			const step2Start = Date.now();
			const invoicesResult = await invoicesQuery.getRawOne();
			const step2Duration = Date.now() - step2Start;
			this.logger.log(`[${operationId}] Step 2 completed in ${step2Duration}ms`);

			const queryDuration = Date.now() - queryStart;

			// Process results
			const totalQuotations = parseInt(quotationsResult?.totalQuotations || 0, 10);
			const totalQuotationValue = parseFloat(quotationsResult?.totalQuotationValue || 0);
			const convertedInvoices = parseInt(invoicesResult?.convertedInvoices || 0, 10);
			const convertedInvoiceValue = parseFloat(invoicesResult?.convertedInvoiceValue || 0);
			
			// Calculate conversion rate
			const conversionRate = totalQuotations > 0 ? (convertedInvoices / totalQuotations) * 100 : 0;

			const result = {
				totalQuotations,
				totalQuotationValue,
				convertedInvoices,
				convertedInvoiceValue,
				conversionRate,
			};

			this.logger.log(`[${operationId}] Query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Quotations: ${totalQuotations} (R${totalQuotationValue.toFixed(2)})`);
			this.logger.log(`[${operationId}] Converted: ${convertedInvoices} (R${convertedInvoiceValue.toFixed(2)})`);
			this.logger.log(`[${operationId}] Conversion Rate: ${conversionRate.toFixed(2)}%`);

			// Cache results
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error getting conversion rate data (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get document type breakdown (all document types with counts and values)
	 * 
	 * Returns breakdown by all document types:
	 * - Tax Invoice (doc_type = 1)
	 * - Credit Note (doc_type = 2)
	 * - Quotation (doc_type = 3)
	 * - Sales Order (doc_type = 4)
	 * - Receipt (doc_type = 6)
	 * - And any other doc_types that exist
	 * 
	 * @param filters - Query filters (date range, store, etc.)
	 * @param countryCode - Country code for database switching (defaults to 'SA')
	 * @returns Document type breakdown data
	 * 
	 * Sales Person Filtering: Uses tblsalesheader.sales_code field
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	async getDocumentTypeBreakdown(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<Array<{
		docType: number;
		docTypeLabel: string;
		count: number;
		totalValue: number;
	}>> {
		const operationId = this.generateOperationId('GET_DOC_TYPE_BREAKDOWN');
		const cacheKey = this.buildCacheKey('doc_type_breakdown', filters, undefined, countryCode);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Getting document type breakdown for ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
					return cached as any;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying document type breakdown...`);

			const queryStart = Date.now();

			// ✅ FIXED: Use EXISTS instead of LEFT JOIN to prevent row multiplication

			// ✅ Get repository for country
			const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);

			// Query to get breakdown by doc_type
			let query = salesHeaderRepo
				.createQueryBuilder('header');

			query.select([
				'header.doc_type as docType',
				'header.doc_desc as docDesc',
				'COUNT(*) as count',
				'CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) as totalValue',
			])
				.where('header.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				.andWhere('header.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('header.doc_type, header.doc_desc')
				.orderBy('header.doc_type', 'ASC');

			if (filters.storeCode) {
				query = query.andWhere('header.store = :store', { store: filters.storeCode });
			}

			if (filters.salesPersonId) {
				const salesPersonIds = Array.isArray(filters.salesPersonId) 
					? filters.salesPersonId 
					: [filters.salesPersonId];
				this.logger.debug(`[${operationId}] Filtering by sales person(s): ${salesPersonIds.join(', ')}`);
				query = query.andWhere('header.sales_code IN (:...salesPersonIds)', { salesPersonIds });
			}

			// ✅ Customer category filtering using EXISTS to prevent row multiplication
			if (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] ✅ INCLUDING customer categories: ${filters.includeCustomerCategories.join(', ')}`);
				query = query.andWhere(
					`EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...includeCustomerCategories))`,
					{ includeCustomerCategories: filters.includeCustomerCategories }
				);
			} else if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
				this.logger.log(`[${operationId}] 🚫 EXCLUDING customer categories: ${filters.excludeCustomerCategories.join(', ')}`);
				this.logger.log(`[${operationId}] Filter logic: Removing sales where customer.Category IN (${filters.excludeCustomerCategories.join(', ')})`);
				// ✅ FIXED: Use NOT EXISTS to exclude categories without row multiplication
				query = query.andWhere(
					`(header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:...excludeCustomerCategories)))`,
					{ excludeCustomerCategories: filters.excludeCustomerCategories }
				);
			}

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;

			// Map doc_type numbers to labels
			const docTypeLabels: Record<number, string> = {
				1: 'Tax Invoice',
				2: 'Credit Note',
				3: 'Quotation',
				4: 'Sales Order',
				6: 'Receipt',
				10: 'Suspended',
				11: 'Return',
				12: 'Purchase Order',
				55: 'Sales',
			};

			// Process results
			const breakdown = results.map((row) => {
				const docType = parseInt(row.docType, 10);
				const docDesc = row.docDesc || '';
				const label = docTypeLabels[docType] || docDesc || `Document Type ${docType}`;
				
				return {
					docType,
					docTypeLabel: label,
					count: parseInt(row.count, 10) || 0,
					totalValue: parseFloat(row.totalValue) || 0,
				};
			});

			this.logger.log(`[${operationId}] Query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Found ${breakdown.length} document types`);
			breakdown.forEach((item) => {
				this.logger.log(`[${operationId}]   - ${item.docTypeLabel} (${item.docType}): ${item.count} docs, R${item.totalValue.toFixed(2)}`);
			});

			// Cache results
			await this.cacheManager.set(cacheKey, breakdown, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);

			return breakdown;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error getting document type breakdown (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get master data for filters (unique branches, products, salespeople, payment methods)
	 * 
	 * @param filters - Query filters for date range
	 * @returns Master data for populating filter dropdowns
	 */
	async getMasterDataForFilters(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<{
		branches: Array<{ id: string; name: string }>;
		products: Array<{ id: string; name: string }>;
		salespeople: Array<{ id: string; name: string }>;
		paymentMethods: Array<{ id: string; name: string }>;
		customerCategories: Array<{ id: string; name: string }>;
	}> {
		const operationId = this.generateOperationId('GET_MASTER_DATA');
		const cacheKey = this.buildCacheKey('master_data', filters, undefined, countryCode);
		
		// ✅ Log country switching
		if (countryCode !== 'SA') {
			this.logger.log(`[${operationId}] 🌍 Country switch: Using database for ${countryCode}`);
		}

		this.logger.log(`[${operationId}] Getting master data for filters`);

		const startTime = Date.now();

		try {
			// ✅ Skip cache when exclusion filters are present - always recalculate from DB
			const hasExclusionFilters = filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0;
			
			if (!hasExclusionFilters) {
				// Check cache first (only when no exclusion filters)
				const cached = await this.cacheManager.get(cacheKey);
				if (cached) {
					const duration = Date.now() - startTime;
					this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
					return cached as any;
				}
			} else {
				this.logger.log(`[${operationId}] ⚠️ Cache BYPASSED - Exclusion filters detected, recalculating from database...`);
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying master data...`);

			const queryStart = Date.now();

			// ✅ PHASE 3: Sequential execution with individual step timing
			this.logger.log(`[${operationId}] Step 1/4: Getting branches...`);
			const step1Start = Date.now();
			const branches = await this.getUniqueBranches(filters, countryCode);
			const step1Duration = Date.now() - step1Start;
			this.logger.log(`[${operationId}] Step 1 completed in ${step1Duration}ms (${branches.length} records)`);
			
			this.logger.log(`[${operationId}] Step 2/4: Getting products...`);
			const step2Start = Date.now();
			const products = await this.getUniqueProducts(filters, countryCode);
			const step2Duration = Date.now() - step2Start;
			this.logger.log(`[${operationId}] Step 2 completed in ${step2Duration}ms (${products.length} records)`);
			
			this.logger.log(`[${operationId}] Step 3/4: Getting salespeople...`);
			const step3Start = Date.now();
			const salespeople = await this.getUniqueSalespeople(filters, countryCode);
			const step3Duration = Date.now() - step3Start;
			this.logger.log(`[${operationId}] Step 3 completed in ${step3Duration}ms (${salespeople.length} records)`);
			
			this.logger.log(`[${operationId}] Step 4/5: Getting payment methods...`);
			const step4Start = Date.now();
			const paymentMethods = await this.getUniquePaymentMethods(filters, countryCode);
			const step4Duration = Date.now() - step4Start;
			this.logger.log(`[${operationId}] Step 4 completed in ${step4Duration}ms (${paymentMethods.length} records)`);

			this.logger.log(`[${operationId}] Step 5/5: Getting customer categories...`);
			const step5Start = Date.now();
			const customerCategories = await this.getUniqueCustomerCategories(filters, countryCode);
			const step5Duration = Date.now() - step5Start;
			this.logger.log(`[${operationId}] Step 5 completed in ${step5Duration}ms (${customerCategories.length} records)`);

			const queryDuration = Date.now() - queryStart;

			const result = {
				branches,
				products,
				salespeople,
				paymentMethods,
				customerCategories,
			};

			this.logger.log(`[${operationId}] Query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Found ${branches.length} branches, ${products.length} products, ${salespeople.length} salespeople, ${paymentMethods.length} payment methods, ${customerCategories.length} customer categories`);

			// Cache results
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error getting master data (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get unique branches from sales data
	 * Returns branches with aliases from STORE_NAME_MAPPING
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	private async getUniqueBranches(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<Array<{ id: string; name: string }>> {
		const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
		const query = salesLinesRepo
			.createQueryBuilder('line')
			.select('DISTINCT line.store', 'store')
			.where('line.sale_date BETWEEN :startDate AND :endDate', {
				startDate: filters.startDate,
				endDate: filters.endDate,
			})
			.andWhere('line.doc_type = :docType', { docType: '1' })
			.andWhere('line.store IS NOT NULL')
			.andWhere('line.store != :empty', { empty: '' })
			.orderBy('line.store', 'ASC');

		const results = await query.getRawMany();
		
		// Get branch names from database for all stores
		const storeCodes = results.map(row => row.store);
		const branchNamesMap = await this.getBranchNamesFromDatabase(storeCodes, countryCode);
		
		return results.map((row) => ({
			id: row.store,
			name: branchNamesMap.get(row.store?.trim().padStart(3, '0')) || row.store || 'Unknown Branch',
		}));
	}

	/**
	 * Get unique products from sales data
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	private async getUniqueProducts(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<Array<{ id: string; name: string }>> {
		const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
		const query = salesLinesRepo
			.createQueryBuilder('line')
			.select([
				'DISTINCT line.item_code as itemCode',
				'line.description as description',
			])
			.where('line.sale_date BETWEEN :startDate AND :endDate', {
				startDate: filters.startDate,
				endDate: filters.endDate,
			})
			.andWhere('line.doc_type = :docType', { docType: '1' })
			.andWhere('line.item_code IS NOT NULL')
			.andWhere('line.item_code != :empty', { empty: '' })
			.orderBy('line.item_code', 'ASC')
			.limit(1000); // Limit to top 1000 products

		const results = await query.getRawMany();
		
		return results.map((row) => ({
			id: row.itemCode,
			name: row.description || row.itemCode,
		}));
	}

	/**
	 * Get sales person name from tblsalesman table by sales code
	 * Uses caching to avoid repeated database queries
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	private async getSalesPersonName(salesCode: string | null | undefined, countryCode: string = 'SA'): Promise<string> {
		if (!salesCode || salesCode.trim() === '') {
			return 'Unknown Sales Person';
		}

		const normalizedCode = salesCode.trim().toUpperCase();
		const cacheKey = `sales_rep_name:${normalizedCode}:${countryCode}`;

		// Check cache first
		const cached = await this.cacheManager.get<string>(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			const salesmanRepo = await this.getRepositoryForCountry(TblSalesman, countryCode);
			const salesman = await salesmanRepo.findOne({
				where: { Code: normalizedCode },
				select: ['Code', 'Description'],
			});

			const name = salesman?.Description || salesCode;
			
			// Cache the result (10-minute TTL like other ERP queries)
			await this.cacheManager.set(cacheKey, name, this.CACHE_TTL);
			
			return name;
		} catch (error) {
			this.logger.warn(`Failed to lookup sales rep name for code ${normalizedCode}: ${error.message}`);
			return salesCode; // Fallback to code if lookup fails
		}
	}

	/**
	 * Get branch name from tblmultistore table by store code
	 * Uses caching to avoid repeated database queries
	 * ✅ Country Support: Fetches from the correct country database
	 * 
	 * @param storeCode - The store code (e.g., '001', '002')
	 * @param countryCode - The country code (e.g., 'SA', 'MOZ', 'ZAM')
	 * @returns The branch name (description field) or store code as fallback
	 */
	async getBranchNameFromDatabase(storeCode: string | null | undefined, countryCode: string = 'SA'): Promise<string> {
		if (!storeCode || storeCode.trim() === '') {
			return 'Unknown Branch';
		}

		const normalizedCode = storeCode.trim().padStart(3, '0');
		const cacheKey = `branch_name:${normalizedCode}:${countryCode}`;

		// Check cache first
		const cached = await this.cacheManager.get<string>(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			const multistoreRepo = await this.getRepositoryForCountry(TblMultistore, countryCode);
			const store = await multistoreRepo.findOne({
				where: { code: normalizedCode },
				select: ['code', 'description', 'alias'],
			});

			// Use alias field, fallback to description, then to store code
			const name = store?.alias || store?.description || normalizedCode;
			
			// Cache the result (10-minute TTL like other ERP queries)
			await this.cacheManager.set(cacheKey, name, this.CACHE_TTL);
			
			return name;
		} catch (error) {
			this.logger.warn(`Failed to lookup branch name for code ${normalizedCode} in country ${countryCode}: ${error.message}`);
			// Fallback to hardcoded mapping for SA if database lookup fails
			if (countryCode === 'SA') {
				const { STORE_NAME_MAPPING } = require('../config/category-mapping.config');
				return STORE_NAME_MAPPING[normalizedCode] || normalizedCode;
			}
			return normalizedCode; // Fallback to code if lookup fails
		}
	}

	/**
	 * Batch get branch names for multiple store codes
	 * More efficient than individual lookups
	 * ✅ Country Support: Fetches from the correct country database
	 */
	async getBranchNamesFromDatabase(storeCodes: string[], countryCode: string = 'SA'): Promise<Map<string, string>> {
		const nameMap = new Map<string, string>();
		const codesToLookup: string[] = [];

		// Check cache for each code
		for (const code of storeCodes) {
			if (!code || code.trim() === '') continue;
			
			const normalizedCode = code.trim().padStart(3, '0');
			const cacheKey = `branch_name:${normalizedCode}:${countryCode}`;
			
			const cached = await this.cacheManager.get<string>(cacheKey);
			if (cached) {
				nameMap.set(normalizedCode, cached);
			} else {
				codesToLookup.push(normalizedCode);
			}
		}

		// Batch lookup remaining codes
		if (codesToLookup.length > 0) {
			try {
				const multistoreRepo = await this.getRepositoryForCountry(TblMultistore, countryCode);
				
				const stores = await multistoreRepo.find({
					where: codesToLookup.map(code => ({ code })),
					select: ['code', 'description', 'alias'],
				});

				// Add to map and cache
				for (const store of stores) {
					const code = store.code?.trim().padStart(3, '0');
					if (code) {
						const name = store.alias || store.description || code;
						nameMap.set(code, name);
						
						// Cache the result
						const cacheKey = `branch_name:${code}:${countryCode}`;
						await this.cacheManager.set(cacheKey, name, this.CACHE_TTL);
					}
				}

				// For codes not found in database, use fallback
				for (const code of codesToLookup) {
					if (!nameMap.has(code)) {
						// Fallback to hardcoded mapping for SA
						if (countryCode === 'SA') {
							const { STORE_NAME_MAPPING } = require('../config/category-mapping.config');
							const fallbackName = STORE_NAME_MAPPING[code] || code;
							nameMap.set(code, fallbackName);
						} else {
							nameMap.set(code, code);
						}
					}
				}
			} catch (error) {
				this.logger.warn(`Failed to batch lookup branch names for country ${countryCode}: ${error.message}`);
				// Fallback to hardcoded mapping for SA
				if (countryCode === 'SA') {
					const { STORE_NAME_MAPPING } = require('../config/category-mapping.config');
					for (const code of codesToLookup) {
						if (!nameMap.has(code)) {
							nameMap.set(code, STORE_NAME_MAPPING[code] || code);
						}
					}
				} else {
					// For other countries, just use the code
					for (const code of codesToLookup) {
						if (!nameMap.has(code)) {
							nameMap.set(code, code);
						}
					}
				}
			}
		}

		return nameMap;
	}

	/**
	 * Batch get sales person names for multiple codes
	 * More efficient than individual lookups
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	private async getSalesPersonNames(salesCodes: string[], countryCode: string = 'SA'): Promise<Map<string, string>> {
		const nameMap = new Map<string, string>();
		const codesToLookup: string[] = [];

		// Check cache for each code
		for (const code of salesCodes) {
			if (!code || code.trim() === '') continue;
			
			const normalizedCode = code.trim().toUpperCase();
			const cacheKey = `sales_rep_name:${normalizedCode}`;
			
			const cached = await this.cacheManager.get<string>(cacheKey);
			if (cached) {
				nameMap.set(normalizedCode, cached);
			} else {
				codesToLookup.push(normalizedCode);
			}
		}

		// Batch lookup remaining codes
		if (codesToLookup.length > 0) {
			try {
				// ✅ Get repository for country
				const salesmanRepo = await this.getRepositoryForCountry(TblSalesman, countryCode);
				
				const salesmen = await salesmanRepo.find({
					where: codesToLookup.map(code => ({ Code: code })),
					select: ['Code', 'Description'],
				});

				// Add to map and cache
				for (const salesman of salesmen) {
					const code = salesman.Code?.trim().toUpperCase();
					if (code) {
						const name = salesman.Description || code;
						nameMap.set(code, name);
						
						// Cache the result
						const cacheKey = `sales_rep_name:${code}`;
						await this.cacheManager.set(cacheKey, name, this.CACHE_TTL);
					}
				}

				// For codes not found in database, use code as name and cache it
				for (const code of codesToLookup) {
					if (!nameMap.has(code)) {
						nameMap.set(code, code);
						const cacheKey = `sales_rep_name:${code}`;
						await this.cacheManager.set(cacheKey, code, this.CACHE_TTL);
					}
				}
			} catch (error) {
				this.logger.warn(`Failed to batch lookup sales rep names: ${error.message}`);
				// Fallback: use codes as names
				for (const code of codesToLookup) {
					if (!nameMap.has(code)) {
						nameMap.set(code, code);
					}
				}
			}
		}

		return nameMap;
	}

	/**
	 * Get unique salespeople from sales data
	 * Uses tblsalesheader.sales_code field (header-level sales person codes)
	 * Joins with tblsalesman to get actual names
	 * Note: For line-level rep codes, use tblsaleslines.rep_code
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	private async getUniqueSalespeople(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<Array<{ id: string; name: string }>> {
		const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);
		const query = salesHeaderRepo
			.createQueryBuilder('header')
			.leftJoin('tblsalesman', 'salesman', 'header.sales_code = salesman.Code')
			.select([
				'header.sales_code as salesCode',
				'salesman.Description as salesName',
			])
			.distinct(true)
			.where('header.sale_date BETWEEN :startDate AND :endDate', {
				startDate: filters.startDate,
				endDate: filters.endDate,
			})
			.andWhere('header.doc_type = :docType', { docType: 1 }) // Tax Invoices
			.andWhere('header.sales_code IS NOT NULL')
			.andWhere('header.sales_code != :empty', { empty: '' })
			.orderBy('header.sales_code', 'ASC');

		const results = await query.getRawMany();
		
		return results.map((row) => ({
			id: row.salesCode,
			name: row.salesName || row.salesCode, // Use name from tblsalesman or fallback to code
		}));
	}

	/**
	 * Get unique payment methods from sales header data
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	private async getUniquePaymentMethods(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<Array<{ id: string; name: string }>> {
		// Query to get which payment methods have non-zero values
		// ✅ REVISED: Cash calculation subtracts change_amnt (cash received minus change given)
		const salesHeaderRepo = await this.getRepositoryForCountry(TblSalesHeader, countryCode);
		const query = salesHeaderRepo
			.createQueryBuilder('header')
			.select([
				'CAST(SUM(CAST(header.cash AS DECIMAL(19,3))) - SUM(CAST(header.change_amnt AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cash', // ✅ Cash minus change
				'CAST(SUM(CAST(header.credit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as credit_card',
				'CAST(SUM(CAST(header.eft AS DECIMAL(19,3))) AS DECIMAL(19,2)) as eft',
				'CAST(SUM(CAST(header.debit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as debit_card',
				'CAST(SUM(CAST(header.cheque AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cheque',
				'CAST(SUM(CAST(header.voucher AS DECIMAL(19,3))) AS DECIMAL(19,2)) as voucher',
				'CAST(SUM(CAST(header.account AS DECIMAL(19,3))) AS DECIMAL(19,2)) as account',
				'CAST(SUM(CAST(header.snap_scan AS DECIMAL(19,3))) AS DECIMAL(19,2)) as snap_scan',
				'CAST(SUM(CAST(header.zapper AS DECIMAL(19,3))) AS DECIMAL(19,2)) as zapper',
				'CAST(SUM(CAST(header.extra AS DECIMAL(19,3))) AS DECIMAL(19,2)) as extra',
				'CAST(SUM(CAST(header.offline_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as offline_card',
				'CAST(SUM(CAST(header.fnb_qr AS DECIMAL(19,3))) AS DECIMAL(19,2)) as fnb_qr',
			])
			.where('header.sale_date BETWEEN :startDate AND :endDate', {
				startDate: filters.startDate,
				endDate: filters.endDate,
			})
			.andWhere('header.doc_type IN (:...docTypes)', { docTypes: [1, 2] }); // Tax Invoices (1) AND Credit Notes (2)

		const results = await query.getRawOne();

		// Build payment methods list based on which ones have values
		const paymentMethods = [
			{ id: 'cash', name: 'Cash', value: parseFloat(results?.cash || 0) },
			{ id: 'credit_card', name: 'Credit Card', value: parseFloat(results?.credit_card || 0) },
			{ id: 'eft', name: 'EFT', value: parseFloat(results?.eft || 0) },
			{ id: 'debit_card', name: 'Debit Card', value: parseFloat(results?.debit_card || 0) },
			{ id: 'cheque', name: 'Cheque', value: parseFloat(results?.cheque || 0) },
			{ id: 'voucher', name: 'Voucher', value: parseFloat(results?.voucher || 0) },
			{ id: 'account', name: 'Account', value: parseFloat(results?.account || 0) },
			{ id: 'snap_scan', name: 'SnapScan', value: parseFloat(results?.snap_scan || 0) },
			{ id: 'zapper', name: 'Zapper', value: parseFloat(results?.zapper || 0) },
			{ id: 'extra', name: 'Extra', value: parseFloat(results?.extra || 0) },
			{ id: 'offline_card', name: 'Offline Card', value: parseFloat(results?.offline_card || 0) },
			{ id: 'fnb_qr', name: 'FNB QR', value: parseFloat(results?.fnb_qr || 0) },
		];

		// Filter out payment methods with zero values
		return paymentMethods
			.filter((pm) => pm.value > 0)
			.map((pm) => ({ id: pm.id, name: pm.name }));
	}

	/**
	 * Get unique customer categories from sales data
	 * Uses LEFT JOIN to get customer categories from tblcustomers and tblcustomercategories
	 * ✅ Country Support: Accepts optional countryCode parameter (defaults to 'SA')
	 */
	private async getUniqueCustomerCategories(filters: ErpQueryFilters, countryCode: string = 'SA'): Promise<Array<{ id: string; name: string }>> {
		const salesLinesRepo = await this.getRepositoryForCountry(TblSalesLines, countryCode);
		const query = salesLinesRepo
			.createQueryBuilder('line')
			.leftJoin('tblcustomers', 'customer', 'line.customer = customer.Code')
			.leftJoin('tblcustomercategories', 'category', 'customer.Category = category.cust_cat_code')
			.select([
				'DISTINCT customer.Category as categoryCode',
				'category.cust_cat_description as categoryDescription',
			])
			.where('line.sale_date BETWEEN :startDate AND :endDate', {
				startDate: filters.startDate,
				endDate: filters.endDate,
			})
			.andWhere('line.doc_type = :docType', { docType: '1' })
			.andWhere('customer.Category IS NOT NULL')
			.andWhere('customer.Category != :empty', { empty: '' })
			.orderBy('customer.Category', 'ASC');

		const results = await query.getRawMany();
		
		return results
			.filter((row) => row.categoryCode) // Filter out nulls
			.map((row) => ({
				id: row.categoryCode,
				name: row.categoryDescription || row.categoryCode, // Use description if available, otherwise code
			}));
	}
}
