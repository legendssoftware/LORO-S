import { Injectable, NotFoundException, Logger, BadRequestException, Inject } from '@nestjs/common';
import { IsNull, MoreThanOrEqual, Not, Repository, LessThanOrEqual, Between, In, LessThan } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Attendance } from './entities/attendance.entity';
import { AttendanceStatus } from '../lib/enums/attendance.enums';
import { CreateCheckInDto } from './dto/create-attendance-check-in.dto';
import { CreateCheckOutDto } from './dto/create-attendance-check-out.dto';
import { CreateBreakDto } from './dto/create-attendance-break.dto';
import { OrganizationReportQueryDto } from './dto/organization-report-query.dto';
import { isToday } from 'date-fns';
import { differenceInMinutes, startOfMonth, endOfMonth, startOfDay, endOfDay, differenceInDays, format, parseISO } from 'date-fns';
import { UserService } from '../user/user.service';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { XP_VALUES } from '../lib/constants/constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BreakDetail } from './interfaces/break-detail.interface';
import { User } from '../user/entities/user.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';

// Import our enhanced calculation services
import { TimeCalculatorUtil } from './utils/time-calculator.util';
import { DateRangeUtil } from './utils/date-range.util';
import { OrganizationHoursService } from './services/organization-hours.service';
import { AttendanceCalculatorService } from './services/attendance-calculator.service';

@Injectable()
export class AttendanceService {
	private readonly logger = new Logger(AttendanceService.name);

	constructor(
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private userService: UserService,
		private rewardsService: RewardsService,
		private readonly eventEmitter: EventEmitter2,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		// Inject our enhanced services
		private readonly organizationHoursService: OrganizationHoursService,
		private readonly attendanceCalculatorService: AttendanceCalculatorService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
	) {
		this.logger.debug('AttendanceService initialized with all dependencies and enhanced calculation services');
	}

	// ======================================================
	// ATTENDANCE METRICS FUNCTIONALITY
	// ======================================================

