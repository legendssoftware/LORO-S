import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
			this.warmCommonDateRanges().catch(error => {
				this.logger.error(`❌ Error warming cache on startup: ${error.message}`);
				this.logger.error(`Stack: ${error.stack}`);
			});
		}, 5000);
	}

	/**
	 * Warm cache every hour
	 */
	@Cron(CronExpression.EVERY_HOUR)
	async warmCacheHourly() {
		this.logger.log('===== Scheduled Hourly Cache Warming =====');
		try {
			await this.warmCommonDateRanges();
			this.logger.log('===== Hourly Cache Warming Complete =====');
		} catch (error) {
			this.logger.error(`❌ Hourly cache warming failed: ${error.message}`);
		}
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
				
				// ✅ PHASE 1 & 4: Warm ALL chart data queries sequentially
				await this.warmAllChartData(filters, label);
				
				// ✅ PHASE 1: Verify cache after warming
				const cacheHealth = await this.verifyCacheHealth(filters);
				this.logCacheHealthStatus(label, cacheHealth);
				
				const rangeDuration = Date.now() - rangeStart;
				successCount++;
				this.logger.log(`✅ Successfully warmed cache for: ${label} (${rangeDuration}ms)`);
			} catch (error) {
				const rangeDuration = Date.now() - rangeStart;
				errorCount++;
				this.logger.warn(`❌ Failed to warm cache for ${label} (${rangeDuration}ms): ${error.message}`);
			}
			
			// Small delay between date ranges to let connection pool recover
			if (i < dateRanges.length - 1) {
				await this.delay(100);
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
	 * ✅ PHASE 1 & 4: Warm all chart data queries sequentially
	 * Executes all chart data queries one after another for a given date range
	 */
	private async warmAllChartData(filters: ErpQueryFilters, label: string): Promise<void> {
		const warmingStart = Date.now();
		
		try {
			// Step 1/7: Aggregations
			this.logger.log(`   Warming ${label}: 1/7 aggregations...`);
			const step1Start = Date.now();
			await this.retryWithBackoff(
				() => this.erpDataService.getAllAggregationsParallel(filters),
				3,
				`${label} - aggregations`,
			);
			const step1Duration = Date.now() - step1Start;
			this.logger.log(`   ✅ Aggregations warmed (${step1Duration}ms)`);

			// Step 2/7: Hourly Sales
			this.logger.log(`   Warming ${label}: 2/7 hourly sales...`);
			const step2Start = Date.now();
			await this.retryWithBackoff(
				() => this.erpDataService.getHourlySalesPattern(filters),
				3,
				`${label} - hourly sales`,
			);
			const step2Duration = Date.now() - step2Start;
			this.logger.log(`   ✅ Hourly sales warmed (${step2Duration}ms)`);

			// Step 3/7: Payment Types
			this.logger.log(`   Warming ${label}: 3/7 payment types...`);
			const step3Start = Date.now();
			await this.retryWithBackoff(
				() => this.erpDataService.getPaymentTypeAggregations(filters),
				3,
				`${label} - payment types`,
			);
			const step3Duration = Date.now() - step3Start;
			this.logger.log(`   ✅ Payment types warmed (${step3Duration}ms)`);

			// Step 4/7: Conversion Rate
			this.logger.log(`   Warming ${label}: 4/7 conversion rate...`);
			const step4Start = Date.now();
			await this.retryWithBackoff(
				() => this.erpDataService.getConversionRateData(filters),
				3,
				`${label} - conversion rate`,
			);
			const step4Duration = Date.now() - step4Start;
			this.logger.log(`   ✅ Conversion rate warmed (${step4Duration}ms)`);

			// Step 5/7: Master Data
			this.logger.log(`   Warming ${label}: 5/7 master data...`);
			const step5Start = Date.now();
			await this.retryWithBackoff(
				() => this.erpDataService.getMasterDataForFilters(filters),
				3,
				`${label} - master data`,
			);
			const step5Duration = Date.now() - step5Start;
			this.logger.log(`   ✅ Master data warmed (${step5Duration}ms)`);

			// Step 6/7: Sales Lines
			this.logger.log(`   Warming ${label}: 6/7 sales lines...`);
			const step6Start = Date.now();
			await this.retryWithBackoff(
				() => this.erpDataService.getSalesLinesByDateRange(filters),
				3,
				`${label} - sales lines`,
			);
			const step6Duration = Date.now() - step6Start;
			this.logger.log(`   ✅ Sales lines warmed (${step6Duration}ms)`);

			// Step 7/7: Sales Headers
			this.logger.log(`   Warming ${label}: 7/7 sales headers...`);
			const step7Start = Date.now();
			await this.retryWithBackoff(
				() => this.erpDataService.getSalesHeadersByDateRange(filters),
				3,
				`${label} - sales headers`,
			);
			const step7Duration = Date.now() - step7Start;
			this.logger.log(`   ✅ Sales headers warmed (${step7Duration}ms)`);

			const totalWarmingDuration = Date.now() - warmingStart;
			this.logger.log(`   ✅ All chart data warmed for ${label} (${totalWarmingDuration}ms)`);
		} catch (error) {
			const totalWarmingDuration = Date.now() - warmingStart;
			this.logger.error(`   ❌ Error warming chart data for ${label} (${totalWarmingDuration}ms): ${error.message}`);
			throw error;
		}
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
	private logCacheHealthStatus(label: string, cacheHealth: {
		aggregations: boolean;
		hourlySales: boolean;
		paymentTypes: boolean;
		conversionRate: boolean;
		masterData: boolean;
		salesLines: boolean;
		salesHeaders: boolean;
	}): void {
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
	 * Retry a function with exponential backoff
	 */
	private async retryWithBackoff<T>(
		fn: () => Promise<T>,
		maxRetries: number,
		label: string,
	): Promise<T> {
		let lastError: Error;
		
		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error;
				
				if (attempt < maxRetries - 1) {
					const delayMs = Math.min(1000 * Math.pow(2, attempt), 5000); // Max 5s delay
					this.logger.debug(`Retry ${attempt + 1}/${maxRetries} for ${label} after ${delayMs}ms`);
					await this.delay(delayMs);
				}
			}
		}
		
		throw lastError;
	}

	/**
	 * Delay helper
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Get common date ranges for caching
	 */
	private getCommonDateRanges(referenceDate: Date): Array<{
		label: string;
		startDate: string;
		endDate: string;
	}> {
		const today = this.formatDate(referenceDate);
		const currentYear = referenceDate.getFullYear();
		const currentMonth = referenceDate.getMonth(); // 0-11

		// Calculate date ranges
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

		// Last 30 days
		const last30Days = new Date(referenceDate);
		last30Days.setDate(last30Days.getDate() - 30);
		ranges.push({
			label: 'Last 30 Days',
			startDate: this.formatDate(last30Days),
			endDate: today,
		});

		// Last 90 days
		const last90Days = new Date(referenceDate);
		last90Days.setDate(last90Days.getDate() - 90);
		ranges.push({
			label: 'Last 90 Days',
			startDate: this.formatDate(last90Days),
			endDate: today,
		});

		// Current quarter
		const currentQuarter = Math.floor(currentMonth / 3);
		const quarterStartMonth = currentQuarter * 3;
		const quarterEndMonth = quarterStartMonth + 2;
		const quarterStart = new Date(currentYear, quarterStartMonth, 1);
		const quarterEnd = new Date(currentYear, quarterEndMonth + 1, 0);
		ranges.push({
			label: `Q${currentQuarter + 1} ${currentYear}`,
			startDate: this.formatDate(quarterStart),
			endDate: this.formatDate(quarterEnd),
		});

		// Previous quarter
		const prevQuarterStartMonth = quarterStartMonth - 3;
		const prevQuarterEndMonth = prevQuarterStartMonth + 2;
		const prevQuarterStart = new Date(currentYear, prevQuarterStartMonth, 1);
		const prevQuarterEnd = new Date(currentYear, prevQuarterEndMonth + 1, 0);
		ranges.push({
			label: `Previous Quarter`,
			startDate: this.formatDate(prevQuarterStart),
			endDate: this.formatDate(prevQuarterEnd),
		});

		// Month to date
		const monthStart = new Date(currentYear, currentMonth, 1);
		ranges.push({
			label: 'Month to Date',
			startDate: this.formatDate(monthStart),
			endDate: today,
		});

		// Year to date
		const yearStart = new Date(currentYear, 0, 1);
		ranges.push({
			label: 'Year to Date',
			startDate: this.formatDate(yearStart),
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

