import { Injectable, NotFoundException, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { IsNull, MoreThanOrEqual, Not, Repository, LessThanOrEqual, Between, In, LessThan } from 'typeorm';
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
} from 'date-fns';
import { UserService } from '../user/user.service';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { XP_VALUES } from '../lib/constants/constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BreakDetail } from '../lib/interfaces/break-detail.interface';
import { User } from '../user/entities/user.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { TimezoneUtil } from '../lib/utils/timezone.util';
import { Organisation } from 'src/organisation/entities/organisation.entity';

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

@Injectable()
export class AttendanceService {
	private readonly logger = new Logger(AttendanceService.name);
	private readonly CACHE_PREFIX = 'attendance:';
	private readonly CACHE_TTL: number;
	private readonly activeCalculations = new Set<number>();

	constructor(
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
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
	) {
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default
		this.logger.log('AttendanceService initialized with cache TTL: ' + this.CACHE_TTL + 'ms');
		this.logger.debug('AttendanceService initialized with all dependencies and enhanced calculation services');
		this.logger.debug(`Organization Hours Service: ${!!this.organizationHoursService}`);
		this.logger.debug(`Attendance Calculator Service: ${!!this.attendanceCalculatorService}`);
		this.logger.debug(`Unified Notification Service: ${!!this.unifiedNotificationService}`);
		this.logger.debug(`Rewards Service: ${!!this.rewardsService}`);
		this.logger.debug(`Event Emitter: ${!!this.eventEmitter}`);
		this.logger.debug(`Cache Manager: ${!!this.cacheManager}`);
	}

	// ======================================================
	// HELPER METHODS
	// ======================================================

