import { Injectable, NotFoundException, Logger, BadRequestException, Inject } from '@nestjs/common';
import { IsNull, MoreThanOrEqual, Not, Repository, LessThanOrEqual, Between, In, LessThan } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Attendance } from './entities/attendance.entity';
import { AttendanceStatus } from '../lib/enums/attendance.enums';
import { CreateCheckInDto } from './dto/create.attendance.check.in.dto';
import { CreateCheckOutDto } from './dto/create.attendance.check.out.dto';
import { CreateBreakDto } from './dto/create.attendance.break.dto';
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
import { Cron } from '@nestjs/schedule';

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
	 * Check if a user's check-in is late and calculate how many minutes late
	 */
	private async checkAndCalculateLateMinutes(orgId: number, checkInTime: Date): Promise<number> {
		try {
			// Get organization working hours for the check-in date
			const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, checkInTime);
			
			if (!workingDayInfo.isWorkingDay || !workingDayInfo.startTime) {
				// Not a working day or no start time defined
				return 0;
			}

			// Parse the expected start time
			const [expectedHour, expectedMinute] = workingDayInfo.startTime.split(':').map(Number);
			const expectedStartTime = new Date(checkInTime);
			expectedStartTime.setHours(expectedHour, expectedMinute, 0, 0);

			// Calculate late minutes with grace period
			const gracePeriodMinutes = 15; // Allow 15 minutes grace period
			const graceEndTime = new Date(expectedStartTime);
			graceEndTime.setMinutes(graceEndTime.getMinutes() + gracePeriodMinutes);

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

	// ======================================================
	// ATTENDANCE METRICS FUNCTIONALITY
	// ======================================================

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

			// Check if user is already checked in (prevent duplicate check-ins)
			this.logger.debug(`Checking for existing active shift for user: ${checkInDto.owner.uid}`);
			const existingShift = await this.attendanceRepository.findOne({
				where: {
					owner: checkInDto.owner,
					status: AttendanceStatus.PRESENT,
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
					organisation: orgId ? { uid: orgId } : undefined,
				},
			});

			if (existingShift) {
				this.logger.warn(`User ${checkInDto.owner.uid} already has an active shift`);
				throw new BadRequestException('User is already checked in. Please check out first.');
			}

			// Enhanced data mapping with proper validation
			const attendanceData = {
				...checkInDto,
				status: checkInDto.status || AttendanceStatus.PRESENT,
				organisation: orgId ? { uid: orgId } : undefined,
				branch: branchId ? { uid: branchId } : undefined,
			};

			this.logger.debug('Saving check-in record to database with enhanced validation');
			const checkIn = await this.attendanceRepository.save(attendanceData);

			if (!checkIn) {
				this.logger.error('Failed to create check-in record - database returned null');
				throw new NotFoundException(process.env.CREATE_ERROR_MESSAGE || 'Failed to create attendance record');
			}

			this.logger.debug(`Check-in record created successfully with ID: ${checkIn.uid}`);

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

			// Send shift start notification with enhanced error handling
			try {
				const checkInTime = new Date(checkIn.checkIn).toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				});

				this.logger.debug(`Sending shift start notification to user: ${checkInDto.owner.uid}`);
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_SHIFT_STARTED,
					[checkInDto.owner.uid],
					{
						message: `Shift started successfully at ${checkInTime}. Have a productive day!`,
						checkInTime,
						userId: checkInDto.owner.uid,
						organisationId: orgId,
						branchId: branchId,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.NORMAL,
					},
				);
				this.logger.debug(`Shift start notification sent successfully to user: ${checkInDto.owner.uid}`);
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
						this.logger.debug(`User ${checkInDto.owner.uid} is ${lateMinutes} minutes late - sending notification`);
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
				throw new NotFoundException('No active shift found. Please check in first.');
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

			// Format duration (maintains original format)
			const duration = TimeCalculatorUtil.formatDuration(workSession.netWorkMinutes);
			this.logger.debug(
				`Work session calculated - net work minutes: ${workSession.netWorkMinutes}, formatted duration: ${duration}`,
			);

			// Enhanced data mapping for shift update
			const updatedShift = {
				...activeShift,
				...checkOutDto,
				checkOut: checkOutTime,
				duration,
				status: AttendanceStatus.COMPLETED,
			};

			this.logger.debug('Saving updated shift with check-out data');
			await this.attendanceRepository.save(updatedShift);
			this.logger.debug(`Shift updated successfully for user: ${checkOutDto.owner?.uid}`);

			// Enhanced response data mapping
			const responseData = {
				attendanceId: activeShift.uid,
				userId: checkOutDto.owner.uid,
				checkInTime: activeShift.checkIn,
				checkOutTime: checkOutTime,
				duration,
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

			// Send shift end notification with enhanced error handling
			try {
				const checkOutTimeString = checkOutTime.toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				});

				const checkInTimeString = new Date(activeShift.checkIn).toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				});

				this.logger.debug(`Sending shift end notification to user: ${checkOutDto.owner.uid}`);
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_SHIFT_ENDED,
					[checkOutDto.owner.uid],
					{
						message: `Shift completed successfully! Worked from ${checkInTimeString} to ${checkOutTimeString} (${duration}). Great work today!`,
						checkOutTime: checkOutTimeString,
						checkInTime: checkInTimeString,
						duration,
						totalWorkMinutes: workSession.netWorkMinutes,
						totalBreakMinutes: breakMinutes,
						userId: checkOutDto.owner.uid,
						organisationId: orgId,
						branchId: branchId,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.NORMAL,
					},
				);
				this.logger.debug(`Shift end notification sent successfully to user: ${checkOutDto.owner.uid}`);
			} catch (notificationError) {
				this.logger.warn(
					`Failed to send shift end notification to user: ${checkOutDto.owner.uid}`,
					notificationError.message,
				);
				// Don't fail the check-out if notification fails
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
						const overtimeHours = Math.floor(overtimeInfo.overtimeMinutes / 60);
						const overtimeMinutes = overtimeInfo.overtimeMinutes % 60;
						const overtimeDuration = `${overtimeHours}h ${overtimeMinutes}m`;

						this.logger.debug(`Sending overtime notification to user: ${checkOutDto.owner.uid}`);
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.ATTENDANCE_OVERTIME_REMINDER,
							[checkOutDto.owner.uid],
							{
								message: `You worked ${overtimeDuration} of overtime today. Great dedication! Please ensure you get adequate rest.`,
								overtimeDuration,
								overtimeHours: overtimeInfo.overtimeMinutes / 60,
								regularHours: (workSession.netWorkMinutes - overtimeInfo.overtimeMinutes) / 60,
								totalWorkMinutes: workSession.netWorkMinutes,
								userId: checkOutDto.owner.uid,
								timestamp: new Date().toISOString(),
							},
							{
								priority: NotificationPriority.HIGH,
							},
						);
						this.logger.debug(`Overtime notification sent successfully to user: ${checkOutDto.owner.uid}`);
					}
				}
			} catch (overtimeNotificationError) {
				this.logger.warn(
					`Failed to send overtime notification to user: ${checkOutDto.owner.uid}`,
					overtimeNotificationError.message,
				);
				// Don't fail the check-out if overtime notification fails
			}

			// Emit the daily-report event with the user ID and activity trigger flag
			this.logger.debug(`Emitting events for user: ${checkOutDto?.owner?.uid}`);
			this.eventEmitter.emit('daily-report', {
				userId: checkOutDto?.owner?.uid,
				triggeredByActivity: true, // This report is triggered by actual user activity (check-out)
			});

			this.eventEmitter.emit('user.target.update.required', { userId: checkOutDto?.owner?.uid });
			this.eventEmitter.emit('user.metrics.update.required', checkOutDto?.owner?.uid);
			this.logger.debug(`Events emitted successfully for user: ${checkOutDto?.owner?.uid}`);

			this.logger.log(`Check-out successful for user: ${checkOutDto.owner?.uid}, duration: ${duration}`);
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

	public async allCheckIns(orgId?: number, branchId?: number): Promise<{ message: string; checkIns: Attendance[] }> {
		this.logger.log(`Fetching all check-ins, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			const cacheKey = this.getCacheKey(`all_${orgId || 'no-org'}_${branchId || 'no-branch'}`);
			const cachedResult = await this.cacheManager.get(cacheKey);

			if (cachedResult) {
				this.logger.debug(
					`Retrieved ${Array.isArray(cachedResult) ? cachedResult.length : 0} check-ins from cache`,
				);
				return {
					message: process.env.SUCCESS_MESSAGE,
					checkIns: cachedResult as Attendance[],
				};
			}

			const whereConditions: any = {};

			// Apply organization filtering - CRITICAL: Only show data for the user's organization
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
				this.logger.debug(`Added organization filter: ${orgId}`);
			} else {
				this.logger.warn('No organization ID provided - this may return data from all organizations');
			}

			// Apply branch filtering if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
				this.logger.debug(`Added branch filter: ${branchId}`);
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

			// Cache the result
			await this.cacheManager.set(cacheKey, checkIns, this.CACHE_TTL);
			this.logger.debug(`Cached check-ins result with key: ${cacheKey}`);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns,
			};

			return response;
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
	): Promise<{ message: string; checkIns: Attendance[] }> {
		this.logger.log(`Fetching check-ins for date: ${date}, orgId: ${orgId}, branchId: ${branchId}`);
		try {
			const startOfDay = new Date(date);
			startOfDay.setHours(0, 0, 0, 0);
			const endOfDay = new Date(date);
			endOfDay.setHours(23, 59, 59, 999);

			const whereConditions: any = {
				checkIn: Between(startOfDay, endOfDay),
			};

			// Apply organization filtering
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Apply branch filtering if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			// Get check-ins that started on this date
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
				checkIn: LessThan(startOfDay), // Started before today
				checkOut: IsNull(), // Not checked out yet
				status: In([AttendanceStatus.PRESENT, AttendanceStatus.ON_BREAK]), // Still active
			};

			// Apply same organization and branch filtering for ongoing shifts
			if (orgId) {
				ongoingShiftsConditions.organisation = { uid: orgId };
			}

			if (branchId) {
				ongoingShiftsConditions.branch = { uid: branchId };
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
				const isMultiDay = checkInDate < startOfDay;

				return {
					...checkIn,
					isMultiDayShift: isMultiDay,
					shiftDaySpan: isMultiDay ? this.calculateShiftDaySpan(checkInDate, endOfDay) : 1,
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

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns: allCheckIns,
			};

			return response;
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
	 * Send shift reminders to users with proper time data
	 */
	private async sendShiftReminder(
		userId: number,
		reminderType: 'start' | 'end' | 'missed' | 'late',
		orgId?: number,
		branchId?: number,
		shiftStartTime?: string,
		lateMinutes?: number,
	): Promise<void> {
		const operationId = `shift_reminder_${Date.now()}`;
		this.logger.log(`[${operationId}] Sending ${reminderType} shift reminder to user ${userId}`);

		try {
			let notificationType: NotificationEvent;
			let message: string;

			const currentTime = new Date().toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: true,
			});

			// Get organization hours to determine expected shift time if not provided
			let expectedShiftTime = shiftStartTime;
			if (!expectedShiftTime && orgId) {
				try {
					const organizationHours = await this.organizationHoursService.getOrganizationHours(orgId);
					const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(orgId, new Date());
					expectedShiftTime = workingDayInfo.startTime || organizationHours?.openTime || '09:00';
				} catch (error) {
					this.logger.warn(`[${operationId}] Could not get organization hours for org ${orgId}:`, error.message);
					expectedShiftTime = '09:00'; // Default fallback
				}
			}

			// Prepare notification data based on reminder type
			const notificationData: any = {
				message,
				currentTime,
				userId,
				orgId,
				branchId,
				timestamp: new Date().toISOString(),
				reminderType,
			};

			switch (reminderType) {
				case 'start':
					notificationType = NotificationEvent.ATTENDANCE_SHIFT_START_REMINDER;
					message = `Good morning! Don't forget to check in for your shift. Current time: ${currentTime}`;
					if (expectedShiftTime) {
						notificationData.shiftTime = expectedShiftTime;
					}
					break;
				case 'end':
					notificationType = NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER;
					message = `Your shift is ending soon. Don't forget to check out! Current time: ${currentTime}`;
					break;
				case 'missed':
					notificationType = NotificationEvent.ATTENDANCE_MISSED_SHIFT_ALERT;
					message = `You missed your scheduled shift today. Please contact your supervisor if there was an issue. Current time: ${currentTime}`;
					// Add the actual shift time that was missed
					if (expectedShiftTime) {
						notificationData.shiftTime = expectedShiftTime;
						message = `You missed your scheduled shift that was supposed to start at ${expectedShiftTime}. Please contact your supervisor.`;
					}
					break;
				case 'late':
					notificationType = NotificationEvent.ATTENDANCE_LATE_SHIFT_ALERT;
					message = `You are running late for your shift. Please check in as soon as possible. Current time: ${currentTime}`;
					// Add late minutes if provided
					if (lateMinutes && lateMinutes > 0) {
						notificationData.lateMinutes = lateMinutes;
						message = `You checked in ${lateMinutes} minutes late for your shift. Please try to be punctual.`;
					}
					break;
			}

			// Update message in notification data
			notificationData.message = message;

			await this.unifiedNotificationService.sendTemplatedNotification(
				notificationType,
				[Number(userId)],
				notificationData,
				{
					priority: reminderType === 'missed' ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
				},
			);

			this.logger.log(`[${operationId}] ${reminderType} reminder sent successfully to user ${userId}`);

			// Also notify organization admins for missed shifts
			if ((reminderType === 'missed' || reminderType === 'late') && orgId) {
				try {
					const orgAdmins = await this.getOrganizationAdmins(orgId);
					if (orgAdmins.length > 0) {
						this.logger.debug(
							`[${operationId}] Notifying ${orgAdmins.length} admins about ${reminderType} shift for user ${userId}`,
						);
						
						// Get user info for admin notification
						const user = await this.userRepository.findOne({
							where: { uid: userId },
							select: ['uid', 'name', 'surname', 'email'],
						});

						const adminNotificationData: any = {
							userId,
							userName: user ? `${user.name} ${user.surname}`.trim() : `User ${userId}`,
							userEmail: user?.email || '',
							orgId,
							branchId,
							alertType: reminderType,
							timestamp: new Date().toISOString(),
							adminContext: true,
							currentTime,
						};

						// Add shift-specific data for admin notifications
						if (expectedShiftTime) {
							adminNotificationData.shiftTime = expectedShiftTime;
						}
						if (lateMinutes && lateMinutes > 0) {
							adminNotificationData.lateMinutes = lateMinutes;
						}

						await this.unifiedNotificationService.sendTemplatedNotification(
							notificationType,
							orgAdmins.map((admin) => admin.uid.toString()),
							adminNotificationData,
							{ priority: NotificationPriority.HIGH },
						);
					}
				} catch (error) {
					this.logger.warn(
						`[${operationId}] Failed to notify admins about ${reminderType} shift:`,
						error.message,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`[${operationId}] Failed to send ${reminderType} reminder to user ${userId}:`,
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
	 * Check and send shift reminders based on organization hours
	 * Notifications are only sent at specific time windows:
	 * - 30 minutes after organization open time (for missed shifts)
	 * - 30 minutes after organization close time (for end-of-day missed check-outs)
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

					// Only check during reasonable business hours
					const currentHour = orgCurrentTime.getHours();
					if (currentHour < 6 || currentHour > 22) {
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

					// Calculate notification windows
					const [startHour, startMinute] = startTime.split(':').map(Number);
					const [endHour, endMinute] = endTime.split(':').map(Number);

					// 30 minutes after open time
					const morningNotificationTime = new Date(orgCurrentTime);
					morningNotificationTime.setHours(startHour, startMinute + 30, 0, 0);

					// 30 minutes after close time
					const eveningNotificationTime = new Date(orgCurrentTime);
					eveningNotificationTime.setHours(endHour, endMinute + 30, 0, 0);

					// Check if we're within notification windows (±2.5 minutes for 5-minute cron)
					const morningTimeDiff = Math.abs(orgCurrentTime.getTime() - morningNotificationTime.getTime()) / (1000 * 60);
					const eveningTimeDiff = Math.abs(orgCurrentTime.getTime() - eveningNotificationTime.getTime()) / (1000 * 60);

					const isInMorningWindow = morningTimeDiff <= 2.5;
					const isInEveningWindow = eveningTimeDiff <= 2.5;

					if (!isInMorningWindow && !isInEveningWindow) {
						this.logger.debug(
							`[${operationId}] Not in notification window for org ${org.uid} - Morning: ${morningTimeDiff.toFixed(1)}min, Evening: ${eveningTimeDiff.toFixed(1)}min away`
						);
						continue;
					}

					const todayKey = format(orgCurrentTime, 'yyyy-MM-dd');
					
					this.logger.log(
						`[${operationId}] Processing notifications for org ${org.uid} (${org.name}) - Morning window: ${isInMorningWindow}, Evening window: ${isInEveningWindow}`
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

					if (isInMorningWindow) {
						await this.processMorningNotifications(operationId, org, orgUsers, orgCurrentTime, todayKey);
					}

					if (isInEveningWindow) {
						await this.processEveningNotifications(operationId, org, orgUsers, orgCurrentTime, todayKey);
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
	 * Process morning notifications (30 minutes after org open time)
	 * Check for missed shifts and late arrivals
	 */
	private async processMorningNotifications(
		operationId: string,
		org: any,
		orgUsers: any[],
		orgCurrentTime: Date,
		todayKey: string
	): Promise<void> {
		this.logger.log(`[${operationId}] Processing morning notifications for org ${org.uid}`);

									const todayStart = startOfDay(orgCurrentTime);
									const todayEnd = endOfDay(orgCurrentTime);

		for (const user of orgUsers) {
			try {
				const cacheKey = `missed_shift_${org.uid}_${user.uid}_${todayKey}`;
				
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
					this.logger.debug(`[${operationId}] User ${user.uid} missed shift - sending notification`);
					
					// Get expected shift start time from organization hours
					let expectedShiftTime: string | undefined;
					try {
						const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(org.uid, orgCurrentTime);
						expectedShiftTime = workingDayInfo.startTime;
					} catch (error) {
						this.logger.warn(`[${operationId}] Could not get working day info for org ${org.uid}:`, error.message);
					}
					
					await this.sendShiftReminder(user.uid, 'missed', org.uid, undefined, expectedShiftTime);
					this.notificationCache.add(cacheKey);
					
					// Clean up cache after 24 hours
					setTimeout(() => {
						this.notificationCache.delete(cacheKey);
					}, 24 * 60 * 60 * 1000);
				}

			} catch (error) {
				this.logger.error(
					`[${operationId}] Error processing morning notification for user ${user.uid}:`,
					error.message,
				);
			}
		}
	}

	/**
	 * Process evening notifications (30 minutes after org close time)
	 * Check for users who forgot to check out
	 */
	private async processEveningNotifications(
		operationId: string,
		org: any,
		orgUsers: any[],
		orgCurrentTime: Date,
		todayKey: string
	): Promise<void> {
		this.logger.log(`[${operationId}] Processing evening notifications for org ${org.uid}`);

		for (const user of orgUsers) {
			try {
				const cacheKey = `checkout_reminder_${org.uid}_${user.uid}_${todayKey}`;
				
				// Skip if already notified today
				if (this.notificationCache.has(cacheKey)) {
					continue;
				}

				// Check if user has active shift without checkout
				const activeShift = await this.attendanceRepository.findOne({
					where: {
						owner: { uid: user.uid },
						status: AttendanceStatus.PRESENT,
						checkOut: IsNull(),
						checkIn: Between(startOfDay(orgCurrentTime), endOfDay(orgCurrentTime)),
					},
				});

				if (activeShift) {
					this.logger.debug(`[${operationId}] User ${user.uid} forgot to check out - sending reminder`);
					
					// Get expected shift end time from organization hours
					let expectedShiftEndTime: string | undefined;
					try {
						const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(org.uid, orgCurrentTime);
						expectedShiftEndTime = workingDayInfo.endTime;
					} catch (error) {
						this.logger.warn(`[${operationId}] Could not get working day info for org ${org.uid}:`, error.message);
					}
					
					await this.sendShiftReminder(user.uid, 'end', org.uid, undefined, expectedShiftEndTime);
					this.notificationCache.add(cacheKey);
					
					// Clean up cache after 24 hours
					setTimeout(() => {
						this.notificationCache.delete(cacheKey);
					}, 24 * 60 * 60 * 1000);
				}

						} catch (error) {
							this.logger.error(
					`[${operationId}] Error processing evening notification for user ${user.uid}:`,
								error.message,
							);
						}
		}
	}

	/**
	 * Get daily attendance overview - present and absent users
	 */
	public async getDailyAttendanceOverview(
		orgId?: number,
		branchId?: number,
		date?: Date,
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
		const operationId = `daily_overview_${Date.now()}`;
		this.logger.log(
			`[${operationId}] Getting daily attendance overview for orgId: ${orgId}, branchId: ${branchId}, date: ${
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
			if (branchId) {
				userConditions.branch = { uid: branchId };
			}

			// Get all users in the organization/branch with enhanced data
			const allUsers = await this.userRepository.find({
				where: {
					...userConditions,
					isDeleted: false,
					status: 'active',
				},
				relations: ['branch', 'organisation', 'userProfile'],
				select: ['uid', 'name', 'surname', 'email', 'accessLevel', 'phone', 'createdAt' , 'photoURL']
			});

			this.logger.debug(`[${operationId}] Found ${allUsers.length} total users`);

			// Get attendance records for today
			const attendanceConditions: any = {
				checkIn: Between(startOfTargetDay, endOfTargetDay),
			};
			if (orgId) {
				attendanceConditions.organisation = { uid: orgId };
			}
			if (branchId) {
				attendanceConditions.branch = { uid: branchId };
			}

			const todayAttendance = await this.attendanceRepository.find({
				where: attendanceConditions,
				relations: ['owner', 'owner.branch', 'owner.userProfile', 'organisation', 'branch'],
				order: { checkIn: 'ASC' },
			});

			this.logger.debug(`[${operationId}] Found ${todayAttendance.length} attendance records for today`);

			// Build present users list with enhanced data (no duplicates)
			const presentUsersMap = new Map<number, any>();
			const presentUserIds = new Set<number>();

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
						checkInTime: attendance.checkIn,
						checkOutTime: attendance.checkOut || null,
						status: attendance.status || 'present',
						workingHours: attendance.checkOut 
							? ((new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) / (1000 * 60 * 60)).toFixed(2)
							: null,
						isOnBreak: attendance.status === AttendanceStatus.ON_BREAK,
						shiftDuration: attendance.checkOut 
							? `${Math.floor((new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) / (1000 * 60 * 60))}h ${Math.floor(((new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) % (1000 * 60 * 60)) / (1000 * 60))}m`
							: 'In Progress'
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
						employeeSince: user.createdAt ? new Date(user.createdAt).toISOString().split('T')[0] : 'Unknown',
						isActive: true,
						role: user.accessLevel || 'USER'
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
	): Promise<{
		message: string;
		checkIns: Attendance[];
		multiDayShifts: Attendance[];
		ongoingShifts: Attendance[];
	}> {
		try {
			const startOfPeriod = new Date(startDate);
			startOfPeriod.setHours(0, 0, 0, 0);
			const endOfPeriod = new Date(endDate);
			endOfPeriod.setHours(23, 59, 59, 999);

			const whereConditions: any = {};

			// Apply organization and branch filtering
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			if (branchId) {
				whereConditions.branch = { uid: branchId };
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
				],
				order: {
					checkIn: 'DESC',
				},
			});

			// Get shifts that started before the range but are still ongoing
			const ongoingShifts = await this.attendanceRepository.find({
				where: {
					...whereConditions,
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

			return response;
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

			// Apply branch filtering if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
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

			const nextAction = status === AttendanceStatus.PRESENT ? 'End Shift' : 'Start Shift';
			const checkedIn = status === AttendanceStatus.PRESENT ? true : false;

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				startTime: `${CheckInTime}`,
				endTime: `${checkOut}`,
				createdAt: `${createdAt}`,
				updatedAt: `${updatedAt}`,
				verifiedAt: `${verifiedAt}`,
				nextAction,
				isLatestCheckIn,
				checkedIn,
				user: owner,
				attendance: checkIn,
				...restOfCheckIn,
			};

			return response;
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
	): Promise<{ message: string; checkIns: Attendance[]; user: any }> {
		try {
			const whereConditions: any = {
				owner: { uid: ref },
			};

			// Apply organization filtering - validate user belongs to requester's org
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Apply branch filtering if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
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

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns,
				user: userInfo,
			};

			return response;
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
	): Promise<{ message: string; checkIns: Attendance[]; branch: any; totalUsers: number }> {
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

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				checkIns,
				branch: branchInfo,
				totalUsers,
			};

			return response;
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

			const response = {
				totalHours: Math.round((totalMinutesWorked / 60) * 10) / 10, // Round to 1 decimal place
				activeShifts,
				attendanceRecords,
			};

			return response;
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

			// Calculate hours from completed shifts
			const completedHours = attendanceRecords.reduce((total, record) => {
				if (record?.duration) {
					const [hours, minutes] = record.duration.split(' ');
					const hoursValue = parseFloat(hours.replace('h', ''));
					const minutesValue = parseFloat(minutes.replace('m', '')) / 60;
					return total + hoursValue + minutesValue;
				}
				return total;
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
				throw new NotFoundException('No active shift found to start break');
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

			// Send break start notification
			try {
				const breakStartTimeString = breakStartTime.toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				});

				this.logger.debug(`Sending break start notification to user: ${breakDto.owner.uid}`);
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_STARTED,
					[breakDto.owner.uid],
					{
						message: `Break started at ${breakStartTimeString}. Take your time to recharge!`,
						breakStartTime: breakStartTimeString,
						breakCount: breakCount,
						userId: breakDto.owner.uid,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.LOW,
					},
				);
				this.logger.debug(`Break start notification sent successfully to user: ${breakDto.owner.uid}`);
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
				throw new NotFoundException('No shift on break found');
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

			// Send break end notification
			try {
				const breakEndTimeString = breakEndTime.toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				});

				const breakStartTimeString = breakStartTime.toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: true,
				});

				this.logger.debug(`Sending break end notification to user: ${breakDto.owner.uid}`);
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_ENDED,
					[breakDto.owner.uid],
					{
						message: `Break completed! You were on break from ${breakStartTimeString} to ${breakEndTimeString} (${currentBreakDuration}). Welcome back!`,
						breakDuration: currentBreakDuration,
						breakStartTime: breakStartTimeString,
						breakEndTime: breakEndTimeString,
						totalBreakTime,
						userId: breakDto.owner.uid,
						timestamp: new Date().toISOString(),
					},
					{
						priority: NotificationPriority.LOW,
					},
				);
				this.logger.debug(`Break end notification sent successfully to user: ${breakDto.owner.uid}`);
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

			// Get first ever attendance
			const firstAttendance = await this.attendanceRepository.findOne({
				where: { owner: { uid: userId } },
				order: { checkIn: 'ASC' },
			});

			// Get last attendance
			const lastAttendance = await this.attendanceRepository.findOne({
				where: { owner: { uid: userId } },
				order: { checkIn: 'DESC' },
			});

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
			const checkInTimes = allAttendance.map((record) => new Date(record.checkIn));
			const checkOutTimes = allAttendance
				.filter((record) => record.checkOut)
				.map((record) => new Date(record.checkOut!));

			// Use enhanced average time calculation
			const averageCheckInTime = TimeCalculatorUtil.calculateAverageTime(checkInTimes);
			const averageCheckOutTime = TimeCalculatorUtil.calculateAverageTime(checkOutTimes);

			// Enhanced punctuality and overtime calculation using organization hours
			let punctualityScore = 0;
			let overtimeFrequency = 0;

			if (allAttendance.length > 0) {
				// Get organization ID from user data
				let organizationId = null;
				if (allAttendance[0]?.owner?.uid) {
					const userResult = await this.userService.findOneByUid(allAttendance[0].owner.uid);
					organizationId = userResult?.user?.organisation?.uid || null;
				}

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
				// Get organization ID if not already retrieved
				let organizationId = null;
				if (allAttendance[0]?.owner?.uid) {
					const userResult = await this.userService.findOneByUid(allAttendance[0].owner.uid);
					organizationId = userResult?.user?.organisation?.uid || null;
				}

				const productivityMetrics = await this.attendanceCalculatorService.calculateProductivityMetrics(
					allAttendance,
					organizationId,
				);

				workEfficiencyScore = productivityMetrics.workEfficiencyScore;
				shiftCompletionRate = productivityMetrics.shiftCompletionRate;
				lateArrivalsCount = productivityMetrics.lateArrivalsCount;
				earlyDeparturesCount = productivityMetrics.earlyDeparturesCount;
			}

			// Format response
			const metrics = {
				firstAttendance: {
					date: firstAttendance ? new Date(firstAttendance.checkIn).toISOString().split('T')[0] : null,
					checkInTime: firstAttendance ? new Date(firstAttendance.checkIn).toLocaleTimeString() : null,
					daysAgo: firstAttendance
						? Math.floor(differenceInMinutes(now, new Date(firstAttendance.checkIn)) / (24 * 60))
						: null,
				},
				lastAttendance: {
					date: lastAttendance ? new Date(lastAttendance.checkIn).toISOString().split('T')[0] : null,
					checkInTime: lastAttendance ? new Date(lastAttendance.checkIn).toLocaleTimeString() : null,
					checkOutTime: lastAttendance?.checkOut
						? new Date(lastAttendance.checkOut).toLocaleTimeString()
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
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					owner: { uid: userId },
					checkIn: Between(parsedStartDate, parsedEndDate),
				},
				relations: ['owner', 'owner.branch', 'owner.organisation'],
				order: { checkIn: 'ASC' },
			});

			// Get the most recent attendance record (even if outside date range)
			const lastAttendanceRecord = await this.attendanceRepository.findOne({
				where: { owner: { uid: userId } },
				order: { checkIn: 'DESC' },
			});

			// Get previous period records for trend analysis
			const previousPeriodStart = subMonths(parsedStartDate, 3);
			const previousPeriodEnd = parsedStartDate;

			const previousPeriodRecords = await this.attendanceRepository.find({
				where: {
					owner: { uid: userId },
					checkIn: Between(previousPeriodStart, previousPeriodEnd),
				},
				order: { checkIn: 'ASC' },
			});

			// Calculate basic metrics
			const completedShifts = attendanceRecords.filter((record) => record.checkOut);
			const totalRecords = attendanceRecords.length;

			// Skip detailed calculations if no records found
			if (totalRecords === 0) {
				return this.generateEmptyUserMetrics(lastAttendanceRecord);
			}

			// Get organization ID for enhanced calculations
			const organizationId = userExists?.organisation?.uid;

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

			// Calculate time patterns
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

			// Add branch filter
			if (branchId || queryDto.branchId) {
				const targetBranchId = branchId || queryDto.branchId;
				userFilters.branch = { uid: targetBranchId };
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
			const attendanceRecords = await this.attendanceRepository.find({
				where: {
					...attendanceFilters,
					owner: { uid: In(userIds) },
				},
				relations: ['owner', 'owner.branch'],
				order: {
					checkIn: 'ASC',
				},
			});

			// PART 1: Individual User Metrics
			let userMetrics: any[] = [];
			if (queryDto.includeUserDetails !== false) {
				userMetrics = await this.generateAllUsersMetrics(users, attendanceRecords);
			}

			// PART 2: Organization-level metrics
			const organizationMetrics = await this.calculateOrganizationMetrics(attendanceRecords, users);

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

			// Cache the result for 5 minutes
			await this.cacheManager.set(cacheKey, response, 300);

			return response;
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

	private async calculateOrganizationMetrics(attendanceRecords: Attendance[], users: User[]): Promise<any> {
		try {
			const completedShifts = attendanceRecords.filter((record) => record.checkOut);

			// Calculate average times
			const averageTimes = this.calculateAverageTimes(attendanceRecords);

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

	private calculateAverageTimes(attendanceRecords: Attendance[]): any {
		try {
			if (attendanceRecords.length === 0) {
				return {
					startTime: 'N/A',
					endTime: 'N/A',
					shiftDuration: 0,
					breakDuration: 0,
				};
			}

			// Use enhanced calculation service for average times
			const averageTimes = this.attendanceCalculatorService.calculateAverageTimes(attendanceRecords);

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
}