	public async checkIn(checkInDto: CreateCheckInDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		this.logger.log(`Check-in attempt for user: ${checkInDto.owner?.uid}, orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Check-in data: ${JSON.stringify({ ...checkInDto, owner: checkInDto.owner?.uid })}`);

		try {
			this.logger.debug('Saving check-in record to database');
			const checkIn = await this.attendanceRepository.save({
				...checkInDto,
				organisation: orgId ? { uid: orgId } : undefined,
				branch: branchId ? { uid: branchId } : undefined,
			});

			if (!checkIn) {
				this.logger.error('Failed to create check-in record');
				throw new NotFoundException(process.env.CREATE_ERROR_MESSAGE);
			}

			this.logger.debug(`Check-in record created successfully with ID: ${checkIn.uid}`);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			this.logger.debug(`Awarding XP for check-in to user: ${checkInDto.owner.uid}, amount: ${XP_VALUES.CHECK_IN}`);
			await this.rewardsService.awardXP({
				owner: checkInDto.owner.uid,
				amount: XP_VALUES.CHECK_IN,
				action: XP_VALUES_TYPES.ATTENDANCE,
				source: {
					id: checkInDto.owner.uid.toString(),
					type: XP_VALUES_TYPES.ATTENDANCE,
					details: 'Check-in reward',
				},
			}, orgId, branchId);
			this.logger.debug(`XP awarded successfully for check-in to user: ${checkInDto.owner.uid}`);

			// Send shift start notification
			try {
				const checkInTime = new Date().toLocaleTimeString('en-US', { 
					hour: '2-digit', 
					minute: '2-digit',
					hour12: true
				});
				
				this.logger.debug(`Sending shift start notification to user: ${checkInDto.owner.uid}`);
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_SHIFT_STARTED,
					[checkInDto.owner.uid],
					{
						checkInTime,
						userId: checkInDto.owner.uid,
						organisationId: orgId,
						branchId: branchId,
					},
					{
						priority: NotificationPriority.NORMAL,
					},
				);
				this.logger.debug(`Shift start notification sent successfully to user: ${checkInDto.owner.uid}`);
			} catch (notificationError) {
				this.logger.warn(`Failed to send shift start notification to user: ${checkInDto.owner.uid}`, notificationError.message);
				// Don't fail the check-in if notification fails
			}

			this.logger.log(`Check-in successful for user: ${checkInDto.owner.uid}`);
			return response;
		} catch (error) {
			this.logger.error(`Check-in failed for user: ${checkInDto.owner?.uid}`, error.stack);
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	public async checkOut(checkOutDto: CreateCheckOutDto, orgId?: number, branchId?: number): Promise<{ message: string; duration?: string }> {
		this.logger.log(`Check-out attempt for user: ${checkOutDto.owner?.uid}, orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Check-out data: ${JSON.stringify({ ...checkOutDto, owner: checkOutDto.owner?.uid })}`);

		try {
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

			if (activeShift) {
				this.logger.debug(`Active shift found for user: ${checkOutDto.owner?.uid}, shift ID: ${activeShift.uid}`);
				const checkOutTime = new Date();
				const checkInTime = new Date(activeShift.checkIn);
				this.logger.debug(`Calculating work duration: check-in at ${checkInTime.toISOString()}, check-out at ${checkOutTime.toISOString()}`);

				// Enhanced calculation using our new utilities
				const organizationId = activeShift.owner?.organisation?.uid;
				this.logger.debug(`Processing time calculations for organization: ${organizationId}`);
				
				const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					activeShift.breakDetails,
					activeShift.totalBreakTime
				);
				this.logger.debug(`Total break minutes calculated: ${breakMinutes}`);

				// Calculate precise work session
				const workSession = TimeCalculatorUtil.calculateWorkSession(
					checkInTime,
					checkOutTime,
					activeShift.breakDetails,
					activeShift.totalBreakTime,
					organizationId ? await this.organizationHoursService.getOrganizationHours(organizationId) : null
				);

				// Format duration (maintains original format)
				const duration = TimeCalculatorUtil.formatDuration(workSession.netWorkMinutes);
				this.logger.debug(`Work session calculated - net work minutes: ${workSession.netWorkMinutes}, formatted duration: ${duration}`);

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

				const response = {
					message: process.env.SUCCESS_MESSAGE,
					duration,
				};

				this.logger.debug(`Awarding XP for check-out to user: ${checkOutDto.owner.uid}, amount: ${XP_VALUES.CHECK_OUT}`);
				await this.rewardsService.awardXP({
					owner: checkOutDto.owner.uid,
					amount: XP_VALUES.CHECK_OUT,
					action: XP_VALUES_TYPES.ATTENDANCE,
					source: {
						id: checkOutDto.owner.uid.toString(),
						type: XP_VALUES_TYPES.ATTENDANCE,
						details: 'Check-out reward',
					},
				}, orgId, branchId);
				this.logger.debug(`XP awarded successfully for check-out to user: ${checkOutDto.owner.uid}`);

				// Send shift end notification
				try {
					const checkOutTimeString = checkOutTime.toLocaleTimeString('en-US', { 
						hour: '2-digit', 
						minute: '2-digit',
						hour12: true
					});
					
					this.logger.debug(`Sending shift end notification to user: ${checkOutDto.owner.uid}`);
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.ATTENDANCE_SHIFT_ENDED,
						[checkOutDto.owner.uid],
						{
							checkOutTime: checkOutTimeString,
							duration,
							userId: checkOutDto.owner.uid,
							organisationId: orgId,
							branchId: branchId,
						},
						{
							priority: NotificationPriority.NORMAL,
						},
					);
					this.logger.debug(`Shift end notification sent successfully to user: ${checkOutDto.owner.uid}`);
				} catch (notificationError) {
					this.logger.warn(`Failed to send shift end notification to user: ${checkOutDto.owner.uid}`, notificationError.message);
					// Don't fail the check-out if notification fails
				}

				// Emit the daily-report event with the user ID
				this.logger.debug(`Emitting events for user: ${checkOutDto?.owner?.uid}`);
				this.eventEmitter.emit('daily-report', {
					userId: checkOutDto?.owner?.uid,
				});

				this.eventEmitter.emit('user.target.update.required', { userId: checkOutDto?.owner?.uid });
				this.eventEmitter.emit('user.metrics.update.required', checkOutDto?.owner?.uid);
				this.logger.debug(`Events emitted successfully for user: ${checkOutDto?.owner?.uid}`);

				this.logger.log(`Check-out successful for user: ${checkOutDto.owner?.uid}, duration: ${duration}`);
				return response;
			} else {
				this.logger.warn(`No active shift found for check-out for user: ${checkOutDto.owner?.uid}`);
			}
		} catch (error) {
			this.logger.error(`Check-out failed for user: ${checkOutDto.owner?.uid}`, error.stack);
			const response = {
				message: error?.message,
				duration: null,
			};

			return response;
		}
	}

	public async allCheckIns(orgId?: number, branchId?: number): Promise<{ message: string; checkIns: Attendance[] }> {
		this.logger.log(`Retrieving all check-ins for orgId: ${orgId}, branchId: ${branchId}`);
		
		try {
			const whereConditions: any = {};

			// Apply organization filtering
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
				this.logger.debug(`Added organization filter: ${orgId}`);
			}

			// Apply branch filtering if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
				this.logger.debug(`Added branch filter: ${branchId}`);
			}

			this.logger.debug(`Querying attendance records with conditions: ${JSON.stringify(whereConditions)}`);
			const checkIns = await this.attendanceRepository.find({
				where: Object.keys(whereConditions).length > 0 ? whereConditions : undefined,
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
			});

			if (!checkIns) {
				this.logger.error('No check-ins found in database');
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.log(`Successfully retrieved ${checkIns.length} check-in records`);
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

	public async checkInsByDate(date: string, orgId?: number, branchId?: number): Promise<{ message: string; checkIns: Attendance[] }> {
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
				order: {
					checkIn: 'DESC',
				},
			});

			// Combine both sets of check-ins and mark multi-day shifts
			const allCheckIns = [...checkInsToday, ...ongoingShifts].map(checkIn => {
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
	 * Enhanced method to get attendance records that properly handles multi-day shifts
	 */
	public async getAttendanceForDateRange(
		startDate: Date, 
		endDate: Date, 
		orgId?: number, 
		branchId?: number
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
				order: {
					checkIn: 'DESC',
				},
			});

			// Identify multi-day shifts (shifts that span more than 24 hours)
			const multiDayShifts = checkInsInRange.filter(shift => {
				if (!shift.checkOut) {
					// Still ongoing - check if it's been more than 24 hours
					const shiftDuration = new Date().getTime() - new Date(shift.checkIn).getTime();
					return shiftDuration > (24 * 60 * 60 * 1000); // More than 24 hours
				} else {
					// Completed shift - check if it spanned multiple days
					const shiftDuration = new Date(shift.checkOut).getTime() - new Date(shift.checkIn).getTime();
					return shiftDuration > (24 * 60 * 60 * 1000); // More than 24 hours
				}
			});

			// Mark all shifts with their day span information
			const allCheckIns = [...checkInsInRange, ...ongoingShifts].map(checkIn => {
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
				multiDayShifts: multiDayShifts.map(shift => ({
					...shift,
					shiftDaySpan: this.calculateShiftDaySpan(new Date(shift.checkIn), shift.checkOut ? new Date(shift.checkOut) : new Date()),
				})),
				ongoingShifts: ongoingShifts.map(shift => ({
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

	public async checkInsByStatus(ref: number, orgId?: number, branchId?: number): Promise<{
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
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

	public async checkInsByUser(ref: number, orgId?: number, branchId?: number): Promise<{ message: string; checkIns: Attendance[]; user: any }> {
		try {
			const whereConditions: any = { 
				owner: { uid: ref } 
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
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

	public async checkInsByBranch(ref: string, orgId?: number): Promise<{ message: string; checkIns: Attendance[]; branch: any; totalUsers: number }> {
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
				order: {
					checkIn: 'DESC',
				},
			});

			if (!checkIns || checkIns.length === 0) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Get branch info and count unique users
			const branchInfo = checkIns[0]?.branch || null;
			const uniqueUsers = new Set(checkIns.map(record => record.owner.uid));
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
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
				relations: ['owner', 'owner.branch', 'owner.organisation', 'owner.userProfile', 'verifiedBy', 'organisation', 'branch'],
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
			if (breakDto.isStartingBreak) {
				return this.startBreak(breakDto);
			} else {
				return this.endBreak(breakDto);
			}
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}

	private async startBreak(breakDto: CreateBreakDto): Promise<{ message: string }> {
		try {
			// Find the active shift
			const activeShift = await this.attendanceRepository.findOne({
				where: {
					status: AttendanceStatus.PRESENT,
					owner: breakDto.owner,
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
				},
				order: {
					checkIn: 'DESC',
				},
			});

			if (!activeShift) {
				throw new NotFoundException('No active shift found to start break');
			}

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
					hour12: true
				});
				
				this.logger.debug(`Sending break start notification to user: ${breakDto.owner.uid}`);
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_STARTED,
					[breakDto.owner.uid],
					{
						breakStartTime: breakStartTimeString,
						userId: breakDto.owner.uid,
					},
					{
						priority: NotificationPriority.LOW,
					},
				);
				this.logger.debug(`Break start notification sent successfully to user: ${breakDto.owner.uid}`);
			} catch (notificationError) {
				this.logger.warn(`Failed to send break start notification to user: ${breakDto.owner.uid}`, notificationError.message);
				// Don't fail the break start if notification fails
			}

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
			// Find the shift on break
			const shiftOnBreak = await this.attendanceRepository.findOne({
				where: {
					status: AttendanceStatus.ON_BREAK,
					owner: breakDto.owner,
					checkIn: Not(IsNull()),
					checkOut: IsNull(),
					breakStartTime: Not(IsNull()),
				},
				order: {
					checkIn: 'DESC',
				},
			});

			if (!shiftOnBreak) {
				throw new NotFoundException('No shift on break found');
			}

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
				this.logger.debug(`Sending break end notification to user: ${breakDto.owner.uid}`);
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.ATTENDANCE_BREAK_ENDED,
					[breakDto.owner.uid],
					{
						breakDuration: currentBreakDuration,
						userId: breakDto.owner.uid,
					},
					{
						priority: NotificationPriority.LOW,
					},
				);
				this.logger.debug(`Break end notification sent successfully to user: ${breakDto.owner.uid}`);
			} catch (notificationError) {
				this.logger.warn(`Failed to send break end notification to user: ${breakDto.owner.uid}`, notificationError.message);
				// Don't fail the break end if notification fails
			}

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
			const organizationId = completedShifts[0]?.owner?.organisation?.uid || 
							   activeShift?.owner?.organisation?.uid;

			// Use enhanced calculation service
			const result = await this.attendanceCalculatorService.calculateDailyStats(
				completedShifts,
				activeShift,
				organizationId
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
			const todayAttendance = allAttendance.filter(
				(record) => new Date(record.checkIn) >= startOfToday
			);
			const weekAttendance = allAttendance.filter(
				(record) => new Date(record.checkIn) >= startOfWeek
			);
			const monthAttendance = allAttendance.filter(
				(record) => new Date(record.checkIn) >= startOfMonth
			);

			// Enhanced helper function using our new utilities
			const calculateTotalHours = (records: Attendance[]): number => {
				return records.reduce((total, record) => {
					if (record.checkIn && record.checkOut) {
						const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
							record.breakDetails,
							record.totalBreakTime
						);
						const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
						const workMinutes = Math.max(0, totalMinutes - breakMinutes);
						return total + TimeCalculatorUtil.minutesToHours(workMinutes, TimeCalculatorUtil.PRECISION.HOURS);
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
			
			for (let i = 0; i < 30; i++) { // Check last 30 days
				const checkDate = new Date(today);
				checkDate.setDate(today.getDate() - i);
				const nextDay = new Date(checkDate);
				nextDay.setDate(checkDate.getDate() + 1);
				
				const hasAttendance = allAttendance.some(record => {
					const recordDate = new Date(record.checkIn);
					return recordDate >= checkDate && recordDate < nextDay;
				});
				
				if (hasAttendance) {
					attendanceStreak++;
				} else if (i > 0) { // Don't break on today if no attendance yet
					break;
				}
			}

			// ===== ENHANCED BREAK ANALYTICS =====
			const calculateBreakAnalytics = (records: Attendance[]) => {
				let totalBreakMinutes = 0;
				let totalBreaks = 0;
				let breakDurations: number[] = [];

				records.forEach(record => {
					// Use enhanced break calculation that handles multiple formats
					const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
						record.breakDetails,
						record.totalBreakTime
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

			const completedShifts = allAttendance.filter(record => record.checkOut);
			const averageBreakDuration = completedShifts.length > 0 
				? allTimeBreaks.totalBreakMinutes / completedShifts.length 
				: 0;
			const breakFrequency = completedShifts.length > 0 
				? allTimeBreaks.totalBreaks / completedShifts.length 
				: 0;
			const longestBreak = allTimeBreaks.breakDurations.length > 0 
				? Math.max(...allTimeBreaks.breakDurations) 
				: 0;
			const shortestBreak = allTimeBreaks.breakDurations.length > 0 
				? Math.min(...allTimeBreaks.breakDurations) 
				: 0;

			// ===== ENHANCED TIMING PATTERNS =====
			const checkInTimes = allAttendance.map(record => new Date(record.checkIn));
			const checkOutTimes = allAttendance
				.filter(record => record.checkOut)
				.map(record => new Date(record.checkOut!));

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
					organizationId
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
					organizationId
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
					daysAgo: firstAttendance ? Math.floor(differenceInMinutes(now, new Date(firstAttendance.checkIn)) / (24 * 60)) : null,
				},
				lastAttendance: {
					date: lastAttendance ? new Date(lastAttendance.checkIn).toISOString().split('T')[0] : null,
					checkInTime: lastAttendance ? new Date(lastAttendance.checkIn).toLocaleTimeString() : null,
					checkOutTime: lastAttendance?.checkOut ? new Date(lastAttendance.checkOut).toLocaleTimeString() : null,
					daysAgo: lastAttendance ? Math.floor(differenceInMinutes(now, new Date(lastAttendance.checkIn)) / (24 * 60)) : null,
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
			const fromDate = queryDto.dateFrom ? parseISO(queryDto.dateFrom) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
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

			const userIds = users.map(user => user.uid);

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
				const userAttendance = attendanceRecords.filter(record => record.owner.uid === user.uid);

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
			const completedShifts = attendanceRecords.filter(record => record.checkOut);

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
				shiftDuration: TimeCalculatorUtil.roundToHours(averageTimes.averageShiftDuration, TimeCalculatorUtil.PRECISION.HOURS),
				breakDuration: TimeCalculatorUtil.roundToHours(averageTimes.averageBreakDuration, TimeCalculatorUtil.PRECISION.HOURS),
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
			const completedShifts = attendanceRecords.filter(record => record.checkOut);

			// Enhanced total hours calculation using our utilities
			const totalHours = completedShifts.reduce((sum, record) => {
				const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					record.breakDetails,
					record.totalBreakTime
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
						record.totalBreakTime
					);
					const totalMinutes = differenceInMinutes(new Date(record.checkOut!), new Date(record.checkIn));
					const workMinutes = Math.max(0, totalMinutes - breakMinutes);
					
					const overtimeInfo = await this.organizationHoursService.calculateOvertime(
						organizationId,
						record.checkIn,
						workMinutes
					);
					overtimeHours += TimeCalculatorUtil.minutesToHours(overtimeInfo.overtimeMinutes, TimeCalculatorUtil.PRECISION.CURRENCY);
				} else {
					// Fallback to default 8-hour calculation
					const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
						record.breakDetails,
						record.totalBreakTime
					);
					const totalMinutes = differenceInMinutes(new Date(record.checkOut!), new Date(record.checkIn));
					const workMinutes = Math.max(0, totalMinutes - breakMinutes);
					const workHours = TimeCalculatorUtil.minutesToHours(workMinutes, TimeCalculatorUtil.PRECISION.CURRENCY);
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
			users.forEach(user => {
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
			attendanceRecords.forEach(record => {
				const user = users.find(u => u.uid === record.owner.uid);
				if (user && user.branch) {
					const branchId = user.branch.uid.toString();
					const branchData = branchMap.get(branchId);
					
					if (branchData) {
						branchData.totalShifts++;
						
						if (record.checkOut) {
							// Enhanced calculation using our utilities
							const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
								record.breakDetails,
								record.totalBreakTime
							);
							const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
							const workMinutes = Math.max(0, totalMinutes - breakMinutes);
							const workHours = TimeCalculatorUtil.minutesToHours(workMinutes, TimeCalculatorUtil.PRECISION.CURRENCY);
							branchData.totalHours += workHours;
						}
					}
				}
			});

			// Convert to array and calculate averages
			return Array.from(branchMap.values()).map(branch => ({
				branchId: branch.branchId,
				branchName: branch.branchName,
				employeeCount: branch.employees.size,
				totalHours: TimeCalculatorUtil.roundToHours(branch.totalHours, TimeCalculatorUtil.PRECISION.HOURS),
				totalShifts: branch.totalShifts,
				averageHoursPerEmployee: branch.employees.size > 0 
					? TimeCalculatorUtil.roundToHours(branch.totalHours / branch.employees.size, TimeCalculatorUtil.PRECISION.HOURS) 
					: 0,
				averageShiftsPerEmployee: branch.employees.size > 0 
					? TimeCalculatorUtil.roundToHours(branch.totalShifts / branch.employees.size, TimeCalculatorUtil.PRECISION.DISPLAY) 
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
			users.forEach(user => {
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
			attendanceRecords.forEach(record => {
				const user = users.find(u => u.uid === record.owner.uid);
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
			return Array.from(roleMap.values()).map(role => ({
				role: role.role,
				employeeCount: role.employees.size,
				totalHours: Math.round(role.totalHours * 100) / 100,
				totalShifts: role.totalShifts,
				averageHoursPerEmployee: role.employees.size > 0 
					? Math.round((role.totalHours / role.employees.size) * 100) / 100 
					: 0,
				averageShiftsPerEmployee: role.employees.size > 0 
					? Math.round((role.totalShifts / role.employees.size) * 100) / 100 
					: 0,
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
			const onTimeArrivals = attendanceRecords.filter(record => {
				const checkInTime = new Date(record.checkIn);
				const checkInMinutes = checkInTime.getHours() * 60 + checkInTime.getMinutes();
				const standardStartMinutes = standardStartHour * 60 + standardStartMinute;
				return checkInMinutes <= standardStartMinutes;
			}).length;

			const punctualityRate = Math.round((onTimeArrivals / attendanceRecords.length) * 100);

			// Calculate average hours per day
			const completedShifts = attendanceRecords.filter(record => record.checkOut);
			const totalWorkHours = completedShifts.reduce((sum, record) => {
				const startTime = new Date(record.checkIn);
				const endTime = new Date(record.checkOut!);
				const breakMinutes = record.totalBreakTime ? this.parseBreakTime(record.totalBreakTime) : 0;
				const workHours = (differenceInMinutes(endTime, startTime) - breakMinutes) / 60;
				return sum + workHours;
			}, 0);

			const averageHoursPerDay = completedShifts.length > 0 
				? Math.round((totalWorkHours / completedShifts.length) * 100) / 100 
				: 0;

			// Find peak check-in and check-out times
			const peakCheckInTime = this.findPeakTime(attendanceRecords.map(r => new Date(r.checkIn)));
			const peakCheckOutTime = this.findPeakTime(
				completedShifts.map(r => new Date(r.checkOut!))
			);

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
		
		times.forEach(time => {
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