	/**
	 * Check if user should see all branches (admin, owner, developer)
	 * @param userAccessLevel - User's access level
	 * @returns true if user should see all branches, false otherwise
	 */
	private shouldSeeAllBranches(userAccessLevel?: string): boolean {
		if (!userAccessLevel) {
			return false;
		}
		const elevatedRoles = [AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER];
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
	private async checkAndCalculateLateMinutes(orgId: number, checkInTime: Date): Promise<number> {
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
			const expectedStartTime = TimezoneUtil.parseTimeInOrganization(
				workingDayInfo.startTime,
				checkInTime,
				organizationTimezone
			);

			// Calculate late minutes with grace period (15 minutes)
			const gracePeriodMinutes = 15;
			const graceEndTime = TimezoneUtil.addMinutesInOrganizationTime(
				expectedStartTime,
				gracePeriodMinutes,
				organizationTimezone
			);

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

	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Get organization timezone with fallback
	 */
	private async getOrganizationTimezone(organizationId?: number): Promise<string> {
		if (!organizationId) {
			const fallbackTimezone = TimezoneUtil.getSafeTimezone();
			this.logger.debug(`No organizationId provided, using fallback timezone: ${fallbackTimezone}`);
			return fallbackTimezone;
		}

		try {
			const organizationHours = await this.organizationHoursService.getOrganizationHours(organizationId);
			const timezone = organizationHours?.timezone || TimezoneUtil.getSafeTimezone();
			this.logger.debug(`Organization ${organizationId} timezone: ${timezone}`);
			return timezone;
		} catch (error) {
			this.logger.warn(`Error getting timezone for org ${organizationId}, using default:`, error);
			const fallbackTimezone = TimezoneUtil.getSafeTimezone();
			this.logger.debug(`Using fallback timezone: ${fallbackTimezone}`);
			return fallbackTimezone;
		}
	}

	/**
	 * Format time in organization timezone for notifications
	 */
	private async formatTimeInOrganizationTimezone(date: Date, organizationId?: number): Promise<string> {
		const timezone = await this.getOrganizationTimezone(organizationId);
		return TimezoneUtil.formatInOrganizationTime(date, 'h:mm a', timezone);
	}

	/**
	 * Convert attendance record dates to organization timezone
	 * This ensures all date fields are returned in the user's local timezone instead of UTC
	 */
	private async convertAttendanceRecordTimezone(
		record: Attendance,
		organizationId?: number,
	): Promise<Attendance> {
		try {
			if (!record) return record;

			// Get organization timezone or use user's timezone from preferences
			let timezone = 'Africa/Johannesburg'; // Default fallback
			
			// First try to get timezone from organization
			if (organizationId) {
				timezone = await this.getOrganizationTimezone(organizationId);
			} else if (record.owner?.organisation?.uid) {
				timezone = await this.getOrganizationTimezone(record.owner.organisation.uid);
			} else if (record.organisation?.uid) {
				timezone = await this.getOrganizationTimezone(record.organisation.uid);
			}

			// If no organization timezone found, try user preferences
			if (timezone === TimezoneUtil.getSafeTimezone() && record.owner?.preferences?.timezone) {
				timezone = record.owner.preferences.timezone;
			}

			this.logger.debug(`Converting attendance record ${record.uid} to timezone: ${timezone}`);

			// Convert all date fields to organization timezone
			const convertedRecord = { ...record };

			// Convert main timestamp fields
			if (convertedRecord.checkIn) {
				const originalTime = new Date(convertedRecord.checkIn);
				convertedRecord.checkIn = TimezoneUtil.toOrganizationTime(originalTime, timezone);
				this.logger.debug(`CheckIn converted from ${originalTime.toISOString()} to ${convertedRecord.checkIn.toISOString()}`);
			}

			if (convertedRecord.checkOut) {
				const originalTime = new Date(convertedRecord.checkOut);
				convertedRecord.checkOut = TimezoneUtil.toOrganizationTime(originalTime, timezone);
				this.logger.debug(`CheckOut converted from ${originalTime.toISOString()} to ${convertedRecord.checkOut.toISOString()}`);
			}

			if (convertedRecord.breakStartTime) {
				const originalTime = new Date(convertedRecord.breakStartTime);
				convertedRecord.breakStartTime = TimezoneUtil.toOrganizationTime(originalTime, timezone);
			}

			if (convertedRecord.breakEndTime) {
				const originalTime = new Date(convertedRecord.breakEndTime);
				convertedRecord.breakEndTime = TimezoneUtil.toOrganizationTime(originalTime, timezone);
			}

			// Convert break details timestamps
			if (convertedRecord.breakDetails && Array.isArray(convertedRecord.breakDetails)) {
				convertedRecord.breakDetails = convertedRecord.breakDetails.map(breakDetail => ({
					...breakDetail,
					startTime: breakDetail.startTime ? TimezoneUtil.toOrganizationTime(new Date(breakDetail.startTime), timezone) : breakDetail.startTime,
					endTime: breakDetail.endTime ? TimezoneUtil.toOrganizationTime(new Date(breakDetail.endTime), timezone) : breakDetail.endTime,
				}));
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
		organizationId?: number,
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
	public async testTimezoneConversion(organizationId?: number): Promise<{
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
			const convertedDate = TimezoneUtil.toOrganizationTime(testDate, timezone);
			
			const original = testDate.toISOString();
			const converted = convertedDate.toISOString();
			const expected = '2025-09-18T07:25:00.000Z';
			const isWorking = converted === expected;
			
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
		organizationId?: number,
	): Promise<any> {
		try {
			if (!data) return data;

			// Log timezone conversion for debugging
			this.logger.debug(`[ensureTimezoneConversion] Processing data for organization: ${organizationId}`);

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
						if (user.checkInTime) {
							const originalTime = new Date(user.checkInTime);
							user.checkInTime = TimezoneUtil.toOrganizationTime(originalTime, timezone);
							this.logger.debug(`PresentUser checkInTime converted from ${originalTime.toISOString()} to ${user.checkInTime.toISOString()}`);
						}
						if (user.checkOutTime) {
							const originalTime = new Date(user.checkOutTime);
							user.checkOutTime = TimezoneUtil.toOrganizationTime(originalTime, timezone);
							this.logger.debug(`PresentUser checkOutTime converted from ${originalTime.toISOString()} to ${user.checkOutTime.toISOString()}`);
						}
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

	private async clearAttendanceCache(attendanceId?: number, userId?: number): Promise<void> {
		try {
			const keysToDelete: string[] = [];

			if (attendanceId) {
				keysToDelete.push(this.getCacheKey(attendanceId));
			}

			if (userId) {
				keysToDelete.push(this.getCacheKey(`user_${userId}`));
			}

			// Clear general attendance cache keys
			keysToDelete.push(this.getCacheKey('all'));
			keysToDelete.push(this.getCacheKey('today'));
			keysToDelete.push(this.getCacheKey('stats'));

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
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; data?: any }> {
		this.logger.log(`Check-in attempt for user ${checkInDto.owner.uid}, orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Check-in data: ${JSON.stringify(checkInDto)}`);
		this.logger.debug(
			`Check-in data: ${JSON.stringify({
				...checkInDto,
				owner: checkInDto.owner?.uid,
				organisation: orgId,
				branch: branchId,
			})}`,
		);

		try {
			// Enhanced validation
			this.logger.debug('Validating check-in data');
			if (!checkInDto.owner?.uid) {
				throw new BadRequestException('User ID is required for check-in');
			}

			if (!checkInDto.checkIn) {
				throw new BadRequestException('Check-in time is required');
			}

		// Check if user is already checked in - if so, check if same day or auto-close previous shift
		this.logger.debug(`Checking for existing active shift for user: ${checkInDto.owner.uid}`);
		const existingShift = await this.attendanceRepository.findOne({
			where: {
				owner: checkInDto.owner,
				status: AttendanceStatus.PRESENT,
				checkIn: Not(IsNull()),
				checkOut: IsNull(),
				organisation: orgId ? { uid: orgId } : undefined,
			},
			relations: ['owner'], // Load the owner relation to avoid undefined errors
		});

		if (existingShift) {
			this.logger.warn(`User ${checkInDto.owner.uid} already has an active shift - checking if same day`);
			
			// Get organization timezone for accurate date comparison
			const orgTimezone = await this.getOrganizationTimezone(orgId);
			
			// Convert both dates to organization timezone for comparison
			const existingShiftDate = TimezoneUtil.toOrganizationTime(
				new Date(existingShift.checkIn),
				orgTimezone
			);
			const newCheckInDate = TimezoneUtil.toOrganizationTime(
				new Date(checkInDto.checkIn),
				orgTimezone
			);
			
			// Check if both shifts are on the same calendar day in organization timezone
			const isSameCalendarDay = 
				existingShiftDate.getFullYear() === newCheckInDate.getFullYear() &&
				existingShiftDate.getMonth() === newCheckInDate.getMonth() &&
				existingShiftDate.getDate() === newCheckInDate.getDate();
			
			if (isSameCalendarDay) {
				// Same day - prevent check-in, return error
				this.logger.warn(
					`User ${checkInDto.owner.uid} already has active shift for today. ` +
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
			
			// Different day - proceed with auto-close
			this.logger.warn(
				`User ${checkInDto.owner.uid} has shift from different day - auto-closing previous shift`
			);
			
			try {
				// Pass true for skipPreferenceCheck since user is actively starting a new shift
				// User's active action to start a new shift should override their shiftAutoEnd preference
				// The preference only applies to scheduled/automated shift closures, not when user actively checks in
				// Pass the new check-in time as the close time for the old shift
				await this.autoCloseExistingShift(existingShift, orgId, true, new Date(checkInDto.checkIn));
				this.logger.log(`Successfully auto-closed existing shift from different day for user ${checkInDto.owner.uid}`);
			} catch (error) {
				this.logger.error(
					`Failed to auto-close existing shift for user ${checkInDto.owner.uid}: ${error.message}`,
				);
				// Re-throw the error to ensure it's properly caught by consolidation logic
				throw new BadRequestException(
					`Failed to process check-in: User is already checked in and auto-close failed. ${error.message}`,
				);
			}
		}

		// Enhanced data mapping - save record first WITHOUT location processing
		// Location processing will happen asynchronously after response is sent
		const attendanceData = {
			...checkInDto,
			status: checkInDto.status || AttendanceStatus.PRESENT,
			organisation: orgId ? { uid: orgId } : undefined,
			branch: branchId ? { uid: branchId } : undefined,
			placesOfInterest: null, // Will be updated asynchronously
		};

		this.logger.debug('Saving check-in record to database');
		const checkIn = await this.attendanceRepository.save(attendanceData);

		if (!checkIn) {
			this.logger.error('Failed to create check-in record - database returned null');
			throw new NotFoundException(process.env.CREATE_ERROR_MESSAGE || 'Failed to create attendance record');
		}

		this.logger.debug(`Check-in record created successfully with ID: ${checkIn.uid}`);

			// Clear attendance cache after successful check-in
			await this.clearAttendanceCache(checkIn.uid, checkInDto.owner.uid);

			// Enhanced response data mapping
			const responseData = {
				attendanceId: checkIn.uid,
				userId: checkInDto.owner.uid,
				checkInTime: checkIn.checkIn,
				status: checkIn.status,
				organisationId: orgId,
				branchId: branchId,
				location:
					checkInDto.checkInLatitude && checkInDto.checkInLongitude
						? {
								latitude: checkInDto.checkInLatitude,
								longitude: checkInDto.checkInLongitude,
								accuracy: 10, // Default accuracy if not provided
						  }
						: null,
				xpAwarded: XP_VALUES.CHECK_IN,
				timestamp: new Date(),
			};

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
							this.logger.debug(`Processing check-in location coordinates asynchronously for user: ${checkInDto.owner.uid}`);
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

					// Award XP with enhanced error handling
					try {
						this.logger.debug(
							`Awarding XP for check-in to user: ${checkInDto.owner.uid}, amount: ${XP_VALUES.CHECK_IN}`,
						);
						await this.rewardsService.awardXP(
							{
								owner: checkInDto.owner.uid,
								amount: XP_VALUES.CHECK_IN,
								action: XP_VALUES_TYPES.ATTENDANCE,
								source: {
									id: checkInDto.owner.uid.toString(),
									type: XP_VALUES_TYPES.ATTENDANCE,
									details: 'Check-in reward',
								},
							},
							orgId,
							branchId,
						);
						this.logger.debug(`XP awarded successfully for check-in to user: ${checkInDto.owner.uid}`);
					} catch (xpError) {
						this.logger.error(`Failed to award XP for check-in to user: ${checkInDto.owner.uid}`, xpError.stack);
						// Don't fail the check-in if XP award fails
					}

					// Send enhanced shift start notification with improved messaging
					try {
						// Get user info for personalized message with email and relations
						const user = await this.userRepository.findOne({
							where: { uid: checkInDto.owner.uid },
							select: ['uid', 'name', 'surname', 'email', 'username'],
							relations: ['organisation', 'branch', 'branch.organisation'],
						});

						// Construct full name with proper fallbacks
						const fullName = `${user?.name || ''} ${user?.surname || ''}`.trim();
						const userName = fullName || user?.username || 'Team Member';
						
						// Format check-in time in organization timezone
						const checkInTime = await this.formatTimeInOrganizationTimezone(new Date(checkIn.checkIn), orgId);

						this.logger.debug(`Sending enhanced shift start notification to user: ${checkInDto.owner.uid}`);
						// Send push notification
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.ATTENDANCE_SHIFT_STARTED,
							[checkInDto.owner.uid],
							{
								checkInTime,
								userName,
								userId: checkInDto.owner.uid,
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
							`Shift start push notification sent successfully to user: ${checkInDto.owner.uid}`,
						);
					} catch (notificationError) {
						this.logger.warn(
							`Failed to send shift start notification to user: ${checkInDto.owner.uid}`,
							notificationError.message,
						);
						// Don't fail the check-in if notification fails
					}

					// Check if user is late and send late notification if applicable
					try {
						if (orgId) {
							const lateMinutes = await this.checkAndCalculateLateMinutes(orgId, new Date(checkIn.checkIn));
							if (lateMinutes > 0) {
								this.logger.debug(
									`User ${checkInDto.owner.uid} is ${lateMinutes} minutes late - sending notification`,
								);
								await this.sendShiftReminder(
									checkInDto.owner.uid,
									'late',
									orgId,
									branchId,
									undefined,
									lateMinutes,
								);
							}
						}
					} catch (lateCheckError) {
						this.logger.warn(
							`Failed to check/send late notification for user: ${checkInDto.owner.uid}`,
							lateCheckError.message,
						);
						// Don't fail the check-in if late check fails
					}

				} catch (backgroundError) {
					this.logger.error(`Background check-in tasks failed for user ${checkInDto.owner.uid}:`, backgroundError.message);
					// Don't affect user experience
				}
			});

			this.logger.log(`Check-in successful for user: ${checkInDto.owner.uid}`);
			return response;
		} catch (error) {
			this.logger.error(`Check-in failed for user: ${checkInDto.owner?.uid}`, error.stack);

			// Enhanced error response mapping
			const errorResponse = {
				message: error?.message || 'Check-in failed',
				data: null,
			};

			return errorResponse;
		}
	}

	/**
	 * Auto-close an existing shift
	 * 
	 * @param existingShift - The attendance record to close
	 * @param orgId - Organization ID for timezone and hours configuration
	 * @param skipPreferenceCheck - If true, ignores user's shiftAutoEnd preference (used when user actively starts new shift)
	 *                             If false, respects user's shiftAutoEnd preference (used for scheduled auto-close)
	 * @param closeAtTime - Optional explicit close time. If provided, uses this time instead of org close time (used for user-triggered close)
	 */
	private async autoCloseExistingShift(
		existingShift: Attendance, 
		orgId?: number,
		skipPreferenceCheck: boolean = false,
		closeAtTime?: Date
	): Promise<void> {
		// Validate existingShift object
		if (!existingShift) {
			throw new Error('Existing shift is undefined');
		}

		const userId = existingShift.owner?.uid || 'unknown';
		this.logger.debug(
			`Auto-closing existing shift for user ${userId}, orgId: ${orgId}, skipPreferenceCheck: ${skipPreferenceCheck}`
		);

		// Only check user preferences if this is NOT triggered by a new check-in
		// When a user actively starts a new shift, we should close the old one regardless of preferences
		// Preferences only apply to scheduled/automated shift closures
		if (!skipPreferenceCheck) {
			this.logger.debug(`Checking user preferences for shift auto-end (scheduled auto-close scenario)`);
			try {
				const user = await this.userRepository.findOne({
					where: { uid: Number(userId) },
					select: ['uid', 'preferences'],
				});

				if (user?.preferences?.shiftAutoEnd === false) {
					this.logger.debug(`User ${userId} has disabled shift auto-end, skipping auto-close`);
					throw new Error(`User has disabled automatic shift ending`);
				}

				this.logger.debug(`User ${userId} preferences allow auto-close, proceeding`);
			} catch (error) {
				if (error.message.includes('disabled automatic')) {
					throw error; // Re-throw the user preference error
				}
				this.logger.warn(
					`Could not fetch user preferences for ${userId}, defaulting to allow auto-close: ${error.message}`,
				);
				// Continue with auto-close if we can't fetch preferences (fail-safe)
			}
		} else {
			this.logger.debug(
				`Skipping preference check - user is actively starting a new shift (preference check bypassed)`
			);
		}

		// Get organization timezone for accurate close time calculation
		const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
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
				`Using explicit close time for user-triggered auto-close: ${closeTime.toISOString()} for user ${userId}`
			);
		} else {
			// Scheduled auto-close: use organization close time
			closeTime = TimezoneUtil.parseTimeInOrganization('16:30', checkInDate, organizationTimezone);

			try {
				// Try to get organization hours if orgId is provided
				if (orgId) {
					this.logger.debug(`Attempting to fetch organization hours for org ${orgId}`);

					const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, checkInDate);

					if (workingDayInfo && workingDayInfo.isWorkingDay && workingDayInfo.endTime) {
						// Parse organization close time (format: "HH:MM") in organization's timezone
						try {
							closeTime = TimezoneUtil.parseTimeInOrganization(
								workingDayInfo.endTime,
								checkInDate,
								organizationTimezone
							);

							// If the close time would be before the check-in time (e.g., night shift),
							// add one day
							if (closeTime <= checkInDate) {
								closeTime = TimezoneUtil.addMinutesInOrganizationTime(
									closeTime,
									24 * 60,
									organizationTimezone
								);
							}

							this.logger.debug(
								`Using organization close time: ${workingDayInfo.endTime} for user ${userId}`,
							);
						} catch (parseError) {
							this.logger.warn(
								`Error parsing organization close time: ${parseError.message}, using default 4:30 PM`,
							);
							// closeTime already set to default 4:30 PM
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
			this.logger.debug(`Setting auto-close time to: ${closeTime.toISOString()} for user ${userId}`);

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

			// Cap duration at expected work hours, rest goes to overtime
			const durationMinutes = Math.min(workSession.netWorkMinutes, expectedWorkMinutes);
			const overtimeMinutes = Math.max(0, workSession.netWorkMinutes - expectedWorkMinutes);

			const duration = TimeCalculatorUtil.formatDuration(durationMinutes);
			const overtimeDuration = TimeCalculatorUtil.formatDuration(overtimeMinutes);

			this.logger.debug(
				`Auto-close calculated - Duration: ${duration} (${durationMinutes} min), ` +
				`Overtime: ${overtimeDuration} (${overtimeMinutes} min)`
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

			this.logger.log(`Auto-closed existing shift for user ${userId} at ${closeTime.toISOString()}`);

			// Clear attendance cache after auto-close to ensure fresh data in subsequent queries
			await this.clearAttendanceCache(existingShift.uid, Number(userId));
			this.logger.debug(`Cleared cache for auto-closed shift ${existingShift.uid} and user ${userId}`);

			// Send email notification about auto-close
			await this.sendAutoCloseShiftNotification(existingShift, closeTime, orgId);
		} catch (error) {
			this.logger.error(`Error auto-closing existing shift for user ${userId}: ${error.message}`);

			// Fallback: still try to close the shift with default time (4:30 PM in org timezone)
			try {
				closeTime = TimezoneUtil.parseTimeInOrganization('16:30', checkInDate, organizationTimezone);

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

				// Use default expected work minutes for fallback
				const fallbackExpectedWorkMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
				
				// Cap duration at expected work hours
				const fallbackDurationMinutes = Math.min(fallbackWorkSession.netWorkMinutes, fallbackExpectedWorkMinutes);
				const fallbackOvertimeMinutes = Math.max(0, fallbackWorkSession.netWorkMinutes - fallbackExpectedWorkMinutes);

				const fallbackDuration = TimeCalculatorUtil.formatDuration(fallbackDurationMinutes);
				const fallbackOvertimeDuration = TimeCalculatorUtil.formatDuration(fallbackOvertimeMinutes);

				this.logger.debug(
					`Fallback auto-close - Duration: ${fallbackDuration}, Overtime: ${fallbackOvertimeDuration}`
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
				this.logger.log(`Fallback auto-close successful for user ${userId} at 4:30 PM`);

				// Clear attendance cache after fallback auto-close
				await this.clearAttendanceCache(existingShift.uid, Number(userId));
				this.logger.debug(`Cleared cache for fallback auto-closed shift ${existingShift.uid} and user ${userId}`);

				// Send email notification about fallback auto-close
				await this.sendAutoCloseShiftNotification(existingShift, closeTime, orgId);
			} catch (fallbackError) {
				this.logger.error(`Fallback auto-close also failed for user ${userId}: ${fallbackError.message}`);
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
		orgId?: number,
	): Promise<void> {
		try {
			const userId = closedShift.owner?.uid;
			if (!userId) {
				this.logger.warn('Cannot send auto-close notification: No user ID found');
				return;
			}

			// Get user details
			const user = await this.userRepository.findOne({
				where: { uid: Number(userId) },
				relations: ['organisation', 'branch'],
			});

			if (!user?.email) {
				this.logger.warn(`Cannot send auto-close notification: No email found for user ${userId}`);
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
			`✅ [AttendanceService] Auto-close shift notification processed for user: ${userId}`,
		);
	} catch (error) {
		this.logger.error(
			`❌ [AttendanceService] Failed to send auto-close shift notification: ${error.message}`,
		);
		// Don't fail the auto-close process if notification fails
	}
	}

	public async checkOut(
		checkOutDto: CreateCheckOutDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; data?: any }> {
		this.logger.log(`Check-out attempt for user ${checkOutDto.owner.uid}, orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Check-out data: ${JSON.stringify(checkOutDto)}`);
		this.logger.debug(
			`Check-out data: ${JSON.stringify({
				...checkOutDto,
				owner: checkOutDto.owner?.uid,
				organisation: orgId,
				branch: branchId,
			})}`,
		);

		try {
			// Enhanced validation
			this.logger.debug('Validating check-out data');
			if (!checkOutDto.owner?.uid) {
				throw new BadRequestException('User ID is required for check-out');
			}

			if (!checkOutDto.checkOut) {
				throw new BadRequestException('Check-out time is required');
			}

			this.logger.debug('Finding active shift for check-out');
			const activeShift = await this.attendanceRepository.findOne({
				where: {
					status: AttendanceStatus.PRESENT,
					owner: checkOutDto?.owner,
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
					organisation: orgId ? { uid: orgId } : undefined,
					branch: branchId ? { uid: branchId } : undefined,
				},
				relations: ['owner', 'owner.organisation'],
				order: {
					checkIn: 'DESC',
				},
			});

			if (!activeShift) {
				this.logger.warn(`No active shift found for check-out for user: ${checkOutDto.owner?.uid}`);
				return {
					message: 'No active shift found. Please check in first.',
					data: { error: 'NO_ACTIVE_SHIFT', success: false }
				};
			}

			this.logger.debug(`Active shift found for user: ${checkOutDto.owner?.uid}, shift ID: ${activeShift.uid}`);

			const checkOutTime = checkOutDto.checkOut ? new Date(checkOutDto.checkOut) : new Date();
			const checkInTime = new Date(activeShift.checkIn);

			// Validate check-out time is after check-in time
			if (checkOutTime <= checkInTime) {
				throw new BadRequestException('Check-out time must be after check-in time');
			}

			this.logger.debug(
				`Calculating work duration: check-in at ${checkInTime.toISOString()}, check-out at ${checkOutTime.toISOString()}`,
			);

			// Enhanced calculation using our new utilities
			const organizationId = activeShift.owner?.organisation?.uid;
			this.logger.debug(`Processing time calculations for organization: ${organizationId}`);

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
			organizationId ? await this.organizationHoursService.getOrganizationHours(organizationId) : null,
		);

		this.logger.debug(
			`Work session calculated - net work minutes: ${workSession.netWorkMinutes}`,
		);

		// Get expected work minutes from organization hours
		let expectedWorkMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES; // Default 8 hours (480 minutes)
		
		if (organizationId) {
			try {
				const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
					organizationId,
					checkInTime,
				);
				expectedWorkMinutes = workingDayInfo.expectedWorkMinutes || expectedWorkMinutes;
				this.logger.debug(
					`Expected work minutes for organization: ${expectedWorkMinutes} (${expectedWorkMinutes / 60} hours)`,
				);
			} catch (error) {
				this.logger.warn(
					`Failed to fetch expected work minutes for org ${organizationId}, using default: ${expectedWorkMinutes}`,
					error.message,
				);
			}
		}

		// Cap duration at expected work hours, rest goes to overtime
		// Duration = min(actual work time, expected work time)
		// Overtime = max(0, actual work time - expected work time)
		const durationMinutes = Math.min(workSession.netWorkMinutes, expectedWorkMinutes);
		const overtimeMinutes = Math.max(0, workSession.netWorkMinutes - expectedWorkMinutes);

		const duration = TimeCalculatorUtil.formatDuration(durationMinutes);
		const overtimeDuration = TimeCalculatorUtil.formatDuration(overtimeMinutes);

		this.logger.debug(
			`Duration capped at expected hours: ${duration} (${durationMinutes} minutes), ` +
			`Overtime: ${overtimeDuration} (${overtimeMinutes} minutes), ` +
			`Total work time: ${workSession.netWorkMinutes} minutes`,
		);

		// Enhanced data mapping for shift update - location will be processed asynchronously
		const updatedShift = {
			...activeShift,
			...checkOutDto,
			checkOut: checkOutTime,
			duration,
			overtime: overtimeDuration,
			status: AttendanceStatus.COMPLETED,
			// Keep existing placesOfInterest - will be updated asynchronously if needed
		};

		this.logger.debug('Saving updated shift with check-out data');
		await this.attendanceRepository.save(updatedShift);
		this.logger.debug(`Shift updated successfully for user: ${checkOutDto.owner?.uid}`);

			// Clear attendance cache after successful check-out
			await this.clearAttendanceCache(activeShift.uid, checkOutDto.owner.uid);

			// Enhanced response data mapping
			const responseData = {
				attendanceId: activeShift.uid,
				userId: checkOutDto.owner.uid,
				checkInTime: activeShift.checkIn,
				checkOutTime: checkOutTime,
				duration,
				overtime: overtimeDuration,
				totalWorkMinutes: workSession.netWorkMinutes,
				totalBreakMinutes: breakMinutes,
				status: AttendanceStatus.COMPLETED,
				organisationId: orgId,
				branchId: branchId,
				location:
					checkOutDto.checkOutLatitude && checkOutDto.checkOutLongitude
						? {
								latitude: checkOutDto.checkOutLatitude,
								longitude: checkOutDto.checkOutLongitude,
								accuracy: 10, // Default accuracy if not provided
						  }
						: null,
				xpAwarded: XP_VALUES.CHECK_OUT,
				timestamp: new Date(),
			};

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Check-out recorded successfully',
				data: responseData,
			};

			// Award XP with enhanced error handling
			try {
				this.logger.debug(
					`Awarding XP for check-out to user: ${checkOutDto.owner.uid}, amount: ${XP_VALUES.CHECK_OUT}`,
				);
				await this.rewardsService.awardXP(
					{
						owner: checkOutDto.owner.uid,
						amount: XP_VALUES.CHECK_OUT,
						action: XP_VALUES_TYPES.ATTENDANCE,
						source: {
							id: checkOutDto.owner.uid.toString(),
							type: XP_VALUES_TYPES.ATTENDANCE,
							details: 'Check-out reward',
						},
					},
					orgId,
					branchId,
				);
				this.logger.debug(`XP awarded successfully for check-out to user: ${checkOutDto.owner.uid}`);
			} catch (xpError) {
				this.logger.error(`Failed to award XP for check-out to user: ${checkOutDto.owner.uid}`, xpError.stack);
				// Don't fail the check-out if XP award fails
			}

			// Send enhanced shift end notification with improved messaging
			try {
				// Format times in organization timezone
				const checkOutTimeString = await this.formatTimeInOrganizationTimezone(checkOutTime, orgId);
				const checkInTimeString = await this.formatTimeInOrganizationTimezone(new Date(activeShift.checkIn), orgId);

			// Get user info for personalized message with email and relations
			const user = await this.userRepository.findOne({
				where: { uid: checkOutDto.owner.uid },
				select: ['uid', 'name', 'surname', 'email', 'username'],
				relations: ['organisation', 'branch', 'branch.organisation'],
			});

			// Construct full name with proper fallbacks
			const fullName = `${user?.name || ''} ${user?.surname || ''}`.trim();
			const userName = fullName || user?.username || 'Team Member';
			const workHours = Math.floor(workSession.netWorkMinutes / 60);
				const workMinutesDisplay = workSession.netWorkMinutes % 60;
				const workTimeDisplay = `${workHours}h ${workMinutesDisplay}m`;

				this.logger.debug(`Sending enhanced shift end notification to user: ${checkOutDto.owner.uid}`);
				// Send push notification
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_SHIFT_ENDED,
					[checkOutDto.owner.uid],
					{
						checkOutTime: checkOutTimeString,
						checkInTime: checkInTimeString,
						duration,
						workTimeDisplay,
						totalWorkMinutes: workSession.netWorkMinutes,
						totalBreakMinutes: breakMinutes,
						userName,
						userId: checkOutDto.owner.uid,
						organisationId: orgId,
						branchId: branchId,
						xpAwarded: XP_VALUES.CHECK_OUT,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.NORMAL,
						sendEmail: false, // We'll handle email separately
					},
				);

				this.logger.debug(
					`Shift end push notification sent successfully to user: ${checkOutDto.owner.uid}`,
				);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send shift end notification to user: ${checkOutDto.owner.uid}`,
					notificationError.message,
				);
				// Don't fail the check-out if notification fails
			}

			// Return success response immediately to user after shift-ended email is sent
			this.logger.log(`Check-out successful for user: ${checkOutDto.owner?.uid}, duration: ${duration}`);
			
			// Process non-critical operations asynchronously (don't block user response)
			setImmediate(async () => {
				try {
					// Process check-out location if coordinates are provided (async)
					try {
						if (checkOutDto.checkOutLatitude && checkOutDto.checkOutLongitude) {
							this.logger.debug(`Processing check-out location coordinates asynchronously for user: ${checkOutDto.owner.uid}`);
							const checkOutAddress = await this.processLocationCoordinates(
								checkOutDto.checkOutLatitude,
								checkOutDto.checkOutLongitude,
								'Check-out Location'
							);

							if (checkOutAddress) {
								// Update placesOfInterest with check-out location
								const currentRecord = await this.attendanceRepository.findOne({
									where: { uid: activeShift.uid },
								});

								let updatedPlacesOfInterest = currentRecord?.placesOfInterest;
								if (updatedPlacesOfInterest) {
									// Update existing placesOfInterest with end address
									updatedPlacesOfInterest.endAddress = checkOutAddress;
								} else {
									// Create new placesOfInterest if it doesn't exist
									updatedPlacesOfInterest = {
										startAddress: null, // This should have been set during check-in
										endAddress: checkOutAddress,
										breakStart: null,
										breakEnd: null,
										otherPlacesOfInterest: []
									};
								}

								await this.attendanceRepository.update(activeShift.uid, {
									placesOfInterest: updatedPlacesOfInterest
								});
								this.logger.debug(`Location data updated successfully for check-out: ${activeShift.uid}`);
							}
						}
					} catch (locationError) {
						this.logger.error(`Failed to process location for check-out ${activeShift.uid}:`, locationError.message);
						// Don't fail check-out if location processing fails
					}

					// Check and send overtime notification if applicable
					try {
						const organizationId = activeShift.owner?.organisation?.uid;
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
									where: { uid: checkOutDto.owner.uid },
									select: ['uid', 'name', 'surname', 'username'],
								});

								// Construct full name with proper fallbacks
								const fullName = `${user?.name || ''} ${user?.surname || ''}`.trim();
								const userName = fullName || user?.username || 'Team Member';

								this.logger.debug(`Sending enhanced overtime notification to user: ${checkOutDto.owner.uid}`);
								await this.unifiedNotificationService.sendTemplatedNotification(
									NotificationEvent.ATTENDANCE_OVERTIME_REMINDER,
									[checkOutDto.owner.uid],
									{
										overtimeDuration,
										overtimeMinutes: cappedMinutes, // Total minutes for :duration formatter
										overtimeHours: overtimeHours,
										overtimeFormatted: overtimeDuration,
										regularHours: (workSession.netWorkMinutes - overtimeInfo.overtimeMinutes) / 60,
										totalWorkMinutes: workSession.netWorkMinutes,
										userName,
										userId: checkOutDto.owner.uid,
										timestamp: new Date().toISOString(),
									},
									{
										priority: NotificationPriority.HIGH,
									},
								);
								this.logger.debug(
									`Enhanced overtime notification sent successfully to user: ${checkOutDto.owner.uid}`,
								);

								// Also send overtime notification using the enhanced sendShiftReminder method
								await this.sendShiftReminder(
									checkOutDto.owner.uid,
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
							`Failed to send overtime notification to user: ${checkOutDto.owner.uid}`,
							overtimeNotificationError.message,
						);
						// Don't fail the async processing if overtime notification fails
					}

					// Emit daily report event for async processing (user already got their response)
					this.logger.debug(`Emitting daily report event for user: ${checkOutDto?.owner?.uid}, attendance: ${activeShift.uid}`);
					this.eventEmitter.emit('daily-report', {
						userId: checkOutDto?.owner?.uid,
						attendanceId: activeShift.uid, // Include the attendance ID that triggered this report
						triggeredByActivity: true, // This report is triggered by actual user activity (check-out)
					});

					// Emit other background events
					this.eventEmitter.emit('user.target.update.required', { userId: checkOutDto?.owner?.uid });
					this.eventEmitter.emit('user.metrics.update.required', checkOutDto?.owner?.uid);
					this.logger.debug(`Background events emitted successfully for user: ${checkOutDto?.owner?.uid}`);

				} catch (asyncError) {
					this.logger.error(`Error in async checkout processing for user ${checkOutDto?.owner?.uid}:`, asyncError.stack);
					// Don't propagate errors from async operations
				}
			});

			return response;
		} catch (error) {
			this.logger.error(`Check-out failed for user: ${checkOutDto.owner?.uid}`, error.stack);

			// Enhanced error response mapping
			const errorResponse = {
				message: error?.message || 'Check-out failed',
				data: null,
			};

			return errorResponse;
		}
	}


	public async allCheckIns(orgId?: number, branchId?: number, userAccessLevel?: string): Promise<{ message: string; checkIns: Attendance[] }> {
		// Get effective branch ID based on user role
		const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);
		this.logger.log(`Fetching all check-ins, orgId: ${orgId}, branchId: ${branchId}, effectiveBranchId: ${effectiveBranchId}, userAccessLevel: ${userAccessLevel}`);

		try {
			const cacheKey = this.getCacheKey(`all_${orgId || 'no-org'}_${effectiveBranchId || 'no-branch'}`);
			const cachedResult = await this.cacheManager.get(cacheKey);

			if (cachedResult) {
				this.logger.debug(
					`Retrieved cached check-ins result`,
				);
				
				// Apply timezone conversion to cached results using enhanced method
				const cachedResultWithTimezone = await this.ensureTimezoneConversion(cachedResult, orgId);
				
				return cachedResultWithTimezone;
			}

			const whereConditions: any = {};

			// Apply organization filtering - CRITICAL: Only show data for the user's organization
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
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
		orgId?: number,
		branchId?: number,
		userAccessLevel?: string,
	): Promise<{ message: string; checkIns: Attendance[] }> {
		// This endpoint returns org-wide data - no branch filtering applied
		this.logger.log(`Fetching check-ins for date: ${date}, orgId: ${orgId} (org-wide, no branch filtering)`);
		try {
			// Get organization timezone for accurate date range
			const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';
			
			// Use date-fns to properly handle start and end of day in organization timezone
			const dateObj = new Date(date);
			const dayStart = startOfDay(dateObj);
			const dayEnd = endOfDay(dateObj);
			const startOfDayConverted = TimezoneUtil.toOrganizationTime(dayStart, organizationTimezone);
			const endOfDayConverted = TimezoneUtil.toOrganizationTime(dayEnd, organizationTimezone);

			const whereConditions: any = {
				checkIn: Between(startOfDayConverted, endOfDayConverted),
			};

			// Apply organization filtering only - no branch filtering for org-wide results
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
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
		if (orgId) {
			ongoingShiftsConditions.organisation = { uid: orgId };
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
		orgId?: number,
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
					expectedShiftTime =
						expectedShiftTime || workingDayInfo.startTime || organizationHours?.openTime || '09:00';
					expectedEndTime = workingDayInfo.endTime || organizationHours?.closeTime || '17:00';
				} catch (error) {
					this.logger.warn(
						`[${operationId}] Could not get organization hours for org ${orgId}:`,
						error.message,
					);
					expectedShiftTime = expectedShiftTime || '09:00'; // Default fallback
					expectedEndTime = '17:00';
				}
			}

		// Get user info for personalized messages with relations
		const user = await this.userRepository.findOne({
			where: { uid: userId },
			select: ['uid', 'name', 'surname', 'email', 'username'],
			relations: ['organisation', 'branch', 'branch.organisation'],
		});

		if (!user) {
			this.logger.warn(`[${operationId}] User ${userId} not found`);
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

		// Send push notification only (no emails for reminders)
		await this.unifiedNotificationService.sendTemplatedNotification(
			notificationType,
			[Number(userId)],
			notificationData,
			{
				priority,
				sendEmail: false,
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
	private async getOrganizationAdmins(orgId: number): Promise<any[]> {
		try {
			const adminUsers = await this.userRepository.find({
				where: {
					organisation: { uid: orgId },
					accessLevel: AccessLevel.ADMIN,
				},
				select: ['uid', 'email'],
			});
			return adminUsers;
		} catch (error) {
			this.logger.error(`Error fetching org admins for org ${orgId}:`, error.message);
			return [];
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
					// Get organization timezone for accurate time calculations
					const orgId = breakRecord.owner.organisation?.uid;
					const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
					const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';
					
					// Get current time in organization's timezone
					const now = TimezoneUtil.getCurrentOrganizationTime(organizationTimezone);
					
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
									breakStartTime: await this.formatTimeInOrganizationTimezone(breakStartTime, breakRecord.owner.organisation?.uid),
									currentTime: await this.formatTimeInOrganizationTimezone(now, breakRecord.owner.organisation?.uid),
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
									const orgId = breakRecord.owner.organisation?.uid;
									if (orgId) {
										await this.notifyAdminsAboutLongBreak(
											operationId,
											orgId,
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
		orgId: number,
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
					// Get organization hours and timezone
					const organizationHours = await this.organizationHoursService.getOrganizationHours(org.uid);
					const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';
					const orgCurrentTime = TimezoneUtil.toOrganizationTime(now, organizationTimezone);

					// Only check during reasonable business hours (extended for pre-work reminders)
					const currentHour = orgCurrentTime.getHours();
					if (currentHour < 5 || currentHour > 23) {
						continue;
					}

					// Get organization working day info
					const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
						org.uid,
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

				// Calculate notification windows using TimezoneUtil to properly handle organization timezone
				const [startHour, startMinute] = startTime.split(':').map(Number);
				const [endHour, endMinute] = endTime.split(':').map(Number);

				// Parse organization working times in their timezone
				const orgStartTime = TimezoneUtil.parseTimeInOrganization(startTime, orgCurrentTime, organizationTimezone);
				const orgEndTime = TimezoneUtil.parseTimeInOrganization(endTime, orgCurrentTime, organizationTimezone);

				// 30 minutes BEFORE start time (shift start reminder)
				const preShiftReminderTime = TimezoneUtil.addMinutesInOrganizationTime(orgStartTime, -30, organizationTimezone);

				// 30 minutes AFTER start time (missed shift alert)
				const missedShiftAlertTime = TimezoneUtil.addMinutesInOrganizationTime(orgStartTime, 30, organizationTimezone);

				// 30 minutes BEFORE end time (checkout reminder)
				const preCheckoutReminderTime = TimezoneUtil.addMinutesInOrganizationTime(orgEndTime, -30, organizationTimezone);

				// 30 minutes AFTER end time (missed checkout alert)
				const missedCheckoutAlertTime = TimezoneUtil.addMinutesInOrganizationTime(orgEndTime, 30, organizationTimezone);

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
					const orgUsers = await this.userRepository.find({
						where: {
							organisation: { uid: org.uid },
							isDeleted: false,
							status: 'ACTIVE',
						},
						select: ['uid', 'name', 'surname', 'email'],
					});

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

					// Also notify organization admins
					await this.notifyAdminsAboutMissedShift(operationId, org.uid, user, startTime);

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

					// Also notify organization admins
					await this.notifyAdminsAboutMissedCheckout(operationId, org.uid, user, endTime, activeShift);

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
		orgId: number,
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
		orgId: number,
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
		orgId?: number,
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
			`[${operationId}] Getting daily attendance overview for orgId: ${orgId}, branchId: ${branchId}, effectiveBranchId: ${effectiveBranchId}, userAccessLevel: ${userAccessLevel}, date: ${
				date || 'today'
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
			if (orgId) {
				userConditions.organisation = { uid: orgId };
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
				attendanceConditions.organisation = { uid: orgId };
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

			// Apply timezone conversion to today's attendance records first
			const todayAttendanceWithTimezone = await this.convertAttendanceRecordsTimezone(todayAttendance, orgId);

			this.logger.debug(`[${operationId}] Applied timezone conversion to ${todayAttendanceWithTimezone.length} attendance records`);

			// Build present users list with enhanced data (no duplicates) using timezone-converted data
			const presentUsersMap = new Map<number, any>();
			const presentUserIds = new Set<number>();

			todayAttendanceWithTimezone?.forEach((attendance) => {
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
						checkInTime: attendance.checkIn, // Now in correct timezone
						checkOutTime: attendance.checkOut || null, // Now in correct timezone
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

		// Timezone conversion already applied to attendance records at line 2566
		// No need for second conversion to avoid double timezone shift
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
		orgId?: number,
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
			// Get organization timezone for accurate date range
			const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
			const organizationTimezone = organizationHours?.timezone || 'Africa/Johannesburg';
			
			// Use date-fns with timezone conversion for start and end of period
			const periodStart = startOfDay(startDate);
			const periodEnd = endOfDay(endDate);
			const startOfPeriod = TimezoneUtil.toOrganizationTime(periodStart, organizationTimezone);
			const endOfPeriod = TimezoneUtil.toOrganizationTime(periodEnd, organizationTimezone);

			const whereConditions: any = {};

			// Apply organization and branch filtering
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
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
		ref: number,
		orgId?: number,
		branchId?: number,
		userAccessLevel?: string,
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
		try {
			const whereConditions: any = {
				owner: {
					uid: ref,
				},
			};

			// Apply organization filtering - validate user belongs to requester's org
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Apply branch filtering if provided (and user is not admin/owner/developer)
			if (effectiveBranchId) {
				whereConditions.branch = { uid: effectiveBranchId };
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
			const response = {
				message: process.env.SUCCESS_MESSAGE,
				startTime: `${checkIn.checkIn}`,
				endTime: `${checkIn.checkOut}`,
				createdAt: `${checkIn.createdAt}`,
				updatedAt: `${checkIn.updatedAt}`,
				verifiedAt: `${checkIn.verifiedAt}`,
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
		ref: number,
		orgId?: number,
		branchId?: number,
		userAccessLevel?: string,
	): Promise<{ message: string; checkIns: Attendance[]; user: any }> {
		// Get effective branch ID based on user role
		const effectiveBranchId = this.getEffectiveBranchId(branchId, userAccessLevel);
		try {
			const whereConditions: any = {
				owner: { uid: ref },
			};

			// Apply organization filtering - validate user belongs to requester's org
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

		// Apply branch filtering if provided (and user is not admin/owner/developer)
		if (effectiveBranchId) {
			whereConditions.branch = { uid: effectiveBranchId };
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
		orgId?: number,
		userAccessLevel?: string,
	): Promise<{ message: string; checkIns: Attendance[]; branch: any; totalUsers: number }> {
		// Note: This method is specifically for querying by branch ref, so we still filter by branch
		// but admin/owner/developer can query any branch in their org
		try {
			const whereConditions: any = {
				branch: { ref },
			};

			// Apply organization filtering - validate branch belongs to requester's org
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
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
			const user = await this.userService.findOne(Number(ref));
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

		// Calculate hours from completed shifts (duration + overtime = total actual work time)
		const completedHours = attendanceRecords.reduce((total, record) => {
			let totalWorkHours = 0;
			
			// Parse duration (capped at expected hours)
			if (record?.duration) {
				const [hours, minutes] = record.duration.split(' ');
				const hoursValue = parseFloat(hours.replace('h', ''));
				const minutesValue = parseFloat(minutes.replace('m', '')) / 60;
				totalWorkHours += hoursValue + minutesValue;
			}
			
			// Parse overtime (hours beyond expected)
			if (record?.overtime) {
				const [overtimeHours, overtimeMinutes] = record.overtime.split(' ');
				const overtimeHoursValue = parseFloat(overtimeHours.replace('h', ''));
				const overtimeMinutesValue = parseFloat(overtimeMinutes.replace('m', '')) / 60;
				totalWorkHours += overtimeHoursValue + overtimeMinutesValue;
			}
			
			return total + totalWorkHours;
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

	public async manageBreak(breakDto: CreateBreakDto): Promise<{ message: string }> {
		try {
			this.logger.log(
				`Managing break for user ${breakDto.owner.uid}, isStartingBreak: ${breakDto.isStartingBreak}`,
			);

			if (breakDto.isStartingBreak) {
				this.logger.log(`Delegating to startBreak for user ${breakDto.owner.uid}`);
				return this.startBreak(breakDto);
			} else {
				this.logger.log(`Delegating to endBreak for user ${breakDto.owner.uid}`);
				return this.endBreak(breakDto);
			}
		} catch (error) {
			this.logger.error(`Error managing break for user ${breakDto.owner.uid}: ${error?.message}`, error?.stack);
			return {
				message: error?.message,
			};
		}
	}

	private async startBreak(breakDto: CreateBreakDto): Promise<{ message: string }> {
		try {
			this.logger.log(`Starting break for user ${breakDto.owner.uid}`);

			// Find the active shift
			const activeShift = await this.attendanceRepository.findOne({
				where: {
					status: AttendanceStatus.PRESENT,
					owner: { uid: breakDto.owner.uid },
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
				},
				order: {
					checkIn: 'DESC',
				},
			});

			if (!activeShift) {
				this.logger.warn(`No active shift found for user ${breakDto.owner.uid} to start break`);
				return {
					message: 'No active shift found to start break. Please check in first.'
				};
			}

			this.logger.log(
				`Found active shift ${activeShift.uid} for user ${breakDto.owner.uid}, proceeding with break start`,
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

			// Update shift with break start time and status
			const updatedShift = {
				...activeShift,
				breakStartTime,
				breakLatitude: breakDto.breakLatitude,
				breakLongitude: breakDto.breakLongitude,
				breakCount,
				breakDetails,
				status: AttendanceStatus.ON_BREAK,
			};

			await this.attendanceRepository.save(updatedShift);

			// Clear attendance cache after break start
			await this.clearAttendanceCache(activeShift.uid, breakDto.owner.uid);

			// Send enhanced break start notification
			try {
			// Get user info for personalized message with email and relations
			const user = await this.userRepository.findOne({
				where: { uid: breakDto.owner.uid },
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
				const breakStartTimeString = await this.formatTimeInOrganizationTimezone(breakStartTime, user?.organisation?.uid);

				this.logger.debug(`Sending enhanced break start notification to user: ${breakDto.owner.uid}`);
				// Send push notification
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_STARTED,
					[breakDto.owner.uid],
					{
						breakStartTime: breakStartTimeString,
						breakCount: breakCount,
						breakNumber,
						userName,
						userId: breakDto.owner.uid,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.LOW,
						sendEmail: false, // We'll handle email separately
					},
				);

			// Email notification removed to reduce Gmail quota usage - push notification only
			this.logger.debug(
				`⏭️ [AttendanceService] Skipping break started email for user: ${breakDto.owner.uid} - push notification sent instead`,
			);
				this.logger.debug(`Enhanced break start notification sent successfully to user: ${breakDto.owner.uid}`);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send break start notification to user: ${breakDto.owner.uid}`,
					notificationError.message,
				);
				// Don't fail the break start if notification fails
			}

			this.logger.log(`Break started successfully for user ${breakDto.owner.uid}, shift ${activeShift.uid}`);
			return {
				message: 'Break started successfully',
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}

	private async endBreak(breakDto: CreateBreakDto): Promise<{ message: string }> {
		try {
			this.logger.log(`Ending break for user ${breakDto.owner.uid}`);

			// Find the shift on break
			const shiftOnBreak = await this.attendanceRepository.findOne({
				where: {
					status: AttendanceStatus.ON_BREAK,
					owner: { uid: breakDto.owner.uid },
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
					breakStartTime: Not(IsNull()),
				},
				order: {
					checkIn: 'DESC',
				},
			});

			if (!shiftOnBreak) {
				this.logger.warn(`No shift on break found for user ${breakDto.owner.uid}`);
				
				return {
					message: 'No shift on break found. Please start a break first.',
				};
			}

			this.logger.log(
				`Found shift on break ${shiftOnBreak.uid} for user ${breakDto.owner.uid}, proceeding with break end`,
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

			// Update shift with break end time and status
			const updatedShift = {
				...shiftOnBreak,
				breakEndTime,
				totalBreakTime,
				breakNotes: breakDto.breakNotes,
				breakDetails,
				status: AttendanceStatus.PRESENT,
			};

			await this.attendanceRepository.save(updatedShift);

			// Clear attendance cache after break end
			await this.clearAttendanceCache(shiftOnBreak.uid, breakDto.owner.uid);

			// Send enhanced break end notification
			try {
			// Get user info for personalized message with email and relations
			const user = await this.userRepository.findOne({
				where: { uid: breakDto.owner.uid },
				select: ['uid', 'name', 'surname', 'email', 'username'],
				relations: ['organisation', 'branch', 'branch.organisation'],
			});

			// Construct full name with proper fallbacks
			const fullName = `${user?.name || ''} ${user?.surname || ''}`.trim();
			const userName = fullName || user?.username || 'Team Member';

			// Format break times in organization timezone
				const breakEndTimeString = await this.formatTimeInOrganizationTimezone(breakEndTime, user?.organisation?.uid);
				const breakStartTimeString = await this.formatTimeInOrganizationTimezone(breakStartTime, user?.organisation?.uid);

				this.logger.debug(`Sending enhanced break end notification to user: ${breakDto.owner.uid}`);
				// Send push notification
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_ENDED,
					[breakDto.owner.uid],
					{
						breakDuration: currentBreakDuration,
						breakStartTime: breakStartTimeString,
						breakEndTime: breakEndTimeString,
						totalBreakTime,
						userName,
						userId: breakDto.owner.uid,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.LOW,
						sendEmail: false, // We'll handle email separately
					},
				);

			// Email notification removed to reduce Gmail quota usage - push notification only
			this.logger.debug(
				`⏭️ [AttendanceService] Skipping break ended email for user: ${breakDto.owner.uid} - push notification sent instead`,
			);
				this.logger.debug(`Enhanced break end notification sent successfully to user: ${breakDto.owner.uid}`);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send break end notification to user: ${breakDto.owner.uid}`,
					notificationError.message,
				);
				// Don't fail the break end if notification fails
			}

			this.logger.log(
				`Break ended successfully for user ${breakDto.owner.uid}, shift ${shiftOnBreak.uid}, duration: ${currentBreakDuration}`,
			);
			return {
				message: 'Break ended successfully',
			};
		} catch (error) {
			return {
				message: error?.message,
			};
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
				completedShifts[0]?.owner?.organisation?.uid || activeShift?.owner?.organisation?.uid;

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
	 * @param userId - User ID to get metrics for
	 * @returns Comprehensive attendance metrics including first/last attendance and time breakdowns
	 */
	public async getUserAttendanceMetrics(userId: number): Promise<{
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
		};
	}> {
		try {
			// Validate input
			if (!userId || userId <= 0) {
				throw new BadRequestException('Invalid user ID provided');
			}

			// Check if user exists
			const userExists = await this.userRepository.findOne({
				where: { uid: userId },
			});

			if (!userExists) {
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			// Get first ever attendance with organization info
			const firstAttendanceRaw = await this.attendanceRepository.findOne({
				where: { owner: { uid: userId } },
				order: { checkIn: 'ASC' },
				relations: ['organisation'],
			});

			// Get last attendance with organization info
			const lastAttendanceRaw = await this.attendanceRepository.findOne({
				where: { owner: { uid: userId } },
				order: { checkIn: 'DESC' },
				relations: ['organisation'],
			});

		// Keep raw attendance records - timezone conversion will be applied during formatting
		const firstAttendance = firstAttendanceRaw;
		const lastAttendance = lastAttendanceRaw;
		
		this.logger.debug(`First attendance (raw): ${firstAttendance ? firstAttendance.checkIn.toISOString() : 'null'}`);
		this.logger.debug(`Last attendance (raw): ${lastAttendance ? lastAttendance.checkIn.toISOString() : 'null'}`);

			// Get organization ID for timezone formatting
			const organizationId = firstAttendance?.organisation?.uid || lastAttendance?.organisation?.uid;

			// Calculate date ranges
			const now = new Date();
			const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const startOfWeek = new Date(now);
			startOfWeek.setDate(now.getDate() - now.getDay()); // Start of current week (Sunday)
			startOfWeek.setHours(0, 0, 0, 0);
			const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

			// Get all attendance records for the user
			const allAttendance = await this.attendanceRepository.find({
				where: { owner: { uid: userId } },
				order: { checkIn: 'ASC' },
			});

			// Calculate total hours for different periods
			const todayAttendance = allAttendance.filter((record) => new Date(record.checkIn) >= startOfToday);
			const weekAttendance = allAttendance.filter((record) => new Date(record.checkIn) >= startOfWeek);
			const monthAttendance = allAttendance.filter((record) => new Date(record.checkIn) >= startOfMonth);

			// Enhanced helper function using our new utilities
			const calculateTotalHours = (records: Attendance[]): number => {
				return records.reduce((total, record) => {
					if (record.checkIn && record.checkOut) {
						const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
							record.breakDetails,
							record.totalBreakTime,
						);
						const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
						const workMinutes = Math.max(0, totalMinutes - breakMinutes);
						return (
							total + TimeCalculatorUtil.minutesToHours(workMinutes, TimeCalculatorUtil.PRECISION.HOURS)
						);
					}
					return total;
				}, 0);
			};

			// Calculate hours for each period
			const totalHoursAllTime = calculateTotalHours(allAttendance);
			const totalHoursThisMonth = calculateTotalHours(monthAttendance);
			const totalHoursThisWeek = calculateTotalHours(weekAttendance);
			const totalHoursToday = calculateTotalHours(todayAttendance);

			// Calculate average hours per day (based on days since first attendance)
			const daysSinceFirst = firstAttendance
				? Math.max(1, Math.ceil(differenceInMinutes(now, new Date(firstAttendance.checkIn)) / (24 * 60)))
				: 1;
			const averageHoursPerDay = totalHoursAllTime / daysSinceFirst;

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

		// ===== ENHANCED TIMING PATTERNS =====
		// Get organization timezone for proper conversion
		const timezone = await this.getOrganizationTimezone(organizationId);
		
		// Convert times to organization timezone before calculating averages
		const checkInTimes = allAttendance.map((record) => 
			TimezoneUtil.toOrganizationTime(new Date(record.checkIn), timezone)
		);
		const checkOutTimes = allAttendance
			.filter((record) => record.checkOut)
			.map((record) => 
				TimezoneUtil.toOrganizationTime(new Date(record.checkOut!), timezone)
			);

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
			// Calculate overtime analytics for all periods
			const overtimeAnalyticsAllTime = await this.calculateOvertimeAnalytics(allAttendance, organizationId);
			const overtimeAnalyticsToday = await this.calculateOvertimeAnalytics(todayAttendance, organizationId);
			const overtimeAnalyticsThisWeek = await this.calculateOvertimeAnalytics(weekAttendance, organizationId);
			const overtimeAnalyticsThisMonth = await this.calculateOvertimeAnalytics(monthAttendance, organizationId);

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
					allTime: Math.round(totalHoursAllTime * 10) / 10,
					thisMonth: Math.round(totalHoursThisMonth * 10) / 10,
					thisWeek: Math.round(totalHoursThisWeek * 10) / 10,
					today: Math.round(totalHoursToday * 10) / 10,
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
				},
			};
		}
	}

	/**
	 * Calculate comprehensive overtime analytics for attendance records
	 * @param records - Attendance records to analyze
	 * @param organizationId - Organization ID for overtime calculation
	 * @returns Overtime analytics object
	 */
	private async calculateOvertimeAnalytics(
		records: Attendance[],
		organizationId?: number,
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

					// Calculate overtime using organization hours (same logic as checkOut)
					let overtimeMinutes = 0;
					if (organizationId) {
						try {
							const overtimeInfo = await this.organizationHoursService.calculateOvertime(
								organizationId,
								new Date(shift.checkIn),
								workMinutes,
							);
							overtimeMinutes = overtimeInfo.overtimeMinutes || 0;
						} catch (error) {
							this.logger.warn(
								`Error calculating overtime for shift ${shift.uid}, using fallback: ${error.message}`,
							);
							// Fallback to default 8 hours
							const standardMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
							overtimeMinutes = Math.max(0, workMinutes - standardMinutes);
						}
					} else {
						// Fallback to default 8 hours if no organization ID
						const standardMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
						overtimeMinutes = Math.max(0, workMinutes - standardMinutes);
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
		userId: number,
		startDate: string,
		endDate: string,
		includeInsights: boolean = true,
	): Promise<UserMetricsResponseDto> {
		try {
			// Validate input
			if (!userId || userId <= 0) {
				throw new BadRequestException('Invalid user ID provided');
			}

			// Parse dates
			const parsedStartDate = startOfDay(new Date(startDate));
			const parsedEndDate = endOfDay(new Date(endDate));

			// Validate date range
			if (parsedStartDate > parsedEndDate) {
				throw new BadRequestException('Start date cannot be after end date');
			}

			// Check if user exists
			const userExists = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation', 'branch'],
			});

			if (!userExists) {
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			// Get attendance records for the specified date range
			const attendanceRecordsRaw = await this.attendanceRepository.find({
				where: {
					owner: { uid: userId },
					checkIn: Between(parsedStartDate, parsedEndDate),
				},
				relations: ['owner', 'owner.branch', 'owner.organisation'],
				order: { checkIn: 'ASC' },
			});

			// Get the most recent attendance record (even if outside date range)
			const lastAttendanceRecordRaw = await this.attendanceRepository.findOne({
				where: { owner: { uid: userId } },
				order: { checkIn: 'DESC' },
			});

			// Apply timezone conversion to attendance records
			const organizationId = userExists?.organisation?.uid;
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
					owner: { uid: userId },
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
		
		// Convert times to organization timezone before calculating averages
		const checkInTimes = completedShifts.map((record) => 
			TimezoneUtil.toOrganizationTime(new Date(record.checkIn), timezone)
		);
		const checkOutTimes = completedShifts.map((record) => 
			TimezoneUtil.toOrganizationTime(new Date(record.checkOut), timezone)
		);

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

			// Calculate attendance streak
			const attendanceStreak = this.calculateAttendanceStreak(userId);

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
	 */
	private async calculateAttendanceStreak(userId: number): Promise<number> {
		let streak = 0;
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		// Check last 60 days for streak calculation
		for (let i = 0; i < 60; i++) {
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
			} else if (i > 0) {
				// Don't break on today if no attendance yet
				break;
			}
		}

		return streak;
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
		orgId?: number,
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
				userFilters.organisation = { uid: orgId };
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
		orgId?: number,
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

				// Get user metrics using existing method
				const userMetricsResult = await this.getUserAttendanceMetrics(user.uid);

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

	private async calculateOrganizationMetrics(attendanceRecords: Attendance[], users: User[], organizationId?: number): Promise<any> {
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

	private async calculateAverageTimes(attendanceRecords: Attendance[], organizationId?: number): Promise<any> {
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
	 *
	 * @param consolidateDto - Consolidation request containing mode and records array
	 * @param orgId - Organization ID for filtering
	 * @param branchId - Branch ID for filtering
	 * @returns Promise with consolidation results including success/failure counts
	 */
	public async consolidate(
		consolidateDto: ConsolidateAttendanceDto,
		orgId?: number,
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
				let result: any;
				let attendanceId: number | undefined;
				let message: string;

				if (consolidateDto.mode === ConsolidateMode.IN) {
					// Process as check-in
					const checkInRecord = record as CreateCheckInDto;
					result = await this.checkIn(checkInRecord, orgId, branchId);

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
		orgId?: number,
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
				organisation: { uid: orgId },
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
}
