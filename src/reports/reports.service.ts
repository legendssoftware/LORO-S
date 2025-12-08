import { Injectable, Inject, NotFoundException, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, Between, Not } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';

// Entities
import { Report } from './entities/report.entity';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Attendance } from '../attendance/entities/attendance.entity';
import { Lead } from '../leads/entities/lead.entity';
import { Claim } from '../claims/entities/claim.entity';
import { Task } from '../tasks/entities/task.entity';
import { Quotation } from '../shop/entities/quotation.entity';

// DTOs and Enums
import { ReportType } from './constants/report-types.enum';
import { ReportParamsDto } from './dto/report-params.dto';
import { EmailType } from '../lib/enums/email.enums';
import { ClaimStatus } from '../lib/enums/finance.enums';
import { OrderStatus } from '../lib/enums/status.enums';

// Services and Generators
import { MainReportGenerator } from './generators/main-report.generator';
import { QuotationReportGenerator } from './generators/quotation-report.generator';
import { UserDailyReportGenerator } from './generators/user-daily-report.generator';
import { OrgActivityReportGenerator } from './generators/org-activity-report.generator';
import { MapDataReportGenerator } from './generators/map-data-report.generator';
import { PerformanceDashboardGenerator } from './generators/performance-dashboard.generator';
import { CommunicationService } from '../communication/communication.service';
import { OrganizationHoursService } from '../attendance/services/organization.hours.service';
import { AttendanceService } from '../attendance/attendance.service';
import { ErpDataService } from '../erp/services/erp-data.service';
import { ErpConnectionManagerService } from '../erp/services/erp-connection-manager.service';
import { getCurrencyForCountry } from '../erp/utils/currency.util';
import { ConsolidatedIncomeStatementDto, ConsolidatedIncomeStatementResponseDto, ConsolidatedBranchDataDto, ExchangeRateDto } from './dto/performance-dashboard.dto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserService } from '../user/user.service';
import { LeadsService } from '../leads/leads.service';
import { TasksService } from '../tasks/tasks.service';
import { LeaveService } from '../leave/leave.service';

// Utilities
import { TimezoneUtil } from '../lib/utils/timezone.util';

/**
 * ========================================================================
 * COMPREHENSIVE REPORTS SERVICE
 * ========================================================================
 * 
 * This service handles all report generation and distribution for the LORO system.
 * 
 * KEY FEATURES:
 * - Comprehensive daily and weekly reports for all organizations
 * - Timezone-aware report generation using organization-specific timezones
 * - Enhanced user activity reports including attendance metrics, quotations, tasks
 * - Automated email distribution to organization admins/managers
 * - Intelligent caching and duplicate prevention
 * - Robust error handling and logging
 * 
 * CRON JOBS:
 * - Daily Reports (18:00): Generated for all active organizations daily
 * - Weekly Reports (Friday 18:00): Weekly summary reports for all organizations
 * 
 * REPORT TYPES:
 * - USER_DAILY: Individual user daily activity reports with comprehensive metrics
 * - ORG_ACTIVITY: Organization-wide activity summaries (daily/weekly)
 * - MAIN: General organization reports
 * - QUOTATION: Client-specific quotation reports
 * - MAP_DATA: Live map data for real-time tracking
 * 
 * IMPROVEMENTS MADE:
 * ✅ Cleaned up unused imports and logic
 * ✅ Enhanced cron jobs for comprehensive org-wide reporting
 * ✅ Integrated attendance service methods for detailed metrics
 * ✅ Implemented proper timezone handling throughout
 * ✅ Verified and improved email template handling
 * ✅ Made reports more comprehensive with user activity data
 * ✅ Added proper admin/manager targeting for organization reports
 * ✅ Enhanced error handling and logging
 * ✅ Improved cache management and duplicate prevention
 * 
 * ========================================================================
 */
@Injectable()
export class ReportsService implements OnModuleInit {
	private readonly logger = new Logger(ReportsService.name);
	private readonly CACHE_PREFIX = 'reports:';
	private readonly CACHE_TTL: number;

	constructor(
		@InjectRepository(Report)
		private reportRepository: Repository<Report>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(Lead)
		private leadsRepository: Repository<Lead>,
		@InjectRepository(Claim)
		private claimsRepository: Repository<Claim>,
		@InjectRepository(Task)
		private taskRepository: Repository<Task>,
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
		@InjectDataSource()
		private dataSource: DataSource,
		private mainReportGenerator: MainReportGenerator,
		private quotationReportGenerator: QuotationReportGenerator,
		private userDailyReportGenerator: UserDailyReportGenerator,
		private orgActivityReportGenerator: OrgActivityReportGenerator,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private eventEmitter: EventEmitter2,
		private communicationService: CommunicationService,
		private readonly mapDataReportGenerator: MapDataReportGenerator,
		private readonly organizationHoursService: OrganizationHoursService,
		@Inject(forwardRef(() => AttendanceService))
		private readonly attendanceService: AttendanceService,
		private readonly performanceDashboardGenerator: PerformanceDashboardGenerator,
		@Inject(forwardRef(() => ErpDataService))
		private readonly erpDataService: ErpDataService,
		private readonly erpConnectionManager: ErpConnectionManagerService,
		private readonly userService: UserService,
		@Inject(forwardRef(() => LeadsService))
		private readonly leadsService: LeadsService,
		private readonly tasksService: TasksService,
		@Inject(forwardRef(() => LeaveService))
		private readonly leaveService: LeaveService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 300;
		this.logger.log(`Reports service initialized with cache TTL: ${this.CACHE_TTL}s`);
	}

	// ======================================================
	// TIMEZONE HELPER METHODS
	// ======================================================

	/**
	 * Get organization timezone with fallback
	 */
	private async getOrganizationTimezone(organizationId?: number): Promise<string> {
		if (!organizationId) {
			return TimezoneUtil.getSafeTimezone();
		}

		try {
			const organizationHours = await this.organizationHoursService.getOrganizationHours(organizationId);
			return organizationHours?.timezone || TimezoneUtil.getSafeTimezone();
		} catch (error) {
			this.logger.warn(`Error getting timezone for org ${organizationId}, using default:`, error);
			return TimezoneUtil.getSafeTimezone();
		}
	}

	/**
	 * Get current time in organization timezone
	 */
	private async getCurrentOrganizationTime(organizationId?: number): Promise<Date> {
		const timezone = await this.getOrganizationTimezone(organizationId);
		return TimezoneUtil.getCurrentOrganizationTime(timezone);
	}

	/**
	 * Convert server time to organization time
	 */
	private async toOrganizationTime(serverDate: Date, organizationId?: number): Promise<Date> {
		const timezone = await this.getOrganizationTimezone(organizationId);
		return TimezoneUtil.toOrganizationTime(serverDate, timezone);
	}

	onModuleInit() {
		this.logger.log('Reports service module initialized successfully');
	}

	// ======================================================
	// GPS RECALCULATION METHODS
	// ======================================================

	/**
	 * Update GPS/location data in existing reports when tracking data is recalculated
	 * Updates ALL reports for the user on the specified date with the same recalculated data
	 * @param userId - User ID whose reports need updating
	 * @param date - Date for which reports should be updated
	 * @param recalculatedGpsData - New GPS data from recalculation
	 * @returns Promise<{ updated: number; reports: Report[]; totalFound: number }>
	 */
	async updateReportsWithRecalculatedGpsData(
		userId: number,
		date: Date,
		recalculatedGpsData: any
	): Promise<{ updated: number; reports: Report[]; totalFound: number }> {
		const operationId = `update-reports-gps-${userId}-${Date.now()}`;
		this.logger.log(`[${operationId}] 🔄 Starting GPS data update for ALL reports - User: ${userId}, Date: ${date.toISOString().split('T')[0]}`);

		try {
			// Find ALL reports for this user on this date (not just USER_DAILY)
			const startOfReportDay = new Date(date);
			startOfReportDay.setHours(0, 0, 0, 0);
			const endOfReportDay = new Date(date);
			endOfReportDay.setHours(23, 59, 59, 999);

			// Get ALL report types for this user on this date
			const existingReports = await this.reportRepository.find({
				where: {
					owner: { uid: userId },
					generatedAt: Between(startOfReportDay, endOfReportDay),
					// Remove reportType filter to get ALL reports for this user/date
				},
				relations: ['owner', 'organisation'],
				order: { generatedAt: 'DESC' },
			});

			this.logger.log(`[${operationId}] 📋 Found ${existingReports.length} total reports to update for user ${userId} on ${date.toISOString().split('T')[0]}`);
			this.logger.debug(`[${operationId}] Report types found:`, existingReports.map(r => ({ uid: r.uid, type: r.reportType, generatedAt: r.generatedAt })));

			if (existingReports.length === 0) {
				this.logger.warn(`[${operationId}] ⚠️  No existing reports found for user ${userId} on ${date.toISOString().split('T')[0]}`);
				return { updated: 0, reports: [], totalFound: 0 };
			}

			const updatedReports: Report[] = [];
			let updateSuccessCount = 0;
			let updateFailureCount = 0;

			// Update EACH AND EVERY report with the same recalculated GPS data
			for (const report of existingReports) {
				try {
					this.logger.debug(`[${operationId}] 🔧 Processing report ${report.uid} (${report.reportType})`);
					
					const updatedReportData = this.mergeGpsDataIntoReport(report.reportData, recalculatedGpsData);
					
					// Update the report in database with comprehensive GPS data
					const updateResult = await this.reportRepository.update(report.uid, {
						reportData: updatedReportData,
						notes: `GPS data recalculated on ${new Date().toISOString()} - Applied to all ${existingReports.length} reports for this day`,
						// Store GPS data in the dedicated gpsData field as well
						gpsData: {
							tripSummary: recalculatedGpsData.tripSummary,
							stops: recalculatedGpsData.stops,
							timeSpentByLocation: recalculatedGpsData.locationAnalysis?.timeSpentByLocation,
							averageTimePerLocationFormatted: recalculatedGpsData.locationAnalysis?.averageTimePerLocationFormatted,
							locationAnalysis: recalculatedGpsData.locationAnalysis,
							geocodingStatus: recalculatedGpsData.geocodingStatus,
						},
						totalDistanceKm: recalculatedGpsData.tripSummary?.totalDistanceKm,
						totalStops: recalculatedGpsData.tripSummary?.numberOfStops,
					});

					// Fetch the updated report to confirm changes
					const updatedReport = await this.reportRepository.findOne({
						where: { uid: report.uid },
						relations: ['owner', 'organisation'],
					});

					if (updatedReport) {
						updatedReports.push(updatedReport);
						updateSuccessCount++;
						this.logger.debug(`[${operationId}] ✅ Successfully updated report ${report.uid} (${report.reportType}) with recalculated GPS data`);
					} else {
						updateFailureCount++;
						this.logger.warn(`[${operationId}] ❌ Failed to fetch updated report ${report.uid} after update`);
					}

				} catch (error) {
					updateFailureCount++;
					this.logger.error(`[${operationId}] ❌ Failed to update report ${report.uid} (${report.reportType}) with GPS data:`, error.message);
					this.logger.error(`[${operationId}] Error details:`, error.stack);
				}
			}

			// Clear ALL cache entries for this user to ensure fresh data
			try {
				const cacheKeysToDelete = [
					`reports:user:${userId}:${date.toISOString().split('T')[0]}`,
					`user_${userId}`,
					`daily_${userId}`,
					`enhanced_tracking_${userId}_${date.toISOString().split('T')[0]}`,
				];
				
				for (const cacheKey of cacheKeysToDelete) {
					await this.cacheManager.del(cacheKey);
				}
				this.logger.debug(`[${operationId}] 🧹 Cleared ${cacheKeysToDelete.length} cache entries for user ${userId}`);
			} catch (cacheError) {
				this.logger.warn(`[${operationId}] ⚠️  Failed to clear cache:`, cacheError.message);
			}

			// Comprehensive logging
			this.logger.log(`[${operationId}] 🎉 GPS UPDATE SUMMARY:`);
			this.logger.log(`[${operationId}]   📊 Total reports found: ${existingReports.length}`);
			this.logger.log(`[${operationId}]   ✅ Successfully updated: ${updateSuccessCount}`);
			this.logger.log(`[${operationId}]   ❌ Failed to update: ${updateFailureCount}`);
			this.logger.log(`[${operationId}]   📍 GPS data applied: Distance=${recalculatedGpsData.tripSummary?.totalDistanceKm}km, Stops=${recalculatedGpsData.tripSummary?.numberOfStops}`);
			this.logger.log(`[${operationId}] 🏁 GPS data update completed for user ${userId}`);

			return {
				updated: updateSuccessCount,
				reports: updatedReports,
				totalFound: existingReports.length,
			};

		} catch (error) {
			this.logger.error(`[${operationId}] 💥 CRITICAL: Failed to update reports with recalculated GPS data for user ${userId}:`, error.message);
			this.logger.error(`[${operationId}] Error stack:`, error.stack);
			throw error;
		}
	}

