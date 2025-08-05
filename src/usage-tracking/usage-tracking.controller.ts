import { Controller, Get, Post, Body, Query, UseGuards, HttpStatus, HttpCode, Logger } from '@nestjs/common';
import { UsageTrackingService, UsageAnalytics } from './usage-tracking.service';
import { CreateUsageEventDto } from './dto/create-usage-event.dto';
import { UsageQueryDto, UsageSummaryQueryDto, UsageAnalyticsDto } from './dto/usage-query.dto';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { UsageEvent } from './entities/usage-event.entity';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';

@Controller('usage-tracking')
@UseGuards(AuthGuard)
export class UsageTrackingController {
	private readonly logger = new Logger(UsageTrackingController.name);

	constructor(private readonly usageTrackingService: UsageTrackingService) {}

	/**
	 * Record a single usage event
	 * This endpoint is typically called by internal services
	 */
	@Post('events')
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER)
	async recordUsageEvent(@Body() createUsageEventDto: CreateUsageEventDto): Promise<{ message: string; data: UsageEvent }> {
		const startTime = Date.now();
		this.logger.log(`[RECORD_EVENT] Recording usage event for endpoint: ${createUsageEventDto.endpoint}`);

		try {
			const usageEvent = await this.usageTrackingService.recordUsageEvent(createUsageEventDto);
			
			const executionTime = Date.now() - startTime;
			this.logger.log(`[RECORD_EVENT] Usage event recorded successfully in ${executionTime}ms`);

			return {
				message: 'Usage event recorded successfully',
				data: usageEvent,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[RECORD_EVENT] Failed to record usage event after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Record multiple usage events in batch
	 * This endpoint is for bulk operations
	 */
	@Post('events/batch')
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER)
	async recordUsageEventsBatch(@Body() events: CreateUsageEventDto[]): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`[RECORD_BATCH] Recording ${events.length} usage events in batch`);

		try {
			await this.usageTrackingService.recordUsageEventsBatch(events);
			
			const executionTime = Date.now() - startTime;
			this.logger.log(`[RECORD_BATCH] Batch usage events recorded successfully in ${executionTime}ms`);

			return {
				message: `${events.length} usage events recorded successfully`,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[RECORD_BATCH] Failed to record batch usage events after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get usage events with filtering and pagination
	 */
	@Get('events')
	@UseGuards(RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER, AccessLevel.MANAGER)
	async getUsageEvents(@Query() query: UsageQueryDto): Promise<PaginatedResponse<UsageEvent>> {
		const startTime = Date.now();
		this.logger.log(`[GET_EVENTS] Retrieving usage events with filters`);

		try {
			const result = await this.usageTrackingService.getUsageEvents(query);
			
			const executionTime = Date.now() - startTime;
			this.logger.log(`[GET_EVENTS] Retrieved ${result.data.length} usage events in ${executionTime}ms`);

			return result;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[GET_EVENTS] Failed to retrieve usage events after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get usage analytics for dashboards and reporting
	 */
	@Get('analytics')
	@UseGuards(RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER, AccessLevel.MANAGER)
	async getUsageAnalytics(@Query() query: UsageAnalyticsDto): Promise<{ message: string; data: UsageAnalytics }> {
		const startTime = Date.now();
		this.logger.log(`[GET_ANALYTICS] Generating usage analytics for period: ${query.startDate} to ${query.endDate}`);

		try {
			const analytics = await this.usageTrackingService.getUsageAnalytics(query);
			
			const executionTime = Date.now() - startTime;
			this.logger.log(`[GET_ANALYTICS] Usage analytics generated successfully in ${executionTime}ms`);

			return {
				message: 'Usage analytics generated successfully',
				data: analytics,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[GET_ANALYTICS] Failed to generate usage analytics after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get aggregated usage summaries
	 */
	@Get('summaries')
	@UseGuards(RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER, AccessLevel.MANAGER)
	async getUsageSummaries(@Query() query: UsageSummaryQueryDto): Promise<{ message: string; data: any[] }> {
		const startTime = Date.now();
		this.logger.log(`[GET_SUMMARIES] Retrieving usage summaries for ${query.period} period`);

		try {
			// Implementation would query UsageSummary repository
			// For now, return placeholder
			const summaries = [];
			
			const executionTime = Date.now() - startTime;
			this.logger.log(`[GET_SUMMARIES] Retrieved ${summaries.length} usage summaries in ${executionTime}ms`);

			return {
				message: 'Usage summaries retrieved successfully',
				data: summaries,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[GET_SUMMARIES] Failed to retrieve usage summaries after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Trigger manual aggregation of usage data
	 * This is typically automated but can be manually triggered
	 */
	@Post('aggregate')
	@HttpCode(HttpStatus.OK)
	@UseGuards(RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER)
	async triggerAggregation(): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`[TRIGGER_AGGREGATION] Manually triggering usage data aggregation`);

		try {
			await this.usageTrackingService.aggregateUsageData();
			
			const executionTime = Date.now() - startTime;
			this.logger.log(`[TRIGGER_AGGREGATION] Usage data aggregation completed in ${executionTime}ms`);

			return {
				message: 'Usage data aggregation completed successfully',
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[TRIGGER_AGGREGATION] Failed to aggregate usage data after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get organization license usage summary
	 */
	@Get('license-usage/:orgId')
	@UseGuards(RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER, AccessLevel.MANAGER)
	async getLicenseUsage(
		@Query('orgId') orgId: number,
		@Query('startDate') startDate: string,
		@Query('endDate') endDate: string,
	): Promise<{ message: string; data: any }> {
		const startTime = Date.now();
		this.logger.log(`[GET_LICENSE_USAGE] Retrieving license usage for organization: ${orgId}`);

		try {
			const query: UsageAnalyticsDto = {
				organisationId: orgId,
				startDate,
				endDate,
				metrics: ['usage'],
			};

			const analytics = await this.usageTrackingService.getUsageAnalytics(query);
			
			const executionTime = Date.now() - startTime;
			this.logger.log(`[GET_LICENSE_USAGE] License usage retrieved successfully in ${executionTime}ms`);

			return {
				message: 'License usage retrieved successfully',
				data: {
					organisationId: orgId,
					period: { startDate, endDate },
					licenseUsage: analytics.licenseUsage,
					totalRequests: analytics.overview.totalRequests,
					errorRate: analytics.overview.errorRate,
				},
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[GET_LICENSE_USAGE] Failed to retrieve license usage after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw error;
		}
	}
}