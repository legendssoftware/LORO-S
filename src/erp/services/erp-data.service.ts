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
 */
@Injectable()
export class ErpDataService implements OnModuleInit {
	private readonly logger = new Logger(ErpDataService.name);
	private readonly CACHE_TTL = 14400; // 4 hours in seconds (increased from 1 hour)
	
	// ✅ Circuit Breaker State
	private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
	private failureCount = 0;
	private lastFailureTime: number = 0;
	private readonly FAILURE_THRESHOLD = 3; // Open circuit after 3 failures
	private readonly CIRCUIT_RESET_TIMEOUT = 30000; // 30 seconds
	private readonly HALF_OPEN_MAX_REQUESTS = 1; // Only 1 request in half-open state
	private halfOpenRequests = 0;
	
	// ✅ Query Semaphore for limiting concurrent queries
	private activeQueries = 0;
	private readonly MAX_CONCURRENT_QUERIES = 3; // Max 3 parallel queries at once
	private queryQueue: Array<() => Promise<any>> = [];

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

			// ✅ Log connection pool information
			const poolInfo = this.getConnectionPoolInfo();
			this.logger.log(`[${operationId}] Connection Pool Info:`);
			this.logger.log(`[${operationId}]   Pool Size: ${poolInfo.poolSize}`);
			this.logger.log(`[${operationId}]   Active Connections: ${poolInfo.activeConnections}`);
			this.logger.log(`[${operationId}]   Idle Connections: ${poolInfo.idleConnections}`);

			// Test connection
			this.logger.log(`[${operationId}] Testing ERP database connection...`);
			const testStart = Date.now();

			await this.salesLinesRepo.count({ take: 1 });

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
	private recordSuccess(): void {
		if (this.circuitBreakerState === 'HALF_OPEN') {
			this.logger.log('Circuit breaker test request succeeded - closing circuit');
			this.circuitBreakerState = 'CLOSED';
			this.failureCount = 0;
			this.halfOpenRequests = 0;
		} else if (this.circuitBreakerState === 'CLOSED') {
			// Reset failure count on success
			this.failureCount = 0;
		}
	}

