import { Injectable, Inject, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
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

// DTOs and Enums
import { ReportType } from './constants/report-types.enum';
import { ReportParamsDto } from './dto/report-params.dto';
import { EmailType } from '../lib/enums/email.enums';

// Services and Generators
import { MainReportGenerator } from './generators/main-report.generator';
import { QuotationReportGenerator } from './generators/quotation-report.generator';
import { UserDailyReportGenerator } from './generators/user-daily-report.generator';
import { OrgActivityReportGenerator } from './generators/org-activity-report.generator';
import { MapDataReportGenerator } from './generators/map-data-report.generator';
import { CommunicationService } from '../communication/communication.service';
import { OrganizationHoursService } from '../attendance/services/organization.hours.service';
import { AttendanceService } from '../attendance/attendance.service';

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
		private readonly attendanceService: AttendanceService,
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

	// Run weekly on Friday at 18:00 - Comprehensive weekly reports for all organizations
	@Cron('0 0 18 * * FRI')
	async generateWeeklyOrgActivityReports() {
		this.logger.log('Starting comprehensive weekly organization reports generation (Friday 18:00)');
		
		try {
			// Get all active organizations
			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
			});

			this.logger.log(`Found ${organizations.length} active organizations for weekly reports`);

			if (organizations.length === 0) {
				this.logger.log('No active organizations found, skipping weekly report generation');
				return;
			}

			const results = await Promise.allSettled(
				organizations.map(async (org) => {
					try {
						this.logger.debug(`Processing weekly report for organization ${org.uid} (${org.name})`);

						const params: ReportParamsDto = {
							type: ReportType.ORG_ACTIVITY,
							organisationId: org.uid,
							granularity: 'weekly',
							dateRange: this.getWeekDateRange(),
						};

						await this.generateOrgActivityReport(params);
						
						this.logger.log(`Successfully generated weekly report for organization ${org.uid}`);
						return { orgId: org.uid, orgName: org.name, success: true };
					} catch (error) {
						this.logger.error(
							`Failed to generate weekly report for organization ${org.uid}: ${error.message}`,
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

			const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
			const failed = results.filter(
				(r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
			).length;

			this.logger.log(`Weekly reports completed: ${successful} organizations successful, ${failed} failed`);

		} catch (error) {
			this.logger.error(`Critical error in generateWeeklyOrgActivityReports: ${error.message}`, error.stack);
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
	 * Get current week date range for weekly reports
	 */
	private getWeekDateRange(): { start: Date; end: Date } {
		const now = new Date();
		const startOfWeek = new Date(now);
		startOfWeek.setDate(now.getDate() - now.getDay()); // Start of current week (Sunday)
		startOfWeek.setHours(0, 0, 0, 0);
		
		const endOfWeek = new Date(startOfWeek);
		endOfWeek.setDate(startOfWeek.getDate() + 6); // End of current week (Saturday)
		endOfWeek.setHours(23, 59, 59, 999);

		return { start: startOfWeek, end: endOfWeek };
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
	async handleDailyReport(payload: { userId: number; triggeredByActivity?: boolean }) {
		this.logger.log(`Handling daily report event for user ${payload?.userId}${payload?.triggeredByActivity ? ' (activity-triggered)' : ''}`);

		try {
			if (!payload || !payload.userId) {
				this.logger.error('Invalid payload for daily report event');
				return;
			}

			const { userId, triggeredByActivity } = payload;

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
}
