import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { UsageEvent, UsageEventStatus, UsageEventType } from './entities/usage-event.entity';
import { UsageSummary, SummaryPeriod } from './entities/usage-summary.entity';
import { CreateUsageEventDto } from './dto/create-usage-event.dto';
import { UsageQueryDto, UsageSummaryQueryDto, UsageAnalyticsDto } from './dto/usage-query.dto';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { startOfHour, startOfDay, startOfWeek, startOfMonth, endOfHour, endOfDay, endOfWeek, endOfMonth, subDays, subHours, subWeeks, subMonths } from 'date-fns';

export interface UsageAnalytics {
	overview: {
		totalRequests: number;
		successfulRequests: number;
		failedRequests: number;
		errorRate: number;
		avgResponseTime: number;
		totalDataTransferred: number;
		uniqueUsers: number;
		peakRequestsPerHour: number;
	};
	trends: {
		period: string;
		date: string;
		requests: number;
		errors: number;
		avgResponseTime: number;
		uniqueUsers: number;
	}[];
	topEndpoints: {
		endpoint: string;
		requests: number;
		errorRate: number;
		avgResponseTime: number;
	}[];
	deviceBreakdown: Record<string, number>;
	browserBreakdown: Record<string, number>;
	geographicBreakdown: Record<string, number>;
	errorBreakdown: Record<string, number>;
	licenseUsage: {
		totalQuotaConsumed: number;
		featureBreakdown: Record<string, number>;
	};
}

@Injectable()
export class UsageTrackingService {
	private readonly logger = new Logger(UsageTrackingService.name);
	private readonly BATCH_SIZE = 1000;
	private readonly MAX_RETENTION_DAYS: number;

	constructor(
		@InjectRepository(UsageEvent)
		private usageEventRepository: Repository<UsageEvent>,
		@InjectRepository(UsageSummary)
		private usageSummaryRepository: Repository<UsageSummary>,
		private readonly configService: ConfigService,
	) {
		this.MAX_RETENTION_DAYS = this.configService.get<number>('USAGE_RETENTION_DAYS') || 365;
	}

