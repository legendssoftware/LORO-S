import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
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
	private readonly CACHE_TTL = 3600; // 1 hour in seconds
	private operationCounter = 0;

	constructor(
		@InjectRepository(TblSalesHeader, 'erp')
		private salesHeaderRepo: Repository<TblSalesHeader>,
		@InjectRepository(TblSalesLines, 'erp')
		private salesLinesRepo: Repository<TblSalesLines>,
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
			
			this.logger.log(`[${operationId}] ERP Database Configuration:`);
			this.logger.log(`[${operationId}]   Host: ${host || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Port: ${port || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Database: ${database || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   User: ${user || 'NOT SET'}`);
			this.logger.log(`[${operationId}]   Cache TTL: ${this.CACHE_TTL}s`);

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
	 * Generate unique operation ID for tracking
	 */
	private generateOperationId(operation: string): string {
		return `${operation}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
	}

	/**
	 * Get sales headers by date range with optional filters
	 */
	async getSalesHeadersByDateRange(filters: ErpQueryFilters): Promise<TblSalesHeader[]> {
		const operationId = this.generateOperationId('GET_HEADERS');
		const cacheKey = `erp:headers:${filters.startDate}:${filters.endDate}:${filters.storeCode || 'all'}`;
		
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
			const query = this.salesHeaderRepo.createQueryBuilder('header')
				.where('header.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('header.store = :store', { store: filters.storeCode });
			}

			const results = await query.getMany();
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
	 * Get sales lines by date range with optional filters
	 */
	async getSalesLinesByDateRange(filters: ErpQueryFilters): Promise<TblSalesLines[]> {
		const operationId = this.generateOperationId('GET_LINES');
		const cacheKey = `erp:lines:${filters.startDate}:${filters.endDate}:${filters.storeCode || 'all'}:${filters.category || 'all'}`;
		
		this.logger.log(`[${operationId}] Starting getSalesLinesByDateRange operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);
		this.logger.log(`[${operationId}] Cache key: ${cacheKey}`);
		
		const startTime = Date.now();
		
		try {
			// Check cache first
			this.logger.debug(`[${operationId}] Checking cache...`);
			const cached = await this.cacheManager.get<TblSalesLines[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} lines (${duration}ms)`);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Querying database...`);
			this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);
			
			const queryStart = Date.now();
			const query = this.salesLinesRepo.createQueryBuilder('line')
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});

			if (filters.storeCode) {
				this.logger.debug(`[${operationId}] Filtering by store: ${filters.storeCode}`);
				query.andWhere('line.store = :store', { store: filters.storeCode });
			}

			if (filters.category) {
				this.logger.debug(`[${operationId}] Filtering by category: ${filters.category}`);
				query.andWhere('line.category = :category', { category: filters.category });
			}

		if (filters.docType) {
			this.logger.debug(`[${operationId}] Filtering by doc type: ${filters.docType}`);
			query.andWhere('line.doc_type = :docType', { docType: filters.docType });
		}

			const results = await query.getMany();
			const queryDuration = Date.now() - queryStart;
			
			this.logger.log(`[${operationId}] Database query completed in ${queryDuration}ms`);
			this.logger.log(`[${operationId}] Retrieved ${results.length} sales lines`);
			
			// Cache results
			this.logger.debug(`[${operationId}] Caching results with TTL: ${this.CACHE_TTL}s`);
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
	 * Get daily aggregations - optimized query
	 */
	async getDailyAggregations(filters: ErpQueryFilters): Promise<DailyAggregation[]> {
		const operationId = this.generateOperationId('GET_DAILY_AGG');
		const cacheKey = `erp:daily_agg:${filters.startDate}:${filters.endDate}:${filters.storeCode || 'all'}`;
		
		this.logger.log(`[${operationId}] Starting getDailyAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);
		
		const startTime = Date.now();
		
		try {
			// Check cache first
			const cached = await this.cacheManager.get<DailyAggregation[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} aggregations (${duration}ms)`);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing daily aggregations...`);
			
			const queryStart = Date.now();
			const query = this.salesLinesRepo.createQueryBuilder('line')
				.select([
					'DATE(line.sale_date) as date',
					'line.store as store',
					'SUM(line.incl_line_total - line.discount) as totalRevenue',
					'SUM(line.cost_price * line.quantity) as totalCost',
					'SUM(line.incl_line_total - line.discount - (line.cost_price * line.quantity)) as totalGrossProfit',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
					'COUNT(DISTINCT line.customer) as uniqueCustomers',
					'SUM(line.quantity) as totalQuantity',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
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
		const cacheKey = `erp:branch_agg:${filters.startDate}:${filters.endDate}`;
		
		this.logger.log(`[${operationId}] Starting getBranchAggregations operation`);
		this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);
		
		const startTime = Date.now();
		
		try {
			// Check cache first
			const cached = await this.cacheManager.get<BranchAggregation[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} branch aggregations (${duration}ms)`);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing branch aggregations...`);
			
			const queryStart = Date.now();
			const query = this.salesLinesRepo.createQueryBuilder('line')
				.select([
					'line.store as store',
					'SUM(line.incl_line_total - line.discount) as totalRevenue',
					'SUM(line.cost_price * line.quantity) as totalCost',
					'SUM(line.incl_line_total - line.discount - (line.cost_price * line.quantity)) as totalGrossProfit',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
					'COUNT(DISTINCT line.customer) as uniqueCustomers',
					'SUM(line.quantity) as totalQuantity',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
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
		const cacheKey = `erp:category_agg:${filters.startDate}:${filters.endDate}:${filters.storeCode || 'all'}`;
		
		this.logger.log(`[${operationId}] Starting getCategoryAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}`);
		
		const startTime = Date.now();
		
		try {
			// Check cache first
			const cached = await this.cacheManager.get<CategoryAggregation[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} category aggregations (${duration}ms)`);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing category aggregations...`);
			
			const queryStart = Date.now();
			const query = this.salesLinesRepo.createQueryBuilder('line')
				.select([
					'line.category as category',
					'line.store as store',
					'SUM(line.incl_line_total - line.discount) as totalRevenue',
					'SUM(line.cost_price * line.quantity) as totalCost',
					'SUM(line.incl_line_total - line.discount - (line.cost_price * line.quantity)) as totalGrossProfit',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
					'COUNT(DISTINCT line.customer) as uniqueCustomers',
					'SUM(line.quantity) as totalQuantity',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
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
		const cacheKey = `erp:product_agg:${filters.startDate}:${filters.endDate}:${filters.storeCode || 'all'}:${limit}`;
		
		this.logger.log(`[${operationId}] Starting getProductAggregations operation`);
		this.logger.log(`[${operationId}] Filters: ${JSON.stringify(filters)}, Limit: ${limit}`);
		
		const startTime = Date.now();
		
		try {
			// Check cache first
			const cached = await this.cacheManager.get<ProductAggregation[]>(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				this.logger.log(`[${operationId}] ✅ Cache HIT - Retrieved ${cached.length} product aggregations (${duration}ms)`);
				return cached;
			}

			this.logger.log(`[${operationId}] Cache MISS - Computing product aggregations...`);
			
			const queryStart = Date.now();
			const query = this.salesLinesRepo.createQueryBuilder('line')
				.select([
					'line.item_code as itemCode',
					'line.description as description',
					'line.category as category',
					'SUM(line.incl_line_total - line.discount) as totalRevenue',
					'SUM(line.cost_price * line.quantity) as totalCost',
					'SUM(line.incl_line_total - line.discount - (line.cost_price * line.quantity)) as totalGrossProfit',
					'SUM(line.quantity) as totalQuantity',
					'COUNT(DISTINCT line.doc_number) as transactionCount',
				])
				.where('line.sale_date BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				})
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
	 * Execute multiple aggregation queries in parallel
	 */
	async getAllAggregationsParallel(filters: ErpQueryFilters): Promise<{
		daily: DailyAggregation[];
		branch: BranchAggregation[];
		category: CategoryAggregation[];
		products: ProductAggregation[];
	}> {
		const operationId = this.generateOperationId('GET_ALL_AGG_PARALLEL');
		
		this.logger.log(`[${operationId}] ===== Starting Parallel Aggregations =====`);
		this.logger.log(`[${operationId}] Date range: ${filters.startDate} to ${filters.endDate}`);
		this.logger.log(`[${operationId}] Executing 4 queries in parallel...`);
		
		const startTime = Date.now();
		
		try {
			const [daily, branch, category, products] = await Promise.all([
				this.getDailyAggregations(filters),
				this.getBranchAggregations(filters),
				this.getCategoryAggregations(filters),
				this.getProductAggregations(filters),
			]);
			
			const duration = Date.now() - startTime;
			
			this.logger.log(`[${operationId}] ===== Parallel Aggregations Results =====`);
			this.logger.log(`[${operationId}] Daily aggregations: ${daily.length} records`);
			this.logger.log(`[${operationId}] Branch aggregations: ${branch.length} records`);
			this.logger.log(`[${operationId}] Category aggregations: ${category.length} records`);
			this.logger.log(`[${operationId}] Product aggregations: ${products.length} records`);
			this.logger.log(`[${operationId}] ✅ All parallel aggregations completed in ${duration}ms`);
			
			return { daily, branch, category, products };
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error executing parallel aggregations (${duration}ms)`);
			this.logger.error(`[${operationId}] Error message: ${error.message}`);
			this.logger.error(`[${operationId}] Stack trace: ${error.stack}`);
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
					`erp:headers:${startDate}:${endDate}:*`,
					`erp:lines:${startDate}:${endDate}:*`,
					`erp:daily_agg:${startDate}:${endDate}:*`,
					`erp:branch_agg:${startDate}:${endDate}:*`,
					`erp:category_agg:${startDate}:${endDate}:*`,
					`erp:product_agg:${startDate}:${endDate}:*`,
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
				this.logger.log(`[${operationId}] ✅ Cleared ${clearedCount}/${patterns.length} cache patterns (${duration}ms)`);
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
}

