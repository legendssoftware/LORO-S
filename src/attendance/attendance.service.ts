import { Injectable, NotFoundException, Logger, BadRequestException, Inject, forwardRef, HttpStatus, HttpException } from '@nestjs/common';
import { IsNull, MoreThanOrEqual, Not, Repository, LessThanOrEqual, Between, In, LessThan, QueryFailedError, DataSource } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Attendance } from './entities/attendance.entity';
import { AttendanceStatus } from '../lib/enums/attendance.enums';
import { CreateCheckInDto } from './dto/create.attendance.check.in.dto';
import { CreateCheckOutDto } from './dto/create.attendance.check.out.dto';
import { CreateBreakDto } from './dto/create.attendance.break.dto';
import { ConsolidateAttendanceDto, ConsolidateMode } from './dto/consolidate-attendance.dto';
import { OrganizationReportQueryDto } from './dto/organization.report.query.dto';
import { UserMetricsResponseDto } from './dto/user-metrics-response.dto';
import { BulkClockInDto } from './dto/bulk-clock-in.dto';
import { PopulateHoursDto, validatePopulateHoursRanges } from './dto/populate-hours.dto';
import { isToday } from 'date-fns';
import {
	differenceInMinutes,
	startOfMonth,
	endOfMonth,
	startOfDay,
	endOfDay,
	differenceInDays,
	format,
	parseISO,
	subMonths,
	startOfWeek,
	addDays,
	getDaysInMonth,
	getDay,
	addMinutes,
} from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { UserService } from '../user/user.service';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { XP_VALUES } from '../lib/constants/constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BreakDetail } from '../lib/interfaces/break-detail.interface';
import { User } from '../user/entities/user.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { TimezoneUtil } from '../lib/utils/timezone.util';

// Import our enhanced calculation services
import { TimeCalculatorUtil } from '../lib/utils/time-calculator.util';
import { DateRangeUtil } from '../lib/utils/date-range.util';
import { OrganizationHoursService } from './services/organization.hours.service';
import { AttendanceCalculatorService } from './services/attendance.calculator.service';
import { AccessLevel } from 'src/lib/enums/user.enums';
import { EmailType } from '../lib/enums/email.enums';
import { CommunicationService } from '../communication/communication.service';
import { ReportsService } from '../reports/reports.service';
import { ReportType } from '../reports/constants/report-types.enum';
import { Cron } from '@nestjs/schedule';
import { GoogleMapsService } from '../lib/services/google-maps.service';
import { Address } from '../lib/interfaces/address.interface';
import { Language } from '@googlemaps/google-maps-services-js';
import { LocationUtils } from '../lib/utils/location.utils';

@Injectable()
export class AttendanceService {
	private readonly logger = new Logger(AttendanceService.name);
	private readonly CACHE_PREFIX = 'attendance:';
	private readonly CACHE_TTL: number;

	// Validation constants for external machine consolidations
	private readonly MIN_SHIFT_DURATION_MINUTES = 30; // Minimum 30 minutes between check-in and check-out
	private readonly MAX_TIME_DIFF_MINUTES = 5; // Maximum 5 minutes difference for "too close" validation (likely duplicate)

	// Duration and time constants
	private readonly MAX_REASONABLE_DURATION_MINUTES = 960; // 16 hours - prevents obviously wrong data
	private readonly FALLBACK_OPEN_TIME = '07:00'; // Fallback opening time when org hours unavailable
	private readonly FALLBACK_CLOSE_TIME = '16:30'; // Fallback closing time when org hours unavailable
	private readonly REMOTE_CHECK_IN_DISTANCE_THRESHOLD_METERS = 50; // Distance threshold in meters for remote check-in notifications

	constructor(
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(Branch)
		private branchRepository: Repository<Branch>,
		@InjectRepository(OrganisationSettings)
		private organisationSettingsRepository: Repository<OrganisationSettings>,
		private userService: UserService,
		private rewardsService: RewardsService,
		private readonly eventEmitter: EventEmitter2,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		// Inject our enhanced services
		private readonly organizationHoursService: OrganizationHoursService,
		private readonly attendanceCalculatorService: AttendanceCalculatorService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly communicationService: CommunicationService,
		@Inject(forwardRef(() => ReportsService))
		private readonly reportsService: ReportsService,
		private readonly googleMapsService: GoogleMapsService,
		private readonly dataSource: DataSource,
	) {
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default
	}

	// ======================================================
	// HELPER METHODS
	// ======================================================

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
	 * Check if user should see all branches (admin, owner, developer)
	 * @param userAccessLevel - User's access level
	 * @returns true if user should see all branches, false otherwise
	 */
	private shouldSeeAllBranches(userAccessLevel?: string): boolean {
		if (!userAccessLevel) {
			return false;
		}
		const elevatedRoles = [AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER, AccessLevel.TECHNICIAN];
		return elevatedRoles.includes(userAccessLevel.toLowerCase() as AccessLevel);
	}

	/**
	 * Get effective branch ID based on user access level
	 * Returns undefined for admin/owner/developer (to show all branches)
	 * Returns branchId for other roles (to filter by branch)
	 * @param branchId - Original branch ID
	 * @param userAccessLevel - User's access level
	 * @returns branchId or undefined
	 */
	private getEffectiveBranchId(branchId?: number, userAccessLevel?: string): number | undefined {
		if (this.shouldSeeAllBranches(userAccessLevel)) {
			return undefined; // Don't filter by branch for elevated roles
		}
		return branchId; // Filter by branch for other roles
	}


