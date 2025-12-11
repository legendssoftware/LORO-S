import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ErpDataService } from './erp-data.service';
import { ErpQueryFilters } from '../interfaces/erp-data.interface';

/**
 * ERP Cache Warmer Service
 * 
 * Pre-caches common date ranges (Today, Last 7 Days, Last 30 Days, Today to 1 Month Back)
 * using parallel query execution for optimal performance.
 * 
 * Strategy:
 * - Cache TTL: 10 minutes (reduced from 4 hours for faster updates)
 * - Today's data refreshed every 5 minutes
 * - Full cache warming every 20 minutes
 */
@Injectable()
export class ErpCacheWarmerService implements OnModuleInit {
	private readonly logger = new Logger(ErpCacheWarmerService.name);

	// Query groups for parallel execution
	private readonly QUERY_GROUPS = {
		GROUP_A: [
			{ name: 'aggregations', method: (filters: ErpQueryFilters) => this.erpDataService.getAllAggregationsParallel(filters) },
			{ name: 'hourlySales', method: (filters: ErpQueryFilters) => this.erpDataService.getHourlySalesPattern(filters) },
			{ name: 'paymentTypes', method: (filters: ErpQueryFilters) => this.erpDataService.getPaymentTypeAggregations(filters) },
			{ name: 'conversionRate', method: (filters: ErpQueryFilters) => this.erpDataService.getConversionRateData(filters) },
		],
		GROUP_B: [
			{ name: 'masterData', method: (filters: ErpQueryFilters) => this.erpDataService.getMasterDataForFilters(filters) },
			{ name: 'salesLines', method: (filters: ErpQueryFilters) => this.erpDataService.getSalesLinesByDateRange(filters) },
			{ name: 'salesHeaders', method: (filters: ErpQueryFilters) => this.erpDataService.getSalesHeadersByDateRange(filters) },
		],
	};

	private readonly DELAY_BETWEEN_RANGES = 500; // Reduced from 2000ms

	constructor(private readonly erpDataService: ErpDataService) {}

	async onModuleInit() {
		this.logger.log('ERP Cache Warmer: Initializing...');
		this.logger.log('📅 Cache warming strategy: Today to 1 month back');
		this.logger.log('⏱️  Today refresh interval: Every 5 minutes');
		this.logger.log('⏱️  Full cache warm interval: Every 20 minutes');
		// Defer initial cache warming to allow app to fully start and avoid memory pressure during startup
		// Increased from 5 seconds to 30 seconds to prevent OOM errors
		setTimeout(() => {
			this.warmCommonDateRanges().catch((error) => {
				this.logger.error(`Initial cache warming failed: ${error.message}`);
			});
		}, 30000); // 30 seconds delay to allow app to fully initialize
		this.startIntervalCacheWarming();
	}

	@Cron('0 9,16 * * *')
	async warmCacheTwiceDaily() {
		try {
			await this.warmCommonDateRanges();
		} catch (error) {
			this.logger.error(`Daily cache warming failed: ${error.message}`);
		}
	}

	private startIntervalCacheWarming() {
		// Refresh today's data every 5 minutes
		const todayRefreshIntervalMs = 5 * 60 * 1000; // 5 minutes
		setInterval(async () => {
			try {
				await this.refreshTodayData();
			} catch (error) {
				this.logger.error(`Today's data refresh failed: ${error.message}`);
			}
		}, todayRefreshIntervalMs);

		// Full cache warming every 20 minutes
		const fullWarmIntervalMs = 20 * 60 * 1000; // 20 minutes
		setInterval(async () => {
			try {
				await this.warmCommonDateRanges();
			} catch (error) {
				this.logger.error(`Interval cache warming failed: ${error.message}`);
			}
		}, fullWarmIntervalMs);
	}