	/**
	 * Record a new usage event
	 */
	async recordUsageEvent(createUsageEventDto: CreateUsageEventDto): Promise<UsageEvent> {
		const startTime = Date.now();
		this.logger.debug(`[RECORD_USAGE] Recording usage event for endpoint: ${createUsageEventDto.endpoint}`);

		try {
			const usageEvent = this.usageEventRepository.create(createUsageEventDto);
			const savedEvent = await this.usageEventRepository.save(usageEvent);

			const executionTime = Date.now() - startTime;
			this.logger.debug(`[RECORD_USAGE] Usage event recorded successfully: ${savedEvent.id} in ${executionTime}ms`);

			return savedEvent;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[RECORD_USAGE] Failed to record usage event after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Bulk record usage events for better performance
	 */
	async recordUsageEventsBatch(events: CreateUsageEventDto[]): Promise<void> {
		const startTime = Date.now();
		this.logger.debug(`[RECORD_USAGE_BATCH] Recording ${events.length} usage events in batch`);

		try {
			const usageEvents = events.map(event => this.usageEventRepository.create(event));
			await this.usageEventRepository.save(usageEvents);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[RECORD_USAGE_BATCH] Successfully recorded ${events.length} usage events in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[RECORD_USAGE_BATCH] Failed to record ${events.length} usage events after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Query usage events with filters and pagination
	 */
	async getUsageEvents(query: UsageQueryDto): Promise<PaginatedResponse<UsageEvent>> {
		const startTime = Date.now();
		this.logger.debug(`[GET_USAGE_EVENTS] Querying usage events with filters: ${JSON.stringify(query)}`);

		try {
			const queryBuilder = this.usageEventRepository.createQueryBuilder('event');

			// Apply filters
			if (query.userId) {
				queryBuilder.andWhere('event.userId = :userId', { userId: query.userId });
			}

			if (query.organisationId) {
				queryBuilder.andWhere('event.organisationId = :organisationId', { organisationId: query.organisationId });
			}

			if (query.branchId) {
				queryBuilder.andWhere('event.branchId = :branchId', { branchId: query.branchId });
			}

			if (query.endpoint) {
				queryBuilder.andWhere('LOWER(event.endpoint) LIKE LOWER(:endpoint)', { endpoint: `%${query.endpoint}%` });
			}

			if (query.eventType) {
				queryBuilder.andWhere('event.eventType = :eventType', { eventType: query.eventType });
			}

			if (query.status) {
				queryBuilder.andWhere('event.status = :status', { status: query.status });
			}

			if (query.startDate && query.endDate) {
				queryBuilder.andWhere('event.createdAt BETWEEN :startDate AND :endDate', {
					startDate: new Date(query.startDate),
					endDate: new Date(query.endDate),
				});
			}

			if (query.deviceType) {
				queryBuilder.andWhere('event.deviceType = :deviceType', { deviceType: query.deviceType });
			}

			if (query.browserName) {
				queryBuilder.andWhere('event.browserName = :browserName', { browserName: query.browserName });
			}

			if (query.osName) {
				queryBuilder.andWhere('event.osName = :osName', { osName: query.osName });
			}

			if (query.country) {
				queryBuilder.andWhere('event.country = :country', { country: query.country });
			}

			if (query.licenseFeature) {
				queryBuilder.andWhere('event.licenseFeature = :licenseFeature', { licenseFeature: query.licenseFeature });
			}

			// Include relations if needed
			if (query.includeMetadata) {
				queryBuilder.leftJoinAndSelect('event.user', 'user');
				queryBuilder.leftJoinAndSelect('event.organisation', 'organisation');
				queryBuilder.leftJoinAndSelect('event.branch', 'branch');
			}

			// Apply sorting
			queryBuilder.orderBy(`event.${query.sortBy}`, query.sortOrder);

			// Apply pagination
			const skip = (query.page - 1) * query.limit;
			queryBuilder.skip(skip).take(query.limit);

			const [events, total] = await queryBuilder.getManyAndCount();

			const executionTime = Date.now() - startTime;
			this.logger.log(`[GET_USAGE_EVENTS] Retrieved ${events.length} usage events from ${total} total in ${executionTime}ms`);

			return {
				data: events,
				meta: {
					total,
					page: query.page,
					limit: query.limit,
					totalPages: Math.ceil(total / query.limit),
				},
				message: 'Usage events retrieved successfully',
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[GET_USAGE_EVENTS] Failed to retrieve usage events after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get usage analytics for dashboards and reporting
	 */
	async getUsageAnalytics(query: UsageAnalyticsDto): Promise<UsageAnalytics> {
		const startTime = Date.now();
		this.logger.log(`[GET_USAGE_ANALYTICS] Generating analytics for period: ${query.startDate} to ${query.endDate}`);

		try {
			const startDate = new Date(query.startDate);
			const endDate = new Date(query.endDate);

			// Build base query
			const baseQuery = this.usageEventRepository.createQueryBuilder('event')
				.where('event.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate });

			if (query.organisationId) {
				baseQuery.andWhere('event.organisationId = :organisationId', { organisationId: query.organisationId });
			}

			if (query.userId) {
				baseQuery.andWhere('event.userId = :userId', { userId: query.userId });
			}

			if (query.endpoints?.length) {
				baseQuery.andWhere('event.endpoint IN (:...endpoints)', { endpoints: query.endpoints });
			}

			if (query.features?.length) {
				baseQuery.andWhere('event.licenseFeature IN (:...features)', { features: query.features });
			}

			// Generate overview statistics
			const overview = await this.generateOverviewStats(baseQuery);

			// Generate trends based on granularity
			const trends = await this.generateTrends(baseQuery, query.granularity, startDate, endDate);

			// Generate top endpoints
			const topEndpoints = await this.generateTopEndpoints(baseQuery);

			// Generate breakdowns
			const deviceBreakdown = await this.generateDeviceBreakdown(baseQuery);
			const browserBreakdown = await this.generateBrowserBreakdown(baseQuery);
			const geographicBreakdown = await this.generateGeographicBreakdown(baseQuery);
			const errorBreakdown = await this.generateErrorBreakdown(baseQuery);
			const licenseUsage = await this.generateLicenseUsage(baseQuery);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[GET_USAGE_ANALYTICS] Analytics generated successfully in ${executionTime}ms`);

			return {
				overview,
				trends,
				topEndpoints,
				deviceBreakdown,
				browserBreakdown,
				geographicBreakdown,
				errorBreakdown,
				licenseUsage,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[GET_USAGE_ANALYTICS] Failed to generate analytics after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Aggregate usage data into summaries (run periodically)
	 */
	@Cron(CronExpression.EVERY_HOUR)
	async aggregateUsageData(): Promise<void> {
		const startTime = Date.now();
		this.logger.log('[AGGREGATE_USAGE] Starting hourly usage data aggregation');

		try {
			const now = new Date();
			const hourStart = startOfHour(subHours(now, 1));
			const hourEnd = endOfHour(subHours(now, 1));

			await this.aggregateForPeriod(SummaryPeriod.HOURLY, hourStart, hourEnd);

			// Daily aggregation at the start of each day
			if (now.getHours() === 0) {
				const dayStart = startOfDay(subDays(now, 1));
				const dayEnd = endOfDay(subDays(now, 1));
				await this.aggregateForPeriod(SummaryPeriod.DAILY, dayStart, dayEnd);
			}

			// Weekly aggregation on Mondays
			if (now.getDay() === 1 && now.getHours() === 0) {
				const weekStart = startOfWeek(subWeeks(now, 1));
				const weekEnd = endOfWeek(subWeeks(now, 1));
				await this.aggregateForPeriod(SummaryPeriod.WEEKLY, weekStart, weekEnd);
			}

			// Monthly aggregation on the 1st of each month
			if (now.getDate() === 1 && now.getHours() === 0) {
				const monthStart = startOfMonth(subMonths(now, 1));
				const monthEnd = endOfMonth(subMonths(now, 1));
				await this.aggregateForPeriod(SummaryPeriod.MONTHLY, monthStart, monthEnd);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`[AGGREGATE_USAGE] Usage data aggregation completed in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[AGGREGATE_USAGE] Failed to aggregate usage data after ${executionTime}ms. Error: ${error.message}`, error.stack);
		}
	}

	/**
	 * Clean up old usage data (run daily)
	 */
	@Cron(CronExpression.EVERY_DAY_AT_2AM)
	async cleanupOldData(): Promise<void> {
		const startTime = Date.now();
		this.logger.log('[CLEANUP_USAGE] Starting cleanup of old usage data');

		try {
			const cutoffDate = subDays(new Date(), this.MAX_RETENTION_DAYS);

			const result = await this.usageEventRepository.delete({
				createdAt: LessThanOrEqual(cutoffDate),
			});

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLEANUP_USAGE] Cleaned up ${result.affected} old usage events in ${executionTime}ms`);
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLEANUP_USAGE] Failed to cleanup old usage data after ${executionTime}ms. Error: ${error.message}`, error.stack);
		}
	}

	private async aggregateForPeriod(period: SummaryPeriod, periodStart: Date, periodEnd: Date): Promise<void> {
		this.logger.debug(`[AGGREGATE_PERIOD] Aggregating ${period} data for ${periodStart} to ${periodEnd}`);

		// Get all unique combinations of org/user/endpoint for the period
		const combinations = await this.usageEventRepository
			.createQueryBuilder('event')
			.select(['event.organisationId', 'event.userId', 'event.branchId', 'event.endpoint'])
			.where('event.createdAt BETWEEN :periodStart AND :periodEnd', { periodStart, periodEnd })
			.groupBy('event.organisationId, event.userId, event.branchId, event.endpoint')
			.getRawMany();

		for (const combo of combinations) {
			await this.createOrUpdateSummary(period, periodStart, periodEnd, combo);
		}
	}

	private async createOrUpdateSummary(
		period: SummaryPeriod,
		periodStart: Date,
		periodEnd: Date,
		combo: any,
	): Promise<void> {
		// Calculate aggregated metrics
		const whereConditions: any = {
			userId: combo.userId || undefined,
			branchId: combo.branchId || undefined,
			endpoint: combo.endpoint,
			createdAt: Between(periodStart, periodEnd),
		};

		// Only add organisationId filter if it exists
		if (combo.organisationId) {
			whereConditions.organisationId = combo.organisationId;
		}

		const events = await this.usageEventRepository.find({
			where: whereConditions,
		});

		if (events.length === 0) return;

		const totalRequests = events.length;
		const successfulRequests = events.filter(e => e.status === UsageEventStatus.SUCCESS).length;
		const failedRequests = totalRequests - successfulRequests;
		const avgDurationMs = events.reduce((sum, e) => sum + e.durationMs, 0) / totalRequests;
		const minDurationMs = Math.min(...events.map(e => e.durationMs));
		const maxDurationMs = Math.max(...events.map(e => e.durationMs));

		// Create or update summary
		const existingSummaryWhere: any = {
			userId: combo.userId || undefined,
			branchId: combo.branchId || undefined,
			endpoint: combo.endpoint,
			period,
			periodStart,
		};

		// Only add organisationId filter if it exists
		if (combo.organisationId) {
			existingSummaryWhere.organisationId = combo.organisationId;
		}

		const existingSummary = await this.usageSummaryRepository.findOne({
			where: existingSummaryWhere,
		});

		const summaryData = {
			organisationId: combo.organisationId || undefined,
			userId: combo.userId || undefined,
			branchId: combo.branchId || undefined,
			endpoint: combo.endpoint,
			period,
			periodStart,
			periodEnd,
			totalRequests,
			successfulRequests,
			failedRequests,
			avgDurationMs,
			minDurationMs,
			maxDurationMs,
			errorRate: (failedRequests / totalRequests) * 100,
			lastAggregatedAt: new Date(),
		};

		if (existingSummary) {
			await this.usageSummaryRepository.update(existingSummary.id, summaryData);
		} else {
			await this.usageSummaryRepository.save(summaryData);
		}
	}

	private async generateOverviewStats(baseQuery: any): Promise<any> {
		const stats = await baseQuery
			.select([
				'COUNT(*) as totalRequests',
				'SUM(CASE WHEN event.status = :successStatus THEN 1 ELSE 0 END) as successfulRequests',
				'SUM(CASE WHEN event.status != :successStatus THEN 1 ELSE 0 END) as failedRequests',
				'AVG(event.durationMs) as avgResponseTime',
				'SUM(COALESCE(event.requestSizeBytes, 0) + COALESCE(event.responseSizeBytes, 0)) as totalDataTransferred',
				'COUNT(DISTINCT event.userId) as uniqueUsers',
			])
			.setParameter('successStatus', UsageEventStatus.SUCCESS)
			.getRawOne();

		const errorRate = stats.totalRequests > 0 ? (stats.failedRequests / stats.totalRequests) * 100 : 0;

		return {
			totalRequests: parseInt(stats.totalRequests),
			successfulRequests: parseInt(stats.successfulRequests),
			failedRequests: parseInt(stats.failedRequests),
			errorRate: parseFloat(errorRate.toFixed(4)),
			avgResponseTime: parseFloat(stats.avgResponseTime || 0),
			totalDataTransferred: parseInt(stats.totalDataTransferred || 0),
			uniqueUsers: parseInt(stats.uniqueUsers || 0),
			peakRequestsPerHour: 0, // TODO: Calculate peak
		};
	}

	private async generateTrends(baseQuery: any, granularity: SummaryPeriod, startDate: Date, endDate: Date): Promise<any[]> {
		// Implementation depends on granularity - simplified version
		return [];
	}

	private async generateTopEndpoints(baseQuery: any): Promise<any[]> {
		return await baseQuery
			.select([
				'event.endpoint',
				'COUNT(*) as requests',
				'AVG(event.durationMs) as avgResponseTime',
				'(SUM(CASE WHEN event.status != :successStatus THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as errorRate',
			])
			.groupBy('event.endpoint')
			.orderBy('requests', 'DESC')
			.limit(10)
			.setParameter('successStatus', UsageEventStatus.SUCCESS)
			.getRawMany();
	}

	private async generateDeviceBreakdown(baseQuery: any): Promise<Record<string, number>> {
		const results = await baseQuery
			.select(['event.deviceType', 'COUNT(*) as count'])
			.where('event.deviceType IS NOT NULL')
			.groupBy('event.deviceType')
			.getRawMany();

		return results.reduce((acc, result) => {
			acc[result.deviceType] = parseInt(result.count);
			return acc;
		}, {});
	}

	private async generateBrowserBreakdown(baseQuery: any): Promise<Record<string, number>> {
		const results = await baseQuery
			.select(['event.browserName', 'COUNT(*) as count'])
			.where('event.browserName IS NOT NULL')
			.groupBy('event.browserName')
			.getRawMany();

		return results.reduce((acc, result) => {
			acc[result.browserName] = parseInt(result.count);
			return acc;
		}, {});
	}

	private async generateGeographicBreakdown(baseQuery: any): Promise<Record<string, number>> {
		const results = await baseQuery
			.select(['event.country', 'COUNT(*) as count'])
			.where('event.country IS NOT NULL')
			.groupBy('event.country')
			.getRawMany();

		return results.reduce((acc, result) => {
			acc[result.country] = parseInt(result.count);
			return acc;
		}, {});
	}

	private async generateErrorBreakdown(baseQuery: any): Promise<Record<string, number>> {
		const results = await baseQuery
			.select(['event.httpStatusCode', 'COUNT(*) as count'])
			.where('event.status != :successStatus')
			.groupBy('event.httpStatusCode')
			.setParameter('successStatus', UsageEventStatus.SUCCESS)
			.getRawMany();

		return results.reduce((acc, result) => {
			acc[result.httpStatusCode] = parseInt(result.count);
			return acc;
		}, {});
	}

	private async generateLicenseUsage(baseQuery: any): Promise<any> {
		const totalQuota = await baseQuery
			.select('SUM(COALESCE(event.licenseQuotaConsumed, 0)) as total')
			.getRawOne();

		const featureBreakdown = await baseQuery
			.select(['event.licenseFeature', 'SUM(COALESCE(event.licenseQuotaConsumed, 0)) as consumed'])
			.where('event.licenseFeature IS NOT NULL')
			.groupBy('event.licenseFeature')
			.getRawMany();

		return {
			totalQuotaConsumed: parseInt(totalQuota.total || 0),
			featureBreakdown: featureBreakdown.reduce((acc, result) => {
				acc[result.licenseFeature] = parseInt(result.consumed);
				return acc;
			}, {}),
		};
	}
}