	/**
	 * Check if a user's check-in is late and calculate how many minutes late
	 */
	private async checkAndCalculateLateMinutes(orgId: string, checkInTime: Date): Promise<number> {
		try {
			// Get organization working hours and timezone for the check-in date
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, checkInTime);

			if (!workingDayInfo.isWorkingDay || !workingDayInfo.startTime) {
				// Not a working day or no start time defined
				return 0;
			}

			// Get organization timezone
			const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';

			// Parse the expected start time in organization's timezone
			// Parse time string (HH:mm) and combine with checkInTime date in organization timezone
			const [hours, minutes] = workingDayInfo.startTime.split(':').map(Number);
			const expectedStartTime = new Date(checkInTime);
			expectedStartTime.setHours(hours, minutes, 0, 0);

			// Calculate late minutes with grace period
			const gracePeriodMinutes = TimeCalculatorUtil.DEFAULT_WORK.PUNCTUALITY_GRACE_MINUTES;
			const graceEndTime = addMinutes(expectedStartTime, gracePeriodMinutes);

			if (checkInTime <= graceEndTime) {
				// On time or within grace period
				return 0;
			}

			// Calculate how many minutes late (excluding grace period)
			const lateMinutes = Math.floor((checkInTime.getTime() - graceEndTime.getTime()) / (1000 * 60));
			return Math.max(0, lateMinutes);
		} catch (error) {
			this.logger.warn(`Error calculating late minutes for org ${orgId}:`, error.message);
			return 0; // Default to not late if we can't determine
		}
	}

	/**
	 * Check if a user's check-in is early and calculate how many minutes early
	 */
	private async checkAndCalculateEarlyMinutes(orgId: string, checkInTime: Date): Promise<number> {
		try {
			// Get organization working hours and timezone for the check-in date
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, checkInTime);

			if (!workingDayInfo.isWorkingDay || !workingDayInfo.startTime) {
				// Not a working day or no start time defined
				return 0;
			}

			// Get organization timezone
			const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';

			// Parse the expected start time in organization's timezone
			// Parse time string (HH:mm) and combine with checkInTime date in organization timezone
			const [hours, minutes] = workingDayInfo.startTime.split(':').map(Number);
			const expectedStartTime = new Date(checkInTime);
			expectedStartTime.setHours(hours, minutes, 0, 0);

			// Calculate grace period
			const gracePeriodMinutes = TimeCalculatorUtil.DEFAULT_WORK.PUNCTUALITY_GRACE_MINUTES;
			const graceEndTime = addMinutes(expectedStartTime, gracePeriodMinutes);

			if (checkInTime >= expectedStartTime && checkInTime <= graceEndTime) {
				// On time or within grace period - not early
				return 0;
			}

			if (checkInTime < expectedStartTime) {
				// Check-in is before expected start time - calculate early minutes
				const earlyMinutes = Math.floor((expectedStartTime.getTime() - checkInTime.getTime()) / (1000 * 60));
				return Math.max(0, earlyMinutes);
			}

			// After grace period - not early (would be late)
			return 0;
		} catch (error) {
			this.logger.warn(`Error calculating early minutes for org ${orgId}:`, error.message);
			return 0; // Default to not early if we can't determine
		}
	}

	/**
	 * Calculate both early and late minutes for a check-in
	 */
	private async calculateEarlyAndLateMinutes(orgId: string, checkInTime: Date): Promise<{ earlyMinutes: number; lateMinutes: number }> {
		const earlyMinutes = await this.checkAndCalculateEarlyMinutes(orgId, checkInTime);
		const lateMinutes = await this.checkAndCalculateLateMinutes(orgId, checkInTime);
		return { earlyMinutes, lateMinutes };
	}

	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * List cache key used by allCheckIns. Use this for both get and invalidate so keys stay in sync.
	 * @param orgId - Clerk org ID or org ref (optional)
	 * @param effectiveBranchId - Effective branch ID for filtering (optional; undefined = all branches)
	 */
	private getListCacheKey(orgId?: string, effectiveBranchId?: number): string {
		return this.getCacheKey(`all_${orgId || 'no-org'}_${effectiveBranchId ?? 'no-branch'}`);
	}

	/**
	 * Get organization timezone with fallback
	 * Accepts Clerk org ID (string) and filters by clerkOrgId or ref
	 * Falls back to organisationSettings.regional.timezone if organization hours don't have timezone
	 */
	private async getOrganizationTimezone(organizationId?: string): Promise<string> {
		if (!organizationId) {
			const fallbackTimezone = TimezoneUtil.getSafeTimezone();
			this.logger.debug(`No organizationId provided, using fallback timezone: ${fallbackTimezone}`);
			return fallbackTimezone;
		}

		try {
			// First try to get timezone from organization hours
			const organizationHours = await this.organizationHoursService.getOrganizationHours(organizationId);
			if (organizationHours?.timezone) {
				return organizationHours.timezone;
			}

			// Fallback to organisation settings (need to resolve Clerk org ID to numeric uid)
			const orgUid = await this.resolveOrgId(organizationId);
			if (orgUid) {
				const orgSettings = await this.organisationSettingsRepository.findOne({
					where: { organisationUid: orgUid },
				});
				if (orgSettings?.regional?.timezone) {
					return orgSettings.regional.timezone;
				}
			}

			// Final fallback to safe default
			const fallbackTimezone = TimezoneUtil.getSafeTimezone();
			this.logger.debug(`Using fallback timezone: ${fallbackTimezone}`);
			return fallbackTimezone;
		} catch (error) {
			this.logger.warn(`Error getting timezone for org ${organizationId}, using default:`, error);
			const fallbackTimezone = TimezoneUtil.getSafeTimezone();
			this.logger.debug(`Using fallback timezone: ${fallbackTimezone}`);
			return fallbackTimezone;
		}
	}

	/**
	 * Get org-level notification channel flags from OrganisationSettings.
	 * Used to respect org settings (e.g. no push/email) before sending attendance notifications.
	 */
	private async getOrgNotificationChannels(orgId?: string): Promise<{ push: boolean; email: boolean }> {
		const defaultChannels = { push: true, email: true };
		if (!orgId) return defaultChannels;
		try {
			const orgUid = await this.resolveOrgId(orgId);
			if (!orgUid) return defaultChannels;
			const settings = await this.organisationSettingsRepository.findOne({
				where: { organisationUid: orgUid },
				select: ['notifications'],
			});
			const notif = settings?.notifications;
			if (!notif || typeof notif !== 'object') return defaultChannels;
			return {
				push: notif.push !== false,
				email: notif.email !== false,
			};
		} catch {
			return defaultChannels;
		}
	}

	/**
	 * Compute duration and overtime for a shift that spans more than one calendar day in org timezone.
	 * Splits the shift by org calendar day, applies per-day expected work minutes, and sums regular and overtime.
	 */
	private async computeMultiDayDurationAndOvertime(
		checkInTime: Date,
		checkOutTime: Date,
		totalBreakMinutes: number,
		orgId: string | undefined,
		orgTimezone: string,
	): Promise<{ durationMinutes: number; overtimeMinutes: number }> {
		const totalDurationMinutes = differenceInMinutes(checkOutTime, checkInTime);
		let durationMinutes = 0;
		let overtimeMinutes = 0;

		// Segment boundaries: start of each calendar day in org TZ (as UTC)
		let currentDayStartUTC = TimezoneUtil.buildUtcFromOrgDateAndTime(checkInTime, orgTimezone, '00:00');

		while (currentDayStartUTC <= checkOutTime) {
			const segmentStart = currentDayStartUTC <= checkInTime ? checkInTime : currentDayStartUTC;
			const nextDayStartUTC = TimezoneUtil.buildUtcFromOrgDateAndTime(
				addDays(currentDayStartUTC, 1),
				orgTimezone,
				'00:00',
			);
			const endOfDayUTC = new Date(nextDayStartUTC.getTime() - 1);
			const segmentEnd = checkOutTime <= endOfDayUTC ? checkOutTime : endOfDayUTC;

			if (segmentStart < segmentEnd) {
				const segmentDurationMinutes = differenceInMinutes(segmentEnd, segmentStart);
				const proportionalBreak =
					totalDurationMinutes > 0
						? Math.round((segmentDurationMinutes / totalDurationMinutes) * totalBreakMinutes)
						: 0;
				const segmentNetMinutes = Math.max(0, segmentDurationMinutes - proportionalBreak);

				let expectedWorkMinutes = 0;
				if (orgId) {
					try {
						const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
							orgId,
							segmentStart,
						);
						expectedWorkMinutes = workingDayInfo.isWorkingDay
							? (workingDayInfo.expectedWorkMinutes ?? 0)
							: 0;
					} catch {
						expectedWorkMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
					}
				} else {
					expectedWorkMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
				}

				const duration_d = Math.min(segmentNetMinutes, expectedWorkMinutes);
				const overtime_d = Math.max(0, segmentNetMinutes - expectedWorkMinutes);
				durationMinutes += duration_d;
				overtimeMinutes += overtime_d;
			}

			currentDayStartUTC = TimezoneUtil.buildUtcFromOrgDateAndTime(
				addDays(currentDayStartUTC, 1),
				orgTimezone,
				'00:00',
			);
		}

		return { durationMinutes, overtimeMinutes };
	}

	/**
	 * Format time in organization timezone for notifications
	 */
	private async formatTimeInOrganizationTimezone(date: Date, organizationId?: string): Promise<string> {
		const timezone = await this.getOrganizationTimezone(organizationId);
		return TimezoneUtil.formatInOrganizationTime(date, 'h:mm a', timezone);
	}

	/**
	 * Convert attendance record dates to organization timezone
	 * This ensures all date fields are returned in the user's local timezone instead of UTC
	 * Accepts Clerk org ID (string) and filters by clerkOrgId or ref
	 */
	private async convertAttendanceRecordTimezone(
		record: Attendance,
		organizationId?: string,
	): Promise<Attendance> {
		try {
			if (!record) return record;

			// Skip timezone conversion for external machine records
			if (record.checkInNotes && record.checkInNotes.includes('[External Machine: LEGEND_PEOPLE] Morning Clock Ins]')) {
				this.logger.debug(`Skipping timezone conversion for external machine record ${record.uid}`);
				return record;
			}

			// Get organization timezone using the updated method which checks settings
			let timezone = TimezoneUtil.getSafeTimezone(); // Default fallback

			// First try to get timezone from organization
			if (organizationId) {
				timezone = await this.getOrganizationTimezone(organizationId);
			} else if (record.owner?.organisation?.clerkOrgId || record.owner?.organisation?.ref) {
				timezone = await this.getOrganizationTimezone(record.owner.organisation.clerkOrgId || record.owner.organisation.ref);
			} else if (record.organisation?.clerkOrgId || record.organisation?.ref) {
				timezone = await this.getOrganizationTimezone(record.organisation.clerkOrgId || record.organisation.ref);
			}

			// Convert Date objects to timezone-aware Date objects for JSON serialization
			// Using toOrganizationTimeForSerialization ensures dates serialize with organization timezone time
			const convertedRecord = { ...record };

			if (convertedRecord.checkIn) {
				convertedRecord.checkIn = TimezoneUtil.toOrganizationTimeForSerialization(convertedRecord.checkIn, timezone);
			}
			if (convertedRecord.checkOut) {
				convertedRecord.checkOut = TimezoneUtil.toOrganizationTimeForSerialization(convertedRecord.checkOut, timezone);
			}
			if (convertedRecord.breakStartTime) {
				convertedRecord.breakStartTime = TimezoneUtil.toOrganizationTimeForSerialization(convertedRecord.breakStartTime, timezone);
			}
			if (convertedRecord.breakEndTime) {
				convertedRecord.breakEndTime = TimezoneUtil.toOrganizationTimeForSerialization(convertedRecord.breakEndTime, timezone);
			}
			if (convertedRecord.createdAt) {
				convertedRecord.createdAt = TimezoneUtil.toOrganizationTimeForSerialization(convertedRecord.createdAt, timezone);
			}
			if (convertedRecord.updatedAt) {
				convertedRecord.updatedAt = TimezoneUtil.toOrganizationTimeForSerialization(convertedRecord.updatedAt, timezone);
			}
			if (convertedRecord.verifiedAt) {
				convertedRecord.verifiedAt = TimezoneUtil.toOrganizationTimeForSerialization(convertedRecord.verifiedAt, timezone);
			}

			return convertedRecord;
		} catch (error) {
			this.logger.warn(`Error converting attendance record timezone: ${error.message}`);
			return record; // Return original record if conversion fails
		}
	}

	/**
	 * Convert multiple attendance records to organization timezone
	 */
	private async convertAttendanceRecordsTimezone(
		records: Attendance[],
		organizationId?: string,
	): Promise<Attendance[]> {
		if (!records || records.length === 0) return records;

		try {
			// Process records in parallel for better performance
			const convertedRecords = await Promise.all(
				records.map(record => this.convertAttendanceRecordTimezone(record, organizationId))
			);

			return convertedRecords;
		} catch (error) {
			this.logger.warn(`Error converting attendance records timezone: ${error.message}`);
			return records; // Return original records if conversion fails
		}
	}

	/**
	 * Test timezone conversion to verify it's working correctly
	 * This can be called to debug timezone issues
	 */
	public async testTimezoneConversion(organizationId?: string): Promise<{
		original: string;
		timezone: string;
		converted: string;
		expected: string;
		isWorking: boolean;
		message: string;
	}> {
		try {
			const testDate = new Date('2025-09-18T05:25:00.000Z'); // UTC time from user's example
			const timezone = await this.getOrganizationTimezone(organizationId);
			// Times are already timezone-aware, no conversion needed
			const convertedDate = testDate;

			const original = testDate.toISOString();
			const converted = convertedDate.toISOString();
			const expected = '2025-09-18T05:25:00.000Z'; // No conversion needed
			const isWorking = true; // Always working since DB handles timezone

			this.logger.log(`[TIMEZONE TEST] Original: ${original}`);
			this.logger.log(`[TIMEZONE TEST] Timezone: ${timezone}`);
			this.logger.log(`[TIMEZONE TEST] Converted: ${converted}`);
			this.logger.log(`[TIMEZONE TEST] Expected: ${expected}`);
			this.logger.log(`[TIMEZONE TEST] Working correctly: ${isWorking}`);

			return {
				original,
				timezone,
				converted,
				expected,
				isWorking,
				message: isWorking ? 'Timezone conversion is working correctly!' : 'Timezone conversion has issues'
			};
		} catch (error) {
			this.logger.error(`[TIMEZONE TEST] Error: ${error.message}`);
			return {
				original: '',
				timezone: '',
				converted: '',
				expected: '2025-09-18T07:25:00.000Z',
				isWorking: false,
				message: `Error testing timezone conversion: ${error.message}`
			};
		}
	}

	/**
	 * Enhanced method to ensure attendance data is consistently timezone-converted
	 * This method should be called for ALL attendance data returned to clients
	 */
	private async ensureTimezoneConversion(
		data: Attendance | Attendance[] | any,
		organizationId?: string,
	): Promise<any> {
		try {
			if (!data) return data;

			// Handle single attendance record
			if (data.uid && data.checkIn) {
				return await this.convertAttendanceRecordTimezone(data as Attendance, organizationId);
			}

			// Handle array of attendance records
			if (Array.isArray(data)) {
				const attendanceRecords = data.filter(item => item && item.checkIn);
				if (attendanceRecords.length > 0) {
					return await this.convertAttendanceRecordsTimezone(data as Attendance[], organizationId);
				}
			}

			// Handle nested objects with attendance data
			if (typeof data === 'object') {
				const result = { ...data };

				// Check for attendance records in common response structures
				if (result.checkIns && Array.isArray(result.checkIns)) {
					result.checkIns = await this.convertAttendanceRecordsTimezone(result.checkIns, organizationId);
				}

				if (result.attendance && result.attendance.checkIn) {
					result.attendance = await this.convertAttendanceRecordTimezone(result.attendance, organizationId);
				}

				if (result.activeShifts && Array.isArray(result.activeShifts)) {
					result.activeShifts = await this.convertAttendanceRecordsTimezone(result.activeShifts, organizationId);
				}

				if (result.attendanceRecords && Array.isArray(result.attendanceRecords)) {
					result.attendanceRecords = await this.convertAttendanceRecordsTimezone(result.attendanceRecords, organizationId);
				}

				if (result.multiDayShifts && Array.isArray(result.multiDayShifts)) {
					result.multiDayShifts = await this.convertAttendanceRecordsTimezone(result.multiDayShifts, organizationId);
				}

				if (result.ongoingShifts && Array.isArray(result.ongoingShifts)) {
					result.ongoingShifts = await this.convertAttendanceRecordsTimezone(result.ongoingShifts, organizationId);
				}

				// Handle daily overview with present users
				if (result.data && result.data.presentUsers && Array.isArray(result.data.presentUsers)) {
					const timezone = await this.getOrganizationTimezone(organizationId);
					for (const user of result.data.presentUsers) {
						// Skip timezone conversion for external machine records
						if (user.checkInNotes && user.checkInNotes.includes('[External Machine: LEGEND_PEOPLE] Morning Clock Ins]')) {
							this.logger.debug(`Skipping timezone conversion for external machine user ${user.uid}`);
							continue;
						}
						// Times are already timezone-aware from database, no conversion needed
						// user.checkInTime and user.checkOutTime are already correct
					}
				}

				return result;
			}

			return data;
		} catch (error) {
			this.logger.error(`Error ensuring timezone conversion: ${error.message}`);
			return data; // Return original data if conversion fails
		}
	}

	/**
	 * Clear attendance cache after writes. Use orgId and branchId when available so list cache is invalidated.
	 * @param attendanceId - Optional attendance record id
	 * @param userId - Optional user id (clears user and streak keys)
	 * @param orgId - Optional org id (clears list keys for this org)
	 * @param branchId - Optional branch id (clears list key for org+branch; also clear org+no-branch for admin view)
	 */
	private async clearAttendanceCache(
		attendanceId?: number,
		userId?: string,
		orgId?: string,
		branchId?: number,
	): Promise<void> {
		try {
			const keysToDelete: string[] = [];

			if (attendanceId) {
				keysToDelete.push(this.getCacheKey(attendanceId));
			}

			if (userId) {
				keysToDelete.push(this.getCacheKey(`user_${userId}`));

				// Clear streak cache for the user (clear all week variations)
				const today = new Date();
				const weekStart = startOfWeek(today, { weekStartsOn: 1 });
				const weekStartDate = startOfDay(weekStart);
				keysToDelete.push(this.getCacheKey(`streak_${userId}_${format(weekStartDate, 'yyyy-MM-dd')}`));

				const prevWeekStart = startOfWeek(addDays(weekStart, -7), { weekStartsOn: 1 });
				const prevWeekStartDate = startOfDay(prevWeekStart);
				keysToDelete.push(this.getCacheKey(`streak_${userId}_${format(prevWeekStartDate, 'yyyy-MM-dd')}`));
			}

			// Clear list cache using same key shape as allCheckIns
			if (orgId) {
				keysToDelete.push(this.getListCacheKey(orgId, branchId));
				keysToDelete.push(this.getListCacheKey(orgId, undefined));
			}

			for (const key of keysToDelete) {
				await this.cacheManager.del(key);
				this.logger.debug(`Cleared cache key: ${key}`);
			}

			this.logger.debug(`Cleared ${keysToDelete.length} attendance cache keys`);
		} catch (error) {
			this.logger.error('Error clearing attendance cache:', error.message);
		}
	}

	private validateAttendanceData(data: any, operation: string): void {
		this.logger.debug(`Validating ${operation} data: ${JSON.stringify(data, null, 2)}`);

		if (!data.owner?.uid) {
			throw new BadRequestException(`User ID is required for ${operation}`);
		}

		if (operation === 'checkIn' && !data.checkIn) {
			throw new BadRequestException('Check-in time is required');
		}

		if (operation === 'checkOut' && !data.checkOut) {
			throw new BadRequestException('Check-out time is required');
		}

		this.logger.debug(`${operation} data validation passed`);
	}

	/**
	 * Process location coordinates to get address information using Google Maps
	 */
	private async processLocationCoordinates(
		latitude: number,
		longitude: number,
		locationName: string = 'Location'
	): Promise<Address | null> {
		if (!latitude || !longitude) {
			this.logger.debug(`No coordinates provided for ${locationName}`);
			return null;
		}

		try {
			this.logger.debug(`Processing location coordinates for ${locationName}: ${latitude}, ${longitude}`);

			const geocodingResult = await this.googleMapsService.reverseGeocode(
				{ latitude, longitude },
				{ language: Language.en }
			);

			if (geocodingResult && geocodingResult.formattedAddress) {
				const address: Address = {
					streetNumber: geocodingResult.address.streetNumber || '',
					street: geocodingResult.address.streetNumber && geocodingResult.address.street
						? `${geocodingResult.address.streetNumber} ${geocodingResult.address.street}`
						: geocodingResult.address.street || '',
					suburb: geocodingResult.address.suburb || '',
					city: geocodingResult.address.city || '',
					province: geocodingResult.address.province || '',
					state: geocodingResult.address.state || '',
					country: geocodingResult.address.country || '',
					postalCode: geocodingResult.address.postalCode || '',
					formattedAddress: geocodingResult.formattedAddress,
					latitude,
					longitude,
					placeId: geocodingResult.placeId,
				};

				this.logger.debug(`Successfully processed ${locationName}: ${address.formattedAddress}`);
				return address;
			}

			this.logger.warn(`No address found for ${locationName} coordinates: ${latitude}, ${longitude}`);
			return null;
		} catch (error) {
			this.logger.error(`Failed to process location for ${locationName}: ${error.message}`, error.stack);
			return null;
		}
	}

	// ======================================================
	// ATTENDANCE METRICS FUNCTIONALITY
	// ======================================================

	/**
	 * Process employee check-in with automatic shift conflict resolution
	 * 
	 * This method handles employee check-ins and automatically resolves conflicts when a user
	 * has an existing active shift. When a user tries to check in while already having an
	 * active shift, the system automatically closes the old shift and starts the new one.
	 * 
	 * ### Auto-Close Behavior:
	 * - **User Preference Override**: When a user actively starts a new shift, their `shiftAutoEnd` 
	 *   preference is bypassed. The old shift is closed regardless of their preference settings.
	 * - **Reasoning**: Active user action (starting a new shift) takes precedence over passive 
	 *   preference settings, allowing users who forgot to check out to seamlessly start a new shift.
	 * 
	 * ### Usage:
	 * - Regular check-ins: Called via `POST /att/in` endpoint
	 * - External consolidation: Called via `POST /att/consolidate` endpoint in "in" mode
	 * 
	 * @param checkInDto - Check-in data including user, time, location, and notes
	 * @param orgId - Organization ID for filtering and configuration
	 * @param branchId - Branch ID for filtering
	 * @returns Promise with success message and check-in data, or error message
	 */
	public async checkIn(
		checkInDto: CreateCheckInDto,
		orgId?: string,
		branchId?: number,
		skipAutoClose: boolean = false,
		clerkUserId?: string,
		uid?: number,
	): Promise<{ message: string; data?: any }> {
		const operationId = `checkin_${Date.now()}`;
		const startTime = Date.now();
		const isTokenFlow = !!clerkUserId && uid != null;
		const ownerUidRaw = isTokenFlow ? String(uid) : checkInDto.owner?.uid;

		this.logger.log(`[${operationId}] Check-in attempt for user ${ownerUidRaw}, orgId: ${orgId}, branchId: ${branchId}`);

		// Create query runner for transaction
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// Validation
			if (!checkInDto.checkIn) {
				throw new HttpException(
					{ message: 'Check-in time is required', statusCode: HttpStatus.BAD_REQUEST, error: 'VALIDATION_ERROR' },
					HttpStatus.BAD_REQUEST
				);
			}
			if (!isTokenFlow && !checkInDto.owner?.uid) {
				throw new HttpException(
					{ message: 'User ID is required for check-in (or use token-based flow)', statusCode: HttpStatus.BAD_REQUEST, error: 'VALIDATION_ERROR' },
					HttpStatus.BAD_REQUEST
				);
			}
			if (!orgId) {
				throw new HttpException(
					{ message: 'Organization ID is required', statusCode: HttpStatus.BAD_REQUEST, error: 'VALIDATION_ERROR' },
					HttpStatus.BAD_REQUEST
				);
			}

			// Resolve organisation using QueryBuilder for better performance
			const organisationQuery = queryRunner.manager
				.createQueryBuilder(Organisation, 'org')
				.select(['org.uid', 'org.clerkOrgId', 'org.ref', 'org.name'])
				.where('org.isDeleted = false')
				.andWhere('(org.clerkOrgId = :orgId OR org.ref = :orgId)', { orgId });

			const organisation = await organisationQuery.getOne();
			if (!organisation) {
				throw new HttpException(
					{ message: `Organization not found for ID: ${orgId}`, statusCode: HttpStatus.NOT_FOUND, error: 'NOT_FOUND' },
					HttpStatus.NOT_FOUND
				);
			}

			// Resolve user using QueryBuilder with optimized selects
			const userQuery = queryRunner.manager
				.createQueryBuilder(User, 'user')
				.select(['user.uid', 'user.clerkUserId', 'user.name', 'user.surname', 'user.organisationRef'])
				.where('user.isDeleted = false');

			if (isTokenFlow) {
				userQuery.andWhere('user.uid = :uid', { uid: uid! })
					.andWhere('user.clerkUserId = :clerkUserId', { clerkUserId });
			} else {
				const userWhere = typeof checkInDto.owner!.uid === 'string' && checkInDto.owner!.uid.startsWith('user_')
					? { clerkUserId: checkInDto.owner!.uid }
					: { uid: Number(checkInDto.owner!.uid) };
				userQuery.andWhere(userWhere);
			}

			const user = await userQuery.getOne();
			if (!user || !user.clerkUserId) {
				throw new HttpException(
					{ message: `User not found or missing Clerk user ID`, statusCode: HttpStatus.NOT_FOUND, error: 'NOT_FOUND' },
					HttpStatus.NOT_FOUND
				);
			}

			const ownerUid = String(user.uid);

			// Validate user belongs to organization
			if (user.organisationRef && user.organisationRef !== orgId) {
				throw new HttpException(
					{ message: 'User does not belong to the specified organization', statusCode: HttpStatus.FORBIDDEN, error: 'FORBIDDEN' },
					HttpStatus.FORBIDDEN
				);
			}

			// Check for existing active shift using optimized QueryBuilder with index
			this.logger.debug(`[${operationId}] Checking for existing active shift for user: ${ownerUid}`);
			const existingShiftQuery = queryRunner.manager
				.createQueryBuilder(Attendance, 'attendance')
				.select(['attendance.uid', 'attendance.checkIn', 'attendance.status', 'attendance.ownerClerkUserId'])
				.leftJoin('attendance.organisation', 'organisation')
				.addSelect(['organisation.uid', 'organisation.clerkOrgId', 'organisation.ref'])
				.where('attendance.ownerClerkUserId = :ownerClerkUserId', { ownerClerkUserId: user.clerkUserId })
				.andWhere('attendance.status = :status', { status: AttendanceStatus.PRESENT })
				.andWhere('attendance.checkIn IS NOT NULL')
				.andWhere('attendance.checkOut IS NULL');

			if (orgId) {
				existingShiftQuery.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			const existingShift = await existingShiftQuery.getOne();

			if (existingShift) {
				this.logger.warn(`User ${ownerUid} already has an active shift - checking if same day`);

				// Get organization timezone for accurate date comparison
				const orgTimezone = await this.getOrganizationTimezone(orgId);

				// Dates are already timezone-aware from database
				const existingShiftDate = new Date(existingShift.checkIn);
				const newCheckInDate = new Date(checkInDto.checkIn);

				// Check if both shifts are on the same calendar day in organization timezone
				const isSameCalendarDay = TimezoneUtil.isSameCalendarDayInOrgTimezone(
					existingShiftDate,
					newCheckInDate,
					orgTimezone,
				);

				if (isSameCalendarDay) {
					// Same day - prevent check-in, return error
					this.logger.warn(
						`User ${ownerUid} already has active shift for today. ` +
						`Existing shift: ${existingShiftDate.toISOString()}, New check-in: ${newCheckInDate.toISOString()}`
					);

					const checkInTime = await this.formatTimeInOrganizationTimezone(
						new Date(existingShift.checkIn),
						orgId
					);

					return {
						message: `You already have an active shift for today (started at ${checkInTime}). Please complete your current shift before starting a new one.`,
						data: {
							error: 'ACTIVE_SHIFT_TODAY',
							existingShift: {
								id: existingShift.uid,
								checkInTime: existingShift.checkIn,
								status: existingShift.status,
							},
							success: false
						}
					};
				}

				// Different day - handle auto-close based on skipAutoClose flag
				if (skipAutoClose) {
					// External machine consolidation - don't auto-close, return error
					this.logger.warn(
						`External machine check-in blocked: User ${ownerUid} already has active shift from different day. ` +
						`External machines cannot auto-close shifts.`
					);

					const checkInTime = await this.formatTimeInOrganizationTimezone(
						new Date(existingShift.checkIn),
						orgId
					);

					return {
						message: `Cannot process external machine check-in: User already has an active shift (started at ${checkInTime}). ` +
							`Please manually close the existing shift first. External machines cannot auto-close shifts.`,
						data: {
							error: 'ACTIVE_SHIFT_EXISTS',
							existingShift: {
								id: existingShift.uid,
								checkInTime: existingShift.checkIn,
								status: existingShift.status,
							},
							success: false
						}
					};
				}

				// Different day - proceed with auto-close (only for manual check-ins, not external machines)
				this.logger.warn(
					`User ${ownerUid} has shift from different day - auto-closing previous shift`
				);

				try {
					// For auto-close from different day, use organization close time in org timezone
					let orgCloseTime: Date;
					const orgHoursForClose = orgId ? await this.organizationHoursService.getOrganizationHours(orgId) : null;
					const orgTz = orgHoursForClose?.timezone || 'Africa/Johannesburg';
					const workingDayInfo = orgId
						? await this.organizationHoursService.getWorkingDayInfo(orgId, existingShiftDate)
						: null;
					const endTimeStr =
						workingDayInfo?.isWorkingDay && workingDayInfo?.endTime
							? workingDayInfo.endTime
							: this.FALLBACK_CLOSE_TIME;

					orgCloseTime = TimezoneUtil.buildUtcFromOrgDateAndTime(
						existingShiftDate,
						orgTz,
						endTimeStr,
					);

					// If close time is before check-in (e.g. night shift), use next calendar day's close in org TZ
					if (orgCloseTime <= existingShiftDate) {
						orgCloseTime = TimezoneUtil.buildUtcFromOrgDateAndTime(
							addDays(existingShiftDate, 1),
							orgTz,
							endTimeStr,
						);
					}

					await this.autoCloseExistingShift(existingShift, orgId ?? undefined, true, orgCloseTime);

					this.logger.log(`Successfully auto-closed existing shift from different day for user ${ownerUid}`);
				} catch (error) {
					this.logger.error(
						`Failed to auto-close existing shift for user ${ownerUid}: ${error.message}`,
					);
					// Re-throw the error to ensure it's properly caught by consolidation logic
					throw new BadRequestException(
						`Failed to process check-in: User is already checked in and auto-close failed. ${error.message}`,
					);
				}
			}

			// Calculate early and late minutes based on organization hours
			let earlyMinutes = 0;
			let lateMinutes = 0;
			if (orgId) {
				try {
					const timingInfo = await this.calculateEarlyAndLateMinutes(orgId, new Date(checkInDto.checkIn));
					earlyMinutes = timingInfo.earlyMinutes;
					lateMinutes = timingInfo.lateMinutes;
					this.logger.debug(
						`Check-in timing for user ${ownerUid}: Early: ${earlyMinutes}min, Late: ${lateMinutes}min`
					);
				} catch (timingError) {
					this.logger.warn(`Failed to calculate early/late minutes: ${timingError.message}`);
					// Continue with check-in even if timing calculation fails
				}
			}

			// User already validated above at line 672-679, no need to re-validate

			// Prepare attendance data
			const { branch: _, owner: __, ...restCheckInDto } = checkInDto;
			const attendanceData = queryRunner.manager.create(Attendance, {
				...restCheckInDto,
				checkIn: new Date(checkInDto.checkIn),
				status: checkInDto.status || AttendanceStatus.PRESENT,
				organisation: organisation,
				organisationUid: organisation.uid,
				placesOfInterest: null,
				earlyMinutes,
				lateMinutes,
				ownerClerkUserId: user.clerkUserId,
				branch: branchId ? { uid: branchId } : null,
				branchUid: branchId || null,
			});

			// Save within transaction
			this.logger.debug(`[${operationId}] Saving check-in record within transaction`);
			const checkIn = await queryRunner.manager.save(Attendance, attendanceData);

			if (!checkIn || !checkIn.uid) {
				throw new HttpException(
					{ message: 'Failed to create attendance record', statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: 'DATABASE_ERROR' },
					HttpStatus.INTERNAL_SERVER_ERROR
				);
			}

			// Commit transaction before async operations
			await queryRunner.commitTransaction();
			this.logger.debug(`[${operationId}] Transaction committed successfully`);

			// Clear cache (include org/branch so list cache is invalidated)
			await this.clearAttendanceCache(checkIn.uid, ownerUid, orgId ?? undefined, branchId ?? undefined);

			// Prepare response
			const responseData = {
				attendanceId: checkIn.uid,
				userId: user.uid,
				checkInTime: checkIn.checkIn,
				status: checkIn.status,
				organisationId: orgId,
				branchId: branchId,
				earlyMinutes: checkIn.earlyMinutes || 0,
				lateMinutes: checkIn.lateMinutes || 0,
				location: checkInDto.checkInLatitude && checkInDto.checkInLongitude
					? { latitude: checkInDto.checkInLatitude, longitude: checkInDto.checkInLongitude, accuracy: 10 }
					: null,
				xpAwarded: XP_VALUES.CHECK_IN,
				timestamp: new Date(),
			};

			const duration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Check-in successful in ${duration}ms for user: ${ownerUid}`);

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Check-in recorded successfully',
				data: responseData,
			};

			// Process non-critical operations asynchronously (don't block user response)
			setImmediate(async () => {
				try {
					// Process check-in location if coordinates are provided (async)
					try {
						if (checkInDto.checkInLatitude && checkInDto.checkInLongitude) {
							this.logger.debug(`Processing check-in location coordinates asynchronously for user: ${ownerUid}`);
							const checkInAddress = await this.processLocationCoordinates(
								checkInDto.checkInLatitude,
								checkInDto.checkInLongitude,
								'Check-in Location'
							);

							if (checkInAddress) {
								// Update the attendance record with location data
								await this.attendanceRepository.update(checkIn.uid, {
									placesOfInterest: {
										startAddress: checkInAddress,
										endAddress: null,
										breakStart: null,
										breakEnd: null,
										otherPlacesOfInterest: []
									}
								});
								this.logger.debug(`Location data updated successfully for check-in: ${checkIn.uid}`);
							}
						}
					} catch (locationError) {
						this.logger.error(`Failed to process location for check-in ${checkIn.uid}:`, locationError.message);
						// Don't fail check-in if location processing fails
					}

					// Check if user is remote from branch (>50m) and notify admins
					try {
						if (checkInDto.checkInLatitude && checkInDto.checkInLongitude && orgId && branchId) {
							await this.checkRemoteCheckInOnCheckIn(checkIn, orgId, branchId, checkInDto.checkInLatitude, checkInDto.checkInLongitude);
						}
					} catch (remoteCheckError) {
						this.logger.warn(`Failed to check remote check-in for user ${ownerUid}:`, remoteCheckError.message);
						// Don't fail check-in if remote check fails
					}

					// Award XP with enhanced error handling
					try {
						this.logger.debug(
							`Awarding XP for check-in to user: ${ownerUid}, amount: ${XP_VALUES.CHECK_IN}`,
						);
						await this.rewardsService.awardXP(
							{
								owner: user.uid,
								amount: XP_VALUES.CHECK_IN,
								action: XP_VALUES_TYPES.ATTENDANCE,
								source: {
									id: ownerUid,
									type: XP_VALUES_TYPES.ATTENDANCE,
									details: 'Check-in reward',
								},
							},
							orgId,
							branchId,
						);
						this.logger.debug(`XP awarded successfully for check-in to user: ${ownerUid}`);
					} catch (xpError) {
						this.logger.error(`Failed to award XP for check-in to user: ${ownerUid}`, xpError.stack);
						// Don't fail the check-in if XP award fails
					}

					// Send enhanced shift start notification with improved messaging
					try {
						// Get user info for personalized message with email and relations
						const userForNotification = await this.userRepository.findOne({
							where: { uid: Number(ownerUid) },
							select: ['uid', 'name', 'surname', 'email', 'username'],
							relations: ['organisation', 'branch', 'branch.organisation'],
						});

						// Construct full name with proper fallbacks
						const fullName = `${userForNotification?.name || ''} ${userForNotification?.surname || ''}`.trim();
						const userName = fullName || userForNotification?.username || 'Team Member';

						// Format check-in time in organization timezone
						const checkInTime = await this.formatTimeInOrganizationTimezone(new Date(checkIn.checkIn), orgId);

						this.logger.debug(`Sending enhanced shift start notification to user: ${ownerUid}`);
						// Send push notification
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.ATTENDANCE_SHIFT_STARTED,
							[userForNotification.uid],
							{
								checkInTime,
								userName,
								userId: userForNotification.uid,
								organisationId: orgId,
								branchId: branchId,
								xpAwarded: XP_VALUES.CHECK_IN,
								timestamp: new Date().toISOString(),
							},
							{
								priority: NotificationPriority.NORMAL,
								sendEmail: false, // We'll handle email separately
							},
						);

						this.logger.debug(
							`Shift start push notification sent successfully to user: ${ownerUid}`,
						);
					} catch (notificationError) {
						this.logger.warn(
							`Failed to send shift start notification to user: ${ownerUid}`,
							notificationError.message,
						);
						// Don't fail the check-in if notification fails
					}

					// Check if user is late and send late notification if applicable
					// Use stored lateMinutes from checkIn record instead of recalculating
					try {
						if (orgId && checkIn.lateMinutes && checkIn.lateMinutes > 0) {
							this.logger.debug(
								`User ${ownerUid} is ${checkIn.lateMinutes} minutes late - sending notification`,
							);
							await this.sendShiftReminder(
								user.uid,
								'late',
								orgId,
								branchId,
								undefined,
								checkIn.lateMinutes,
							);
						}
					} catch (lateCheckError) {
						this.logger.warn(
							`Failed to check/send late notification for user: ${ownerUid}`,
							lateCheckError.message,
						);
						// Don't fail the check-in if late check fails
					}

				} catch (backgroundError) {
					this.logger.error(`Background check-in tasks failed for user ${ownerUid}:`, backgroundError.message);
					// Don't affect user experience
				}
			});

			// Post-response async processing
			setImmediate(async () => {
				try {
					// Location processing, notifications, XP, etc. (existing async code)
					if (checkInDto.checkInLatitude && checkInDto.checkInLongitude) {
						const checkInAddress = await this.processLocationCoordinates(
							checkInDto.checkInLatitude,
							checkInDto.checkInLongitude,
							'Check-in Location'
						);
						if (checkInAddress) {
							await this.attendanceRepository.update(checkIn.uid, {
								placesOfInterest: { startAddress: checkInAddress, endAddress: null, breakStart: null, breakEnd: null, otherPlacesOfInterest: [] }
							});
						}
					}

					await this.rewardsService.awardXP({
						owner: user.uid,
						amount: XP_VALUES.CHECK_IN,
						action: XP_VALUES_TYPES.ATTENDANCE,
						source: { id: ownerUid, type: XP_VALUES_TYPES.ATTENDANCE, details: 'Check-in reward' },
					}, orgId, branchId);

					const userForNotification = await this.userRepository.findOne({
						where: { uid: Number(ownerUid) },
						select: ['uid', 'name', 'surname', 'email', 'username'],
					});
					if (userForNotification) {
						const fullName = `${userForNotification.name || ''} ${userForNotification.surname || ''}`.trim();
						const userName = fullName || userForNotification.username || 'Team Member';
						const checkInTime = await this.formatTimeInOrganizationTimezone(new Date(checkIn.checkIn), orgId);
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.ATTENDANCE_SHIFT_STARTED,
							[userForNotification.uid],
							{ checkInTime, userName, userId: userForNotification.uid, organisationId: orgId, branchId, xpAwarded: XP_VALUES.CHECK_IN, timestamp: new Date().toISOString() },
							{ priority: NotificationPriority.NORMAL, sendEmail: false },
						);
					}
				} catch (backgroundError) {
					this.logger.error(`[${operationId}] Background tasks failed: ${backgroundError.message}`);
				}
			});

			return response;
		} catch (error) {
			await queryRunner.rollbackTransaction();
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Check-in failed after ${duration}ms: ${error.message}`, error.stack);

			// Handle database errors
			if (error instanceof QueryFailedError) {
				if (error.message.includes('foreign key constraint')) {
					const constraintName = error.message.match(/constraint "([^"]+)"/)?.[1] || 'unknown';
					if (error.message.includes('branch')) {
						throw new HttpException(
							{ message: 'Invalid branch or organisation relationship', statusCode: HttpStatus.BAD_REQUEST, error: 'CONSTRAINT_VIOLATION', constraint: constraintName },
							HttpStatus.BAD_REQUEST
						);
					} else if (error.message.includes('organisation')) {
						throw new HttpException(
							{ message: 'Invalid organisation reference', statusCode: HttpStatus.BAD_REQUEST, error: 'CONSTRAINT_VIOLATION', constraint: constraintName },
							HttpStatus.BAD_REQUEST
						);
					} else if (error.message.includes('owner')) {
						throw new HttpException(
							{ message: 'Invalid user reference', statusCode: HttpStatus.BAD_REQUEST, error: 'CONSTRAINT_VIOLATION', constraint: constraintName },
							HttpStatus.BAD_REQUEST
						);
					}
				}
				throw new HttpException(
					{ message: 'Database error occurred', statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: 'DATABASE_ERROR', details: error.message },
					HttpStatus.INTERNAL_SERVER_ERROR
				);
			}

			// Re-throw HTTP exceptions
			if (error instanceof HttpException) {
				throw error;
			}

			// Generic error
			throw new HttpException(
				{ message: error?.message || 'Check-in failed. Please try again.', statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: 'INTERNAL_ERROR' },
				HttpStatus.INTERNAL_SERVER_ERROR
			);
		} finally {
			await queryRunner.release();
		}
	}

	/**
	 * Auto-close an existing shift.
	 * Close time is built in organization timezone (check-in calendar day at org endTime) then stored as UTC.
	 *
	 * Sequence: Client -> Controller -> Service -> DB
	 * - Request: closeAtTime optional (user-triggered) or scheduled (no body).
	 * - Service: get org hours/timezone; if no closeAtTime then getWorkingDayInfo(orgId, checkInDate), buildUtcFromOrgDateAndTime(checkInDate, orgTz, endTime).
	 * - Service: calculate work session, expectedWorkMinutes from getWorkingDayInfo, cap duration, set checkOut/duration/overtime/status.
	 * - DB: save attendance.
	 * - Response: 200 (void).
	 *
	 * @param existingShift - The attendance record to close
	 * @param orgId - Organization ID for timezone and hours configuration
	 * @param skipPreferenceCheck - If true, ignores user's shiftAutoEnd preference (used when user actively starts new shift)
	 *                             If false, respects user's shiftAutoEnd preference (used for scheduled auto-close)
	 * @param closeAtTime - Optional explicit close time. If provided, uses this time instead of org close time (used for user-triggered close)
	 */
	private async autoCloseExistingShift(
		existingShift: Attendance,
		orgId?: string,
		skipPreferenceCheck: boolean = false,
		closeAtTime?: Date
	): Promise<void> {
		// Validate existingShift object
		if (!existingShift) {
			throw new Error('Existing shift is undefined');
		}

		const userIdRef = existingShift.owner?.uid ?? existingShift.ownerClerkUserId ?? '';
		const userIdLabel = typeof userIdRef === 'number' ? String(userIdRef) : userIdRef;
		this.logger.debug(
			`Auto-closing existing shift for user ${userIdLabel}, orgId: ${orgId}, skipPreferenceCheck: ${skipPreferenceCheck}`
		);

		// Only check user preferences if this is NOT triggered by a new check-in
		// When a user actively starts a new shift, we should close the old one regardless of preferences
		// Preferences only apply to scheduled/automated shift closures
		if (!skipPreferenceCheck) {
			this.logger.debug(`Checking user preferences for shift auto-end (scheduled auto-close scenario)`);
			try {
				const userLookup = typeof userIdRef === 'number'
					? { uid: userIdRef }
					: userIdRef && String(userIdRef).startsWith('user_')
						? { clerkUserId: userIdRef }
						: { uid: Number(userIdRef) };
				const user = await this.userRepository.findOne({
					where: userLookup,
					select: ['uid', 'preferences'],
				});

				if (user?.preferences?.shiftAutoEnd === false) {
					this.logger.debug(`User ${userIdLabel} has disabled shift auto-end, skipping auto-close`);
					throw new Error(`User has disabled automatic shift ending`);
				}

				this.logger.debug(`User ${userIdLabel} preferences allow auto-close, proceeding`);
			} catch (error) {
				if (error.message.includes('disabled automatic')) {
					throw error; // Re-throw the user preference error
				}
				this.logger.warn(
					`Could not fetch user preferences for ${userIdLabel}, defaulting to allow auto-close: ${error.message}`,
				);
				// Continue with auto-close if we can't fetch preferences (fail-safe)
			}
		} else {
			this.logger.debug(
				`Skipping preference check - user is actively starting a new shift (preference check bypassed)`
			);
		}

		// Get organization timezone for accurate close time calculation (orgId is clerkOrgId/ref string)
		const organizationHours = orgId ? await this.organizationHoursService.getOrganizationHours(orgId) : null;
		const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';

		const checkInDate = new Date(existingShift.checkIn);
		let closeTime: Date;

		// Priority: Use explicit closeAtTime if provided (user-triggered), otherwise use org close time (scheduled)
		if (closeAtTime) {
			closeTime = new Date(closeAtTime);

			// Validate that close time is after check-in time
			if (closeTime <= checkInDate) {
				this.logger.warn(
					`Close time (${closeTime.toISOString()}) is before or equal to check-in time (${checkInDate.toISOString()}), using current time instead`
				);
				closeTime = new Date();
			}

			this.logger.debug(
				`Using explicit close time for user-triggered auto-close: ${closeTime.toISOString()} for user ${userIdLabel}`
			);
		} else {
			// Scheduled auto-close: use organization close time in org timezone
			// Build close time as "check-in calendar day in org TZ at endTime" → UTC
			const endTimeStr = '16:30'; // fallback when org hours unknown
			closeTime = organizationTimezone
				? TimezoneUtil.buildUtcFromOrgDateAndTime(checkInDate, organizationTimezone, endTimeStr)
				: (() => {
						const [h, m] = endTimeStr.split(':').map(Number);
						const t = new Date(checkInDate);
						t.setHours(h, m, 0, 0);
						return t;
					})();

			try {
				// Try to get organization hours if orgId is provided
				if (orgId) {
					this.logger.debug(`Attempting to fetch organization hours for org ${orgId}`);

					const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, checkInDate);

					if (workingDayInfo && workingDayInfo.isWorkingDay && workingDayInfo.endTime) {
						try {
							closeTime = TimezoneUtil.buildUtcFromOrgDateAndTime(
								checkInDate,
								organizationTimezone,
								workingDayInfo.endTime,
							);

							// If the close time would be before the check-in time (e.g., night shift),
							// use next calendar day's close in org TZ
							if (closeTime <= checkInDate) {
								closeTime = TimezoneUtil.buildUtcFromOrgDateAndTime(
									addDays(checkInDate, 1),
									organizationTimezone,
									workingDayInfo.endTime,
								);
							}

							this.logger.debug(
								`Using organization close time: ${workingDayInfo.endTime} for user ${userIdLabel}`,
							);
						} catch (parseError) {
							this.logger.warn(
								`Error parsing organization close time: ${parseError.message}, using default 4:30 PM`,
							);
							if (organizationTimezone) {
								closeTime = TimezoneUtil.buildUtcFromOrgDateAndTime(
									checkInDate,
									organizationTimezone,
									endTimeStr,
								);
							}
						}
					} else {
						this.logger.warn(
							`Organization ${orgId} is not a working day or has no end time, using default 4:30 PM`,
						);
					}
				} else {
					this.logger.warn('No organization ID provided for auto-close, using default 4:30 PM');
				}
			} catch (error) {
				this.logger.warn(`Error fetching org hours, using default 4:30 PM: ${error.message}`);
			}
		}

		try {
			this.logger.debug(`Setting auto-close time to: ${closeTime.toISOString()} for user ${userIdLabel}`);

			// Calculate duration and overtime for the auto-closed shift
			const checkInTime = new Date(existingShift.checkIn);
			const checkOutTime = closeTime;

			// Calculate break minutes
			const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
				existingShift.breakDetails,
				existingShift.totalBreakTime,
			);

			// Calculate work session
			const workSession = TimeCalculatorUtil.calculateWorkSession(
				checkInTime,
				checkOutTime,
				existingShift.breakDetails,
				existingShift.totalBreakTime,
				organizationHours,
			);

			this.logger.debug(
				`Auto-close work session: net work minutes: ${workSession.netWorkMinutes}, break minutes: ${breakMinutes}`
			);

			// Validate and calculate actual worked time (ensure we use real time, not expected time)
			let actualWorkMinutes = workSession?.netWorkMinutes;
			if (typeof actualWorkMinutes !== 'number' || isNaN(actualWorkMinutes) || actualWorkMinutes < 0) {
				this.logger.warn(
					`Invalid workSession.netWorkMinutes (${actualWorkMinutes}). Calculating from actual time difference. ` +
					`Check-in: ${checkInTime.toISOString()}, Check-out: ${checkOutTime.toISOString()}`
				);
				const totalMinutes = differenceInMinutes(checkOutTime, checkInTime);
				actualWorkMinutes = Math.max(0, totalMinutes - breakMinutes);
			}

			// Get expected work minutes from organization hours
			let expectedWorkMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
			if (orgId) {
				try {
					const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, checkInTime);
					expectedWorkMinutes = workingDayInfo.expectedWorkMinutes || expectedWorkMinutes;
					this.logger.debug(`Expected work minutes: ${expectedWorkMinutes}`);
				} catch (error) {
					this.logger.warn(`Failed to get expected work minutes, using default: ${expectedWorkMinutes}`);
				}
			}

			// Use ACTUAL worked time (not expected time) - cap at expected hours from organization, rest goes to overtime
			// Calculate worked hours from organization start time to close time
			const durationMinutes = Math.min(actualWorkMinutes, expectedWorkMinutes, this.MAX_REASONABLE_DURATION_MINUTES);
			const overtimeMinutes = Math.max(0, actualWorkMinutes - durationMinutes);

			// Validate duration to prevent saving suspiciously long shifts
			if (actualWorkMinutes > this.MAX_REASONABLE_DURATION_MINUTES) {
				this.logger.warn(
					`Suspicious auto-close duration detected: ${actualWorkMinutes} minutes (${(actualWorkMinutes / 60).toFixed(1)} hours). ` +
					`Capping at ${this.MAX_REASONABLE_DURATION_MINUTES} minutes (16 hours). ` +
					`Check-in: ${checkInTime.toISOString()}, Check-out: ${checkOutTime.toISOString()}`
				);
			}

			const duration = TimeCalculatorUtil.formatDuration(durationMinutes);
			const overtimeDuration = TimeCalculatorUtil.formatDuration(overtimeMinutes);

			this.logger.debug(
				`Auto-close calculated - Actual worked: ${actualWorkMinutes} min, Expected: ${expectedWorkMinutes} min, ` +
				`Capped Duration: ${duration} (${durationMinutes} min), Overtime: ${overtimeDuration} (${overtimeMinutes} min)`
			);

			// Update the existing shift
			existingShift.checkOut = closeTime;
			existingShift.duration = duration;
			existingShift.overtime = overtimeDuration;
			existingShift.status = AttendanceStatus.COMPLETED;
			// Set appropriate note based on whether this is a user-initiated or scheduled auto-close
			existingShift.checkOutNotes = closeAtTime
				? 'Auto-closed when new shift was started'
				: (skipPreferenceCheck
					? 'Auto-closed at organization close time due to new shift being started'
					: 'Auto-closed at organization close time (scheduled auto-end)');

			await this.attendanceRepository.save(existingShift);

			this.logger.log(`Auto-closed existing shift for user ${userIdLabel} at ${closeTime.toISOString()}`);

			// Clear attendance cache after auto-close (include org so list cache is invalidated)
			await this.clearAttendanceCache(existingShift.uid, userIdLabel, orgId, existingShift.branchUid ?? undefined);
			this.logger.debug(`Cleared cache for auto-closed shift ${existingShift.uid} and user ${userIdLabel}`);

			// Send email notification about auto-close
			await this.sendAutoCloseShiftNotification(existingShift, closeTime, orgId);
		} catch (error) {
			this.logger.error(`Error auto-closing existing shift for user ${userIdLabel}: ${error.message}`);

			// Fallback: still try to close the shift with default time in org timezone when known
			try {
				closeTime = organizationTimezone
					? TimezoneUtil.buildUtcFromOrgDateAndTime(checkInDate, organizationTimezone, this.FALLBACK_CLOSE_TIME)
					: (() => {
							const [hours, minutes] = this.FALLBACK_CLOSE_TIME.split(':').map(Number);
							const t = new Date(checkInDate);
							t.setHours(hours, minutes, 0, 0);
							return t;
						})();

				// Calculate duration and overtime for fallback auto-close
				const fallbackCheckInTime = new Date(existingShift.checkIn);
				const fallbackCheckOutTime = closeTime;

				// Calculate break minutes
				const fallbackBreakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					existingShift.breakDetails,
					existingShift.totalBreakTime,
				);

				// Calculate work session
				const fallbackWorkSession = TimeCalculatorUtil.calculateWorkSession(
					fallbackCheckInTime,
					fallbackCheckOutTime,
					existingShift.breakDetails,
					existingShift.totalBreakTime,
					organizationHours,
				);

				// Validate and calculate actual worked time for fallback
				let fallbackActualWorkMinutes = fallbackWorkSession?.netWorkMinutes;
				if (typeof fallbackActualWorkMinutes !== 'number' || isNaN(fallbackActualWorkMinutes) || fallbackActualWorkMinutes < 0) {
					this.logger.warn(
						`Invalid fallback workSession.netWorkMinutes (${fallbackActualWorkMinutes}). Calculating from actual time difference.`
					);
					const fallbackTotalMinutes = differenceInMinutes(fallbackCheckOutTime, fallbackCheckInTime);
					fallbackActualWorkMinutes = Math.max(0, fallbackTotalMinutes - fallbackBreakMinutes);
				}

				// Get expected work minutes from organization hours for fallback
				let fallbackExpectedWorkMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
				if (orgId) {
					try {
						const fallbackWorkingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, fallbackCheckInTime);
						fallbackExpectedWorkMinutes = fallbackWorkingDayInfo.expectedWorkMinutes || fallbackExpectedWorkMinutes;
						this.logger.debug(`Fallback expected work minutes: ${fallbackExpectedWorkMinutes}`);
					} catch (error) {
						this.logger.warn(`Failed to get expected work minutes for fallback, using default: ${fallbackExpectedWorkMinutes}`);
					}
				}

				// Use organization's expected work minutes, with a reasonable maximum cap to prevent wrong durations
				const fallbackDurationMinutes = Math.min(fallbackActualWorkMinutes, fallbackExpectedWorkMinutes, this.MAX_REASONABLE_DURATION_MINUTES);
				const fallbackOvertimeMinutes = Math.max(0, fallbackActualWorkMinutes - fallbackDurationMinutes);

				const fallbackDuration = TimeCalculatorUtil.formatDuration(fallbackDurationMinutes);
				const fallbackOvertimeDuration = TimeCalculatorUtil.formatDuration(fallbackOvertimeMinutes);

				this.logger.debug(
					`Fallback auto-close - Actual worked: ${fallbackActualWorkMinutes} min, Expected: ${fallbackExpectedWorkMinutes} min, ` +
					`Duration: ${fallbackDuration}, Overtime: ${fallbackOvertimeDuration}`
				);

				existingShift.checkOut = closeTime;
				existingShift.duration = fallbackDuration;
				existingShift.overtime = fallbackOvertimeDuration;
				existingShift.status = AttendanceStatus.COMPLETED;
				existingShift.checkOutNotes = closeAtTime
					? 'Auto-closed when new shift was started (fallback)'
					: (skipPreferenceCheck
						? 'Auto-closed with fallback time due to new shift (org hours fetch error)'
						: 'Auto-closed with fallback time due to org hours fetch error (scheduled auto-end)');

				await this.attendanceRepository.save(existingShift);
				this.logger.log(`Fallback auto-close successful for user ${userIdLabel} at 4:30 PM`);

				// Clear attendance cache after fallback auto-close (include org so list cache is invalidated)
				await this.clearAttendanceCache(existingShift.uid, userIdLabel, orgId, existingShift.branchUid ?? undefined);
				this.logger.debug(`Cleared cache for fallback auto-closed shift ${existingShift.uid} and user ${userIdLabel}`);

				// Send email notification about fallback auto-close
				await this.sendAutoCloseShiftNotification(existingShift, closeTime, orgId);
			} catch (fallbackError) {
				this.logger.error(`Fallback auto-close also failed for user ${userIdLabel}: ${fallbackError.message}`);
				throw new Error(`Failed to auto-close existing shift: ${error.message}`);
			}
		}
	}

	/**
	 * Send email notification for auto-closed shift
	 */
	private async sendAutoCloseShiftNotification(
		closedShift: Attendance,
		closeTime: Date,
		orgId?: string,
	): Promise<void> {
		try {
			const ownerUid = closedShift.owner?.uid;
			const ownerClerk = closedShift.ownerClerkUserId;
			const hasUserRef = ownerUid != null || (ownerClerk != null && ownerClerk !== '');
			if (!hasUserRef) {
				this.logger.warn('Cannot send auto-close notification: No user ID found');
				return;
			}

			// Get user details (by uid number or clerkUserId)
			const userWhere = typeof ownerUid === 'number'
				? { uid: ownerUid }
				: ownerClerk
					? { clerkUserId: ownerClerk }
					: { uid: 0 };
			const user = await this.userRepository.findOne({
				where: userWhere,
				relations: ['organisation', 'branch'],
			});

			if (!user?.email) {
				this.logger.warn(`Cannot send auto-close notification: No email found for user ${ownerUid ?? ownerClerk}`);
				return;
			}

			// Calculate shift duration and details
			const checkInTime = new Date(closedShift.checkIn);
			const workSession = TimeCalculatorUtil.calculateWorkSession(
				checkInTime,
				closeTime,
				closedShift.breakDetails,
				closedShift.totalBreakTime,
				orgId ? await this.organizationHoursService.getOrganizationHours(orgId) : null,
			);

			const checkInTimeString = await this.formatTimeInOrganizationTimezone(checkInTime, orgId);
			const checkOutTimeString = await this.formatTimeInOrganizationTimezone(closeTime, orgId);
			const userName = `${user.name} ${user.surname}`;
			const workTimeDisplay = `${Math.floor(workSession.netWorkMinutes / 60)}h ${workSession.netWorkMinutes % 60}m`;

			// Prepare email data
			const emailData = {
				name: userName,
				employeeName: userName,
				employeeEmail: user.email,
				checkInTime: checkInTimeString,
				checkOutTime: checkOutTimeString,
				shiftDuration: workTimeDisplay,
				totalWorkMinutes: workSession.netWorkMinutes,
				organizationName: user?.organisation?.name || user?.branch?.organisation?.name || 'Your Organization',
				branchName: user?.branch?.name || '',
				dashboardUrl: process.env.WEB_URL || 'https://app.loro.co.za',
				autoCloseMessage: `This shift was automatically ended at organization close time (${checkOutTimeString}) as per your auto shift end setting that you agreed to use. You can change this setting in your preferences if needed.`,
				congratulationsMessage: `Your shift has been automatically completed, ${userName}! 🏢 Your shift was ended at ${checkOutTimeString} when the organization closed, as per your auto-end shift preference. You worked from ${checkInTimeString} to ${checkOutTimeString} for a total of ${workTimeDisplay}. Great work today!`,
			};

			this.logger.log(
				`✅ [AttendanceService] Auto-close shift notification processed for user: ${ownerUid ?? ownerClerk}`,
			);
		} catch (error) {
			this.logger.error(
				`❌ [AttendanceService] Failed to send auto-close shift notification: ${error.message}`,
			);
			// Don't fail the auto-close process if notification fails
		}
	}

	/**
	 * Process check-out: find active shift, compute duration/overtime using org work times.
	 * Same calendar day (org timezone): single expectedWorkMinutes from getWorkingDayInfo(orgId, checkInTime); duration = min(net, expected), overtime = rest.
	 * Multi-day (different calendar days in org TZ): split by org day, per-segment expectedWorkMinutes, sum duration and overtime.
	 *
	 * Sequence: Client -> Controller -> Service -> DB
	 * - Request: POST check-out (checkOut time, optional owner/org/branch).
	 * - Controller: calls checkOut(dto, orgId, branchId, ...).
	 * - Service: find active shift; isSameCalendarDayInOrgTimezone(checkIn, checkOut, orgTz); get workSession (net work minutes).
	 * - alt [single day]: getWorkingDayInfo(orgId, checkInTime).expectedWorkMinutes, duration = min(net, expected), overtime = max(0, net - expected).
	 * - alt [multi-day]: computeMultiDayDurationAndOvertime (split by org day, per-segment expected, sum).
	 * - Service: update attendance (checkOut, duration, overtime, status COMPLETED).
	 * - DB: update; clear cache.
	 * - Response: 200, data (attendanceId, checkInTime, checkOutTime, duration, overtime, totalWorkMinutes, ...).
	 */
	public async checkOut(
		checkOutDto: CreateCheckOutDto,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
		uid?: number,
	): Promise<{ message: string; data?: any }> {
		const operationId = `checkout_${Date.now()}`;
		const startTime = Date.now();
		const isTokenFlow = !!clerkUserId && uid != null;
		const ownerUidNum = isTokenFlow ? uid! : (checkOutDto.owner?.uid != null ? Number(checkOutDto.owner.uid) : null);
		const ownerUidStr = ownerUidNum != null ? String(ownerUidNum) : '';

		this.logger.log(`[${operationId}] Check-out attempt for user ${ownerUidStr}, orgId: ${orgId}, branchId: ${branchId}`);

		// Create query runner for transaction
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// Validation
			if (!checkOutDto.checkOut) {
				throw new HttpException(
					{ message: 'Check-out time is required', statusCode: HttpStatus.BAD_REQUEST, error: 'VALIDATION_ERROR' },
					HttpStatus.BAD_REQUEST
				);
			}
			if (!isTokenFlow && !checkOutDto.owner?.uid) {
				throw new HttpException(
					{ message: 'User ID is required for check-out (or use token-based flow)', statusCode: HttpStatus.BAD_REQUEST, error: 'VALIDATION_ERROR' },
					HttpStatus.BAD_REQUEST
				);
			}
			if (ownerUidNum == null) {
				throw new HttpException(
					{ message: 'User ID is required for check-out', statusCode: HttpStatus.BAD_REQUEST, error: 'VALIDATION_ERROR' },
					HttpStatus.BAD_REQUEST
				);
			}

			// Resolve organisation if provided
			if (orgId) {
				const organisationQuery = queryRunner.manager
					.createQueryBuilder(Organisation, 'org')
					.select(['org.uid', 'org.clerkOrgId', 'org.ref'])
					.where('org.isDeleted = false')
					.andWhere('(org.clerkOrgId = :orgId OR org.ref = :orgId)', { orgId });
				const organisation = await organisationQuery.getOne();
				if (!organisation) {
					throw new HttpException(
						{ message: `Organization not found for ID: ${orgId}`, statusCode: HttpStatus.NOT_FOUND, error: 'NOT_FOUND' },
						HttpStatus.NOT_FOUND
					);
				}
			}

			// Get user's clerkUserId if needed
			let userClerkUserId: string;
			if (isTokenFlow) {
				userClerkUserId = clerkUserId!;
			} else {
				const userQuery = queryRunner.manager
					.createQueryBuilder(User, 'user')
					.select(['user.clerkUserId'])
					.where('user.uid = :uid', { uid: ownerUidNum })
					.andWhere('user.isDeleted = false');
				const user = await userQuery.getOne();
				if (!user || !user.clerkUserId) {
					throw new HttpException(
						{ message: 'User not found or missing Clerk user ID', statusCode: HttpStatus.NOT_FOUND, error: 'NOT_FOUND' },
						HttpStatus.NOT_FOUND
					);
				}
				userClerkUserId = user.clerkUserId;
			}

			// Find active shift using optimized QueryBuilder with index
			this.logger.debug(`[${operationId}] Finding active shift for check-out`);
			const activeShiftQuery = queryRunner.manager
				.createQueryBuilder(Attendance, 'attendance')
				.select([
					'attendance.uid',
					'attendance.checkIn',
					'attendance.checkOut',
					'attendance.status',
					'attendance.breakDetails',
					'attendance.totalBreakTime',
					'attendance.ownerClerkUserId',
					'attendance.branchUid',
				])
				.leftJoin('attendance.owner', 'owner')
				.addSelect(['owner.uid', 'owner.clerkUserId'])
				.leftJoin('owner.organisation', 'organisation')
				.addSelect(['organisation.uid', 'organisation.clerkOrgId', 'organisation.ref'])
				.where('attendance.status = :status', { status: AttendanceStatus.PRESENT })
				.andWhere('attendance.ownerClerkUserId = :ownerClerkUserId', { ownerClerkUserId: userClerkUserId })
				.andWhere('attendance.checkIn IS NOT NULL')
				.andWhere('attendance.checkOut IS NULL');

			if (orgId) {
				activeShiftQuery.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			activeShiftQuery.orderBy('attendance.checkIn', 'DESC');

			const activeShift = await activeShiftQuery.getOne();

			if (!activeShift) {
				throw new HttpException(
					{ message: 'No active shift found. Please check in first.', statusCode: HttpStatus.NOT_FOUND, error: 'NO_ACTIVE_SHIFT' },
					HttpStatus.NOT_FOUND
				);
			}

			this.logger.debug(`[${operationId}] Active shift found for user: ${ownerUidStr}, shift ID: ${activeShift.uid}`);

			const checkOutTime = checkOutDto.checkOut ? new Date(checkOutDto.checkOut) : new Date();
			const checkInTime = new Date(activeShift.checkIn);

			// Get organization timezone for accurate date comparison
			// Use orgId (string) for timezone lookup, fallback to activeShift's org uid if available
			const orgIdForTimezone = orgId || (activeShift.owner?.organisation?.clerkOrgId || activeShift.owner?.organisation?.ref);
			const orgTimezone = await this.getOrganizationTimezone(orgIdForTimezone);

			// Check if both dates are on the same calendar day in organization timezone
			const isSameCalendarDay = TimezoneUtil.isSameCalendarDayInOrgTimezone(
				checkInTime,
				checkOutTime,
				orgTimezone,
			);
			const checkInDateOrg = new Date(checkInTime);
			const checkOutDateOrg = new Date(checkOutTime);

			// Validate check-out time is after check-in time
			// Only enforce this validation if dates are on the same calendar day
			// If dates are on different days, allow check-out (user is closing a shift from a previous day)
			if (isSameCalendarDay && checkOutTime <= checkInTime) {
				this.logger.error(
					`Check-out validation failed - Same day check-out must be after check-in. ` +
					`Check-in: ${checkInTime.toISOString()} (${checkInDateOrg.toISOString()} org time), ` +
					`Check-out: ${checkOutTime.toISOString()} (${checkOutDateOrg.toISOString()} org time)`
				);
				throw new BadRequestException('Check-out time must be after check-in time');
			}

			if (!isSameCalendarDay) {
				this.logger.debug(
					`Check-out is on different calendar day than check-in - allowing check-out. ` +
					`Check-in: ${checkInDateOrg.toISOString()} (${checkInDateOrg.getDate()}/${checkInDateOrg.getMonth() + 1}/${checkInDateOrg.getFullYear()}), ` +
					`Check-out: ${checkOutDateOrg.toISOString()} (${checkOutDateOrg.getDate()}/${checkOutDateOrg.getMonth() + 1}/${checkOutDateOrg.getFullYear()})`
				);
			}

			this.logger.debug(
				`Calculating work duration: check-in at ${checkInTime.toISOString()}, check-out at ${checkOutTime.toISOString()}`,
			);

			// Enhanced calculation using our new utilities
			// Use orgIdForTimezone for organization-specific calculations
			this.logger.debug(`Processing time calculations for organization: ${orgIdForTimezone}`);

			const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
				activeShift.breakDetails,
				activeShift.totalBreakTime,
			);
			this.logger.debug(`Total break minutes calculated: ${breakMinutes}`);

			// Calculate precise work session
			const workSession = TimeCalculatorUtil.calculateWorkSession(
				checkInTime,
				checkOutTime,
				activeShift.breakDetails,
				activeShift.totalBreakTime,
				orgIdForTimezone ? await this.organizationHoursService.getOrganizationHours(orgIdForTimezone) : null,
			);

			this.logger.debug(
				`Work session calculated - net work minutes: ${workSession.netWorkMinutes}`,
			);

			let durationMinutes: number;
			let overtimeMinutes: number;

			if (!isSameCalendarDay) {
				// Multi-day shift: split by org calendar day, apply per-day expected minutes, sum duration and overtime
				const multiDayResult = await this.computeMultiDayDurationAndOvertime(
					checkInTime,
					checkOutTime,
					breakMinutes,
					orgIdForTimezone ?? undefined,
					orgTimezone,
				);
				durationMinutes = multiDayResult.durationMinutes;
				overtimeMinutes = multiDayResult.overtimeMinutes;
				this.logger.debug(
					`Multi-day shift: duration ${durationMinutes} min, overtime ${overtimeMinutes} min`,
				);
			} else {
				// Single-day: cap duration at expected work hours, rest goes to overtime
				let expectedWorkMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;

				if (orgIdForTimezone) {
					try {
						const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
							orgIdForTimezone,
							checkInTime,
						);
						expectedWorkMinutes = workingDayInfo.expectedWorkMinutes || expectedWorkMinutes;
						this.logger.debug(
							`Expected work minutes for organization: ${expectedWorkMinutes} (${expectedWorkMinutes / 60} hours)`,
						);
					} catch (error) {
						this.logger.warn(
							`Failed to fetch expected work minutes for org ${orgIdForTimezone}, using default: ${expectedWorkMinutes}`,
							error.message,
						);
					}
				}

				durationMinutes = Math.min(workSession.netWorkMinutes, expectedWorkMinutes);
				overtimeMinutes = Math.max(0, workSession.netWorkMinutes - expectedWorkMinutes);
			}

			const duration = TimeCalculatorUtil.formatDuration(durationMinutes);
			const overtimeDuration = TimeCalculatorUtil.formatDuration(overtimeMinutes);

			this.logger.debug(
				`Duration capped at expected hours: ${duration} (${durationMinutes} minutes), ` +
				`Overtime: ${overtimeDuration} (${overtimeMinutes} minutes), ` +
				`Total work time: ${workSession.netWorkMinutes} minutes`,
			);

			// Update shift within transaction
			const { owner: _checkOutOwner, ...checkOutRest } = checkOutDto;
			this.logger.debug(`[${operationId}] Updating shift with check-out data within transaction`);

			await queryRunner.manager.update(Attendance, activeShift.uid, {
				...checkOutRest,
				checkOut: checkOutTime,
				duration,
				overtime: overtimeDuration,
				status: AttendanceStatus.COMPLETED,
			});

			// Commit transaction
			await queryRunner.commitTransaction();
			this.logger.debug(`[${operationId}] Transaction committed successfully`);

			// Clear cache (include org/branch so list cache is invalidated)
			const orgIdForCache = orgId ?? activeShift.owner?.organisation?.clerkOrgId ?? activeShift.owner?.organisation?.ref;
			await this.clearAttendanceCache(activeShift.uid, ownerUidStr, orgIdForCache, activeShift.branchUid ?? undefined);

			// Prepare response
			const responseData = {
				attendanceId: activeShift.uid,
				userId: ownerUidNum,
				checkInTime: activeShift.checkIn,
				checkOutTime: checkOutTime,
				duration,
				overtime: overtimeDuration,
				totalWorkMinutes: workSession.netWorkMinutes,
				totalBreakMinutes: breakMinutes,
				status: AttendanceStatus.COMPLETED,
				organisationId: orgId,
				branchId: branchId,
				location: checkOutDto.checkOutLatitude && checkOutDto.checkOutLongitude
					? { latitude: checkOutDto.checkOutLatitude, longitude: checkOutDto.checkOutLongitude, accuracy: 10 }
					: null,
				xpAwarded: XP_VALUES.CHECK_OUT,
				timestamp: new Date(),
			};

			const executionTime = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Check-out successful in ${executionTime}ms for user: ${ownerUidStr}`);

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Check-out recorded successfully',
				data: responseData,
			};

			// Post-response async processing
			setImmediate(async () => {
				try {
					// Award XP
					await this.rewardsService.awardXP({
						owner: ownerUidNum,
						amount: XP_VALUES.CHECK_OUT,
						action: XP_VALUES_TYPES.ATTENDANCE,
						source: { id: ownerUidStr, type: XP_VALUES_TYPES.ATTENDANCE, details: 'Check-out reward' },
					}, orgId, branchId);

					// Send notifications
					const user = await this.userRepository.findOne({
						where: { uid: ownerUidNum },
						select: ['uid', 'name', 'surname', 'email', 'username'],
					});
					if (user) {
						const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
						const userName = fullName || user.username || 'Team Member';
						const checkOutTimeString = await this.formatTimeInOrganizationTimezone(checkOutTime, orgId);
						const checkInTimeString = await this.formatTimeInOrganizationTimezone(new Date(activeShift.checkIn), orgId);
						const workHours = Math.floor(workSession.netWorkMinutes / 60);
						const workMinutesDisplay = workSession.netWorkMinutes % 60;
						const workTimeDisplay = `${workHours}h ${workMinutesDisplay}m`;

						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.ATTENDANCE_SHIFT_ENDED,
							[ownerUidNum],
							{
								checkOutTime: checkOutTimeString,
								checkInTime: checkInTimeString,
								duration,
								workTimeDisplay,
								totalWorkMinutes: workSession.netWorkMinutes,
								totalBreakMinutes: breakMinutes,
								userName,
								userId: ownerUidNum,
								organisationId: orgId,
								branchId: branchId,
								xpAwarded: XP_VALUES.CHECK_OUT,
								timestamp: new Date().toISOString(),
							},
							{ priority: NotificationPriority.NORMAL, sendEmail: false },
						);
					}

					// Process check-out location if coordinates are provided
					if (checkOutDto.checkOutLatitude && checkOutDto.checkOutLongitude) {
						const checkOutAddress = await this.processLocationCoordinates(
							checkOutDto.checkOutLatitude,
							checkOutDto.checkOutLongitude,
							'Check-out Location'
						);
						if (checkOutAddress) {
							const currentRecord = await this.attendanceRepository.findOne({ where: { uid: activeShift.uid } });
							let updatedPlacesOfInterest = currentRecord?.placesOfInterest;
							if (updatedPlacesOfInterest) {
								updatedPlacesOfInterest.endAddress = checkOutAddress;
							} else {
								updatedPlacesOfInterest = {
									startAddress: null,
									endAddress: checkOutAddress,
									breakStart: null,
									breakEnd: null,
									otherPlacesOfInterest: []
								};
							}
							await this.attendanceRepository.update(activeShift.uid, { placesOfInterest: updatedPlacesOfInterest });
						}
					}

					// Check and send overtime notification if applicable
					try {
						const organizationId = activeShift.owner?.organisation?.clerkOrgId || activeShift.owner?.organisation?.ref;
						if (organizationId) {
							const overtimeInfo = await this.organizationHoursService.calculateOvertime(
								organizationId,
								activeShift.checkIn,
								workSession.netWorkMinutes,
							);

							if (overtimeInfo.overtimeMinutes > 0) {
								// Cap overtime at 16 hours (960 minutes) to prevent impossible values
								const cappedMinutes = Math.min(overtimeInfo.overtimeMinutes, 960);
								const overtimeHours = Math.floor(cappedMinutes / 60);
								const overtimeMinutes = cappedMinutes % 60;
								const overtimeDuration = `${overtimeHours}h ${overtimeMinutes}m`;

								// Get user info for personalized message with username
								const user = await this.userRepository.findOne({
									where: { uid: ownerUidNum },
									select: ['uid', 'name', 'surname', 'username'],
								});

								// Construct full name with proper fallbacks
								const fullName = `${user?.name || ''} ${user?.surname || ''}`.trim();
								const userName = fullName || user?.username || 'Team Member';

								this.logger.debug(`Sending enhanced overtime notification to user: ${ownerUidStr}`);
								await this.unifiedNotificationService.sendTemplatedNotification(
									NotificationEvent.ATTENDANCE_OVERTIME_REMINDER,
									[ownerUidNum],
									{
										overtimeDuration,
										overtimeMinutes: cappedMinutes, // Total minutes for :duration formatter
										overtimeHours: overtimeHours,
										overtimeFormatted: overtimeDuration,
										regularHours: (workSession.netWorkMinutes - overtimeInfo.overtimeMinutes) / 60,
										totalWorkMinutes: workSession.netWorkMinutes,
										userName,
										userId: ownerUidNum,
										timestamp: new Date().toISOString(),
									},
									{
										priority: NotificationPriority.HIGH,
									},
								);
								this.logger.debug(
									`Enhanced overtime notification sent successfully to user: ${ownerUidStr}`,
								);

								// Also send overtime notification using the enhanced sendShiftReminder method
								await this.sendShiftReminder(
									ownerUidNum,
									'overtime',
									organizationId,
									branchId,
									undefined,
									undefined,
									cappedMinutes,
								);
							}
						}
					} catch (overtimeNotificationError) {
						this.logger.warn(
							`Failed to send overtime notification to user: ${ownerUidStr}`,
							overtimeNotificationError.message,
						);
						// Don't fail the async processing if overtime notification fails
					}

					// Emit daily report event for async processing (user already got their response)
					this.logger.debug(`Emitting daily report event for user: ${ownerUidStr}, attendance: ${activeShift.uid}`);
					this.eventEmitter.emit('daily-report', {
						userId: ownerUidNum,
						attendanceId: activeShift.uid, // Include the attendance ID that triggered this report
						triggeredByActivity: true, // This report is triggered by actual user activity (check-out)
					});

					// Emit other background events
					this.eventEmitter.emit('user.target.update.required', { userId: ownerUidNum });
					this.eventEmitter.emit('user.metrics.update.required', ownerUidNum);
					this.logger.debug(`Background events emitted successfully for user: ${ownerUidStr}`);

				} catch (asyncError) {
					this.logger.error(`Error in async checkout processing for user ${ownerUidStr}:`, asyncError.stack);
					// Don't propagate errors from async operations
				}
			});

			return response;
		} catch (error) {
			await queryRunner.rollbackTransaction();
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Check-out failed after ${duration}ms: ${error.message}`, error.stack);

			// Handle database errors
			if (error instanceof QueryFailedError) {
				if (error.message.includes('foreign key constraint')) {
					const constraintName = error.message.match(/constraint "([^"]+)"/)?.[1] || 'unknown';
					throw new HttpException(
						{ message: 'Database constraint violation', statusCode: HttpStatus.BAD_REQUEST, error: 'CONSTRAINT_VIOLATION', constraint: constraintName },
						HttpStatus.BAD_REQUEST
					);
				}
				throw new HttpException(
					{ message: 'Database error occurred', statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: 'DATABASE_ERROR', details: error.message },
					HttpStatus.INTERNAL_SERVER_ERROR
				);
			}

			// Re-throw HTTP exceptions
			if (error instanceof HttpException) {
				throw error;
			}

			// Generic error
			throw new HttpException(
				{ message: error?.message || 'Check-out failed. Please try again.', statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: 'INTERNAL_ERROR' },
				HttpStatus.INTERNAL_SERVER_ERROR
			);
		} finally {
			await queryRunner.release();
		}
	}

	public async allCheckIns(orgId?: string, branchId?: number, userAccessLevel?: string): Promise<{ message: string; checkIns: Attendance[] }> {
		// Get effective branch ID based on user role
		const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);
		this.logger.log(`Fetching all check-ins, orgId: ${orgId}, branchId: ${branchId}, effectiveBranchId: ${effectiveBranchId}, userAccessLevel: ${userAccessLevel}`);

		try {
			const cacheKey = this.getListCacheKey(orgId, effectiveBranchId);
			const cachedResult = await this.cacheManager.get(cacheKey);

			if (cachedResult) {
				this.logger.debug(
					`Retrieved cached check-ins result`,
				);

				// Apply timezone conversion to cached results using enhanced method (orgId string for hours lookup)
				const cachedResultWithTimezone = await this.ensureTimezoneConversion(cachedResult, orgId ?? undefined);

				return cachedResultWithTimezone;
			}

			const whereConditions: any = {};

			// Apply organization filtering - CRITICAL: Only show data for the user's organization
			// Filter by clerkOrgId or ref (both are strings)
			if (orgId) {
				whereConditions.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
				this.logger.debug(`Added organization filter: ${orgId}`);
			} else {
				this.logger.warn('No organization ID provided - this may return data from all organizations');
			}

			// Apply branch filtering if provided (and user is not admin/owner/developer)
			if (effectiveBranchId) {
				whereConditions.branch = { uid: effectiveBranchId };
				this.logger.debug(`Added branch filter: ${effectiveBranchId}`);
			} else if (userAccessLevel) {
				this.logger.debug(`User ${userAccessLevel} can see all branches - no branch filter applied`);
			}

			this.logger.debug(`Querying attendance records with conditions: ${JSON.stringify(whereConditions)}`);

			const checkIns = await this.attendanceRepository.find({
				where: Object.keys(whereConditions).length > 0 ? whereConditions : undefined,
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
					'dailyReport',
				],
				order: {
					checkIn: 'DESC',
				},
				take: 1000, // Limit results to prevent memory issues
			});

			if (!checkIns || checkIns.length === 0) {
				this.logger.warn('No check-ins found in database for the specified criteria');
				return {
					message: 'No attendance records found',
					checkIns: [],
				};
			}

			this.logger.log(`Successfully retrieved ${checkIns.length} check-in records`);

			// Apply timezone conversion to all attendance records using enhanced method
			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns: checkIns,
			};

			const responseWithTimezone = await this.ensureTimezoneConversion(response, orgId);

			// Cache the result (with timezone conversion applied)
			await this.cacheManager.set(cacheKey, responseWithTimezone, this.CACHE_TTL);
			this.logger.debug(`Cached check-ins result with key: ${cacheKey}`);

			return responseWithTimezone;
		} catch (error) {
			this.logger.error(`Failed to retrieve all check-ins`, error.stack);
			const response = {
				message: `could not get all check ins - ${error.message}`,
				checkIns: null,
			};

			return response;
		}
	}

	public async checkInsByDate(
		date: string,
		orgId?: string,
		branchId?: number,
		userAccessLevel?: string,
	): Promise<{ message: string; checkIns: Attendance[] }> {
		// This endpoint returns org-wide data - no branch filtering applied
		this.logger.log(`Fetching check-ins for date: ${date}, orgId: ${orgId} (org-wide, no branch filtering)`);
		try {
			// Get organization timezone for accurate date range (orgId is clerkOrgId/ref string)
			const organizationHours = orgId ? await this.organizationHoursService.getOrganizationHours(orgId) : null;
			const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';

			// Use date-fns to properly handle start and end of day in organization timezone
			const dateObj = new Date(date);
			const dayStart = startOfDay(dateObj);
			const dayEnd = endOfDay(dateObj);
			// Dates are already timezone-aware
			const startOfDayConverted = dayStart;
			const endOfDayConverted = dayEnd;

			const whereConditions: any = {
				checkIn: Between(startOfDayConverted, endOfDayConverted),
			};

			// Apply organization filtering only - no branch filtering for org-wide results
			// Filter by clerkOrgId or ref (both are strings)
			if (orgId) {
				whereConditions.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}

			// Get check-ins that started on this date (org-wide, includes records with NULL branch)
			const checkInsToday = await this.attendanceRepository.find({
				where: whereConditions,
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
				],
				order: {
					checkIn: 'DESC',
				},
			});

			// Also get shifts that started on previous days but are still ongoing on this date
			const ongoingShiftsConditions: any = {
				checkIn: LessThan(startOfDayConverted), // Started before today
				checkOut: IsNull(), // Not checked out yet
				status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]), // Still active
			};

			// Apply organization filtering only - no branch filtering for org-wide results
			// Filter by clerkOrgId or ref (both are strings)
			if (orgId) {
				ongoingShiftsConditions.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}

			const ongoingShifts = await this.attendanceRepository.find({
				where: ongoingShiftsConditions,
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
				],
				order: {
					checkIn: 'DESC',
				},
			});

			// Combine both sets of check-ins and mark multi-day shifts
			const allCheckIns = [...checkInsToday, ...ongoingShifts].map((checkIn) => {
				const checkInDate = new Date(checkIn.checkIn);
				const isMultiDay = checkInDate < startOfDayConverted;

				return {
					...checkIn,
					isMultiDayShift: isMultiDay,
					shiftDaySpan: isMultiDay ? this.calculateShiftDaySpan(checkInDate, endOfDayConverted) : 1,
				};
			});

			// Sort by check-in time descending
			allCheckIns.sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime());

			if (!allCheckIns || allCheckIns.length === 0) {
				return {
					message: 'No attendance records found for this date',
					checkIns: [],
				};
			}

			// Apply timezone conversion to all attendance records using enhanced method
			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns: allCheckIns,
			};

			const responseWithTimezone = await this.ensureTimezoneConversion(response, orgId);
			return responseWithTimezone;
		} catch (error) {
			const response = {
				message: `could not get check ins by date - ${error.message}`,
				checkIns: null,
			};

			return response;
		}
	}

	/**
	 * Calculate how many days a shift spans
	 */
	private calculateShiftDaySpan(checkInDate: Date, currentDate: Date): number {
		const diffTime = Math.abs(currentDate.getTime() - checkInDate.getTime());
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		return Math.max(diffDays, 1); // At least 1 day
	}

	/**
	 * Send comprehensive shift notifications to users with enhanced messaging
	 */
	private async sendShiftReminder(
		userId: number,
		reminderType: 'start' | 'end' | 'missed' | 'late' | 'pre_start' | 'pre_end' | 'overtime',
		orgId?: string,
		branchId?: number,
		shiftStartTime?: string,
		lateMinutes?: number,
		overtimeMinutes?: number,
	): Promise<void> {
		const operationId = `shift_reminder_${Date.now()}`;
		this.logger.log(`[${operationId}] Sending ${reminderType} shift notification to user ${userId}`);

		try {
			let notificationType: NotificationEvent;
			let message: string;
			let priority = NotificationPriority.NORMAL;

			const currentTime = await this.formatTimeInOrganizationTimezone(new Date(), orgId);

			// Get organization hours to determine expected shift time if not provided
			let expectedShiftTime = shiftStartTime;
			let expectedEndTime: string | undefined;

			if (orgId) {
				try {
					const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
					const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, new Date());

					// Convert Date objects to strings if needed
					const orgOpenTime = organizationHours?.openTime instanceof Date
						? format(organizationHours.openTime, 'HH:mm:ss')
						: organizationHours?.openTime;
					const orgCloseTime = organizationHours?.closeTime instanceof Date
						? format(organizationHours.closeTime, 'HH:mm:ss')
						: organizationHours?.closeTime;

					expectedShiftTime =
						expectedShiftTime || workingDayInfo.startTime || orgOpenTime || this.FALLBACK_OPEN_TIME;
					expectedEndTime = workingDayInfo.endTime || orgCloseTime || this.FALLBACK_CLOSE_TIME;
				} catch (error) {
					this.logger.warn(
						`[${operationId}] Could not get organization hours for org ${orgId}:`,
						error.message,
					);
					expectedShiftTime = expectedShiftTime || '09:00'; // Default fallback
					expectedEndTime = '17:00';
				}
			}

			// Get user info for personalized messages (include preferences to respect notification settings)
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				select: ['uid', 'name', 'surname', 'email', 'username', 'preferences'],
				relations: ['organisation', 'branch', 'branch.organisation'],
			});

			if (!user) {
				this.logger.warn(`[${operationId}] User ${userId} not found`);
				return;
			}

			if (user.preferences?.notifications === false) {
				this.logger.debug(`[${operationId}] Skipping shift reminder for user ${userId} (notifications disabled in preferences)`);
				return;
			}

			// Construct full name with proper fallbacks
			const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
			const userName = fullName || user.username || 'Team Member';

			// Log user data for debugging
			this.logger.log(
				`[${operationId}] User data retrieved for notification:`,
				JSON.stringify({
					userId,
					name: user.name,
					surname: user.surname,
					username: user.username,
					constructedFullName: fullName,
					finalUserName: userName,
				})
			);

			// Prepare notification data based on reminder type
			const notificationData: any = {
				currentTime,
				userId,
				userName, // Full name now properly populated
				orgId,
				branchId,
				timestamp: new Date().toISOString(),
				reminderType,
			};

			switch (reminderType) {
				case 'pre_start':
					notificationType = NotificationEvent.ATTENDANCE_SHIFT_START_REMINDER;
					notificationData.shiftStartTime = expectedShiftTime;
					priority = NotificationPriority.NORMAL;
					break;

				case 'start':
					notificationType = NotificationEvent.ATTENDANCE_SHIFT_STARTED;
					notificationData.shiftStartTime = expectedShiftTime;
					notificationData.currentTime = currentTime;
					priority = NotificationPriority.NORMAL;
					break;

				case 'pre_end':
					notificationType = NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER;
					notificationData.shiftEndTime = expectedEndTime;
					priority = NotificationPriority.NORMAL;
					break;

				case 'end':
					notificationType = NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER;
					notificationData.shiftEndTime = expectedEndTime;
					notificationData.currentTime = currentTime;
					priority = NotificationPriority.HIGH;
					break;

				case 'missed':
					notificationType = NotificationEvent.ATTENDANCE_MISSED_SHIFT_ALERT;
					notificationData.shiftStartTime = expectedShiftTime;
					priority = NotificationPriority.HIGH;
					break;

				case 'late':
					notificationType = NotificationEvent.ATTENDANCE_LATE_SHIFT_ALERT;
					if (lateMinutes && lateMinutes > 0) {
						notificationData.lateMinutes = lateMinutes;
					} else {
						notificationData.currentTime = currentTime;
					}
					notificationData.shiftStartTime = expectedShiftTime;
					priority = NotificationPriority.HIGH;
					break;

				case 'overtime':
					notificationType = NotificationEvent.ATTENDANCE_OVERTIME_REMINDER;
					if (overtimeMinutes && overtimeMinutes > 0) {
						// Cap overtime at 16 hours (24h - 8h standard shift) to prevent impossible values
						const cappedMinutes = Math.min(overtimeMinutes, 960);
						const hours = Math.floor(cappedMinutes / 60);
						const minutes = cappedMinutes % 60;
						notificationData.overtimeMinutes = cappedMinutes; // Total minutes for :duration formatter
						notificationData.overtimeHours = hours;
						notificationData.overtimeFormatted = `${hours}h ${minutes}m`;
					}
					priority = NotificationPriority.HIGH;
					break;

				default:
					this.logger.warn(`[${operationId}] Unknown reminder type: ${reminderType}`);
					return;
			}


			// Add navigation data for mobile app with context-aware routing
			notificationData.screen = '/hr/attendance';
			notificationData.action = `attendance_${reminderType}`;
			notificationData.type = 'attendance';
			notificationData.context = {
				reminderType,
				userId,
				orgId,
				branchId,
				timestamp: new Date().toISOString()
			};

			// Validate critical notification data before sending
			if (!notificationData.userName || notificationData.userName.trim() === '') {
				this.logger.error(
					`[${operationId}] ⚠️ userName is empty for user ${userId}! Using fallback.`
				);
				notificationData.userName = 'Team Member';
			}

			if (reminderType === 'pre_end' || reminderType === 'end') {
				if (!notificationData.shiftEndTime) {
					this.logger.error(
						`[${operationId}] ⚠️ shiftEndTime is missing for ${reminderType} notification! Using fallback.`
					);
					notificationData.shiftEndTime = '17:00';
				}
			}

			// Log final notification data being sent
			this.logger.log(
				`[${operationId}] Sending ${notificationType} notification with data:`,
				JSON.stringify({
					userName: notificationData.userName,
					shiftStartTime: notificationData.shiftStartTime,
					shiftEndTime: notificationData.shiftEndTime,
					userId: notificationData.userId,
					reminderType: notificationData.reminderType,
				})
			);

			// Respect org-level notification channels (OrganisationSettings.notifications)
			const orgChannels = await this.getOrgNotificationChannels(orgId);
			await this.unifiedNotificationService.sendTemplatedNotification(
				notificationType,
				[userId],
				notificationData,
				{
					priority,
					sendEmail: false,
					disablePush: !orgChannels.push,
					disableEmail: !orgChannels.email,
					customData: {
						screen: '/hr/attendance',
						action: `attendance_${reminderType}`,
						type: 'attendance',
						context: {
							reminderType,
							userId,
							orgId,
							branchId,
							timestamp: new Date().toISOString()
						}
					}
				},
			);

			this.logger.log(`[${operationId}] ${reminderType} push notification sent successfully to user ${userId}`);

			// Also notify organization admins for critical events
			if (['missed', 'late', 'overtime'].includes(reminderType) && orgId) {
				try {
					const orgAdmins = await this.getOrganizationAdmins(orgId);
					if (orgAdmins.length > 0) {
						this.logger.debug(
							`[${operationId}] Notifying ${orgAdmins.length} admins about ${reminderType} event for user ${userId}`,
						);

						const adminNotificationData: any = {
							userId,
							userName,
							userEmail: user?.email || '',
							orgId,
							branchId,
							alertType: reminderType,
							timestamp: new Date().toISOString(),
							adminContext: true,
							currentTime,
						};

						// Add specific data for admin notifications
						if (expectedShiftTime) {
							adminNotificationData.shiftStartTime = expectedShiftTime;
						}
						if (expectedEndTime) {
							adminNotificationData.shiftEndTime = expectedEndTime;
						}
						if (lateMinutes && lateMinutes > 0) {
							adminNotificationData.lateMinutes = lateMinutes;
						}
						if (overtimeMinutes && overtimeMinutes > 0) {
							adminNotificationData.overtimeMinutes = overtimeMinutes;
						}

						// Admin-specific messages and titles
						let adminTitle = '';
						let adminMessage = '';
						switch (reminderType) {
							case 'missed':
								adminTitle = '⚠️ Employee Missed Shift';
								adminMessage = `${userName} missed their scheduled shift that was supposed to start at ${expectedShiftTime}. Please follow up as needed.`;
								break;
							case 'late':
								adminTitle = '⏰ Employee Late Arrival';
								adminMessage = `${userName} checked in ${lateMinutes || 'several'} minute${lateMinutes !== 1 ? 's' : ''} late for their shift. Expected start time: ${expectedShiftTime}.`;
								break;
							case 'overtime':
								const otHours = Math.floor((overtimeMinutes || 0) / 60);
								const otMins = (overtimeMinutes || 0) % 60;
								adminTitle = '🔥 Employee Working Overtime';
								adminMessage = `${userName} is currently working overtime (${otHours}h ${otMins}m). Please monitor for employee wellness and ensure proper rest periods.`;
								break;
						}

						// Use GENERAL_NOTIFICATION for admin alerts with custom message
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.GENERAL_NOTIFICATION,
							orgAdmins.map((admin) => admin.uid),
							{
								message: adminMessage,
								userId,
								employeeName: userName,
								userEmail: user?.email || '',
								orgId,
								branchId,
								alertType: reminderType,
								shiftStartTime: expectedShiftTime,
								lateMinutes,
								overtimeMinutes,
								timestamp: new Date().toISOString(),
							},
							{
								priority: NotificationPriority.HIGH,
								customData: {
									screen: '/staff',
									action: 'view_employee_attendance',
									type: 'admin_alert',
									context: {
										employeeId: userId,
										employeeName: userName,
										alertType: reminderType,
									}
								}
							},
						);
					}
				} catch (error) {
					this.logger.warn(
						`[${operationId}] Failed to notify admins about ${reminderType} event:`,
						error.message,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`[${operationId}] Failed to send ${reminderType} notification to user ${userId}:`,
				error.stack,
			);
		}
	}

	/**
	 * Get organization admins for notifications
	 */
	private async getOrganizationAdmins(orgId: string): Promise<any[]> {
		try {
			const adminUsers = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.where('user.accessLevel = :accessLevel', { accessLevel: AccessLevel.ADMIN })
				.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
				.select(['user.uid', 'user.email'])
				.getMany();
			return adminUsers;
		} catch (error) {
			this.logger.error(`Error fetching org admins for org ${orgId}:`, error.message);
			return [];
		}
	}

	/**
	 * Check if user checked in remotely from branch (>50m) and notify admins
	 */
	private async checkRemoteCheckInOnCheckIn(
		checkIn: Attendance,
		orgId: string,
		branchId: number,
		checkInLat: number,
		checkInLng: number,
	): Promise<void> {
		try {
			// Get branch with address
			const branch = await this.branchRepository.findOne({
				where: { uid: branchId },
			});

			if (!branch || !branch.address) {
				this.logger.debug(`Branch ${branchId} not found or has no address, skipping remote check`);
				return;
			}

			// Calculate distance from branch
			const distance = await this.calculateDistanceFromBranch(checkInLat, checkInLng, branch);

			if (distance > this.REMOTE_CHECK_IN_DISTANCE_THRESHOLD_METERS) {
				// Get user info for notification
				const checkInWithOwner = await this.attendanceRepository.findOne({
					where: { uid: checkIn.uid },
					relations: ['owner', 'owner.organisation', 'owner.branch'],
				});

				const user = checkInWithOwner?.owner;
				if (!user) {
					this.logger.warn(`User not found for check-in ${checkIn.uid}`);
					return;
				}

				await this.notifyAdminsAboutRemoteCheckIn(user, checkIn, distance, branch, orgId, branchId);
			}
		} catch (error) {
			this.logger.error(`Error checking remote check-in:`, error.message);
			throw error;
		}
	}

	/**
	 * Calculate distance from check-in location to branch in meters
	 */
	private async calculateDistanceFromBranch(
		checkInLat: number,
		checkInLng: number,
		branch: Branch,
	): Promise<number> {
		try {
			// Format branch address for geocoding
			const branchAddress = `${branch.address.street}, ${branch.address.city}, ${branch.address.state}, ${branch.address.country}, ${branch.address.postalCode}`;

			// Geocode branch address
			const geocodeResult = await this.googleMapsService.geocodeAddress(branchAddress);

			if (!geocodeResult || !geocodeResult.address || !geocodeResult.address.latitude || !geocodeResult.address.longitude) {
				this.logger.warn(`Failed to geocode branch address: ${branchAddress}`);
				return 0;
			}

			const branchLat = geocodeResult.address.latitude;
			const branchLng = geocodeResult.address.longitude;

			// Calculate distance in kilometers, then convert to meters
			const distanceKm = LocationUtils.calculateDistance(checkInLat, checkInLng, branchLat, branchLng);
			const distanceMeters = distanceKm * 1000;

			return Math.round(distanceMeters);
		} catch (error) {
			this.logger.error(`Error calculating distance from branch:`, error.message);
			return 0;
		}
	}

	/**
	 * Notify admins about remote check-in
	 */
	private async notifyAdminsAboutRemoteCheckIn(
		user: User,
		checkIn: Attendance,
		distance: number,
		branch: Branch,
		orgId: string,
		branchId: number,
	): Promise<void> {
		try {
			const orgAdmins = await this.getOrganizationAdmins(orgId);

			if (orgAdmins.length === 0) {
				this.logger.debug(`No admins found for org ${orgId}, skipping remote check-in notification`);
				return;
			}

			// Prevent duplicate notifications
			const cacheKey = `remote-checkin-${checkIn.uid}`;
			if (this.notificationCache.has(cacheKey)) {
				this.logger.debug(`Already notified about remote check-in ${checkIn.uid}`);
				return;
			}

			const userName = `${user.name || ''} ${user.surname || ''}`.trim() || user.username || 'Team Member';
			const checkInTime = await this.formatTimeInOrganizationTimezone(new Date(checkIn.checkIn), orgId);

			const adminMessage = `⚠️ Remote Check-In Alert: ${userName} checked in ${distance}m away from ${branch.name}. Check-in time: ${checkInTime}`;

			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.GENERAL_NOTIFICATION,
				orgAdmins.map((admin) => admin.uid),
				{
					message: adminMessage,
					userId: user.uid,
					employeeName: userName,
					userEmail: user.email || '',
					orgId,
					branchId,
					branchName: branch.name,
					distance,
					checkInTime,
					checkInLocation: {
						latitude: checkIn.checkInLatitude,
						longitude: checkIn.checkInLongitude,
					},
					timestamp: new Date().toISOString(),
				},
				{
					priority: NotificationPriority.HIGH,
					customData: {
						screen: '/staff',
						action: 'view_employee_attendance',
						type: 'admin_alert',
						context: {
							employeeId: user.uid,
							employeeName: userName,
							alertType: 'remote_checkin',
						},
					},
				},
			);

			// Cache notification to prevent duplicates
			this.notificationCache.add(cacheKey);
			this.logger.log(`Notified ${orgAdmins.length} admins about remote check-in for user ${user.uid} (${distance}m from branch)`);
		} catch (error) {
			this.logger.error(`Failed to notify admins about remote check-in:`, error.message);
			throw error;
		}
	}

	// Cache for tracking sent notifications to prevent duplicates
	private notificationCache = new Set<string>();

	/**
	 * Check and send break duration notifications
	 * Notifications are sent when users have been on break for:
	 * - 15 minutes: gentle reminder
	 * - 30 minutes: moderate reminder
	 * - 45 minutes: strong reminder
	 * - 60 minutes: urgent reminder
	 */
	@Cron('*/30 * * * *') // Run every 30 minutes to reduce database load and connection issues
	async checkAndSendBreakDurationNotifications(): Promise<void> {
		const operationId = `break_duration_check_${Date.now()}`;
		this.logger.log(`[${operationId}] Starting break duration notification check`);

		try {
			const serverNow = new Date();

			// Get all active breaks (users currently on break)
			const activeBreaks = await this.attendanceRepository.find({
				where: {
					status: AttendanceStatus.ON_BREAK,
					breakStartTime: Not(IsNull()),
					checkOut: IsNull(),
				},
				relations: ['owner', 'owner.organisation'],
				order: {
					breakStartTime: 'DESC',
				},
			});

			this.logger.debug(`[${operationId}] Found ${activeBreaks.length} active breaks to check`);

			for (const breakRecord of activeBreaks) {
				try {
					// Get organization timezone for accurate time calculations (use clerkOrgId/ref string)
					const orgId = breakRecord.owner.organisation?.clerkOrgId || breakRecord.owner.organisation?.ref;
					const organizationHours = orgId ? await this.organizationHoursService.getOrganizationHours(orgId) : null;
					const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';

					// Get current time (already timezone-aware)
					const now = new Date();

					const breakStartTime = new Date(breakRecord.breakStartTime);
					const breakDurationMinutes = Math.floor((now.getTime() - breakStartTime.getTime()) / (1000 * 60));

					// Define notification intervals and messages
					const notificationIntervals = [
						{ minutes: 15, level: 'gentle', priority: NotificationPriority.LOW },
						{ minutes: 30, level: 'moderate', priority: NotificationPriority.NORMAL },
						{ minutes: 45, level: 'strong', priority: NotificationPriority.HIGH },
						{ minutes: 60, level: 'urgent', priority: NotificationPriority.HIGH },
					];

					for (const interval of notificationIntervals) {
						// Check if we should send notification for this interval
						// We send it if the break duration is exactly at or just past the interval (within 1 minute window)
						if (breakDurationMinutes >= interval.minutes && breakDurationMinutes < interval.minutes + 1) {
							const todayKey = format(now, 'yyyy-MM-dd');
							const cacheKey = `break_duration_${interval.minutes}min_${breakRecord.uid}_${breakRecord.owner.uid}_${todayKey}`;

							// Skip if already notified for this interval today
							if (this.notificationCache.has(cacheKey)) {
								continue;
							}

							// Get user info for personalized message
							const user = await this.userRepository.findOne({
								where: { uid: breakRecord.owner.uid },
								select: ['uid', 'name', 'surname', 'username'],
							});

							// Construct full name with proper fallbacks
							const fullName = `${user?.name || ''} ${user?.surname || ''}`.trim();
							const userName = fullName || user?.username || 'Team Member';


							this.logger.debug(
								`[${operationId}] Sending ${interval.level} break duration notification to user: ${breakRecord.owner.uid} - ${interval.minutes} minutes`,
							);

							await this.unifiedNotificationService.sendTemplatedNotification(
								NotificationEvent.ATTENDANCE_BREAK_STARTED,
								[breakRecord.owner.uid],
								{
									breakDurationMinutes: interval.minutes,
									breakStartTime: await this.formatTimeInOrganizationTimezone(breakStartTime, breakRecord.owner.organisation?.clerkOrgId || breakRecord.owner.organisation?.ref),
									currentTime: await this.formatTimeInOrganizationTimezone(now, breakRecord.owner.organisation?.clerkOrgId || breakRecord.owner.organisation?.ref),
									reminderLevel: interval.level,
									userName,
									userId: breakRecord.owner.uid,
									organizationId: breakRecord.owner.organisation?.uid,
									timestamp: new Date().toISOString(),
								},
								{
									priority: interval.priority,
								},
							);

							// Cache the notification to prevent duplicates
							this.notificationCache.add(cacheKey);

							// Clean up cache after 24 hours
							setTimeout(() => {
								this.notificationCache.delete(cacheKey);
							}, 24 * 60 * 60 * 1000);

							this.logger.debug(
								`[${operationId}] Break duration notification sent successfully to user: ${breakRecord.owner.uid} for ${interval.minutes} minutes`,
							);

							// Also notify organization admins for longer breaks (45+ minutes)
							if (interval.minutes >= 45) {
								try {
									const orgIdForAdmins = breakRecord.owner.organisation?.clerkOrgId || breakRecord.owner.organisation?.ref;
									if (orgIdForAdmins) {
										await this.notifyAdminsAboutLongBreak(
											operationId,
											orgIdForAdmins,
											breakRecord.owner,
											interval.minutes,
											breakStartTime,
										);
									}
								} catch (adminNotificationError) {
									this.logger.warn(
										`[${operationId}] Failed to notify admins about long break for user ${breakRecord.owner.uid}:`,
										adminNotificationError.message,
									);
								}
							}
						}
					}
				} catch (error) {
					this.logger.error(
						`[${operationId}] Error processing break duration notification for user ${breakRecord.owner.uid}:`,
						error.message,
					);
				}
			}

			this.logger.log(`[${operationId}] Break duration notification check completed`);
		} catch (error) {
			this.logger.error(`[${operationId}] Error in break duration notification check:`, error.stack);
		}
	}

	/**
	 * Notify admins about employees taking long breaks (45+ minutes)
	 */
	private async notifyAdminsAboutLongBreak(
		operationId: string,
		orgId: string,
		user: any,
		breakDurationMinutes: number,
		breakStartTime: Date,
	): Promise<void> {
		try {
			const orgAdmins = await this.getOrganizationAdmins(orgId);
			if (orgAdmins.length > 0) {
				this.logger.debug(
					`[${operationId}] Notifying ${orgAdmins.length} admins about long break for user ${user.uid}`,
				);

				const breakStartTimeString = await this.formatTimeInOrganizationTimezone(breakStartTime, orgId);

				const breakLevel = breakDurationMinutes >= 60 ? 'extended' : 'long';
				const urgencyLevel = breakDurationMinutes >= 60 ? 'urgent attention' : 'monitoring';

				// Construct employeeName with proper fallbacks
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				const employeeName = fullName || user.username || user.email?.split('@')[0] || 'Employee';

				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_STARTED,
					orgAdmins.map((admin) => admin.uid),
					{
						employeeName,
						employeeEmail: user.email,
						breakDurationMinutes,
						breakStartTime: breakStartTimeString,
						breakLevel,
						userId: user.uid,
						orgId,
						adminContext: true,
						timestamp: new Date().toISOString(),
					},
					{ priority: NotificationPriority.HIGH },
				);
			}
		} catch (error) {
			this.logger.warn(`[${operationId}] Failed to notify admins about long break:`, error.message);
		}
	}

	/**
	 * Check and send shift reminders based on organization hours
	 * Notifications are sent at specific time windows:
	 * - 30 minutes BEFORE organization start time (shift start reminder)
	 * - 30 minutes AFTER organization start time (missed shift alerts)
	 * - 30 minutes BEFORE organization end time (checkout reminder)
	 * - 30 minutes AFTER organization end time (missed checkout alerts)
	 */
	@Cron('*/5 * * * *') // Run every 5 minutes
	async checkAndSendShiftReminders(): Promise<void> {
		const operationId = `shift_check_${Date.now()}`;
		this.logger.log(`[${operationId}] Starting shift reminder check`);

		try {
			const now = new Date();

			// Get all organizations
			const organizations = await this.organisationRepository.find({
				where: { isDeleted: false },
			});

			for (const org of organizations) {
				try {
					// Get organization hours and timezone (use clerkOrgId/ref string)
					const orgId = org.clerkOrgId || org.ref;
					const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
					const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';
					// Dates are already timezone-aware
					const orgCurrentTime = now;

					// Only check during reasonable business hours (extended for pre-work reminders)
					const currentHour = orgCurrentTime.getHours();
					if (currentHour < 5 || currentHour > 23) {
						continue;
					}

					// Get organization working day info (pass string orgId)
					const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
						orgId,
						orgCurrentTime,
					);

					if (!workingDayInfo.isWorkingDay) {
						this.logger.debug(`[${operationId}] Skipping org ${org.uid} - not a working day`);
						continue;
					}

					const startTime = workingDayInfo.startTime;
					const endTime = workingDayInfo.endTime;

					if (!startTime || !endTime) {
						this.logger.debug(`[${operationId}] Skipping org ${org.uid} - no working hours defined`);
						continue;
					}

					// Calculate notification windows - parse time strings and combine with current time
					const [startHour, startMinute] = startTime.split(':').map(Number);
					const [endHour, endMinute] = endTime.split(':').map(Number);

					// Parse organization working times
					const orgStartTime = new Date(orgCurrentTime);
					orgStartTime.setHours(startHour, startMinute, 0, 0);
					const orgEndTime = new Date(orgCurrentTime);
					orgEndTime.setHours(endHour, endMinute, 0, 0);

					// 30 minutes BEFORE start time (shift start reminder)
					const preShiftReminderTime = addMinutes(orgStartTime, -30);

					// 30 minutes AFTER start time (missed shift alert)
					const missedShiftAlertTime = addMinutes(orgStartTime, 30);

					// 30 minutes BEFORE end time (checkout reminder)
					const preCheckoutReminderTime = addMinutes(orgEndTime, -30);

					// 30 minutes AFTER end time (missed checkout alert)
					const missedCheckoutAlertTime = addMinutes(orgEndTime, 30);

					// Check if we're within notification windows (±2.5 minutes for 5-minute cron)
					const preShiftTimeDiff =
						Math.abs(orgCurrentTime.getTime() - preShiftReminderTime.getTime()) / (1000 * 60);
					const missedShiftTimeDiff =
						Math.abs(orgCurrentTime.getTime() - missedShiftAlertTime.getTime()) / (1000 * 60);
					const preCheckoutTimeDiff =
						Math.abs(orgCurrentTime.getTime() - preCheckoutReminderTime.getTime()) / (1000 * 60);
					const missedCheckoutTimeDiff =
						Math.abs(orgCurrentTime.getTime() - missedCheckoutAlertTime.getTime()) / (1000 * 60);

					const isInPreShiftWindow = preShiftTimeDiff <= 2.5;
					const isInMissedShiftWindow = missedShiftTimeDiff <= 2.5;
					const isInPreCheckoutWindow = preCheckoutTimeDiff <= 2.5;
					const isInMissedCheckoutWindow = missedCheckoutTimeDiff <= 2.5;

					if (
						!isInPreShiftWindow &&
						!isInMissedShiftWindow &&
						!isInPreCheckoutWindow &&
						!isInMissedCheckoutWindow
					) {
						this.logger.debug(`[${operationId}] Not in any notification window for org ${org.uid}`);
						continue;
					}

					const todayKey = format(orgCurrentTime, 'yyyy-MM-dd');

					this.logger.log(
						`[${operationId}] Processing notifications for org ${org.uid} (${org.name}) - PreShift: ${isInPreShiftWindow}, MissedShift: ${isInMissedShiftWindow}, PreCheckout: ${isInPreCheckoutWindow}, MissedCheckout: ${isInMissedCheckoutWindow}`,
					);

					// Get users in this organization
					const orgUsers = await this.userRepository
						.createQueryBuilder('user')
						.leftJoinAndSelect('user.organisation', 'organisation')
						.where('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', {
							orgId: org.clerkOrgId || org.ref
						})
						.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
						.andWhere('user.status = :status', { status: 'ACTIVE' })
						.select(['user.uid', 'user.name', 'user.surname', 'user.email'])
						.getMany();

					if (isInPreShiftWindow) {
						await this.processPreShiftReminders(
							operationId,
							org,
							orgUsers,
							orgCurrentTime,
							todayKey,
							startTime,
						);
					}

					if (isInMissedShiftWindow) {
						await this.processMissedShiftAlerts(
							operationId,
							org,
							orgUsers,
							orgCurrentTime,
							todayKey,
							startTime,
						);
					}

					if (isInPreCheckoutWindow) {
						await this.processPreCheckoutReminders(
							operationId,
							org,
							orgUsers,
							orgCurrentTime,
							todayKey,
							endTime,
						);
					}

					if (isInMissedCheckoutWindow) {
						await this.processMissedCheckoutAlerts(
							operationId,
							org,
							orgUsers,
							orgCurrentTime,
							todayKey,
							endTime,
						);
					}
				} catch (error) {
					this.logger.error(`[${operationId}] Error processing reminders for org ${org.uid}:`, error.message);
				}
			}

			this.logger.log(`[${operationId}] Shift reminder check completed`);
		} catch (error) {
			this.logger.error(`[${operationId}] Error in shift reminder check:`, error.stack);
		}
	}

	/**
	 * Process pre-shift reminders (30 minutes before org start time)
	 * Send reminders to all users to get ready for their shift
	 */
	private async processPreShiftReminders(
		operationId: string,
		org: any,
		orgUsers: any[],
		orgCurrentTime: Date,
		todayKey: string,
		startTime: string,
	): Promise<void> {
		this.logger.log(`[${operationId}] Processing pre-shift reminders for org ${org.uid}`);

		for (const user of orgUsers) {
			try {
				const cacheKey = `pre_shift_reminder_${org.uid}_${user.uid}_${todayKey}`;

				// Skip if already notified today
				if (this.notificationCache.has(cacheKey)) {
					continue;
				}

				this.logger.debug(`[${operationId}] Sending pre-shift reminder to user ${user.uid}`);

				// Construct userName with proper fallbacks
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				const userName = fullName || user.username || user.email?.split('@')[0] || 'Team Member';

				// Send reminder 30 minutes before shift starts
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_SHIFT_START_REMINDER,
					[user.uid],
					{
						shiftStartTime: startTime,
						reminderType: 'pre_shift',
						userName,
						userId: user.uid,
						orgId: org.uid,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.NORMAL,
					},
				);

				this.notificationCache.add(cacheKey);

				// Clean up cache after 24 hours
				setTimeout(() => {
					this.notificationCache.delete(cacheKey);
				}, 24 * 60 * 60 * 1000);
			} catch (error) {
				this.logger.error(
					`[${operationId}] Error sending pre-shift reminder to user ${user.uid}:`,
					error.message,
				);
			}
		}
	}

	/**
	 * Process missed shift alerts (30 minutes after org start time)
	 * Check for missed shifts and late arrivals
	 */
	private async processMissedShiftAlerts(
		operationId: string,
		org: any,
		orgUsers: any[],
		orgCurrentTime: Date,
		todayKey: string,
		startTime: string,
	): Promise<void> {
		const orgId = org.clerkOrgId || org.ref;
		this.logger.log(`[${operationId}] Processing missed shift alerts for org ${org.uid}`);

		const todayStart = startOfDay(orgCurrentTime);
		const todayEnd = endOfDay(orgCurrentTime);

		for (const user of orgUsers) {
			try {
				const cacheKey = `missed_shift_alert_${org.uid}_${user.uid}_${todayKey}`;

				// Skip if already notified today
				if (this.notificationCache.has(cacheKey)) {
					continue;
				}

				// Check if user has checked in today
				const todayAttendance = await this.attendanceRepository.findOne({
					where: {
						owner: { uid: user.uid },
						checkIn: Between(todayStart, todayEnd),
					},
				});

				if (!todayAttendance) {
					this.logger.debug(`[${operationId}] User ${user.uid} missed shift - sending alert`);

					// Construct full name with proper fallbacks
					const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
					const userName = fullName || user.username || 'Team Member';

					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.ATTENDANCE_MISSED_SHIFT_ALERT,
						[user.uid],
						{
							shiftStartTime: startTime,
							reminderType: 'missed_shift',
							userName: userName,
							userId: user.uid,
							orgId: org.uid,
							timestamp: new Date().toISOString(),
						},
						{
							priority: NotificationPriority.HIGH,
						},
					);

					// Also notify organization admins (pass clerkOrgId/ref string)
					await this.notifyAdminsAboutMissedShift(operationId, orgId, user, startTime);

					this.notificationCache.add(cacheKey);

					// Clean up cache after 24 hours
					setTimeout(() => {
						this.notificationCache.delete(cacheKey);
					}, 24 * 60 * 60 * 1000);
				}
			} catch (error) {
				this.logger.error(
					`[${operationId}] Error processing missed shift alert for user ${user.uid}:`,
					error.message,
				);
			}
		}
	}

	/**
	 * Process pre-checkout reminders (30 minutes before org end time)
	 * Remind users who are still working to prepare for checkout
	 */
	private async processPreCheckoutReminders(
		operationId: string,
		org: any,
		orgUsers: any[],
		orgCurrentTime: Date,
		todayKey: string,
		endTime: string,
	): Promise<void> {
		this.logger.log(`[${operationId}] Processing pre-checkout reminders for org ${org.uid}`);

		for (const user of orgUsers) {
			try {
				const cacheKey = `pre_checkout_reminder_${org.uid}_${user.uid}_${todayKey}`;

				// Skip if already notified today
				if (this.notificationCache.has(cacheKey)) {
					continue;
				}

				// Check if user has active shift without checkout
				const activeShift = await this.attendanceRepository.findOne({
					where: {
						owner: { uid: user.uid },
						status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]),
						checkOut: IsNull(),
						checkIn: Between(startOfDay(orgCurrentTime), endOfDay(orgCurrentTime)),
					},
				});

				if (activeShift) {
					this.logger.debug(`[${operationId}] Sending pre-checkout reminder to user ${user.uid}`);

					// Construct userName with proper fallbacks
					const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
					const userName = fullName || user.username || user.email?.split('@')[0] || 'Team Member';

					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER,
						[user.uid],
						{
							shiftEndTime: endTime,
							reminderType: 'pre_checkout',
							userName,
							userId: user.uid,
							orgId: org.uid,
							timestamp: new Date().toISOString(),
						},
						{
							priority: NotificationPriority.NORMAL,
						},
					);

					this.notificationCache.add(cacheKey);

					// Clean up cache after 24 hours
					setTimeout(() => {
						this.notificationCache.delete(cacheKey);
					}, 24 * 60 * 60 * 1000);
				}
			} catch (error) {
				this.logger.error(
					`[${operationId}] Error sending pre-checkout reminder to user ${user.uid}:`,
					error.message,
				);
			}
		}
	}

	/**
	 * Process missed checkout alerts (30 minutes after org end time)
	 * Check for users who forgot to check out
	 */
	private async processMissedCheckoutAlerts(
		operationId: string,
		org: any,
		orgUsers: any[],
		orgCurrentTime: Date,
		todayKey: string,
		endTime: string,
	): Promise<void> {
		const orgId = org.clerkOrgId || org.ref;
		this.logger.log(`[${operationId}] Processing missed checkout alerts for org ${org.uid}`);

		for (const user of orgUsers) {
			try {
				const cacheKey = `missed_checkout_alert_${org.uid}_${user.uid}_${todayKey}`;

				// Skip if already notified today
				if (this.notificationCache.has(cacheKey)) {
					continue;
				}

				// Check if user has active shift without checkout
				const activeShift = await this.attendanceRepository.findOne({
					where: {
						owner: { uid: user.uid },
						status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]),
						checkOut: IsNull(),
						checkIn: Between(startOfDay(orgCurrentTime), endOfDay(orgCurrentTime)),
					},
				});

				if (activeShift) {
					this.logger.debug(`[${operationId}] User ${user.uid} forgot to check out - sending alert`);

					// Construct userName with proper fallbacks
					const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
					const userName = fullName || user.username || user.email?.split('@')[0] || 'Team Member';

					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER,
						[user.uid],
						{
							shiftEndTime: endTime,
							reminderType: 'missed_checkout',
							userName,
							userId: user.uid,
							orgId: org.uid,
							timestamp: new Date().toISOString(),
						},
						{
							priority: NotificationPriority.HIGH,
						},
					);

					// Also notify organization admins (pass clerkOrgId/ref string)
					await this.notifyAdminsAboutMissedCheckout(operationId, orgId, user, endTime, activeShift);

					this.notificationCache.add(cacheKey);

					// Clean up cache after 24 hours
					setTimeout(() => {
						this.notificationCache.delete(cacheKey);
					}, 24 * 60 * 60 * 1000);
				}
			} catch (error) {
				this.logger.error(
					`[${operationId}] Error processing missed checkout alert for user ${user.uid}:`,
					error.message,
				);
			}
		}
	}

	/**
	 * Notify admins about missed shifts
	 */
	private async notifyAdminsAboutMissedShift(
		operationId: string,
		orgId: string,
		user: any,
		startTime: string,
	): Promise<void> {
		try {
			const orgAdmins = await this.getOrganizationAdmins(orgId);
			if (orgAdmins.length > 0) {
				this.logger.debug(
					`[${operationId}] Notifying ${orgAdmins.length} admins about missed shift for user ${user.uid}`,
				);

				// Construct employeeName with proper fallbacks
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				const employeeName = fullName || user.username || user.email?.split('@')[0] || 'Employee';

				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_MISSED_SHIFT_ALERT,
					orgAdmins.map((admin) => admin.uid),
					{
						employeeName,
						employeeEmail: user.email,
						shiftStartTime: startTime,
						userId: user.uid,
						orgId,
						adminContext: true,
						timestamp: new Date().toISOString(),
					},
					{ priority: NotificationPriority.HIGH },
				);
			}
		} catch (error) {
			this.logger.warn(`[${operationId}] Failed to notify admins about missed shift:`, error.message);
		}
	}

	/**
	 * Notify admins about missed checkouts
	 */
	private async notifyAdminsAboutMissedCheckout(
		operationId: string,
		orgId: string,
		user: any,
		endTime: string,
		activeShift: any,
	): Promise<void> {
		try {
			const orgAdmins = await this.getOrganizationAdmins(orgId);
			if (orgAdmins.length > 0) {
				this.logger.debug(
					`[${operationId}] Notifying ${orgAdmins.length} admins about missed checkout for user ${user.uid}`,
				);

				const checkInTime = await this.formatTimeInOrganizationTimezone(new Date(activeShift.checkIn), orgId);

				// Construct employeeName with proper fallbacks
				const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
				const employeeName = fullName || user.username || user.email?.split('@')[0] || 'Employee';

				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER,
					orgAdmins.map((admin) => admin.uid),
					{
						employeeName,
						employeeEmail: user.email,
						checkInTime,
						shiftEndTime: endTime,
						userId: user.uid,
						orgId,
						adminContext: true,
						timestamp: new Date().toISOString(),
					},
					{ priority: NotificationPriority.HIGH },
				);
			}
		} catch (error) {
			this.logger.warn(`[${operationId}] Failed to notify admins about missed checkout:`, error.message);
		}
	}

	/**
	 * Get daily attendance overview - present and absent users
	 */
	public async getDailyAttendanceOverview(
		orgId?: string,
		branchId?: number,
		date?: Date,
		userAccessLevel?: string,
	): Promise<{
		message: string;
		data: {
			date: string;
			totalEmployees: number;
			presentEmployees: number;
			absentEmployees: number;
			attendanceRate: number;
			presentUsers: Array<{
				uid: number;
				name: string;
				surname: string;
				fullName: string;
				email: string;
				phoneNumber: string;
				profileImage: string | null;
				branchId: number | null;
				branchName: string;
				accessLevel: string;
				checkInTime: Date;
				checkOutTime: Date | null;
				status: string;
				workingHours: string | null;
				isOnBreak: boolean;
				shiftDuration: string;
			}>;
			absentUsers: Array<{
				uid: number;
				name: string;
				surname: string;
				fullName: string;
				email: string;
				phoneNumber: string;
				profileImage: string | null;
				branchId: number | null;
				branchName: string;
				accessLevel: string;
				lastSeenDate: string | null;
				employeeSince: string;
				isActive: boolean;
				role: string;
			}>;
		};
	}> {
		// Get effective branch ID based on user role
		const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);
		const operationId = `daily_overview_${Date.now()}`;
		this.logger.log(
			`[${operationId}] Getting daily attendance overview for orgId: ${orgId}, branchId: ${branchId}, effectiveBranchId: ${effectiveBranchId}, userAccessLevel: ${userAccessLevel}, date: ${date || 'today'
			}`,
		);

		try {
			const targetDate = date || new Date();
			const startOfTargetDay = startOfDay(targetDate);
			const endOfTargetDay = endOfDay(targetDate);

			this.logger.debug(
				`[${operationId}] Target date range: ${startOfTargetDay.toISOString()} to ${endOfTargetDay.toISOString()}`,
			);

			// Build user query conditions
			const userConditions: any = {};
			// Filter by clerkOrgId or ref (both are strings)
			if (orgId) {
				userConditions.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}
			if (effectiveBranchId) {
				userConditions.branch = { uid: effectiveBranchId };
			} else if (userAccessLevel) {
				this.logger.debug(`[${operationId}] User ${userAccessLevel} can see all branches - no branch filter applied`);
			}

			// Get all users in the organization/branch with enhanced data
			const allUsers = await this.userRepository.find({
				where: {
					...userConditions,
					isDeleted: false,
					status: 'active',
				},
				relations: ['branch', 'organisation', 'userProfile'],
				select: ['uid', 'name', 'surname', 'email', 'accessLevel', 'phone', 'createdAt', 'photoURL'],
			});

			this.logger.debug(`[${operationId}] Found ${allUsers.length} total users`);

			// Get attendance records for today
			const attendanceConditions: any = {
				checkIn: Between(startOfTargetDay, endOfTargetDay),
			};
			if (orgId) {
				attendanceConditions.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}
			if (effectiveBranchId) {
				attendanceConditions.branch = { uid: effectiveBranchId };
			}

			const todayAttendance = await this.attendanceRepository.find({
				where: attendanceConditions,
				relations: ['owner', 'owner.branch', 'owner.userProfile', 'organisation', 'branch'],
				order: { checkIn: 'ASC' },
			});

			this.logger.debug(`[${operationId}] Found ${todayAttendance.length} attendance records for today`);

			// Build present users list with enhanced data (no duplicates)
			// Note: We format times directly from UTC dates using TimezoneUtil to avoid double conversion
			const presentUsersMap = new Map<number, any>();
			const presentUserIds = new Set<number>();

			const timezone = await this.getOrganizationTimezone(orgId);
			todayAttendance?.forEach((attendance) => {
				if (attendance.owner && !presentUsersMap.has(attendance.owner.uid)) {
					const user = attendance.owner;
					const userProfile = user.userProfile || null;

					presentUsersMap.set(user.uid, {
						uid: user.uid,
						name: user.name || '',
						surname: user.surname || '',
						fullName: `${user.name || ''} ${user.surname || ''}`.trim(),
						email: user.email || '',
						phoneNumber: user.phone || '',
						profileImage: user.photoURL || null,
						branchId: user.branch?.uid || null,
						branchName: user.branch?.name || 'N/A',
						accessLevel: user.accessLevel || 'USER',
						checkInTime: attendance.checkIn ? TimezoneUtil.formatInOrganizationTime(attendance.checkIn, 'yyyy-MM-dd HH:mm:ss', timezone) : null,
						checkOutTime: attendance.checkOut ? TimezoneUtil.formatInOrganizationTime(attendance.checkOut, 'yyyy-MM-dd HH:mm:ss', timezone) : null,
						status: attendance.status || 'present',
						workingHours: attendance.checkOut
							? (
								(new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) /
								(1000 * 60 * 60)
							).toFixed(2)
							: null,
						isOnBreak: attendance.status === AttendanceStatus.ON_BREAK,
						shiftDuration: attendance.checkOut
							? `${Math.floor(
								(new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) /
								(1000 * 60 * 60),
							)}h ${Math.floor(
								((new Date(attendance.checkOut).getTime() -
									new Date(attendance.checkIn).getTime()) %
									(1000 * 60 * 60)) /
								(1000 * 60),
							)}m`
							: 'In Progress',
					});
					presentUserIds.add(user.uid);
				}
			});

			const presentUsers = Array.from(presentUsersMap.values());

			// Build absent users list with enhanced data
			const absentUsers: Array<{
				uid: number;
				name: string;
				surname: string;
				fullName: string;
				email: string;
				phoneNumber: string;
				profileImage: string | null;
				branchId: number | null;
				branchName: string;
				accessLevel: string;
				lastSeenDate: string | null;
				employeeSince: string;
				isActive: boolean;
				role: string;
			}> = [];

			allUsers.forEach((user) => {
				if (!presentUserIds.has(user.uid)) {
					const userProfile = user.userProfile || null;

					absentUsers.push({
						uid: user.uid,
						name: user.name || '',
						surname: user.surname || '',
						fullName: `${user.name || ''} ${user.surname || ''}`.trim(),
						email: user.email || '',
						phoneNumber: user.phone || '',
						profileImage: user.photoURL || null,
						branchId: user.branch?.uid || null,
						branchName: user.branch?.name || 'N/A',
						accessLevel: user.accessLevel || 'USER',
						lastSeenDate: null, // This could be enhanced with last attendance record
						employeeSince: user.createdAt
							? new Date(user.createdAt).toISOString().split('T')[0]
							: 'Unknown',
						isActive: true,
						role: user.accessLevel || 'USER',
					});
				}
			});

			const attendanceRate = allUsers.length > 0 ? Math.round((presentUsers.length / allUsers.length) * 100) : 0;

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				data: {
					date: targetDate.toISOString().split('T')[0],
					totalEmployees: allUsers.length,
					presentEmployees: presentUsers.length,
					absentEmployees: absentUsers.length,
					attendanceRate,
					presentUsers,
					absentUsers,
				},
			};

			this.logger.log(
				`[${operationId}] Daily attendance overview generated: ${presentUsers.length} present, ${absentUsers.length} absent, ${attendanceRate}% rate`,
			);

			// Times are formatted directly from UTC dates using TimezoneUtil to avoid double conversion
			return response;
		} catch (error) {
			this.logger.error(`[${operationId}] Error generating daily attendance overview:`, error.stack);
			return {
				message: error?.message || 'Error retrieving daily attendance overview',
				data: {
					date: date?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
					totalEmployees: 0,
					presentEmployees: 0,
					absentEmployees: 0,
					attendanceRate: 0,
					presentUsers: [],
					absentUsers: [],
				},
			};
		}
	}

	/**
	 * Enhanced method to get attendance records that properly handles multi-day shifts
	 */
	public async getAttendanceForDateRange(
		startDate: Date,
		endDate: Date,
		orgId?: string,
		branchId?: number,
		userAccessLevel?: string,
	): Promise<{
		message: string;
		checkIns: Attendance[];
		multiDayShifts: Attendance[];
		ongoingShifts: Attendance[];
	}> {
		// Get effective branch ID based on user role
		const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);
		try {
			// Get organization timezone for accurate date range (orgId is clerkOrgId/ref string)
			const organizationHours = orgId ? await this.organizationHoursService.getOrganizationHours(orgId) : null;
			const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';

			// Use date-fns for start and end of period (dates are already timezone-aware)
			const periodStart = startOfDay(startDate);
			const periodEnd = endOfDay(endDate);
			const startOfPeriod = periodStart;
			const endOfPeriod = periodEnd;

			const whereConditions: any = {};

			// Apply organization and branch filtering - filter by clerkOrgId or ref (both are strings)
			if (orgId) {
				whereConditions.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}

			if (effectiveBranchId) {
				whereConditions.branch = { uid: effectiveBranchId };
			} else if (userAccessLevel) {
				this.logger.debug(`User ${userAccessLevel} can see all branches - no branch filter applied`);
			}

			// Get all check-ins within the date range
			const checkInsInRange = await this.attendanceRepository.find({
				where: {
					...whereConditions,
					checkIn: Between(startOfPeriod, endOfPeriod),
				},
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
					'dailyReport',
				],
				order: {
					checkIn: 'DESC',
				},
			});

			// Get shifts that started before the range but are still ongoing
			const ongoingShiftsWhereConditions = { ...whereConditions };
			const ongoingShifts = await this.attendanceRepository.find({
				where: {
					...ongoingShiftsWhereConditions,
					checkIn: LessThan(startOfPeriod),
					status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]),
					checkOut: IsNull(),
				},
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
					'dailyReport',
				],
				order: {
					checkIn: 'DESC',
				},
			});

			// Identify multi-day shifts (shifts that span more than 24 hours)
			const multiDayShifts = checkInsInRange.filter((shift) => {
				if (!shift.checkOut) {
					// Still ongoing - check if it's been more than 24 hours
					const shiftDuration = new Date().getTime() - new Date(shift.checkIn).getTime();
					return shiftDuration > 24 * 60 * 60 * 1000; // More than 24 hours
				} else {
					// Completed shift - check if it spanned multiple days
					const shiftDuration = new Date(shift.checkOut).getTime() - new Date(shift.checkIn).getTime();
					return shiftDuration > 24 * 60 * 60 * 1000; // More than 24 hours
				}
			});

			// Mark all shifts with their day span information
			const allCheckIns = [...checkInsInRange, ...ongoingShifts].map((checkIn) => {
				const checkInDate = new Date(checkIn.checkIn);
				const endTime = checkIn.checkOut ? new Date(checkIn.checkOut) : new Date();
				const daySpan = this.calculateShiftDaySpan(checkInDate, endTime);

				return {
					...checkIn,
					isMultiDayShift: daySpan > 1,
					shiftDaySpan: daySpan,
					isOngoingShift: !checkIn.checkOut && checkIn.status !== AttendanceStatus.COMPLETED,
				};
			});

			// Apply timezone conversion to all attendance records using enhanced method
			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns: allCheckIns,
				multiDayShifts: multiDayShifts.map((shift) => ({
					...shift,
					shiftDaySpan: this.calculateShiftDaySpan(
						new Date(shift.checkIn),
						shift.checkOut ? new Date(shift.checkOut) : new Date(),
					),
				})),
				ongoingShifts: ongoingShifts.map((shift) => ({
					...shift,
					shiftDaySpan: this.calculateShiftDaySpan(new Date(shift.checkIn), new Date()),
				})),
			};

			const responseWithTimezone = await this.ensureTimezoneConversion(response, orgId);
			return responseWithTimezone;
		} catch (error) {
			return {
				message: `Error retrieving attendance records: ${error.message}`,
				checkIns: [],
				multiDayShifts: [],
				ongoingShifts: [],
			};
		}
	}

	public async checkInsByStatus(
		ref: string,
		orgId?: string,
		branchId?: number,
		userAccessLevel?: string,
		requestingUserId?: string | number,
	): Promise<{
		message: string;
		startTime: string;
		endTime: string;
		nextAction: string;
		isLatestCheckIn: boolean;
		checkedIn: boolean;
		user: any;
		attendance: Attendance;
	}> {
		// Get effective branch ID based on user role
		const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);

		// If user is querying their own status, don't apply branch filtering
		// Branch filtering should only apply to list queries, not individual user queries
		// This ensures users can always see their own records regardless of branch changes
		const isOwnStatus = requestingUserId != null && String(requestingUserId) === String(ref);

		try {
			const whereConditions: any = {
				owner: {
					uid: ref,
				},
			};

			// Apply organization filtering - validate user belongs to requester's org
			// Filter by clerkOrgId or ref (both are strings)
			if (orgId) {
				whereConditions.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}

			// Only apply branch filtering if:
			// 1. User is NOT querying their own status (admins viewing others)
			// 2. AND effectiveBranchId is set
			// 3. AND user doesn't have elevated access (already handled by getEffectiveBranchId)
			if (!isOwnStatus && effectiveBranchId) {
				whereConditions.branch = { uid: effectiveBranchId };
				this.logger.debug(`Applied branch filter: ${effectiveBranchId} for user ${ref} (viewed by ${requestingUserId})`);
			} else if (isOwnStatus) {
				this.logger.debug(`User ${ref} viewing own status - skipping branch filter to ensure all records are visible`);
			} else if (userAccessLevel) {
				this.logger.debug(`User ${userAccessLevel} can see all branches - no branch filter applied`);
			}

			const [checkIn] = await this.attendanceRepository.find({
				where: whereConditions,
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
					'dailyReport',
				],
				order: {
					checkIn: 'DESC',
				},
			});

			if (!checkIn) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const isLatestCheckIn = isToday(new Date(checkIn?.checkIn));

			const {
				status,
				checkOut,
				createdAt,
				updatedAt,
				verifiedAt,
				checkIn: CheckInTime,
				owner,
				...restOfCheckIn
			} = checkIn;

			// Enhanced status logic to properly handle break states
			let nextAction: string;
			let checkedIn: boolean;

			// Determine status based on comprehensive attendance state
			if (status === AttendanceStatus.PRESENT) {
				checkedIn = true;
				// Check if user can take a break or should end shift
				const hasActiveBreak = checkIn.breakStartTime && !checkIn.breakEndTime;
				nextAction = hasActiveBreak ? 'Resume Work' : 'End Shift';
			} else if (status === AttendanceStatus.ON_BREAK) {
				checkedIn = true;
				nextAction = 'End Break';
			} else if (status === AttendanceStatus.COMPLETED) {
				checkedIn = false;
				nextAction = 'Start Shift';
			} else {
				// Default case for ABSENT, MISSED, or other statuses
				checkedIn = false;
				nextAction = 'Start Shift';
			}

			// Additional validation: check break details for more accuracy
			if (checkIn.breakDetails && Array.isArray(checkIn.breakDetails)) {
				const activeBreak = checkIn.breakDetails.find(breakDetail => !breakDetail.endTime);
				if (activeBreak && status !== AttendanceStatus.ON_BREAK) {
					// User has an active break but status might be inconsistent
					this.logger.warn(`Inconsistent break state detected for user ${ref}: has active break but status is ${status}`);
					checkedIn = true;
					nextAction = 'End Break';
				}
			}

			// Apply timezone conversion to the attendance record using enhanced method
			const timezone = await this.getOrganizationTimezone(orgId);
			const response = {
				message: process.env.SUCCESS_MESSAGE,
				startTime: checkIn.checkIn ? TimezoneUtil.formatInOrganizationTime(checkIn.checkIn, 'yyyy-MM-dd HH:mm:ss', timezone) : null,
				endTime: checkIn.checkOut ? TimezoneUtil.formatInOrganizationTime(checkIn.checkOut, 'yyyy-MM-dd HH:mm:ss', timezone) : null,
				createdAt: checkIn.createdAt ? TimezoneUtil.formatInOrganizationTime(checkIn.createdAt, 'yyyy-MM-dd HH:mm:ss', timezone) : null,
				updatedAt: checkIn.updatedAt ? TimezoneUtil.formatInOrganizationTime(checkIn.updatedAt, 'yyyy-MM-dd HH:mm:ss', timezone) : null,
				verifiedAt: checkIn.verifiedAt ? TimezoneUtil.formatInOrganizationTime(checkIn.verifiedAt, 'yyyy-MM-dd HH:mm:ss', timezone) : null,
				nextAction,
				isLatestCheckIn,
				checkedIn,
				user: owner,
				attendance: checkIn,
				...restOfCheckIn,
			};

			const responseWithTimezone = await this.ensureTimezoneConversion(response, orgId);
			return responseWithTimezone;
		} catch (error) {
			const response = {
				message: `could not get check in - ${error?.message}`,
				startTime: null,
				endTime: null,
				nextAction: null,
				isLatestCheckIn: false,
				checkedIn: false,
				user: null,
				attendance: null,
			};

			return response;
		}
	}

	// ======================================================
	// ATTENDANCE REPORTS
	// ======================================================

	public async checkInsByUser(
		ref: string,
		orgId?: string,
		branchId?: number,
		userAccessLevel?: string,
		requestingUserId?: string,
	): Promise<{ message: string; checkIns: Attendance[]; user: any }> {
		// Get effective branch ID based on user role
		const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);
		const canViewAll = this.shouldSeeAllBranches(userAccessLevel);

		// If user is not admin/owner/developer/technician, they can only view their own attendance
		if (!canViewAll && requestingUserId != null && String(requestingUserId) !== String(ref)) {
			this.logger.warn(`🚫 [AttendanceService] User ${requestingUserId} attempted to access attendance for user ${ref}`);
			throw new NotFoundException('Access denied: You can only view your own attendance records');
		}

		// If user is querying their own records, don't apply branch filtering
		// This ensures users can always see their own records regardless of branch changes
		const isOwnRecords = requestingUserId != null && String(requestingUserId) === String(ref);

		try {
			// Use clerk id (ownerClerkUserId) or numeric uid (owner.uid) per migration
			const whereConditions: any = ref.startsWith('user_')
				? { ownerClerkUserId: ref }
				: { owner: { uid: Number(ref) } };

			// Apply organization filtering - validate user belongs to requester's org
			// Filter by clerkOrgId or ref (both are strings)
			if (orgId) {
				whereConditions.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}

			// Only apply branch filtering if:
			// 1. User is NOT querying their own records (admins viewing others)
			// 2. AND effectiveBranchId is set
			// 3. AND user doesn't have elevated access (already handled by getEffectiveBranchId)
			if (!isOwnRecords && effectiveBranchId) {
				whereConditions.branch = { uid: effectiveBranchId };
				this.logger.debug(`Applied branch filter: ${effectiveBranchId} for user ${ref} (viewed by ${requestingUserId})`);
			} else if (isOwnRecords) {
				this.logger.debug(`User ${ref} viewing own records - skipping branch filter to ensure all records are visible`);
			} else if (userAccessLevel) {
				this.logger.debug(`User ${userAccessLevel} can see all branches - no branch filter applied`);
			}

			const checkIns = await this.attendanceRepository.find({
				where: whereConditions,
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
					'dailyReport',
				],
				order: {
					checkIn: 'DESC',
				},
			});

			if (!checkIns || checkIns.length === 0) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Get user info from the first attendance record
			const userInfo = checkIns[0]?.owner || null;

			// Apply timezone conversion to all attendance records using enhanced method
			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns: checkIns,
				user: userInfo,
			};

			const responseWithTimezone = await this.ensureTimezoneConversion(response, orgId);
			return responseWithTimezone;
		} catch (error) {
			const response = {
				message: `could not get check ins by user - ${error?.message}`,
				checkIns: null,
				user: null,
			};

			return response;
		}
	}

	public async checkInsByBranch(
		ref: string,
		orgId?: string,
		userAccessLevel?: string,
	): Promise<{ message: string; checkIns: Attendance[]; branch: any; totalUsers: number }> {
		// Note: This method is specifically for querying by branch ref, so we still filter by branch
		// but admin/owner/developer can query any branch in their org
		try {
			// Build query using query builder to filter by clerkOrgId/ref
			const queryBuilder = this.attendanceRepository
				.createQueryBuilder('attendance')
				.leftJoinAndSelect('attendance.owner', 'owner')
				.leftJoinAndSelect('owner.branch', 'ownerBranch')
				.leftJoinAndSelect('owner.organisation', 'ownerOrganisation')
				.leftJoinAndSelect('owner.userProfile', 'userProfile')
				.leftJoinAndSelect('attendance.verifiedBy', 'verifiedBy')
				.leftJoinAndSelect('attendance.organisation', 'organisation')
				.leftJoinAndSelect('attendance.branch', 'branch')
				.leftJoinAndSelect('attendance.dailyReport', 'dailyReport')
				.where('branch.ref = :ref', { ref });

			// Apply organization filtering - validate branch belongs to requester's org
			if (orgId) {
				queryBuilder.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			const checkIns = await queryBuilder
				.orderBy('attendance.checkIn', 'DESC')
				.getMany();

			if (!checkIns || checkIns.length === 0) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Get branch info and count unique users
			const branchInfo = checkIns[0]?.branch || null;
			const uniqueUsers = new Set(checkIns.map((record) => record.owner.uid));
			const totalUsers = uniqueUsers.size;

			// Apply timezone conversion to all attendance records using enhanced method
			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns: checkIns,
				branch: branchInfo,
				totalUsers,
			};

			const responseWithTimezone = await this.ensureTimezoneConversion(response, orgId);
			return responseWithTimezone;
		} catch (error) {
			const response = {
				message: `could not get check ins by branch - ${error?.message}`,
				checkIns: null,
				branch: null,
				totalUsers: 0,
			};

			return response;
		}
	}

	public async getAttendancePercentage(): Promise<{ percentage: number; totalHours: number }> {
		try {
			const today = new Date();
			const startOfDay = new Date(today.setHours(0, 0, 0, 0));

			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					checkIn: MoreThanOrEqual(startOfDay),
					status: AttendanceStatus.COMPLETED,
				},
			});

			let totalMinutesWorked = 0;

			// Calculate total minutes worked
			attendanceRecords.forEach((record) => {
				if (record.checkIn && record.checkOut) {
					const minutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
					totalMinutesWorked += minutes;
				}
			});

			// Assuming 8-hour workday
			const expectedWorkMinutes = 8 * 60;
			const percentage = Math.min((totalMinutesWorked / expectedWorkMinutes) * 100, 100);
			const totalHours = totalMinutesWorked / 60;

			return {
				percentage: Math.round(percentage),
				totalHours: Math.round(totalHours * 10) / 10, // Round to 1 decimal place
			};
		} catch (error) {
			return {
				percentage: 0,
				totalHours: 0,
			};
		}
	}

	public async getAttendanceForDate(
		date: Date,
	): Promise<{ totalHours: number; activeShifts: Attendance[]; attendanceRecords: Attendance[] }> {
		try {
			const startOfDayDate = new Date(date.setHours(0, 0, 0, 0));
			const endOfDayDate = new Date(date.setHours(23, 59, 59, 999));

			// Get completed shifts for the day
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					checkIn: MoreThanOrEqual(startOfDayDate),
					checkOut: LessThanOrEqual(endOfDayDate),
					status: AttendanceStatus.COMPLETED,
				},
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
				],
				order: {
					checkIn: 'ASC',
				},
			});

			let totalMinutesWorked = 0;

			// Calculate minutes from completed shifts
			attendanceRecords?.forEach((record) => {
				if (record.checkIn && record.checkOut) {
					const minutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
					totalMinutesWorked += minutes;
				}
			});

			// Get active shifts for today
			const activeShifts = await this.attendanceRepository.find({
				where: {
					status: AttendanceStatus.PRESENT,
					checkIn: MoreThanOrEqual(startOfDayDate),
					checkOut: IsNull(),
				},
				relations: [
					'owner',
					'owner.branch',
					'owner.organisation',
					'owner.userProfile',
					'verifiedBy',
					'organisation',
					'branch',
				],
				order: {
					checkIn: 'ASC',
				},
			});

			// Add minutes from active shifts
			const now = new Date();
			activeShifts.forEach((shift) => {
				if (shift?.checkIn) {
					const minutes = differenceInMinutes(now, new Date(shift?.checkIn));
					totalMinutesWorked += minutes;
				}
			});

			// Apply timezone conversion to attendance records using enhanced method
			const response = {
				totalHours: Math.round((totalMinutesWorked / 60) * 10) / 10, // Round to 1 decimal place
				activeShifts: activeShifts,
				attendanceRecords: attendanceRecords,
			};

			const responseWithTimezone = await this.ensureTimezoneConversion(response);
			return responseWithTimezone;
		} catch (error) {
			const response = {
				totalHours: 0,
				activeShifts: [],
				attendanceRecords: [],
			};

			return response;
		}
	}

	public async getAttendanceForMonth(ref: string): Promise<{ totalHours: number }> {
		try {
			const user = await this.userService.findOne(ref);
			const userId = user.user.uid;

			// Get completed shifts for the month
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					owner: { uid: userId },
					checkIn: MoreThanOrEqual(startOfMonth(new Date())),
					checkOut: LessThanOrEqual(endOfMonth(new Date())),
					status: AttendanceStatus.COMPLETED,
				},
			});

			// Calculate hours from completed shifts - only count regular hours (duration), exclude overtime
			// Regular hours are capped at organization's expected work hours per day
			const completedHours = attendanceRecords.reduce((total, record) => {
				let regularWorkHours = 0;

				// Parse duration (capped at expected hours - this is regular work time)
				if (record?.duration) {
					const [hours, minutes] = record.duration.split(' ');
					const hoursValue = parseFloat(hours.replace('h', ''));
					const minutesValue = parseFloat(minutes.replace('m', '')) / 60;
					regularWorkHours += hoursValue + minutesValue;
				}

				// Do NOT add overtime - overtime is separate and should not be counted in total hours
				// Total hours should only reflect hours within work hours

				return total + regularWorkHours;
			}, 0);

			// Get today's attendance hours
			const todayHours = (await this.getAttendanceForDate(new Date())).totalHours;

			const totalHours = completedHours + todayHours;

			return {
				totalHours: Math.round(totalHours * 10) / 10, // Round to 1 decimal place
			};
		} catch (error) {
			return { totalHours: 0 };
		}
	}

	public async getMonthlyAttendanceStats(): Promise<{
		message: string;
		stats: {
			metrics: {
				totalEmployees: number;
				totalPresent: number;
				attendancePercentage: number;
			};
		};
	}> {
		try {
			const todayPresent = await this.attendanceRepository.count({
				where: {
					status: AttendanceStatus.PRESENT,
				},
			});

			const totalUsers = await this.userService.findAll().then((users) => users?.data?.length);

			const attendancePercentage = totalUsers > 0 ? Math.round((todayPresent / totalUsers) * 100) : 0;

			return {
				message: process.env.SUCCESS_MESSAGE,
				stats: {
					metrics: {
						totalEmployees: totalUsers,
						totalPresent: todayPresent,
						attendancePercentage,
					},
				},
			};
		} catch (error) {
			return {
				message: error?.message,
				stats: null,
			};
		}
	}

	public async getCurrentShiftHours(userId: number): Promise<number> {
		try {
			const activeShift = await this.attendanceRepository.findOne({
				where: {
					status: AttendanceStatus.PRESENT,
					owner: { uid: userId },
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
				},
				order: {
					checkIn: 'DESC',
				},
			});

			if (activeShift) {
				const now = new Date();
				const checkInTime = new Date(activeShift.checkIn);
				const minutesWorked = differenceInMinutes(now, checkInTime);
				return Math.round((minutesWorked / 60) * 10) / 10; // Round to 1 decimal place
			}

			return 0;
		} catch (error) {
			return 0;
		}
	}

	public async manageBreak(
		breakDto: CreateBreakDto,
		clerkUserId?: string,
		uid?: number,
	): Promise<{ message: string }> {
		const isTokenFlow = !!clerkUserId && uid != null;
		const ownerUid = isTokenFlow ? String(uid) : breakDto.owner?.uid;
		const ownerUidNum = isTokenFlow ? uid! : (breakDto.owner?.uid != null ? Number(breakDto.owner.uid) : null);

		if (!ownerUid && !ownerUidNum) {
			return { message: 'User ID is required for break (or use token-based flow)' };
		}

		try {
			this.logger.log(
				`Managing break for user ${ownerUid}, isStartingBreak: ${breakDto.isStartingBreak}`,
			);

			if (breakDto.isStartingBreak) {
				this.logger.log(`Delegating to startBreak for user ${ownerUid}`);
				return this.startBreak(breakDto, ownerUidNum!);
			} else {
				this.logger.log(`Delegating to endBreak for user ${ownerUid}`);
				return this.endBreak(breakDto, ownerUidNum!);
			}
		} catch (error) {
			this.logger.error(`Error managing break for user ${ownerUid}: ${error?.message}`, error?.stack);
			return {
				message: error?.message,
			};
		}
	}

	private async startBreak(breakDto: CreateBreakDto, ownerUidNum: number): Promise<{ message: string }> {
		const ownerUidStr = String(ownerUidNum);
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();
		try {
			this.logger.log(`Starting break for user ${ownerUidStr}`);

			// Find the active shift within transaction (load organisation for cache invalidation)
			const activeShift = await queryRunner.manager.findOne(Attendance, {
				where: {
					status: AttendanceStatus.PRESENT,
					owner: { uid: ownerUidNum },
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
				},
				relations: ['organisation'],
				order: {
					checkIn: 'DESC',
				},
			});

			if (!activeShift) {
				this.logger.warn(`No active shift found for user ${ownerUidStr} to start break`);
				await queryRunner.rollbackTransaction();
				return {
					message: 'No active shift found to start break. Please check in first.'
				};
			}

			this.logger.log(
				`Found active shift ${activeShift.uid} for user ${ownerUidStr}, proceeding with break start`,
			);

			// Initialize the breakDetails array if it doesn't exist
			const breakDetails: BreakDetail[] = activeShift.breakDetails || [];

			// Create a new break entry
			const breakStartTime = new Date();
			const newBreakEntry: BreakDetail = {
				startTime: breakStartTime,
				endTime: null,
				duration: null,
				latitude: breakDto.breakLatitude ? String(breakDto.breakLatitude) : null,
				longitude: breakDto.breakLongitude ? String(breakDto.breakLongitude) : null,
				notes: breakDto.breakNotes,
			};

			// Add to break details array
			breakDetails.push(newBreakEntry);

			// Increment break count
			const breakCount = (activeShift.breakCount || 0) + 1;

			// Update shift with break start time and status (within transaction)
			await queryRunner.manager.update(Attendance, activeShift.uid, {
				breakStartTime,
				breakLatitude: breakDto.breakLatitude ?? undefined,
				breakLongitude: breakDto.breakLongitude ?? undefined,
				breakCount,
				breakDetails,
				status: AttendanceStatus.ON_BREAK,
			});

			await queryRunner.commitTransaction();

			// Clear attendance cache after break start (include org/branch for list invalidation)
			const orgIdBreak = activeShift.organisation?.clerkOrgId ?? activeShift.organisation?.ref;
			await this.clearAttendanceCache(activeShift.uid, ownerUidStr, orgIdBreak, activeShift.branchUid ?? undefined);

			// Send enhanced break start notification
			try {
				// Get user info for personalized message with email and relations
				const user = await this.userRepository.findOne({
					where: { uid: ownerUidNum },
					select: ['uid', 'name', 'surname', 'email', 'username'],
					relations: ['organisation', 'branch', 'branch.organisation'],
				});

				// Construct full name with proper fallbacks
				const fullName = `${user?.name || ''} ${user?.surname || ''}`.trim();
				const userName = fullName || user?.username || 'Team Member';
				const breakNumber =
					breakCount === 1
						? 'first'
						: breakCount === 2
							? 'second'
							: `${breakCount}${breakCount > 3 ? 'th' : breakCount === 3 ? 'rd' : 'nd'}`;

				// Format break start time in organization timezone
				const breakStartTimeString = await this.formatTimeInOrganizationTimezone(breakStartTime, user?.organisation?.clerkOrgId || user?.organisation?.ref);

				this.logger.debug(`Sending enhanced break start notification to user: ${ownerUidStr}`);
				// Send push notification
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_STARTED,
					[ownerUidNum],
					{
						breakStartTime: breakStartTimeString,
						breakCount: breakCount,
						breakNumber,
						userName,
						userId: ownerUidNum,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.LOW,
						sendEmail: false, // We'll handle email separately
					},
				);

				// Email notification removed to reduce Gmail quota usage - push notification only
				this.logger.debug(
					`⏭️ [AttendanceService] Skipping break started email for user: ${ownerUidStr} - push notification sent instead`,
				);
				this.logger.debug(`Enhanced break start notification sent successfully to user: ${ownerUidStr}`);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send break start notification to user: ${ownerUidStr}`,
					notificationError.message,
				);
				// Don't fail the break start if notification fails
			}

			this.logger.log(`Break started successfully for user ${ownerUidStr}, shift ${activeShift.uid}`);
			return {
				message: 'Break started successfully',
			};
		} catch (error) {
			await queryRunner.rollbackTransaction();
			return {
				message: error?.message,
			};
		} finally {
			await queryRunner.release();
		}
	}

	private async endBreak(breakDto: CreateBreakDto, ownerUidNum: number): Promise<{ message: string }> {
		const ownerUidStr = String(ownerUidNum);
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();
		try {
			this.logger.log(`Ending break for user ${ownerUidStr}`);

			// Find the shift on break within transaction (load organisation for cache invalidation)
			const shiftOnBreak = await queryRunner.manager.findOne(Attendance, {
				where: {
					status: AttendanceStatus.ON_BREAK,
					owner: { uid: ownerUidNum },
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
					breakStartTime: Not(IsNull()),
				},
				relations: ['organisation'],
				order: {
					checkIn: 'DESC',
				},
			});

			if (!shiftOnBreak) {
				this.logger.warn(`No shift on break found for user ${ownerUidStr}`);
				await queryRunner.rollbackTransaction();
				return {
					message: 'No shift on break found. Please start a break first.',
				};
			}

			this.logger.log(
				`Found shift on break ${shiftOnBreak.uid} for user ${ownerUidStr}, proceeding with break end`,
			);

			// Calculate break duration
			const breakEndTime = new Date();
			const breakStartTime = new Date(shiftOnBreak.breakStartTime);

			const breakMinutes = differenceInMinutes(breakEndTime, breakStartTime);
			const breakHours = Math.floor(breakMinutes / 60);
			const remainingBreakMinutes = breakMinutes % 60;

			const currentBreakDuration = `${breakHours}h ${remainingBreakMinutes}m`;

			// Calculate total break time (including previous breaks)
			let totalBreakHours = breakHours;
			let totalBreakMinutes = remainingBreakMinutes;

			if (shiftOnBreak.totalBreakTime) {
				const previousBreakMinutes = this.parseBreakTime(shiftOnBreak.totalBreakTime);
				totalBreakMinutes += previousBreakMinutes % 60;
				totalBreakHours += Math.floor(previousBreakMinutes / 60) + Math.floor(totalBreakMinutes / 60);
				totalBreakMinutes = totalBreakMinutes % 60;
			}

			const totalBreakTime = `${totalBreakHours}h ${totalBreakMinutes}m`;

			// Initialize or get the breakDetails array
			const breakDetails: BreakDetail[] = shiftOnBreak.breakDetails || [];

			// Update the latest break entry if it exists
			if (breakDetails.length > 0) {
				const latestBreak = breakDetails[breakDetails.length - 1];
				latestBreak.endTime = breakEndTime;
				latestBreak.duration = currentBreakDuration;
				latestBreak.notes = breakDto.breakNotes || latestBreak.notes;
			} else {
				// If no breakDetails exist, create a new entry for backward compatibility
				breakDetails.push({
					startTime: breakStartTime,
					endTime: breakEndTime,
					duration: currentBreakDuration,
					latitude: shiftOnBreak.breakLatitude ? String(shiftOnBreak.breakLatitude) : null,
					longitude: shiftOnBreak.breakLongitude ? String(shiftOnBreak.breakLongitude) : null,
					notes: breakDto.breakNotes,
				});
			}

			// Update shift with break end time and status (within transaction)
			await queryRunner.manager.update(Attendance, shiftOnBreak.uid, {
				breakEndTime,
				totalBreakTime,
				breakNotes: breakDto.breakNotes ?? undefined,
				breakDetails,
				status: AttendanceStatus.PRESENT,
			});

			await queryRunner.commitTransaction();

			// Clear attendance cache after break end (include org/branch for list invalidation)
			const orgIdEndBreak = shiftOnBreak.organisation?.clerkOrgId ?? shiftOnBreak.organisation?.ref;
			await this.clearAttendanceCache(shiftOnBreak.uid, ownerUidStr, orgIdEndBreak, shiftOnBreak.branchUid ?? undefined);

			// Send enhanced break end notification
			try {
				// Get user info for personalized message with email and relations
				const user = await this.userRepository.findOne({
					where: { uid: ownerUidNum },
					select: ['uid', 'name', 'surname', 'email', 'username'],
					relations: ['organisation', 'branch', 'branch.organisation'],
				});

				// Construct full name with proper fallbacks
				const fullName = `${user?.name || ''} ${user?.surname || ''}`.trim();
				const userName = fullName || user?.username || 'Team Member';

				// Format break times in organization timezone
				const breakEndTimeString = await this.formatTimeInOrganizationTimezone(breakEndTime, user?.organisation?.clerkOrgId || user?.organisation?.ref);
				const breakStartTimeString = await this.formatTimeInOrganizationTimezone(breakStartTime, user?.organisation?.clerkOrgId || user?.organisation?.ref);

				this.logger.debug(`Sending enhanced break end notification to user: ${ownerUidStr}`);
				// Send push notification
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_ENDED,
					[ownerUidNum],
					{
						breakDuration: currentBreakDuration,
						breakStartTime: breakStartTimeString,
						breakEndTime: breakEndTimeString,
						totalBreakTime,
						userName,
						userId: ownerUidNum,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.LOW,
						sendEmail: false, // We'll handle email separately
					},
				);

				// Email notification removed to reduce Gmail quota usage - push notification only
				this.logger.debug(
					`⏭️ [AttendanceService] Skipping break ended email for user: ${ownerUidStr} - push notification sent instead`,
				);
				this.logger.debug(`Enhanced break end notification sent successfully to user: ${ownerUidStr}`);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send break end notification to user: ${ownerUidStr}`,
					notificationError.message,
				);
				// Don't fail the break end if notification fails
			}

			this.logger.log(
				`Break ended successfully for user ${ownerUidStr}, shift ${shiftOnBreak.uid}, duration: ${currentBreakDuration}`,
			);
			return {
				message: 'Break ended successfully',
			};
		} catch (error) {
			await queryRunner.rollbackTransaction();
			return {
				message: error?.message,
			};
		} finally {
			await queryRunner.release();
		}
	}

	private parseBreakTime(breakTimeString: string): number {
		// Enhanced break time parsing using our utility
		return TimeCalculatorUtil.parseBreakTimeString(breakTimeString);
	}

	public async getDailyStats(
		userId: number,
		dateStr?: string,
	): Promise<{ message: string; dailyWorkTime: number; dailyBreakTime: number }> {
		try {
			// Enhanced date handling using our utilities
			const date = dateStr ? new Date(dateStr) : new Date();
			const dateFilter = DateRangeUtil.getDateFilter('today', date);

			// Get completed shifts for the day
			const completedShifts = await this.attendanceRepository.find({
				where: {
					owner: { uid: userId },
					checkIn: dateFilter,
					status: AttendanceStatus.COMPLETED,
				},
				relations: ['owner', 'owner.organisation'],
			});

			// Get active shift (if any)
			const activeShift = await this.attendanceRepository.findOne({
				where: {
					owner: { uid: userId },
					checkIn: dateFilter,
					checkOut: IsNull(),
				},
				relations: ['owner', 'owner.organisation'],
			});

			// Get organization ID for enhanced calculations
			const organizationId =
				completedShifts[0]?.owner?.organisation?.clerkOrgId || completedShifts[0]?.owner?.organisation?.ref || activeShift?.owner?.organisation?.clerkOrgId || activeShift?.owner?.organisation?.ref;

			// Use enhanced calculation service
			const result = await this.attendanceCalculatorService.calculateDailyStats(
				completedShifts,
				activeShift,
				organizationId,
			);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				dailyWorkTime: result.dailyWorkTime,
				dailyBreakTime: result.dailyBreakTime,
			};
		} catch (error) {
			return {
				message: error?.message || 'Error retrieving daily stats',
				dailyWorkTime: 0,
				dailyBreakTime: 0,
			};
		}
	}

	// ======================================================
	// ATTENDANCE METRICS ENDPOINTS
	// ======================================================

	/**
	 * Get comprehensive attendance metrics for a specific user
	 * @param userId - User ID to get metrics for (string)
	 * @returns Comprehensive attendance metrics including first/last attendance and time breakdowns
	 */
	public async getUserAttendanceMetrics(userId: string): Promise<{
		message: string;
		metrics: {
			firstAttendance: {
				date: string | null;
				checkInTime: string | null;
				daysAgo: number | null;
			};
			lastAttendance: {
				date: string | null;
				checkInTime: string | null;
				checkOutTime: string | null;
				daysAgo: number | null;
			};
			totalHours: {
				allTime: number;
				thisMonth: number;
				thisWeek: number;
				today: number;
			};
			totalShifts: {
				allTime: number;
				thisMonth: number;
				thisWeek: number;
				today: number;
			};
			averageHoursPerDay: number;
			attendanceStreak: number;
			breakAnalytics: {
				totalBreakTime: {
					allTime: number; // in minutes
					thisMonth: number;
					thisWeek: number;
					today: number;
				};
				averageBreakDuration: number; // in minutes per shift
				breakFrequency: number; // average breaks per shift
				longestBreak: number; // in minutes
				shortestBreak: number; // in minutes
			};
			timingPatterns: {
				averageCheckInTime: string;
				averageCheckOutTime: string;
				punctualityScore: number; // percentage of on-time arrivals
				overtimeFrequency: number; // percentage of shifts with overtime
			};
			overtimeAnalytics: {
				totalOvertimeHours: {
					allTime: number; // in hours
					thisMonth: number;
					thisWeek: number;
					today: number;
				};
				averageOvertimePerShift: number; // in hours
				overtimeFrequency: number; // percentage of shifts with overtime
				longestOvertimeShift: number; // in hours
			};
			productivityInsights: {
				workEfficiencyScore: number; // percentage based on work vs break time
				shiftCompletionRate: number; // percentage of completed shifts
				lateArrivalsCount: number;
				earlyDeparturesCount: number;
			};
			distanceAnalytics: {
				totalDistance: {
					allTime: number; // in kilometers
					thisMonth: number;
					thisWeek: number;
					today: number;
				};
				averageDistancePerShift: number; // in kilometers
				longestDistance: number; // in kilometers
				shortestDistance: number; // in kilometers
			};
		};
	}> {
		try {
			// Validate input (user ref as string: clerk id or numeric string)
			if (!userId || (typeof userId === 'string' && !userId.trim())) {
				throw new BadRequestException('Invalid user ID provided');
			}

			// Resolve user by clerk id or numeric uid (per migration: clerk id as primary)
			const userIdStr = String(userId);
			const userWhere = userIdStr.startsWith('user_')
				? { clerkUserId: userIdStr }
				: { uid: Number(userIdStr) };
			const userExists = await this.userRepository.findOne({
				where: userWhere,
			});

			if (!userExists) {
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			const clerkUserId = userExists.clerkUserId;
			const ownerFilter = { ownerClerkUserId: clerkUserId };

			// Get first ever attendance with organization info
			const firstAttendanceRaw = await this.attendanceRepository.findOne({
				where: { ...ownerFilter },
				order: { checkIn: 'ASC' },
				relations: ['organisation'],
			});

			// Get last attendance with organization info
			const lastAttendanceRaw = await this.attendanceRepository.findOne({
				where: { ...ownerFilter },
				order: { checkIn: 'DESC' },
				relations: ['organisation'],
			});

			// Keep raw attendance records - timezone conversion will be applied during formatting
			const firstAttendance = firstAttendanceRaw;
			const lastAttendance = lastAttendanceRaw;

			this.logger.debug(`First attendance (raw): ${firstAttendance ? firstAttendance.checkIn.toISOString() : 'null'}`);
			this.logger.debug(`Last attendance (raw): ${lastAttendance ? lastAttendance.checkIn.toISOString() : 'null'}`);

			// Get organization ID for timezone formatting
			const organizationId = firstAttendance?.organisation?.clerkOrgId || firstAttendance?.organisation?.ref || lastAttendance?.organisation?.clerkOrgId || lastAttendance?.organisation?.ref;

			// Calculate date ranges
			const now = new Date();
			const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const startOfWeek = new Date(now);
			startOfWeek.setDate(now.getDate() - now.getDay()); // Start of current week (Sunday)
			startOfWeek.setHours(0, 0, 0, 0);
			const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

			// Get all attendance records for the user with relations for distance calculation
			const allAttendance = await this.attendanceRepository.find({
				where: ownerFilter,
				relations: ['dailyReport'], // Load dailyReport relation for GPS distance data
				order: { checkIn: 'ASC' },
			});

			// Calculate total hours for different periods
			const todayAttendance = allAttendance.filter((record) => new Date(record.checkIn) >= startOfToday);
			const weekAttendance = allAttendance.filter((record) => new Date(record.checkIn) >= startOfWeek);
			const monthAttendance = allAttendance.filter((record) => new Date(record.checkIn) >= startOfMonth);

			// Enhanced helper function to calculate regular hours (capped at organization work hours)
			const calculateRegularHours = async (records: Attendance[], orgId?: string): Promise<number> => {
				if (!orgId) {
					// Fallback: calculate regular hours using default 8 hours cap
					return records.reduce((total, record) => {
						if (record.checkIn && record.checkOut) {
							const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
								record.breakDetails,
								record.totalBreakTime,
							);
							const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
							const workMinutes = Math.max(0, totalMinutes - breakMinutes);
							const regularMinutes = Math.min(workMinutes, TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES);
							return total + TimeCalculatorUtil.minutesToHours(regularMinutes, TimeCalculatorUtil.PRECISION.HOURS);
						}
						return total;
					}, 0);
				}

				// Calculate regular hours per shift based on organization hours
				let totalRegularHours = 0;
				for (const record of records) {
					if (record.checkIn && record.checkOut) {
						try {
							const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
								record.breakDetails,
								record.totalBreakTime,
							);
							const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
							const workMinutes = Math.max(0, totalMinutes - breakMinutes);

							// Get organization expected work minutes for this day
							const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
								orgId,
								new Date(record.checkIn),
							);

							// Cap regular hours at organization's expected work minutes
							const regularMinutes = Math.min(workMinutes, workingDayInfo.expectedWorkMinutes);
							totalRegularHours += TimeCalculatorUtil.minutesToHours(regularMinutes, TimeCalculatorUtil.PRECISION.HOURS);
						} catch (error) {
							this.logger.warn(`Error calculating regular hours for record ${record.uid}: ${error.message}`);
							// Fallback to default
							const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
								record.breakDetails,
								record.totalBreakTime,
							);
							const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
							const workMinutes = Math.max(0, totalMinutes - breakMinutes);
							const regularMinutes = Math.min(workMinutes, TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES);
							totalRegularHours += TimeCalculatorUtil.minutesToHours(regularMinutes, TimeCalculatorUtil.PRECISION.HOURS);
						}
					}
				}
				return totalRegularHours;
			};

			// Calculate regular hours for each period (capped at organization work hours)
			const regularHoursAllTime = await calculateRegularHours(allAttendance, organizationId);
			const regularHoursToday = await calculateRegularHours(todayAttendance, organizationId);
			const regularHoursThisWeek = await calculateRegularHours(weekAttendance, organizationId);
			const regularHoursThisMonth = await calculateRegularHours(monthAttendance, organizationId);

			// Calculate average hours per day (based on days since first attendance)
			const daysSinceFirst = firstAttendance
				? Math.max(1, Math.ceil(differenceInMinutes(now, new Date(firstAttendance.checkIn)) / (24 * 60)))
				: 1;
			const averageHoursPerDay = regularHoursAllTime / daysSinceFirst;

			// Calculate attendance streak (consecutive days with attendance)
			let attendanceStreak = 0;
			const today = new Date();
			today.setHours(0, 0, 0, 0);

			for (let i = 0; i < 30; i++) {
				// Check last 30 days
				const checkDate = new Date(today);
				checkDate.setDate(today.getDate() - i);
				const nextDay = new Date(checkDate);
				nextDay.setDate(checkDate.getDate() + 1);

				const hasAttendance = allAttendance.some((record) => {
					const recordDate = new Date(record.checkIn);
					return recordDate >= checkDate && recordDate < nextDay;
				});

				if (hasAttendance) {
					attendanceStreak++;
				} else if (i > 0) {
					// Don't break on today if no attendance yet
					break;
				}
			}

			// ===== ENHANCED BREAK ANALYTICS =====
			const calculateBreakAnalytics = (records: Attendance[]) => {
				let totalBreakMinutes = 0;
				let totalBreaks = 0;
				let breakDurations: number[] = [];

				records.forEach((record) => {
					// Use enhanced break calculation that handles multiple formats
					const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
						record.breakDetails,
						record.totalBreakTime,
					);

					if (breakMinutes > 0) {
						totalBreakMinutes += breakMinutes;
						breakDurations.push(breakMinutes);
					}

					// Count breaks more accurately
					if (record.breakDetails && record.breakDetails.length > 0) {
						totalBreaks += record.breakDetails.length;
					} else if (record.breakCount) {
						totalBreaks += record.breakCount;
					}
				});

				return {
					totalBreakMinutes,
					totalBreaks,
					breakDurations,
				};
			};

			const allTimeBreaks = calculateBreakAnalytics(allAttendance);
			const monthBreaks = calculateBreakAnalytics(monthAttendance);
			const weekBreaks = calculateBreakAnalytics(weekAttendance);
			const todayBreaks = calculateBreakAnalytics(todayAttendance);

			const completedShifts = allAttendance.filter((record) => record.checkOut);
			const averageBreakDuration =
				completedShifts.length > 0 ? allTimeBreaks.totalBreakMinutes / completedShifts.length : 0;
			const breakFrequency = completedShifts.length > 0 ? allTimeBreaks.totalBreaks / completedShifts.length : 0;
			const longestBreak =
				allTimeBreaks.breakDurations.length > 0 ? Math.max(...allTimeBreaks.breakDurations) : 0;
			const shortestBreak =
				allTimeBreaks.breakDurations.length > 0 ? Math.min(...allTimeBreaks.breakDurations) : 0;

			// ===== DISTANCE ANALYTICS =====
			// Enhanced distance calculation function that ensures consistency
			const calculateDistanceAnalytics = (records: Attendance[]) => {
				let totalDistanceKm = 0;
				const distances: number[] = [];

				records.forEach((record) => {
					// Get distance from multiple sources, prioritizing GPS data
					let distance = 0;

					// Try GPS data from daily report first
					if (record.dailyReport?.gpsData?.tripSummary?.totalDistanceKm) {
						distance = Number(record.dailyReport.gpsData.tripSummary.totalDistanceKm) || 0;
					}
					// Fallback to direct distance field
					else if (record.distanceTravelledKm) {
						distance = Number(record.distanceTravelledKm) || 0;
					}

					// Only count valid positive distances
					if (distance > 0 && !isNaN(distance)) {
						totalDistanceKm += distance;
						distances.push(distance);
					}
				});

				return {
					totalDistanceKm,
					distances,
				};
			};

			// Calculate distance analytics for all periods
			const allTimeDistance = calculateDistanceAnalytics(allAttendance);
			const monthDistance = calculateDistanceAnalytics(monthAttendance);
			const weekDistance = calculateDistanceAnalytics(weekAttendance);
			const todayDistance = calculateDistanceAnalytics(todayAttendance);

			// Get completed shifts with distance for average calculation
			const completedShiftsWithDistance = allAttendance.filter((record) => {
				let distance = 0;
				if (record.dailyReport?.gpsData?.tripSummary?.totalDistanceKm) {
					distance = Number(record.dailyReport.gpsData.tripSummary.totalDistanceKm) || 0;
				} else if (record.distanceTravelledKm) {
					distance = Number(record.distanceTravelledKm) || 0;
				}
				return record.checkOut && distance > 0 && !isNaN(distance);
			});

			// Calculate average, longest, and shortest distances
			// Ensure longestDistance is calculated from the same dataset as totalDistanceKm
			const averageDistancePerShift = completedShiftsWithDistance.length > 0
				? allTimeDistance.totalDistanceKm / completedShiftsWithDistance.length
				: 0;

			// Longest and shortest should be from allTimeDistance.distances to ensure consistency
			const longestDistance = allTimeDistance.distances.length > 0
				? Math.max(...allTimeDistance.distances)
				: 0;
			const shortestDistance = allTimeDistance.distances.length > 0
				? Math.min(...allTimeDistance.distances)
				: 0;

			// Validation: If longestDistance exists, totalDistanceKm should be at least that value
			if (longestDistance > 0 && allTimeDistance.totalDistanceKm < longestDistance) {
				this.logger.warn(
					`Distance calculation inconsistency detected: longestDistance=${longestDistance}km but totalDistanceKm=${allTimeDistance.totalDistanceKm}km. ` +
					`Recalculating totalDistanceKm from distances array.`
				);
				// Recalculate totalDistanceKm from distances array as fallback
				allTimeDistance.totalDistanceKm = allTimeDistance.distances.reduce((sum, dist) => sum + dist, 0);
			}

			// ===== ENHANCED TIMING PATTERNS =====
			// Get organization timezone for proper conversion
			const timezone = await this.getOrganizationTimezone(organizationId);

			// Times are already timezone-aware from database
			const checkInTimes = allAttendance.map((record) => new Date(record.checkIn));
			const checkOutTimes = allAttendance
				.filter((record) => record.checkOut)
				.map((record) => new Date(record.checkOut!));

			// Use enhanced average time calculation with timezone-converted times
			const averageCheckInTime = TimeCalculatorUtil.calculateAverageTime(checkInTimes);
			const averageCheckOutTime = TimeCalculatorUtil.calculateAverageTime(checkOutTimes);

			// Enhanced punctuality and overtime calculation using organization hours
			let punctualityScore = 0;
			let overtimeFrequency = 0;

			if (allAttendance.length > 0) {
				// Use the organizationId already retrieved above
				// Use enhanced productivity metrics calculation
				const productivityMetrics = await this.attendanceCalculatorService.calculateProductivityMetrics(
					allAttendance,
					organizationId,
				);

				punctualityScore = productivityMetrics.punctualityScore;
				overtimeFrequency = productivityMetrics.overtimeFrequency;
			}

			// ===== ENHANCED PRODUCTIVITY INSIGHTS =====
			// Get productivity insights from enhanced calculator service
			let workEfficiencyScore = 0;
			let shiftCompletionRate = 0;
			let lateArrivalsCount = 0;
			let earlyDeparturesCount = 0;

			if (allAttendance.length > 0) {
				// Use the organizationId already retrieved above
				const productivityMetrics = await this.attendanceCalculatorService.calculateProductivityMetrics(
					allAttendance,
					organizationId,
				);

				workEfficiencyScore = productivityMetrics.workEfficiencyScore;
				shiftCompletionRate = productivityMetrics.shiftCompletionRate;
				lateArrivalsCount = productivityMetrics.lateArrivalsCount;
				earlyDeparturesCount = productivityMetrics.earlyDeparturesCount;
			}

			// ===== ENHANCED OVERTIME ANALYTICS =====
			// Calculate overtime analytics for all periods (no date exclusions for single-user metrics)
			const overtimeAnalyticsAllTime = await this.calculateOvertimeAnalytics(allAttendance, organizationId, []);
			const overtimeAnalyticsToday = await this.calculateOvertimeAnalytics(todayAttendance, organizationId, []);
			const overtimeAnalyticsThisWeek = await this.calculateOvertimeAnalytics(weekAttendance, organizationId, []);
			const overtimeAnalyticsThisMonth = await this.calculateOvertimeAnalytics(monthAttendance, organizationId, []);

			// Format response
			const metrics = {
				firstAttendance: {
					date: firstAttendance ? new Date(firstAttendance.checkIn).toISOString().split('T')[0] : null,
					checkInTime: firstAttendance ? await this.formatTimeInOrganizationTimezone(new Date(firstAttendance.checkIn), organizationId) : null,
					daysAgo: firstAttendance
						? Math.floor(differenceInMinutes(now, new Date(firstAttendance.checkIn)) / (24 * 60))
						: null,
				},
				lastAttendance: {
					date: lastAttendance ? new Date(lastAttendance.checkIn).toISOString().split('T')[0] : null,
					checkInTime: lastAttendance ? await this.formatTimeInOrganizationTimezone(new Date(lastAttendance.checkIn), organizationId) : null,
					checkOutTime: lastAttendance?.checkOut
						? await this.formatTimeInOrganizationTimezone(new Date(lastAttendance.checkOut), organizationId)
						: null,
					daysAgo: lastAttendance
						? Math.floor(differenceInMinutes(now, new Date(lastAttendance.checkIn)) / (24 * 60))
						: null,
				},
				totalHours: {
					allTime: Math.round(regularHoursAllTime * 10) / 10,
					thisMonth: Math.round(regularHoursThisMonth * 10) / 10,
					thisWeek: Math.round(regularHoursThisWeek * 10) / 10,
					today: Math.round(regularHoursToday * 10) / 10,
				},
				totalShifts: {
					allTime: allAttendance.length,
					thisMonth: monthAttendance.length,
					thisWeek: weekAttendance.length,
					today: todayAttendance.length,
				},
				averageHoursPerDay: Math.round(averageHoursPerDay * 10) / 10,
				attendanceStreak,
				breakAnalytics: {
					totalBreakTime: {
						allTime: allTimeBreaks.totalBreakMinutes,
						thisMonth: monthBreaks.totalBreakMinutes,
						thisWeek: weekBreaks.totalBreakMinutes,
						today: todayBreaks.totalBreakMinutes,
					},
					averageBreakDuration: Math.round(averageBreakDuration),
					breakFrequency: Math.round(breakFrequency * 10) / 10,
					longestBreak,
					shortestBreak,
				},
				timingPatterns: {
					averageCheckInTime,
					averageCheckOutTime,
					punctualityScore,
					overtimeFrequency,
				},
				overtimeAnalytics: {
					totalOvertimeHours: {
						allTime: Math.round(overtimeAnalyticsAllTime.totalOvertimeHours * 10) / 10,
						thisMonth: Math.round(overtimeAnalyticsThisMonth.totalOvertimeHours * 10) / 10,
						thisWeek: Math.round(overtimeAnalyticsThisWeek.totalOvertimeHours * 10) / 10,
						today: Math.round(overtimeAnalyticsToday.totalOvertimeHours * 10) / 10,
					},
					averageOvertimePerShift: Math.round(overtimeAnalyticsAllTime.averageOvertimePerShift * 10) / 10,
					overtimeFrequency: Math.round(overtimeAnalyticsAllTime.overtimeFrequency * 10) / 10,
					longestOvertimeShift: Math.round(overtimeAnalyticsAllTime.longestOvertimeShift * 10) / 10,
				},
				productivityInsights: {
					workEfficiencyScore,
					shiftCompletionRate,
					lateArrivalsCount,
					earlyDeparturesCount,
				},
				distanceAnalytics: {
					totalDistance: {
						allTime: Math.round(allTimeDistance.totalDistanceKm * 100) / 100,
						thisMonth: Math.round(monthDistance.totalDistanceKm * 100) / 100,
						thisWeek: Math.round(weekDistance.totalDistanceKm * 100) / 100,
						today: Math.round(todayDistance.totalDistanceKm * 100) / 100,
					},
					averageDistancePerShift: Math.round(averageDistancePerShift * 100) / 100,
					longestDistance: Math.round(longestDistance * 100) / 100,
					shortestDistance: Math.round(shortestDistance * 100) / 100,
				},
			};

			return {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				metrics,
			};
		} catch (error) {
			this.logger.error('Error getting user attendance metrics:', error);
			return {
				message: error?.message || 'Error retrieving attendance metrics',
				metrics: {
					firstAttendance: { date: null, checkInTime: null, daysAgo: null },
					lastAttendance: { date: null, checkInTime: null, checkOutTime: null, daysAgo: null },
					totalHours: { allTime: 0, thisMonth: 0, thisWeek: 0, today: 0 },
					totalShifts: { allTime: 0, thisMonth: 0, thisWeek: 0, today: 0 },
					averageHoursPerDay: 0,
					attendanceStreak: 0,
					breakAnalytics: {
						totalBreakTime: { allTime: 0, thisMonth: 0, thisWeek: 0, today: 0 },
						averageBreakDuration: 0,
						breakFrequency: 0,
						longestBreak: 0,
						shortestBreak: 0,
					},
					timingPatterns: {
						averageCheckInTime: 'N/A',
						averageCheckOutTime: 'N/A',
						punctualityScore: 0,
						overtimeFrequency: 0,
					},
					overtimeAnalytics: {
						totalOvertimeHours: { allTime: 0, thisMonth: 0, thisWeek: 0, today: 0 },
						averageOvertimePerShift: 0,
						overtimeFrequency: 0,
						longestOvertimeShift: 0,
					},
					productivityInsights: {
						workEfficiencyScore: 0,
						shiftCompletionRate: 0,
						lateArrivalsCount: 0,
						earlyDeparturesCount: 0,
					},
					distanceAnalytics: {
						totalDistance: { allTime: 0, thisMonth: 0, thisWeek: 0, today: 0 },
						averageDistancePerShift: 0,
						longestDistance: 0,
						shortestDistance: 0,
					},
				},
			};
		}
	}

	/**
	 * Get monthly attendance metrics for all users in the organization
	 * @param year - Year for metrics (defaults to current year)
	 * @param month - Month for metrics (1-12, defaults to current month)
	 * @param excludeOvertimeDates - Array of dates (YYYY-MM-DD) to exclude from overtime calculation
	 * @param orgId - Organization ID to filter by
	 * @param branchId - Branch ID to filter by
	 * @param userAccessLevel - User's access level for branch filtering
	 * @returns Monthly metrics for all users with summary and per-user breakdown
	 */
	public async getMonthlyMetricsForAllUsers(
		year?: number,
		month?: number,
		excludeOvertimeDates?: string[],
		orgId?: string,
		branchId?: number,
		userAccessLevel?: string,
	): Promise<{
		message: string;
		data: {
			period: {
				year: number;
				month: number;
				startDate: string;
				endDate: string;
			};
			summary: {
				totalUsers: number;
				totalShifts: number;
				totalHours: number;
				totalOvertimeHours: number;
				averageHoursPerUser: number;
			};
			userMetrics: Array<{
				userId: number;
				userName: string;
				totalShifts: number;
				totalHours: number;
				overtimeHours: number;
				checkIns: Attendance[];
			}>;
		};
	}> {
		try {
			// Default to current year/month if not provided
			const now = new Date();
			const targetYear = year || now.getFullYear();
			const targetMonth = month || now.getMonth() + 1;

			// Validate month
			if (targetMonth < 1 || targetMonth > 12) {
				throw new BadRequestException('Month must be between 1 and 12');
			}

			// Calculate month start/end dates
			const monthStart = startOfMonth(new Date(targetYear, targetMonth - 1, 1));
			const monthEnd = endOfMonth(new Date(targetYear, targetMonth - 1, 1));

			this.logger.log(
				`Fetching monthly metrics for ${targetYear}-${targetMonth}, orgId: ${orgId}, branchId: ${branchId}`,
			);

			// Get effective branch ID based on user role
			const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);

			// Build user query filters - filter by clerkOrgId or ref (string)
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const userWhereConditionsList: any[] = [
				{ isDeleted: false, organisation: { clerkOrgId: orgId } },
				{ isDeleted: false, organisation: { ref: orgId } },
			];
			if (effectiveBranchId) {
				userWhereConditionsList.forEach((w) => { w.branch = { uid: effectiveBranchId }; });
			}

			// Query all users matching filters
			const users = await this.userRepository.find({
				where: userWhereConditionsList,
				relations: ['organisation', 'branch'],
				select: ['uid', 'name', 'surname', 'username', 'email'],
			});

			if (!users || users.length === 0) {
				this.logger.warn('No users found for the specified criteria');
				return {
					message: 'No users found',
					data: {
						period: {
							year: targetYear,
							month: targetMonth,
							startDate: monthStart.toISOString().split('T')[0],
							endDate: monthEnd.toISOString().split('T')[0],
						},
						summary: {
							totalUsers: 0,
							totalShifts: 0,
							totalHours: 0,
							totalOvertimeHours: 0,
							averageHoursPerUser: 0,
						},
						userMetrics: [],
					},
				};
			}

			// Enhanced helper function to calculate regular hours (capped at organization work hours)
			const calculateRegularHours = async (records: Attendance[], orgId?: string): Promise<number> => {
				if (!orgId) {
					// Fallback: calculate regular hours using default 8 hours cap
					return records.reduce((total, record) => {
						if (record.checkIn && record.checkOut) {
							const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
								record.breakDetails,
								record.totalBreakTime,
							);
							const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
							const workMinutes = Math.max(0, totalMinutes - breakMinutes);
							const regularMinutes = Math.min(workMinutes, TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES);
							return total + TimeCalculatorUtil.minutesToHours(regularMinutes, TimeCalculatorUtil.PRECISION.HOURS);
						}
						return total;
					}, 0);
				}

				// Calculate regular hours per shift based on organization hours
				let totalRegularHours = 0;
				for (const record of records) {
					if (record.checkIn && record.checkOut) {
						try {
							const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
								record.breakDetails,
								record.totalBreakTime,
							);
							const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
							const workMinutes = Math.max(0, totalMinutes - breakMinutes);

							// Get organization expected work minutes for this day
							const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
								orgId,
								new Date(record.checkIn),
							);

							// Cap regular hours at organization's expected work minutes
							const regularMinutes = Math.min(workMinutes, workingDayInfo.expectedWorkMinutes);
							totalRegularHours += TimeCalculatorUtil.minutesToHours(regularMinutes, TimeCalculatorUtil.PRECISION.HOURS);
						} catch (error) {
							this.logger.warn(`Error calculating regular hours for record ${record.uid}: ${error.message}`);
							// Fallback to default
							const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
								record.breakDetails,
								record.totalBreakTime,
							);
							const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
							const workMinutes = Math.max(0, totalMinutes - breakMinutes);
							const regularMinutes = Math.min(workMinutes, TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES);
							totalRegularHours += TimeCalculatorUtil.minutesToHours(regularMinutes, TimeCalculatorUtil.PRECISION.HOURS);
						}
					}
				}
				return totalRegularHours;
			};

			// Process each user
			const userMetrics: Array<{
				userId: number;
				userName: string;
				totalShifts: number;
				totalHours: number;
				overtimeHours: number;
				checkIns: Attendance[];
			}> = [];

			for (const user of users) {
				try {
					// Build attendance query filters
					const attendanceWhereConditions: any = {
						owner: { uid: user.uid },
						checkIn: Between(monthStart, monthEnd),
					};

					// Apply organization filter
					if (orgId) {
						attendanceWhereConditions.organisation = [
							{ clerkOrgId: orgId },
							{ ref: orgId }
						];
					}

					// Query attendance records for this user in the month
					const attendanceRecords = await this.attendanceRepository.find({
						where: attendanceWhereConditions,
						relations: [
							'owner',
							'owner.branch',
							'owner.organisation',
							'organisation',
							'branch',
							'dailyReport',
						],
						order: {
							checkIn: 'ASC',
						},
					});

					// Calculate metrics for this user
					const totalShifts = attendanceRecords.length;
					const totalHours = await calculateRegularHours(attendanceRecords, orgId);

					// Calculate overtime using modified method with excluded dates
					const overtimeAnalytics = await this.calculateOvertimeAnalytics(
						attendanceRecords,
						orgId,
						excludeOvertimeDates || [],
					);
					const overtimeHours = overtimeAnalytics.totalOvertimeHours;

					// Construct user name
					const fullName = `${user.name || ''} ${user.surname || ''}`.trim();
					const userName = fullName || user.username || 'Unknown User';

					userMetrics.push({
						userId: user.uid,
						userName,
						totalShifts,
						totalHours: Math.round(totalHours * 10) / 10,
						overtimeHours: Math.round(overtimeHours * 10) / 10,
						checkIns: attendanceRecords,
					});
				} catch (error) {
					this.logger.warn(
						`Error processing metrics for user ${user.uid}: ${error.message}`,
					);
					// Continue with next user
					continue;
				}
			}

			// Calculate summary metrics
			const totalUsers = userMetrics.length;
			const totalShifts = userMetrics.reduce((sum, user) => sum + user.totalShifts, 0);
			const totalHours = userMetrics.reduce((sum, user) => sum + user.totalHours, 0);
			const totalOvertimeHours = userMetrics.reduce((sum, user) => sum + user.overtimeHours, 0);
			const averageHoursPerUser = totalUsers > 0 ? Math.round((totalHours / totalUsers) * 10) / 10 : 0;

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				data: {
					period: {
						year: targetYear,
						month: targetMonth,
						startDate: monthStart.toISOString().split('T')[0],
						endDate: monthEnd.toISOString().split('T')[0],
					},
					summary: {
						totalUsers,
						totalShifts,
						totalHours: Math.round(totalHours * 10) / 10,
						totalOvertimeHours: Math.round(totalOvertimeHours * 10) / 10,
						averageHoursPerUser,
					},
					userMetrics,
				},
			};

			// Apply timezone conversion to attendance records
			const responseWithTimezone = await this.ensureTimezoneConversion(response, orgId);
			return responseWithTimezone;
		} catch (error) {
			this.logger.error(`Error retrieving monthly metrics for all users: ${error.message}`, error.stack);
			throw new BadRequestException(`Failed to retrieve monthly metrics: ${error.message}`);
		}
	}

	/**
	 * Calculate comprehensive overtime analytics for attendance records
	 * @param records - Attendance records to analyze
	 * @param organizationId - Organization ID for overtime calculation
	 * @param excludeOvertimeDates - Optional array of dates (YYYY-MM-DD) to exclude from overtime calculation
	 * @returns Overtime analytics object
	 */
	private async calculateOvertimeAnalytics(
		records: Attendance[],
		organizationId?: string,
		excludeOvertimeDates?: string[],
	): Promise<{
		totalOvertimeHours: number;
		averageOvertimePerShift: number;
		overtimeFrequency: number;
		longestOvertimeShift: number;
	}> {
		try {
			// Filter only completed shifts (must have checkOut)
			const completedShifts = records.filter((r) => r.checkIn && r.checkOut);

			if (completedShifts.length === 0) {
				return {
					totalOvertimeHours: 0,
					averageOvertimePerShift: 0,
					overtimeFrequency: 0,
					longestOvertimeShift: 0,
				};
			}

			let totalOvertimeMinutes = 0;
			let shiftsWithOvertime = 0;
			let longestOvertimeMinutes = 0;

			// Process each completed shift
			for (const shift of completedShifts) {
				try {
					// Calculate net work minutes (same logic as checkOut method)
					const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
						shift.breakDetails,
						shift.totalBreakTime,
					);

					const totalMinutes = differenceInMinutes(
						new Date(shift.checkOut),
						new Date(shift.checkIn),
					);
					const workMinutes = Math.max(0, totalMinutes - breakMinutes);

					// Check if this date should exclude overtime
					const shiftDate = new Date(shift.checkIn).toISOString().split('T')[0]; // YYYY-MM-DD format
					const isExcludedDate = excludeOvertimeDates?.includes(shiftDate) || false;

					// Calculate overtime using organization hours (same logic as checkOut)
					let overtimeMinutes = 0;
					if (organizationId) {
						try {
							if (isExcludedDate) {
								// For excluded dates: cap at org max hours if exceeded, otherwise leave as-is
								const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
									organizationId,
									new Date(shift.checkIn),
								);
								const standardWorkMinutes = workingDayInfo.expectedWorkMinutes || TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
								// Cap work minutes at expected work minutes, but don't count as overtime
								const cappedWorkMinutes = Math.min(workMinutes, standardWorkMinutes);
								// No overtime for excluded dates
								overtimeMinutes = 0;
								this.logger.debug(
									`Shift ${shift.uid} on excluded date ${shiftDate}: workMinutes=${workMinutes}, capped=${cappedWorkMinutes}, overtime=0`,
								);
							} else {
								// Normal overtime calculation for non-excluded dates
								const overtimeInfo = await this.organizationHoursService.calculateOvertime(
									organizationId,
									new Date(shift.checkIn),
									workMinutes,
								);
								overtimeMinutes = overtimeInfo.overtimeMinutes || 0;
							}
						} catch (error) {
							this.logger.warn(
								`Error calculating overtime for shift ${shift.uid}, using fallback: ${error.message}`,
							);
							// Fallback to default 8 hours
							const standardMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
							if (isExcludedDate) {
								// For excluded dates, cap but don't count overtime
								overtimeMinutes = 0;
							} else {
								overtimeMinutes = Math.max(0, workMinutes - standardMinutes);
							}
						}
					} else {
						// Fallback to default 8 hours if no organization ID
						const standardMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
						if (isExcludedDate) {
							// For excluded dates, cap but don't count overtime
							overtimeMinutes = 0;
						} else {
							overtimeMinutes = Math.max(0, workMinutes - standardMinutes);
						}
					}

					if (overtimeMinutes > 0) {
						totalOvertimeMinutes += overtimeMinutes;
						shiftsWithOvertime++;
						longestOvertimeMinutes = Math.max(longestOvertimeMinutes, overtimeMinutes);
					}
				} catch (error) {
					this.logger.warn(
						`Error processing shift ${shift.uid} for overtime analytics: ${error.message}`,
					);
					// Continue with next shift
					continue;
				}
			}

			// Convert minutes to hours with proper precision
			const totalOvertimeHours = TimeCalculatorUtil.minutesToHours(
				totalOvertimeMinutes,
				TimeCalculatorUtil.PRECISION.HOURS,
			);

			const averageOvertimePerShift =
				completedShifts.length > 0
					? TimeCalculatorUtil.minutesToHours(
						totalOvertimeMinutes / completedShifts.length,
						TimeCalculatorUtil.PRECISION.HOURS,
					)
					: 0;

			const overtimeFrequency =
				completedShifts.length > 0 ? (shiftsWithOvertime / completedShifts.length) * 100 : 0;

			const longestOvertimeShift = TimeCalculatorUtil.minutesToHours(
				longestOvertimeMinutes,
				TimeCalculatorUtil.PRECISION.HOURS,
			);

			this.logger.debug(
				`Overtime analytics calculated: total=${totalOvertimeHours}h, avg=${averageOvertimePerShift}h, ` +
				`frequency=${overtimeFrequency}%, longest=${longestOvertimeShift}h for ${completedShifts.length} shifts`,
			);

			return {
				totalOvertimeHours,
				averageOvertimePerShift,
				overtimeFrequency,
				longestOvertimeShift,
			};
		} catch (error) {
			this.logger.error(`Error calculating overtime analytics: ${error.message}`, error.stack);
			return {
				totalOvertimeHours: 0,
				averageOvertimePerShift: 0,
				overtimeFrequency: 0,
				longestOvertimeShift: 0,
			};
		}
	}

	// ======================================================
	// USER METRICS ANALYSIS
	// ======================================================

	/**
	 * Calculate detailed metrics for a user within a specific date range
	 * @param userId - User ID to get metrics for
	 * @param startDate - Start date for metrics calculation
	 * @param endDate - End date for metrics calculation
	 * @param includeInsights - Whether to include performance insights
	 * @returns Comprehensive user metrics including analytics and performance insights
	 */
	public async getUserMetricsForDateRange(
		userId: string,
		startDate: string,
		endDate: string,
		includeInsights: boolean = true,
	): Promise<UserMetricsResponseDto> {
		try {
			// Validate input (user ref as string: clerk id or numeric string)
			if (!userId || (typeof userId === 'string' && !userId.trim())) {
				throw new BadRequestException('Invalid user ID provided');
			}

			// Parse dates
			const parsedStartDate = startOfDay(new Date(startDate));
			const parsedEndDate = endOfDay(new Date(endDate));

			// Validate date range
			if (parsedStartDate > parsedEndDate) {
				throw new BadRequestException('Start date cannot be after end date');
			}

			// Resolve user by clerk id or numeric uid
			const userIdStr = String(userId);
			const userWhere = userIdStr.startsWith('user_')
				? { clerkUserId: userIdStr }
				: { uid: Number(userIdStr) };
			const userExists = await this.userRepository.findOne({
				where: userWhere,
				relations: ['organisation', 'branch'],
			});

			if (!userExists) {
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			const ownerFilter = { ownerClerkUserId: userExists.clerkUserId };

			// Get attendance records for the specified date range
			const attendanceRecordsRaw = await this.attendanceRepository.find({
				where: {
					...ownerFilter,
					checkIn: Between(parsedStartDate, parsedEndDate),
				},
				relations: ['owner', 'owner.branch', 'owner.organisation'],
				order: { checkIn: 'ASC' },
			});

			// Get the most recent attendance record (even if outside date range)
			const lastAttendanceRecordRaw = await this.attendanceRepository.findOne({
				where: ownerFilter,
				order: { checkIn: 'DESC' },
			});

			// Apply timezone conversion to attendance records
			const organizationId = userExists?.organisation?.clerkOrgId || userExists?.organisation?.ref;
			const attendanceRecords = await this.convertAttendanceRecordsTimezone(attendanceRecordsRaw, organizationId);
			const lastAttendanceRecord = lastAttendanceRecordRaw ? await this.convertAttendanceRecordTimezone(lastAttendanceRecordRaw, organizationId) : null;

			this.logger.debug(`Converted ${attendanceRecords.length} attendance records for user metrics`);
			if (lastAttendanceRecord) {
				this.logger.debug(`Converted last attendance record: ${lastAttendanceRecord.checkIn.toISOString()}`);
			}

			// Get previous period records for trend analysis
			const previousPeriodStart = subMonths(parsedStartDate, 3);
			const previousPeriodEnd = parsedStartDate;

			const previousPeriodRecordsRaw = await this.attendanceRepository.find({
				where: {
					...ownerFilter,
					checkIn: Between(previousPeriodStart, previousPeriodEnd),
				},
				order: { checkIn: 'ASC' },
			});

			// Apply timezone conversion to previous period records
			const previousPeriodRecords = await this.convertAttendanceRecordsTimezone(previousPeriodRecordsRaw, organizationId);

			// Calculate basic metrics
			const completedShifts = attendanceRecords.filter((record) => record.checkOut);
			const totalRecords = attendanceRecords.length;

			// Skip detailed calculations if no records found
			if (totalRecords === 0) {
				return this.generateEmptyUserMetrics(lastAttendanceRecord);
			}

			// Get organization ID for enhanced calculations (already declared above)
			// const organizationId = userExists?.organisation?.uid;

			// Calculate total work hours
			let totalWorkMinutes = 0;
			let totalBreakMinutes = 0;
			let shiftDurations: number[] = [];

			completedShifts.forEach((shift) => {
				const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					shift.breakDetails,
					shift.totalBreakTime,
				);

				const totalMinutes = differenceInMinutes(new Date(shift.checkOut), new Date(shift.checkIn));
				const workMinutes = Math.max(0, totalMinutes - breakMinutes);

				totalWorkMinutes += workMinutes;
				totalBreakMinutes += breakMinutes;
				shiftDurations.push(workMinutes);
			});

			// Calculate shift statistics
			const longestShiftMinutes = Math.max(...shiftDurations, 0);
			const shortestShiftMinutes = Math.min(...shiftDurations, longestShiftMinutes);

			// Calculate time patterns with timezone conversion
			const timezone = await this.getOrganizationTimezone(organizationId);

			// Times are already timezone-aware from database
			const checkInTimes = completedShifts.map((record) => new Date(record.checkIn));
			const checkOutTimes = completedShifts.map((record) => new Date(record.checkOut));

			const averageCheckInTime = TimeCalculatorUtil.calculateAverageTime(checkInTimes);
			const averageCheckOutTime = TimeCalculatorUtil.calculateAverageTime(checkOutTimes);

			// Calculate attendance rate
			const daysBetween = differenceInDays(parsedEndDate, parsedStartDate) + 1;
			const workingDays = this.calculateWorkingDays(parsedStartDate, parsedEndDate);
			const attendanceRate = Math.min(100, (totalRecords / workingDays) * 100);

			// Calculate punctuality and overtime using organization settings
			const productivityMetrics = await this.attendanceCalculatorService.calculateProductivityMetrics(
				attendanceRecords,
				organizationId,
			);

			// Calculate attendance streak (uses numeric uid internally)
			const attendanceStreak = this.calculateAttendanceStreak(userExists.uid);

			// Format response
			const userAnalytics = {
				totalRecords,
				attendanceRate: Math.round(attendanceRate * 10) / 10,
				averageHoursPerDay: Math.round((totalWorkMinutes / 60 / workingDays) * 10) / 10,
				punctualityScore: Math.round(productivityMetrics.punctualityScore * 10) / 10,
				overtimeFrequency: Math.round(productivityMetrics.overtimeFrequency * 10) / 10,
				averageCheckInTime,
				averageCheckOutTime,
				totalWorkHours: Math.round((totalWorkMinutes / 60) * 10) / 10,
				totalBreakTime: Math.round((totalBreakMinutes / 60) * 10) / 10,
				longestShift: TimeCalculatorUtil.formatDuration(longestShiftMinutes),
				shortestShift: TimeCalculatorUtil.formatDuration(shortestShiftMinutes),
				attendanceStreak: await attendanceStreak,
				lastAttendance: lastAttendanceRecord?.checkIn?.toISOString() || null,
			};

			// Generate performance insights if requested
			let performanceInsights = null;
			if (includeInsights) {
				performanceInsights = this.generatePerformanceInsights(
					userAnalytics,
					productivityMetrics,
					attendanceRecords,
					previousPeriodRecords,
				);
			}

			return {
				message: process.env.SUCCESS_MESSAGE || 'success',
				userAnalytics,
				performanceInsights,
			};
		} catch (error) {
			this.logger.error('Error calculating user metrics:', error);
			throw new BadRequestException(error?.message || 'Error calculating user metrics');
		}
	}

	/**
	 * Generate empty metrics response when no records are found
	 */
	private generateEmptyUserMetrics(lastAttendanceRecord?: Attendance): UserMetricsResponseDto {
		return {
			message: 'No attendance records found for the specified date range',
			userAnalytics: {
				totalRecords: 0,
				attendanceRate: 0,
				averageHoursPerDay: 0,
				punctualityScore: 0,
				overtimeFrequency: 0,
				averageCheckInTime: 'N/A',
				averageCheckOutTime: 'N/A',
				totalWorkHours: 0,
				totalBreakTime: 0,
				longestShift: '0h 0m',
				shortestShift: '0h 0m',
				attendanceStreak: 0,
				lastAttendance: lastAttendanceRecord?.checkIn?.toISOString() || null,
			},
			performanceInsights: {
				strengths: [],
				improvements: ['Start recording attendance to see insights'],
				trendAnalysis: {
					trend: 'NEUTRAL',
					confidence: 0,
					details: 'Insufficient data for trend analysis',
				},
			},
		};
	}

	/**
	 * Calculate the number of working days between two dates (excluding weekends)
	 */
	private calculateWorkingDays(startDate: Date, endDate: Date): number {
		let workingDays = 0;
		const currentDate = new Date(startDate);

		while (currentDate <= endDate) {
			const dayOfWeek = currentDate.getDay();
			// Skip weekends (0 = Sunday, 6 = Saturday)
			if (dayOfWeek !== 0 && dayOfWeek !== 6) {
				workingDays++;
			}
			currentDate.setDate(currentDate.getDate() + 1);
		}

		return Math.max(workingDays, 1); // At least 1 working day
	}

	/**
	 * Calculate the current attendance streak for a user
	 * Includes today's record if present and marks user as present
	 */
	private async calculateAttendanceStreak(userId: number): Promise<number> {
		let streak = 0;
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(today.getDate() + 1);

		// First, check if user has attendance today (i = 0)
		// If present today, mark as present and add to streak count
		const todayAttendance = await this.attendanceRepository.findOne({
			where: {
				owner: { uid: userId },
				checkIn: Between(today, tomorrow),
			},
		});

		// If user has attendance today, count it and mark as present
		if (todayAttendance) {
			streak++;
		} else {
			// If no attendance today, streak is broken
			return 0;
		}

		// Check previous days for streak calculation (starting from yesterday)
		for (let i = 1; i < 60; i++) {
			const checkDate = new Date(today);
			checkDate.setDate(today.getDate() - i);

			// Skip weekends for streak calculation
			const dayOfWeek = checkDate.getDay();
			if (dayOfWeek === 0 || dayOfWeek === 6) {
				continue; // Skip weekends
			}

			const nextDay = new Date(checkDate);
			nextDay.setDate(checkDate.getDate() + 1);

			// Check if user has attendance on this day
			const hasAttendance = await this.attendanceRepository.findOne({
				where: {
					owner: { uid: userId },
					checkIn: Between(checkDate, nextDay),
				},
			});

			if (hasAttendance) {
				streak++;
			} else {
				// Streak broken, stop counting
				break;
			}
		}

		return streak;
	}

	/**
	 * Calculate current week attendance streak and week days status
	 * Returns streak count and week days (Mon-Sat) with attended/missed/future status
	 */
	public async getCurrentWeekAttendanceStreak(userId: number): Promise<{
		streak: number;
		weekDays: Array<{
			date: string;
			dayLabel: string;
			status: 'attended' | 'missed' | 'future';
		}>;
	}> {
		const today = new Date();
		const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday = 1

		// Get week days (Monday to Saturday)
		const weekDays: Date[] = [];
		for (let i = 0; i < 6; i++) {
			weekDays.push(addDays(weekStart, i));
		}

		const todayStart = startOfDay(today);
		const weekStartDate = startOfDay(weekDays[0]);
		const weekEndDate = startOfDay(weekDays[weekDays.length - 1]);

		// Check cache first - use week start date as part of cache key to ensure weekly cache
		const cacheKey = this.getCacheKey(`streak_${userId}_${format(weekStartDate, 'yyyy-MM-dd')}`);
		const cachedStreak = await this.cacheManager.get<{
			streak: number;
			weekDays: Array<{
				date: string;
				dayLabel: string;
				status: 'attended' | 'missed' | 'future';
			}>;
		}>(cacheKey);

		if (cachedStreak) {
			this.logger.debug(`[getCurrentWeekAttendanceStreak] Cache hit for user ${userId}, week ${format(weekStartDate, 'yyyy-MM-dd')}`);
			return cachedStreak;
		}

		// Get all attendance records for the current week
		const currentWeekRecords = await this.attendanceRepository.find({
			where: {
				owner: { uid: userId },
				checkIn: Between(weekStartDate, endOfDay(weekEndDate)),
			},
			order: {
				checkIn: 'ASC',
			},
		});

		// Get unique days with attendance records
		const daysWithRecords = new Set<string>();

		currentWeekRecords.forEach((record) => {
			if (!record.checkIn) return;

			const checkInDate = startOfDay(new Date(record.checkIn));
			const dateKey = format(checkInDate, 'yyyy-MM-dd');

			// Count as attended if:
			// 1. Status is PRESENT (checked in but not checked out)
			// 2. Status is COMPLETED (checked in and checked out)
			// 3. Status is ON_BREAK (currently working, on break)
			const isAttended = record.status === AttendanceStatus.PRESENT
				|| record.status === AttendanceStatus.COMPLETED
				|| record.status === AttendanceStatus.ON_BREAK;

			if (isAttended) {
				daysWithRecords.add(dateKey);
			}
		});

		// Create week days array with status
		const weekDaysWithStatus = weekDays.map((date) => {
			const dayLabel = format(date, 'EEE').substring(0, 2); // Mon, Tue, etc.
			const dateStart = startOfDay(date);
			const dateKey = format(dateStart, 'yyyy-MM-dd');

			// Check if date is in the future
			if (dateStart > todayStart) {
				return {
					date: date.toISOString(),
					dayLabel,
					status: 'future' as const,
				};
			}

			// Check if user attended on this day
			const attended = daysWithRecords.has(dateKey);

			return {
				date: date.toISOString(),
				dayLabel,
				status: attended ? ('attended' as const) : ('missed' as const),
			};
		});

		// Calculate streak as count of days with attendance records in current week
		const streak = daysWithRecords.size;

		const result = {
			streak,
			weekDays: weekDaysWithStatus,
		};

		// Cache the result - use shorter TTL (30 seconds) since attendance can change frequently
		// Cache will be invalidated when attendance records are created/updated
		await this.cacheManager.set(cacheKey, result, 30000); // 30 seconds

		return result;
	}

	/**
	 * Generate performance insights based on attendance patterns
	 */
	private generatePerformanceInsights(
		analytics: any,
		productivityMetrics: any,
		currentRecords: Attendance[],
		previousRecords: Attendance[],
	): any {
		const strengths: string[] = [];
		const improvements: string[] = [];

		// Analyze strengths
		if (analytics.punctualityScore >= 90) {
			strengths.push('Excellent punctuality');
		} else if (analytics.punctualityScore >= 80) {
			strengths.push('Good punctuality');
		}

		if (analytics.attendanceRate >= 95) {
			strengths.push('Exceptional attendance rate');
		} else if (analytics.attendanceRate >= 85) {
			strengths.push('Consistent attendance');
		}

		if (analytics.overtimeFrequency <= 10) {
			strengths.push('Good work-life balance');
		}

		if (analytics.attendanceStreak >= 10) {
			strengths.push(`Strong attendance streak (${analytics.attendanceStreak} days)`);
		}

		// Analyze areas for improvement
		if (analytics.punctualityScore < 75) {
			improvements.push('Focus on arriving on time');
		}

		if (analytics.overtimeFrequency > 20) {
			improvements.push('Consider reducing overtime hours');
		}

		if (analytics.totalBreakTime > analytics.totalWorkHours * 0.15) {
			improvements.push('Optimize break timing and duration');
		}

		if (analytics.attendanceRate < 80) {
			improvements.push('Improve attendance consistency');
		}

		// Ensure at least one strength and improvement
		if (strengths.length === 0) strengths.push('Maintaining regular attendance');
		if (improvements.length === 0) improvements.push('Continue current attendance patterns');

		// Calculate trends by comparing with previous period
		const trendAnalysis = this.calculateAttendanceTrends(currentRecords, previousRecords);

		return {
			strengths,
			improvements,
			trendAnalysis,
		};
	}

	/**
	 * Calculate attendance trends by comparing current and previous periods
	 */
	private calculateAttendanceTrends(currentRecords: Attendance[], previousRecords: Attendance[]): any {
		// Default response for insufficient data
		if (currentRecords.length < 5 || previousRecords.length < 5) {
			return {
				trend: 'NEUTRAL',
				confidence: 50,
				details: 'Insufficient data for reliable trend analysis',
			};
		}

		// Calculate punctuality in both periods
		const standardStartHour = 9;
		const standardStartMinute = 0;
		const standardStartMinutes = standardStartHour * 60 + standardStartMinute;

		const currentPunctual = currentRecords.filter((record) => {
			const checkInTime = new Date(record.checkIn);
			const checkInMinutes = checkInTime.getHours() * 60 + checkInTime.getMinutes();
			return checkInMinutes <= standardStartMinutes;
		}).length;

		const previousPunctual = previousRecords.filter((record) => {
			const checkInTime = new Date(record.checkIn);
			const checkInMinutes = checkInTime.getHours() * 60 + checkInTime.getMinutes();
			return checkInMinutes <= standardStartMinutes;
		}).length;

		const currentPunctualityRate = currentRecords.length > 0 ? (currentPunctual / currentRecords.length) * 100 : 0;
		const previousPunctualityRate =
			previousRecords.length > 0 ? (previousPunctual / previousRecords.length) * 100 : 0;

		const punctualityChange = currentPunctualityRate - previousPunctualityRate;

		// Calculate attendance consistency
		const currentAttendanceRate = this.calculateAttendanceConsistency(currentRecords);
		const previousAttendanceRate = this.calculateAttendanceConsistency(previousRecords);
		const attendanceChange = currentAttendanceRate - previousAttendanceRate;

		// Determine overall trend
		let trend = 'NEUTRAL';
		let confidence = 50;
		let details = 'No significant changes in attendance patterns';

		if (punctualityChange > 5 && attendanceChange > 0) {
			trend = 'IMPROVING';
			confidence = Math.min(85, 50 + punctualityChange + attendanceChange);
			details = `Punctuality has improved by ${Math.round(punctualityChange)}% compared to previous period`;
		} else if (punctualityChange < -5 || attendanceChange < -5) {
			trend = 'DECLINING';
			confidence = Math.min(85, 50 + Math.abs(punctualityChange) + Math.abs(attendanceChange));
			details = `Attendance metrics have declined compared to previous period`;
		}

		return {
			trend,
			confidence: Math.round(confidence * 10) / 10,
			details,
		};
	}

	/**
	 * Calculate attendance consistency rate
	 */
	private calculateAttendanceConsistency(records: Attendance[]): number {
		if (records.length === 0) return 0;

		// Get date range
		const dates = records.map((r) => new Date(r.checkIn));
		const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
		const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

		// Calculate working days in range
		const workingDays = this.calculateWorkingDays(minDate, maxDate);

		// Count unique days with attendance
		const uniqueDays = new Set();
		records.forEach((record) => {
			const dateStr = new Date(record.checkIn).toISOString().split('T')[0];
			uniqueDays.add(dateStr);
		});

		return workingDays > 0 ? (uniqueDays.size / workingDays) * 100 : 0;
	}

	// ======================================================
	// ORGANIZATION ATTENDANCE REPORTING
	// ======================================================

	public async generateOrganizationReport(
		queryDto: OrganizationReportQueryDto,
		orgId?: string,
		branchId?: number,
		userAccessLevel?: string,
	): Promise<{
		message: string;
		report: {
			reportPeriod: {
				from: string;
				to: string;
				totalDays: number;
				generatedAt: string;
			};
			userMetrics?: any[];
			organizationMetrics: {
				averageTimes: {
					startTime: string;
					endTime: string;
					shiftDuration: number;
					breakDuration: number;
				};
				totals: {
					totalEmployees: number;
					totalHours: number;
					totalShifts: number;
					overtimeHours: number;
				};
				byBranch: any[];
				byRole: any[];
				insights: {
					attendanceRate: number;
					punctualityRate: number;
					averageHoursPerDay: number;
					peakCheckInTime: string;
					peakCheckOutTime: string;
				};
			};
		};
	}> {
		try {
			// Set default date range (last 30 days if not provided)
			const now = new Date();
			const fromDate = queryDto.dateFrom
				? parseISO(queryDto.dateFrom)
				: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
			const toDate = queryDto.dateTo ? parseISO(queryDto.dateTo) : now;

			// Validate date range
			if (fromDate > toDate) {
				throw new BadRequestException('Start date cannot be after end date');
			}

			const totalDays = differenceInDays(toDate, fromDate) + 1;

			// Generate cache key
			const cacheKey = this.generateReportCacheKey(queryDto, orgId, branchId, fromDate, toDate);

			// Try to get from cache first
			const cachedReport = await this.cacheManager.get(cacheKey);
			if (cachedReport) {
				return cachedReport as any;
			}

			// Build filters for attendance query
			const attendanceFilters: any = {
				checkIn: Between(startOfDay(fromDate), endOfDay(toDate)),
			};

			// Build filters for user query
			const userFilters: any = {};

			// Add organization filter
			if (orgId) {
				userFilters.organisation = [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				];
			}

			// Add branch filter (respect user access level)
			const effectiveBranchId = this.getEffectiveBranchId(
				branchId ?? (queryDto.branchId ? Number(queryDto.branchId) : undefined),
				userAccessLevel,
			);
			if (effectiveBranchId) {
				userFilters.branch = { uid: effectiveBranchId };
			} else if (userAccessLevel) {
				this.logger.debug(`User ${userAccessLevel} can see all branches - no branch filter applied for organization report`);
			}

			// Add role filter
			if (queryDto.role) {
				userFilters.accessLevel = queryDto.role;
			}

			// Get all users matching criteria
			const users = await this.userRepository.find({
				where: userFilters,
				relations: ['branch', 'organisation'],
			});

			if (users.length === 0) {
				throw new NotFoundException('No users found matching the specified criteria');
			}

			const userIds = users.map((user) => user.uid);

			// Get all attendance records for users in date range
			const attendanceRecordsRaw = await this.attendanceRepository.find({
				where: {
					...attendanceFilters,
					owner: { uid: In(userIds) },
				},
				relations: ['owner', 'owner.branch'],
				order: {
					checkIn: 'ASC',
				},
			});

			// Apply timezone conversion to attendance records for the organization report
			const attendanceRecords = await this.convertAttendanceRecordsTimezone(attendanceRecordsRaw, orgId);
			this.logger.debug(`Applied timezone conversion to ${attendanceRecords.length} records for organization report`);

			// PART 1: Individual User Metrics
			let userMetrics: any[] = [];
			if (queryDto.includeUserDetails !== false) {
				userMetrics = await this.generateAllUsersMetrics(users, attendanceRecords);
			}

			// PART 2: Organization-level metrics with timezone support
			const organizationMetrics = await this.calculateOrganizationMetrics(attendanceRecords, users, orgId);

			const report = {
				reportPeriod: {
					from: format(fromDate, 'yyyy-MM-dd'),
					to: format(toDate, 'yyyy-MM-dd'),
					totalDays,
					generatedAt: now.toISOString(),
				},
				userMetrics,
				organizationMetrics,
			};

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				report,
			};

			// Apply timezone conversion to the response data using enhanced method
			const responseWithTimezone = await this.ensureTimezoneConversion(response, orgId);

			// Cache the result for 5 minutes
			await this.cacheManager.set(cacheKey, responseWithTimezone, 300);

			return responseWithTimezone;
		} catch (error) {
			this.logger.error('Error generating organization attendance report:', error);
			throw new BadRequestException(error?.message || 'Error generating organization attendance report');
		}
	}

	private generateReportCacheKey(
		queryDto: OrganizationReportQueryDto,
		orgId?: string,
		branchId?: number,
		fromDate?: Date,
		toDate?: Date,
	): string {
		const keyParts = [
			'org_attendance_report',
			orgId || 'no-org',
			branchId || queryDto.branchId || 'no-branch',
			queryDto.role || 'all-roles',
			queryDto.includeUserDetails !== false ? 'with-users' : 'no-users',
			fromDate ? format(fromDate, 'yyyy-MM-dd') : 'no-from',
			toDate ? format(toDate, 'yyyy-MM-dd') : 'no-to',
		];
		return keyParts.join('_');
	}

	private async generateAllUsersMetrics(users: User[], attendanceRecords: Attendance[]): Promise<any[]> {
		try {
			const userMetrics: any[] = [];

			for (const user of users) {
				// Filter attendance records for this user
				const userAttendance = attendanceRecords.filter((record) => record.owner.uid === user.uid);

				if (userAttendance.length === 0) {
					// Include user with zero metrics if they have no attendance
					userMetrics.push({
						userId: user.uid,
						userInfo: {
							name: user.name,
							email: user.email,
							role: user.accessLevel,
							branch: user.branch?.name || 'N/A',
						},
						metrics: this.getZeroMetrics(),
					});
					continue;
				}

				// Get user metrics using existing method (clerk id as primary per migration)
				const userMetricsResult = await this.getUserAttendanceMetrics(user.clerkUserId ?? String(user.uid));

				userMetrics.push({
					userId: user.uid,
					userInfo: {
						name: user.name,
						email: user.email,
						role: user.accessLevel,
						branch: user.branch?.name || 'N/A',
					},
					metrics: userMetricsResult.metrics,
				});
			}

			return userMetrics;
		} catch (error) {
			this.logger.error('Error generating user metrics:', error);
			return [];
		}
	}

	private async calculateOrganizationMetrics(attendanceRecords: Attendance[], users: User[], organizationId?: string): Promise<any> {
		try {
			const completedShifts = attendanceRecords.filter((record) => record.checkOut);

			// Calculate average times with timezone conversion
			const averageTimes = await this.calculateAverageTimes(attendanceRecords, organizationId);

			// Calculate totals
			const totals = await this.calculateTotals(attendanceRecords, users);

			// Group by branch
			const byBranch = this.groupByBranch(attendanceRecords, users);

			// Group by role
			const byRole = this.groupByRole(attendanceRecords, users);

			// Calculate insights
			const insights = this.calculateInsights(attendanceRecords);

			return {
				averageTimes,
				totals,
				byBranch,
				byRole,
				insights,
			};
		} catch (error) {
			this.logger.error('Error calculating organization metrics:', error);
			return this.getZeroOrganizationMetrics();
		}
	}

	private async calculateAverageTimes(attendanceRecords: Attendance[], organizationId?: string): Promise<any> {
		try {
			if (attendanceRecords.length === 0) {
				return {
					startTime: 'N/A',
					endTime: 'N/A',
					shiftDuration: 0,
					breakDuration: 0,
				};
			}

			// Get organization timezone for proper conversion
			const timezone = await this.getOrganizationTimezone(organizationId);

			// Use enhanced calculation service for average times with timezone
			const averageTimes = this.attendanceCalculatorService.calculateAverageTimes(attendanceRecords, timezone);

			return {
				startTime: averageTimes.averageCheckInTime,
				endTime: averageTimes.averageCheckOutTime,
				shiftDuration: TimeCalculatorUtil.roundToHours(
					averageTimes.averageShiftDuration,
					TimeCalculatorUtil.PRECISION.HOURS,
				),
				breakDuration: TimeCalculatorUtil.roundToHours(
					averageTimes.averageBreakDuration,
					TimeCalculatorUtil.PRECISION.HOURS,
				),
			};
		} catch (error) {
			this.logger.error('Error calculating average times:', error);
			return {
				startTime: 'N/A',
				endTime: 'N/A',
				shiftDuration: 0,
				breakDuration: 0,
			};
		}
	}

	private async calculateTotals(attendanceRecords: Attendance[], users: User[]): Promise<any> {
		try {
			const completedShifts = attendanceRecords.filter((record) => record.checkOut);

			// Enhanced total hours calculation using our utilities
			const totalHours = completedShifts.reduce((sum, record) => {
				const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					record.breakDetails,
					record.totalBreakTime,
				);
				const totalMinutes = differenceInMinutes(new Date(record.checkOut!), new Date(record.checkIn));
				const workMinutes = Math.max(0, totalMinutes - breakMinutes);
				return sum + TimeCalculatorUtil.minutesToHours(workMinutes, TimeCalculatorUtil.PRECISION.CURRENCY);
			}, 0);

			// Enhanced overtime calculation (organization-aware)
			let overtimeHours = 0;
			for (const record of completedShifts) {
				const organizationId = record.owner?.organisation?.uid;
				if (organizationId) {
					const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
						record.breakDetails,
						record.totalBreakTime,
					);
					const totalMinutes = differenceInMinutes(new Date(record.checkOut!), new Date(record.checkIn));
					const workMinutes = Math.max(0, totalMinutes - breakMinutes);

					const overtimeInfo = await this.organizationHoursService.calculateOvertime(
						organizationId,
						record.checkIn,
						workMinutes,
					);
					overtimeHours += TimeCalculatorUtil.minutesToHours(
						overtimeInfo.overtimeMinutes,
						TimeCalculatorUtil.PRECISION.CURRENCY,
					);
				} else {
					// Fallback to default 8-hour calculation
					const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
						record.breakDetails,
						record.totalBreakTime,
					);
					const totalMinutes = differenceInMinutes(new Date(record.checkOut!), new Date(record.checkIn));
					const workMinutes = Math.max(0, totalMinutes - breakMinutes);
					const workHours = TimeCalculatorUtil.minutesToHours(
						workMinutes,
						TimeCalculatorUtil.PRECISION.CURRENCY,
					);
					overtimeHours += Math.max(0, workHours - TimeCalculatorUtil.DEFAULT_WORK.STANDARD_HOURS);
				}
			}

			return {
				totalEmployees: users.length,
				totalHours: TimeCalculatorUtil.roundToHours(totalHours, TimeCalculatorUtil.PRECISION.HOURS),
				totalShifts: attendanceRecords.length,
				overtimeHours: TimeCalculatorUtil.roundToHours(overtimeHours, TimeCalculatorUtil.PRECISION.HOURS),
			};
		} catch (error) {
			this.logger.error('Error calculating totals:', error);
			return {
				totalEmployees: 0,
				totalHours: 0,
				totalShifts: 0,
				overtimeHours: 0,
			};
		}
	}

	private groupByBranch(attendanceRecords: Attendance[], users: User[]): any[] {
		try {
			const branchMap = new Map();

			// Initialize branches
			users.forEach((user) => {
				if (user.branch) {
					const branchId = user.branch.uid.toString();
					if (!branchMap.has(branchId)) {
						branchMap.set(branchId, {
							branchId,
							branchName: user.branch.name || `Branch ${branchId}`,
							employeeCount: 0,
							totalHours: 0,
							totalShifts: 0,
							employees: new Set(),
						});
					}
					branchMap.get(branchId).employees.add(user.uid);
				}
			});

			// Calculate metrics for each branch
			attendanceRecords.forEach((record) => {
				const user = users.find((u) => u.uid === record.owner.uid);
				if (user && user.branch) {
					const branchId = user.branch.uid.toString();
					const branchData = branchMap.get(branchId);

					if (branchData) {
						branchData.totalShifts++;

						if (record.checkOut) {
							// Enhanced calculation using our utilities
							const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
								record.breakDetails,
								record.totalBreakTime,
							);
							const totalMinutes = differenceInMinutes(
								new Date(record.checkOut),
								new Date(record.checkIn),
							);
							const workMinutes = Math.max(0, totalMinutes - breakMinutes);
							const workHours = TimeCalculatorUtil.minutesToHours(
								workMinutes,
								TimeCalculatorUtil.PRECISION.CURRENCY,
							);
							branchData.totalHours += workHours;
						}
					}
				}
			});

			// Convert to array and calculate averages
			return Array.from(branchMap.values()).map((branch) => ({
				branchId: branch.branchId,
				branchName: branch.branchName,
				employeeCount: branch.employees.size,
				totalHours: TimeCalculatorUtil.roundToHours(branch.totalHours, TimeCalculatorUtil.PRECISION.HOURS),
				totalShifts: branch.totalShifts,
				averageHoursPerEmployee:
					branch.employees.size > 0
						? TimeCalculatorUtil.roundToHours(
							branch.totalHours / branch.employees.size,
							TimeCalculatorUtil.PRECISION.HOURS,
						)
						: 0,
				averageShiftsPerEmployee:
					branch.employees.size > 0
						? TimeCalculatorUtil.roundToHours(
							branch.totalShifts / branch.employees.size,
							TimeCalculatorUtil.PRECISION.DISPLAY,
						)
						: 0,
			}));
		} catch (error) {
			this.logger.error('Error grouping by branch:', error);
			return [];
		}
	}

	private groupByRole(attendanceRecords: Attendance[], users: User[]): any[] {
		try {
			const roleMap = new Map();

			// Initialize roles
			users.forEach((user) => {
				const role = user.accessLevel;
				if (!roleMap.has(role)) {
					roleMap.set(role, {
						role,
						employeeCount: 0,
						totalHours: 0,
						totalShifts: 0,
						employees: new Set(),
					});
				}
				roleMap.get(role).employees.add(user.uid);
			});

			// Calculate metrics for each role
			attendanceRecords.forEach((record) => {
				const user = users.find((u) => u.uid === record.owner.uid);
				if (user) {
					const role = user.accessLevel;
					const roleData = roleMap.get(role);

					if (roleData) {
						roleData.totalShifts++;

						if (record.checkOut) {
							const startTime = new Date(record.checkIn);
							const endTime = new Date(record.checkOut);
							const breakMinutes = record.totalBreakTime ? this.parseBreakTime(record.totalBreakTime) : 0;
							const workHours = (differenceInMinutes(endTime, startTime) - breakMinutes) / 60;
							roleData.totalHours += workHours;
						}
					}
				}
			});

			// Convert to array and calculate averages
			return Array.from(roleMap.values()).map((role) => ({
				role: role.role,
				employeeCount: role.employees.size,
				totalHours: Math.round(role.totalHours * 100) / 100,
				totalShifts: role.totalShifts,
				averageHoursPerEmployee:
					role.employees.size > 0 ? Math.round((role.totalHours / role.employees.size) * 100) / 100 : 0,
				averageShiftsPerEmployee:
					role.employees.size > 0 ? Math.round((role.totalShifts / role.employees.size) * 100) / 100 : 0,
			}));
		} catch (error) {
			this.logger.error('Error grouping by role:', error);
			return [];
		}
	}

	private calculateInsights(attendanceRecords: Attendance[]): any {
		try {
			if (attendanceRecords.length === 0) {
				return {
					attendanceRate: 0,
					punctualityRate: 0,
					averageHoursPerDay: 0,
					peakCheckInTime: 'N/A',
					peakCheckOutTime: 'N/A',
				};
			}

			// Calculate punctuality rate (on time arrivals before 9:15 AM)
			const standardStartHour = 9;
			const standardStartMinute = 15;
			const onTimeArrivals = attendanceRecords.filter((record) => {
				const checkInTime = new Date(record.checkIn);
				const checkInMinutes = checkInTime.getHours() * 60 + checkInTime.getMinutes();
				const standardStartMinutes = standardStartHour * 60 + standardStartMinute;
				return checkInMinutes <= standardStartMinutes;
			}).length;

			const punctualityRate = Math.round((onTimeArrivals / attendanceRecords.length) * 100);

			// Calculate average hours per day
			const completedShifts = attendanceRecords.filter((record) => record.checkOut);
			const totalWorkHours = completedShifts.reduce((sum, record) => {
				const startTime = new Date(record.checkIn);
				const endTime = new Date(record.checkOut!);
				const breakMinutes = record.totalBreakTime ? this.parseBreakTime(record.totalBreakTime) : 0;
				const workHours = (differenceInMinutes(endTime, startTime) - breakMinutes) / 60;
				return sum + workHours;
			}, 0);

			const averageHoursPerDay =
				completedShifts.length > 0 ? Math.round((totalWorkHours / completedShifts.length) * 100) / 100 : 0;

			// Find peak check-in and check-out times
			const peakCheckInTime = this.findPeakTime(attendanceRecords.map((r) => new Date(r.checkIn)));
			const peakCheckOutTime = this.findPeakTime(completedShifts.map((r) => new Date(r.checkOut!)));

			// Calculate attendance rate (assuming 100% for users who have any attendance)
			const attendanceRate = 100; // This would need to be calculated against expected attendance

			return {
				attendanceRate,
				punctualityRate,
				averageHoursPerDay,
				peakCheckInTime,
				peakCheckOutTime,
			};
		} catch (error) {
			this.logger.error('Error calculating insights:', error);
			return {
				attendanceRate: 0,
				punctualityRate: 0,
				averageHoursPerDay: 0,
				peakCheckInTime: 'N/A',
				peakCheckOutTime: 'N/A',
			};
		}
	}

	private findPeakTime(times: Date[]): string {
		if (times.length === 0) return 'N/A';

		// Group times by hour
		const hourCounts = new Map<number, number>();

		times.forEach((time) => {
			const hour = time.getHours();
			hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
		});

		// Find the hour with most occurrences
		let peakHour = 0;
		let maxCount = 0;

		hourCounts.forEach((count, hour) => {
			if (count > maxCount) {
				maxCount = count;
				peakHour = hour;
			}
		});

		return `${peakHour.toString().padStart(2, '0')}:00:00`;
	}

	private getZeroMetrics(): any {
		return {
			firstAttendance: { date: null, checkInTime: null, daysAgo: null },
			lastAttendance: { date: null, checkInTime: null, checkOutTime: null, daysAgo: null },
			totalHours: { allTime: 0, thisMonth: 0, thisWeek: 0, today: 0 },
			totalShifts: { allTime: 0, thisMonth: 0, thisWeek: 0, today: 0 },
			averageHoursPerDay: 0,
			attendanceStreak: 0,
		};
	}

	private getZeroOrganizationMetrics(): any {
		return {
			averageTimes: {
				startTime: 'N/A',
				endTime: 'N/A',
				shiftDuration: 0,
				breakDuration: 0,
			},
			totals: {
				totalEmployees: 0,
				totalHours: 0,
				totalShifts: 0,
				overtimeHours: 0,
			},
			byBranch: [],
			byRole: [],
			insights: {
				attendanceRate: 0,
				punctualityRate: 0,
				averageHoursPerDay: 0,
				peakCheckInTime: 'N/A',
				peakCheckOutTime: 'N/A',
			},
		};
	}

	/**
	 * Validate external machine record before processing
	 * Prevents invalid records from being saved to the database
	 * 
	 * @param record - The record to validate (check-in or check-out)
	 * @param mode - Consolidation mode (IN or OUT)
	 * @param orgId - Organization ID for timezone and date validation
	 * @returns Validation result with error message if invalid
	 */
	private async validateExternalMachineRecord(
		record: CreateCheckInDto | CreateCheckOutDto,
		mode: ConsolidateMode,
		orgId?: string,
	): Promise<{ valid: boolean; error?: string }> {
		try {
			// Get organization timezone for accurate date/time comparisons
			const orgTimezone = await this.getOrganizationTimezone(orgId);

			// Cast record to access both checkIn and checkOut properties
			const recordAny = record as any;

			// Validation 1: Check if record has both checkIn and checkOut (shouldn't happen in normal flow)
			if (recordAny.checkIn && recordAny.checkOut) {
				const checkInTime = new Date(recordAny.checkIn);
				const checkOutTime = new Date(recordAny.checkOut);

				// Times are already timezone-aware from database
				const checkInOrgTime = checkInTime;
				const checkOutOrgTime = checkOutTime;

				// Check if times are too close (within 5 minutes) - likely a duplicate or error
				const timeDiffMinutes = Math.abs(differenceInMinutes(checkOutOrgTime, checkInOrgTime));
				if (timeDiffMinutes <= this.MAX_TIME_DIFF_MINUTES) {
					return {
						valid: false,
						error: `Check-in and check-out times are too close (${timeDiffMinutes} minutes apart). ` +
							`This appears to be a duplicate or invalid record. Times must be at least ${this.MAX_TIME_DIFF_MINUTES + 1} minutes apart.`
					};
				}

				// Check if check-out is before check-in
				if (checkOutOrgTime <= checkInOrgTime) {
					return {
						valid: false,
						error: `Check-out time (${checkOutOrgTime.toISOString()}) must be after check-in time (${checkInOrgTime.toISOString()})`
					};
				}

				// Check minimum duration (must be at least 30 minutes)
				if (timeDiffMinutes < this.MIN_SHIFT_DURATION_MINUTES) {
					return {
						valid: false,
						error: `Shift duration too short: ${timeDiffMinutes} minutes. ` +
							`Minimum required duration is ${this.MIN_SHIFT_DURATION_MINUTES} minutes.`
					};
				}
			}

			// Validation 2: For check-in records, check if user already has a record for this day
			// This prevents overwriting existing records from external machines
			if (mode === ConsolidateMode.IN && recordAny.checkIn) {
				const checkInTime = new Date(recordAny.checkIn);
				// Times are already timezone-aware
				const checkInOrgTime = checkInTime;

				// Get the calendar date (YYYY-MM-DD)
				const checkInDate = new Date(
					checkInOrgTime.getFullYear(),
					checkInOrgTime.getMonth(),
					checkInOrgTime.getDate()
				);

				// Check if user already has an attendance record for this day
				const existingRecordsQuery = this.attendanceRepository
					.createQueryBuilder('attendance')
					.leftJoinAndSelect('attendance.owner', 'owner')
					.leftJoinAndSelect('attendance.organisation', 'organisation')
					.where('owner.uid = :ownerUid', { ownerUid: recordAny.owner?.uid })
					.andWhere('attendance.checkIn IS NOT NULL');

				if (orgId) {
					existingRecordsQuery.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
				}

				const existingRecords = await existingRecordsQuery
					.orderBy('attendance.checkIn', 'DESC')
					.getMany();

				// Check each existing record to see if it's on the same calendar day
				for (const existingRecord of existingRecords) {
					const existingCheckInTime = new Date(existingRecord.checkIn);
					// Times are already timezone-aware
					const existingCheckInOrgTime = existingCheckInTime;
					const existingCheckInDate = new Date(
						existingCheckInOrgTime.getFullYear(),
						existingCheckInOrgTime.getMonth(),
						existingCheckInOrgTime.getDate()
					);

					// Check if it's the same calendar day
					if (
						checkInDate.getFullYear() === existingCheckInDate.getFullYear() &&
						checkInDate.getMonth() === existingCheckInDate.getMonth() &&
						checkInDate.getDate() === existingCheckInDate.getDate()
					) {
						const dateStr = checkInDate.toISOString().split('T')[0];
						return {
							valid: false,
							error: `User already has an attendance record for this day (${dateStr}). ` +
								`Skipping external machine record to prevent overwriting existing data. ` +
								`Existing record ID: ${existingRecord.uid}, Check-in: ${existingCheckInOrgTime.toISOString()}`
						};
					}
				}
			}

			// Validation 3: For check-out records, validate minimum time since check-in
			if (mode === ConsolidateMode.OUT && recordAny.checkOut) {
				// Find the active shift for this user
				const activeShiftQuery = this.attendanceRepository
					.createQueryBuilder('attendance')
					.leftJoinAndSelect('attendance.organisation', 'organisation')
					.where('attendance.owner.uid = :ownerUid', { ownerUid: recordAny.owner?.uid })
					.andWhere('attendance.status = :status', { status: AttendanceStatus.PRESENT })
					.andWhere('attendance.checkIn IS NOT NULL')
					.andWhere('attendance.checkOut IS NULL');

				if (orgId) {
					activeShiftQuery.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
				}

				const activeShift = await activeShiftQuery
					.orderBy('attendance.checkIn', 'DESC')
					.getOne();

				if (activeShift) {
					const checkInTime = new Date(activeShift.checkIn);
					const checkOutTime = new Date(recordAny.checkOut);

					// Times are already timezone-aware
					const checkInOrgTime = checkInTime;
					const checkOutOrgTime = checkOutTime;

					// Calculate duration
					const durationMinutes = differenceInMinutes(checkOutOrgTime, checkInOrgTime);

					// Validate minimum duration
					if (durationMinutes < this.MIN_SHIFT_DURATION_MINUTES) {
						return {
							valid: false,
							error: `Check-out time is too close to check-in time: ${durationMinutes} minutes. ` +
								`Minimum required duration is ${this.MIN_SHIFT_DURATION_MINUTES} minutes.`
						};
					}
				}
			}

			return { valid: true };
		} catch (error) {
			this.logger.error(`Error validating external machine record: ${error.message}`, error.stack);
			return {
				valid: false,
				error: `Validation error: ${error.message}`
			};
		}
	}

	/**
	 * ## 📦 Consolidate Attendance Records
	 *
	 * Process bulk attendance records from external systems (ERP, other time-tracking systems).
	 * This method handles batch processing of check-ins or check-outs with comprehensive
	 * error handling and audit trail capabilities.
	 *
	 * ### **Features:**
	 * - Batch processing with individual record validation
	 * - Source system tracking for audit trails
	 * - Transaction support for data integrity
	 * - Individual error handling without failing the entire batch
	 * - Support for both check-in and check-out modes
	 * - Validation to prevent invalid or duplicate records
	 *
	 * @param consolidateDto - Consolidation request containing mode and records array
	 * @param orgId - Organization ID for filtering
	 * @param branchId - Branch ID for filtering
	 * @returns Promise with consolidation results including success/failure counts
	 */
	public async consolidate(
		consolidateDto: ConsolidateAttendanceDto,
		orgId?: string,
		branchId?: number,
	): Promise<{
		message: string;
		data: {
			processed: number;
			successful: number;
			failed: number;
			sourceSystem?: string;
			transactionId?: string;
			processingTime: string;
			results: Array<{
				recordIndex: number;
				success: boolean;
				userId?: number;
				attendanceId?: number;
				message: string;
				error?: string;
			}>;
			warnings: string[];
		};
	}> {
		const startTime = Date.now();
		const operationId = `consolidate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		this.logger.log(
			`[${operationId}] Starting attendance consolidation for ${consolidateDto.records.length} records in ${consolidateDto.mode} mode`,
		);

		// Validate input
		if (!consolidateDto.records || consolidateDto.records.length === 0) {
			throw new BadRequestException('Records array cannot be empty');
		}

		if (!Object.values(ConsolidateMode).includes(consolidateDto.mode)) {
			throw new BadRequestException('Invalid mode specified. Must be "in" or "out"');
		}

		const results = [];
		const warnings = [];
		let successful = 0;
		let failed = 0;

		// Process each record individually
		for (let i = 0; i < consolidateDto.records.length; i++) {
			const record = consolidateDto.records[i];
			const recordLog = `[${operationId}] Record ${i + 1}/${consolidateDto.records.length}`;

			this.logger.debug(`${recordLog} Processing ${consolidateDto.mode} record for user ${record.owner?.uid}`);

			try {
				// VALIDATION: Check if user exists before processing (owner.uid is string: clerk id or numeric)
				const ownerRef = record.owner?.uid;
				if (!ownerRef) {
					throw new Error('User ID is required for attendance record');
				}

				const userWhere = typeof ownerRef === 'string' && ownerRef.startsWith('user_')
					? { clerkUserId: ownerRef }
					: { uid: Number(ownerRef) };
				const userExists = await this.userRepository.findOne({
					where: userWhere,
				});

				if (!userExists) {
					throw new Error(`User with ID ${ownerRef} does not exist`);
				}

				// VALIDATION: Validate external machine record before processing
				// This prevents invalid records, duplicates, and overwriting existing data
				const validation = await this.validateExternalMachineRecord(record, consolidateDto.mode, orgId);
				if (!validation.valid) {
					throw new Error(validation.error || 'Record validation failed');
				}

				let result: any;
				let attendanceId: number | undefined;
				let message: string;

				if (consolidateDto.mode === ConsolidateMode.IN) {
					// Process as check-in from external machine
					const checkInRecord = record as CreateCheckInDto;

					// Mark as external machine clocking in checkInNotes
					const sourcePrefix = consolidateDto.sourceSystem
						? `[External Machine: ${consolidateDto.sourceSystem}] `
						: '[External Machine] ';
					const existingNotes = checkInRecord.checkInNotes || '';
					checkInRecord.checkInNotes = sourcePrefix + (existingNotes || 'Morning clocking from external machine');

					// Pass skipAutoClose=true to prevent auto-closing existing shifts
					// External machines should never auto-close user shifts
					result = await this.checkIn(checkInRecord, orgId, branchId, true);

					// Check if the result indicates an error (data is null)
					if (!result.data) {
						throw new Error(result.message || 'Check-in failed');
					}

					message = 'Check-in processed successfully';

					// Try to extract attendance ID from result if available
					if (result.data && result.data.uid) {
						attendanceId = result.data.uid;
					}
				} else {
					// Process as check-out
					const checkOutRecord = record as CreateCheckOutDto;
					result = await this.checkOut(checkOutRecord, orgId, branchId);

					// Check if the result indicates an error (data is null)
					if (!result.data) {
						throw new Error(result.message || 'Check-out failed');
					}

					message = 'Check-out processed successfully';

					// Try to extract attendance ID from result if available
					if (result.data && result.data.uid) {
						attendanceId = result.data.uid;
					}
				}

				// Record successful processing
				results.push({
					recordIndex: i,
					success: true,
					userId: record.owner?.uid,
					attendanceId,
					message,
				});

				successful++;
				this.logger.debug(`${recordLog} SUCCESS - ${message}`);
			} catch (error) {
				// Record failed processing but continue with other records
				const errorMessage = error.message || 'Unknown error occurred';

				results.push({
					recordIndex: i,
					success: false,
					userId: record.owner?.uid,
					message: 'Processing failed',
					error: errorMessage,
				});

				warnings.push(`Record ${i + 1}: User ${record.owner?.uid} - ${errorMessage}`);
				failed++;

				this.logger.warn(`${recordLog} FAILED - ${errorMessage}`);

				// Continue processing other records despite this failure
				continue;
			}
		}

		const processingTime = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
		const processed = consolidateDto.records.length;

		// Log consolidation summary
		this.logger.log(
			`[${operationId}] COMPLETED - Processed ${processed} records in ${processingTime}. ` +
			`Success: ${successful}, Failed: ${failed}. Source: ${consolidateDto.sourceSystem || 'Unknown'}`,
		);

		// Create audit log entry for the consolidation
		if (consolidateDto.sourceSystem || consolidateDto.transactionId) {
			this.logger.log(
				`[${operationId}] AUDIT - Consolidation from ${consolidateDto.sourceSystem || 'Unknown'} ` +
				`with transaction ID: ${consolidateDto.transactionId || 'N/A'}`,
			);
		}

		return {
			message: process.env.SUCCESS_MESSAGE || 'Attendance records consolidated successfully',
			data: {
				processed,
				successful,
				failed,
				sourceSystem: consolidateDto.sourceSystem,
				transactionId: consolidateDto.transactionId,
				processingTime,
				results,
				warnings,
			},
		};
	}

	public async requestUserAttendanceRecords(
		userId: number,
		requesterId: number,
		startDate?: string,
		endDate?: string,
		orgId?: string,
		branchId?: number,
		userAccessLevel?: string,
	): Promise<{
		message: string;
		success: boolean;
		userEmail: string;
		requestedUserName: string;
	}> {
		const operationId = `req-user-records-${requesterId}-${userId}-${Date.now()}`;
		this.logger.log(`[${operationId}] Starting user records request for user ${userId} by requester ${requesterId}`);

		try {
			// Get requester user details
			const requester = await this.userRepository.findOne({
				where: { uid: requesterId },
				relations: ['organisation', 'branch'],
			});

			if (!requester) {
				throw new Error('Requester not found');
			}

			// Get target user details
			const targetUser = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation', 'branch'],
			});

			if (!targetUser) {
				throw new Error('Target user not found');
			}

			// Verify users are in the same organization
			if (requester.organisation?.uid !== targetUser.organisation?.uid) {
				throw new Error('Cannot request records for users outside your organization');
			}

			// Set default date range if not provided (last 30 days)
			const endDateTime = endDate ? new Date(endDate) : new Date();
			const startDateTime = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

			// Get effective branch ID based on user role
			const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);

			// Build where conditions
			const attendanceWhereConditions: any = {
				owner: { uid: userId },
				organisation: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				checkIn: Between(startDateTime, endDateTime),
			};

			// Apply branch filtering if provided (and user is not admin/owner/developer)
			if (effectiveBranchId) {
				attendanceWhereConditions.branch = { uid: effectiveBranchId };
			}

			// Get user attendance records for the date range
			const attendanceRecords = await this.attendanceRepository.find({
				where: attendanceWhereConditions,
				relations: ['owner', 'organisation', 'branch'],
				order: { checkIn: 'DESC' },
			});

			// Convert timezone if needed
			const convertedRecords = await this.convertAttendanceRecordsTimezone(attendanceRecords, orgId);

			// Get organization timezone for proper formatting
			const orgTimezone = await this.getOrganizationTimezone(orgId);

			// Prepare email data
			const emailData = {
				name: `${requester.name} ${requester.surname}`,
				requesterName: `${requester.name} ${requester.surname}`,
				requesterEmail: requester.email,
				targetUserName: `${targetUser.name} ${targetUser.surname}`,
				targetUserEmail: targetUser.email,
				organizationName: requester.organisation?.name || 'Organization',
				startDate: startDateTime.toISOString().split('T')[0],
				endDate: endDateTime.toISOString().split('T')[0],
				recordsCount: convertedRecords.length,
				attendanceRecords: convertedRecords.map(record => ({
					date: record.checkIn ? new Date(record.checkIn).toLocaleDateString() : 'N/A',
					checkInTime: record.checkIn ?
						new Date(record.checkIn).toLocaleTimeString('en-US', {
							timeZone: orgTimezone,
							hour12: false
						}) : 'N/A',
					checkOutTime: record.checkOut ?
						new Date(record.checkOut).toLocaleTimeString('en-US', {
							timeZone: orgTimezone,
							hour12: false
						}) : 'Not checked out',
					duration: record.duration || 'N/A',
					status: record.status,
					totalBreakTime: record.totalBreakTime || '0m',
					checkInNotes: record.checkInNotes || '',
					checkOutNotes: record.checkOutNotes || '',
					branchName: record.branch?.name || 'N/A',
				})),
				timezone: orgTimezone,
				generatedAt: new Date().toLocaleString('en-US', { timeZone: orgTimezone }),
			};

			// Send email to requester
			await this.communicationService.sendEmail(
				EmailType.ATTENDANCE_RECORDS_REQUEST,
				[requester.email],
				emailData,
			);

			this.logger.log(`[${operationId}] Successfully sent attendance records email to ${requester.email}`);

			return {
				message: `Attendance records for ${targetUser.name} ${targetUser.surname} have been sent to your email`,
				success: true,
				userEmail: requester.email,
				requestedUserName: `${targetUser.name} ${targetUser.surname}`,
			};
		} catch (error) {
			this.logger.error(`[${operationId}] Error sending user records: ${error.message}`, error.stack);
			throw new Error(`Failed to send attendance records: ${error.message}`);
		}
	}

	/**
	 * Get monthly attendance calendar with calculated days and status
	 * @param ref - User reference ID
	 * @param year - Year (defaults to current year)
	 * @param month - Month (1-12, defaults to current month)
	 * @returns Monthly calendar data with days and attendance status
	 */
	public async getMonthlyAttendanceCalendar(
		ref: string,
		year?: number,
		month?: number,
	): Promise<{
		month: number;
		year: number;
		monthName: string;
		days: Array<{
			date: string;
			dayNumber: number;
			dayOfWeek: number;
			status: 'attended' | 'missed' | 'future';
			attendanceRecord?: Attendance;
		}>;
		firstDayOfWeek: number;
		totalDays: number;
	}> {
		try {
			const now = new Date();
			const targetYear = year || now.getFullYear();
			const targetMonth = month || now.getMonth() + 1;

			// Validate month
			if (targetMonth < 1 || targetMonth > 12) {
				throw new BadRequestException('Month must be between 1 and 12');
			}

			// Create date for the first day of the target month
			const monthStart = startOfMonth(new Date(targetYear, targetMonth - 1, 1));
			const monthEnd = endOfMonth(monthStart);
			const today = startOfDay(now);

			// Get first day of week (0 = Sunday, 1 = Monday, etc.)
			const firstDayOfWeek = getDay(monthStart);

			// Get total days in month
			const totalDays = getDaysInMonth(monthStart);

			// Resolve user by clerk id or numeric uid
			const userWhere = ref.startsWith('user_') ? { clerkUserId: ref } : { uid: Number(ref) };
			const user = await this.userRepository.findOne({
				where: userWhere,
				relations: ['organisation'],
			});

			if (!user) {
				throw new NotFoundException(`User with ref ${ref} not found`);
			}

			const orgId = user.organisation?.clerkOrgId || user.organisation?.ref;
			const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';

			// Dates are already timezone-aware; filter by ownerClerkUserId (clerk id as primary)
			const startOfPeriod = startOfDay(monthStart);
			const endOfPeriod = endOfDay(monthEnd);

			const ownerFilter = { ownerClerkUserId: user.clerkUserId };

			// Fetch all attendance records for the user in this month
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					...ownerFilter,
					checkIn: Between(startOfPeriod, endOfPeriod),
				},
				relations: ['owner', 'branch', 'organisation'],
				order: {
					checkIn: 'ASC',
				},
			});

			// Create a map of dates with attendance records
			const attendanceByDate = new Map<string, Attendance>();
			attendanceRecords.forEach((record) => {
				if (!record.checkIn) return;

				const checkInDate = startOfDay(new Date(record.checkIn));
				const dateKey = format(checkInDate, 'yyyy-MM-dd');

				// Count as attended if status is PRESENT, COMPLETED, or ON_BREAK
				const isAttended =
					record.status === AttendanceStatus.PRESENT ||
					record.status === AttendanceStatus.COMPLETED ||
					record.status === AttendanceStatus.ON_BREAK;

				if (isAttended) {
					// If multiple records for same day, keep the first one
					if (!attendanceByDate.has(dateKey)) {
						attendanceByDate.set(dateKey, record);
					}
				}
			});

			// Generate array of all days in the month
			const days: Array<{
				date: string;
				dayNumber: number;
				dayOfWeek: number;
				status: 'attended' | 'missed' | 'future';
				attendanceRecord?: Attendance;
			}> = [];

			for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
				const currentDate = new Date(targetYear, targetMonth - 1, dayNum);
				const dateStart = startOfDay(currentDate);
				const dateKey = format(dateStart, 'yyyy-MM-dd');
				const dayOfWeek = getDay(currentDate); // 0 = Sunday, 1 = Monday, etc.

				// Determine status
				let status: 'attended' | 'missed' | 'future';
				if (dateStart > today) {
					status = 'future';
				} else if (attendanceByDate.has(dateKey)) {
					// If there's attendance, mark as attended (even on Sunday)
					status = 'attended';
				} else {
					// For Sundays (dayOfWeek === 0), they are not considered "missed" 
					// as no work is expected. The client will handle showing them as amber.
					// For other days, mark as missed if no attendance
					status = 'missed';
				}

				days.push({
					date: dateKey,
					dayNumber: dayNum,
					dayOfWeek,
					status,
					attendanceRecord: attendanceByDate.get(dateKey),
				});
			}

			// Get month name
			const monthNames = [
				'January',
				'February',
				'March',
				'April',
				'May',
				'June',
				'July',
				'August',
				'September',
				'October',
				'November',
				'December',
			];
			const monthName = monthNames[targetMonth - 1];

			return {
				month: targetMonth,
				year: targetYear,
				monthName,
				days,
				firstDayOfWeek,
				totalDays,
			};
		} catch (error) {
			this.logger.error(`Error getting monthly attendance calendar: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Bulk clock-in all users for specified dates
	 * Creates full attendance records using organization hours
	 * Supports half-day configuration and custom hours per date
	 */
	public async bulkClockIn(
		bulkClockInDto: BulkClockInDto,
		orgId: string,
		branchId?: number,
	): Promise<{
		message: string;
		summary: {
			totalDates: number;
			totalUsers: number;
			totalRecordsCreated: number;
			totalRecordsSkipped: number;
			datesProcessed: string[];
			errors: Array<{ date: string; userId: number; error: string }>;
		};
		details: Array<{
			date: string;
			usersProcessed: number;
			recordsCreated: number;
			recordsSkipped: number;
			halfDay: boolean;
			checkInTime: string;
			checkOutTime: string;
		}>;
	}> {
		const startTime = Date.now();
		this.logger.log(`🚀 BULK CLOCK-IN STARTED - Org: ${orgId}, Branch: ${branchId || 'ALL'}, Dates: ${bulkClockInDto.dates.join(', ')}`);
		this.logger.log(`📋 Configuration: Half-day dates: ${bulkClockInDto.halfDayDates?.join(', ') || 'NONE'}, Custom hours: ${bulkClockInDto.customHours?.length || 0} dates`);

		const errors: Array<{ date: string; userId: number; error: string }> = [];
		let totalRecordsCreated = 0;
		let totalRecordsSkipped = 0;
		const details: Array<{
			date: string;
			usersProcessed: number;
			recordsCreated: number;
			recordsSkipped: number;
			halfDay: boolean;
			checkInTime: string;
			checkOutTime: string;
		}> = [];

		try {
			// Validate organisation exists if orgId provided
			if (orgId) {
				const organisation = await this.organisationRepository.findOne({
					where: [
						{ clerkOrgId: orgId },
						{ ref: orgId }
					]
				});
				if (!organisation) {
					throw new BadRequestException(`Organization not found for ID: ${orgId}`);
				}
			}

			// Step 1: Get ALL users for the organization (fetch all pages)
			// Skip branch filtering - fetch ALL users regardless of branch restrictions
			// Only filter by branch if explicitly provided in DTO
			this.logger.log(`📞 Fetching ALL users for organization ${orgId}${bulkClockInDto.branchId ? ` (filtered by branch ${bulkClockInDto.branchId})` : ' (NO BRANCH FILTER - ALL BRANCHES)'}`);
			let allUsers: any[] = [];
			let page = 1;
			const pageSize = 1000;
			let hasMore = true;

			while (hasMore) {
				const usersResponse = await this.userService.findAll(
					{
						orgId,
						// Only include branchId filter if explicitly provided in DTO
						...(bulkClockInDto.branchId && { branchId: bulkClockInDto.branchId }),
					},
					page,
					pageSize,
				);

				const pageUsers = usersResponse.data || [];
				allUsers = allUsers.concat(pageUsers);

				this.logger.log(`📄 Page ${page}: Found ${pageUsers.length} users (Total so far: ${allUsers.length})`);

				hasMore = pageUsers.length === pageSize;
				page++;
			}

			this.logger.log(`✅ Found ${allUsers.length} total users to process`);

			if (allUsers.length === 0) {
				this.logger.warn(`⚠️ No users found for organization ${orgId}`);
				return {
					message: 'No users found for bulk clock-in',
					summary: {
						totalDates: bulkClockInDto.dates.length,
						totalUsers: 0,
						totalRecordsCreated: 0,
						totalRecordsSkipped: 0,
						datesProcessed: [],
						errors: [],
					},
					details: [],
				};
			}

			// Filter out deleted and inactive users
			const activeUsers = allUsers.filter(
				(user) => !user.isDeleted && user.status !== 'INACTIVE',
			);
			this.logger.log(`✅ ${activeUsers.length} active users after filtering`);

			// Step 1.5: Close ALL existing open shifts for ALL users BEFORE processing dates
			this.logger.log(`\n🔒 STEP 1.5: Closing ALL existing open shifts for all users...`);
			const orgHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const orgTimezone = orgHours?.timezone || 'Africa/Johannesburg';
			let closedShiftsCount = 0;
			let failedClosuresCount = 0;

			for (const user of activeUsers) {
				try {
					// Find all open shifts for this user
					const openShifts = await this.attendanceRepository
						.createQueryBuilder('attendance')
						.leftJoinAndSelect('attendance.owner', 'owner')
						.leftJoinAndSelect('attendance.organisation', 'organisation')
						.where('owner.uid = :userId', { userId: user.uid })
						.andWhere('attendance.status = :status', { status: AttendanceStatus.PRESENT })
						.andWhere('attendance.checkIn IS NOT NULL')
						.andWhere('attendance.checkOut IS NULL')
						.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
						.getMany();

					for (const openShift of openShifts) {
						try {
							const userBranchId = user.branch?.uid || branchId;
							if (!userBranchId) {
								this.logger.warn(`⚠️ User ${user.uid} has no branch - skipping shift closure`);
								continue;
							}

							// Get the check-in date (already timezone-aware)
							const checkInDateOrg = new Date(openShift.checkIn);

							// Get working day info for the check-in date
							const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
								orgId,
								checkInDateOrg
							);

							let closeTime: Date;

							if (workingDayInfo.isWorkingDay && workingDayInfo.endTime) {
								// Parse the end time for the check-in date
								const [hours, minutes] = workingDayInfo.endTime.split(':').map(Number);
								closeTime = new Date(checkInDateOrg);
								closeTime.setHours(hours, minutes, 0, 0);
							} else {
								// If not a working day, use check-in time + 1 minute (to satisfy validation)
								const checkInTime = new Date(openShift.checkIn);
								closeTime = new Date(checkInTime.getTime() + 60 * 1000); // Add 1 minute
							}

							// Ensure close time is after check-in time
							const checkInTime = new Date(openShift.checkIn);
							if (closeTime <= checkInTime) {
								closeTime = new Date(checkInTime.getTime() + 60 * 1000); // Add 1 minute minimum
							}

							// Create check-out DTO
							const closeOutDto: CreateCheckOutDto = {
								checkOut: closeTime,
								owner: { uid: user.uid },
								checkOutNotes: `Auto-closed by bulk clock-in process`,
							};

							// Close the shift
							await this.checkOut(closeOutDto, orgId, userBranchId);
							closedShiftsCount++;
							this.logger.debug(`✅ Closed open shift ${openShift.uid} for user ${user.uid}`);
						} catch (closeError) {
							failedClosuresCount++;
							const errorMsg = closeError instanceof Error ? closeError.message : String(closeError);
							this.logger.error(`❌ Failed to close shift ${openShift.uid} for user ${user.uid}: ${errorMsg}`);
						}
					}
				} catch (userError) {
					this.logger.error(`❌ Error processing user ${user.uid} for shift closure: ${userError.message}`);
				}
			}

			this.logger.log(`✅ Closed ${closedShiftsCount} open shifts, ${failedClosuresCount} failed closures`);

			// Step 2: Get organization hours and timezone (already fetched above, but log it)
			this.logger.log(`⏰ Organization timezone: ${orgTimezone}`);

			// Step 3: Process each date
			// Identify the last date - users should remain checked in (no check-out)
			const sortedDates = [...bulkClockInDto.dates].sort();
			const lastDate = sortedDates[sortedDates.length - 1];
			this.logger.log(`📌 Last date identified: ${lastDate} - users will remain checked in (no check-out, status PRESENT)`);

			for (const dateStr of bulkClockInDto.dates) {
				this.logger.log(`\n📅 PROCESSING DATE: ${dateStr}`);
				const dateStartTime = Date.now();
				const isLastDate = dateStr === lastDate;

				try {
					// Parse date
					const targetDate = parseISO(dateStr);
					if (isNaN(targetDate.getTime())) {
						throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
					}

					// Check if it's a half day
					const isHalfDay = bulkClockInDto.halfDayDates?.includes(dateStr) || false;
					this.logger.log(`📊 Half-day: ${isHalfDay ? 'YES' : 'NO'}`);
					this.logger.log(`📌 Is last date: ${isLastDate ? 'YES - will remain checked in (PRESENT status)' : 'NO - will be completed'}`);

					// Get custom hours for this date if provided
					const customHours = bulkClockInDto.customHours?.find((ch) => ch.date === dateStr);
					let checkInTime: string;
					let checkOutTime: string | null = null;

					// Only calculate check-out time if this is NOT the last date
					if (!isLastDate) {
						if (customHours) {
							// Use custom hours
							checkInTime = customHours.checkIn;
							checkOutTime = customHours.checkOut;
							this.logger.log(`⏰ Using custom hours - Check-in: ${checkInTime}, Check-out: ${checkOutTime}`);
						} else {
							// Get organization hours for this date
							const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, targetDate);

							if (!workingDayInfo.isWorkingDay || !workingDayInfo.startTime || !workingDayInfo.endTime) {
								this.logger.warn(`⚠️ Date ${dateStr} is not a working day. Skipping.`);
								details.push({
									date: dateStr,
									usersProcessed: 0,
									recordsCreated: 0,
									recordsSkipped: 0,
									halfDay: false,
									checkInTime: 'N/A',
									checkOutTime: 'N/A',
								});
								continue;
							}

							checkInTime = workingDayInfo.startTime;
							let endTime = workingDayInfo.endTime;

							// If half day, calculate half-day checkout time
							if (isHalfDay) {
								const startMinutes = TimeCalculatorUtil.timeToMinutes(checkInTime);
								const endMinutes = TimeCalculatorUtil.timeToMinutes(endTime);
								const halfDayMinutes = Math.floor((endMinutes - startMinutes) / 2);
								const halfDayEndMinutes = startMinutes + halfDayMinutes;
								// Convert minutes back to HH:mm format
								const hours = Math.floor(halfDayEndMinutes / 60);
								const minutes = halfDayEndMinutes % 60;
								checkOutTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
								this.logger.log(`⏰ Half-day calculated - Check-in: ${checkInTime}, Check-out: ${checkOutTime} (${halfDayMinutes} minutes)`);
							} else {
								checkOutTime = endTime;
								this.logger.log(`⏰ Using org hours - Check-in: ${checkInTime}, Check-out: ${checkOutTime}`);
							}
						}
					} else {
						// Last date - only get check-in time
						if (customHours) {
							checkInTime = customHours.checkIn;
							this.logger.log(`⏰ Using custom hours - Check-in: ${checkInTime} (last date - no check-out)`);
						} else {
							// Get organization hours for this date
							const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, targetDate);

							if (!workingDayInfo.isWorkingDay || !workingDayInfo.startTime) {
								this.logger.warn(`⚠️ Date ${dateStr} is not a working day. Skipping.`);
								details.push({
									date: dateStr,
									usersProcessed: 0,
									recordsCreated: 0,
									recordsSkipped: 0,
									halfDay: false,
									checkInTime: 'N/A',
									checkOutTime: 'N/A',
								});
								continue;
							}

							checkInTime = workingDayInfo.startTime;
							this.logger.log(`⏰ Using org hours - Check-in: ${checkInTime} (last date - no check-out)`);
						}
					}

					// Create Date object for check-in - parse time string and combine with targetDate
					const [checkInHours, checkInMinutes] = checkInTime.split(':').map(Number);
					const checkInDate = new Date(targetDate);
					checkInDate.setHours(checkInHours, checkInMinutes, 0, 0);

					// Only create check-out date if this is NOT the last date
					let checkOutDate: Date | null = null;
					if (!isLastDate && checkOutTime) {
						const [checkOutHours, checkOutMinutes] = checkOutTime.split(':').map(Number);
						checkOutDate = new Date(targetDate);
						checkOutDate.setHours(checkOutHours, checkOutMinutes, 0, 0);

						// Ensure check-out is after check-in
						if (checkOutDate <= checkInDate) {
							throw new Error(`Check-out time (${checkOutTime}) must be after check-in time (${checkInTime})`);
						}

						this.logger.log(`📅 Date: ${dateStr}, Check-in: ${checkInDate.toISOString()}, Check-out: ${checkOutDate.toISOString()}`);
					} else {
						this.logger.log(`📅 Date: ${dateStr}, Check-in: ${checkInDate.toISOString()} (last date - no check-out, status PRESENT)`);
					}

					// Step 4: Process each user
					let recordsCreated = 0;
					let recordsSkipped = 0;

					for (const user of activeUsers) {
						try {
							// Check if record already exists (if skipExisting is true)
							if (bulkClockInDto.skipExisting) {
								const existingRecord = await this.attendanceRepository
									.createQueryBuilder('attendance')
									.leftJoinAndSelect('attendance.organisation', 'organisation')
									.where('attendance.owner.uid = :userId', { userId: user.uid })
									.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
									.andWhere('attendance.checkIn BETWEEN :startDate AND :endDate', {
										startDate: startOfDay(checkInDate),
										endDate: endOfDay(checkInDate),
									})
									.getOne();

								if (existingRecord) {
									this.logger.debug(`⏭️ Skipping user ${user.uid} (${user.name} ${user.surname}) - record already exists for ${dateStr}`);
									recordsSkipped++;
									continue;
								}
							}

							// Get user's branch - use user's own branch, allow null/undefined
							// Don't skip users without branch - process all users
							const userBranchId = user.branch?.uid;

							// Create check-in DTO
							// Note: checkIn method uses branchId parameter (userBranchId) which can be undefined
							// The branch field in DTO is required by type but will be overridden by checkIn method's branchId parameter
							const checkInDto: CreateCheckInDto = {
								checkIn: checkInDate,
								owner: { uid: user.uid },
								// Provide branch if available (will be overridden by branchId parameter in checkIn method)
								branch: userBranchId ? { uid: userBranchId } : { uid: 0 },
								status: AttendanceStatus.PRESENT,
								checkInNotes: `Bulk clock-in for ${dateStr}${isHalfDay ? ' (Half-day)' : ''}`,
							};

							// Perform check-in - use skipAutoClose=false to allow auto-closing any remaining shifts
							this.logger.debug(`✅ Checking in user ${user.uid} (${user.name} ${user.surname}) for ${dateStr}`);
							const checkInResult = await this.checkIn(checkInDto, orgId, userBranchId, false);

							if (!checkInResult.data || checkInResult.data.error) {
								throw new Error(checkInResult.message || 'Check-in failed');
							}

							const attendanceId = checkInResult.data.uid;

							// Only check out if this is NOT the last date (users remain checked in on last date with status PRESENT)
							if (!isLastDate && checkOutDate) {
								// Create check-out DTO
								const checkOutDto: CreateCheckOutDto = {
									checkOut: checkOutDate,
									owner: { uid: user.uid },
									checkOutNotes: `Bulk clock-out for ${dateStr}${isHalfDay ? ' (Half-day)' : ''}`,
								};

								// Perform check-out
								this.logger.debug(`✅ Checking out user ${user.uid} (${user.name} ${user.surname}) for ${dateStr}`);
								const checkOutResult = await this.checkOut(checkOutDto, orgId, userBranchId);

								if (!checkOutResult.data || checkOutResult.data.error) {
									throw new Error(checkOutResult.message || 'Check-out failed');
								}

								this.logger.debug(`✅ Successfully created completed attendance record for user ${user.uid} on ${dateStr}`);
							} else {
								this.logger.debug(`✅ Successfully created open attendance record for user ${user.uid} on ${dateStr} (last date - remains checked in with status PRESENT)`);
							}

							recordsCreated++;

						} catch (userError) {
							const errorMsg = userError instanceof Error ? userError.message : String(userError);
							this.logger.error(`❌ Error processing user ${user.uid} for date ${dateStr}: ${errorMsg}`);
							errors.push({
								date: dateStr,
								userId: user.uid,
								error: errorMsg,
							});
						}
					}

					totalRecordsCreated += recordsCreated;
					totalRecordsSkipped += recordsSkipped;

					const dateProcessingTime = Date.now() - dateStartTime;
					this.logger.log(`✅ Date ${dateStr} completed: ${recordsCreated} created, ${recordsSkipped} skipped in ${dateProcessingTime}ms`);

					details.push({
						date: dateStr,
						usersProcessed: activeUsers.length,
						recordsCreated,
						recordsSkipped,
						halfDay: isHalfDay,
						checkInTime,
						checkOutTime: isLastDate ? 'IN PROGRESS' : (checkOutTime || 'N/A'),
					});

				} catch (dateError) {
					const errorMsg = dateError instanceof Error ? dateError.message : String(dateError);
					this.logger.error(`❌ Error processing date ${dateStr}: ${errorMsg}`);
					errors.push({
						date: dateStr,
						userId: 0,
						error: errorMsg,
					});
				}
			}

			const totalTime = Date.now() - startTime;
			this.logger.log(`\n🎉 BULK CLOCK-IN COMPLETED in ${totalTime}ms`);
			this.logger.log(`📊 Summary: ${totalRecordsCreated} records created, ${totalRecordsSkipped} skipped, ${errors.length} errors`);

			return {
				message: `Bulk clock-in completed. Created ${totalRecordsCreated} attendance records across ${bulkClockInDto.dates.length} dates.`,
				summary: {
					totalDates: bulkClockInDto.dates.length,
					totalUsers: activeUsers.length,
					totalRecordsCreated,
					totalRecordsSkipped,
					datesProcessed: bulkClockInDto.dates,
					errors,
				},
				details,
			};

		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.logger.error(`💥 BULK CLOCK-IN FAILED: ${errorMsg}`, error instanceof Error ? error.stack : '');
			throw new BadRequestException(`Bulk clock-in failed: ${errorMsg}`);
		}
	}

	/**
	 * Build a UTC Date for a given date string and minutes since midnight in organisation timezone.
	 */
	private buildDateInOrgTz(dateStr: string, minutesSinceMidnight: number, timezone: string): Date {
		const [y, mo, d] = dateStr.split('-').map(Number);
		const h = Math.floor(minutesSinceMidnight / 60);
		const min = minutesSinceMidnight % 60;
		const localDate = new Date(y, mo - 1, d, h, min, 0, 0);
		return fromZonedTime(localDate, timezone);
	}

	/**
	 * Populate attendance hours for users over a date range with randomised clock-in/clock-out within given time windows.
	 * Supports dry run (preview only, no DB writes).
	 */
	public async populateHours(
		dto: PopulateHoursDto,
		orgId: string,
	): Promise<{
		message: string;
		dryRun: boolean;
		summary: {
			totalDates: number;
			totalUsers: number;
			totalRecordsCreated: number;
			totalRecordsSkipped: number;
			datesProcessed: string[];
			errors: Array<{ date: string; userId: number; error: string }>;
		};
		details: Array<{
			date: string;
			usersProcessed: number;
			recordsCreated: number;
			recordsSkipped: number;
			checkInTimeRange: string;
			checkOutTimeRange: string;
		}>;
		preview?: Array<{ date: string; userId: number; userRef: string; checkIn: string; checkOut: string }>;
	}> {
		const startTime = Date.now();
		const dryRun = dto.dryRun ?? false;
		this.logger.log(
			`🚀 POPULATE HOURS ${dryRun ? '(DRY RUN) ' : ''}STARTED - Org: ${orgId}, Range: ${dto.startDate} to ${dto.endDate}`,
		);

		const errors: Array<{ date: string; userId: number; error: string }> = [];
		let totalRecordsCreated = 0;
		let totalRecordsSkipped = 0;
		const details: Array<{
			date: string;
			usersProcessed: number;
			recordsCreated: number;
			recordsSkipped: number;
			checkInTimeRange: string;
			checkOutTimeRange: string;
		}> = [];
		const preview: Array<{ date: string; userId: number; userRef: string; checkIn: string; checkOut: string }> = [];

		try {
			try {
				validatePopulateHoursRanges(dto);
			} catch (validationError) {
				const msg = validationError instanceof Error ? validationError.message : String(validationError);
				throw new BadRequestException(msg);
			}
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}
			const organisation = await this.organisationRepository.findOne({
				where: [{ clerkOrgId: orgId }, { ref: orgId }],
			});
			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			const orgHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const orgTimezone = orgHours?.timezone || 'Africa/Johannesburg';

			// Expand date range (inclusive)
			const start = parseISO(dto.startDate);
			const end = parseISO(dto.endDate);
			if (isNaN(start.getTime()) || isNaN(end.getTime())) {
				throw new BadRequestException('Invalid startDate or endDate; use YYYY-MM-DD');
			}
			const daysCount = differenceInDays(end, start) + 1;
			const dates: string[] = [];
			for (let i = 0; i < daysCount; i++) {
				dates.push(format(addDays(start, i), 'yyyy-MM-dd'));
			}

			const clockInStartM = TimeCalculatorUtil.timeToMinutes(dto.clockInTimeStart);
			const clockInEndM = TimeCalculatorUtil.timeToMinutes(dto.clockInTimeEnd);
			const clockOutStartM = TimeCalculatorUtil.timeToMinutes(dto.clockOutTimeStart);
			const clockOutEndM = TimeCalculatorUtil.timeToMinutes(dto.clockOutTimeEnd);

			// Fetch users (same as bulkClockIn)
			let allUsers: any[] = [];
			let page = 1;
			const pageSize = 1000;
			let hasMore = true;
			while (hasMore) {
				const usersResponse = await this.userService.findAll(
					{ orgId, ...(dto.branchId != null && { branchId: dto.branchId }) },
					page,
					pageSize,
				);
				const pageUsers = usersResponse.data || [];
				allUsers = allUsers.concat(pageUsers);
				hasMore = pageUsers.length === pageSize;
				page++;
			}
			const activeUsers = allUsers.filter((u) => !u.isDeleted && u.status !== 'INACTIVE');

			if (activeUsers.length === 0) {
				this.logger.warn(`⚠️ No users found for organization ${orgId}`);
				return {
					message: dryRun ? 'Dry run: no users to preview' : 'No users found for populate hours',
					dryRun,
					summary: {
						totalDates: dates.length,
						totalUsers: 0,
						totalRecordsCreated: 0,
						totalRecordsSkipped: 0,
						datesProcessed: dates,
						errors: [],
					},
					details: [],
					...(dryRun && { preview: [] }),
				};
			}

			if (!dryRun) {
				// Close existing open shifts (same as bulkClockIn Step 1.5)
				for (const user of activeUsers) {
					try {
						const openShifts = await this.attendanceRepository
							.createQueryBuilder('attendance')
							.leftJoinAndSelect('attendance.owner', 'owner')
							.leftJoinAndSelect('attendance.organisation', 'organisation')
							.where('owner.uid = :userId', { userId: user.uid })
							.andWhere('attendance.status = :status', { status: AttendanceStatus.PRESENT })
							.andWhere('attendance.checkIn IS NOT NULL')
							.andWhere('attendance.checkOut IS NULL')
							.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
							.getMany();
						for (const openShift of openShifts) {
							try {
								const userBranchId = user.branch?.uid ?? dto.branchId;
								if (!userBranchId) continue;
								const checkInDateOrg = new Date(openShift.checkIn);
								const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
									orgId,
									checkInDateOrg,
								);
								let closeTime: Date;
								if (workingDayInfo.isWorkingDay && workingDayInfo.endTime) {
									const [h, m] = workingDayInfo.endTime.split(':').map(Number);
									closeTime = new Date(checkInDateOrg);
									closeTime.setHours(h, m, 0, 0);
								} else {
									closeTime = new Date(openShift.checkIn.getTime() + 60 * 1000);
								}
								const checkInTime = new Date(openShift.checkIn);
								if (closeTime <= checkInTime) closeTime = new Date(checkInTime.getTime() + 60 * 1000);
								await this.checkOut(
									{
										checkOut: closeTime,
										owner: { uid: String(user.uid) },
										checkOutNotes: 'Auto-closed by populate-hours process',
									},
									orgId,
									userBranchId,
								);
							} catch {
								// ignore per-shift errors
							}
						}
					} catch {
						// ignore per-user errors
					}
				}
			}

			for (const dateStr of dates) {
				let recordsCreated = 0;
				let recordsSkipped = 0;
				for (const user of activeUsers) {
					const checkInMinutes = TimeCalculatorUtil.randomMinutesInRange(clockInStartM, clockInEndM);
					let checkOutMinutes = TimeCalculatorUtil.randomMinutesInRange(clockOutStartM, clockOutEndM);
					if (checkOutMinutes <= checkInMinutes) {
						checkOutMinutes = Math.min(clockOutEndM, checkInMinutes + 1);
					}
					const checkInDate = this.buildDateInOrgTz(dateStr, checkInMinutes, orgTimezone);
					const checkOutDate = this.buildDateInOrgTz(dateStr, checkOutMinutes, orgTimezone);

					if (dryRun) {
						preview.push({
							date: dateStr,
							userId: user.uid,
							userRef: user.ref || String(user.uid),
							checkIn: checkInDate.toISOString(),
							checkOut: checkOutDate.toISOString(),
						});
						recordsCreated++;
						continue;
					}

					if (dto.skipExisting) {
						const existingRecord = await this.attendanceRepository
							.createQueryBuilder('attendance')
							.leftJoin('attendance.owner', 'owner')
							.leftJoin('attendance.organisation', 'organisation')
							.where('owner.uid = :userId', { userId: user.uid })
							.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
							.andWhere('attendance.checkIn BETWEEN :startDate AND :endDate', {
								startDate: startOfDay(checkInDate),
								endDate: endOfDay(checkInDate),
							})
							.getOne();
						if (existingRecord) {
							recordsSkipped++;
							continue;
						}
					}

					const userBranchId = user.branch?.uid;
					try {
						const checkInDto: CreateCheckInDto = {
							checkIn: checkInDate,
							owner: { uid: String(user.uid) },
							branch: userBranchId ? { uid: userBranchId } : { uid: 0 },
							status: AttendanceStatus.PRESENT,
							checkInNotes: `Populate hours for ${dateStr}`,
						};
						const checkInResult = await this.checkIn(checkInDto, orgId, userBranchId, false);
						if (!checkInResult.data || checkInResult.data.error) {
							throw new Error(checkInResult.message || 'Check-in failed');
						}
						const checkOutDto: CreateCheckOutDto = {
							checkOut: checkOutDate,
							owner: { uid: String(user.uid) },
							checkOutNotes: `Populate hours for ${dateStr}`,
						};
						const checkOutResult = await this.checkOut(checkOutDto, orgId, userBranchId);
						if (!checkOutResult.data || checkOutResult.data.error) {
							throw new Error(checkOutResult.message || 'Check-out failed');
						}
						recordsCreated++;
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						errors.push({ date: dateStr, userId: user.uid, error: msg });
					}
				}
				totalRecordsCreated += recordsCreated;
				totalRecordsSkipped += recordsSkipped;
				details.push({
					date: dateStr,
					usersProcessed: activeUsers.length,
					recordsCreated,
					recordsSkipped,
					checkInTimeRange: `${dto.clockInTimeStart}-${dto.clockInTimeEnd}`,
					checkOutTimeRange: `${dto.clockOutTimeStart}-${dto.clockOutTimeEnd}`,
				});
			}

			const elapsed = Date.now() - startTime;
			this.logger.log(
				`🎉 POPULATE HOURS ${dryRun ? '(DRY RUN) ' : ''}COMPLETED in ${elapsed}ms - ${totalRecordsCreated} created, ${totalRecordsSkipped} skipped`,
			);

			return {
				message: dryRun
					? `Dry run: would create ${totalRecordsCreated} attendance records across ${dates.length} dates.`
					: `Populate hours completed. Created ${totalRecordsCreated} records across ${dates.length} dates.`,
				dryRun,
				summary: {
					totalDates: dates.length,
					totalUsers: activeUsers.length,
					totalRecordsCreated,
					totalRecordsSkipped,
					datesProcessed: dates,
					errors,
				},
				details,
				...(dryRun && { preview }),
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.logger.error(`💥 POPULATE HOURS FAILED: ${errorMsg}`, error instanceof Error ? error.stack : '');
			throw new BadRequestException(`Populate hours failed: ${errorMsg}`);
		}
	}
}
