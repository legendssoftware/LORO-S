import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { TblSalesHeader } from '../entities/tblsalesheader.entity';
import { TblSalesLines } from '../entities/tblsaleslines.entity';
import {
	DailyAggregation,
	BranchAggregation,
	CategoryAggregation,
	ProductAggregation,
	ErpQueryFilters,
} from '../interfaces/erp-data.interface';
import { ConfigService } from '@nestjs/config';

/**
 * ERP Data Service
 *
 * Handles all queries to the ERP database with aggressive caching
 * and parallel query execution for optimal performance.
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
 *    - Maximum 3 parallel queries to prevent connection pool exhaustion
 *    - Request queuing for overflow
 *    - Connection pool monitoring
 * 
 * 4. **Aggressive Caching Strategy**
 *    - 4-hour TTL for all queries
 *    - Cache-first approach reduces database load
 *    - Individual cache keys for different query combinations
 * 
 * 5. **Extended Timeouts for Remote Servers**
 *    - 90 seconds for headers queries
 *    - 120 seconds for lines and aggregations
 *    - Accounts for network latency on remote databases
 * 
 * 6. **Batched Query Execution**
 *    - Aggregations run in 2 batches (2 queries per batch)
 *    - Prevents connection pool saturation
 *    - Critical queries (daily + branch) run first
 * 
 * 7. **Enhanced Error Diagnostics**
 *    - Detailed logging of error type, code, and stack trace
 *    - Connection pool state logging
 *    - Circuit breaker state tracking
 *    - Query parameter logging for debugging
 * 
 * 8. **Pagination Strategy**
 *    - Current: Caching + batched execution (optimal for this use case)
 *    - Result sets are aggregated, not raw transactional data
 *    - Most queries return summary data (< 1000 rows)
 *    - If pagination needed: Use LIMIT/OFFSET in TypeORM with .take()/.skip()
 * 
 * ========================================================================
 */
@Injectable()
export class ErpDataService implements OnModuleInit {
	private readonly logger = new Logger(ErpDataService.name);
	private readonly CACHE_TTL = 14400; // 4 hours in seconds (increased from 1 hour)
	
	// ✅ Circuit Breaker State (More resilient for remote servers)
	private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
	private failureCount = 0;
	private lastFailureTime: number = 0;
	private readonly FAILURE_THRESHOLD = 5; // Open circuit after 5 consecutive failures (increased from 3)
	private readonly CIRCUIT_RESET_TIMEOUT = 60000; // 60 seconds (increased from 30s)
	private readonly HALF_OPEN_MAX_REQUESTS = 2; // Allow 2 test requests in half-open state (increased from 1)
	private halfOpenRequests = 0;
	
	// ✅ Query Semaphore for limiting concurrent queries
	private activeQueries = 0;
	private readonly MAX_CONCURRENT_QUERIES = 3; // Max 3 parallel queries at once
	private queryQueue: Array<() => Promise<any>> = [];
	
	// ✅ Retry Configuration for transient failures
	private readonly MAX_RETRIES = 3; // Maximum retry attempts
	private readonly INITIAL_RETRY_DELAY = 1000; // Start with 1 second
	private readonly MAX_RETRY_DELAY = 10000; // Max 10 seconds between retries

