import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { startOfDay, endOfDay, format, subDays, subBusinessDays, isValid, differenceInMinutes } from 'date-fns';
import { Attendance } from '../entities/attendance.entity';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { OrganisationSettings } from '../../organisation/entities/organisation-settings.entity';
import { Report } from '../../reports/entities/report.entity';
import { ReportType } from '../../reports/constants/report-types.enum';
import { OrganizationHoursService } from './organization.hours.service';
import { UserService } from '../../user/user.service';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';
import { AccessLevel } from '../../lib/enums/user.enums';
import { EmailType } from '../../lib/enums/email.enums';
import { AccountStatus } from '../../lib/enums/status.enums';
import { TimeCalculatorUtil } from '../../lib/utils/time-calculator.util';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import {
	PunctualityBreakdown,
	BranchPunctuality,
	EmployeeAttendanceMetric,
	MorningReportData,
	EveningReportData,
	BranchSummary,
	AttendanceReportUser,
} from '../../lib/interfaces/reports.interface';

/**
 * AttendanceReportsService
 *
 * Automated attendance reporting system that sends daily attendance reports via email.
 *
 * Features:
 * - Morning reports: Sent 5 minutes after organization opening time
 * - Evening reports: Sent 30 minutes after organization closing time
 * - Smart scheduling: Respects each organization's working hours and holidays
 * - Comprehensive data: Includes attendance rates, punctuality breakdown, insights, and recommendations
 * - Recipients: Automatically sends to OWNER, ADMIN, and HR level users
 * - Duplicate prevention: Prevents sending multiple reports on the same day
 * - Email templates: Uses Handlebars templates for professional report formatting
 *
 * Cron schedules:
 * - Morning checks: Every minute (for accurate 5-minute timing)
 * - Evening checks: Every 30 minutes (sufficient for 30-minute delay)
 */

@Injectable()
export class AttendanceReportsService {
	private readonly logger = new Logger(AttendanceReportsService.name);

	// ======================================================
	// TIMEZONE HELPER METHODS
	// ======================================================

	/**
	 * Format time in organization timezone for reports
	 */
	private async formatTimeInOrganizationTimezone(date: Date, organizationId?: string | number, format: string = 'h:mm a'): Promise<string> {
		if (!date) return 'N/A';
		if (organizationId == null || organizationId === '') return formatInTimeZone(date, 'Africa/Johannesburg', format);
		
		const timezone = await this.getOrganizationTimezone(organizationId);
		return formatInTimeZone(date, timezone, format);
	}

	/**
	 * Check if current time is within report sending window for organization
	 */
	private isWithinReportWindow(
		organizationStartTime: string,
		organizationEndTime: string,
		offsetMinutes: number,
		windowMinutes: number,
		organizationTimezone?: string,
		currentTime?: Date
	): {
		isTimeForMorningReport: boolean;
		isTimeForEveningReport: boolean;
		organizationCurrentTime: Date;
		morningReportTime: Date;
		eveningReportTime: Date;
	} {
		const now = currentTime || new Date();
		const orgCurrentTime = toZonedTime(now, organizationTimezone || 'Africa/Johannesburg');
		
		// Parse organization times in their timezone
		const parseTimeInOrg = (timeString: string, baseDate: Date, tz: string): Date => {
			const [hours, minutes] = timeString.split(':').map(Number);
			const zonedBase = toZonedTime(baseDate, tz);
			zonedBase.setHours(hours, minutes, 0, 0);
			return zonedBase;
		};
		
		const morningReportTime = parseTimeInOrg(organizationStartTime, orgCurrentTime, organizationTimezone || 'Africa/Johannesburg');
		morningReportTime.setMinutes(morningReportTime.getMinutes() + offsetMinutes);
		
		const eveningReportTime = parseTimeInOrg(organizationEndTime, orgCurrentTime, organizationTimezone || 'Africa/Johannesburg');
		eveningReportTime.setMinutes(eveningReportTime.getMinutes() + offsetMinutes);
		
		// Check if we're within the window for each report
		const isWithinMinutes = (time1: Date, time2: Date, windowMinutes: number): boolean => {
			const diff = Math.abs(time1.getTime() - time2.getTime());
			return diff <= windowMinutes * 60 * 1000;
		};
		
		const isTimeForMorningReport = isWithinMinutes(orgCurrentTime, morningReportTime, windowMinutes);
		const isTimeForEveningReport = isWithinMinutes(orgCurrentTime, eveningReportTime, windowMinutes);
		
		return {
			isTimeForMorningReport,
			isTimeForEveningReport,
			organizationCurrentTime: orgCurrentTime,
			morningReportTime,
			eveningReportTime,
		};
	}

	constructor(
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(OrganisationSettings)
		private organisationSettingsRepository: Repository<OrganisationSettings>,
		@InjectRepository(Report)
		private reportsRepository: Repository<Report>,
		private readonly organizationHoursService: OrganizationHoursService,
		private readonly userService: UserService,
		private readonly eventEmitter: EventEmitter2,
	) {
		this.logger.log('🌍 AttendanceReportsService initialized with timezone-aware scheduling');
	}