	/**
	 * ✅ Circuit Breaker: Record failure
	 */
	private recordFailure(error: Error): void {
		this.failureCount++;
		this.lastFailureTime = Date.now();

		if (this.circuitBreakerState === 'HALF_OPEN') {
			this.logger.error('Circuit breaker test request failed - reopening circuit');
			this.circuitBreakerState = 'OPEN';
		} else if (this.failureCount >= this.FAILURE_THRESHOLD) {
			this.logger.error(`Circuit breaker OPENED after ${this.failureCount} failures`);
			this.circuitBreakerState = 'OPEN';
		}
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
		timeoutMs: number = 60000, // 60 second default timeout
	) {
		// Check circuit breaker
		if (this.isCircuitOpen()) {
			const error = new Error('Circuit breaker is OPEN - ERP queries temporarily disabled');
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

		try {
			// Execute with timeout protection
			const result = await Promise.race([
				this.executeWithSemaphore(queryFn, operationId),
				new Promise<T>((_, reject) =>
					setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs),
				),
			]);

			this.recordSuccess();
			return result;
		} catch (error) {
			this.recordFailure(error);
			throw error;
		}
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
				45000, // 45 second timeout for headers
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
			this.logger.error(`[${operationId}] ❌ Error fetching sales headers (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			this.logger.error(`[${operationId}] Stack trace: ${error.stack}`);
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
				60000, // 60 second timeout for lines
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
			this.logger.error(`[${operationId}] ❌ Error fetching sales lines (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			this.logger.error(`[${operationId}] Stack trace: ${error.stack}`);
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
			this.logger.error(`[${operationId}] ❌ Error computing daily aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			this.logger.error(`[${operationId}] Stack trace: ${error.stack}`);
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
			this.logger.error(`[${operationId}] ❌ Error computing branch aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			this.logger.error(`[${operationId}] Stack trace: ${error.stack}`);
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
			this.logger.error(`[${operationId}] ❌ Error computing category aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			this.logger.error(`[${operationId}] Stack trace: ${error.stack}`);
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
			this.logger.error(`[${operationId}] ❌ Error computing product aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			this.logger.error(`[${operationId}] Stack trace: ${error.stack}`);
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
			this.logger.log(`[${operationId}] Batch 1 completed in ${batch1Duration}m[Nest] 18321  - 2025/11/03, 10:28:30   DEBUG [CheckInsService] [checkout_1762158510845] Calculated work duration: 0h 0m (0 minutes total)
[Nest] 18321  - 2025/11/03, 10:28:30   DEBUG [CheckInsService] [checkout_1762158510845] Reverse geocoding check-in location: 37.33233141,-122.0312186
[Nest] 18321  - 2025/11/03, 10:28:30   DEBUG [GoogleMapsService] [reverse-geocode-1762158510936] Starting reverse geocoding for coordinates: 37.33233141, -122.0312186
[Nest] 18321  - 2025/11/03, 10:28:30   DEBUG [GoogleMapsService] Cache MISS for key: gmaps:reverse-geocode:5fa5afaaee12ecad3f4443d7370ba9ac in 0ms
[Nest] 18321  - 2025/11/03, 10:28:31    WARN [GoogleMapsService] Reverse geocoding for coordinates attempt 1 failed: Request failed with status code 403. Retrying in 1000ms...
[Nest] 18321  - 2025/11/03, 10:28:32    WARN [GoogleMapsService] Reverse geocoding for coordinates attempt 2 failed: Request failed with status code 403. Retrying in 2000ms...
[Nest] 18321  - 2025/11/03, 10:28:34   ERROR [GoogleMapsService] Reverse geocoding for coordinates failed after 3 attempts: Request failed with status code 403
[Nest] 18321  - 2025/11/03, 10:28:34   ERROR [GoogleMapsService] [reverse-geocode-1762158510936] Reverse geocoding failed: Request failed with status code 403
[Nest] 18321  - 2025/11/03, 10:28:34    WARN [CheckInsService] [checkout_1762158510845] Failed to reverse geocode check-in location: Request failed with status code 403
[Nest] 18321  - 2025/11/03, 10:28:34   DEBUG [CheckInsService] [checkout_1762158510845] Updating check-in record with check-out data
[Nest] 18321  - 2025/11/03, 10:28:34   DEBUG [CheckInsService] [checkout_1762158510845] Sending check-out notifications
[Nest] 18321  - 2025/11/03, 10:28:34   DEBUG [UnifiedNotificationService] [interpolate_1762158514997] Interpolating template with 11 variables: userName, clientName, duration, checkInId, checkOutTime, location, address, orgId, branchId, timestamp, checkOutDetails
[Nest] 18321  - 2025/11/03, 10:28:34   DEBUG [UnifiedNotificationService] [interpolate_1762158514997] ✅ Successfully interpolated all template variables
[Nest] 18321  - 2025/11/03, 10:28:34     LOG [UnifiedNotificationService] 🚀 Sending checkout_completed notification to 1 recipient(s)
[Nest] 18321  - 2025/11/03, 10:28:35   DEBUG [ExpoPushService] ✅ Token validation passed
[Nest] 18321  - 2025/11/03, 10:28:35   DEBUG [ExpoPushService] Object:
{
  "tokenPrefix": "ExponentPushToken[OiAx8eKGa93_...",
  "length": 41
}

[Nest] 18321  - 2025/11/03, 10:28:35     LOG [ExpoPushService] ✅ Sent 1 push notification(s) to Expo
[Nest] 18321  - 2025/11/03, 10:28:35   ERROR [ExpoPushService] ❌ 1/1 push notifications failed:
[Nest] 18321  - 2025/11/03, 10:28:35   ERROR [ExpoPushService] Object:
{
  "errors": [
    {
      "index": 0,
      "token": "ExponentPushToken[OiAx8eKGa93_...",
      "message": "Unable to retrieve the FCM server key for the recipient's app. Make sure you have provided a server key as directed by the Expo FCM documentation.",
      "details": {
        "error": "InvalidCredentials",
        "fault": "developer"
      }
    }
  ]
}

[Nest] 18321  - 2025/11/03, 10:28:35     LOG [UnifiedNotificationService] 📱 Push notifications: 0 sent, 1 failed
[Nest] 18321  - 2025/11/03, 10:28:35   DEBUG [UnifiedNotificationService] [interpolate_1762158515578] Interpolating template with 12 variables: userName, clientName, duration, checkInId, checkOutTime, location, address, orgId, branchId, timestamp, adminNotification, checkOutDetails
[Nest] 18321  - 2025/11/03, 10:28:35   ERROR [UnifiedNotificationService] [interpolate_1762158515578] ⚠️ Missing template variable: "checkInTime". Available: userName, clientName, duration, checkInId, checkOutTime, location, address, orgId, branchId, timestamp, adminNotification, checkOutDetails
[Nest] 18321  - 2025/11/03, 10:28:35   ERROR [UnifiedNotificationService] [interpolate_1762158515578] ⚠️ Missing template variable: "checkOutTime". Available: userName, clientName, duration, checkInId, checkOutTime, location, address, orgId, branchId, timestamp, adminNotification, checkOutDetails
[Nest] 18321  - 2025/11/03, 10:28:35   ERROR [UnifiedNotificationService] [interpolate_1762158515578] ⚠️ Missing template variable: "workTimeDisplay". Available: userName, clientName, duration, checkInId, checkOutTime, location, address, orgId, branchId, timestamp, adminNotification, checkOutDetails
[Nest] 18321  - 2025/11/03, 10:28:35   ERROR [UnifiedNotificationService] [interpolate_1762158515578] ⚠️ Template interpolation incomplete!
Missing variables: [checkInTime, checkOutTime, workTimeDisplay]
Template: "Great work today, {userName}! 🔴 You've successfully completed your shift. Worked from {checkInTime:..."
Provided variables: ["userName","clientName","duration","checkInId","checkOutTime","location","address","orgId","branchId","timestamp","adminNotification","checkOutDetails"]
[Nest] 18321  - 2025/11/03, 10:28:35     LOG [UnifiedNotificationService] 🚀 Sending attendance_shift_ended notification to 5 recipient(s)
[Nest] 18321  - 2025/11/03, 10:28:35   DEBUG [ExpoPushService] ✅ Token validation passed
[Nest] 18321  - 2025/11/03, 10:28:35   DEBUG [ExpoPushService] Object:
{
  "tokenPrefix": "ExponentPushToken[OiAx8eKGa93_...",
  "length": 41
}

[Nest] 18321  - 2025/11/03, 10:28:35   DEBUG [ExpoPushService] ✅ Token validation passed
[Nest] 18321  - 2025/11/03, 10:28:35   DEBUG [ExpoPushService] Object:
{
  "tokenPrefix": "ExponentPushToken[CUqPq1OUvDFF...",
  "length": 41
}

[Nest] 18321  - 2025/11/03, 10:28:35     LOG [ExpoPushService] ✅ Sent 2 push notification(s) to Expo
[Nest] 18321  - 2025/11/03, 10:28:35   ERROR [ExpoPushService] ❌ 2/2 push notifications failed:
[Nest] 18321  - 2025/11/03, 10:28:35   ERROR [ExpoPushService] Object:
{
  "errors": [
    {
      "index": 0,
      "token": "ExponentPushToken[OiAx8eKGa93_...",
      "message": "Unable to retrieve the FCM server key for the recipient's app. Make sure you have provided a server key as directed by the Expo FCM documentation.",
      "details": {
        "error": "InvalidCredentials",
        "fault": "developer"
      }
    },
    {
      "index": 1,
      "token": "ExponentPushToken[CUqPq1OUvDFF...",
      "message": "Unable to retrieve the FCM server key for the recipient's app. Make sure you have provided a server key as directed by the Expo FCM documentation.",
      "details": {
        "error": "InvalidCredentials",
        "fault": "developer"
      }
    }
  ]
}

[Nest] 18321  - 2025/11/03, 10:28:35     LOG [UnifiedNotificationService] 📱 Push notifications: 0 sent, 2 failed
s`);

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
			this.logger.error(`[${operationId}] ❌ Error executing batched aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			this.logger.error(`[${operationId}] Stack trace: ${error.stack}`);
			this.logger.error(`[${operationId}] Circuit breaker state: ${this.circuitBreakerState}`);
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
}
