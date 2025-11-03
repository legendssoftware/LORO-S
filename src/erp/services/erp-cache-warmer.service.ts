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
	 * Processes in batches to avoid overwhelming the database connection pool
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

		// ✅ Process date ranges in BATCHES to avoid connection pool exhaustion
		// Each date range runs 4 parallel queries, so batch size of 2 = max 8 concurrent queries
		const BATCH_SIZE = 2;
		
		for (let i = 0; i < dateRanges.length; i += BATCH_SIZE) {
			const batch = dateRanges.slice(i, i + BATCH_SIZE);
			
			this.logger.debug(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(dateRanges.length / BATCH_SIZE)}`);
			
			const results = await Promise.allSettled(
				batch.map(async ({ label, startDate, endDate }) => {
					const rangeStart = Date.now();
					try {
						this.logger.log(`Warming cache: ${label} (${startDate} to ${endDate})`);
						
						const filters: ErpQueryFilters = { startDate, endDate };
						
						// Retry logic with exponential backoff
						await this.retryWithBackoff(
							() => this.erpDataService.getAllAggregationsParallel(filters),
							3, // max retries
							label,
						);
						
						const rangeDuration = Date.now() - rangeStart;
						successCount++;
						this.logger.log(`✅ Successfully warmed cache for: ${label} (${rangeDuration}ms)`);
					} catch (error) {
						const rangeDuration = Date.now() - rangeStart;
						errorCount++;
						this.logger.warn(`❌ Failed to warm cache for ${label} (${rangeDuration}ms): ${error.message}`);
					}
				})
			);
			
			// Small delay between batches to let connection pool recover
			if (i + BATCH_SIZE < dateRanges.length) {
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

