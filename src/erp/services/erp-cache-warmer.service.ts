import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ErpDataService } from './erp-data.service';
import { ErpQueryFilters } from '../interfaces/erp-data.interface';

/**
 * ERP Cache Warmer Service
 * 
 * Pre-caches common date ranges to ensure fast response times
 * for frequently accessed data.
 */
@Injectable()
export class ErpCacheWarmerService implements OnModuleInit {
	private readonly logger = new Logger(ErpCacheWarmerService.name);

	constructor(private readonly erpDataService: ErpDataService) {}

	/**
	 * Warm cache on application startup
	 */
	async onModuleInit() {
		this.logger.log('===== ERP Cache Warmer Initialization =====');
		this.logger.log('Scheduling initial cache warming in 5 seconds...');
		// Wait a few seconds after startup before warming cache
		setTimeout(() => {
			this.logger.log('Starting initial cache warming...');
			this.warmCommonDateRanges().catch((error) => {
				this.logger.error(`❌ Error warming cache on startup: ${error.message}`);
				this.logger.error(`Stack: ${error.stack}`);
			});
		}, 5000);

		// ✅ Start interval-based cache warming every 2.5 minutes
		this.startIntervalCacheWarming();
	}

	/**
	 * Warm cache twice per day (at 9 AM and 5 PM)
	 */
	@Cron('0 9,16 * * *')
	async warmCacheTwiceDaily() {
		this.logger.log('===== Scheduled Daily Cache Warming =====');
		try {
			await this.warmCommonDateRanges();
			this.logger.log('===== Daily Cache Warming Complete =====');
		} catch (error) {
			this.logger.error(`❌ Daily cache warming failed: ${error.message}`);
		}
	}


	/**
	 * Start interval-based cache warming every 2.5 minutes
	 */
	private startIntervalCacheWarming() {
		const intervalMs = 2.5 * 60 * 1000; // 2.5 minutes in milliseconds
		this.logger.log(`Starting interval-based cache warming every ${intervalMs / 1000} seconds`);
		
		setInterval(async () => {
			this.logger.log('===== Interval Cache Warming (Every 2.5 minutes) =====');
			try {
				await this.warmCommonDateRanges();
				this.logger.log('===== Interval Cache Warming Complete =====');
			} catch (error) {
				this.logger.error(`❌ Interval cache warming failed: ${error.message}`);
			}
		}, intervalMs);
	}