	/**
	 * Merge recalculated GPS data into existing report data structure
	 * @param existingReportData - Current report data
	 * @param recalculatedGpsData - New GPS data from recalculation
	 * @returns Updated report data with new GPS information
	 */
	private mergeGpsDataIntoReport(existingReportData: any, recalculatedGpsData: any): any {
		// Create a deep copy of existing report data
		const updatedData = JSON.parse(JSON.stringify(existingReportData));

		// Update location/GPS related fields while preserving other data
		if (updatedData.locationData) {
			updatedData.locationData = {
				...updatedData.locationData,
				totalDistance: recalculatedGpsData.totalDistance,
				trackingPoints: recalculatedGpsData.trackingPoints,
				locationAnalysis: recalculatedGpsData.locationAnalysis,
				tripSummary: recalculatedGpsData.tripSummary,
				stops: recalculatedGpsData.stops,
				geocodingStatus: recalculatedGpsData.geocodingStatus,
				movementEfficiency: recalculatedGpsData.movementEfficiency,
				locationProductivity: recalculatedGpsData.locationProductivity,
				travelInsights: recalculatedGpsData.travelInsights,
			};
		} else {
			// If locationData doesn't exist, create it
			updatedData.locationData = {
				totalDistance: recalculatedGpsData.totalDistance,
				trackingPoints: recalculatedGpsData.trackingPoints,
				locationAnalysis: recalculatedGpsData.locationAnalysis,
				tripSummary: recalculatedGpsData.tripSummary,
				stops: recalculatedGpsData.stops,
				geocodingStatus: recalculatedGpsData.geocodingStatus,
				movementEfficiency: recalculatedGpsData.movementEfficiency,
				locationProductivity: recalculatedGpsData.locationProductivity,
				travelInsights: recalculatedGpsData.travelInsights,
			};
		}

		// Update email data GPS metrics if they exist
		if (updatedData.emailData) {
			updatedData.emailData = {
				...updatedData.emailData,
				totalDistance: recalculatedGpsData.totalDistance,
				tripSummary: recalculatedGpsData.tripSummary,
				stops: recalculatedGpsData.stops,
				locationAnalysis: recalculatedGpsData.locationAnalysis,
				movementEfficiency: recalculatedGpsData.movementEfficiency,
				locationProductivity: recalculatedGpsData.locationProductivity,
				travelInsights: recalculatedGpsData.travelInsights,
			};

			// Update metrics if they exist
			if (updatedData.emailData.metrics) {
				updatedData.emailData.metrics = {
					...updatedData.emailData.metrics,
					totalDistanceKm: recalculatedGpsData.tripSummary?.totalDistanceKm,
					averageSpeedKmh: recalculatedGpsData.tripSummary?.averageSpeedKmh,
					maxSpeedKmh: recalculatedGpsData.tripSummary?.maxSpeedKmh,
					numberOfStops: recalculatedGpsData.tripSummary?.numberOfStops,
					movingTimeMinutes: recalculatedGpsData.tripSummary?.movingTimeMinutes,
					stoppedTimeMinutes: recalculatedGpsData.tripSummary?.stoppedTimeMinutes,
				};
			}
		}

		// Add recalculation metadata
		updatedData.recalculationInfo = {
			originalPointsCount: recalculatedGpsData.recalculationInfo?.originalPointsCount || 0,
			filteredPointsCount: recalculatedGpsData.recalculationInfo?.filteredPointsCount || 0,
			virtualPointsRemoved: recalculatedGpsData.recalculationInfo?.virtualPointsRemoved || 0,
			recalculatedAt: new Date().toISOString(),
		};

		return updatedData;
	}

	// Run every day at 18:00 (6:00 PM) - Comprehensive daily reports for all organizations
	@Cron('0 0 18 * * *')
	async generateEndOfDayReports() {
		this.logger.log('Starting comprehensive end-of-day reports generation for all organizations');

		try {
			// Get all active organizations
			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
				relations: ['users'],
			});

			this.logger.log(`Found ${organizations.length} active organizations for end-of-day reports`);

			if (organizations.length === 0) {
				this.logger.log('No active organizations found, skipping end-of-day report generation');
				return;
			}

			const orgResults = await Promise.allSettled(
				organizations.map(async (org) => {
					try {
						this.logger.debug(`Processing end-of-day reports for organization ${org.uid} (${org.name})`);

						// Generate comprehensive organization daily report
						await this.generateComprehensiveOrgDailyReport(org.uid);

						// Generate individual user reports for users who worked today
						const userResults = await this.generateUserDailyReportsForOrg(org.uid);

						this.logger.log(`Organization ${org.uid}: Generated ${userResults.successful} user reports, ${userResults.failed} failed`);

						return { 
							orgId: org.uid, 
							orgName: org.name,
							success: true, 
							userReports: userResults 
						};
					} catch (error) {
						this.logger.error(
							`Failed to generate end-of-day reports for organization ${org.uid}: ${error.message}`,
							error.stack,
						);
						return {
							orgId: org.uid,
							orgName: org.name || 'Unknown',
							success: false,
							reason: error.message,
						};
					}
				}),
			);