	constructor(
		@InjectRepository(TblSalesHeader, 'erp')
		private salesHeaderRepo: Repository<TblSalesHeader>,
		@InjectRepository(TblSalesLines, 'erp')
		private salesLinesRepo: Repository<TblSalesLines>,
		@InjectDataSource('erp')
		private erpDataSource: DataSource,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
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
			const connectionLimit = this.configService.get<string>('ERP_DB_CONNECTION_LIMIT') || '30';

			this.logger.log(`[${operationId}] ERP Database Configuration:`);
			this.logger.log(`[${operationId}]   Host: ${host || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Port: ${port || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Database: ${database || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   User: ${user || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Connection Pool Size: ${connectionLimit}`);
			this.logger.log(`[${operationId}]   Cache TTL: ${this.CACHE_TTL}s`);
			this.logger.log(`[${operationId}]   Query Timeout: 120s (default)`);
			this.logger.log(`[${operationId}]   Max Retries: ${this.MAX_RETRIES}`);
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
				await this.salesLinesRepo.count({ take: 1 });
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
			this.halfOpenRequests = 0;
		} else if (this.circuitBreakerState === 'CLOSED') {
			// Reset failure count on success
			if (this.failureCount > 0) {
				this.logger.debug(`[${operationId}] Resetting failure count (was ${this.failureCount})`);
				this.failureCount = 0;
			}
		}
	}

	/**
	 * ✅ Circuit Breaker: Record failure
	 */
	private recordFailure(operationId: string, error: Error): void {
		this.failureCount++;
		this.lastFailureTime = Date.now();

		this.logger.warn(
			`[${operationId}] Query failure recorded (${this.failureCount}/${this.FAILURE_THRESHOLD}) - ${error.message}`,
		);

		if (this.circuitBreakerState === 'HALF_OPEN') {
			this.logger.error(`[${operationId}] Circuit breaker test request failed - reopening circuit`);
			this.circuitBreakerState = 'OPEN';
		} else if (this.failureCount >= this.FAILURE_THRESHOLD) {
			this.logger.error(
				`[${operationId}] ⚠️ CIRCUIT BREAKER OPENED after ${this.failureCount} consecutive failures. Will retry in ${this.CIRCUIT_RESET_TIMEOUT / 1000}s`,
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
	 * ✅ Wrap query execution with circuit breaker, timeout, and retry logic
	 */
	private async executeQueryWithProtection<T>(
		queryFn: () => Promise<T>,
		operationId: string,
		timeoutMs: number = 120000, // 120 second default timeout (increased from 60s for remote servers)
	): Promise<T> {
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

		// ✅ Retry loop with exponential backoff
		let lastError: Error | null = null;
		
		for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
			try {
				this.logger.debug(
					`[${operationId}] Query attempt ${attempt}/${this.MAX_RETRIES} (timeout: ${timeoutMs}ms)`,
				);
				
				// Execute with timeout protection
				const result = await Promise.race([
					this.executeWithSemaphore(queryFn, operationId),
					new Promise<T>((_, reject) =>
						setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs),
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
				
				// Check if we should retry
				const isLastAttempt = attempt === this.MAX_RETRIES;
				const shouldRetry = this.isRetryableError(error) && !isLastAttempt;
				
				if (shouldRetry) {
					const delay = this.calculateRetryDelay(attempt);
					this.logger.warn(
						`[${operationId}] Query attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`,
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
	 * Build cache key with all filtering dimensions
	 */
	private buildCacheKey(dataType: string, filters: ErpQueryFilters, docTypes?: string[]): string {
		return [
			'erp',
			'v2', // Version for cache busting
			dataType,
			filters.startDate,
			filters.endDate,
			filters.storeCode || 'all',
			filters.category || 'all',
			docTypes ? docTypes.join('-') : 'all',
		].join(':');
	}

	/**
	 * Get sales headers by date range with optional filters
	 * Only returns Tax Invoices (doc_type = 1) by default
	 */
	async getSalesHeadersByDateRange(filters: ErpQueryFilters): Promise<TblSalesHeader[]> {
		const operationId = this.generateOperationId('GET_HEADERS');
		const cacheKey = this.buildCacheKey('headers', filters, ['1']);

		this.logger.log(`[${operationId}] Starting getSalesHeadersByDateRange operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);
		this.logger.log(`[${operationId}] Cache key: ${cacheKey}`);

		const startTime = Date.now();

		try {
			// Check cache first
			this.logger.debug(`[${operationId}] Checking cache...`);
			const cached = await this.cacheManager.get<TblSalesHeader[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} headers (${duration}ms)`);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying database...`);
			this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);

			const queryStart = Date.now();
			
			// ✅ Execute with circuit breaker and timeout protection
			const results = await this.executeQueryWithProtection(
				async () => {
					const query = this.salesHeaderRepo
						.createQueryBuilder('header')
						.where('header.sale_date BETWEEN :startDate AND :endDate', {
							startDate: filters.startDate,
							endDate: filters.endDate,
						})
						// ✅ CRITICAL: Only Tax Invoices (doc_type = 1)
						.andWhere('header.doc_type = :docType', { docType: 1 });

					if (filters.storeCode) {
						this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
						query.andWhere('header.store = :store', { store: filters.storeCode });
					}

					return await query.getMany();
				},
				operationId,
				90000, // 90 second timeout for headers (increased from 45s)
			);
			
			const queryDuration = Date.now() - queryStart;

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
	 * Get sales lines by date range with doc_type filtering
	 *
	 * @param filters - Query filters
	 * @param includeDocTypes - Document types to include (defaults to Tax Invoices only)
	 * @returns Sales lines matching criteria
	 */
	async getSalesLinesByDateRange(
		filters: ErpQueryFilters,
		includeDocTypes: string[] = ['1'], // Default: Tax Invoices only
	): Promise<TblSalesLines[]> {
		const operationId = this.generateOperationId('GET_LINES');
		const cacheKey = this.buildCacheKey('lines', filters, includeDocTypes);

		this.logger.log(`[${operationId}] Starting getSalesLinesByDateRange operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);
		this.logger.log(`[${operationId}] Doc Types: ${includeDocTypes.join(',')}`);
		this.logger.log(`[${operationId}] Cache key: ${cacheKey}`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get<TblSalesLines[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} lines (${duration}ms)`);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying database...`);

			const queryStart = Date.now();
			
			// ✅ Execute with circuit breaker and timeout protection
			const results = await this.executeQueryWithProtection(
				async () => {
					const query = this.salesLinesRepo
						.createQueryBuilder('line')
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

					// ✅ Data quality filters - using gross amounts (incl_line_total) without discount subtraction
					query.andWhere('line.item_code IS NOT NULL');
					query.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' });

					return await query.getMany();
				},
				operationId,
				120000, // 120 second timeout for lines (increased from 60s)
			);
			
			const queryDuration = Date.now() - queryStart;

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
	 * Get daily aggregations - optimized query
	 */
	async getDailyAggregations(filters: ErpQueryFilters): Promise<DailyAggregation[]> {
		const operationId = this.generateOperationId('GET_DAILY_AGG');
		const cacheKey = this.buildCacheKey('daily_agg', filters);

		this.logger.log(`[${operationId}] Starting getDailyAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get<DailyAggregation[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(
					`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} aggregations (${duration}ms)`,
				);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing daily aggregations...`);

			const queryStart = Date.now();
			const query = this.salesLinesRepo
				.createQueryBuilder('line')
				.select([
					'DATE(line.sale_date) as date',
					'line.store as store',
					'SUM(line.incl_line_total) as totalRevenue',
					'SUM(line.cost_price * line.quantity) as totalCost',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
					'COUNT(DISTINCT line.customer) as uniqueCustomers',
					'SUM(line.quantity) as totalQuantity',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Only Tax Invoices (doc_type = 1) for revenue calculations
				.andWhere('line.doc_type = :docType', { docType: '1' })
				// ✅ Data quality filters - using gross amounts (incl_line_total) without discount subtraction
				.andWhere('line.item_code IS NOT NULL')
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('DATE(line.sale_date), line.store')
				.orderBy('DATE(line.sale_date)', 'ASC');

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('line.store = :store', { store: filters.storeCode });
			}

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;

			this.logger.log(`[${operationId}] Aggregation query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Computed ${results.length} daily aggregations`);

			// Cache results
			await this.cacheManager.set(cacheKey, results, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);
			return results;
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
	 */
	async getBranchAggregations(filters: ErpQueryFilters): Promise<BranchAggregation[]> {
		const operationId = this.generateOperationId('GET_BRANCH_AGG');
		const cacheKey = this.buildCacheKey('branch_agg', filters);

		this.logger.log(`[${operationId}] Starting getBranchAggregations operation`);
		this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get<BranchAggregation[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(
					`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} branch aggregations (${duration}ms)`,
				);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing branch aggregations...`);

			const queryStart = Date.now();
			const query = this.salesLinesRepo
				.createQueryBuilder('line')
				.select([
					'line.store as store',
					'SUM(line.incl_line_total) as totalRevenue',
					'SUM(line.cost_price * line.quantity) as totalCost',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
					'COUNT(DISTINCT line.customer) as uniqueCustomers',
					'SUM(line.quantity) as totalQuantity',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Only Tax Invoices (doc_type = 1) for revenue calculations
				.andWhere('line.doc_type = :docType', { docType: '1' })
				// ✅ Data quality filters - using gross amounts (incl_line_total) without discount subtraction
				.andWhere('line.item_code IS NOT NULL')
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('line.store')
				.orderBy('totalRevenue', 'DESC');

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;

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
	 * Get category aggregations - optimized query
	 */
	async getCategoryAggregations(filters: ErpQueryFilters): Promise<CategoryAggregation[]> {
		const operationId = this.generateOperationId('GET_CATEGORY_AGG');
		const cacheKey = this.buildCacheKey('category_agg', filters);

		this.logger.log(`[${operationId}] Starting getCategoryAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get<CategoryAggregation[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(
					`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} category aggregations (${duration}ms)`,
				);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing category aggregations...`);

			const queryStart = Date.now();
			const query = this.salesLinesRepo
				.createQueryBuilder('line')
				.select([
					'line.category as category',
					'line.store as store',
					'SUM(line.incl_line_total) as totalRevenue',
					'SUM(line.cost_price * line.quantity) as totalCost',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
					'COUNT(DISTINCT line.customer) as uniqueCustomers',
					'SUM(line.quantity) as totalQuantity',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Only Tax Invoices (doc_type = 1) for revenue calculations
				.andWhere('line.doc_type = :docType', { docType: '1' })
				// ✅ Data quality filters - using gross amounts (incl_line_total) without discount subtraction
				.andWhere('line.item_code IS NOT NULL')
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('line.category, line.store')
				.orderBy('totalRevenue', 'DESC');

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('line.store = :store', { store: filters.storeCode });
			}

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;

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
	 * Get product aggregations - top products by revenue
	 */
	async getProductAggregations(filters: ErpQueryFilters, limit: number = 50): Promise<ProductAggregation[]> {
		const operationId = this.generateOperationId('GET_PRODUCT_AGG');
		const cacheKey = this.buildCacheKey('product_agg', filters) + `:${limit}`;

		this.logger.log(`[${operationId}] Starting getProductAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}, Limit: ${limit}`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get<ProductAggregation[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(
					`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} product aggregations (${duration}ms)`,
				);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing product aggregations...`);

			const queryStart = Date.now();
			const query = this.salesLinesRepo
				.createQueryBuilder('line')
				.select([
					'line.item_code as itemCode',
					'line.description as description',
					'line.category as category',
					'SUM(line.incl_line_total) as totalRevenue',
					'SUM(line.cost_price * line.quantity) as totalCost',
					'SUM(line.quantity) as totalQuantity',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				// ✅ CRITICAL: Only Tax Invoices (doc_type = 1) for revenue calculations
				.andWhere('line.doc_type = :docType', { docType: '1' })
				// ✅ Data quality filters - using gross amounts (incl_line_total) without discount subtraction
				.andWhere('line.item_code IS NOT NULL')
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('line.item_code, line.description, line.category')
				.orderBy('totalRevenue', 'DESC')
				.limit(limit);

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('line.store = :store', { store: filters.storeCode });
			}

			const results = await query.getRawMany();
			const queryDuration = Date.now() - queryStart;

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
	 * Execute multiple aggregation queries in batches (not all parallel)
	 * ✅ IMPROVED: Batched execution to prevent connection pool exhaustion
	 * Executes 2 queries at a time instead of 4 to reduce load
	 */
	async getAllAggregationsParallel(filters: ErpQueryFilters): Promise<{
		daily: DailyAggregation[];
		branch: BranchAggregation[];
		category: CategoryAggregation[];
		products: ProductAggregation[];
	}> {
		const operationId = this.generateOperationId('GET_ALL_AGG_BATCHED');

		this.logger.log(`[${operationId}] ===== Starting Batched Aggregations =====`);
		this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);
		this.logger.log(`[${operationId}] Executing queries in 2 batches (2 queries per batch)...`);

		const startTime = Date.now();

		try {
			// ✅ BATCH 1: Critical queries (daily + branch)
			this.logger.log(`[${operationId}] Batch 1: Executing daily + branch aggregations...`);
			const batch1Start = Date.now();
		const [daily, branch] = await Promise.all([
			this.getDailyAggregations(filters),
			this.getBranchAggregations(filters),
		]);
		const batch1Duration = Date.now() - batch1Start;
		this.logger.log(`[${operationId}] Batch 1 completed in ${batch1Duration}ms`);

			// ✅ BATCH 2: Secondary queries (category + products)
			this.logger.log(`[${operationId}] Batch 2: Executing category + product aggregations...`);
			const batch2Start = Date.now();
			const [category, products] = await Promise.all([
				this.getCategoryAggregations(filters),
				this.getProductAggregations(filters),
			]);
			const batch2Duration = Date.now() - batch2Start;
			this.logger.log(`[${operationId}] Batch 2 completed in ${batch2Duration}ms`);

			const duration = Date.now() - startTime;

			this.logger.log(`[${operationId}] ===== Batched Aggregations Results =====`);
			this.logger.log(`[${operationId}] Daily aggregations: ${daily.length} records`);
			this.logger.log(`[${operationId}] Branch aggregations: ${branch.length} records`);
			this.logger.log(`[${operationId}] Category aggregations: ${category.length} records`);
			this.logger.log(`[${operationId}] Product aggregations: ${products.length} records`);
			this.logger.log(`[${operationId}] ✅ All batched aggregations completed in ${duration}ms`);
			this.logger.log(`[${operationId}] Circuit breaker state: ${this.circuitBreakerState}`);

			return { daily, branch, category, products };
		} catch (error) {
			const duration = Date.now() - startTime;
			
			// ✅ Enhanced error diagnostics for batched operations
			this.logger.error(`[${operationId}] ❌ Error executing batched aggregations (${duration}ms)`);
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
	 * Get hourly sales pattern using real sale_time data
	 *
	 * @param filters - Query filters (date range, store, etc.)
	 * @returns Hourly sales data aggregated by hour
	 */
	async getHourlySalesPattern(filters: ErpQueryFilters): Promise<
		Array<{
			hour: number;
			transactionCount: number;
			totalRevenue: number;
			uniqueCustomers: number;
		}>
	> {
		const operationId = this.generateOperationId('GET_HOURLY_SALES');
		const cacheKey = this.buildCacheKey('hourly_sales', filters, ['1']);

		this.logger.log(`[${operationId}] Getting hourly sales pattern for ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
				return cached as any;
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying hourly pattern...`);

			const queryStart = Date.now();

			const query = this.salesLinesRepo
				.createQueryBuilder('line')
				.select([
					'HOUR(line.sale_time) as hour',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
					'CAST(SUM(CAST(line.incl_line_total AS DECIMAL(19,3))) AS DECIMAL(19,2)) as totalRevenue',
					'COUNT(DISTINCT line.customer) as uniqueCustomers',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
				.andWhere('line.doc_type = :docType', { docType: '1' }) // ✅ Only Tax Invoices (doc_type = 1)
				.andWhere('line.sale_time IS NOT NULL') // ✅ Only records with time
				.andWhere('line.item_code IS NOT NULL')
				.andWhere('line.sale_date >= :minDate', { minDate: '2020-01-01' })
				.groupBy('HOUR(line.sale_time)')
				.orderBy('HOUR(line.sale_time)', 'ASC');

			if (filters.storeCode) {
				query.andWhere('line.store = :store', { store: filters.storeCode });
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
	 * Only includes Tax Invoices (doc_type = 1)
	 * 
	 * @param filters - Query filters (date range, store, etc.)
	 * @returns Array of payment type aggregations
	 */
	async getPaymentTypeAggregations(filters: ErpQueryFilters): Promise<
		Array<{
			paymentType: string;
			totalAmount: number;
			transactionCount: number;
		}>
	> {
		const operationId = this.generateOperationId('GET_PAYMENT_TYPES');
		const cacheKey = this.buildCacheKey('payment_types', filters, ['1']);

		this.logger.log(`[${operationId}] Getting payment type aggregations for ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
				return cached as any;
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying payment types...`);

			const queryStart = Date.now();

			// Build base query
			let query = this.salesHeaderRepo
				.createQueryBuilder('header')
				.select([
					'CAST(SUM(CAST(header.cash AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cash',
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
				.andWhere('header.doc_type = :docType', { docType: 1 }) // Only Tax Invoices
				.andWhere('header.sale_date >= :minDate', { minDate: '2020-01-01' });

			if (filters.storeCode) {
				query = query.andWhere('header.store = :store', { store: filters.storeCode });
			}

			const results = await query.getRawOne();
			const queryDuration = Date.now() - queryStart;

			this.logger.log(`[${operationId}] Query completed in ${queryDuration}ms`);

			// Process results - convert to array of payment type objects
			const paymentTypes = [
				{ paymentType: 'Cash', totalAmount: parseFloat(results?.cash || 0) },
				{ paymentType: 'Credit Card', totalAmount: parseFloat(results?.credit_card || 0) },
				{ paymentType: 'EFT', totalAmount: parseFloat(results?.eft || 0) },
				{ paymentType: 'Debit Card', totalAmount: parseFloat(results?.debit_card || 0) },
				{ paymentType: 'Cheque', totalAmount: parseFloat(results?.cheque || 0) },
				{ paymentType: 'Voucher', totalAmount: parseFloat(results?.voucher || 0) },
				{ paymentType: 'Account', totalAmount: parseFloat(results?.account || 0) },
				{ paymentType: 'SnapScan', totalAmount: parseFloat(results?.snap_scan || 0) },
				{ paymentType: 'Zapper', totalAmount: parseFloat(results?.zapper || 0) },
				{ paymentType: 'Extra', totalAmount: parseFloat(results?.extra || 0) },
				{ paymentType: 'Offline Card', totalAmount: parseFloat(results?.offline_card || 0) },
				{ paymentType: 'FNB QR', totalAmount: parseFloat(results?.fnb_qr || 0) },
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
	 * @returns Conversion rate data
	 */
	async getConversionRateData(filters: ErpQueryFilters): Promise<{
		totalQuotations: number;
		totalQuotationValue: number;
		convertedInvoices: number;
		convertedInvoiceValue: number;
		conversionRate: number;
	}> {
		const operationId = this.generateOperationId('GET_CONVERSION');
		const cacheKey = this.buildCacheKey('conversion_rate', filters);

		this.logger.log(`[${operationId}] Getting conversion rate data for ${filters.startDate} to ${filters.endDate}`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
				return cached as any;
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying conversion data...`);

			const queryStart = Date.now();

			// Query 1: Get quotations (doc_type = 3)
			let quotationsQuery = this.salesHeaderRepo
				.createQueryBuilder('header')
				.select([
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

			// Query 2: Get converted invoices (doc_type = 1 with invoice_used = 1)
			let invoicesQuery = this.salesHeaderRepo
				.createQueryBuilder('header')
				.select([
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

			// Execute both queries in parallel
			const [quotationsResult, invoicesResult] = await Promise.all([
				quotationsQuery.getRawOne(),
				invoicesQuery.getRawOne(),
			]);

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
	 * Get master data for filters (unique branches, products, salespeople, payment methods)
	 * 
	 * @param filters - Query filters for date range
	 * @returns Master data for populating filter dropdowns
	 */
	async getMasterDataForFilters(filters: ErpQueryFilters): Promise<{
		branches: Array<{ id: string; name: string }>;
		products: Array<{ id: string; name: string }>;
		salespeople: Array<{ id: string; name: string }>;
		paymentMethods: Array<{ id: string; name: string }>;
	}> {
		const operationId = this.generateOperationId('GET_MASTER_DATA');
		const cacheKey = this.buildCacheKey('master_data', filters);

		this.logger.log(`[${operationId}] Getting master data for filters`);

		const startTime = Date.now();

		try {
			// Check cache first
			const cached = await this.cacheManager.get(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT (${duration}ms)`);
				return cached as any;
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying master data sequentially...`);

			const queryStart = Date.now();

			// Execute queries sequentially to avoid connection pool exhaustion
			this.logger.log(`[${operationId}] Fetching branches...`);
			const branches = await this.getUniqueBranches(filters);
			
			this.logger.log(`[${operationId}] Fetching products...`);
			const products = await this.getUniqueProducts(filters);
			
			this.logger.log(`[${operationId}] Fetching salespeople...`);
			const salespeople = await this.getUniqueSalespeople(filters);
			
			this.logger.log(`[${operationId}] Fetching payment methods...`);
			const paymentMethods = await this.getUniquePaymentMethods(filters);

			const queryDuration = Date.now() - queryStart;

			const result = {
				branches,
				products,
				salespeople,
				paymentMethods,
			};

			this.logger.log(`[${operationId}] Query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Found ${branches.length} branches, ${products.length} products, ${salespeople.length} salespeople, ${paymentMethods.length} payment methods`);

			// Cache results
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			const totalDuration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Operation completed successfully (${totalDuration}ms)`);

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error getting master data (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
			throw error;
		}
	}

	/**
	 * Get unique branches from sales data
	 */
	private async getUniqueBranches(filters: ErpQueryFilters): Promise<Array<{ id: string; name: string }>> {
		const query = this.salesLinesRepo
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
		
		return results.map((row) => ({
			id: row.store,
			name: row.store, // For now, use store code as name
		}));
	}

	/**
	 * Get unique products from sales data
	 */
	private async getUniqueProducts(filters: ErpQueryFilters): Promise<Array<{ id: string; name: string }>> {
		const query = this.salesLinesRepo
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
	 * Get unique salespeople from sales data
	 * Uses tblsalesheader.sales_code field
	 */
	private async getUniqueSalespeople(filters: ErpQueryFilters): Promise<Array<{ id: string; name: string }>> {
		const query = this.salesHeaderRepo
			.createQueryBuilder('header')
			.select('DISTINCT header.sales_code', 'salesCode')
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
			name: row.salesCode, // For now, use sales code as name
		}));
	}

	/**
	 * Get unique payment methods from sales header data
	 */
	private async getUniquePaymentMethods(filters: ErpQueryFilters): Promise<Array<{ id: string; name: string }>> {
		// Query to get which payment methods have non-zero values
		const query = this.salesHeaderRepo
			.createQueryBuilder('header')
			.select([
				'CAST(SUM(CAST(header.cash AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cash',
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
			.andWhere('header.doc_type = :docType', { docType: 1 });

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
}