	/**
	 * Warm cache for common date ranges
	 * ✅ PHASE 1 & 4: Fully sequential cache warming with all chart data queries
	 * Processes date ranges one at a time, warming all chart data sequentially
	 */
	async warmCommonDateRanges(): Promise<void> {
		const today = new Date();
		const dateRanges = this.getCommonDateRanges(today);

		this.logger.log(`===== Cache Warming Started =====`);
		this.logger.log(`Date ranges to warm: ${dateRanges.length}`);
		this.logger.log(`Reference date: ${today.toISOString().split('T')[0]}`);

		const startTime = Date.now();
		let successCount = 0;
		let errorCount = 0;

		// ✅ PHASE 4: Process date ranges sequentially (one at a time)
		for (let i = 0; i < dateRanges.length; i++) {
			const { label, startDate, endDate } = dateRanges[i];
			const rangeStart = Date.now();
			
			try {
				this.logger.log(`[${i + 1}/${dateRanges.length}] Warming cache: ${label} (${startDate} to ${endDate})`);
				
				const filters: ErpQueryFilters = { startDate, endDate };
				
				// ✅ PHASE 1 & 4: Warm ALL chart data queries sequentially (with partial success)
				const warmingResult = await this.warmAllChartData(filters, label);
				
				// ✅ PHASE 1: Verify cache after warming
				const cacheHealth = await this.verifyCacheHealth(filters);
				this.logCacheHealthStatus(label, cacheHealth);
				
				const rangeDuration = Date.now() - rangeStart;
				
				// Consider partial success as success (at least some cache entries created)
				if (warmingResult.success.length > 0) {
					successCount++;
					if (warmingResult.failed.length > 0) {
						this.logger.log(
							`✅ Partially warmed cache for: ${label} (${rangeDuration}ms) - ${warmingResult.success.length} succeeded, ${warmingResult.failed.length} failed`,
						);
					} else {
						this.logger.log(`✅ Successfully warmed cache for: ${label} (${rangeDuration}ms)`);
					}
				} else {
					errorCount++;
					this.logger.warn(`❌ Failed to warm cache for ${label} (${rangeDuration}ms) - all queries failed`);
				}
			} catch (error) {
				const rangeDuration = Date.now() - rangeStart;
				errorCount++;
				this.logger.warn(`❌ Failed to warm cache for ${label} (${rangeDuration}ms): ${error.message}`);
			}
			
			// Delay between date ranges to let connection pool recover and allow garbage collection
			if (i < dateRanges.length - 1) {
				await this.delay(2000); // Increased to 2 seconds for better memory management
				// Force garbage collection hint if available
				if (global.gc) {
					global.gc();
				}
			}
		}

		const duration = Date.now() - startTime;
		
		this.logger.log(`===== Cache Warming Completed =====`);
		this.logger.log(`Total duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
		this.logger.log(`Success: ${successCount}/${dateRanges.length}`);
		this.logger.log(`Errors: ${errorCount}/${dateRanges.length}`);
		this.logger.log(`Success rate: ${((successCount / dateRanges.length) * 100).toFixed(1)}%`);
	}

	/**
	 * ✅ PHASE 1 & 4: Warm all chart data queries sequentially with partial success handling
	 * Executes all chart data queries one after another, continuing on failures
	 * No retries - if a query fails, it will be handled naturally when users request it
	 */
	private async warmAllChartData(
		filters: ErpQueryFilters,
		label: string,
	): Promise<{
		success: string[];
		failed: string[];
	}> {
		const warmingStart = Date.now();
		const success: string[] = [];
		const failed: string[] = [];
		
		// Step 1/7: Aggregations
		this.logger.log(`   Warming ${label}: 1/7 aggregations...`);
		const step1Start = Date.now();
		try {
			await this.erpDataService.getAllAggregationsParallel(filters);
			const step1Duration = Date.now() - step1Start;
			this.logger.log(`   ✅ Aggregations warmed (${step1Duration}ms)`);
			success.push('aggregations');
		} catch (error) {
			const step1Duration = Date.now() - step1Start;
			this.logger.warn(`   ❌ Aggregations failed (${step1Duration}ms): ${error.message}`);
			failed.push('aggregations');
		}
		await this.delay(500); // Delay between queries for memory management

		// Step 2/7: Hourly Sales
		this.logger.log(`   Warming ${label}: 2/7 hourly sales...`);
		const step2Start = Date.now();
		try {
			await this.erpDataService.getHourlySalesPattern(filters);
			const step2Duration = Date.now() - step2Start;
			this.logger.log(`   ✅ Hourly sales warmed (${step2Duration}ms)`);
			success.push('hourlySales');
		} catch (error) {
			const step2Duration = Date.now() - step2Start;
			this.logger.warn(`   ❌ Hourly sales failed (${step2Duration}ms): ${error.message}`);
			failed.push('hourlySales');
		}
		await this.delay(500);

		// Step 3/7: Payment Types
		this.logger.log(`   Warming ${label}: 3/7 payment types...`);
		const step3Start = Date.now();
		try {
			await this.erpDataService.getPaymentTypeAggregations(filters);
			const step3Duration = Date.now() - step3Start;
			this.logger.log(`   ✅ Payment types warmed (${step3Duration}ms)`);
			success.push('paymentTypes');
		} catch (error) {
			const step3Duration = Date.now() - step3Start;
			this.logger.warn(`   ❌ Payment types failed (${step3Duration}ms): ${error.message}`);
			failed.push('paymentTypes');
		}
		await this.delay(500);

		// Step 4/7: Conversion Rate
		this.logger.log(`   Warming ${label}: 4/7 conversion rate...`);
		const step4Start = Date.now();
		try {
			await this.erpDataService.getConversionRateData(filters);
			const step4Duration = Date.now() - step4Start;
			this.logger.log(`   ✅ Conversion rate warmed (${step4Duration}ms)`);
			success.push('conversionRate');
		} catch (error) {
			const step4Duration = Date.now() - step4Start;
			this.logger.warn(`   ❌ Conversion rate failed (${step4Duration}ms): ${error.message}`);
			failed.push('conversionRate');
		}
		await this.delay(500);

		// Step 5/7: Master Data
		this.logger.log(`   Warming ${label}: 5/7 master data...`);
		const step5Start = Date.now();
		try {
			await this.erpDataService.getMasterDataForFilters(filters);
			const step5Duration = Date.now() - step5Start;
			this.logger.log(`   ✅ Master data warmed (${step5Duration}ms)`);
			success.push('masterData');
		} catch (error) {
			const step5Duration = Date.now() - step5Start;
			this.logger.warn(`   ❌ Master data failed (${step5Duration}ms): ${error.message}`);
			failed.push('masterData');
		}
		await this.delay(500);

		// Step 6/7: Sales Lines
		this.logger.log(`   Warming ${label}: 6/7 sales lines...`);
		const step6Start = Date.now();
		try {
			await this.erpDataService.getSalesLinesByDateRange(filters);
			const step6Duration = Date.now() - step6Start;
			this.logger.log(`   ✅ Sales lines warmed (${step6Duration}ms)`);
			success.push('salesLines');
		} catch (error) {
			const step6Duration = Date.now() - step6Start;
			this.logger.warn(`   ❌ Sales lines failed (${step6Duration}ms): ${error.message}`);
			failed.push('salesLines');
		}
		await this.delay(500);

		// Step 7/7: Sales Headers
		this.logger.log(`   Warming ${label}: 7/7 sales headers...`);
		const step7Start = Date.now();
		try {
			await this.erpDataService.getSalesHeadersByDateRange(filters);
			const step7Duration = Date.now() - step7Start;
			this.logger.log(`   ✅ Sales headers warmed (${step7Duration}ms)`);
			success.push('salesHeaders');
		} catch (error) {
			const step7Duration = Date.now() - step7Start;
			this.logger.warn(`   ❌ Sales headers failed (${step7Duration}ms): ${error.message}`);
			failed.push('salesHeaders');
		}

		const totalWarmingDuration = Date.now() - warmingStart;
		this.logger.log(`   ✅ Chart data warming complete for ${label} (${totalWarmingDuration}ms)`);
		this.logger.log(`   Success: ${success.length}/7 (${success.join(', ')})`);
		if (failed.length > 0) {
			this.logger.warn(
				`   Failed: ${failed.length}/7 (${failed.join(', ')}) - queries will work naturally when requested`,
			);
		}
		
		return { success, failed };
	}

	/**
	 * ✅ PHASE 1: Verify cache health after warming
	 * Checks that all required cache keys exist
	 */
	private async verifyCacheHealth(filters: ErpQueryFilters): Promise<{
		aggregations: boolean;
		hourlySales: boolean;
		paymentTypes: boolean;
		conversionRate: boolean;
		masterData: boolean;
		salesLines: boolean;
		salesHeaders: boolean;
	}> {
		return await this.erpDataService.verifyCacheHealth(filters);
	}

	/**
	 * ✅ PHASE 1: Log cache health status
	 */
	private logCacheHealthStatus(
		label: string,
		cacheHealth: {
		aggregations: boolean;
		hourlySales: boolean;
		paymentTypes: boolean;
		conversionRate: boolean;
		masterData: boolean;
		salesLines: boolean;
		salesHeaders: boolean;
		},
	): void {
		this.logger.log(`✅ Cache warmed for ${label}:`);
		this.logger.log(`   - Aggregations: ${cacheHealth.aggregations ? '✅' : '❌'}`);
		this.logger.log(`   - Hourly Sales: ${cacheHealth.hourlySales ? '✅' : '❌'}`);
		this.logger.log(`   - Payment Types: ${cacheHealth.paymentTypes ? '✅' : '❌'}`);
		this.logger.log(`   - Conversion Rate: ${cacheHealth.conversionRate ? '✅' : '❌'}`);
		this.logger.log(`   - Master Data: ${cacheHealth.masterData ? '✅' : '❌'}`);
		this.logger.log(`   - Sales Lines: ${cacheHealth.salesLines ? '✅' : '❌'}`);
		this.logger.log(`   - Sales Headers: ${cacheHealth.salesHeaders ? '✅' : '❌'}`);
		
		const allCached = Object.values(cacheHealth).every(Boolean);
		if (!allCached) {
			this.logger.warn(`   ⚠️ Some cache entries missing for ${label}`);
		}
	}

	/**
	 * Delay helper
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Get common date ranges for caching
	 * Only returns Today and Last 7 Days - other periods will be queried on demand
	 */
	private getCommonDateRanges(referenceDate: Date): Array<{
		label: string;
		startDate: string;
		endDate: string;
	}> {
		const today = this.formatDate(referenceDate);

		// Calculate date ranges - only Today and Last 7 Days
		const ranges = [];

		// Today
		ranges.push({
			label: 'Today',
			startDate: today,
			endDate: today,
		});

		// Last 7 days
		const last7Days = new Date(referenceDate);
		last7Days.setDate(last7Days.getDate() - 7);
		ranges.push({
			label: 'Last 7 Days',
			startDate: this.formatDate(last7Days),
			endDate: today,
		});

		return ranges;
	}

	/**
	 * Format date to YYYY-MM-DD string
	 */
	private formatDate(date: Date): string {
		return date.toISOString().split('T')[0];
	}

	/**
	 * Manually trigger cache warming (for admin endpoints)
	 */
	async triggerCacheWarming(): Promise<{ success: boolean; message: string }> {
		try {
			await this.warmCommonDateRanges();
			return {
				success: true,
				message: 'Cache warming completed successfully',
			};
		} catch (error) {
			this.logger.error(`Manual cache warming failed: ${error.message}`);
			return {
				success: false,
				message: `Cache warming failed: ${error.message}`,
			};
		}
	}

	/**
	 * Clear and re-warm cache
	 */
	async refreshCache(): Promise<{ success: boolean; message: string }> {
		try {
			this.logger.log('Clearing all ERP cache...');
			await this.erpDataService.clearCache();
			
			this.logger.log('Re-warming cache...');
			await this.warmCommonDateRanges();
			
			return {
				success: true,
				message: 'Cache refreshed successfully',
			};
		} catch (error) {
			this.logger.error(`Cache refresh failed: ${error.message}`);
			return {
				success: false,
				message: `Cache refresh failed: ${error.message}`,
			};
		}
	}
}