	/**
	 * Refresh only today's data (faster than full cache warming)
	 * Called every 5 minutes to keep today's numbers fresh
	 */
	private async refreshTodayData(): Promise<void> {
		const today = this.formatDate(new Date());
		const filters: ErpQueryFilters = { startDate: today, endDate: today };
		const startTime = Date.now();

		try {
			this.logger.log(`🔄 Refreshing today's data (${today})...`);
			await this.warmAllChartData(filters);
			const duration = Date.now() - startTime;
			this.logger.log(`✅ Today's data refreshed in ${(duration / 1000).toFixed(1)}s`);
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.warn(`❌ Today's data refresh failed (${(duration / 1000).toFixed(1)}s): ${error.message}`);
		}
	}

	async warmCommonDateRanges(): Promise<void> {
		const dateRanges = this.getCommonDateRanges(new Date());
		const startTime = Date.now();

		// Warm Today first (highest priority), then others in parallel
		const todayRange = dateRanges.find(r => r.label === 'Today');
		const otherRanges = dateRanges.filter(r => r.label !== 'Today');

		if (todayRange) {
			await this.warmDateRange(todayRange);
			if (otherRanges.length > 0) {
				await this.delay(this.DELAY_BETWEEN_RANGES);
			}
		}

		// Warm remaining ranges sequentially
		for (const range of otherRanges) {
			await this.warmDateRange(range);
			if (range !== otherRanges[otherRanges.length - 1]) {
				await this.delay(this.DELAY_BETWEEN_RANGES);
			}
		}

		const duration = Date.now() - startTime;
		this.logger.log(`Cache warming complete: ${dateRanges.length} ranges in ${(duration / 1000).toFixed(1)}s`);
	}

	private async warmDateRange(range: { label: string; startDate: string; endDate: string }): Promise<void> {
		const filters: ErpQueryFilters = { startDate: range.startDate, endDate: range.endDate };
		const rangeStart = Date.now();

		try {
			await this.warmAllChartData(filters);
			const duration = Date.now() - rangeStart;
			this.logger.log(`✅ ${range.label}: ${(duration / 1000).toFixed(1)}s`);
		} catch (error) {
			const duration = Date.now() - rangeStart;
			this.logger.warn(`❌ ${range.label} failed (${(duration / 1000).toFixed(1)}s): ${error.message}`);
		}
	}

	/**
	 * Warm all chart data queries using parallel execution groups
	 * Group A (4 queries) runs in parallel, then Group B (3 queries) runs in parallel
	 */
	private async warmAllChartData(filters: ErpQueryFilters): Promise<void> {
		// Execute Group A queries in parallel
		await Promise.allSettled(
			this.QUERY_GROUPS.GROUP_A.map(query => 
				query.method(filters).catch(() => {}) // Silently handle failures
			)
		);

		// Execute Group B queries in parallel
		await Promise.allSettled(
			this.QUERY_GROUPS.GROUP_B.map(query => 
				query.method(filters).catch(() => {}) // Silently handle failures
			)
		);
	}

	/**
	 * Delay helper
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Get common date ranges for caching: Today, Last 7 Days, Last 30 Days, Today to 1 Month Back
	 */
	private getCommonDateRanges(referenceDate: Date): Array<{
		label: string;
		startDate: string;
		endDate: string;
	}> {
		const today = this.formatDate(referenceDate);
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

		// Today to 1 month back (for initial cache warming)
		const oneMonthBack = new Date(referenceDate);
		oneMonthBack.setMonth(oneMonthBack.getMonth() - 1);
		ranges.push({
			label: 'Today to 1 Month Back',
			startDate: this.formatDate(oneMonthBack),
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

	async triggerCacheWarming(): Promise<{ success: boolean; message: string }> {
		try {
			await this.warmCommonDateRanges();
			return { success: true, message: 'Cache warming completed successfully' };
		} catch (error) {
			this.logger.error(`Manual cache warming failed: ${error.message}`);
			return { success: false, message: `Cache warming failed: ${error.message}` };
		}
	}

	async refreshCache(): Promise<{ success: boolean; message: string }> {
		try {
			await this.erpDataService.clearCache();
			await this.warmCommonDateRanges();
			return { success: true, message: 'Cache refreshed successfully' };
		} catch (error) {
			this.logger.error(`Cache refresh failed: ${error.message}`);
			return { success: false, message: `Cache refresh failed: ${error.message}` };
		}
	}
}