	/**
	 * Resolves Clerk org ID (string) to organisation numeric uid.
	 * Looks up by clerkOrgId or ref. Returns null if not found.
	 */
	private async resolveOrgId(clerkOrgId?: string): Promise<number | null> {
		if (!clerkOrgId) {
			return null;
		}
		const org = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId, isDeleted: false },
				{ ref: clerkOrgId, isDeleted: false },
			],
			select: ['uid'],
		});
		return org?.uid ?? null;
	}

	/**
	 * Resolves organisation numeric uid to Clerk org ID string (clerkOrgId or ref).
	 * Returns null if not found.
	 */
	private async resolveUidToOrgIdString(uid: number): Promise<string | null> {
		const org = await this.organisationRepository.findOne({
			where: { uid, isDeleted: false },
			select: ['clerkOrgId', 'ref'],
		});
		return org ? (org.clerkOrgId || org.ref) : null;
	}

	/**
	 * Get organization timezone with fallback to settings.
	 * Accepts string (clerkOrgId/ref) or number (uid). Uses string for org hours lookup.
	 */
	private async getOrganizationTimezone(organizationId: string | number): Promise<string> {
		try {
			const orgIdString = typeof organizationId === 'number'
				? await this.resolveUidToOrgIdString(organizationId)
				: organizationId;
			if (orgIdString) {
				const organizationHours = await this.organizationHoursService.getOrganizationHours(orgIdString);
				if (organizationHours?.timezone) {
					return organizationHours.timezone;
				}
			}

			// Fallback to organization settings (only when we have numeric uid)
			if (typeof organizationId === 'number') {
				const orgSettings = await this.organisationSettingsRepository.findOne({
					where: { organisationUid: organizationId },
				});
				if (orgSettings?.regional?.timezone) {
					return orgSettings.regional.timezone;
				}
			}

			return 'Africa/Johannesburg';
		} catch (error) {
			this.logger.warn(`Error getting timezone for org ${organizationId}, using default:`, error);
			return 'Africa/Johannesburg';
		}
	}

	/**
	 * Convert date to organization timezone for email templates
	 */
	private async convertTimeToOrgTimezone(date: Date, organizationId: string | number): Promise<string> {
		const timezone = await this.getOrganizationTimezone(organizationId);
		return formatInTimeZone(date, timezone, 'HH:mm zzz');
	}

	/**
	 * Schedule reports to run every 10 minutes with timezone-aware processing
	 * Each organization is processed based on its local timezone
	 */
	@Cron('*/10 * * * *') // Run every 10 minutes
	async checkAndSendReports() {
		this.logger.log('Starting scheduled report check');

		try {
			const now = new Date();

			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
			});

			this.logger.log(`Found ${organizations.length} organizations to process`);

			// Process organizations with timezone-aware filtering
			const processedOrgs = [];
			const skippedOrgs = [];

			const reportPromises = organizations.map(async (org) => {
				try {
					// Get organization timezone using the new helper method
					const organizationTimezone = await this.getOrganizationTimezone(org.uid);
					const orgCurrentTime = toZonedTime(now, organizationTimezone);
					const orgCurrentHour = orgCurrentTime.getHours();

					// Only process organizations during reasonable business hours in their timezone (5 AM - 11 PM)
					if (orgCurrentHour < 5 || orgCurrentHour > 23) {
						this.logger.debug(
							`Skipping organization ${org.uid} - quiet hours in ${organizationTimezone || 'Africa/Johannesburg'} (${orgCurrentHour}:00)`,
						);
						skippedOrgs.push({
							id: org.uid,
							name: org.name,
							timezone: organizationTimezone || 'Africa/Johannesburg',
							localTime: formatInTimeZone(orgCurrentTime, organizationTimezone, 'HH:mm'),
						});
						return;
					}

					this.logger.debug(
						`Processing reports for organization ${org.uid} - Local time: ${formatInTimeZone(orgCurrentTime, organizationTimezone, 'HH:mm zzz')}`,
					);

					processedOrgs.push({
						id: org.uid,
						name: org.name,
						timezone: organizationTimezone || 'Africa/Johannesburg',
						localTime: formatInTimeZone(orgCurrentTime, organizationTimezone, 'HH:mm'),
					});

					await Promise.all([
						this.processMorningReportForOrganization(org, now),
						this.processEveningReportForOrganization(org, now),
					]);
				} catch (error) {
					this.logger.error(`Error processing reports for organization ${org.uid}:`, error);
				}
			});

			await Promise.all(reportPromises);

			// Log summary
			this.logger.log(
				`📊 Scheduled report check completed - Processed: ${processedOrgs.length}, Skipped: ${skippedOrgs.length}`,
			);

			if (processedOrgs.length > 0) {
				this.logger.debug(
					`✅ Processed organizations: ${processedOrgs.length} org(s)`,
				);
			}

			if (skippedOrgs.length > 0) {
				this.logger.debug(
					`⏭️  Skipped organizations: ${skippedOrgs.length} org(s)`,
				);
			}
		} catch (error) {
			this.logger.error('Error in checkAndSendReports:', error);
		}
	}

	private async processMorningReportForOrganization(organization: Organisation, currentTime: Date) {
		this.logger.debug(`Processing morning report for organization ${organization.uid}`);

		try {
			// Get organization timezone from organization hours service
			const orgId = organization.clerkOrgId || organization.ref;
			const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const organizationTimezone = organizationHours?.timezone;

			// Convert current time to organization timezone
			const orgCurrentTime = toZonedTime(currentTime, organizationTimezone);

			// Get working day info using organization timezone (orgId is clerkOrgId/ref string)
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
				orgId,
				orgCurrentTime,
			);

			if (!workingDayInfo.isWorkingDay || !workingDayInfo.startTime) {
				this.logger.debug(
					`⏭️  Skipping morning report for org ${organization.uid} - not a working day or no start time in ${organizationTimezone || 'Africa/Johannesburg'}`,
				);
				return; // Skip non-working days
			}

			// Check if we're within the morning report window (30 minutes after start time)
			const reportWindow = this.isWithinReportWindow(
				workingDayInfo.startTime,
				workingDayInfo.endTime || '17:00',
				30, // 30 minutes after start time
				10, // 10-minute window (matches our cron interval)
				organizationTimezone,
				currentTime,
			);

			if (!reportWindow.isTimeForMorningReport) {
				this.logger.debug(
					`⏰ Not time for morning report for org ${organization.uid} yet - Current: ${formatInTimeZone(orgCurrentTime, organizationTimezone, 'HH:mm')}, Report time: ${reportWindow.morningReportTime
						.toTimeString()
						.substring(0, 5)} in ${organizationTimezone || 'Africa/Johannesburg'}`,
				);
				return; // Not time for morning report yet
			}

			// Check if we already sent a report today (using organization timezone)
			const orgToday = startOfDay(orgCurrentTime);
			const cacheKey = `morning_report_${organization.uid}_${format(orgToday, 'yyyy-MM-dd')}`;

			if (this.hasReportBeenSent(cacheKey)) {
				this.logger.debug(
					`✅ Morning report already sent today for org ${organization.uid} on ${format(orgToday, 'yyyy-MM-dd')} in ${organizationTimezone || 'Africa/Johannesburg'}`,
				);
				return;
			}

			if (!orgId) {
				this.logger.error(`Organization ${organization.uid} has no clerkOrgId or ref`);
				return;
			}
			this.logger.log(`📅 Generating morning report for organization ${organization.uid}`);
			await this.generateAndSendMorningReport(orgId);
			this.markReportAsSent(cacheKey);

			// Enhanced timezone-aware logging
			const serverTime = currentTime.toISOString();
			const orgTimeFormatted = formatInTimeZone(orgCurrentTime, organizationTimezone, 'HH:mm zzz');
			const workTimeFormatted = `${workingDayInfo.startTime} (30min after: ${reportWindow.morningReportTime
				.toTimeString()
				.substring(0, 5)})`;

			this.logger.log(`✅ Morning report sent for organization ${organization.name} (ID: ${organization.uid})`);
			this.logger.log(`  🕐 Server time: ${serverTime}`);
			this.logger.log(`  🌍 Organization time: ${orgTimeFormatted}`);
			this.logger.log(`  ⏰ Work start time: ${workTimeFormatted}`);
			this.logger.log(`  🗺️  Timezone: ${organizationTimezone || 'Africa/Johannesburg'}`);
			this.logger.log(
				`  📊 Report window: ${reportWindow.morningReportTime.toTimeString().substring(0, 5)} (10min window)`,
			);
		} catch (error) {
			this.logger.error(`Error processing morning report for organization ${organization.uid}:`, error);
		}
	}

	private async processEveningReportForOrganization(organization: Organisation, currentTime: Date) {
		this.logger.debug(`Processing evening report for organization ${organization.uid}`);

		try {
			// Get organization timezone from organization hours service
			const orgId = organization.clerkOrgId || organization.ref;
			const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const organizationTimezone = organizationHours?.timezone;

			// Convert current time to organization timezone
			const orgCurrentTime = toZonedTime(currentTime, organizationTimezone);

			// Get working day info using organization timezone (orgId is clerkOrgId/ref string)
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
				orgId,
				orgCurrentTime,
			);

			if (!workingDayInfo.isWorkingDay || !workingDayInfo.endTime) {
				this.logger.debug(
					`⏭️  Skipping evening report for org ${organization.uid} - not a working day or no end time in ${organizationTimezone || 'Africa/Johannesburg'}`,
				);
				return; // Skip non-working days
			}

			// Check if we're within the evening report window (30 minutes after end time)
			const reportWindow = this.isWithinReportWindow(
				workingDayInfo.startTime || '07:30',
				workingDayInfo.endTime,
				30, // 30 minutes after end time
				10, // 10-minute window (matches our cron interval)
				organizationTimezone,
				currentTime,
			);

			if (!reportWindow.isTimeForEveningReport) {
				this.logger.debug(
					`⏰ Not time for evening report for org ${organization.uid} yet - Current: ${formatInTimeZone(
						orgCurrentTime,
						organizationTimezone || 'Africa/Johannesburg',
						'HH:mm',
					)}, Report time: ${reportWindow.eveningReportTime
						.toTimeString()
						.substring(0, 5)} in ${organizationTimezone || 'Africa/Johannesburg'}`,
				);
				return; // Not time for evening report yet
			}

			// Check if we already sent a report today (using organization timezone)
			const orgToday = startOfDay(orgCurrentTime);
			const cacheKey = `evening_report_${organization.uid}_${format(orgToday, 'yyyy-MM-dd')}`;

			if (this.hasReportBeenSent(cacheKey)) {
				this.logger.debug(
					`✅ Evening report already sent today for org ${organization.uid} on ${format(orgToday, 'yyyy-MM-dd')} in ${organizationTimezone || 'Africa/Johannesburg'}`,
				);
				return;
			}

			if (!orgId) {
				this.logger.error(`Organization ${organization.uid} has no clerkOrgId or ref`);
				return;
			}
			this.logger.log(`🌅 Generating evening report for organization ${organization.uid}`);
			await this.generateAndSendEveningReport(orgId);
			this.markReportAsSent(cacheKey);

			// Enhanced timezone-aware logging
			const serverTime = currentTime.toISOString();
			const orgTimeFormatted = formatInTimeZone(orgCurrentTime, organizationTimezone, 'HH:mm zzz');
			const workTimeFormatted = `${workingDayInfo.endTime} (30min after: ${reportWindow.eveningReportTime
				.toTimeString()
				.substring(0, 5)})`;

			this.logger.log(`✅ Evening report sent for organization ${organization.uid}`);
			this.logger.log(`  🕐 Server time: ${serverTime}`);
			this.logger.log(`  🌍 Organization time: ${orgTimeFormatted}`);
			this.logger.log(`  ⏰ Work end time: ${workTimeFormatted}`);
			this.logger.log(`  🗺️  Timezone: ${organizationTimezone || 'Africa/Johannesburg'}`);
			this.logger.log(
				`  📊 Report window: ${reportWindow.eveningReportTime.toTimeString().substring(0, 5)} (10min window)`,
			);
		} catch (error) {
			this.logger.error(`Error processing evening report for organization ${organization.uid}:`, error);
		}
	}

	private reportCache = new Set<string>();

	private hasReportBeenSent(cacheKey: string): boolean {
		return this.reportCache.has(cacheKey);
	}

	private markReportAsSent(cacheKey: string): void {
		this.reportCache.add(cacheKey);
		// Clean up after 24 hours
		setTimeout(() => {
			this.reportCache.delete(cacheKey);
			this.logger.debug(`Cleaned up cache key: ${cacheKey}`);
		}, 24 * 60 * 60 * 1000);
	}

	/**
	 * Generate and send morning attendance report
	 */
	async generateAndSendMorningReport(organizationId: string): Promise<void> {
		// Validate organisation exists
		const organisation = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId: organizationId },
				{ ref: organizationId }
			]
		});
		if (!organisation) {
			throw new BadRequestException(`Organization not found for ID: ${organizationId}`);
		}
		this.logger.log(`Generating and sending morning report for organization ${organizationId}`);

		try {
			const reportData = await this.generateMorningReportData(organizationId);
			this.logger.log(`Morning report data generated for organization ${organizationId}`);

			const recipients = await this.getReportRecipients(organizationId);

			if (recipients.length === 0) {
				this.logger.warn(`No recipients found for morning report - Organization ID: ${organizationId}`);
				return;
			}

			this.logger.log(
				`Sending morning report to ${recipients.length} recipients for organization ${organizationId}`,
			);
			this.eventEmitter.emit('send.email', EmailType.ATTENDANCE_MORNING_REPORT, recipients, reportData);

			this.logger.log(
				`Morning attendance report generated and sent for organization ${organizationId} to ${recipients.length} recipients`,
			);
		} catch (error) {
			this.logger.error(`Error generating morning report for organization ${organizationId}:`, error);
			throw error;
		}
	}

	/**
	 * Generate and send evening attendance report
	 */
	async generateAndSendEveningReport(organizationId: string): Promise<void> {
		// Validate organisation exists
		const organisation = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId: organizationId },
				{ ref: organizationId }
			]
		});
		if (!organisation) {
			throw new BadRequestException(`Organization not found for ID: ${organizationId}`);
		}
		this.logger.log(`Generating and sending evening report for organization ${organizationId}`);

		try {
			const reportData = await this.generateEveningReportData(organizationId);
			this.logger.log(`Evening report data generated for organization ${organizationId}`);

			const recipients = await this.getReportRecipients(organizationId);

			if (recipients.length === 0) {
				this.logger.warn(`No recipients found for evening report - Organization ID: ${organizationId}`);
				return;
			}

			this.logger.log(
				`Sending evening report to ${recipients.length} recipients for organization ${organizationId}`,
			);
			this.eventEmitter.emit('send.email', EmailType.ATTENDANCE_EVENING_REPORT, recipients, reportData);

			this.logger.log(
				`Evening attendance report generated and sent for organization ${organizationId} to ${recipients.length} recipients`,
			);
		} catch (error) {
			this.logger.error(`Error generating evening report for organization ${organizationId}:`, error);
			throw error;
		}
	}

	/**
	 * Generate and send morning attendance report to specific recipients
	 */
	async generateAndSendMorningReportToUser(organizationId: string, userEmail: string): Promise<MorningReportData> {
		// Validate organisation exists
		const organisation = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId: organizationId },
				{ ref: organizationId }
			]
		});
		if (!organisation) {
			throw new BadRequestException(`Organization not found for ID: ${organizationId}`);
		}
		this.logger.log(
			`Generating and sending morning report to user ${userEmail} for organization ${organizationId}`,
		);

		try {
			const reportData = await this.generateMorningReportData(organizationId);
			const recipients = [userEmail];

			if (recipients.length === 0) {
				this.logger.warn(`No recipients found for morning report - Organization ID: ${organizationId}`);
				return reportData;
			}

			this.logger.log(`Sending morning report to ${userEmail} for organization ${organizationId}`);
			this.eventEmitter.emit('send.email', EmailType.ATTENDANCE_MORNING_REPORT, recipients, reportData);

			this.logger.log(
				`Morning attendance report generated and sent for organization ${organizationId} to ${userEmail}`,
			);

			return reportData;
		} catch (error) {
			this.logger.error(`Error generating morning report for organization ${organizationId}:`, error);
			throw error;
		}
	}

	/**
	 * Generate and send evening attendance report to specific recipients
	 */
	async generateAndSendEveningReportToUser(organizationId: string, userEmail: string): Promise<EveningReportData> {
		// Validate organisation exists
		const organisation = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId: organizationId },
				{ ref: organizationId }
			]
		});
		if (!organisation) {
			throw new BadRequestException(`Organization not found for ID: ${organizationId}`);
		}
		this.logger.log(
			`Generating and sending evening report to user ${userEmail} for organization ${organizationId}`,
		);

		try {
			const reportData = await this.generateEveningReportData(organizationId);
			const recipients = [userEmail];

			if (recipients.length === 0) {
				this.logger.warn(`No recipients found for evening report - Organization ID: ${organizationId}`);
				return reportData;
			}

			this.logger.log(`Sending evening report to ${userEmail} for organization ${organizationId}`);
			this.eventEmitter.emit('send.email', EmailType.ATTENDANCE_EVENING_REPORT, recipients, reportData);

			this.logger.log(
				`Evening attendance report generated and sent for organization ${organizationId} to ${userEmail}`,
			);

			return reportData;
		} catch (error) {
			this.logger.error(`Error generating evening report for organization ${organizationId}:`, error);
			throw error;
		}
	}

	private async generateMorningReportData(organizationId: string): Promise<MorningReportData> {
		this.logger.log(`Generating morning report data for organization ${organizationId}`);

		// Get organization timezone using the enhanced helper method
		const organizationTimezone = await this.getOrganizationTimezone(organizationId);

		// Use organization timezone for "today" calculations
		const today = toZonedTime(new Date(), organizationTimezone);
		const startOfToday = startOfDay(today);
		const endOfToday = endOfDay(today);

		this.logger.debug(
			`Processing data for date range: ${startOfToday.toISOString()} to ${endOfToday.toISOString()}`,
		);

		// Get organization info - lookup by clerkOrgId or ref
		const organization = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId: organizationId },
				{ ref: organizationId }
			]
		});

		if (!organization) {
			this.logger.error(`Organization ${organizationId} not found`);
			throw new Error(`Organization ${organizationId} not found`);
		}

		// Get organization settings including social links - use organisation uid
		const organizationSettings = await this.organisationSettingsRepository.findOne({
			where: { organisationUid: organization.uid },
		});

		this.logger.debug(`Organization found: ${organization.name}`);

		// Get working day info for organization hours with fallback
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, today);

		// Ensure we have valid start time with fallback
		const organizationStartTime = workingDayInfo.startTime || '07:30';
		this.logger.debug(`Organization start time: ${organizationStartTime}`);

		// Get all users in the organization with better error handling - only count those who should work today
		let allUsers = [];
		let totalEmployees = 0;

		try {
			const usersResponse = await this.userService.findAll({ orgId: organizationId }, 1, 1000);
			allUsers = usersResponse.data || [];
			this.logger.debug(`Found ${allUsers.length} users in organization ${organizationId}`);

			// Only count active users who should work today (based on organization schedule)
			// Filter organization-specific users and exclude deleted/inactive users
			const activeOrgUsers = allUsers.filter(user => 
				!user.isDeleted && 
				user.status !== 'INACTIVE' && 
				(user.organisation?.clerkOrgId === organizationId || user.organisation?.ref === organizationId)
			);
			totalEmployees = await this.getExpectedEmployeesForToday(activeOrgUsers, organizationId, today);
			this.logger.log(`Expected employees for today in org ${organizationId}: ${totalEmployees}`);
		} catch (error) {
			this.logger.warn(`Failed to fetch users for organization ${organizationId}:`, error);
		}

		// Get today's attendance records - filter by clerkOrgId or ref
		const todayAttendance = await this.attendanceRepository.find({
			where: {
				organisation: [
					{ clerkOrgId: organizationId },
					{ ref: organizationId }
				],
				checkIn: Between(startOfToday, endOfToday),
			},
			relations: ['owner', 'owner.userProfile', 'owner.branch'],
		});

		this.logger.log(`Found ${todayAttendance.length} attendance records for today`);

		// Consolidate attendance records by user to handle multiple check-ins
		const consolidatedAttendance = await this.consolidateAttendanceByUser(organizationId, todayAttendance);
		this.logger.log(`Consolidated to ${consolidatedAttendance.size} unique user attendance records`);

		// Get user targets for productivity analysis
		const userTargets = await this.getUserTargetsForOrganization(organizationId);
		this.logger.debug(`Retrieved user targets for ${userTargets.usersWithTargets} users`);

		// Calculate real-time total hours worked (including people still working) using organization hours
		const totalActualHours = await this.calculateTotalActualHoursWithOrgHours(
			todayAttendance,
			organizationId,
			today,
		);
		this.logger.log(`Total actual hours worked: ${totalActualHours}`);

		// Use consolidated attendance for correct present count
		const presentCount = consolidatedAttendance.size;
		const absentCount = totalEmployees - presentCount;
		const attendanceRate = totalEmployees > 0 ? (presentCount / totalEmployees) * 100 : 0;

		this.logger.log(
			`Attendance summary: ${presentCount} present, ${absentCount} absent, ${attendanceRate.toFixed(1)}% rate`,
		);

		// Create present employees list from consolidated data
		const presentEmployees: AttendanceReportUser[] = [];
		for (const [userId, userRecord] of consolidatedAttendance) {
			const { user, primaryAttendance, totalHours, isOvertime } = userRecord;

			const fullName = `${user.name || ''} ${user.surname || ''}`.trim();

			// Get late information using organization hours (based on first check-in)
			let lateInfo = { isLate: false, lateMinutes: 0 };
			if (primaryAttendance.checkIn) {
				lateInfo = await this.organizationHoursService.isUserLate(organizationId, primaryAttendance.checkIn);
			}

			const employee: AttendanceReportUser = {
				uid: user.uid,
				name: user.name || 'Unknown',
				surname: user.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: user.email || 'no-email@company.com',
				phone: user.phone || undefined,
				role: user.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: user.photoURL || null,
				},
				branch: user.branch
					? {
							uid: user.branch.uid,
							name: user.branch.name || 'Unknown Branch',
					  }
					: undefined,
			lateMinutes: lateInfo.lateMinutes,
			earlyMinutes: undefined,
			checkInTime: primaryAttendance.checkIn ? await this.formatTimeInOrganizationTimezone(primaryAttendance.checkIn, organizationId, 'HH:mm') : undefined,
			lateStatus: this.determineLateStatus(lateInfo.lateMinutes),
		};

		// Add overtime indicator if applicable
		if (isOvertime) {
			employee.checkInTime = `${employee.checkInTime} (OT: ${totalHours}h)`;
		}

			presentEmployees.push(employee);
		}

		// Enhanced employee categorization using consolidated data
		const employeeCategories = await this.categorizeEmployeesByStatusWithConsolidatedData(
			allUsers,
			consolidatedAttendance,
			organizationId,
			today,
		);

		// Collect enhanced analytics (integrated from user-daily-report.generator.ts)
		const [performanceAnalytics, productivityInsights, wellnessMetrics] = await Promise.all([
			this.collectPerformanceAnalytics(organizationId, allUsers, startOfToday, endOfToday),
			this.collectProductivityInsights(organizationId, allUsers, startOfToday, endOfToday),
			this.collectWellnessMetrics(organizationId, startOfToday, endOfToday),
		]);

		this.logger.log(
			`Employee categories: ${employeeCategories.currentlyWorkingEmployees.length} working, ${employeeCategories.completedShiftEmployees.length} completed`,
		);

		// Generate punctuality breakdown using organization hours
		const punctuality = await this.generatePunctualityBreakdown(organizationId, todayAttendance);
		this.logger.log(
			`Punctuality breakdown: ${punctuality.onTimeArrivals.length} on time, ${punctuality.lateArrivals.length} late`,
		);

		// Generate branch breakdown using organization hours
		const branchBreakdown = await this.generateBranchBreakdownWithOrgHours(
			allUsers,
			todayAttendance,
			organizationId,
			today,
		);
		this.logger.log(`Generated branch breakdown for ${branchBreakdown.length} branches`);

		// Calculate comprehensive lateness summary
		const allLateEmployees = [...punctuality.lateArrivals, ...punctuality.veryLateArrivals];
		const worstLateArrival =
			allLateEmployees.length > 0
				? allLateEmployees.reduce((worst, emp) =>
						(emp.lateMinutes || 0) > (worst.lateMinutes || 0) ? emp : worst,
				  )
				: null;

		const latenessSummary = {
			totalLateEmployees: allLateEmployees.length,
			totalLateMinutes: punctuality.totalLateMinutes,
			averageLateMinutes: punctuality.averageLateMinutes,
			worstLateArrival: worstLateArrival
				? {
						employee: worstLateArrival.fullName,
						minutes: worstLateArrival.lateMinutes || 0,
				  }
				: null,
		};

		// Calculate target performance metrics using organization hours
		const expectedDailyHours = userTargets.totalExpectedDailyHours;
		const productivityRate = expectedDailyHours > 0 ? (totalActualHours / expectedDailyHours) * 100 : 0;
		const hoursDeficit = Math.max(0, expectedDailyHours - totalActualHours);

		// Project end-of-day hours based on current working patterns and organization hours
		const currentTime = today;
		const workDayProgress = await this.calculateWorkDayProgressWithOrgHours(currentTime, organizationId, today);
		const projectedEndOfDayHours = workDayProgress > 0 ? totalActualHours / workDayProgress : totalActualHours;

		const targetPerformance = {
			expectedDailyHours: Math.round(expectedDailyHours * 100) / 100,
			actualHoursToDate: Math.round(totalActualHours * 100) / 100,
			projectedEndOfDayHours: Math.round(projectedEndOfDayHours * 100) / 100,
			onTrackToMeetTargets: projectedEndOfDayHours >= expectedDailyHours * 0.9, // 90% threshold
			targetAchievementRate: Math.round(productivityRate * 100) / 100,
			hoursGapAnalysis:
				hoursDeficit > 0
					? `${Math.round(hoursDeficit * 100) / 100} hours behind target`
					: 'On track or ahead of target',
		};

		this.logger.log(`Target performance: ${targetPerformance.targetAchievementRate}% achievement rate`);

		// Calculate total overtime for the day
		const totalOvertimeMinutes = await this.calculateTotalOvertimeWithOrgHours(
			todayAttendance,
			organizationId,
			today,
		);
		const totalOvertimeHours = totalOvertimeMinutes > 0 
			? TimeCalculatorUtil.formatDuration(totalOvertimeMinutes)
			: '0h 0m';
		
		this.logger.log(`Total overtime for organization: ${totalOvertimeHours}`);

		// Generate enhanced insights and recommendations
		const insights = this.generateEnhancedMorningInsights(
			attendanceRate,
			punctuality,
			presentCount,
			totalEmployees,
			targetPerformance,
			employeeCategories,
		);
		const recommendations = this.generateEnhancedMorningRecommendations(
			punctuality,
			attendanceRate,
			targetPerformance,
			employeeCategories,
		);

		this.logger.log(`Generated ${insights.length} insights and ${recommendations.length} recommendations`);

		// Log detailed user data for debugging
		this.logger.log(`📊 Morning Report User Data Summary for org ${organizationId}:`);
		this.logger.log(`  - Present Employees: ${employeeCategories.presentEmployees.length}`);
		this.logger.log(`  - Absent Employees: ${employeeCategories.absentEmployees.length}`);
		this.logger.log(`  - Currently Working: ${employeeCategories.currentlyWorkingEmployees.length}`);
		this.logger.log(`  - Completed Shifts: ${employeeCategories.completedShiftEmployees.length}`);
		this.logger.log(`  - Overtime Employees: ${employeeCategories.overtimeEmployees.length}`);
		this.logger.log(`  - Consolidated Attendance Records: ${consolidatedAttendance.size}`);
		this.logger.log(`  - Total Users Fetched: ${allUsers.length}`);
		this.logger.log(`  - Today's Attendance Records: ${todayAttendance.length}`);

		// Use employeeCategories consistently for all user lists
		const morningReportData = {
			organizationName: organization?.name || 'Organization',
			reportDate: format(today, 'EEEE, MMMM do, yyyy'),
			organizationStartTime,
			totalOvertimeHours,
			summary: {
				totalEmployees,
				presentCount,
				absentCount,
				attendanceRate: Math.round(attendanceRate * 100) / 100,
				totalActualHours: Math.round(totalActualHours * 100) / 100,
				totalExpectedHours: Math.round(expectedDailyHours * 100) / 100,
				productivityRate: Math.round(productivityRate * 100) / 100,
				hoursDeficit: Math.round(hoursDeficit * 100) / 100,
			},
			punctuality,
			presentEmployees: employeeCategories.presentEmployees,
			absentEmployees: employeeCategories.absentEmployees,
			currentlyWorkingEmployees: employeeCategories.currentlyWorkingEmployees,
			completedShiftEmployees: employeeCategories.completedShiftEmployees,
			overtimeEmployees: employeeCategories.overtimeEmployees,
			branchBreakdown,
			targetPerformance,
			insights,
			recommendations,
			generatedAt: formatInTimeZone(today, organizationTimezone, 'yyyy-MM-dd HH:mm:ss'),
			dashboardUrl: process.env.APP_URL || 'https://loro.co.za',
			hasEmployees: totalEmployees > 0,
			latenessSummary,
			socialLinks: organizationSettings?.socialLinks || null,
			// Enhanced analytics data (integrated from user-daily-report.generator.ts)
			enhancedAnalytics: {
				performance: performanceAnalytics,
				productivity: productivityInsights,
				wellness: wellnessMetrics,
			},
		};

		this.logger.log(`Morning report data generated successfully for organization ${organizationId}`);
		return morningReportData;
	}

	private async generateEveningReportData(organizationId: string): Promise<EveningReportData> {
		this.logger.log(`🌅 ===== STARTING EVENING REPORT GENERATION for org ${organizationId} =====`);

		// Get organization timezone using the enhanced helper method
		const organizationTimezone = await this.getOrganizationTimezone(organizationId);

		// Use organization timezone for "today" calculations
		const today = toZonedTime(new Date(), organizationTimezone);
		const startOfToday = startOfDay(today);
		const endOfToday = endOfDay(today);

		this.logger.debug(
			`Processing data for date range: ${startOfToday.toISOString()} to ${endOfToday.toISOString()}`,
		);

		// Get organization info - lookup by clerkOrgId or ref
		const organization = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId: organizationId },
				{ ref: organizationId }
			]
		});

		if (!organization) {
			this.logger.error(`Organization ${organizationId} not found`);
			throw new Error(`Organization ${organizationId} not found`);
		}

		this.logger.debug(`Organization found: ${organization.name}`);

		// Get organization settings including social links - use organisation uid
		const organizationSettings = await this.organisationSettingsRepository.findOne({
			where: { organisationUid: organization.uid },
		});

		// Get working day info for organization hours with fallback
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, today);
		const organizationStartTime = workingDayInfo.startTime || '07:30';
		const organizationCloseTime = workingDayInfo.endTime || '17:00';

		this.logger.debug(`Organization hours: ${organizationStartTime} to ${organizationCloseTime}`);

		// Find the most recent working day for comparison (smart yesterday logic)
		const { comparisonDate, comparisonLabel } = await this.findLastWorkingDay(organizationId, today);
		const startOfComparison = startOfDay(comparisonDate);
		const endOfComparison = endOfDay(comparisonDate);

		this.logger.debug(`Comparison date (${comparisonLabel}): ${comparisonDate.toISOString()}`);

		// Get today's and comparison day's attendance records (moved up for fallback logic)
		const [todayAttendance, comparisonAttendance] = await Promise.all([
			this.attendanceRepository.find({
				where: {
					organisation: [
						{ clerkOrgId: organizationId },
						{ ref: organizationId }
					],
					checkIn: Between(startOfToday, endOfToday),
				},
				relations: ['owner', 'owner.userProfile', 'owner.branch'],
			}),
			this.attendanceRepository.find({
				where: {
					organisation: [
						{ clerkOrgId: organizationId },
						{ ref: organizationId }
					],
					checkIn: Between(startOfComparison, endOfComparison),
				},
				relations: ['owner'],
			}),
		]);

		this.logger.log(
			`📊 ATTENDANCE DATA: Found ${todayAttendance.length} attendance records for today, ${comparisonAttendance.length} for ${comparisonLabel}`,
		);

		// Get all users in the organization with better error handling - only count those who should work today
		let allUsers = [];

		this.logger.log(`🚀 STARTING USER FETCH for evening report org ${organizationId}`);
		
		try {
			this.logger.log(`📞 Calling userService.findAll with organisationId: ${organizationId}`);
			const usersResponse = await this.userService.findAll({ orgId: organizationId }, 1, 1000);
			this.logger.log(`📞 UserService response received:`, {
				success: !!usersResponse,
				hasData: !!usersResponse?.data,
				dataLength: usersResponse?.data?.length || 0,
			});
			
			allUsers = usersResponse.data || [];
			this.logger.log(`🔍 EVENING REPORT - INITIAL USER FETCH: Found ${allUsers.length} users in organization ${organizationId}`);
			
			if (allUsers.length === 0) {
				this.logger.error(`🚨 EVENING REPORT - NO USERS FOUND! UserService response:`, {
					response: usersResponse,
					organisationId: organizationId,
					queryParams: { organisationId: organizationId }
				});
			}
			
			// Log some sample users before filtering
			const sampleUsers = allUsers.slice(0, 3).map(u => ({
				uid: u.uid,
				name: u.name,
				surname: u.surname,
				email: u.email,
				isDeleted: u.isDeleted,
				status: u.status,
				organisationId: u.organisationId
			}));
			this.logger.log(`🔍 EVENING REPORT - Sample Users Before Filtering: ${JSON.stringify(sampleUsers, null, 2)}`);
			
			// Filter organization-specific users and exclude deleted/inactive users
			const beforeFilterCount = allUsers.length;
			allUsers = allUsers.filter(user => 
				!user.isDeleted && 
				user.status !== 'INACTIVE' && 
				user.organisationId === organizationId
			);
			this.logger.log(`🔍 EVENING REPORT - USER FILTERING: ${beforeFilterCount} -> ${allUsers.length} users after filtering (removed deleted/inactive/wrong org)`);
			
			if (allUsers.length === 0 && beforeFilterCount > 0) {
				this.logger.error(`🚨 ALL USERS FILTERED OUT! Filtering criteria removing all users:`, {
					beforeCount: beforeFilterCount,
					afterCount: allUsers.length,
					organizationId: organizationId
				});
			}
			
			// Log filtered users
			const filteredSample = allUsers.slice(0, 3).map(u => ({
				uid: u.uid,
				name: u.name,
				surname: u.surname,
				email: u.email
			}));
			this.logger.log(`🔍 EVENING REPORT - Sample Users After Filtering: ${JSON.stringify(filteredSample, null, 2)}`);
		} catch (error) {
			this.logger.error(`🚨 CRITICAL ERROR: Failed to fetch users for evening report organization ${organizationId}:`, error);
			this.logger.error(`Error details:`, {
				message: error.message,
				stack: error.stack,
				organizationId: organizationId
			});
		}

		// If we still have no users, try an alternative query method
		if (allUsers.length === 0) {
			this.logger.log(`🔄 ATTEMPTING FALLBACK USER QUERY for org ${organizationId}`);
			try {
				// Try the same query pattern used for recipients that works
				const fallbackResponse = await this.userService.findAll({
					orgId: organizationId,
					status: AccountStatus.ACTIVE // Remove specific access level to get all active users
				}, 1, 1000);
				
				this.logger.log(`🔄 Fallback query response:`, {
					success: !!fallbackResponse,
					hasData: !!fallbackResponse?.data,
					dataLength: fallbackResponse?.data?.length || 0,
				});

				if (fallbackResponse?.data?.length > 0) {
					allUsers = fallbackResponse.data.filter(user => 
						!user.isDeleted && 
						user.status !== 'INACTIVE' && 
						(user.organisation?.clerkOrgId === organizationId || user.organisation?.ref === organizationId)
					);
					this.logger.log(`🔄 FALLBACK SUCCESS: Found ${allUsers.length} users via fallback query`);
				}
			} catch (fallbackError) {
				this.logger.error(`🚨 FALLBACK QUERY ALSO FAILED:`, fallbackError);
			}
		}

		// FINAL FALLBACK: If we still have no users but have attendance records, 
		// create synthetic user data from attendance records (like morning report works)
		if (allUsers.length === 0) {
			this.logger.log(`🆘 EMERGENCY FALLBACK: Creating synthetic user data from attendance records`);
			
			// Extract unique users from attendance records
			const attendanceUsers = new Map();

			todayAttendance.forEach(attendance => {
				if (attendance.owner && !attendanceUsers.has(attendance.owner.uid)) {
					attendanceUsers.set(attendance.owner.uid, attendance.owner);
				}
			});
			
			allUsers = Array.from(attendanceUsers.values());
			this.logger.log(`🆘 EMERGENCY FALLBACK SUCCESS: Created ${allUsers.length} synthetic users from attendance records`);
			
			// Log the synthetic users
			const syntheticSample = allUsers.map(u => ({
				uid: u.uid,
				name: u.name,
				surname: u.surname,
				email: u.email
			}));
			this.logger.log(`🆘 Synthetic Users: ${JSON.stringify(syntheticSample, null, 2)}`);
		}

		// Final verification
		this.logger.log(`🔎 FINAL USER COUNT CHECK for evening report org ${organizationId}: ${allUsers.length} users`);

		// Log attendance records in detail
		this.logger.log(`🔍 TODAY'S ATTENDANCE RECORDS DETAILS:`);
		todayAttendance.forEach((attendance, index) => {
			this.logger.log(`  [${index + 1}] Owner: ${attendance.owner?.name} ${attendance.owner?.surname} (UID: ${attendance.owner?.uid})`);
			this.logger.log(`      - Check In: ${attendance.checkIn ? format(attendance.checkIn, 'HH:mm') : 'No check-in'}`);
			this.logger.log(`      - Check Out: ${attendance.checkOut ? format(attendance.checkOut, 'HH:mm') : 'No check-out'}`);
			this.logger.log(`      - Duration: ${attendance.duration || 'No duration'}`);
			this.logger.log(`      - Status: ${attendance.status || 'No status'}`);
		});

		// Create present employees list using organization hours for lateness calculation
		const presentEmployees: AttendanceReportUser[] = [];
		for (const attendance of todayAttendance) {
			const owner = attendance.owner;
			if (!owner) continue;

			const fullName = `${owner.name || ''} ${owner.surname || ''}`.trim();

			// Get late information using organization hours
			let lateInfo = { isLate: false, lateMinutes: 0 };
			if (attendance.checkIn) {
				lateInfo = await this.organizationHoursService.isUserLate(organizationId, attendance.checkIn);
			}

			presentEmployees.push({
				uid: owner.uid,
				name: owner.name || 'Unknown',
				surname: owner.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: owner.email || 'no-email@company.com',
				phone: owner.phone || undefined,
				role: owner.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: owner.photoURL || null,
				},
				branch: owner.branch
					? {
							uid: owner.branch.uid,
							name: owner.branch.name || 'Unknown Branch',
					  }
			: undefined,
			lateMinutes: lateInfo.lateMinutes,
			earlyMinutes: undefined,
			checkInTime: attendance.checkIn ? await this.formatTimeInOrganizationTimezone(attendance.checkIn, organizationId, 'HH:mm') : undefined,
			lateStatus: this.determineLateStatus(lateInfo.lateMinutes),
		});
	}

		// Create absent employees list - only count those expected to work today
		const presentUserIds = new Set(todayAttendance.map((att) => att.owner?.uid));
		const absentEmployees: AttendanceReportUser[] = [];

		// Only include absent employees if today is a working day
		if (workingDayInfo.isWorkingDay) {
			const absentUsers = allUsers.filter(
				(user) => !presentUserIds.has(user.uid) && !user.isDeleted && user.status !== 'INACTIVE',
			);

			for (const user of absentUsers) {
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				absentEmployees.push({
					uid: user.uid,
					name: user.name || 'Unknown',
					surname: user.surname || 'User',
					fullName: fullName || 'Unknown User',
					email: user.email || 'no-email@company.com',
					phone: user.phone || undefined,
					role: user.accessLevel || AccessLevel.USER,
					userProfile: {
						avatar: user.photoURL || null,
					},
					branch: user.branch
						? {
								uid: user.branch.uid,
								name: user.branch.name || 'Unknown Branch',
						  }
						: undefined,
					lateMinutes: undefined,
					earlyMinutes: undefined,
					checkInTime: undefined,
					lateStatus: undefined,
				});
			}
		}

		this.logger.log(`Present employees: ${presentEmployees.length}, Absent employees: ${absentEmployees.length}`);

		// Get user targets for productivity analysis
		const userTargets = await this.getUserTargetsForOrganization(organizationId);
		this.logger.debug(`Retrieved user targets for ${userTargets.usersWithTargets} users`);

		// Enhanced employee categorization with organization hours
		const employeeCategories = await this.categorizeEmployeesByStatusWithOrgHours(
			allUsers,
			todayAttendance,
			organizationId,
			today,
		);

		// Collect enhanced analytics for evening report
		const [performanceAnalytics, productivityInsights, wellnessMetrics] = await Promise.all([
			this.collectPerformanceAnalytics(organizationId, allUsers, startOfToday, endOfToday),
			this.collectProductivityInsights(organizationId, allUsers, startOfToday, endOfToday),
			this.collectWellnessMetrics(organizationId, startOfToday, endOfToday),
		]);

		// Generate branch breakdown using organization hours
		const branchBreakdown = await this.generateBranchBreakdownWithOrgHours(
			allUsers,
			todayAttendance,
			organizationId,
			today,
		);
		this.logger.log(`Generated branch breakdown for ${branchBreakdown.length} branches`);

		// Calculate real-time total hours worked using organization hours
		const totalActualHours = await this.calculateTotalActualHoursWithOrgHours(
			todayAttendance,
			organizationId,
			today,
		);
		this.logger.log(`Total actual hours worked: ${totalActualHours}`);

		// Generate employee metrics with improved comparison logic using organization hours
		const employeeMetrics = await this.generateEmployeeMetricsWithOrgHours(
			organizationId,
			allUsers,
			todayAttendance,
			comparisonAttendance,
			comparisonLabel,
		);

		this.logger.log(`Generated metrics for ${employeeMetrics.length} employees`);

		// Log the raw employee metrics before mapping to template format
		this.logger.log(`🔄 Raw Employee Metrics Before Template Mapping:`);
		this.logger.log(`  - Total Raw Metrics: ${employeeMetrics.length}`);
		this.logger.log(`  - Raw Metrics with Check-in: ${employeeMetrics.filter(m => m.todayCheckIn).length}`);
		this.logger.log(`  - Raw Metrics with Hours > 0: ${employeeMetrics.filter(m => m.hoursWorked > 0).length}`);
		employeeMetrics.slice(0, 3).forEach((metric, index) => {
			this.logger.log(`  Raw Metric ${index + 1}: ${metric.user.fullName} - Check-in: ${metric.todayCheckIn}, Hours: ${metric.hoursWorked}`);
		});

		// Map employee metrics to template format with enhanced real-time hours and daily report data
		const templateEmployeeMetrics = [];
		
		this.logger.log(`🔄 STARTING TEMPLATE MAPPING: ${employeeMetrics.length} metrics to process`);
		
		// Fetch today's daily reports for all users in the organization to get distance/location data
		this.logger.log(`📍 Fetching daily reports for distance/location data...`);
		const dailyReports = new Map();
		
		try {
			const todayDateString = format(today, 'yyyy-MM-dd');
			const reportsResult = await this.reportsRepository.find({
				where: {
					reportType: ReportType.USER_DAILY,
					generatedAt: Between(startOfToday, endOfToday),
					organisation: [
						{ clerkOrgId: organizationId },
						{ ref: organizationId }
					]
				},
				relations: ['owner']
			});
			
			this.logger.log(`📍 Found ${reportsResult.length} daily reports for ${todayDateString}`);
			
			reportsResult.forEach(report => {
				if (report.owner?.uid) {
					dailyReports.set(report.owner.uid, report.reportData);
				}
			});
		} catch (error) {
			this.logger.error(`Error fetching daily reports for distance data: ${error.message}`);
		}
		
		for (const metric of employeeMetrics) {
			this.logger.debug(`🔄 Processing metric for user: ${metric.user.fullName} (UID: ${metric.user.uid})`);
			
			const todayRecord = todayAttendance.find((a) => a.owner?.uid === metric.user.uid);
			this.logger.debug(`  - Found today record: ${!!todayRecord}`);
			
			const realTimeHours = todayRecord
				? await this.calculateRealTimeHoursWithOrgHours(todayRecord, organizationId, new Date(), format(today, 'yyyy-MM-dd'))
				: 0;
			
			this.logger.debug(`  - Real-time hours: ${realTimeHours}`);

			// Determine employee status with real-time consideration using organization hours
			let status = 'Absent';
			const isCurrentlyWorking = todayRecord && !todayRecord.checkOut && todayRecord.checkIn;
			
			if (metric.todayCheckIn) {
				if (metric.isLate) {
					status = 'Late';
				} else {
					status = 'On Time';
				}
				if (metric.todayCheckOut) {
					status = 'Completed';
				} else if (realTimeHours > 0) {
					status = 'Currently Working';
				}
			}

			// Create yesterday comparison object with enhanced logic
			const yesterdayComparison = {
				hoursChange: Math.round((realTimeHours - metric.yesterdayHours) * 100) / 100,
				punctualityChange: this.calculatePunctualityChange(metric, comparisonAttendance),
			};

			// Get daily report data for this user
			const userDailyReport = dailyReports.get(metric.user.uid);
			const locationData = userDailyReport?.details?.location;
			
			// Extract distance data - show 0 for active shifts, actual distance for completed shifts
			let totalDistance = '0.0 km';
			let distanceKm = 0; // DECLARE DISTANCE KM IN PROPER SCOPE
			let visits = {
				totalVisits: 0,
				totalDistance: '0.0 km',
				averageTimePerLocation: '~',
				visitDetails: []
			};
			
			if (locationData && status === 'Completed') {
				// PRIORITIZE ENHANCED DISTANCE CALCULATION - USE tripSummary.totalDistanceKm
				
				// Priority order: Enhanced tripSummary > gpsData > legacy fields
				if (userDailyReport?.gpsData?.tripSummary?.totalDistanceKm !== undefined) {
					// Use enhanced calculation from GPS recalculation
					distanceKm = userDailyReport.gpsData.tripSummary.totalDistanceKm;
					totalDistance = `${distanceKm.toFixed(1)} km`;
					this.logger.debug(`  - Using enhanced GPS distance: ${totalDistance}`);
				} else if (locationData.tripMetrics?.totalDistanceKm !== undefined) {
					// Use enhanced calculation from location data
					distanceKm = locationData.tripMetrics.totalDistanceKm;
					totalDistance = `${distanceKm.toFixed(1)} km`;
					this.logger.debug(`  - Using tripMetrics distance: ${totalDistance}`);
				} else if (locationData.trackingData?.totalDistanceKm !== undefined) {
					// Use enhanced calculation from tracking data
					distanceKm = locationData.trackingData.totalDistanceKm;
					totalDistance = `${distanceKm.toFixed(1)} km`;
					this.logger.debug(`  - Using trackingData enhanced distance: ${totalDistance}`);
				} else {
					// Fallback to legacy fields
					totalDistance = locationData.trackingData?.totalDistance || locationData.totalDistance + ' km' || '0.0 km';
					this.logger.debug(`  - Using legacy distance: ${totalDistance}`);
				}
				
				visits = {
					totalVisits: locationData.locationAnalysis?.locationsVisited?.length || 0,
					totalDistance: totalDistance,
					averageTimePerLocation: locationData.trackingData?.averageTimePerLocation || '~',
					visitDetails: (locationData.stops || []).map(stop => ({
						location: stop.address || 'Unknown location',
						duration: stop.duration || '0m',
						timestamp: stop.startTime || ''
					}))
				};
			}
			
			this.logger.debug(`  - Distance data: ${totalDistance} (status: ${status})`);

			const templateMetric = {
				uid: metric.user.uid,
				name: metric.user.name || 'Unknown',
				surname: metric.user.surname || 'User',
				email: metric.user.email || 'no-email@company.com',
				role: metric.user.role || 'Staff',
				branch: metric.user.branch,
				checkInTime: metric.todayCheckIn || null,
				checkOutTime: metric.todayCheckOut || null,
				hoursWorked: Math.round(realTimeHours * 100) / 100, // Use real-time hours
				isLate: metric.isLate || false,
				lateMinutes: metric.lateMinutes || 0,
				status,
				yesterdayComparison,
				avatar: metric.user.userProfile?.avatar || null,
				// Add comprehensive daily metrics from user daily reports
				dailyMetrics: {
					// STANDARDIZED DISTANCE FIELDS FOR FRONTEND/EMAIL COMPATIBILITY
					visits,
					location: {
						// Map enhanced distance to location field for frontend compatibility
						totalDistance: totalDistance,
						totalDistanceKm: distanceKm || 0,
						totalLocations: visits.totalVisits,
						trackingData: {
							averageTimePerLocation: visits.averageTimePerLocation,
							distanceTraveled: totalDistance,
							totalDistanceKm: distanceKm || 0,
						},
					},
					leads: {
						newLeads: userDailyReport?.details?.leads?.newLeadsCount || 0,
						convertedLeads: userDailyReport?.details?.leads?.convertedCount || 0,
						conversionRate: userDailyReport?.details?.leads?.conversionRate || 0,
						totalValue: userDailyReport?.details?.quotations?.totalRevenueFormatted || 'R 0,00'
					},
					claims: {
						totalClaims: userDailyReport?.details?.claims?.count || 0,
						totalClaimsValue: 'R 0', // This would need to be calculated if claim values are tracked
						claimTypes: []
					},
					tasks: {
						completed: userDailyReport?.details?.tasks?.completedCount || 0,
						overdue: userDailyReport?.details?.tasks?.overdueCount || 0,
						completionRate: userDailyReport?.details?.tasks?.completionRate || 0,
						priorityBreakdown: userDailyReport?.details?.tasks?.priorityBreakdown || {
							urgent: 0,
							high: 0,
							medium: 0,
							low: 0
						}
					},
					sales: {
						totalRevenue: userDailyReport?.details?.quotations?.totalRevenueFormatted || 'R 0,00',
						quotations: userDailyReport?.details?.quotations?.totalQuotations || 0,
						clientInteractions: userDailyReport?.details?.clients?.totalInteractions || 0,
						revenuePerHour: userDailyReport?.details?.performance?.revenuePerHour || 0
					},
					targets: {
						salesProgress: userDailyReport?.details?.targets?.targetProgress?.sales?.progress || 0,
						leadsProgress: userDailyReport?.details?.targets?.targetProgress?.leads?.progress || 0,
						hoursProgress: userDailyReport?.details?.targets?.targetProgress?.hours?.progress || 0,
						overallTargetScore: 0 // Calculate average if needed
					},
					wellness: {
						stressLevel: userDailyReport?.details?.wellness?.stressLevel || 'low',
						wellnessScore: userDailyReport?.details?.wellness?.wellnessScore || 75,
						breaksTaken: userDailyReport?.details?.attendance?.breakDetails?.length || 0,
						leaveStatus: undefined
					},
					performance: {
						efficiencyScore: userDailyReport?.details?.performance?.overallScore * 100 || 0,
						productivityRank: 0, // This would need ranking calculation
						xpEarned: userDailyReport?.details?.rewards?.dailyXPEarned || 0,
						currentLevel: userDailyReport?.details?.rewards?.currentLevel || 1,
						currentRank: userDailyReport?.details?.rewards?.currentRank || 'ROOKIE'
					}
				}
			};
			
			this.logger.debug(`  - Created template metric:`, {
				name: templateMetric.name,
				checkIn: templateMetric.checkInTime,
				checkOut: templateMetric.checkOutTime,
				hours: templateMetric.hoursWorked,
				status: templateMetric.status,
				distance: templateMetric.dailyMetrics.visits.totalDistance
			});
			
			templateEmployeeMetrics.push(templateMetric);
		}

		// Enhanced logging for template employee metrics (Individual Performance Summary data)
		this.logger.log(`👥 Evening Report Individual Performance Summary for org ${organizationId}:`);
		this.logger.log(`  - Template Employee Metrics: ${templateEmployeeMetrics.length}`);
		this.logger.log(`  - Employees with hours > 0: ${templateEmployeeMetrics.filter(emp => emp.hoursWorked > 0).length}`);
		this.logger.log(`  - Employees with check-in: ${templateEmployeeMetrics.filter(emp => emp.checkInTime).length}`);
		this.logger.log(`  - Late employees: ${templateEmployeeMetrics.filter(emp => emp.isLate).length}`);
		
		// Log ALL template metrics for detailed debugging
		this.logger.log(`📋 DETAILED Individual Performance Data for org ${organizationId}:`);
		templateEmployeeMetrics.forEach((emp, index) => {
			this.logger.log(`  [${index + 1}] Employee: ${emp.name} ${emp.surname}`);
			this.logger.log(`      - UID: ${emp.uid}`);
			this.logger.log(`      - Email: ${emp.email}`);
			this.logger.log(`      - Role: ${emp.role}`);
			this.logger.log(`      - Check In: ${emp.checkInTime || 'No check-in'}`);
			this.logger.log(`      - Check Out: ${emp.checkOutTime || 'No check-out'}`);
			this.logger.log(`      - Hours Worked: ${emp.hoursWorked}`);
			this.logger.log(`      - Status: ${emp.status}`);
			this.logger.log(`      - Is Late: ${emp.isLate}`);
			this.logger.log(`      - Late Minutes: ${emp.lateMinutes}`);
			this.logger.log(`      - Branch: ${emp.branch?.name || 'No branch'}`);
			this.logger.log(`      - Yesterday Comparison: ${JSON.stringify(emp.yesterdayComparison)}`);
			this.logger.log(`      ---`);
		});
		
		// Log sample template metrics for debugging
		const sampleTemplateMetrics = templateEmployeeMetrics.slice(0, 3).map(emp => ({
			name: emp.name,
			surname: emp.surname,
			hoursWorked: emp.hoursWorked,
			checkIn: emp.checkInTime,
			checkOut: emp.checkOutTime,
			status: emp.status,
			isLate: emp.isLate
		}));
		this.logger.log(`  - Sample Template Metrics: ${JSON.stringify(sampleTemplateMetrics, null, 2)}`);

		// Final verification log
		this.logger.log(`🚨 FINAL TEMPLATE METRICS VERIFICATION:`);
		this.logger.log(`  - templateEmployeeMetrics.length: ${templateEmployeeMetrics.length}`);
		this.logger.log(`  - templateEmployeeMetrics is Array: ${Array.isArray(templateEmployeeMetrics)}`);
		this.logger.log(`  - templateEmployeeMetrics[0] exists: ${!!templateEmployeeMetrics[0]}`);
		if (templateEmployeeMetrics[0]) {
			this.logger.log(`  - First metric keys: ${Object.keys(templateEmployeeMetrics[0]).join(', ')}`);
		}

		// Calculate summary statistics with real-time hours using organization hours
		const completedShifts = todayAttendance.filter((a) => a.status === AttendanceStatus.COMPLETED).length;
		const avgHours =
			employeeCategories.presentEmployees.length > 0
				? totalActualHours / employeeCategories.presentEmployees.length
				: 0;

		const standardMinutes = workingDayInfo.expectedWorkMinutes;
		const totalOvertimeMinutes = await this.calculateTotalOvertimeWithOrgHours(
			todayAttendance,
			organizationId,
			today,
		);

		// Calculate target performance metrics using organization hours
		const expectedDailyHours = userTargets.totalExpectedDailyHours;
		const productivityRate = expectedDailyHours > 0 ? (totalActualHours / expectedDailyHours) * 100 : 0;
		const hoursOverTarget = Math.max(0, totalActualHours - expectedDailyHours);
		const hoursUnderTarget = Math.max(0, expectedDailyHours - totalActualHours);

		// Calculate individual target achievements using organization hours
		let individualTargetsMet = 0;
		let individualTargetsMissed = 0;

		for (const emp of templateEmployeeMetrics) {
			const userTarget = userTargets.userTargetsMap.get(emp.uid) || 8;
			if (emp.hoursWorked >= userTarget * 0.9) {
				// 90% threshold
				individualTargetsMet++;
			} else {
				individualTargetsMissed++;
			}
		}

		// Determine team efficiency rating
		let teamEfficiencyRating = 'Poor';
		if (productivityRate >= 95) {
			teamEfficiencyRating = 'Excellent';
		} else if (productivityRate >= 85) {
			teamEfficiencyRating = 'Good';
		} else if (productivityRate >= 75) {
			teamEfficiencyRating = 'Fair';
		}

		const targetPerformance = {
			expectedDailyHours: Math.round(expectedDailyHours * 100) / 100,
			actualTotalHours: Math.round(totalActualHours * 100) / 100,
			targetAchievementRate: Math.round(productivityRate * 100) / 100,
			hoursOverTarget: Math.round(hoursOverTarget * 100) / 100,
			hoursUnderTarget: Math.round(hoursUnderTarget * 100) / 100,
			teamEfficiencyRating,
			individualTargetsMet,
			individualTargetsMissed,
		};

		this.logger.log(
			`Target performance: ${targetPerformance.targetAchievementRate}% achievement rate (${teamEfficiencyRating})`,
		);

		// Calculate comprehensive lateness summary for evening report using organization hours
		const lateEmployeesToday = employeeMetrics.filter((metric) => metric.isLate);
		const totalLateMinutesToday = lateEmployeesToday.reduce((sum, metric) => sum + metric.lateMinutes, 0);
		const averageLateMinutesToday =
			lateEmployeesToday.length > 0
				? Math.round((totalLateMinutesToday / lateEmployeesToday.length) * 100) / 100
				: 0;

		// Determine punctuality trend
		let punctualityTrend = 'stable';
		const latePercentageToday =
			employeeMetrics.length > 0 ? (lateEmployeesToday.length / employeeMetrics.length) * 100 : 0;

		if (latePercentageToday === 0) {
			punctualityTrend = 'excellent - no late arrivals';
		} else if (latePercentageToday < 10) {
			punctualityTrend = 'good - minimal late arrivals';
		} else if (latePercentageToday < 25) {
			punctualityTrend = 'concerning - moderate late arrivals';
		} else {
			punctualityTrend = 'critical - high rate of late arrivals';
		}

		const latenessSummary = {
			totalLateEmployees: lateEmployeesToday.length,
			totalLateMinutes: totalLateMinutesToday,
			averageLateMinutes: averageLateMinutesToday,
			punctualityTrend,
		};

		// Calculate performance comparison with yesterday
		const workedTodayCount = employeeCategories.presentEmployees.length;
		const comparisonWorkedCount = comparisonAttendance.length;
		const attendanceChange =
			comparisonWorkedCount > 0
				? Math.round(((workedTodayCount - comparisonWorkedCount) / comparisonWorkedCount) * 100)
				: 0;

	// Calculate total hours including both duration (capped) and overtime
	const comparisonTotalHours = comparisonAttendance.reduce((sum, attendance) => {
		let totalMinutes = 0;
		
		// Parse duration (capped at expected hours)
		if (attendance.duration) {
			totalMinutes += this.parseDurationToMinutes(attendance.duration);
		}
		
		// Parse overtime (hours beyond expected)
		if (attendance.overtime) {
			totalMinutes += this.parseDurationToMinutes(attendance.overtime);
		}
		
		return sum + totalMinutes / 60;
	}, 0);
		const hoursChange = Math.round((totalActualHours - comparisonTotalHours) * 100) / 100;

		// Calculate punctuality change using organization hours
		const comparisonLateCount = await this.calculateComparisonLateCountWithOrgHours(
			comparisonAttendance,
			organizationId,
		);
		const todayLateCount = lateEmployeesToday.length;
		const punctualityChange =
			comparisonAttendance.length > 0
				? Math.round(((comparisonLateCount - todayLateCount) / comparisonAttendance.length) * 100)
				: 0;

		// Determine performance trend using enhanced calculation
		const performanceTrend = this.calculateEnhancedPerformanceTrend(
			employeeMetrics,
			comparisonAttendance,
			attendanceChange,
			hoursChange,
			punctualityChange,
		);

		this.logger.log(
			`Performance trend: ${performanceTrend} (attendance: ${attendanceChange}%, hours: ${hoursChange}h, punctuality: ${punctualityChange}%)`,
		);

		// Generate enhanced insights with target analysis using organization hours and template metrics
		const insights = this.generateEnhancedEveningInsights(
			templateEmployeeMetrics, // Use templateEmployeeMetrics for more accurate insights
			completedShifts,
			avgHours,
			targetPerformance,
			employeeCategories,
		);

		// Generate tomorrow's action items
		const tomorrowActions = [];
		if (lateEmployeesToday.length > 0) {
			tomorrowActions.push(`Follow up with ${lateEmployeesToday.length} employees who arrived late today`);
		}
		if (absentEmployees.length > 0) {
			tomorrowActions.push(`Check in with ${absentEmployees.length} absent employees to ensure they're okay`);
		}
		if (avgHours < 6) {
			tomorrowActions.push('Review scheduling and workload distribution to improve productivity');
		}
		if (tomorrowActions.length === 0) {
			tomorrowActions.push('Continue maintaining excellent team performance and punctuality');
		}

		// Generate comprehensive top performers based on multiple metrics
		const topPerformers = await this.calculateComprehensiveTopPerformers(
			templateEmployeeMetrics,
			organizationId,
			startOfToday,
			endOfToday
		);

		// Get total employees expected to work today using organization hours
		const totalEmployeesExpected = await this.getExpectedEmployeesForToday(allUsers, organizationId, today);

		this.logger.log(`Generated ${insights.length} insights and ${tomorrowActions.length} tomorrow actions`);

		// Calculate total overtime for the day (formatted for email template)
		const totalOvertimeMinutesFormatted = await this.calculateTotalOvertimeWithOrgHours(
			todayAttendance,
			organizationId,
			today,
		);
		const totalOvertimeHours = totalOvertimeMinutesFormatted > 0 
			? TimeCalculatorUtil.formatDuration(totalOvertimeMinutesFormatted)
			: '0h 0m';
		
		this.logger.log(`Total overtime for evening report: ${totalOvertimeHours}`);

		const eveningReportData = {
			organizationName: organization?.name || 'Organization',
			reportDate: format(today, 'EEEE, MMMM do, yyyy'),
			organizationStartTime,
			organizationCloseTime,
			totalOvertimeHours,
			employeeMetrics: templateEmployeeMetrics, // Use the properly mapped metrics
			presentEmployees: employeeCategories.presentEmployees,
			absentEmployees: employeeCategories.absentEmployees,
			currentlyWorkingEmployees: employeeCategories.currentlyWorkingEmployees,
			completedShiftEmployees: employeeCategories.completedShiftEmployees,
			overtimeEmployees: employeeCategories.overtimeEmployees,
			branchBreakdown,
			targetPerformance,
			summary: {
				totalEmployees: totalEmployeesExpected,
				completedShifts,
				averageHours: Math.round(avgHours * 100) / 100,
				totalOvertimeMinutes: Math.round(totalOvertimeMinutes),
				totalActualHours: Math.round(totalActualHours * 100) / 100,
				totalExpectedHours: Math.round(expectedDailyHours * 100) / 100,
				productivityRate: Math.round(productivityRate * 100) / 100,
			},
			insights,
			hasEmployees: totalEmployeesExpected > 0,
			latenessSummary,
			// Add missing template fields
			totalEmployees: totalEmployeesExpected,
			workedTodayCount,
			totalHoursWorked: Math.round(totalActualHours * 100) / 100,
			averageHoursWorked: Math.round(avgHours * 100) / 100,
			attendanceChange,
			hoursChange,
			punctualityChange,
			performanceTrend,
			attendanceRate: Math.round((workedTodayCount / Math.max(totalEmployeesExpected, 1)) * 100),
			yesterdayAttendanceRate: Math.round((comparisonWorkedCount / Math.max(totalEmployeesExpected, 1)) * 100),
			punctualityRate:
				employeeMetrics.length > 0
					? Math.round(((employeeMetrics.length - lateEmployeesToday.length) / employeeMetrics.length) * 100)
					: 100,
			overallPerformance: {
				description:
					performanceTrend === 'improving'
						? 'Team performance is trending upward with good attendance and productivity'
						: performanceTrend === 'declining'
						? 'Performance needs attention - consider team check-ins and support'
						: 'Team performance is stable and consistent',
			},
			topPerformers: topPerformers.length > 0 ? topPerformers : null,
			improvementAreas:
				lateEmployeesToday.length > 0
					? [
							{
								area: 'Punctuality',
								description: `${lateEmployeesToday.length} employees arrived late today`,
								count: lateEmployeesToday.length,
							},
					  ]
					: null,
			tomorrowActions,
			generatedAt: formatInTimeZone(today, organizationTimezone, 'PPpp'),
			dashboardUrl: process.env.DASHBOARD_URL || 'https://dashboard.loro.com',
			socialLinks: organizationSettings?.socialLinks || null,
			// Enhanced analytics data (integrated from user-daily-report.generator.ts)
			enhancedAnalytics: {
				performance: performanceAnalytics,
				productivity: productivityInsights,
				wellness: wellnessMetrics,
			},
		};

		// Enhanced logging for final evening report data
		this.logger.log(`📧 Final Evening Report Data for org ${organizationId}:`);
		this.logger.log(`  - Organization ID: ${organizationId}`);
		this.logger.log(`  - Report Date: ${eveningReportData.reportDate}`);
		this.logger.log(`  - Employee Metrics Count: ${eveningReportData.employeeMetrics.length}`);
		this.logger.log(`  - Present Employees: ${eveningReportData.presentEmployees.length}`);
		this.logger.log(`  - Absent Employees: ${eveningReportData.absentEmployees.length}`);
		this.logger.log(`  - Currently Working: ${eveningReportData.currentlyWorkingEmployees.length}`);
		this.logger.log(`  - Completed Shifts: ${eveningReportData.completedShiftEmployees.length}`);
		this.logger.log(`  - Overtime Employees: ${eveningReportData.overtimeEmployees.length}`);
		this.logger.log(`  - Branch Breakdown Count: ${eveningReportData.branchBreakdown.length}`);
		this.logger.log(`  - Top Performers: ${eveningReportData.topPerformers?.length || 0}`);
		this.logger.log(`  - Insights Count: ${eveningReportData.insights.length}`);
		this.logger.log(`  - Has Employees: ${eveningReportData.hasEmployees}`);

		// CRITICAL: Log the actual employeeMetrics data being sent to email template
		this.logger.log(`🚨 CRITICAL - EMPLOYEE METRICS FOR EMAIL TEMPLATE:`);
		this.logger.log(`employeeMetrics array length: ${eveningReportData.employeeMetrics.length}`);
		
		if (eveningReportData.employeeMetrics.length > 0) {
			this.logger.log(`📊 First 3 Employee Metrics for Email Template:`);
			eveningReportData.employeeMetrics.slice(0, 3).forEach((emp, index) => {
				this.logger.log(`  Employee ${index + 1}:`);
				this.logger.log(`    - Name: ${emp.name} ${emp.surname}`);
				this.logger.log(`    - UID: ${emp.uid}`);
				this.logger.log(`    - Check In: ${emp.checkInTime}`);
				this.logger.log(`    - Check Out: ${emp.checkOutTime}`);
				this.logger.log(`    - Hours: ${emp.hoursWorked}`);
				this.logger.log(`    - Status: ${emp.status}`);
				this.logger.log(`    - Role: ${emp.role}`);
				this.logger.log(`    - Email: ${emp.email}`);
			});
		} else {
			this.logger.error(`🚨 ERROR: No employeeMetrics data for email template! This explains the empty Individual Performance Summary.`);
		}

		// Log the complete structure for debugging
		this.logger.log(`📋 Complete Employee Metrics Structure Sample:`);
		if (eveningReportData.employeeMetrics.length > 0) {
			this.logger.log(JSON.stringify(eveningReportData.employeeMetrics[0], null, 2));
		}

		this.logger.log(`Evening report data generated successfully for organization ${organizationId}`);
		return eveningReportData;
	}

	private async getReportRecipients(organizationId: string): Promise<string[]> {
		this.logger.log(`Getting report recipients for organization ${organizationId}`);

		try {
			// Get users with OWNER, ADMIN, or HR access levels for the organization
			const ownerResult = await this.userService.findAll({
				orgId: organizationId,
				accessLevel: AccessLevel.OWNER,
				status: AccountStatus.ACTIVE,
			});

			const adminResult = await this.userService.findAll({
				orgId: organizationId,
				accessLevel: AccessLevel.ADMIN,
				status: AccountStatus.ACTIVE,
			});

			const hrResult = await this.userService.findAll({
				orgId: organizationId,
				accessLevel: AccessLevel.HR,
				status: AccountStatus.ACTIVE,
			});

			// Combine all recipients
			const allRecipients = [...(ownerResult.data || []), ...(adminResult.data || []), ...(hrResult.data || [])];

			// Remove duplicates and filter for valid emails
			const uniqueRecipients = allRecipients.filter(
				(user, index, self) => user.email && self.findIndex((u) => u.uid === user.uid) === index,
			);

			const emails = uniqueRecipients.map((user) => user.email);
			this.logger.log(`Found ${emails.length} report recipients for organization ${organizationId}`);

			return emails;
		} catch (error) {
			this.logger.error(`Error getting report recipients for organization ${organizationId}:`, error);
			return [];
		}
	}

	/**
	 * Enhanced duration parser with multiple format support and validation
	 */
	private parseDurationToMinutes(duration: string): number {
		if (!duration || typeof duration !== 'string') {
			this.logger.warn(`Invalid duration format: ${duration}`);
			return 0;
		}

		const trimmed = duration.trim();
		if (trimmed === '0' || trimmed === '') return 0;

		try {
			// Handle format like "8h 30m", "8 hours 30 minutes", "8:30", etc.

			// Format: "HH:MM:SS" or "HH:MM"
			const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
			if (timeMatch) {
				const hours = parseInt(timeMatch[1], 10) || 0;
				const minutes = parseInt(timeMatch[2], 10) || 0;
				const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) || 0 : 0;
				return hours * 60 + minutes + Math.round(seconds / 60);
			}

			// Format: "8h 30m" or "8 hours 30 minutes" (flexible)
			const hourMinuteMatch = trimmed.match(
				/(\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?/i,
			);
			if (hourMinuteMatch) {
				const hours = parseFloat(hourMinuteMatch[1]) || 0;
				const minutes = parseFloat(hourMinuteMatch[2]) || 0;
				return Math.round(hours * 60 + minutes);
			}

			// Format: just hours "8h" or "8 hours"
			const hourOnlyMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?$/i);
			if (hourOnlyMatch) {
				const hours = parseFloat(hourOnlyMatch[1]) || 0;
				return Math.round(hours * 60);
			}

			// Format: just minutes "45m" or "45 minutes"
			const minuteOnlyMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?$/i);
			if (minuteOnlyMatch) {
				const minutes = parseFloat(minuteOnlyMatch[1]) || 0;
				return Math.round(minutes);
			}

			// Format: decimal hours "8.5"
			const decimalMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
			if (decimalMatch) {
				const hours = parseFloat(decimalMatch[1]) || 0;
				return Math.round(hours * 60);
			}

			// Fallback: try to extract any numbers and assume they're hours
			const numbers = trimmed.match(/\d+(?:\.\d+)?/g);
			if (numbers && numbers.length > 0) {
				const firstNumber = parseFloat(numbers[0]) || 0;
				// If it's a reasonable hour value (0-24), treat as hours
				if (firstNumber <= 24) {
					return Math.round(firstNumber * 60);
				}
				// Otherwise, treat as minutes
				return Math.round(firstNumber);
			}

			this.logger.warn(`Unable to parse duration string: "${duration}"`);
			return 0;
		} catch (error) {
			this.logger.error(`Error parsing duration "${duration}":`, error);
			return 0;
		}
	}

	/**
	 * Consolidate multiple attendance records per user into single representative records
	 * This handles cases where users have multiple check-ins (overtime scenarios)
	 */
	private async consolidateAttendanceByUser(
		organizationId: string,
		todayAttendance: Attendance[],
	): Promise<
		Map<
			number,
			{
				user: User;
				primaryAttendance: Attendance;
				allAttendances: Attendance[];
				totalHours: number;
				isOvertime: boolean;
				earliestCheckIn: Date;
				latestCheckOut: Date | null;
			}
		>
	> {
		const userAttendanceMap = new Map();

		// Group attendance records by user ID
		const groupedByUser = new Map<number, Attendance[]>();
		for (const attendance of todayAttendance) {
			if (!attendance.owner?.uid) continue;

			const userId = attendance.owner.uid;
			if (!groupedByUser.has(userId)) {
				groupedByUser.set(userId, []);
			}
			groupedByUser.get(userId)!.push(attendance);
		}

		// Process each user's attendance records
		for (const [userId, attendances] of groupedByUser) {
			if (attendances.length === 0) continue;

			// Sort by check-in time to get chronological order
			const sortedAttendances = attendances
				.filter((a) => a.checkIn)
				.sort((a, b) => new Date(a.checkIn!).getTime() - new Date(b.checkIn!).getTime());

			if (sortedAttendances.length === 0) continue;

			const firstAttendance = sortedAttendances[0];
			const lastAttendance = sortedAttendances[sortedAttendances.length - 1];
			const user = firstAttendance.owner!;

			// Calculate total hours across all sessions for today only
			let totalHours = 0;
			const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
			for (const attendance of sortedAttendances) {
				const hours = await this.calculateRealTimeHoursWithOrgHours(
					attendance,
					organizationId,
					new Date(),
					today, // Only count hours for today from multi-day shifts
				);
				totalHours += hours;
			}

			// Get working day info to determine if this is overtime
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
				organizationId,
				firstAttendance.checkIn!,
			);
			const standardHours = (workingDayInfo.expectedWorkMinutes || 480) / 60; // Default 8 hours
			const isOvertime = totalHours > standardHours;

			// Find latest check-out time
			const checkOuts = sortedAttendances
				.map((a) => a.checkOut)
				.filter(Boolean)
				.sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime());

			userAttendanceMap.set(userId, {
				user,
				primaryAttendance: firstAttendance, // Use first check-in for punctuality
				allAttendances: sortedAttendances,
				totalHours: Math.round(totalHours * 100) / 100,
				isOvertime,
				earliestCheckIn: new Date(firstAttendance.checkIn!),
				latestCheckOut: checkOuts.length > 0 ? new Date(checkOuts[0]!) : null,
			});
		}

		return userAttendanceMap;
	}

	private async generatePunctualityBreakdown(
		organizationId: string,
		todayAttendance: Attendance[],
	): Promise<PunctualityBreakdown> {
		const earlyArrivals: AttendanceReportUser[] = [];
		const onTimeArrivals: AttendanceReportUser[] = [];
		const lateArrivals: AttendanceReportUser[] = [];
		const veryLateArrivals: AttendanceReportUser[] = [];

		// Consolidate multiple attendance records per user
		const consolidatedAttendance = await this.consolidateAttendanceByUser(organizationId, todayAttendance);

		for (const [userId, userRecord] of consolidatedAttendance) {
			const { user, primaryAttendance, totalHours, isOvertime, earliestCheckIn } = userRecord;

			if (!primaryAttendance.checkIn || !isValid(primaryAttendance.checkIn)) {
				continue;
			}

			// Get late information and working day info based on FIRST check-in (for punctuality)
			const lateInfo = await this.organizationHoursService.isUserLate(organizationId, primaryAttendance.checkIn);
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
				organizationId,
				primaryAttendance.checkIn,
			);

			// Calculate early/late minutes based on FIRST check-in
			let lateMinutes = 0;
			let earlyMinutes = 0;
			let lateStatus: 'on-time' | 'late' | 'very-late' | 'extremely-late' = 'on-time';

			if (workingDayInfo.startTime) {
				const checkInMinutes = TimeCalculatorUtil.timeToMinutes(
					primaryAttendance.checkIn.toTimeString().substring(0, 5),
				);
				const expectedStartMinutes = TimeCalculatorUtil.timeToMinutes(workingDayInfo.startTime);

				if (lateInfo.isLate) {
					lateMinutes = lateInfo.lateMinutes;
					// Categorize lateness severity
					if (lateMinutes >= 60) {
						lateStatus = 'extremely-late';
					} else if (lateMinutes >= 30) {
						lateStatus = 'very-late';
					} else {
						lateStatus = 'late';
					}
				} else if (checkInMinutes < expectedStartMinutes) {
					earlyMinutes = expectedStartMinutes - checkInMinutes;
				}
			}

			// Create consolidated user profile
			const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
			const consolidatedUser: AttendanceReportUser = {
				uid: user.uid,
				name: user.name || 'Unknown',
				surname: user.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: user.email || 'no-email@company.com',
				phone: user.phone || undefined,
				role: user.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: user.photoURL || null,
				},
				branch: user.branch
					? {
							uid: user.branch.uid,
							name: user.branch.name || 'Unknown Branch',
					  }
					: undefined,
			lateMinutes: lateMinutes > 0 ? lateMinutes : undefined,
			earlyMinutes: earlyMinutes > 0 ? earlyMinutes : undefined,
			checkInTime: primaryAttendance.checkIn ? await this.formatTimeInOrganizationTimezone(primaryAttendance.checkIn, organizationId, 'HH:mm') : undefined,
			lateStatus,
		};

		// Add overtime indicator if applicable
		if (isOvertime) {
			consolidatedUser.checkInTime = `${consolidatedUser.checkInTime} (OT: ${totalHours}h)`;
		}

			if (!workingDayInfo.startTime) {
				onTimeArrivals.push(consolidatedUser);
				continue;
			}

			const checkInMinutes = TimeCalculatorUtil.timeToMinutes(
				primaryAttendance.checkIn.toTimeString().substring(0, 5),
			);
			const expectedStartMinutes = TimeCalculatorUtil.timeToMinutes(workingDayInfo.startTime);

			// Categorize based on FIRST check-in time (punctuality)
			if (lateInfo.isLate) {
				if (lateMinutes >= 30) {
					veryLateArrivals.push(consolidatedUser);
				} else {
					lateArrivals.push(consolidatedUser);
				}
			} else if (checkInMinutes < expectedStartMinutes) {
				earlyArrivals.push(consolidatedUser);
			} else {
				onTimeArrivals.push(consolidatedUser);
			}
		}

		// Calculate totals based on UNIQUE USERS, not attendance records
		const total = consolidatedAttendance.size;
		const allLateArrivals = [...lateArrivals, ...veryLateArrivals];
		const totalLateMinutes = allLateArrivals.reduce((sum, emp) => sum + (emp.lateMinutes || 0), 0);
		const averageLateMinutes =
			allLateArrivals.length > 0 ? Math.round((totalLateMinutes / allLateArrivals.length) * 100) / 100 : 0;

		// Calculate branch-wise breakdown
		const branchMap = new Map<number, BranchPunctuality>();
		const allEmployees = [...earlyArrivals, ...onTimeArrivals, ...lateArrivals, ...veryLateArrivals];

		// Initialize branch data
		allEmployees.forEach((employee) => {
			if (employee.branch) {
				const branchId = employee.branch.uid;
				if (!branchMap.has(branchId)) {
					branchMap.set(branchId, {
						branchId,
						branchName: employee.branch.name,
						earlyArrivals: [],
						onTimeArrivals: [],
						lateArrivals: [],
						veryLateArrivals: [],
						earlyPercentage: 0,
						onTimePercentage: 0,
						latePercentage: 0,
						veryLatePercentage: 0,
						averageLateMinutes: 0,
						totalLateMinutes: 0,
						totalEmployees: 0,
					});
				}
			}
		});

		// Group employees by branch and category
		earlyArrivals.forEach((emp) => emp.branch && branchMap.get(emp.branch.uid)?.earlyArrivals.push(emp));
		onTimeArrivals.forEach((emp) => emp.branch && branchMap.get(emp.branch.uid)?.onTimeArrivals.push(emp));
		lateArrivals.forEach((emp) => emp.branch && branchMap.get(emp.branch.uid)?.lateArrivals.push(emp));
		veryLateArrivals.forEach((emp) => emp.branch && branchMap.get(emp.branch.uid)?.veryLateArrivals.push(emp));

		// Calculate percentages and metrics for each branch
		const byBranch: BranchPunctuality[] = Array.from(branchMap.values()).map((branch) => {
			const branchTotal =
				branch.earlyArrivals.length +
				branch.onTimeArrivals.length +
				branch.lateArrivals.length +
				branch.veryLateArrivals.length;

			const branchLateEmployees = [...branch.lateArrivals, ...branch.veryLateArrivals];
			const branchTotalLateMinutes = branchLateEmployees.reduce((sum, emp) => sum + (emp.lateMinutes || 0), 0);
			const branchAverageLateMinutes =
				branchLateEmployees.length > 0
					? Math.round((branchTotalLateMinutes / branchLateEmployees.length) * 100) / 100
					: 0;

			return {
				...branch,
				totalEmployees: branchTotal,
				earlyPercentage: branchTotal > 0 ? Math.round((branch.earlyArrivals.length / branchTotal) * 100) : 0,
				onTimePercentage: branchTotal > 0 ? Math.round((branch.onTimeArrivals.length / branchTotal) * 100) : 0,
				latePercentage: branchTotal > 0 ? Math.round((branch.lateArrivals.length / branchTotal) * 100) : 0,
				veryLatePercentage:
					branchTotal > 0 ? Math.round((branch.veryLateArrivals.length / branchTotal) * 100) : 0,
				averageLateMinutes: branchAverageLateMinutes,
				totalLateMinutes: branchTotalLateMinutes,
			};
		});

		return {
			earlyArrivals,
			onTimeArrivals,
			lateArrivals,
			veryLateArrivals,
			earlyPercentage: total > 0 ? Math.round((earlyArrivals.length / total) * 100) : 0,
			onTimePercentage: total > 0 ? Math.round((onTimeArrivals.length / total) * 100) : 0,
			latePercentage: total > 0 ? Math.round((lateArrivals.length / total) * 100) : 0,
			veryLatePercentage: total > 0 ? Math.round((veryLateArrivals.length / total) * 100) : 0,
			averageLateMinutes,
			totalLateMinutes,
			byBranch: byBranch.sort((a, b) => a.branchName.localeCompare(b.branchName)),
		};
	}

	// Removed: This method has been replaced by generateEmployeeMetricsWithOrgHours

	private generateMorningInsights(
		attendanceRate: number,
		punctuality: PunctualityBreakdown,
		presentCount: number,
		totalEmployees: number,
	): string[] {
		const insights: string[] = [];

		// Special handling for no employees scenario
		if (totalEmployees === 0) {
			insights.push('No employees are registered in the system for this organization.');
			insights.push('System setup is required to begin tracking attendance and performance metrics.');
			return insights;
		}

		// Special handling for no present employees
		if (presentCount === 0) {
			insights.push(
				'CRITICAL: No employees have checked in yet today. This requires immediate attention and follow-up.',
			);
			insights.push(
				'Potential causes: system issues, holiday schedules, communication gaps, or emergency situations.',
			);
			insights.push(
				'Immediate action required: Contact all team members to ensure safety and clarify work arrangements.',
			);
			insights.push(
				'Consider checking attendance system functionality and recent organizational communications.',
			);
			return insights;
		}

		// Enhanced attendance rate insights with proper context
		const attendanceContext = totalEmployees > 1 ? 'team' : 'employee';
		if (attendanceRate >= 95) {
			insights.push(
				`Exceptional attendance: ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - outstanding commitment!`,
			);
		} else if (attendanceRate >= 85) {
			insights.push(
				`Strong attendance: ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - excellent performance with minor room for improvement.`,
			);
		} else if (attendanceRate >= 70) {
			insights.push(
				`Good attendance: ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - solid foundation with opportunities to enhance team engagement.`,
			);
		} else if (attendanceRate >= 50) {
			insights.push(
				`Moderate attendance: ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - significant opportunity for improvement through targeted support.`,
			);
		} else if (attendanceRate > 0) {
			insights.push(
				`Low attendance: Only ${presentCount}/${totalEmployees} ${attendanceContext} present (${attendanceRate}%) - requires immediate intervention and comprehensive strategy.`,
			);
		}

		// Enhanced punctuality insights with meaningful context
		const totalLateEmployees = punctuality.lateArrivals.length + punctuality.veryLateArrivals.length;
		const totalOnTimeEmployees = punctuality.earlyArrivals.length + punctuality.onTimeArrivals.length;

		if (totalLateEmployees === 0 && presentCount > 0) {
			insights.push(
				`Perfect punctuality: All ${presentCount} present employees arrived on time or early - exceptional team discipline!`,
			);
		} else if (punctuality.veryLateArrivals.length > 0) {
			const criticalCount = punctuality.veryLateArrivals.length;
			const regularLateCount = punctuality.lateArrivals.length;
			if (regularLateCount > 0) {
				insights.push(
					`URGENT: ${criticalCount} employees arrived very late (30+ minutes) and ${regularLateCount} others were late. Total late: ${totalLateEmployees}/${presentCount} present employees.`,
				);
			} else {
				insights.push(
					`URGENT: ${criticalCount} employees arrived very late (30+ minutes). This represents ${Math.round(
						(criticalCount / presentCount) * 100,
					)}% of present employees requiring immediate attention.`,
				);
			}
		} else if (punctuality.lateArrivals.length > 0) {
			const lateRatio = `${punctuality.lateArrivals.length}/${presentCount}`;
			insights.push(
				`${punctuality.lateArrivals.length} employees arrived late today (${lateRatio} present employees) with an average delay of ${punctuality.averageLateMinutes} minutes.`,
			);
		}

		// Early arrival recognition with context
		if (punctuality.earlyArrivals.length > 0) {
			const earlyRatio = `${punctuality.earlyArrivals.length}/${presentCount}`;
			insights.push(
				`Outstanding dedication: ${punctuality.earlyArrivals.length} employees arrived early (${earlyRatio} present employees) - demonstrating exceptional commitment.`,
			);
		}

		// Specific insights for severe lateness with proper context
		if (punctuality.veryLatePercentage > 20 && presentCount >= 3) {
			insights.push(
				`CRITICAL ALERT: ${punctuality.veryLatePercentage}% of present employees were extremely late - indicates systemic issues requiring immediate management intervention.`,
			);
		} else if (punctuality.veryLatePercentage > 10 && presentCount >= 5) {
			insights.push(
				`ATTENTION: ${punctuality.veryLatePercentage}% of present employees were extremely late - monitor for emerging patterns.`,
			);
		}

		// Contextual performance insights based on team size
		if (totalOnTimeEmployees > 0) {
			const onTimePercentage = Math.round((totalOnTimeEmployees / presentCount) * 100);
			if (presentCount >= 10) {
				if (onTimePercentage >= 90) {
					insights.push(
						`Excellent punctuality: ${onTimePercentage}% (${totalOnTimeEmployees}/${presentCount}) of present employees arrived on time or early - strong team culture.`,
					);
				} else if (onTimePercentage >= 75) {
					insights.push(
						`Good punctuality: ${onTimePercentage}% (${totalOnTimeEmployees}/${presentCount}) of present employees arrived on time or early - opportunity for improvement.`,
					);
				} else if (onTimePercentage >= 50) {
					insights.push(
						`Moderate punctuality: ${onTimePercentage}% (${totalOnTimeEmployees}/${presentCount}) of present employees arrived on time or early - requires attention.`,
					);
				} else {
					insights.push(
						`Low punctuality: Only ${onTimePercentage}% (${totalOnTimeEmployees}/${presentCount}) of present employees arrived on time or early - critical issue.`,
					);
				}
			} else if (presentCount >= 3) {
				// Small team context
				if (onTimePercentage >= 80) {
					insights.push(
						`Small team punctuality: ${totalOnTimeEmployees} out of ${presentCount} present employees arrived on time or early (${onTimePercentage}%) - good performance.`,
					);
				} else {
					insights.push(
						`Small team punctuality: ${totalOnTimeEmployees} out of ${presentCount} present employees arrived on time or early (${onTimePercentage}%) - room for improvement.`,
					);
				}
			} else {
				// Very small team or individual
				insights.push(
					`${totalOnTimeEmployees} out of ${presentCount} present ${
						presentCount === 1 ? 'employee' : 'employees'
					} arrived on time or early.`,
				);
			}
		}

		return insights;
	}

	private generateMorningRecommendations(punctuality: PunctualityBreakdown, attendanceRate: number): string[] {
		const recommendations: string[] = [];

		// Special handling for zero attendance - immediate crisis response
		if (attendanceRate === 0) {
			recommendations.push(
				'IMMEDIATE ACTION: Contact all team members within 30 minutes to verify safety and work status.',
			);
			recommendations.push(
				'Check attendance system functionality and verify no technical issues are preventing check-ins.',
			);
			recommendations.push(
				"Review today's schedule, holiday calendar, and recent organizational communications.",
			);
			recommendations.push('Prepare contingency plans for business operations if attendance issues persist.');
			recommendations.push(
				'Document incident for analysis and implement preventive measures for future occurrences.',
			);
			return recommendations;
		}

		// Critical lateness recommendations
		if (punctuality.veryLateArrivals.length > 0) {
			recommendations.push(
				`URGENT: Schedule immediate meetings with ${punctuality.veryLateArrivals.length} employees who were very late to identify critical barriers.`,
			);
			recommendations.push(
				'Implement emergency support measures for employees facing significant attendance challenges.',
			);
		}

		// Standard lateness recommendations
		if (punctuality.lateArrivals.length > 0) {
			recommendations.push(
				'Schedule one-on-one conversations with late employees to understand barriers and provide targeted support.',
			);
			recommendations.push(
				'Review if start times and expectations are clearly communicated and realistic for all team members.',
			);
			recommendations.push(
				'Consider flexible start time options for employees facing consistent transportation or personal challenges.',
			);
		}

		// Attendance improvement recommendations
		if (attendanceRate < 80) {
			recommendations.push(
				'Implement proactive wellness check system to identify and address attendance barriers early.',
			);
			recommendations.push(
				'Review organizational policies and support systems to ensure they meet current team needs.',
			);
		}

		if (attendanceRate < 60) {
			recommendations.push(
				'Conduct urgent team meeting to address systemic attendance challenges and gather feedback.',
			);
			recommendations.push('Consider implementing attendance incentive programs or enhanced support services.');
		}

		// Severe punctuality recommendations
		if (punctuality.latePercentage > 25) {
			recommendations.push(
				'Evaluate and adjust start time expectations based on realistic commute and preparation needs.',
			);
			recommendations.push('Implement attendance coaching program for employees struggling with punctuality.');
		}

		// Recognition and positive reinforcement
		if (punctuality.earlyArrivals.length > 0) {
			recommendations.push(
				`Recognize and appreciate the ${punctuality.earlyArrivals.length} employees who demonstrated exceptional commitment by arriving early.`,
			);
		}

		if (punctuality.onTimeArrivals.length > 0) {
			recommendations.push(
				`Acknowledge the ${punctuality.onTimeArrivals.length} punctual team members for their consistent reliability and professionalism.`,
			);
		}

		// Excellence maintenance recommendations
		if (punctuality.onTimePercentage > 80 && attendanceRate > 85) {
			recommendations.push(
				"Continue current successful practices and consider documenting what's working well for future reference.",
			);
			recommendations.push("Use today's positive performance as a benchmark for maintaining excellence.");
		}

		// Default positive reinforcement
		if (recommendations.length === 0) {
			recommendations.push(
				'Maintain current excellent attendance practices and continue supporting team success.',
			);
			recommendations.push("Consider sharing today's positive results with the team to reinforce good habits.");
		}

		return recommendations;
	}

	private generateEveningInsights(
		employeeMetrics: EmployeeAttendanceMetric[],
		completedShifts: number,
		avgHours: number,
	): string[] {
		const insights: string[] = [];

		// Special handling for no employees
		if (employeeMetrics.length === 0) {
			insights.push('No employee data available for this organization.');
			insights.push('System setup may be required to begin tracking employee performance metrics.');
			return insights;
		}

		const totalEmployees = employeeMetrics.length;
		const employeesWithCheckIn = employeeMetrics.filter((m) => m.todayCheckIn).length;
		const lateEmployees = employeeMetrics.filter((m) => m.isLate).length;
		const highPerformers = employeeMetrics.filter((m) => m.hoursWorked > Math.max(avgHours + 1, 6)).length;
		const noCheckOut = employeeMetrics.filter((m) => m.todayCheckIn && !m.todayCheckOut).length;
		const noWorkToday = employeeMetrics.filter((m) => !m.todayCheckIn && m.hoursWorked === 0).length;

		// Special handling for complete absence
		if (employeesWithCheckIn === 0) {
			insights.push(`CRITICAL: No employees checked in today out of ${totalEmployees} registered employees.`);
			insights.push(
				'This requires immediate investigation - potential system issues, holiday schedules, or emergency situations.',
			);
			insights.push('Immediate action: Verify employee safety and check attendance system functionality.');
			return insights;
		}

		// Enhanced completion insights with context
		if (completedShifts === 0 && employeesWithCheckIn > 0) {
			insights.push(
				`${employeesWithCheckIn}/${totalEmployees} employees checked in today, but none have completed their shifts yet.`,
			);
			insights.push("All checked-in employees are still working or haven't checked out properly.");
		} else if (completedShifts > 0) {
			const completionRate = Math.round((completedShifts / employeesWithCheckIn) * 100);
			if (completionRate === 100) {
				insights.push(
					`Excellent completion: All ${completedShifts} employees who checked in today completed their shifts.`,
				);
			} else {
				insights.push(
					`${completedShifts}/${employeesWithCheckIn} employees completed their shifts (${completionRate}% completion rate).`,
				);
			}
		}

		// Enhanced hours analysis with meaningful context
		if (avgHours > 0) {
			if (completedShifts >= 3) {
				if (avgHours >= 8) {
					insights.push(
						`Strong productivity: Average working time of ${
							Math.round(avgHours * 100) / 100
						} hours indicates full engagement across ${completedShifts} completed shifts.`,
					);
				} else if (avgHours >= 6) {
					insights.push(
						`Moderate productivity: Average working time of ${
							Math.round(avgHours * 100) / 100
						} hours shows good effort across ${completedShifts} completed shifts.`,
					);
				} else if (avgHours >= 4) {
					insights.push(
						`Limited productivity: Average working time of ${
							Math.round(avgHours * 100) / 100
						} hours indicates potential challenges across ${completedShifts} completed shifts.`,
					);
				} else {
					insights.push(
						`Low productivity: Average working time of only ${
							Math.round(avgHours * 100) / 100
						} hours requires investigation across ${completedShifts} completed shifts.`,
					);
				}
			} else if (completedShifts > 0) {
				insights.push(
					`Limited data: ${completedShifts} completed shift${
						completedShifts === 1 ? '' : 's'
					} with average working time of ${Math.round(avgHours * 100) / 100} hours.`,
				);
			}
		} else if (completedShifts === 0 && employeesWithCheckIn > 0) {
			insights.push(
				"No completed shifts yet - all employees are either still working or haven't properly checked out.",
			);
		}

		// Enhanced lateness analysis with proper context
		if (lateEmployees > 0) {
			const lateRate = Math.round((lateEmployees / employeesWithCheckIn) * 100);
			const totalLateMinutes = employeeMetrics.filter((m) => m.isLate).reduce((sum, m) => sum + m.lateMinutes, 0);
			const avgLateMinutes = Math.round(totalLateMinutes / lateEmployees);

			if (lateRate >= 50) {
				insights.push(
					`ATTENTION: ${lateEmployees}/${employeesWithCheckIn} employees arrived late (${lateRate}%) with average delay of ${avgLateMinutes} minutes - significant punctuality issue.`,
				);
			} else if (lateRate >= 25) {
				insights.push(
					`Moderate concern: ${lateEmployees}/${employeesWithCheckIn} employees arrived late (${lateRate}%) with average delay of ${avgLateMinutes} minutes.`,
				);
			} else {
				insights.push(
					`Minor lateness: ${lateEmployees}/${employeesWithCheckIn} employees arrived late (${lateRate}%) with average delay of ${avgLateMinutes} minutes.`,
				);
			}
		} else if (employeesWithCheckIn > 0) {
			insights.push(
				`Excellent punctuality: All ${employeesWithCheckIn} employees who checked in arrived on time or early.`,
			);
		}

		// High performer recognition with context
		if (highPerformers > 0) {
			const highPerformerRate = Math.round(
				(highPerformers / Math.max(completedShifts, employeesWithCheckIn)) * 100,
			);
			if (highPerformerRate >= 50) {
				insights.push(
					`Outstanding dedication: ${highPerformers} employees worked significantly above average hours (${highPerformerRate}% of active employees).`,
				);
			} else {
				insights.push(
					`Strong performers: ${highPerformers} employees worked above average hours, showing exceptional commitment.`,
				);
			}
		}

		// Still working insights with context
		if (noCheckOut > 0) {
			const stillWorkingRate = Math.round((noCheckOut / employeesWithCheckIn) * 100);
			if (stillWorkingRate >= 75) {
				insights.push(
					`High engagement: ${noCheckOut}/${employeesWithCheckIn} employees are still actively working (${stillWorkingRate}%).`,
				);
			} else if (stillWorkingRate >= 25) {
				insights.push(
					`Continued activity: ${noCheckOut}/${employeesWithCheckIn} employees haven't checked out yet (${stillWorkingRate}%).`,
				);
			} else {
				insights.push(
					`${noCheckOut} employees haven't checked out yet - may be working late or forgot to check out.`,
				);
			}
		}

		// Absent employee insights
		if (noWorkToday > 0) {
			const absenceRate = Math.round((noWorkToday / totalEmployees) * 100);
			if (absenceRate >= 50) {
				insights.push(
					`High absence: ${noWorkToday}/${totalEmployees} employees had no activity today (${absenceRate}%) - requires investigation.`,
				);
			} else if (absenceRate >= 25) {
				insights.push(
					`Notable absence: ${noWorkToday}/${totalEmployees} employees had no activity today (${absenceRate}%).`,
				);
			} else if (noWorkToday === 1) {
				insights.push(`One employee had no activity today - may need follow-up.`);
			} else {
				insights.push(`${noWorkToday} employees had no activity today.`);
			}
		}

		// Zero hours worked insights (preventing "0 improvement" messages)
		const zeroHoursWorked = employeeMetrics.filter((m) => m.hoursWorked === 0).length;
		if (zeroHoursWorked > 0 && zeroHoursWorked < totalEmployees) {
			insights.push(
				`${zeroHoursWorked} employees recorded no working hours today - may need attention or system check.`,
			);
		}

		return insights;
	}

	/**
	 * Find the last working day for comparison, accounting for weekends and organization schedule
	 */
	private async findLastWorkingDay(
		organizationId: string,
		currentDate: Date,
	): Promise<{
		comparisonDate: Date;
		comparisonLabel: string;
	}> {
		let comparisonDate = subDays(currentDate, 1);
		let daysBack = 1;
		const maxDaysBack = 7; // Limit search to avoid infinite loops

		// First, try to find the last working day based on organization schedule
		while (daysBack <= maxDaysBack) {
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
				organizationId,
				comparisonDate,
			);

			if (workingDayInfo.isWorkingDay) {
				const label =
					daysBack === 1 ? 'yesterday' : daysBack === 2 ? 'day before yesterday' : `${daysBack} days ago`;
				return { comparisonDate, comparisonLabel: label };
			}

			daysBack++;
			comparisonDate = subDays(currentDate, daysBack);
		}

		// Fallback to business days if organization schedule isn't available
		try {
			comparisonDate = subBusinessDays(currentDate, 1);
			return { comparisonDate, comparisonLabel: 'last business day' };
		} catch (error) {
			// Ultimate fallback to yesterday
			return {
				comparisonDate: subDays(currentDate, 1),
				comparisonLabel: 'yesterday (may not be a working day)',
			};
		}
	}

	/**
	 * Get user targets for organization employees
	 * This enables target vs actual hours comparison
	 */
	private async getUserTargetsForOrganization(organizationId: string): Promise<{
		totalExpectedDailyHours: number;
		userTargetsMap: Map<number, number>;
		usersWithTargets: number;
	}> {
		try {
			let totalExpectedHours = 0;
			const userTargetsMap = new Map<number, number>();
			let usersWithTargets = 0;

			// Get all users in organization
			const usersResponse = await this.userService.findAll({ orgId: organizationId }, 1, 1000);
			const allUsers = usersResponse.data || [];

			// Get targets for each user
			for (const user of allUsers) {
				try {
					const targetResponse = await this.userService.getUserTarget(user.clerkUserId ?? String(user.uid));
					if (targetResponse?.userTarget?.targetHoursWorked) {
						const dailyTargetHours = targetResponse.userTarget.targetHoursWorked;
						userTargetsMap.set(user.uid, dailyTargetHours);
						totalExpectedHours += dailyTargetHours;
						usersWithTargets++;
					} else {
						// Default to 8 hours if no target set
						const defaultHours = 8;
						userTargetsMap.set(user.uid, defaultHours);
						totalExpectedHours += defaultHours;
					}
				} catch (error) {
					// Default to 8 hours if error getting target
					const defaultHours = 8;
					userTargetsMap.set(user.uid, defaultHours);
					totalExpectedHours += defaultHours;
					this.logger.warn(`Error getting target for user ${user.uid}:`, error);
				}
			}

			return {
				totalExpectedDailyHours: totalExpectedHours,
				userTargetsMap,
				usersWithTargets,
			};
		} catch (error) {
			this.logger.error(`Error getting user targets for organization ${organizationId}:`, error);
			return {
				totalExpectedDailyHours: 0,
				userTargetsMap: new Map(),
				usersWithTargets: 0,
			};
		}
	}

	// Removed: This method has been replaced by categorizeEmployeesByStatusWithOrgHours

	// Removed: This method has been replaced by calculateWorkDayProgressWithOrgHours

	// Removed: This method has been replaced by generateBranchBreakdownWithOrgHours

	/**
	 * Enhanced morning insights including target performance analysis
	 */
	private generateEnhancedMorningInsights(
		attendanceRate: number,
		punctuality: PunctualityBreakdown,
		presentCount: number,
		totalEmployees: number,
		targetPerformance: any,
		employeeCategories: any,
	): string[] {
		const insights: string[] = [];

		// Call existing insights first
		const baseInsights = this.generateMorningInsights(attendanceRate, punctuality, presentCount, totalEmployees);
		insights.push(...baseInsights);

		// Add target-based insights
		if (targetPerformance.expectedDailyHours > 0) {
			insights.push(
				`Target Analysis: ${targetPerformance.actualHoursToDate}h worked of ${targetPerformance.expectedDailyHours}h expected daily target (${targetPerformance.targetAchievementRate}% achieved)`,
			);

			if (targetPerformance.onTrackToMeetTargets) {
				insights.push(
					`✅ Performance Outlook: Team is projected to achieve ${targetPerformance.projectedEndOfDayHours}h by day end - ON TRACK to meet targets!`,
				);
			} else {
				insights.push(
					`⚠️ Performance Alert: Projected ${targetPerformance.projectedEndOfDayHours}h by day end - ${targetPerformance.hoursGapAnalysis}`,
				);
			}
		}

		// Add status-based insights
		if (employeeCategories.currentlyWorkingEmployees.length > 0) {
			insights.push(
				`Currently Active: ${employeeCategories.currentlyWorkingEmployees.length} employees are actively working and accumulating hours`,
			);
		}

		if (employeeCategories.completedShiftEmployees.length > 0) {
			insights.push(
				`Completed Shifts: ${employeeCategories.completedShiftEmployees.length} employees have already completed their work for today`,
			);
		}

		return insights;
	}

	/**
	 * Enhanced morning recommendations including target-based actions
	 */
	private generateEnhancedMorningRecommendations(
		punctuality: PunctualityBreakdown,
		attendanceRate: number,
		targetPerformance: any,
		employeeCategories: any,
	): string[] {
		const recommendations: string[] = [];

		// Call existing recommendations first
		const baseRecommendations = this.generateMorningRecommendations(punctuality, attendanceRate);
		recommendations.push(...baseRecommendations);

		// Add target-based recommendations
		if (!targetPerformance.onTrackToMeetTargets && targetPerformance.expectedDailyHours > 0) {
			recommendations.push(
				`🎯 Target Recovery: Team needs ${targetPerformance.hoursGapAnalysis} - consider productivity support or schedule adjustments`,
			);

			if (employeeCategories.absentEmployees.length > 0) {
				recommendations.push(
					`📞 Urgent Contact: Follow up with ${employeeCategories.absentEmployees.length} absent employees to recover lost productivity hours`,
				);
			}
		}

		if (targetPerformance.onTrackToMeetTargets && targetPerformance.targetAchievementRate > 100) {
			recommendations.push(
				`🏆 Excellence Opportunity: Team is exceeding targets - consider recognizing high performers and documenting best practices`,
			);
		}

		// Status-specific recommendations
		if (employeeCategories.currentlyWorkingEmployees.length > 0) {
			recommendations.push(
				`⏰ Monitor Progress: Check in with ${employeeCategories.currentlyWorkingEmployees.length} active employees around midday to ensure they stay on track`,
			);
		}

		return recommendations;
	}

	/**
	 * Enhanced evening insights including target performance analysis
	 */
	private generateEnhancedEveningInsights(
		employeeMetrics: any[], // Accept both EmployeeAttendanceMetric[] and template metrics
		completedShifts: number,
		avgHours: number,
		targetPerformance: any,
		employeeCategories: any,
	): string[] {
		const insights: string[] = [];

		// Normalize metrics to ensure compatibility with existing insight generation
		const normalizedMetrics = employeeMetrics.map(metric => {
			// Handle both template metrics and EmployeeAttendanceMetric formats
			if (metric.hoursWorked !== undefined) {
				// Template metrics format
				return {
					user: {
						uid: metric.uid,
						name: metric.name,
						surname: metric.surname,
						fullName: `${metric.name} ${metric.surname}`.trim(),
					},
					todayCheckIn: metric.checkInTime,
					todayCheckOut: metric.checkOutTime,
					hoursWorked: metric.hoursWorked,
					isLate: metric.isLate,
					lateMinutes: metric.lateMinutes,
					yesterdayHours: metric.yesterdayComparison?.hoursChange || 0,
				};
			} else {
				// EmployeeAttendanceMetric format - return as is
				return metric;
			}
		});

		// Call existing insights first with normalized metrics
		const baseInsights = this.generateEveningInsights(normalizedMetrics, completedShifts, avgHours);
		insights.push(...baseInsights);

		// Add comprehensive target analysis
		if (targetPerformance.expectedDailyHours > 0) {
			insights.push(
				`🎯 Target Performance: ${targetPerformance.actualTotalHours}h worked of ${targetPerformance.expectedDailyHours}h target (${targetPerformance.targetAchievementRate}% achieved) - ${targetPerformance.teamEfficiencyRating} efficiency`,
			);

			if (targetPerformance.individualTargetsMet > 0) {
				insights.push(
					`✅ Individual Success: ${targetPerformance.individualTargetsMet} employees met their personal targets`,
				);
			}

			if (targetPerformance.individualTargetsMissed > 0) {
				insights.push(
					`📊 Growth Opportunity: ${targetPerformance.individualTargetsMissed} employees need support to reach their targets`,
				);
			}

			if (targetPerformance.hoursOverTarget > 0) {
				insights.push(
					`🚀 Exceeded Expectations: Team worked ${targetPerformance.hoursOverTarget}h above target - outstanding commitment!`,
				);
			} else if (targetPerformance.hoursUnderTarget > 0) {
				insights.push(
					`⚡ Recovery Needed: Team is ${targetPerformance.hoursUnderTarget}h behind target - focus on productivity improvements`,
				);
			}
		}

		// Add enhanced status insights
		if (employeeCategories.currentlyWorkingEmployees.length > 0) {
			insights.push(
				`⏰ Still Active: ${employeeCategories.currentlyWorkingEmployees.length} employees are still working and contributing to daily targets`,
			);
		}

		if (employeeCategories.overtimeEmployees.length > 0) {
			insights.push(
				`💪 Overtime Champions: ${employeeCategories.overtimeEmployees.length} employees worked overtime, showing exceptional dedication`,
			);
		}

		return insights;
	}

	/**
	 * Calculate intelligent punctuality change comparing today vs yesterday
	 */
	private calculatePunctualityChange(
		todayMetric: EmployeeAttendanceMetric,
		comparisonAttendance: Attendance[],
	): string {
		const userId = todayMetric.user.uid;
		const comparisonRecord = comparisonAttendance.find((a) => a.owner?.uid === userId);

		// No comparison data available
		if (!comparisonRecord || !comparisonRecord.checkIn) {
			if (todayMetric.todayCheckIn) {
				return 'new'; // First time checking in or no yesterday data
			} else {
				return 'absent'; // Absent both days or just today
			}
		}

		// Today is absent but had attendance yesterday
		if (!todayMetric.todayCheckIn) {
			return 'absent_today'; // Present yesterday, absent today
		}

		// Both days have attendance - check punctuality
		const todayIsLate = todayMetric.isLate;

		// Simple late check for yesterday (could be enhanced with organization hours)
		const yesterdayCheckIn = new Date(comparisonRecord.checkIn);
		const yesterdayIsLate = yesterdayCheckIn.getHours() >= 9; // Simplified - should use org hours

		if (!todayIsLate && !yesterdayIsLate) {
			return 'consistently_punctual'; // On time both days
		} else if (!todayIsLate && yesterdayIsLate) {
			return 'improved'; // Was late yesterday, on time today
		} else if (todayIsLate && !yesterdayIsLate) {
			return 'worsened'; // Was on time yesterday, late today
		} else {
			// Both days late - compare lateness severity
			const todayLateMinutes = todayMetric.lateMinutes;
			const yesterdayLateMinutes = Math.max(
				0,
				(yesterdayCheckIn.getHours() - 8) * 60 + yesterdayCheckIn.getMinutes(),
			);

			if (todayLateMinutes < yesterdayLateMinutes - 10) {
				return 'less_late'; // Less late than yesterday
			} else if (todayLateMinutes > yesterdayLateMinutes + 10) {
				return 'more_late'; // More late than yesterday
			} else {
				return 'consistently_late'; // Similar lateness
			}
		}
	}

	/**
	 * Enhanced performance trend calculation
	 */
	private calculateEnhancedPerformanceTrend(
		todayMetrics: EmployeeAttendanceMetric[],
		comparisonAttendance: Attendance[],
		attendanceChange: number,
		hoursChange: number,
		punctualityChange: number,
	): string {
		const todayActiveCount = todayMetrics.filter((m) => m.todayCheckIn).length;
		const yesterdayActiveCount = comparisonAttendance.length;

		// Calculate punctuality improvement score
		const punctualityImprovements = todayMetrics.filter((metric) => {
			const change = this.calculatePunctualityChange(metric, comparisonAttendance);
			return change === 'improved' || change === 'less_late';
		}).length;

		const punctualityDeclines = todayMetrics.filter((metric) => {
			const change = this.calculatePunctualityChange(metric, comparisonAttendance);
			return change === 'worsened' || change === 'more_late';
		}).length;

		// Enhanced trend calculation
		let trendScore = 0;

		// Attendance trend (40% weight)
		if (attendanceChange > 10) trendScore += 4;
		else if (attendanceChange > 5) trendScore += 2;
		else if (attendanceChange < -10) trendScore -= 4;
		else if (attendanceChange < -5) trendScore -= 2;

		// Hours trend (40% weight)
		if (hoursChange > 2) trendScore += 4;
		else if (hoursChange > 0.5) trendScore += 2;
		else if (hoursChange < -2) trendScore -= 4;
		else if (hoursChange < -0.5) trendScore -= 2;

		// Punctuality trend (20% weight)
		const netPunctualityChange = punctualityImprovements - punctualityDeclines;
		if (netPunctualityChange > 2) trendScore += 2;
		else if (netPunctualityChange > 0) trendScore += 1;
		else if (netPunctualityChange < -2) trendScore -= 2;
		else if (netPunctualityChange < 0) trendScore -= 1;

		// Determine trend based on score
		if (trendScore >= 6) {
			return 'significantly_improving';
		} else if (trendScore >= 3) {
			return 'improving';
		} else if (trendScore <= -6) {
			return 'significantly_declining';
		} else if (trendScore <= -3) {
			return 'declining';
		} else {
			// Additional stability checks
			if (
				Math.abs(attendanceChange) <= 2 &&
				Math.abs(hoursChange) <= 0.5 &&
				Math.abs(netPunctualityChange) <= 1
			) {
				return 'stable';
			} else {
				return 'mixed'; // Some improvements, some declines
			}
		}
	}

	/**
	 * Calculate real-time hours worked using organization hours for overtime calculation with multi-day shift support
	 */
	private async calculateTotalActualHoursWithOrgHours(
		todayAttendance: Attendance[],
		organizationId: string,
		currentTime: Date = new Date(),
	): Promise<number> {
		this.logger.debug(`Calculating total actual hours for ${todayAttendance.length} attendance records`);

		let totalHours = 0;
		const today = currentTime.toISOString().split('T')[0]; // YYYY-MM-DD format

		for (const attendance of todayAttendance) {
			if (!attendance.checkIn) continue;

			// Use the new multi-day shift calculation to get hours for today only
			const hours = await this.calculateRealTimeHoursWithOrgHours(
				attendance,
				organizationId,
				currentTime,
				today, // Only count hours for today from multi-day shifts
			);
			totalHours += hours;
		}

		this.logger.debug(`Total actual hours calculated: ${totalHours}`);
		return totalHours;
	}

	/**
	 * Calculate work day progress using organization hours
	 */
	private async calculateWorkDayProgressWithOrgHours(
		currentTime: Date,
		organizationId: string,
		date: Date,
	): Promise<number> {
		try {
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, date);

			if (!workingDayInfo.isWorkingDay || !workingDayInfo.startTime || !workingDayInfo.endTime) {
				return 0.5; // Default to 50% if no working hours defined
			}

			const currentMinutes = TimeCalculatorUtil.timeToMinutes(currentTime.toTimeString().substring(0, 5));
			const startMinutes = TimeCalculatorUtil.timeToMinutes(workingDayInfo.startTime);
			const endMinutes = TimeCalculatorUtil.timeToMinutes(workingDayInfo.endTime);

			// Calculate progress within the working day
			const workDayDuration = endMinutes - startMinutes;
			const minutesIntoWorkDay = Math.max(0, currentMinutes - startMinutes);

			return Math.min(1, minutesIntoWorkDay / workDayDuration);
		} catch (error) {
			this.logger.warn('Error calculating work day progress with org hours:', error);
			return 0.5; // Default to 50% if calculation fails
		}
	}

	/**
	 * Get expected employees for today based on organization schedule
	 */
	private async getExpectedEmployeesForToday(
		allUsers: Omit<User, 'password'>[],
		organizationId: string,
		date: Date,
	): Promise<number> {
		try {
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, date);

			// If it's not a working day, no employees are expected
			if (!workingDayInfo.isWorkingDay) {
				return 0;
			}

			// For now, assume all active users are expected on working days
			// In the future, this could be enhanced to consider individual schedules
			return allUsers.filter((user) => !user.isDeleted && user.status !== 'INACTIVE').length;
		} catch (error) {
			this.logger.warn('Error calculating expected employees:', error);
			return allUsers.length; // Fallback to all users
		}
	}

	/**
	 * Enhanced employee status categorization using organization hours
	 */
	private async categorizeEmployeesByStatusWithOrgHours(
		allUsers: Omit<User, 'password'>[],
		todayAttendance: Attendance[],
		organizationId: string,
		currentTime: Date = new Date(),
	): Promise<{
		presentEmployees: AttendanceReportUser[];
		absentEmployees: AttendanceReportUser[];
		currentlyWorkingEmployees: AttendanceReportUser[];
		completedShiftEmployees: AttendanceReportUser[];
		overtimeEmployees: AttendanceReportUser[];
	}> {
		const presentUserIds = new Set(todayAttendance.map((att) => att.owner?.uid));

		const presentEmployees: AttendanceReportUser[] = [];
		const currentlyWorkingEmployees: AttendanceReportUser[] = [];
		const completedShiftEmployees: AttendanceReportUser[] = [];
		const overtimeEmployees: AttendanceReportUser[] = [];

		// Get organization working day info for overtime calculation
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, currentTime);
		const standardWorkMinutes =
			workingDayInfo.expectedWorkMinutes || TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;

		// Categorize present employees
		for (const attendance of todayAttendance) {
			const owner = attendance.owner;
			if (!owner) continue;

			const fullName = `${owner.name || ''} ${owner.surname || ''}`.trim();
			const hoursWorked = await this.calculateRealTimeHoursWithOrgHours(attendance, organizationId, currentTime);

			// Check if user is late using organization hours
			let lateInfo = { isLate: false, lateMinutes: 0 };
			if (attendance.checkIn) {
				lateInfo = await this.organizationHoursService.isUserLate(organizationId, attendance.checkIn);
			}

			const employee: AttendanceReportUser = {
				uid: owner.uid,
				name: owner.name || 'Unknown',
				surname: owner.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: owner.email || 'no-email@company.com',
				phone: owner.phone || undefined,
				role: owner.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: owner.photoURL || null,
				},
				branch: owner.branch
					? {
							uid: owner.branch.uid,
							name: owner.branch.name || 'Unknown Branch',
					  }
					: undefined,
				checkInTime: attendance.checkIn ? await this.formatTimeInOrganizationTimezone(attendance.checkIn, organizationId, 'HH:mm') : undefined,
				lateMinutes: lateInfo.lateMinutes,
				lateStatus: this.determineLateStatus(lateInfo.lateMinutes),
			};

			presentEmployees.push(employee);

			// Categorize by current status using organization hours
			if (attendance.checkIn && !attendance.checkOut) {
				currentlyWorkingEmployees.push(employee);
			} else if (attendance.checkOut) {
				completedShiftEmployees.push(employee);

				// Check for overtime using organization hours
				const workMinutes = hoursWorked * 60;
				if (workMinutes > standardWorkMinutes) {
					overtimeEmployees.push(employee);
				}
			}
		}

		// Create absent employees list - only count those expected to work today
		const workingDayInfo2 = await this.organizationHoursService.getWorkingDayInfo(organizationId, currentTime);
		const absentEmployees: AttendanceReportUser[] = [];

		if (workingDayInfo2.isWorkingDay) {
			const absentUsers = allUsers.filter(
				(user) => !presentUserIds.has(user.uid) && !user.isDeleted && user.status !== 'INACTIVE',
			);

			for (const user of absentUsers) {
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				absentEmployees.push({
					uid: user.uid,
					name: user.name || 'Unknown',
					surname: user.surname || 'User',
					fullName: fullName || 'Unknown User',
					email: user.email || 'no-email@company.com',
					phone: user.phone || undefined,
					role: user.accessLevel || AccessLevel.USER,
					userProfile: {
						avatar: user.photoURL || null,
					},
					branch: user.branch
						? {
								uid: user.branch.uid,
								name: user.branch.name || 'Unknown Branch',
						  }
						: undefined,
				});
			}
		}

		return {
			presentEmployees,
			absentEmployees,
			currentlyWorkingEmployees,
			completedShiftEmployees,
			overtimeEmployees,
		};
	}

	/**
	 * Calculate real-time hours with organization hours context and multi-day shift support
	 */
	private async calculateRealTimeHoursWithOrgHours(
		attendance: Attendance,
		organizationId: string,
		currentTime: Date = new Date(),
		targetDate?: string, // YYYY-MM-DD format - if provided, only return hours for this specific date
	): Promise<number> {
		if (!attendance.checkIn) return 0;

		const checkInTime = new Date(attendance.checkIn);
		const checkOutTime = attendance.checkOut ? new Date(attendance.checkOut) : currentTime;

		// Use the new multi-day shift splitting functionality
		const splitResult = TimeCalculatorUtil.splitMultiDayShift(
			checkInTime,
			attendance.checkOut ? checkOutTime : null,
			attendance.breakDetails,
			attendance.totalBreakTime,
		);

		// If a target date is specified, return only hours for that date
		if (targetDate) {
			const targetSegment = splitResult.segments.find((segment) => segment.date === targetDate);
			return targetSegment ? targetSegment.netWorkMinutes / 60 : 0;
		}

		// If it's a single day shift or no target date specified, return total hours
		if (!splitResult.isMultiDay) {
			return splitResult.segments[0]?.netWorkMinutes / 60 || 0;
		}

		// For multi-day shifts without target date, return total across all days
		// This maintains backward compatibility for existing usage
		return splitResult.segments.reduce((total, segment) => total + segment.netWorkMinutes, 0) / 60;
	}

	/**
	 * Determine late status based on minutes late
	 */
	private determineLateStatus(lateMinutes: number): 'on-time' | 'late' | 'very-late' | 'extremely-late' {
		if (lateMinutes <= 0) return 'on-time';
		if (lateMinutes >= 60) return 'extremely-late';
		if (lateMinutes >= 30) return 'very-late';
		return 'late';
	}

	/**
	 * Generate branch breakdown using organization hours
	 */
	private async generateBranchBreakdownWithOrgHours(
		allUsers: Omit<User, 'password'>[],
		todayAttendance: Attendance[],
		organizationId: string,
		currentTime: Date = new Date(),
	): Promise<BranchSummary[]> {
		const branchMap = new Map<number, BranchSummary>();

		// Initialize branch data
		allUsers.forEach((user) => {
			if (user.branch) {
				const branchId = user.branch.uid;
				if (!branchMap.has(branchId)) {
					branchMap.set(branchId, {
						branchId,
						branchName: user.branch.name,
						presentEmployees: [],
						absentEmployees: [],
						currentlyWorkingEmployees: [],
						completedShiftEmployees: [],
						attendanceRate: 0,
						totalEmployees: 0,
						totalHoursWorked: 0,
						averageHoursWorked: 0,
					});
				}
			}
		});

		// Check if today is a working day
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, currentTime);

		// Categorize employees by branch
		const presentUserIds = new Set(todayAttendance.map((att) => att.owner?.uid));

		// Process all users and categorize them by branch
		for (const user of allUsers) {
			if (!user.branch) continue;

			const branch = branchMap.get(user.branch.uid);
			if (!branch) continue;

			// Only count active users expected to work today
			if (user.isDeleted || user.status === 'INACTIVE') continue;
			if (!workingDayInfo.isWorkingDay) continue; // Skip if not a working day

			const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
			const employeeData: AttendanceReportUser = {
				uid: user.uid,
				name: user.name || 'Unknown',
				surname: user.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: user.email || 'no-email@company.com',
				phone: user.phone || undefined,
				role: user.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: user.photoURL || null,
				},
				branch: {
					uid: user.branch.uid,
					name: user.branch.name || 'Unknown Branch',
				},
			};

			branch.totalEmployees++;

			const attendance = todayAttendance.find((att) => att.owner?.uid === user.uid);

			if (attendance) {
				// Present employee
				employeeData.checkInTime = attendance.checkIn ? await this.formatTimeInOrganizationTimezone(attendance.checkIn, organizationId, 'HH:mm') : undefined;
				branch.presentEmployees.push(employeeData);

				// Calculate hours worked using organization hours
				const hoursWorked = await this.calculateRealTimeHoursWithOrgHours(
					attendance,
					organizationId,
					currentTime,
				);
				branch.totalHoursWorked += hoursWorked;

				// Categorize by status
				if (attendance.checkIn && !attendance.checkOut) {
					branch.currentlyWorkingEmployees.push(employeeData);
				} else if (attendance.checkOut) {
					branch.completedShiftEmployees.push(employeeData);
				}
			} else {
				// Absent employee
				branch.absentEmployees.push(employeeData);
			}
		}

		// Calculate final metrics for each branch
		const branchSummaries: BranchSummary[] = Array.from(branchMap.values()).map((branch) => {
			const attendanceRate =
				branch.totalEmployees > 0
					? Math.round((branch.presentEmployees.length / branch.totalEmployees) * 100)
					: 0;

			const averageHoursWorked =
				branch.presentEmployees.length > 0
					? Math.round((branch.totalHoursWorked / branch.presentEmployees.length) * 100) / 100
					: 0;

			return {
				...branch,
				attendanceRate,
				totalHoursWorked: Math.round(branch.totalHoursWorked * 100) / 100,
				averageHoursWorked,
			};
		});

		return branchSummaries.sort((a, b) => a.branchName.localeCompare(b.branchName));
	}

	/**
	 * Calculate comprehensive top performers based on multiple metrics
	 */
	private async calculateComprehensiveTopPerformers(
		templateEmployeeMetrics: any[],
		organizationId: string,
		startDate: Date,
		endDate: Date
	): Promise<any[]> {
		this.logger.debug(`Calculating comprehensive top performers for ${templateEmployeeMetrics.length} employees`);

		const performersWithScores = [];

		for (const emp of templateEmployeeMetrics) {
			if (!emp.uid || emp.hoursWorked <= 0) continue;

			try {
				// Get user daily report data for comprehensive metrics
				const dailyReportData = await this.getUserDailyReportData(emp.uid, startDate);
				
				// Calculate comprehensive performance score
				const score = this.calculatePerformanceScore(emp, dailyReportData);
				
				performersWithScores.push({
					uid: emp.uid,
					name: emp.name,
					surname: emp.surname,
					fullName: `${emp.name} ${emp.surname}`.trim(),
					hoursWorked: emp.hoursWorked,
					totalScore: score,
					efficiency: dailyReportData?.details?.performance?.efficiencyScore || 0,
					totalWorkingMinutes: Math.round(emp.hoursWorked * 60),
					tasksCompleted: dailyReportData?.details?.tasks?.completedCount || 0,
					leadsGenerated: dailyReportData?.details?.leads?.newLeadsCount || 0,
					salesRevenue: dailyReportData?.details?.quotations?.totalRevenueFormatted || 'R 0',
					branch: emp.branch,
					role: emp.role,
					achievement: this.getAchievementDescription(score, emp.hoursWorked),
					metric: this.getPrimaryMetric(score, emp.hoursWorked, dailyReportData),
				});
			} catch (error) {
				this.logger.warn(`Failed to get daily report data for user ${emp.uid}: ${error.message}`);
				// Fallback to basic metrics
				performersWithScores.push({
					uid: emp.uid,
					name: emp.name,
					surname: emp.surname,
					fullName: `${emp.name} ${emp.surname}`.trim(),
					hoursWorked: emp.hoursWorked,
					totalScore: emp.hoursWorked * 10, // Basic score based on hours
					efficiency: 0,
					totalWorkingMinutes: Math.round(emp.hoursWorked * 60),
					tasksCompleted: 0,
					leadsGenerated: 0,
					salesRevenue: 'R 0',
					branch: emp.branch,
					role: emp.role,
					achievement: emp.hoursWorked >= 8 ? 'Full day completed' : 'Good performance',
					metric: 'hours',
				});
			}
		}

		// Sort by total score and return top performers
		const topPerformers = performersWithScores
			.sort((a, b) => b.totalScore - a.totalScore)
			.slice(0, 5) // Top 5 performers
			.map((performer, index) => ({
				...performer,
				rank: index + 1,
			}));

		this.logger.log(`Generated ${topPerformers.length} top performers with comprehensive scoring`);
		return topPerformers;
	}

	/**
	 * Calculate performance score based on multiple metrics
	 */
	private calculatePerformanceScore(emp: any, dailyReportData: any): number {
		let score = 0;

		// Hours worked score (40% weight) - up to 40 points
		const hoursScore = Math.min(emp.hoursWorked * 5, 40);
		score += hoursScore;

		if (dailyReportData?.details) {
			const details = dailyReportData.details;

			// Tasks completion score (20% weight) - up to 20 points
			const tasksCompleted = details.tasks?.completedCount || 0;
			const tasksScore = Math.min(tasksCompleted * 2, 20);
			score += tasksScore;

			// Leads generation score (20% weight) - up to 20 points
			const leadsGenerated = details.leads?.newLeadsCount || 0;
			const leadsScore = Math.min(leadsGenerated * 4, 20);
			score += leadsScore;

			// Sales revenue score (15% weight) - up to 15 points
			const revenue = details.quotations?.totalRevenue || 0;
			const revenueScore = Math.min(revenue / 1000, 15); // 1 point per R1000
			score += revenueScore;

			// Efficiency score (5% weight) - up to 5 points
			const efficiency = details.performance?.efficiencyScore || 0;
			const efficiencyScore = efficiency / 20; // Convert percentage to 5-point scale
			score += efficiencyScore;
		}

		return Math.round(score * 10) / 10; // Round to 1 decimal place
	}

	/**
	 * Get achievement description based on performance
	 */
	private getAchievementDescription(score: number, hoursWorked: number): string {
		if (score >= 80) return 'Outstanding performance across all metrics';
		if (score >= 60) return 'Excellent multi-dimensional performance';
		if (score >= 40) return 'Strong performance with good balance';
		if (hoursWorked >= 8) return 'Full day completed';
		return 'Good performance';
	}

	/**
	 * Get primary metric for achievement
	 */
	private getPrimaryMetric(score: number, hoursWorked: number, dailyReportData: any): string {
		if (!dailyReportData?.details) return 'hours';

		const details = dailyReportData.details;
		const tasksCompleted = details.tasks?.completedCount || 0;
		const leadsGenerated = details.leads?.newLeadsCount || 0;
		const revenue = details.quotations?.totalRevenue || 0;

		// Determine primary strength
		if (revenue > 5000) return 'sales';
		if (leadsGenerated >= 3) return 'leads';
		if (tasksCompleted >= 5) return 'tasks';
		return 'hours';
	}

	/**
	 * Get user daily report data for comprehensive metrics
	 */
	private async getUserDailyReportData(userId: number, date: Date): Promise<any> {
		try {
			// Get the most recent daily report for this user and date
			const report = await this.reportsRepository.findOne({
				where: {
					owner: { uid: userId },
					reportType: ReportType.USER_DAILY,
					generatedAt: Between(
						startOfDay(date),
						endOfDay(date)
					),
				},
				order: { generatedAt: 'DESC' },
			});

			return report?.reportData || null;
		} catch (error) {
			this.logger.warn(`Failed to get daily report for user ${userId}: ${error.message}`);
			return null;
		}
	}

	/**
	 * Generate employee metrics with organization hours awareness
	 */
	private async generateEmployeeMetricsWithOrgHours(
		organizationId: string,
		allUsers: Omit<User, 'password'>[],
		todayAttendance: Attendance[],
		comparisonAttendance: Attendance[],
		comparisonLabel: string = 'yesterday',
	): Promise<EmployeeAttendanceMetric[]> {
		const metrics: EmployeeAttendanceMetric[] = [];

		this.logger.debug(`🔍 GenerateEmployeeMetrics: Processing ${allUsers.length} users for org ${organizationId}`);
		this.logger.debug(`🔍 Today's attendance records: ${todayAttendance.length}`);
		this.logger.debug(`🔍 Comparison attendance records: ${comparisonAttendance.length}`);

		// Log attendance record owners for debugging
		const attendanceOwners = todayAttendance.map(a => ({
			uid: a.owner?.uid,
			name: a.owner?.name,
			surname: a.owner?.surname,
			checkIn: a.checkIn ? format(a.checkIn, 'HH:mm') : null,
			checkOut: a.checkOut ? format(a.checkOut, 'HH:mm') : null
		}));
		this.logger.debug(`🔍 Today's Attendance Owners: ${JSON.stringify(attendanceOwners, null, 2)}`);

		// Log all users for debugging
		const userList = allUsers.map(u => ({
			uid: u.uid,
			name: u.name,
			surname: u.surname,
			email: u.email,
			isDeleted: u.isDeleted,
			status: u.status
		}));
		this.logger.debug(`🔍 All Users for Metrics: ${JSON.stringify(userList, null, 2)}`);

		for (const user of allUsers) {
			const todayRecord = todayAttendance.find((a) => a.owner?.uid === user.uid);
			const comparisonRecord = comparisonAttendance.find((a) => a.owner?.uid === user.uid);
			
			this.logger.debug(`🔍 Processing user ${user.name} ${user.surname} (UID: ${user.uid})`);
			this.logger.debug(`  - Today record found: ${!!todayRecord}`);
			this.logger.debug(`  - Comparison record found: ${!!comparisonRecord}`);

		// Use real-time hours calculation instead of duration field for more accurate data
		const todayHours = todayRecord 
			? await this.calculateRealTimeHoursWithOrgHours(todayRecord, organizationId, new Date())
			: 0;
		
		// Calculate comparison hours including both duration and overtime
		let comparisonHours = 0;
		if (comparisonRecord) {
			if (comparisonRecord.duration) {
				comparisonHours += this.parseDurationToMinutes(comparisonRecord.duration) / 60;
			}
			if (comparisonRecord.overtime) {
				comparisonHours += this.parseDurationToMinutes(comparisonRecord.overtime) / 60;
			}
		}

			let isLate = false;
			let lateMinutes = 0;

			if (todayRecord?.checkIn) {
				const lateInfo = await this.organizationHoursService.isUserLate(organizationId, todayRecord.checkIn);
				isLate = lateInfo.isLate;
				lateMinutes = lateInfo.lateMinutes;
			}

			const hoursDifference = todayHours - comparisonHours;
			let comparisonText = `Same as ${comparisonLabel}`;
			let timingDifference = '→';

			// Enhanced comparison logic to handle edge cases and provide meaningful insights
			if (comparisonHours === 0 && todayHours === 0) {
				// Both days have zero hours - not really "same as yesterday"
				comparisonText = `No work recorded today or ${comparisonLabel}`;
				timingDifference = '⭕';
			} else if (comparisonHours === 0 && todayHours > 0) {
				// Today has work but yesterday didn't - this is new activity, not improvement
				if (todayHours >= 6) {
					comparisonText = `New activity: ${
						Math.round(todayHours * 100) / 100
					}h worked (no ${comparisonLabel} data)`;
					timingDifference = '🆕';
				} else {
					comparisonText = `${Math.round(todayHours * 100) / 100}h worked (no ${comparisonLabel} data)`;
					timingDifference = '📊';
				}
			} else if (todayHours === 0 && comparisonHours > 0) {
				// Today has no work but yesterday did - this is absence, not decline
				comparisonText = `No work today (worked ${
					Math.round(comparisonHours * 100) / 100
				}h ${comparisonLabel})`;
				timingDifference = '❌';
			} else if (Math.abs(hoursDifference) < 0.1) {
				// Very small difference (less than 6 minutes) - consider it the same
				comparisonText = `Consistent: ${Math.round(todayHours * 100) / 100}h (similar to ${comparisonLabel})`;
				timingDifference = '📍';
			} else if (hoursDifference > 0.5) {
				// Meaningful increase
				const increasePercent = Math.round((hoursDifference / comparisonHours) * 100);
				if (increasePercent >= 50) {
					comparisonText = `Strong increase: +${
						Math.round(hoursDifference * 100) / 100
					}h (+${increasePercent}% vs ${comparisonLabel})`;
					timingDifference = '📈';
				} else {
					comparisonText = `+${Math.round(hoursDifference * 100) / 100}h more than ${comparisonLabel}`;
					timingDifference = '↗️';
				}
			} else if (hoursDifference < -0.5) {
				// Meaningful decrease
				const decreasePercent = Math.round((Math.abs(hoursDifference) / comparisonHours) * 100);
				if (decreasePercent >= 50) {
					comparisonText = `Significant decrease: ${
						Math.round(Math.abs(hoursDifference) * 100) / 100
					}h less (-${decreasePercent}% vs ${comparisonLabel})`;
					timingDifference = '📉';
				} else {
					comparisonText = `${
						Math.round(Math.abs(hoursDifference) * 100) / 100
					}h less than ${comparisonLabel}`;
					timingDifference = '↘️';
				}
			} else {
				// Small difference (0.1 to 0.5 hours) - acknowledge but don't overstate
				if (hoursDifference > 0) {
					comparisonText = `Slightly more: +${
						Math.round(hoursDifference * 100) / 100
					}h vs ${comparisonLabel}`;
					timingDifference = '↗️';
				} else {
					comparisonText = `Slightly less: ${
						Math.round(Math.abs(hoursDifference) * 100) / 100
					}h vs ${comparisonLabel}`;
					timingDifference = '↘️';
				}
			}

			// Defensive user profile creation to prevent data mix-ups
			const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
			const reportUser: AttendanceReportUser = {
				uid: user.uid,
				name: user.name || 'Unknown',
				surname: user.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: user.email || 'no-email@company.com',
				phone: user.phone || undefined,
				role: user.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: user.photoURL || null,
				},
				branch: user.branch
					? {
							uid: user.branch.uid,
							name: user.branch.name || 'Unknown Branch',
					  }
					: undefined,
				lateMinutes: undefined,
				earlyMinutes: undefined,
				checkInTime: undefined,
				lateStatus: undefined,
			};

			const newMetric = {
				user: reportUser,
				todayCheckIn: todayRecord?.checkIn ? await this.formatTimeInOrganizationTimezone(todayRecord.checkIn, organizationId, 'HH:mm') : null,
				todayCheckOut: todayRecord?.checkOut ? await this.formatTimeInOrganizationTimezone(todayRecord.checkOut, organizationId, 'HH:mm') : null,
				hoursWorked: Math.round(todayHours * 100) / 100,
				isLate,
				lateMinutes,
				yesterdayHours: Math.round(comparisonHours * 100) / 100,
				comparisonText,
				timingDifference,
			};

			this.logger.debug(`  - Created metric: ${JSON.stringify({
				name: newMetric.user.fullName,
				checkIn: newMetric.todayCheckIn,
				checkOut: newMetric.todayCheckOut,
				hours: newMetric.hoursWorked,
				isLate: newMetric.isLate,
				status: todayRecord ? 'Has Record' : 'No Record'
			})}`);

			metrics.push(newMetric);
		}

		// Sort by hours worked (descending), then by punctuality (on-time first)
		const sortedMetrics = metrics.sort((a, b) => {
			if (b.hoursWorked !== a.hoursWorked) {
				return b.hoursWorked - a.hoursWorked;
			}
			// If hours are equal, prioritize punctual employees
			if (a.isLate !== b.isLate) {
				return a.isLate ? 1 : -1;
			}
			return 0;
		});

		// Enhanced logging for debugging
		this.logger.debug(`📊 Employee Metrics Generated for org ${organizationId}:`);
		this.logger.debug(`  - Total Metrics: ${sortedMetrics.length}`);
		this.logger.debug(`  - With Hours > 0: ${sortedMetrics.filter(m => m.hoursWorked > 0).length}`);
		this.logger.debug(`  - With Check-in: ${sortedMetrics.filter(m => m.todayCheckIn).length}`);
		this.logger.debug(`  - Late Employees: ${sortedMetrics.filter(m => m.isLate).length}`);
		
		// Log first few metrics for debugging (without sensitive data)
		const sampleMetrics = sortedMetrics.slice(0, 3).map(m => ({
			user: m.user.fullName,
			hoursWorked: m.hoursWorked,
			checkIn: m.todayCheckIn,
			checkOut: m.todayCheckOut,
			isLate: m.isLate
		}));
		this.logger.debug(`  - Sample Metrics: ${JSON.stringify(sampleMetrics, null, 2)}`);

		return sortedMetrics;
	}

	/**
	 * Calculate total overtime using organization hours
	 */
	private async calculateTotalOvertimeWithOrgHours(
		todayAttendance: Attendance[],
		organizationId: string,
		currentTime: Date = new Date(),
	): Promise<number> {
		let totalOvertimeMinutes = 0;

		// Get organization working day info
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, currentTime);
		const standardMinutes = workingDayInfo.expectedWorkMinutes || TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
		const standardHours = standardMinutes / 60;

		for (const attendance of todayAttendance) {
			const realTimeHours = await this.calculateRealTimeHoursWithOrgHours(
				attendance,
				organizationId,
				currentTime,
			);
			const overtimeHours = Math.max(0, realTimeHours - standardHours);
			totalOvertimeMinutes += overtimeHours * 60;
		}

		return totalOvertimeMinutes;
	}

	/**
	 * Calculate comparison late count using organization hours
	 */
	private async calculateComparisonLateCountWithOrgHours(
		comparisonAttendance: Attendance[],
		organizationId: string,
	): Promise<number> {
		let lateCount = 0;

		for (const attendance of comparisonAttendance) {
			if (attendance.checkIn) {
				const lateInfo = await this.organizationHoursService.isUserLate(organizationId, attendance.checkIn);
				if (lateInfo.isLate) {
					lateCount++;
				}
			}
		}

		return lateCount;
	}

	/**
	 * Enhanced employee status categorization using consolidated attendance data
	 * This prevents duplicate user entries when users have multiple check-ins
	 */
	private async categorizeEmployeesByStatusWithConsolidatedData(
		allUsers: Omit<User, 'password'>[],
		consolidatedAttendance: Map<
			number,
			{
				user: User;
				primaryAttendance: Attendance;
				allAttendances: Attendance[];
				totalHours: number;
				isOvertime: boolean;
				earliestCheckIn: Date;
				latestCheckOut: Date | null;
			}
		>,
		organizationId: string,
		currentTime: Date = new Date(),
	): Promise<{
		presentEmployees: AttendanceReportUser[];
		absentEmployees: AttendanceReportUser[];
		currentlyWorkingEmployees: AttendanceReportUser[];
		completedShiftEmployees: AttendanceReportUser[];
		overtimeEmployees: AttendanceReportUser[];
	}> {
		const presentUserIds = new Set(consolidatedAttendance.keys());

		const presentEmployees: AttendanceReportUser[] = [];
		const currentlyWorkingEmployees: AttendanceReportUser[] = [];
		const completedShiftEmployees: AttendanceReportUser[] = [];
		const overtimeEmployees: AttendanceReportUser[] = [];

		// Get organization working day info for overtime calculation
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, currentTime);
		const standardWorkMinutes =
			workingDayInfo.expectedWorkMinutes || TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;

		// Categorize present employees using consolidated data
		for (const [userId, userRecord] of consolidatedAttendance) {
			const { user, primaryAttendance, totalHours, isOvertime, latestCheckOut } = userRecord;

			const fullName = `${user.name || ''} ${user.surname || ''}`.trim();

			// Check if user is late using organization hours (based on first check-in)
			let lateInfo = { isLate: false, lateMinutes: 0 };
			if (primaryAttendance.checkIn) {
				lateInfo = await this.organizationHoursService.isUserLate(organizationId, primaryAttendance.checkIn);
			}

			const employee: AttendanceReportUser = {
				uid: user.uid,
				name: user.name || 'Unknown',
				surname: user.surname || 'User',
				fullName: fullName || 'Unknown User',
				email: user.email || 'no-email@company.com',
				phone: user.phone || undefined,
				role: user.accessLevel || AccessLevel.USER,
				userProfile: {
					avatar: user.photoURL || null,
				},
				branch: user.branch
					? {
							uid: user.branch.uid,
							name: user.branch.name || 'Unknown Branch',
					  }
					: undefined,
				checkInTime: primaryAttendance.checkIn ? await this.formatTimeInOrganizationTimezone(primaryAttendance.checkIn, organizationId, 'HH:mm') : undefined,
				lateMinutes: lateInfo.lateMinutes,
				lateStatus: this.determineLateStatus(lateInfo.lateMinutes),
			};

			// Add overtime indicator
			if (isOvertime) {
				employee.checkInTime = `${employee.checkInTime} (OT: ${totalHours}h)`;
			}

			presentEmployees.push(employee);

			// Categorize by current status using consolidated data
			if (primaryAttendance.checkIn && !latestCheckOut) {
				// Still working (has check-in but no final check-out)
				currentlyWorkingEmployees.push(employee);
			} else if (latestCheckOut) {
				// Completed shift (has final check-out)
				completedShiftEmployees.push(employee);

				// Check for overtime using organization hours
				const workMinutes = totalHours * 60;
				if (workMinutes > standardWorkMinutes) {
					overtimeEmployees.push(employee);
				}
			}
		}

		// Create absent employees list - only count those expected to work today
		const workingDayInfo2 = await this.organizationHoursService.getWorkingDayInfo(organizationId, currentTime);
		const absentEmployees: AttendanceReportUser[] = [];

		if (workingDayInfo2.isWorkingDay) {
			const absentUsers = allUsers.filter(
				(user) => !presentUserIds.has(user.uid) && !user.isDeleted && user.status !== 'INACTIVE',
			);

			for (const user of absentUsers) {
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				absentEmployees.push({
					uid: user.uid,
					name: user.name || 'Unknown',
					surname: user.surname || 'User',
					fullName: fullName || 'Unknown User',
					email: user.email || 'no-email@company.com',
					phone: user.phone || undefined,
					role: user.accessLevel || AccessLevel.USER,
					userProfile: {
						avatar: user.photoURL || null,
					},
					branch: user.branch
						? {
								uid: user.branch.uid,
								name: user.branch.name || 'Unknown Branch',
						  }
						: undefined,
				});
			}
		}

		return {
			presentEmployees,
			absentEmployees,
			currentlyWorkingEmployees,
			completedShiftEmployees,
			overtimeEmployees,
		};
	}

	// Removed: This method has been replaced by calculateRealTimeHoursWithOrgHours

	/**
	 * Collect comprehensive performance analytics (integrated from user-daily-report.generator.ts)
	 */
	private async collectPerformanceAnalytics(
		organizationId: string, 
		allUsers: Omit<User, 'password'>[], 
		startDate: Date, 
		endDate: Date
	): Promise<{
		overallScore: number;
		taskEfficiency: number;
		leadConversionRate: number;
		revenuePerHour: number;
		strengths: string[];
		improvementAreas: string[];
	}> {
		try {
			// Calculate basic performance metrics using attendance data
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					organisation: [
						{ clerkOrgId: organizationId },
						{ ref: organizationId }
					],
					checkIn: Between(startDate, endDate),
				},
				relations: ['owner'],
			});

			// Calculate efficiency based on attendance consistency and hours worked
			const totalUsers = allUsers.length;
			const activeUsers = attendanceRecords.filter(record => record.owner).length;
			const attendanceEfficiency = totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0;

			// Calculate average hours per employee
			let totalHours = 0;
			for (const attendance of attendanceRecords) {
				const hours = await this.calculateRealTimeHoursWithOrgHours(attendance, organizationId, endDate);
				totalHours += hours;
			}
			const avgHoursPerEmployee = attendanceRecords.length > 0 ? totalHours / attendanceRecords.length : 0;

			// Calculate overall performance score
			const performanceScore = (attendanceEfficiency + (avgHoursPerEmployee * 12.5)) / 2; // Scale avg hours to 100

			// Identify strengths and improvement areas
			const strengths = [];
			const improvementAreas = [];

			if (attendanceEfficiency > 85) strengths.push('Excellent attendance consistency');
			if (avgHoursPerEmployee > 7) strengths.push('Strong daily productivity');
			if (attendanceEfficiency < 70) improvementAreas.push('Attendance consistency needs improvement');
			if (avgHoursPerEmployee < 6) improvementAreas.push('Daily productivity could be enhanced');

			return {
				overallScore: Math.round(performanceScore * 10) / 10,
				taskEfficiency: attendanceEfficiency,
				leadConversionRate: 0, // Would need leads data
				revenuePerHour: 0, // Would need revenue data
				strengths,
				improvementAreas,
			};
		} catch (error) {
			this.logger.error(`Error collecting performance analytics: ${error.message}`, error.stack);
			return {
				overallScore: 0,
				taskEfficiency: 0,
				leadConversionRate: 0,
				revenuePerHour: 0,
				strengths: [],
				improvementAreas: [],
			};
		}
	}

	/**
	 * Collect productivity insights and patterns (integrated from user-daily-report.generator.ts)
	 */
	private async collectProductivityInsights(
		organizationId: string,
		allUsers: Omit<User, 'password'>[],
		startDate: Date,
		endDate: Date
	): Promise<{
		peakProductivityHour: number;
		averageFocusTime: string;
		productivityScore: number;
		workPatterns: any;
		recommendations: string[];
	}> {
		try {
			// Get attendance records for the period
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					organisation: [
						{ clerkOrgId: organizationId },
						{ ref: organizationId }
					],
					checkIn: Between(startDate, endDate),
				},
				order: { checkIn: 'DESC' },
			});

			// Calculate peak productivity hours based on check-in times
			const hourlyActivity = new Array(24).fill(0);
			attendanceRecords.forEach(record => {
				if (record.checkIn) {
					const hour = new Date(record.checkIn).getHours();
					hourlyActivity[hour]++;
				}
			});

			const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));

			// Calculate average focus time (continuous work periods)
			const avgFocusTime = this.calculateAverageFocusTime(attendanceRecords);
			const workPatterns = this.analyzeWorkPatterns(attendanceRecords);

			return {
				peakProductivityHour: peakHour,
				averageFocusTime: this.formatDuration(avgFocusTime),
				productivityScore: this.calculateProductivityScore(hourlyActivity, avgFocusTime),
				workPatterns: {
					preferredStartTime: workPatterns.avgStartTime,
					preferredEndTime: workPatterns.avgEndTime,
					consistencyScore: workPatterns.consistencyScore,
				},
				recommendations: this.generateProductivityRecommendations({
					peakHour,
					avgFocusTime,
					consistency: workPatterns.consistencyScore,
				}),
			};
		} catch (error) {
			this.logger.error(`Error collecting productivity insights: ${error.message}`, error.stack);
			return {
				peakProductivityHour: 9,
				averageFocusTime: '0h 0m',
				productivityScore: 0,
				workPatterns: {},
				recommendations: [],
			};
		}
	}

	/**
	 * Generate productivity recommendations (integrated from user-daily-report.generator.ts)
	 */
	private generateProductivityRecommendations(data: any): string[] {
		const recommendations = [];
		if (data.peakHour < 10) recommendations.push('Consider scheduling important tasks in the morning');
		if (data.avgFocusTime < 120) recommendations.push('Try to extend focus periods with time-blocking');
		if (data.consistency < 70) recommendations.push('Work on maintaining consistent work patterns');
		return recommendations;
	}

	/**
	 * Collect wellness and work-life balance metrics (integrated from user-daily-report.generator.ts)
	 */
	private async collectWellnessMetrics(
		organizationId: string,
		startDate: Date,
		endDate: Date
	): Promise<{
		wellnessScore: number;
		workLifeBalance: any;
		stressLevel: string;
		recommendations: string[];
	}> {
		try {
			// Get attendance data for wellness analysis
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					organisation: [
						{ clerkOrgId: organizationId },
						{ ref: organizationId }
					],
					checkIn: Between(startDate, endDate),
				},
				order: { checkIn: 'DESC' },
			});

			const workLifeBalance = await this.calculateWorkLifeBalance(attendanceRecords, organizationId);
			const stressIndicators = this.calculateStressIndicators(attendanceRecords);
			const wellnessScore = this.calculateWellnessScore(workLifeBalance, stressIndicators);

			return {
				wellnessScore: Math.round(wellnessScore),
				workLifeBalance: {
					score: Math.round(workLifeBalance.score),
					averageHoursPerDay: workLifeBalance.avgHoursPerDay,
					overtimeDays: workLifeBalance.overtimeDays,
					recommendedBreaks: workLifeBalance.recommendedBreaks,
				},
				stressLevel: stressIndicators.level,
				recommendations: this.generateWellnessRecommendations(wellnessScore, workLifeBalance, stressIndicators),
			};
		} catch (error) {
			this.logger.error(`Error collecting wellness metrics: ${error.message}`, error.stack);
			return {
				wellnessScore: 75,
				workLifeBalance: { score: 75 },
				stressLevel: 'moderate',
				recommendations: [],
			};
		}
	}

	/**
	 * Calculate work-life balance metrics
	 */
	private async calculateWorkLifeBalance(records: Attendance[], organizationId: string): Promise<any> {
		let totalHours = 0;
		let overtimeDays = 0;

		// Get organization standard hours
		const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(organizationId, new Date());
		const standardHours = (workingDayInfo.expectedWorkMinutes || 480) / 60;

		for (const record of records) {
			if (record.checkIn && record.checkOut) {
				const hours = await this.calculateRealTimeHoursWithOrgHours(record, organizationId, new Date());
				totalHours += hours;
				if (hours > standardHours) {
					overtimeDays++;
				}
			}
		}

		const avgHoursPerDay = records.length > 0 ? totalHours / records.length : 0;
		const score = Math.max(0, 100 - (avgHoursPerDay - standardHours) * 10 - overtimeDays * 5);

		return {
			score,
			avgHoursPerDay: Math.round(avgHoursPerDay * 10) / 10,
			overtimeDays,
			recommendedBreaks: Math.max(0, Math.floor(avgHoursPerDay / 4)),
		};
	}

	/**
	 * Calculate stress indicators
	 */
	private calculateStressIndicators(records: Attendance[]): any {
		const longDays = records.filter(record => {
			if (record.checkIn && record.checkOut) {
				const hours = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn)) / 60;
				return hours > 10;
			}
			return false;
		}).length;

		const level = longDays > 3 ? 'high' : longDays > 1 ? 'moderate' : 'low';
		return { level, longDays };
	}

	/**
	 * Calculate wellness score
	 */
	private calculateWellnessScore(workLifeBalance: any, stressIndicators: any): number {
		let score = workLifeBalance.score;
		if (stressIndicators.level === 'high') score -= 20;
		else if (stressIndicators.level === 'moderate') score -= 10;
		return Math.max(0, Math.min(100, score));
	}

	/**
	 * Generate wellness recommendations
	 */
	private generateWellnessRecommendations(score: number, workLife: any, stress: any): string[] {
		const recommendations = [];
		if (score < 60) recommendations.push('Consider implementing better work-life balance practices');
		if (workLife.overtimeDays > 2) recommendations.push('Try to reduce overtime frequency');
		if (stress.level === 'high') recommendations.push('Take regular breaks and consider stress management techniques');
		if (workLife.avgHoursPerDay > 9) recommendations.push('Aim for more reasonable daily working hours');
		return recommendations;
	}

	/**
	 * Helper methods for analytics calculations
	 */
	private calculateAverageFocusTime(records: Attendance[]): number {
		// Simplified calculation - average continuous work time
		if (records.length === 0) return 0;
		const totalMinutes = records.reduce((sum, record) => {
			if (record.checkIn && record.checkOut) {
				return sum + differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
			}
			return sum;
		}, 0);
		return totalMinutes / records.length;
	}

	private analyzeWorkPatterns(records: Attendance[]): any {
		// Simplified work pattern analysis
		const startTimes = records.filter(r => r.checkIn).map(r => new Date(r.checkIn).getHours());
		const endTimes = records.filter(r => r.checkOut).map(r => new Date(r.checkOut).getHours());
		
		return {
			avgStartTime: startTimes.length > 0 ? Math.round(startTimes.reduce((a, b) => a + b, 0) / startTimes.length) : 9,
			avgEndTime: endTimes.length > 0 ? Math.round(endTimes.reduce((a, b) => a + b, 0) / endTimes.length) : 17,
			consistencyScore: 85, // Simplified for now
		};
	}

	private calculateProductivityScore(hourlyData: number[], focusTime: number): number {
		const peakHours = Math.max(...hourlyData);
		const focusScore = Math.min(100, focusTime / 4); // 4 hours = 100%
		return Math.round((peakHours * 10 + focusScore) / 2);
	}

	private formatDuration(minutes: number): string {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours}h ${mins}m`;
	}
}