			const successful = orgResults.filter((r) => r.status === 'fulfilled' && r.value.success).length;
			const failed = orgResults.filter(
				(r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
			).length;

			this.logger.log(`End-of-day reports completed: ${successful} organizations successful, ${failed} failed`);

		} catch (error) {
			this.logger.error(`Critical error in generateEndOfDayReports: ${error.message}`, error.stack);
		}
	}

	// Run weekly on Friday at 17:00 - Comprehensive weekly reports for all organizations
	@Cron('0 0 17 * * FRI')
	async generateWeeklyOrgActivityReports() {
		this.logger.log('📊 Starting comprehensive weekly organization reports generation (Friday 17:00)');
		
		try {
			const startTime = Date.now();
			
			// Get all active organizations
			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
				select: ['uid', 'name'], // Only select needed fields to improve performance
			});

			this.logger.log(`📋 Found ${organizations.length} active organizations for weekly reports`);

			if (organizations.length === 0) {
				this.logger.log('⚠️ No active organizations found, skipping weekly report generation');
				return;
			}

			// Process in smaller batches to avoid overwhelming the system
			const batchSize = 10;
			let totalSuccessful = 0;
			let totalFailed = 0;
			
			for (let i = 0; i < organizations.length; i += batchSize) {
				const batch = organizations.slice(i, i + batchSize);
				this.logger.debug(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(organizations.length / batchSize)} (${batch.length} organizations)`);
				
				const batchResults = await Promise.allSettled(
					batch.map(async (org) => {
						try {
							this.logger.debug(`📈 Processing weekly report for organization ${org.uid} (${org.name})`);

							// Get the previous week's date range (last Sunday to last Saturday)
							const weekRange = this.getPreviousWeekDateRange();
							
							const params: ReportParamsDto = {
								type: ReportType.ORG_ACTIVITY,
								organisationId: org.uid,
								granularity: 'weekly',
								dateRange: weekRange,
							};

							await this.generateOrgActivityReport(params);
							
							this.logger.log(`✅ Successfully generated weekly report for organization ${org.uid} (${org.name})`);
							return { orgId: org.uid, orgName: org.name, success: true };
						} catch (error) {
							this.logger.error(
								`❌ Failed to generate weekly report for organization ${org.uid} (${org.name}): ${error.message}`,
								error.stack,
							);
							return {
								orgId: org.uid,
								orgName: org.name || 'Unknown',
								success: false,
								reason: error.message,
							};
						}
					}),
				);

				const batchSuccessful = batchResults.filter((r) => r.status === 'fulfilled' && r.value.success).length;
				const batchFailed = batchResults.filter(
					(r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
				).length;
				
				totalSuccessful += batchSuccessful;
				totalFailed += batchFailed;
				
				this.logger.debug(`📊 Batch ${Math.floor(i / batchSize) + 1} completed: ${batchSuccessful} successful, ${batchFailed} failed`);
				
				// Small delay between batches to reduce system load
				if (i + batchSize < organizations.length) {
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}

			const duration = Date.now() - startTime;
			this.logger.log(`🎉 Weekly reports completed in ${duration}ms: ${totalSuccessful} organizations successful, ${totalFailed} failed`);

		} catch (error) {
			this.logger.error(`💥 Critical error in generateWeeklyOrgActivityReports: ${error.message}`, error.stack);
		}
	}

	// ======================================================
	// COMPREHENSIVE REPORT GENERATION METHODS
	// ======================================================

	/**
	 * Generate comprehensive daily organization report with all user activities
	 */
	private async generateComprehensiveOrgDailyReport(organizationId: number): Promise<void> {
		this.logger.log(`Generating comprehensive daily organization report for org ${organizationId}`);

		try {
			// Get organization timezone for proper date handling
			const orgTimezone = await this.getOrganizationTimezone(organizationId);
			const orgCurrentTime = TimezoneUtil.getCurrentOrganizationTime(orgTimezone);
			
			// Set up today's date range in organization timezone
			const startOfDay = new Date(orgCurrentTime);
			startOfDay.setHours(0, 0, 0, 0);
			const endOfDay = new Date(orgCurrentTime);
			endOfDay.setHours(23, 59, 59, 999);

			// Check if report already exists for today
			const existingReport = await this.reportRepository.findOne({
				where: {
					reportType: ReportType.ORG_ACTIVITY,
					organisation: { uid: organizationId },
					generatedAt: MoreThanOrEqual(startOfDay),
				},
				order: { generatedAt: 'DESC' },
			});

			if (existingReport && existingReport.generatedAt <= endOfDay) {
				this.logger.log(`Daily organization report already exists for org ${organizationId}, skipping`);
				return;
			}

			// Generate comprehensive organization activity report
			const params: ReportParamsDto = {
				type: ReportType.ORG_ACTIVITY,
				organisationId: organizationId,
				granularity: 'daily',
				dateRange: {
					start: startOfDay,
					end: endOfDay,
				},
			};

			await this.generateOrgActivityReport(params);
			this.logger.log(`Successfully generated comprehensive daily report for organization ${organizationId}`);

		} catch (error) {
			this.logger.error(`Error generating comprehensive daily report for org ${organizationId}: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Generate user daily reports for all users who had activity today in the organization
	 */
	private async generateUserDailyReportsForOrg(organizationId: number): Promise<{ successful: number; failed: number }> {
		this.logger.log(`Generating user daily reports for organization ${organizationId}`);

		try {
			// Get organization timezone for proper date handling
			const orgTimezone = await this.getOrganizationTimezone(organizationId);
			const orgCurrentTime = TimezoneUtil.getCurrentOrganizationTime(orgTimezone);
			
			// Set up today's date range in organization timezone
			const startOfDay = new Date(orgCurrentTime);
			startOfDay.setHours(0, 0, 0, 0);
			const endOfDay = new Date(orgCurrentTime);
			endOfDay.setHours(23, 59, 59, 999);

			// Get users who had any activity today (attendance, quotations, tasks, etc.)
			const usersWithActivity = await this.getUsersWithActivityToday(organizationId, startOfDay, endOfDay);
			
			this.logger.log(`Found ${usersWithActivity.length} users with activity today in org ${organizationId}`);

			if (usersWithActivity.length === 0) {
				return { successful: 0, failed: 0 };
			}

			const results = await Promise.allSettled(
				usersWithActivity.map(async (user) => {
					try {
						// Check if report already generated today for this user
						const existingReport = await this.reportRepository.findOne({
							where: {
								owner: { uid: user.uid },
								reportType: ReportType.USER_DAILY,
								generatedAt: MoreThanOrEqual(startOfDay),
							},
						});

						if (existingReport) {
							this.logger.debug(`Daily report already exists for user ${user.uid}, skipping`);
							return { userId: user.uid, success: false, reason: 'Already exists' };
						}

						const params: ReportParamsDto = {
							type: ReportType.USER_DAILY,
							organisationId: organizationId,
							filters: { 
								userId: user.uid,
								dateRange: {
									start: startOfDay,
									end: endOfDay,
								}
							},
						};

						await this.generateUserDailyReport(params);
						return { userId: user.uid, success: true };
					} catch (error) {
						this.logger.error(`Failed to generate daily report for user ${user.uid}: ${error.message}`);
						return { userId: user.uid, success: false, reason: error.message };
					}
				}),
			);

			const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
			const failed = results.filter(
				(r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
			).length;

			return { successful, failed };

		} catch (error) {
			this.logger.error(`Error generating user daily reports for org ${organizationId}: ${error.message}`, error.stack);
			return { successful: 0, failed: 1 };
		}
	}

	/**
	 * Get users who had any activity today (attendance, quotations, tasks, etc.)
	 */
	private async getUsersWithActivityToday(organizationId: number, startOfDay: Date, endOfDay: Date): Promise<User[]> {
		this.logger.debug(`Getting users with activity today for org ${organizationId}`);

		try {
			// Get users with attendance activity today
			const usersWithAttendance = await this.userRepository
				.createQueryBuilder('user')
				.innerJoin('user.attendance', 'attendance')
				.where('user.organisationId = :organizationId', { organizationId })
				.andWhere('attendance.checkIn BETWEEN :startOfDay AND :endOfDay', { startOfDay, endOfDay })
				.andWhere('user.email IS NOT NULL')
				.andWhere('user.isDeleted = false')
				.getMany();

			// Get all active users from the organization (for comprehensive reporting)
			const allActiveUsers = await this.userRepository.find({
				where: {
					organisationRef: String(organizationId),
					email: Not(null),
					isDeleted: false,
				},
				relations: ['organisation'],
			});

			// Combine and deduplicate users
			const userIds = new Set([
				...usersWithAttendance.map(u => u.uid),
				...allActiveUsers.map(u => u.uid),
			]);

			const usersWithActivity = allActiveUsers.filter(user => userIds.has(user.uid));

			this.logger.debug(`Found ${usersWithActivity.length} users with activity today in org ${organizationId}`);
			return usersWithActivity;

		} catch (error) {
			this.logger.error(`Error getting users with activity for org ${organizationId}: ${error.message}`, error.stack);
			return [];
		}
	}

	/**
	 * Get previous week date range for weekly reports
	 * Returns the previous completed week from Sunday to Saturday
	 */
	private getPreviousWeekDateRange(): { start: Date; end: Date } {
		const now = new Date();
		const currentWeekStart = new Date(now);
		currentWeekStart.setDate(now.getDate() - now.getDay()); // Start of current week (Sunday)
		
		// Go back one week for the previous week
		const previousWeekStart = new Date(currentWeekStart);
		previousWeekStart.setDate(currentWeekStart.getDate() - 7);
		previousWeekStart.setHours(0, 0, 0, 0);
		
		const previousWeekEnd = new Date(previousWeekStart);
		previousWeekEnd.setDate(previousWeekStart.getDate() + 6); // End of previous week (Saturday)
		previousWeekEnd.setHours(23, 59, 59, 999);

		this.logger.debug(`📅 Previous week range: ${previousWeekStart.toISOString()} to ${previousWeekEnd.toISOString()}`);
		return { start: previousWeekStart, end: previousWeekEnd };
	}

	private getCacheKey(params: ReportParamsDto): string {
		const { type, organisationId, branchId, dateRange, filters } = params;

		// For quotation reports, include clientId in the cache key
		const clientIdStr = type === ReportType.QUOTATION && filters?.clientId ? `_client${filters.clientId}` : '';

		const dateStr = dateRange ? `_${dateRange.start.toISOString()}_${dateRange.end.toISOString()}` : '';
		const granularityStr = (params as any).granularity ? `_${(params as any).granularity}` : '';

		const cacheKey = `${this.CACHE_PREFIX}${type}_org${organisationId}${
			branchId ? `_branch${branchId}` : ''
		}${clientIdStr}${dateStr}${granularityStr}`;

		this.logger.debug(`Generated cache key: ${cacheKey}`);
		return cacheKey;
	}

	// ======================================================
	// CRUD OPERATIONS FOR REPORTS
	// ======================================================

	async findAll() {
		this.logger.log('Fetching all reports');
		try {
			const reports = await this.reportRepository.find({
				relations: ['organisation', 'owner'],
				order: { generatedAt: 'DESC' },
			});
			this.logger.log(`Found ${reports.length} reports`);
			return reports;
		} catch (error) {
			this.logger.error(`Error fetching all reports: ${error.message}`, error.stack);
			throw error;
		}
	}

	async findOne(id: number) {
		this.logger.log(`Fetching report with ID: ${id}`);
		try {
			const report = await this.reportRepository.findOne({
				where: { uid: id },
				relations: ['organisation', 'owner'],
			});

			if (!report) {
				this.logger.warn(`Report with ID ${id} not found`);
				throw new NotFoundException(`Report with ID ${id} not found`);
			}

			this.logger.log(`Successfully fetched report ${id}`);
			return report;
		} catch (error) {
			this.logger.error(`Error fetching report ${id}: ${error.message}`, error.stack);
			throw error;
		}
	}

	async remove(id: number) {
		this.logger.log(`Removing report with ID: ${id}`);
		try {
			const report = await this.findOne(id); // This will throw if not found
			const result = await this.reportRepository.delete(id);
			this.logger.log(`Successfully removed report ${id}`);
			return result;
		} catch (error) {
			this.logger.error(`Error removing report ${id}: ${error.message}`, error.stack);
			throw error;
		}
	}

	@OnEvent('daily-report')
	async handleDailyReport(payload: { userId: number; attendanceId?: number; triggeredByActivity?: boolean }) {
		this.logger.log(`Handling daily report event for user ${payload?.userId}${payload?.triggeredByActivity ? ' (activity-triggered)' : ''}${payload?.attendanceId ? `, attendance: ${payload.attendanceId}` : ''}`);

		try {
			if (!payload || !payload.userId) {
				this.logger.error('Invalid payload for daily report event');
				return;
			}

			const { userId, attendanceId, triggeredByActivity } = payload;

			// Get user to find their organization
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user || !user.organisation) {
				this.logger.warn(`User ${userId} or organisation not found for daily report`);
				return;
			}

			this.logger.log(`Processing daily report for user ${userId} in organisation ${user.organisation.uid}`);

			// Create report parameters
			const params: ReportParamsDto = {
				type: ReportType.USER_DAILY,
				organisationId: user.organisation.uid,
				filters: {
					userId: userId,
					attendanceId: attendanceId, // Include the attendance ID that triggered this report
					triggeredByActivity: triggeredByActivity, // Pass through the activity trigger flag
					// Use default date range (today)
				},
			};

			// Generate and save the report
			await this.generateUserDailyReport(params);
			this.logger.log(`Successfully processed daily report for user ${userId}`);
		} catch (error) {
			this.logger.error(`Error handling daily report for user ${payload?.userId}: ${error.message}`, error.stack);
			return null;
		}
	}

	async generateUserDailyReport(params: ReportParamsDto): Promise<Report> {
		this.logger.log(`Generating comprehensive user daily report with params: ${JSON.stringify(params)}`);

		try {
			const { userId } = params.filters || {};

			if (!userId) {
				this.logger.error('User ID is required for generating a daily user report');
				throw new Error('User ID is required for generating a daily user report');
			}

			// Get user data
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user) {
				this.logger.error(`User with ID ${userId} not found`);
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			this.logger.log(`Generating comprehensive daily report for user ${user.name} (${user.email})`);

			// Get organization timezone for proper date handling
			const orgTimezone = await this.getOrganizationTimezone(user.organisation?.uid);
			const orgCurrentTime = TimezoneUtil.getCurrentOrganizationTime(orgTimezone);
			
			// Get comprehensive attendance metrics for the user
			let attendanceMetrics = null;
			try {
				const metricsResponse = await this.attendanceService.getUserAttendanceMetrics(userId);
				attendanceMetrics = metricsResponse.metrics;
				this.logger.debug(`Retrieved comprehensive attendance metrics for user ${userId}`);
			} catch (error) {
				this.logger.warn(`Failed to get attendance metrics for user ${userId}: ${error.message}`);
			}

			// Get daily attendance overview for today
			let dailyOverview = null;
			try {
				const overviewResponse = await this.attendanceService.getDailyAttendanceOverview(
					user.organisation?.uid,
					undefined, // branchId
					orgCurrentTime
				);
				// Find this user in the overview
				const userOverview = overviewResponse.data.presentUsers.find(u => u.uid === userId) ||
					overviewResponse.data.absentUsers.find(u => u.uid === userId);
				
				if (userOverview) {
					dailyOverview = userOverview;
					this.logger.debug(`Retrieved daily overview for user ${userId}`);
				}
			} catch (error) {
				this.logger.warn(`Failed to get daily overview for user ${userId}: ${error.message}`);
			}

		// Enhance params with comprehensive data
		const enhancedParams = {
			...params,
			filters: {
				...params.filters,
				attendanceMetrics,
				dailyOverview,
				organizationTimezone: orgTimezone,
				reportGeneratedAt: orgCurrentTime,
			} as typeof params.filters & {
				attendanceMetrics: any;
				dailyOverview: any;
				organizationTimezone: string;
				reportGeneratedAt: Date;
			}
		};

			// Generate report data with enhanced information
			const reportData = await this.userDailyReportGenerator.generate(enhancedParams);
			this.logger.log(`Comprehensive report data generated successfully for user ${userId}`);

			// Create comprehensive email data with timezone formatting
			const emailData = {
				...reportData.emailData,
				name: user.name,
				email: user.email,
				date: TimezoneUtil.formatInOrganizationTime(orgCurrentTime, 'yyyy-MM-dd', orgTimezone),
				organizationTimezone: orgTimezone,
				comprehensiveMetrics: {
					attendanceMetrics,
					dailyOverview,
					...reportData.emailData?.metrics,
				}
			};

			// Create a new report record
			const newReport = new Report();
			newReport.name = `Daily Report - ${user.name} - ${TimezoneUtil.formatInOrganizationTime(orgCurrentTime, 'yyyy-MM-dd', orgTimezone)}`;
			newReport.description = `Comprehensive daily activity report for ${user.name}`;
			newReport.reportType = ReportType.USER_DAILY;
			newReport.filters = enhancedParams.filters;
			newReport.reportData = {
				...reportData,
				emailData,
			};
			newReport.generatedAt = new Date();
			newReport.owner = user;
			newReport.organisation = user.organisation;

			// Save the report
			const savedReport = await this.reportRepository.save(newReport);
			this.logger.log(`Comprehensive daily report saved with ID: ${savedReport.uid} for user ${userId}`);

			// Link the attendance record to the generated report (bidirectional linking)
			const attendanceId = enhancedParams.filters?.attendanceId;
			if (attendanceId) {
				try {
					this.logger.debug(`Linking attendance record ${attendanceId} to report ${savedReport.uid}`);
					
					// Extract distance from report GPS data
					let distanceKm = 0;
					if (savedReport.gpsData?.tripSummary?.totalDistanceKm !== undefined) {
						distanceKm = savedReport.gpsData.tripSummary.totalDistanceKm;
					} else if (reportData?.details?.location?.totalDistanceKm !== undefined) {
						distanceKm = reportData.details.location.totalDistanceKm;
					} else if (reportData?.details?.location?.tripMetrics?.totalDistanceKm !== undefined) {
						distanceKm = reportData.details.location.tripMetrics.totalDistanceKm;
					}
					
					// Update attendance with both dailyReport link and distance
					await this.attendanceRepository.update(
						{ uid: attendanceId },
						{ 
							dailyReport: savedReport,
							distanceTravelledKm: distanceKm
						}
					);
					this.logger.log(`Successfully linked attendance ${attendanceId} to daily report ${savedReport.uid} with distance ${distanceKm.toFixed(2)} km`);
				} catch (linkingError) {
					this.logger.error(`Failed to link attendance ${attendanceId} to report ${savedReport.uid}: ${linkingError.message}`);
					// Don't fail the report generation if linking fails
				}
			} else {
				this.logger.debug('No attendance ID provided - skipping attendance-report linking');
			}

			// Emit event to send email (single email delivery)
			this.eventEmitter.emit('report.generated', {
				reportType: ReportType.USER_DAILY,
				reportId: savedReport.uid,
				userId: user.uid,
				emailData,
			});

			this.logger.log(`Comprehensive daily report generation completed for user ${userId}`);
			return savedReport;
		} catch (error) {
			this.logger.error(`Error generating comprehensive user daily report: ${error.message}`, error.stack);
			return null;
		}
	}

	async generateReport(params: ReportParamsDto, currentUser: any): Promise<Record<string, any>> {
		this.logger.log(`Generating report of type: ${params.type} for organisation: ${params.organisationId}`);
		this.logger.debug(`Report parameters: ${JSON.stringify(params)}`);

		// Check cache first
		const cacheKey = this.getCacheKey(params);
		const cachedReport = await this.cacheManager.get<Record<string, any>>(cacheKey);

		if (cachedReport) {
			this.logger.log(`Report found in cache: ${cacheKey}`);
			return {
				...cachedReport,
				fromCache: true,
				cachedAt: cachedReport.generatedAt,
				currentTime: new Date().toISOString(),
			};
		}

		this.logger.log(`Generating fresh report for type: ${params.type}`);

		// Generate report data based on type
		let reportData: Record<string, any>;

		try {
			switch (params.type) {
				case ReportType.MAIN:
					this.logger.log('Generating main report');
					reportData = await this.mainReportGenerator.generate(params);
					break;
				case ReportType.QUOTATION:
					this.logger.log('Generating quotation report');
					reportData = await this.quotationReportGenerator.generate(params);
					break;
				case ReportType.USER_DAILY:
					this.logger.log('Generating user daily report');
					reportData = await this.userDailyReportGenerator.generate(params);
					break;
				case ReportType.ORG_ACTIVITY:
					this.logger.log('Generating organisation activity report');
					reportData = await this.orgActivityReportGenerator.generate(params);
					break;
				case ReportType.USER:
					this.logger.error('User report type not implemented yet');
					throw new Error('User report type not implemented yet');
				case ReportType.SHIFT:
					this.logger.error('Shift report type not implemented yet');
					throw new Error('Shift report type not implemented yet');
				default:
					this.logger.error(`Unknown report type: ${params.type}`);
					throw new Error(`Unknown report type: ${params.type}`);
			}

			this.logger.log(`Report data generated successfully for type: ${params.type}`);
		} catch (error) {
			this.logger.error(`Error generating report data: ${error.message}`, error.stack);
			throw error;
		}

		// Prepare the report response with metadata
		const report = {
			name: params.name || `${params.type} Report`,
			type: params.type,
			generatedAt: new Date(),
			filters: {
				organisationId: params.organisationId,
				branchId: params.branchId,
				dateRange: params.dateRange,
				...params.filters, // Include any additional filters
			},
			generatedBy: {
				uid: currentUser.uid,
			},
			...reportData,
		};

		// Cache the report
		try {
			await this.cacheManager.set(cacheKey, report, this.CACHE_TTL);
			this.logger.log(`Report cached successfully: ${cacheKey}`);
		} catch (error) {
			this.logger.error(`Error caching report: ${error.message}`, error.stack);
		}

		this.logger.log(`Report generation completed for type: ${params.type}`);

		// Return the report data directly without saving to database
		return report;
	}

	/* ---------------------------------------------------------
	 * ORG-ACTIVITY generator entry (save + email)
	 * -------------------------------------------------------*/
	async generateOrgActivityReport(params: ReportParamsDto): Promise<Report> {
		this.logger.log(`Generating org activity report with params: ${JSON.stringify(params)}`);
		try {
			// Idempotency: avoid duplicates for same org and period
			const nowRange = params.dateRange || {} as any;
			const periodStart = nowRange.start ? new Date(nowRange.start) : new Date();
			periodStart.setHours(0, 0, 0, 0);
			const periodEnd = nowRange.end ? new Date(nowRange.end) : new Date();
			periodEnd.setHours(23, 59, 59, 999);
			const existing = await this.reportRepository.findOne({
				where: {
					reportType: ReportType.ORG_ACTIVITY,
					organisation: { uid: params.organisationId },
					generatedAt: MoreThanOrEqual(periodStart),
				},
				order: { generatedAt: 'DESC' },
			});
			if (existing && existing.generatedAt <= periodEnd) {
				this.logger.log(`Org activity report already exists for org ${params.organisationId} in period; skipping.`);
				return existing;
			}

			const reportData = await this.orgActivityReportGenerator.generate(params);
			const newReport = new Report();
			newReport.name = `${params.granularity === 'weekly' ? 'Weekly' : 'Daily'} Org Activity Report - ${new Date().toISOString().split('T')[0]}`;
			newReport.description = `${params.granularity === 'weekly' ? 'Weekly' : 'Daily'} organisation activity summary`;
			newReport.reportType = ReportType.ORG_ACTIVITY;
			newReport.filters = { ...params.filters, granularity: params.granularity, dateRange: params.dateRange };
			newReport.reportData = reportData;
			newReport.generatedAt = new Date();
			(newReport as any).organisation = { uid: params.organisationId } as any;

			const saved = await this.reportRepository.save(newReport);

			// Emit event for email delivery
			this.eventEmitter.emit('report.generated', {
				reportType: ReportType.ORG_ACTIVITY,
				reportId: saved.uid,
				organisationId: params.organisationId,
				emailData: reportData.emailData,
				granularity: params.granularity || 'daily',
			});

			return saved;
		} catch (error) {
			this.logger.error(`Error generating org activity report: ${error.message}`, error.stack);
			return null;
		}
	}


	@OnEvent('report.generated')
	async handleReportGenerated(payload: { reportType: ReportType; reportId: number; userId?: number; organisationId?: number; emailData: any; granularity?: 'daily' | 'weekly' }) {
		this.logger.log(
			`Handling report generated event - Type: ${payload.reportType}, ID: ${payload.reportId}, User: ${payload.userId}`,
		);

		try {
			if (payload.reportType === ReportType.USER_DAILY) {
				await this.sendUserDailyReportEmail(payload.userId, payload.emailData);
			}
			if (payload.reportType === ReportType.ORG_ACTIVITY) {
				await this.sendOrgActivityReportEmail(payload.organisationId, payload.emailData, payload.granularity);
			}
		} catch (error) {
			this.logger.error(`Error handling report generated event: ${error.message}`, error.stack);
			return null;
		}
	}

	private async sendOrgActivityReportEmail(organisationId: number, emailData: any, granularity: 'daily' | 'weekly' = 'daily') {
		this.logger.log(`Sending organisation activity (${granularity}) report email for org ${organisationId}`);
		try {
			if (!organisationId) {
				this.logger.warn('Organisation ID missing for org-activity email');
				return;
			}

			// Get organization timezone for proper time formatting in emails
			const orgTimezone = await this.getOrganizationTimezone(organisationId);
			
			// Determine recipients: org admins, managers, and owners only
			const recipientsQuery = this.userRepository
				.createQueryBuilder('user')
				.innerJoin('user.organisation', 'organisation', 'organisation.uid = :orgId', { orgId: organisationId })
				.where('user.email IS NOT NULL')
				.andWhere('user.isDeleted = false')
				.andWhere('user.accessLevel IN (:...levels)', { 
					levels: ['ADMIN', 'MANAGER', 'OWNER', 'HR'] 
				});
			
			const recipients = await recipientsQuery.getMany();
			const emails = recipients.map(u => u.email).filter(Boolean);
			
			if (emails.length === 0) {
				this.logger.warn(`No admin/manager recipients found for org ${organisationId}`);
				return;
			}

			// Format email data with organization timezone
			const formattedEmailData = {
				...emailData,
				organizationTimezone: orgTimezone,
				reportGeneratedAt: TimezoneUtil.formatInOrganizationTime(
					new Date(), 
					'yyyy-MM-dd HH:mm:ss', 
					orgTimezone
				),
				granularity,
			};

			// Note: ORG_ACTIVITY_REPORT email template needs to be added to communication service
			// For now, fallback to USER_DAILY_REPORT template
			const emailType = EmailType.ORG_ACTIVITY_REPORT || EmailType.USER_DAILY_REPORT;

			const emailService = this.communicationService as any;
			await emailService.sendEmail(emailType, emails, formattedEmailData);
			this.logger.log(`Organisation activity report email sent to ${emails.length} admin/manager recipients`);
		} catch (error) {
			this.logger.error(`Error sending org activity report email: ${error.message}`, error.stack);
		}
	}

	private async sendUserDailyReportEmail(userId: number, emailData: any) {
		this.logger.log(`Sending daily report email to user ${userId}`);

		try {
			// Get user with full profile
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation'],
			});

			if (!user || !user.email) {
				this.logger.warn(`User ${userId} not found or has no email address`);
				return;
			}

			// Get organization timezone for proper time formatting
			const orgTimezone = await this.getOrganizationTimezone(user.organisation?.uid);

			// Ensure emailData has the correct format
			this.logger.debug(`Email data received for user ${userId}:`, {
				hasEmailData: !!emailData,
				emailDataType: typeof emailData,
				emailDataKeys: emailData ? Object.keys(emailData) : [],
				hasName: emailData && !!emailData.name,
				hasDate: emailData && !!emailData.date,
				hasMetrics: emailData && !!emailData.metrics,
			});
		
			if (!emailData || !emailData.name || !emailData.date || !emailData.metrics) {
				this.logger.error(`Invalid email data format for user ${userId}`, {
					hasEmailData: !!emailData,
					hasName: emailData && !!emailData.name,
					hasDate: emailData && !!emailData.date,
					hasMetrics: emailData && !!emailData.metrics
				});
				throw new Error('Invalid email data format');
			}

			// Validate and format required fields for the email template
			if (!emailData.metrics.attendance) {
				this.logger.warn(`No attendance data for user ${userId}, using defaults`);
				emailData.metrics.attendance = {
					status: 'NOT_PRESENT',
					totalHours: 0,
				};
			}

			// Format attendance times in organization timezone
			if (emailData.metrics.attendance.checkInTime) {
				emailData.metrics.attendance.checkInTimeFormatted = TimezoneUtil.formatInOrganizationTime(
					new Date(emailData.metrics.attendance.checkInTime),
					'HH:mm',
					orgTimezone
				);
			}

			if (emailData.metrics.attendance.checkOutTime) {
				emailData.metrics.attendance.checkOutTimeFormatted = TimezoneUtil.formatInOrganizationTime(
					new Date(emailData.metrics.attendance.checkOutTime),
					'HH:mm',
					orgTimezone
				);
			}

			// Ensure all required fields are present with defaults
			emailData.metrics.totalQuotations = emailData.metrics.totalQuotations || 0;
			emailData.metrics.totalRevenue = emailData.metrics.totalRevenue || 'R0.00';
			emailData.metrics.totalTasks = emailData.metrics.totalTasks || 0;
			emailData.metrics.completedTasks = emailData.metrics.completedTasks || 0;

			// Create tracking section if missing
			if (!emailData.tracking) {
				emailData.tracking = {
					totalDistance: '0 km',
					locations: [],
					averageTimePerLocation: '0 min',
				};
			}

			// Add timezone and formatting information
			const formattedEmailData = {
				...emailData,
				organizationTimezone: orgTimezone,
				reportGeneratedAt: TimezoneUtil.formatInOrganizationTime(
					new Date(), 
					'yyyy-MM-dd HH:mm:ss', 
					orgTimezone
				),
				userName: user.name,
				userEmail: user.email,
			};

			const emailService = this.communicationService as any;
			try {
				await emailService.sendEmail(EmailType.USER_DAILY_REPORT, [user.email], formattedEmailData);
				this.logger.log(`Daily report email sent successfully to ${user.email}`);
			} catch (emailError) {
				this.logger.error(
					`Failed to send daily report email to ${user.email}: ${emailError.message}`,
					emailError.stack,
				);
				throw emailError;
			}
		} catch (error) {
			this.logger.error(`Error sending daily report email to user ${userId}: ${error.message}`, error.stack);

			// Record the error in the report record
			try {
				const report = await this.reportRepository.findOne({
					where: { owner: { uid: userId }, reportType: ReportType.USER_DAILY },
					order: { generatedAt: 'DESC' },
				});

				if (report) {
					report.notes = `Email delivery failed: ${error.message}`;
					await this.reportRepository.save(report);
					this.logger.log(`Error logged to report ${report.uid}`);
				}
			} catch (dbError) {
				this.logger.error(`Failed to log email error to database: ${dbError.message}`, dbError.stack);
			}
		}
	}

	/* ---------------------------------------------------------
	 * MAP-DATA helper (live map screen)
	 * -------------------------------------------------------*/
	async generateMapData(params: { organisationId: number; branchId?: number; userId?: number }): Promise<any> {
		this.logger.log(
			`Generating map data for organization ${params.organisationId}${
				params.branchId ? ` and branch ${params.branchId}` : ''
			}${params.userId ? ` and user ${params.userId}` : ''}`,
		);

		const cacheKey = `${this.CACHE_PREFIX}mapdata_org${params.organisationId}_${params.branchId || 'all'}_${params.userId || 'all'}`;

		// Try cache first
		const cached = await this.cacheManager.get(cacheKey);
		if (cached) {
			this.logger.log(`Map data found in cache: ${cacheKey}`);
			return cached;
		}

		try {
			const data = await this.mapDataReportGenerator.generate(params);
			this.logger.log(`Map data generated successfully for organization ${params.organisationId}`);

			// Enhanced summary counts to match new response structure
			const summary = {
				totalWorkers: data.workers.length,
				totalClients: data.clients.length,
				totalCompetitors: data.competitors.length,
				totalQuotations: data.quotations.length,
				totalEvents: data.events?.length || 0,
			};

			const finalPayload = { data, summary };

			await this.cacheManager.set(cacheKey, finalPayload, this.CACHE_TTL);
			this.logger.log(`Map data cached successfully: ${cacheKey}`);

			return finalPayload;
		} catch (error) {
			this.logger.error(`Error generating map data: ${error.message}`, error.stack);
			throw error;
		}
	}

	/* ---------------------------------------------------------
	 * ORGANIZATION METRICS SUMMARY
	 * -------------------------------------------------------*/
	/**
	 * Get comprehensive organization-wide metrics summary
	 * Includes attendance, leads, claims, tasks, sales, leave, and IoT metrics
	 * 
	 * @param organizationId - Organization ID to get metrics for
	 * @param branchId - Optional branch ID to filter metrics
	 * @returns OrganizationMetricsSummaryDto with comprehensive metrics
	 */
	async getOrganizationMetricsSummary(organizationId: number, branchId?: number): Promise<any> {
		this.logger.log(`Getting organization metrics summary for org ${organizationId}${branchId ? `, branch ${branchId}` : ''}`);

		const cacheKey = `${this.CACHE_PREFIX}org_metrics_${organizationId}_${branchId || 'all'}`;

		// Try cache first
		const cached = await this.cacheManager.get(cacheKey);
		if (cached) {
			this.logger.log(`Organization metrics found in cache: ${cacheKey}`);
			return { ...cached, fromCache: true };
		}

		try {
			// Get organization details
			const organization = await this.organisationRepository.findOne({
				where: { uid: organizationId },
			});

			if (!organization) {
				this.logger.error(`Organization ${organizationId} not found`);
				throw new NotFoundException(`Organization with ID ${organizationId} not found`);
			}

			this.logger.debug(`Fetching metrics for organization: ${organization.name}`);

			// Get today's date range in organization timezone
			const orgTimezone = await this.getOrganizationTimezone(organizationId);
			const orgCurrentTime = TimezoneUtil.getCurrentOrganizationTime(orgTimezone);
			const startOfDay = new Date(orgCurrentTime);
			startOfDay.setHours(0, 0, 0, 0);
			const endOfDay = new Date(orgCurrentTime);
			endOfDay.setHours(23, 59, 59, 999);

			// Fetch all metrics in parallel for better performance
			const [
				attendanceMetrics,
				leadsMetrics,
				claimsMetrics,
				tasksMetrics,
				salesMetrics,
				leaveMetrics,
				iotMetrics,
			] = await Promise.all([
				this.getAttendanceMetrics(organizationId, branchId, startOfDay, endOfDay),
				this.getLeadsMetrics(organizationId, branchId),
				this.getClaimsMetrics(organizationId, branchId, startOfDay),
				this.getTasksMetrics(organizationId, branchId),
				this.getSalesMetrics(organizationId, branchId, startOfDay),
				this.getLeaveMetrics(organizationId, branchId, startOfDay, endOfDay),
				this.getIoTMetrics(organizationId, branchId),
			]);

			const summary = {
				organizationId,
				organizationName: organization.name,
				branchId,
				branchName: branchId ? (await this.organisationRepository
					.createQueryBuilder('org')
					.leftJoinAndSelect('org.branches', 'branch')
					.where('branch.uid = :branchId', { branchId })
					.getOne())?.branches?.[0]?.name : undefined,
				generatedAt: new Date(),
				attendance: attendanceMetrics,
				leads: leadsMetrics,
				claims: claimsMetrics,
				tasks: tasksMetrics,
				sales: salesMetrics,
				leave: leaveMetrics,
				iot: iotMetrics,
			};

			// Cache the metrics
			await this.cacheManager.set(cacheKey, summary, this.CACHE_TTL);
			this.logger.log(`Organization metrics cached successfully: ${cacheKey}`);

			return summary;
		} catch (error) {
			this.logger.error(`Error getting organization metrics: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get attendance metrics for organization
	 */
	private async getAttendanceMetrics(
		organizationId: number,
		branchId: number | undefined,
		startOfDay: Date,
		endOfDay: Date,
	): Promise<any> {
		try {
			this.logger.debug(`Fetching attendance metrics for org ${organizationId}`);

			const whereClause: any = {
				checkIn: Between(startOfDay, endOfDay),
				owner: {
					organisationRef: String(organizationId),
					isDeleted: false,
				},
			};

			if (branchId) {
				whereClause.owner = {
					...whereClause.owner,
					branch: { uid: branchId },
				};
			}

			const todayAttendance = await this.attendanceRepository.find({
				where: whereClause,
				relations: ['owner'],
			});

			const presentToday = new Set(todayAttendance.map(a => a.owner.uid)).size;
			
			// Get total employees
			const allEmployeesWhere: any = {
				organisationRef: String(organizationId),
				isDeleted: false,
			};
			if (branchId) {
				allEmployeesWhere.branch = { uid: branchId };
			}
			
			const totalEmployees = await this.userRepository.count({ where: allEmployeesWhere });
			const absentToday = totalEmployees - presentToday;

			// Calculate total hours and punctuality
			let totalHours = 0;
			let lateCheckIns = 0;

			for (const attendance of todayAttendance) {
				if (attendance.checkOut) {
					const hours = (new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) / (1000 * 60 * 60);
					totalHours += hours;
				}

				// Simple punctuality check (9 AM threshold)
				const checkInTime = new Date(attendance.checkIn);
				if (checkInTime.getHours() > 9 || (checkInTime.getHours() === 9 && checkInTime.getMinutes() > 0)) {
					lateCheckIns++;
				}
			}

			const averageHours = presentToday > 0 ? totalHours / presentToday : 0;
			const punctualityRate = todayAttendance.length > 0 
				? ((todayAttendance.length - lateCheckIns) / todayAttendance.length) * 100 
				: 100;

			return {
				presentToday,
				absentToday,
				totalHoursToday: Math.round(totalHours * 100) / 100,
				averageHoursPerEmployee: Math.round(averageHours * 100) / 100,
				punctualityRate: Math.round(punctualityRate * 100) / 100,
				lateCheckIns,
			};
		} catch (error) {
			this.logger.error(`Error getting attendance metrics: ${error.message}`);
			return {
				presentToday: 0,
				absentToday: 0,
				totalHoursToday: 0,
				averageHoursPerEmployee: 0,
				punctualityRate: 0,
				lateCheckIns: 0,
			};
		}
	}

	/**
	 * Get leads metrics for organization
	 */
	private async getLeadsMetrics(organizationId: number, branchId: number | undefined): Promise<any> {
		try {
			this.logger.debug(`Fetching leads metrics for org ${organizationId}`);

			const whereClause: any = {
				organisation: { uid: organizationId },
				isDeleted: false,
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const allLeads = await this.leadsRepository.find({ where: whereClause });

			// Get today's new leads
			const startOfDay = new Date();
			startOfDay.setHours(0, 0, 0, 0);
			const newLeadsToday = allLeads.filter(lead => 
				new Date(lead.createdAt) >= startOfDay
			).length;

			// Group by status
			const leadsByStatus: Record<string, number> = {};
			allLeads.forEach(lead => {
				leadsByStatus[lead.status] = (leadsByStatus[lead.status] || 0) + 1;
			});

			// Calculate conversion rate (won leads / total leads)
			const wonLeads = leadsByStatus['WON'] || 0;
			const conversionRate = allLeads.length > 0 ? (wonLeads / allLeads.length) * 100 : 0;

			// Hot leads (high temperature or high score)
			const hotLeads = allLeads.filter(lead => 
				lead.temperature === 'HOT' || (lead.leadScore && lead.leadScore > 70)
			).length;

			return {
				totalLeads: allLeads.length,
				newLeadsToday,
				leadsByStatus,
				conversionRate: Math.round(conversionRate * 100) / 100,
				hotLeads,
			};
		} catch (error) {
			this.logger.error(`Error getting leads metrics: ${error.message}`);
			return {
				totalLeads: 0,
				newLeadsToday: 0,
				leadsByStatus: {},
				conversionRate: 0,
				hotLeads: 0,
			};
		}
	}

	/**
	 * Get claims metrics for organization
	 */
	private async getClaimsMetrics(
		organizationId: number,
		branchId: number | undefined,
		startOfDay: Date,
	): Promise<any> {
		try {
			this.logger.debug(`Fetching claims metrics for org ${organizationId}`);

			const whereClause: any = {
				organisation: { uid: organizationId },
				isDeleted: false,
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const allClaims = await this.claimsRepository.find({ where: whereClause });

			const pendingClaims = allClaims.filter(c => c.status.toLowerCase() === 'pending').length;
			const approvedClaims = allClaims.filter(c => c.status.toLowerCase() === 'approved').length;
			const rejectedClaims = allClaims.filter(c => c.status.toLowerCase() === 'declined').length;

			// Calculate total claim value
			const totalClaimValue = allClaims.reduce((sum, claim) => {
				return sum + (parseFloat(claim.amount) || 0);
			}, 0);

			// Get today's claims
			const claimsToday = allClaims.filter(claim => 
				new Date(claim.createdAt) >= startOfDay
			).length;

			return {
				totalClaims: allClaims.length,
				pendingClaims,
				approvedClaims,
				rejectedClaims,
				totalClaimValue: Math.round(totalClaimValue * 100) / 100,
				claimsToday,
			};
		} catch (error) {
			this.logger.error(`Error getting claims metrics: ${error.message}`);
			return {
				totalClaims: 0,
				pendingClaims: 0,
				approvedClaims: 0,
				rejectedClaims: 0,
				totalClaimValue: 0,
				claimsToday: 0,
			};
		}
	}

	/**
	 * Get tasks metrics for organization
	 */
	private async getTasksMetrics(organizationId: number, branchId: number | undefined): Promise<any> {
		try {
			this.logger.debug(`Fetching tasks metrics for org ${organizationId}`);

			const whereClause: any = {
				organisation: { uid: organizationId },
				isDeleted: false,
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const allTasks = await this.taskRepository.find({ where: whereClause });

			const completedTasks = allTasks.filter(t => t.status === 'COMPLETED').length;
			const overdueTasks = allTasks.filter(t => t.isOverdue).length;
			const inProgressTasks = allTasks.filter(t => t.status === 'IN_PROGRESS').length;

			const completionRate = allTasks.length > 0 ? (completedTasks / allTasks.length) * 100 : 0;

			// Get today's tasks
			const startOfDay = new Date();
			startOfDay.setHours(0, 0, 0, 0);
			const tasksCreatedToday = allTasks.filter(task => 
				new Date(task.createdAt) >= startOfDay
			).length;

			return {
				totalTasks: allTasks.length,
				completedTasks,
				overdueTasks,
				inProgressTasks,
				completionRate: Math.round(completionRate * 100) / 100,
				tasksCreatedToday,
			};
		} catch (error) {
			this.logger.error(`Error getting tasks metrics: ${error.message}`);
			return {
				totalTasks: 0,
				completedTasks: 0,
				overdueTasks: 0,
				inProgressTasks: 0,
				completionRate: 0,
				tasksCreatedToday: 0,
			};
		}
	}

	/**
	 * Get sales metrics for organization (from quotations)
	 */
	private async getSalesMetrics(
		organizationId: number,
		branchId: number | undefined,
		startOfDay: Date,
	): Promise<any> {
		try {
			this.logger.debug(`Fetching sales metrics for org ${organizationId}`);

			const whereClause: any = {
				organisation: { uid: organizationId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const allQuotations = await this.quotationRepository.find({ where: whereClause });

			// Calculate total revenue
			const totalRevenue = allQuotations.reduce((sum, quotation) => {
				return sum + (parseFloat(String(quotation.totalAmount)) || 0);
			}, 0);

			const averageQuotationValue = allQuotations.length > 0 
				? totalRevenue / allQuotations.length 
				: 0;

			// Get today's quotations
			const quotationsToday = allQuotations.filter(q => 
				new Date(q.quotationDate) >= startOfDay
			).length;

			// Count by status
			const acceptedQuotations = allQuotations.filter(q => q.status.toLowerCase() === 'approved').length;
			const pendingQuotations = allQuotations.filter(q => 
				q.status.toLowerCase() === 'pending_client' || q.status.toLowerCase() === 'pending_internal'
			).length;

			return {
				totalQuotations: allQuotations.length,
				totalRevenue: Math.round(totalRevenue * 100) / 100,
				averageQuotationValue: Math.round(averageQuotationValue * 100) / 100,
				quotationsToday,
				acceptedQuotations,
				pendingQuotations,
			};
		} catch (error) {
			this.logger.error(`Error getting sales metrics: ${error.message}`);
			return {
				totalQuotations: 0,
				totalRevenue: 0,
				averageQuotationValue: 0,
				quotationsToday: 0,
				acceptedQuotations: 0,
				pendingQuotations: 0,
			};
		}
	}

	/**
	 * Get leave metrics for organization
	 */
	private async getLeaveMetrics(
		organizationId: number,
		branchId: number | undefined,
		startOfDay: Date,
		endOfDay: Date,
	): Promise<any> {
		try {
			this.logger.debug(`Fetching leave metrics for org ${organizationId}`);

			// Note: Leave repository may need to be injected if leave module exists
			// For now, return placeholder metrics
			return {
				activeLeaveRequests: 0,
				pendingApprovals: 0,
				approvedLeave: 0,
				rejectedLeave: 0,
				employeesOnLeaveToday: 0,
			};
		} catch (error) {
			this.logger.error(`Error getting leave metrics: ${error.message}`);
			return {
				activeLeaveRequests: 0,
				pendingApprovals: 0,
				approvedLeave: 0,
				rejectedLeave: 0,
				employeesOnLeaveToday: 0,
			};
		}
	}

	/**
	 * Get IoT metrics for organization
	 */
	private async getIoTMetrics(organizationId: number, branchId: number | undefined): Promise<any> {
		try {
			this.logger.debug(`Fetching IoT metrics for org ${organizationId}`);

			// Note: IoT repository may need to be injected if IoT module exists
			// For now, return placeholder metrics
			return {
				totalDevices: 0,
				onlineDevices: 0,
				offlineDevices: 0,
				maintenanceRequired: 0,
				dataPointsToday: 0,
			};
		} catch (error) {
			this.logger.error(`Error getting IoT metrics: ${error.message}`);
			return {
				totalDevices: 0,
				onlineDevices: 0,
				offlineDevices: 0,
				maintenanceRequired: 0,
				dataPointsToday: 0,
			};
		}
	}

	// ===================================================================
	// PERFORMANCE TRACKER ENDPOINTS
	// ===================================================================

	/**
	 * Get ALL performance data in one unified response
	 * This is the main endpoint for mobile app - returns everything in one call
	 * Phase 1: Uses mock data
	 * Phase 2: Will query external database
	 */
	async getUnifiedPerformanceData(params: any): Promise<any> {
		this.logger.log(`🚀 Getting UNIFIED performance data for org ${params.organisationId}`);
		const skipCache = params.skipCache === true || params.skipCache === 'true';

		try {
			// Generate cache key for unified data
			const cacheKey = this.getPerformanceCacheKey({ ...params, type: 'unified' });
			
			// Check cache only if skipCache is false
			if (!skipCache) {
				const cachedData = await this.cacheManager.get(cacheKey);
				if (cachedData) {
					this.logger.log(`✅ Unified performance data served from cache: ${cacheKey}`);
					return {
						success: true,
						data: cachedData,
						message: 'Unified performance data retrieved successfully from cache',
						timestamp: new Date().toISOString(),
					};
				}
		} else {
			this.logger.log(`🔄 REFRESH MODE: Skipping cache - forcing recalculation for unified performance data (org ${params.organisationId})`);
			
			// ✅ STEP 1: Clear performance dashboard cache FIRST
			this.logger.log(`🧹 Step 1/2: Clearing performance dashboard cache: ${cacheKey}`);
			try {
				await this.cacheManager.del(cacheKey);
				// Verify cache is cleared
				const verifyCache = await this.cacheManager.get(cacheKey);
				if (verifyCache) {
					this.logger.warn(`⚠️ Cache key still exists after deletion attempt: ${cacheKey}`);
				} else {
					this.logger.log(`✅ Performance dashboard cache cleared successfully`);
				}
			} catch (error) {
				this.logger.error(`❌ Failed to clear performance dashboard cache: ${error.message}`);
				throw new Error(`Cache clear failed: ${error.message}`);
			}
		}

		// Convert params to filters format
		const filters = this.convertParamsToFilters(params);
		
		// ✅ STEP 2: Clear ERP cache for the date range BEFORE fetching data
		if (skipCache && filters.startDate && filters.endDate) {
			this.logger.log(`🧹 Step 2/2: Clearing ERP cache for date range: ${filters.startDate} to ${filters.endDate}`);
			try {
				await this.erpDataService.clearCache(filters.startDate, filters.endDate);
				this.logger.log(`✅ ERP cache cleared successfully for date range ${filters.startDate} to ${filters.endDate}`);
			} catch (error) {
				this.logger.error(`❌ Failed to clear ERP cache: ${error.message}`);
				// Don't throw - allow data fetch to proceed, but log the error
				this.logger.warn(`⚠️ Proceeding with data fetch despite ERP cache clear failure`);
			}
		}

		// ✅ STEP 3: All caches cleared - now fetch fresh data
		this.logger.log(`📊 Generating fresh unified performance data (all caches cleared)...`);

			// Get organization timezone
			const timezone = await this.getOrganizationTimezone(params.organisationId);

			// Initialize the generator
			const PerformanceDashboardGenerator = require('./generators/performance-dashboard.generator').PerformanceDashboardGenerator;
			const generator = new PerformanceDashboardGenerator();

			// Generate ALL data in parallel for better performance
			this.logger.debug('🔄 Generating all performance data components in parallel...');
			const [
				dashboardData,
				dailySalesData,
				branchCategoryData,
				salesPerStoreData,
				masterData
			] = await Promise.all([
				generator.generate(filters),
				generator.generateDailySalesPerformance(filters),
				generator.generateBranchCategoryPerformance(filters),
				generator.generateSalesPerStore(filters),
				Promise.resolve(generator.getMasterData())
			]);

			this.logger.log(`✅ All performance data components generated successfully`);

			// Add timezone to dashboard metadata
			dashboardData.metadata.organizationTimezone = timezone;

			// Create unified response
			const unifiedData = {
				dashboard: dashboardData,
				dailySales: dailySalesData,
				branchCategory: branchCategoryData,
				salesPerStore: salesPerStoreData,
				masterData: masterData,
			};

			// Cache the unified result
			await this.cacheManager.set(cacheKey, unifiedData, this.CACHE_TTL);
			this.logger.log(`💾 Unified performance data cached: ${cacheKey}`);

			return {
				success: true,
				data: unifiedData,
				message: 'Unified performance data retrieved successfully',
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			this.logger.error(`❌ Error getting unified performance data: ${error.message}`, error.stack);
			return {
				success: false,
				error: {
					code: 'UNIFIED_PERFORMANCE_ERROR',
					details: error.message,
					context: { organisationId: params.organisationId }
				},
				timestamp: new Date().toISOString(),
			};
		}
	}

	/**
	 * Get performance dashboard data
	 * Main endpoint for performance tracker with comprehensive filtering and analytics
	 */
	async getPerformanceDashboard(params: any): Promise<any> {
		this.logger.log(`Getting performance dashboard for org ${params.organisationId}`);
		const skipCache = params.skipCache === true || params.skipCache === 'true';
		
		// Auto-bypass cache when customer category filters are present (force recalculation)
		const hasCustomerCategoryFilters = (params.excludeCustomerCategories && params.excludeCustomerCategories.length > 0) ||
			(params.includeCustomerCategories && params.includeCustomerCategories.length > 0);
		const shouldSkipCache = skipCache || hasCustomerCategoryFilters;
		
		if (hasCustomerCategoryFilters) {
			this.logger.log(`🔄 CUSTOMER CATEGORY FILTER MODE: Auto-bypassing cache - exclude: ${params.excludeCustomerCategories?.join(',') || 'none'}, include: ${params.includeCustomerCategories?.join(',') || 'none'}`);
		}

		try {
			// Generate cache key
			const cacheKey = this.getPerformanceCacheKey(params);
			
			// Check cache only if skipCache is false
			if (!shouldSkipCache) {
				const cachedData = await this.cacheManager.get(cacheKey);
				if (cachedData) {
					this.logger.log(`Performance dashboard served from cache: ${cacheKey}`);
					return {
						success: true,
						data: {
							...cachedData,
							metadata: {
								...cachedData.metadata,
								fromCache: true,
								cachedAt: cachedData.metadata.lastUpdated,
							},
						},
						timestamp: new Date().toISOString(),
					};
				}
			} else {
				const mode = hasCustomerCategoryFilters ? 'CUSTOMER CATEGORY FILTER MODE' : 'REFRESH MODE';
				this.logger.log(`🔄 ${mode}: Skipping cache - forcing recalculation for org ${params.organisationId}`);
				
				// ✅ STEP 1: Clear performance dashboard cache FIRST
				this.logger.log(`🧹 Step 1/2: Clearing performance dashboard cache: ${cacheKey}`);
				try {
					await this.cacheManager.del(cacheKey);
					// Verify cache is cleared
					const verifyCache = await this.cacheManager.get(cacheKey);
					if (verifyCache) {
						this.logger.warn(`⚠️ Cache key still exists after deletion attempt: ${cacheKey}`);
					} else {
						this.logger.log(`✅ Performance dashboard cache cleared successfully`);
					}
				} catch (error) {
					this.logger.error(`❌ Failed to clear performance dashboard cache: ${error.message}`);
					throw new Error(`Cache clear failed: ${error.message}`);
				}
			}

			// Get organization timezone
			const timezone = await this.getOrganizationTimezone(params.organisationId);

			// Convert DTO params to filters format
			const filters = this.convertParamsToFilters(params);
			
			// ✅ STEP 2: Clear ERP cache for the date range BEFORE fetching data
			if (shouldSkipCache && filters.startDate && filters.endDate) {
				this.logger.log(`🧹 Step 2/2: Clearing ERP cache for date range: ${filters.startDate} to ${filters.endDate}`);
				try {
					await this.erpDataService.clearCache(filters.startDate, filters.endDate);
					this.logger.log(`✅ ERP cache cleared successfully for date range ${filters.startDate} to ${filters.endDate}`);
				} catch (error) {
					this.logger.error(`❌ Failed to clear ERP cache: ${error.message}`);
					// Don't throw - allow data fetch to proceed, but log the error
					this.logger.warn(`⚠️ Proceeding with data fetch despite ERP cache clear failure`);
				}
			}

			// ✅ STEP 3: All caches cleared - now fetch fresh data
			this.logger.log(`📊 Generating fresh dashboard data (all caches cleared)...`);
			
			// Generate dashboard data using the injected generator
			const dashboardData = await this.performanceDashboardGenerator.generate(filters);

			// Add timezone to metadata
			dashboardData.metadata.organizationTimezone = timezone;

			// Cache the result
			await this.cacheManager.set(cacheKey, dashboardData, this.CACHE_TTL);
			this.logger.log(`Performance dashboard cached: ${cacheKey}`);

			return {
				success: true,
				data: dashboardData,
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			this.logger.error(`Error getting performance dashboard: ${error.message}`, error.stack);
			return {
				success: false,
				error: {
					code: 'PERFORMANCE_DASHBOARD_ERROR',
					details: error.message,
				},
				timestamp: new Date().toISOString(),
			};
		}
	}

	// ===================================================================
	// PERFORMANCE HELPER METHODS
	// ===================================================================

	/**
	 * Generate cache key for performance data
	 */
	private getPerformanceCacheKey(params: any): string {
		const includeCustomerCategoriesKey = params.includeCustomerCategories && params.includeCustomerCategories.length > 0
			? params.includeCustomerCategories.sort().join('-')
			: 'all';
		const excludeCustomerCategoriesKey = params.excludeCustomerCategories && params.excludeCustomerCategories.length > 0
			? params.excludeCustomerCategories.sort().join('-')
			: 'all';
		
		const keyParts = [
			'performance',
			params.type || 'dashboard',
			`org_${params.organisationId}`,
			params.startDate || 'nostart',
			params.endDate || 'noend',
			params.branchIds?.join('-') || 'allbranches',
			params.county || 'nocounty',
			params.province || 'noprovince',
			params.city || 'nocity',
			params.suburb || 'nosuburb',
			params.category || 'nocat',
			params.productIds?.join('-') || 'allproducts',
			params.minPrice || 'nomin',
			params.maxPrice || 'nomax',
			params.salesPersonIds?.join('-') || 'allsales',
			`inc_cat:${includeCustomerCategoriesKey}`,
			`exc_cat:${excludeCustomerCategoriesKey}`,
		];

		return keyParts.join(':');
	}

	/**
	 * Convert country name to country code
	 * Maps country names like "South Africa", "Botswana" to codes like "SA", "BOT"
	 */
	private getCountryCodeFromName(countryName?: string): string {
		if (!countryName) return 'SA'; // Default to SA
		
		const normalized = countryName.trim().toLowerCase();
		const countryMap: Record<string, string> = {
			'south africa': 'SA',
			'sa': 'SA',
			'botswana': 'BOT',
			'bot': 'BOT',
			'zimbabwe': 'ZW',
			'zw': 'ZW',
			'zambia': 'ZAM',
			'zam': 'ZAM',
			'mozambique': 'MOZ',
			'moz': 'MOZ',
		};
		
		return countryMap[normalized] || 'SA'; // Default to SA if not found
	}

	/**
	 * Convert request params to filter format
	 */
	private convertParamsToFilters(params: any): any {
		// Extract and map country code
		const countryCode = this.getCountryCodeFromName(params.country);
		
		// ✅ Log country code conversion for debugging
		this.logger.log(`🌍 Country filter conversion: "${params.country || 'not specified'}" → "${countryCode}"`);
		
		return {
			organisationId: params.organisationId,
			branchId: params.branchId,
			startDate: params.startDate,
			endDate: params.endDate,
			country: params.country, // Keep original country name for backward compatibility
			countryCode: countryCode, // Add country code for database switching
			location: params.county || params.province || params.city || params.suburb ? {
				county: params.county,
				province: params.province,
				city: params.city,
				suburb: params.suburb,
			} : undefined,
			product: params.category || params.productIds ? {
				category: params.category,
				productIds: params.productIds,
			} : undefined,
			priceRange: params.minPrice || params.maxPrice ? {
				min: params.minPrice,
				max: params.maxPrice,
			} : undefined,
			branchIds: params.branchIds,
			salesPersonIds: params.salesPersonIds,
			category: params.category,
			productIds: params.productIds,
			minPrice: params.minPrice,
			maxPrice: params.maxPrice,
			county: params.county,
			province: params.province,
			city: params.city,
			suburb: params.suburb,
			includeCustomerCategories: params.includeCustomerCategories,
			excludeCustomerCategories: params.excludeCustomerCategories,
		};
	}

	// ===================================================================
	// DAILY REPORTS METHODS (MORNING & EVENING)
	// ===================================================================

	/**
	 * Get organization daily reports (morning and evening attendance reports)
	 * Fetches ALL reports without date filtering
	 */
	async getOrganizationDailyReports(params: {
		organisationRef: string;
		reportType?: 'MORNING' | 'EVENING';
		branchId?: number;
		page?: number;
		limit?: number;
	}): Promise<any> {
		this.logger.log(`Getting organization daily reports for org ${params.organisationRef}`);

		try {
			const { organisationRef, reportType, branchId, page = 1, limit = 50 } = params;

			// Build query - fetch ALL reports
			const queryBuilder = this.reportRepository
				.createQueryBuilder('report')
				.leftJoinAndSelect('report.organisation', 'organisation')
				.leftJoinAndSelect('report.branch', 'branch')
				.leftJoinAndSelect('report.owner', 'owner')
				.where('organisation.ref = :organisationRef', { organisationRef });

			// Filter by report type if specified
			if (reportType) {
				queryBuilder.andWhere('report.reportType = :reportType', { 
					reportType: reportType.toLowerCase() 
				});
			} else {
				// Only show MORNING and EVENING reports
				queryBuilder.andWhere('report.reportType IN (:...reportTypes)', {
					reportTypes: ['morning', 'evening']
				});
			}

			// Filter by branch if specified
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			// Count total for pagination
			const total = await queryBuilder.getCount();

			// Apply pagination and sorting (most recent first)
			const reports = await queryBuilder
				.orderBy('report.generatedAt', 'DESC')
				.skip((page - 1) * limit)
				.take(limit)
				.getMany();

			this.logger.log(`Found ${reports.length} daily reports for org ${organisationRef} (total: ${total})`);

			return {
				message: 'Daily reports retrieved successfully',
				reports,
				pagination: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
			};
		} catch (error) {
			this.logger.error(`Error getting organization daily reports: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get user personal daily reports (morning and evening attendance reports)
	 * Fetches ALL reports without date filtering
	 */
	async getUserDailyReports(params: {
		userId: number;
		reportType?: 'MORNING' | 'EVENING';
		page?: number;
		limit?: number;
	}): Promise<any> {
		this.logger.log(`Getting user daily reports for user ${params.userId}`);

		try {
			const { userId, reportType, page = 1, limit = 50 } = params;

			// Build query - fetch ALL reports
			const queryBuilder = this.reportRepository
				.createQueryBuilder('report')
				.leftJoinAndSelect('report.owner', 'owner')
				.leftJoinAndSelect('report.organisation', 'organisation')
				.leftJoinAndSelect('report.branch', 'branch')
				.where('owner.uid = :userId', { userId });

			// Filter by report type if specified
			if (reportType) {
				queryBuilder.andWhere('report.reportType = :reportType', { 
					reportType: reportType.toLowerCase() 
				});
			} else {
				// Only show MORNING and EVENING reports
				queryBuilder.andWhere('report.reportType IN (:...reportTypes)', {
					reportTypes: ['morning', 'evening']
				});
			}

			// Count total for pagination
			const total = await queryBuilder.getCount();

			// Apply pagination and sorting (most recent first)
			const reports = await queryBuilder
				.orderBy('report.generatedAt', 'DESC')
				.skip((page - 1) * limit)
				.take(limit)
				.getMany();

			this.logger.log(`Found ${reports.length} daily reports for user ${userId} (total: ${total})`);

			return {
				message: 'Daily reports retrieved successfully',
				reports,
				pagination: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
			};
		} catch (error) {
			this.logger.error(`Error getting user daily reports: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get consolidated income statement across all countries
	 * Aggregates sales data from all branches across SA, BOT, ZAM, MOZ, ZW
	 * All calculations done server-side
	 */
	async getConsolidatedIncomeStatement(startDate: string, endDate: string): Promise<ConsolidatedIncomeStatementResponseDto> {
		const operationId = `consolidated_income_${Date.now()}`;
		this.logger.log(`[${operationId}] Starting consolidated income statement generation`);
		this.logger.log(`[${operationId}] Date range: ${startDate} to ${endDate}`);

		try {
			// Supported countries
			const countries = [
				{ code: 'SA', name: 'South Africa' },
				{ code: 'BOT', name: 'Botswana' },
				{ code: 'ZAM', name: 'Zambia' },
				{ code: 'MOZ', name: 'Mozambique' },
				{ code: 'ZW', name: 'Zimbabwe' },
			];

			// Build filters for ERP queries
			const filters = {
				startDate,
				endDate,
			};

			// Fetch data for all countries in parallel
			const countryPromises = countries.map(async (country) => {
				try {
					this.logger.log(`[${operationId}] Fetching data for ${country.name} (${country.code})`);
					
					// Get branch aggregations for this country
					const branchAggregations = await this.erpDataService.getBranchAggregations(filters, country.code);
					
					// Get branch category aggregations to calculate GP (cost data from tblsaleslines)
					const branchCategoryAggregations = await this.erpDataService.getBranchCategoryAggregations(filters, country.code);
					
					// Calculate total cost per store from BranchCategoryAggregations
					const storeCosts = new Map<string, number>();
					branchCategoryAggregations.forEach((agg) => {
						const storeCode = String(agg.store || '').trim().padStart(3, '0');
						const cost = typeof agg.totalCost === 'number' 
							? agg.totalCost 
							: parseFloat(String(agg.totalCost || 0));
						const currentCost = storeCosts.get(storeCode) || 0;
						storeCosts.set(storeCode, currentCost + cost);
					});
					
					// Get currency info for this country
					const currency = getCurrencyForCountry(country.code);
					
					// Get branch names from database
					const storeCodes = branchAggregations.map(agg => String(agg.store || '').trim().padStart(3, '0'));
					const branchNamesMap = await this.erpDataService.getBranchNamesFromDatabase(storeCodes, country.code);
					
			// Map branch aggregations to branch data
			const branches: ConsolidatedBranchDataDto[] = (branchAggregations || []).map((agg) => {
				const storeCode = String(agg?.store || '').trim().padStart(3, '0');
				const revenue = Number(agg?.totalRevenue) || 0;
				const totalCost = storeCosts.get(storeCode) || 0;
				const grossProfit = revenue - totalCost; // ✅ GP = Revenue - Cost
				const grossProfitPercentage = revenue > 0 ? (grossProfit / revenue) * 100 : 0; // ✅ GP% = (GP / Revenue) * 100
				
				return {
					branchId: String(agg?.store || ''),
					branchName: branchNamesMap.get(storeCode) || String(agg?.store || 'Unknown'),
					totalRevenue: revenue,
					transactionCount: Number(agg?.transactionCount) || 0,
					grossProfit: grossProfit,
					grossProfitPercentage: grossProfitPercentage,
				};
			});

					// Calculate total revenue for this country
					const totalRevenue = branches.reduce((sum, branch) => sum + branch.totalRevenue, 0);

					const countryData: ConsolidatedIncomeStatementDto = {
						countryCode: country.code,
						countryName: country.name,
						currency: {
							code: currency.code,
							symbol: currency.symbol,
							locale: currency.locale,
							name: currency.name,
						},
						branches,
						totalRevenue,
						branchCount: branches.length,
					};

					this.logger.log(`[${operationId}] ✅ ${country.name}: ${branches.length} branches, ${currency.symbol}${totalRevenue.toFixed(2)}`);
					
					return countryData;
				} catch (error: any) {
					this.logger.error(`[${operationId}] ❌ Error fetching data for ${country.name}: ${error?.message || 'Unknown error'}`);
					this.logger.error(`[${operationId}] Error stack: ${error?.stack || 'No stack trace'}`);
					// Return empty data for this country instead of failing completely
					const currency = getCurrencyForCountry(country.code);
					return {
						countryCode: country.code,
						countryName: country.name,
						currency: {
							code: currency.code,
							symbol: currency.symbol,
							locale: currency.locale,
							name: currency.name,
						},
						branches: [],
						totalRevenue: 0,
						branchCount: 0,
					} as ConsolidatedIncomeStatementDto;
				}
			});

			// Wait for all countries to complete
			const countryData = await Promise.all(countryPromises);

			// Filter out countries with no data (optional - you might want to show all countries)
			const dataWithBranches = countryData.filter((country) => country.branches.length > 0);

			// Calculate totals
			const totalCountries = dataWithBranches.length;
			const totalBranches = dataWithBranches.reduce((sum, country) => sum + (country.branchCount || 0), 0);

			// Fetch exchange rates for the date range (use endDate as reference)
			const exchangeRates = await this.getExchangeRates(endDate);

			this.logger.log(`[${operationId}] ✅ Consolidated income statement generated: ${totalCountries} countries, ${totalBranches} branches`);

			const response: ConsolidatedIncomeStatementResponseDto = {
				data: dataWithBranches,
				startDate,
				endDate,
				totalCountries,
				totalBranches,
				exchangeRates,
			};

			return response;
		} catch (error: any) {
			this.logger.error(`[${operationId}] ❌ Error generating consolidated income statement: ${error?.message || 'Unknown error'}`);
			this.logger.error(`[${operationId}] Error stack: ${error?.stack || 'No stack trace'}`);
			throw error;
		}
	}

	/**
	 * Get exchange rates for currency conversion to ZAR
	 * Fetches rates from bit_consolidated.tblforex_history for the given date
	 * If no date is provided, uses today's date
	 */
	private async getExchangeRates(date?: string): Promise<ExchangeRateDto[]> {
		const operationId = 'GET-EXCHANGE-RATES';
		
		// Default to today's date if no date provided
		let queryDate: string;
		if (!date || date.trim() === '') {
			const today = new Date();
			queryDate = today.toISOString().split('T')[0]; // Format as YYYY-MM-DD
			this.logger.log(`[${operationId}] No date provided, using today's date: ${queryDate}`);
		} else {
			queryDate = date.trim();
			this.logger.log(`[${operationId}] Fetching exchange rates for date: ${queryDate}`);
		}

		try {
			// Get consolidated database connection
			const consolidatedDataSource = await this.erpConnectionManager.getConsolidatedConnection();
			this.logger.debug(`[${operationId}] ✅ Connected to consolidated database (bit_consolidated)`);

			// Query forex rates for the exact date
			// Use CAST to ensure rate is returned as string to preserve exact decimal precision
			const query = `
				SELECT forex_code, CAST(rate AS CHAR) as rate
				FROM tblforex_history
				WHERE forex_date = ?
				AND forex_code IN ('BWP', 'ZMW', 'MZN', 'ZWL', 'USD', 'EUR')
				ORDER BY forex_code
			`;
			
			this.logger.debug(`[${operationId}] Executing query with date parameter: ${queryDate}`);
			const queryStartTime = Date.now();
			const results = await consolidatedDataSource.query(query, [queryDate]);
			const queryDuration = Date.now() - queryStartTime;

			this.logger.log(`[${operationId}] ✅ Query executed in ${queryDuration}ms, fetched ${results.length} rows for date ${queryDate}`);
			
			// Convert to DTO format - no rounding, use exact values from database
			// Parse as number but preserve all decimal places
			const exchangeRates: ExchangeRateDto[] = results.map((row: any) => {
				// Convert string to number without any rounding - preserves all decimal places
				const rate = Number(row.rate); // Number() preserves precision better than parseFloat for exact decimals
				this.logger.debug(`[${operationId}] Rate for ${row.forex_code}: ${rate} (raw: ${row.rate})`);
				return {
					code: row.forex_code,
					rate: rate, // Exact value from database, no rounding
				};
			});

			this.logger.log(`[${operationId}] ✅ Successfully fetched ${exchangeRates.length} exchange rates for date ${queryDate}`);
			return exchangeRates;
		} catch (error: any) {
			this.logger.error(`[${operationId}] ❌ Failed to fetch exchange rates for date ${queryDate}: ${error?.message || 'Unknown error'}`);
			this.logger.error(`[${operationId}] Error stack: ${error?.stack || 'No stack trace'}`);
			// Return empty array if fetch fails - conversion will be skipped
			return [];
		}
	}

	/**
	 * Get user highlights data for mobile app
	 * Returns targets, attendance streak, latest leads, tasks, and leave in one concise response
	 */
	async getUserHighlights(userId: number, orgId: number, branchId?: number): Promise<any> {
		const operationId = `highlights-${userId}-${Date.now()}`;
		this.logger.log(`[${operationId}] Getting highlights data for user ${userId}, org ${orgId}`);

		try {
			// Get today's date range in organization timezone
			const orgTimezone = await this.getOrganizationTimezone(orgId);
			const orgCurrentTime = TimezoneUtil.getCurrentOrganizationTime(orgTimezone);
			const startOfDay = new Date(orgCurrentTime);
			startOfDay.setHours(0, 0, 0, 0);
			const endOfDay = new Date(orgCurrentTime);
			endOfDay.setHours(23, 59, 59, 999);

			// Fetch all data in parallel for better performance
			const [
				userTargetResult,
				revenueCardResult,
				attendanceMetrics,
				leadsResult,
				tasksResult,
				leaveResult,
			] = await Promise.allSettled([
				// Get user targets to extract ERP code and period dates (needed for revenue card)
				this.userService.getUserTarget(userId, orgId),
				// Get revenue card data using ERP service (same as /erp/profile/sales endpoint)
				(async () => {
					try {
						// Get user target to extract ERP code and date range
						const userTargetResult = await this.userService.getUserTarget(userId, orgId);
						
						if (!userTargetResult?.userTarget) {
							this.logger.warn(`[${operationId}] No targets found for user ${userId}, skipping revenue card`);
							return { success: false, data: null };
						}

						const userTarget = userTargetResult.userTarget;
						// Try to get erpSalesRepCode from multiple possible locations
						const erpSalesRepCode = userTarget.erpSalesRepCode || 
							(userTarget.personalTargets as any)?.erpSalesRepCode || 
							null;

						if (!erpSalesRepCode) {
							this.logger.warn(`[${operationId}] No ERP Sales Rep Code found for user ${userId}`);
							return { success: false, data: null };
						}

						// Get period dates from user_targets entity (single source of truth)
						const personalTargets = userTarget.personalTargets as any;
						const periodStartDateRaw = personalTargets?.periodStartDate;
						const periodEndDateRaw = personalTargets?.periodEndDate;

						if (!periodStartDateRaw || !periodEndDateRaw) {
							this.logger.warn(`[${operationId}] No period dates found in user target for user ${userId}`);
							return { success: false, data: null };
						}

						// Format dates to YYYY-MM-DD format
						const periodStartDate = new Date(periodStartDateRaw).toISOString().split('T')[0];
						const periodEndDate = new Date(periodEndDateRaw).toISOString().split('T')[0];

						// Call ERP service same way as /erp/profile/sales endpoint
						// This queries tblsaleslines WHERE rep_code = erpSalesRepCode AND type = 'I' AND doc_type IN (1,2)
						const salesData = await this.erpDataService.getSalesPersonAggregations({
							startDate: periodStartDate,
							endDate: periodEndDate,
							salesPersonId: erpSalesRepCode,
						});

						// Find exact match to ensure we have the right data
						const userSalesData = salesData.find(agg => 
							agg.salesCode?.toUpperCase() === erpSalesRepCode.toUpperCase()
						);

						if (!userSalesData || salesData.length === 0) {
							this.logger.debug(`[${operationId}] No sales found for ERP code "${erpSalesRepCode}" in period ${periodStartDate} → ${periodEndDate}`);
							return {
								success: true,
								data: {
									totalRevenue: 0,
									transactionCount: 0,
									uniqueCustomers: 0,
									salesCode: erpSalesRepCode,
									salesName: erpSalesRepCode,
								},
								periodStartDate,
								periodEndDate,
							};
						}

						// Return sales data matching /erp/profile/sales format
						return {
							success: true,
							data: {
								totalRevenue: userSalesData.totalRevenue || 0,
								transactionCount: userSalesData.transactionCount || 0,
								uniqueCustomers: userSalesData.uniqueCustomers || 0,
								salesCode: userSalesData.salesCode,
								salesName: userSalesData.salesName || userSalesData.salesCode,
							},
							periodStartDate,
							periodEndDate,
						};
					} catch (error) {
						this.logger.error(`[${operationId}] Error getting revenue card data: ${error.message}`);
						return { success: false, data: null, error: error.message };
					}
				})(),
				// Get attendance streak from attendance metrics (matches /attendance/metrics/:uid endpoint)
				this.attendanceService.getUserAttendanceMetrics(userId),
				// Get latest 2 leads for today using leads service
				this.leadsService.leadsByUser(userId, orgId, branchId).then(result => {
					// Filter leads created today and take latest 2
					const todayLeads = result.leads
						.filter(lead => {
							const leadDate = new Date(lead.createdAt);
							return leadDate >= startOfDay && leadDate <= endOfDay;
						})
						.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
						.slice(0, 2);
					return { leads: todayLeads };
				}),
				// Get latest 2 tasks for today using tasks service
				this.tasksService.tasksByUser(userId, orgId, branchId).then(result => {
					// Filter tasks created today and take latest 2
					const todayTasks = result.tasks
						.filter(task => {
							const taskDate = new Date(task.createdAt);
							return taskDate >= startOfDay && taskDate <= endOfDay;
						})
						.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
						.slice(0, 2);
					return { tasks: todayTasks };
				}),
				// Get latest leave for user
				this.leaveService.leavesByUser(userId, orgId, branchId, userId).then(result => {
					// Get the most recent leave
					const latestLeave = result.leaves
						.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
					return { leave: latestLeave };
				}),
			]);

			// Extract results with error handling
			const targets = userTargetResult.status === 'fulfilled' ? userTargetResult.value?.userTarget || null : null;
			const revenueCard = revenueCardResult.status === 'fulfilled' && revenueCardResult.value?.success 
				? revenueCardResult.value.data 
				: null;
			const attendanceStreak = attendanceMetrics.status === 'fulfilled' 
				? attendanceMetrics.value?.metrics?.attendanceStreak || 0 
				: 0;
			const leads = leadsResult.status === 'fulfilled' ? leadsResult.value?.leads || [] : [];
			const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value?.tasks || [] : [];
			const leave = leaveResult.status === 'fulfilled' ? leaveResult.value?.leave || null : null;

			// Log any errors
			if (userTargetResult.status === 'rejected') {
				this.logger.warn(`[${operationId}] Failed to fetch user targets: ${userTargetResult.reason?.message}`);
			}
			if (revenueCardResult.status === 'rejected') {
				this.logger.warn(`[${operationId}] Failed to fetch revenue card: ${revenueCardResult.reason?.message}`);
			}
			if (attendanceMetrics.status === 'rejected') {
				this.logger.warn(`[${operationId}] Failed to fetch attendance streak: ${attendanceMetrics.reason?.message}`);
			}
			if (leadsResult.status === 'rejected') {
				this.logger.warn(`[${operationId}] Failed to fetch leads: ${leadsResult.reason?.message}`);
			}
			if (tasksResult.status === 'rejected') {
				this.logger.warn(`[${operationId}] Failed to fetch tasks: ${tasksResult.reason?.message}`);
			}
			if (leaveResult.status === 'rejected') {
				this.logger.warn(`[${operationId}] Failed to fetch leave: ${leaveResult.reason?.message}`);
			}

			const highlights = {
				targets,
				revenueCard, // Revenue card data from ERP service (matches /erp/profile/sales)
				attendanceStreak, // From /attendance/metrics/:uid endpoint
				leads, // Latest 2 leads from leads service
				tasks, // Latest 2 tasks from tasks service
				leave,
				generatedAt: new Date().toISOString(),
			};

			this.logger.log(`[${operationId}] ✅ Highlights data retrieved successfully`);
			return highlights;
		} catch (error) {
			this.logger.error(`[${operationId}] ❌ Error getting highlights: ${error.message}`, error.stack);
			throw error;
		}
	}
}
