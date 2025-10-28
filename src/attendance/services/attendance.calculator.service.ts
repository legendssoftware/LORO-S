import { Injectable, Logger } from '@nestjs/common';
import { differenceInMinutes, differenceInMilliseconds } from 'date-fns';
import { TimeCalculatorUtil, WorkSession } from '../../lib/utils/time-calculator.util';
import { TimezoneUtil } from '../../lib/utils/timezone.util';
import { OrganizationHoursService } from './organization.hours.service';
import { Attendance } from '../entities/attendance.entity';
import { BreakDetail } from '../../lib/interfaces/break-detail.interface';
import { AttendanceStatus } from '../../lib/enums/attendance.enums';

export interface EnhancedAttendanceMetrics {
	workSession: WorkSession;
	punctuality: {
		isLate: boolean;
		isEarly: boolean;
		lateMinutes: number;
		earlyMinutes: number;
	};
	overtime: {
		isOvertime: boolean;
		overtimeMinutes: number;
	};
	efficiency: number;
}

@Injectable()
export class AttendanceCalculatorService {
	private readonly logger = new Logger(AttendanceCalculatorService.name);

	constructor(private readonly organizationHoursService: OrganizationHoursService) {}

	/**
	 * Calculate enhanced work session with organization-aware precision
	 */
	async calculateEnhancedWorkSession(
		checkIn: Date,
		checkOut: Date,
		breakDetails?: BreakDetail[],
		totalBreakTime?: string,
		organizationId?: number,
	): Promise<EnhancedAttendanceMetrics> {
		try {
			// Get organization working hours for context
			const orgHours = organizationId
				? await this.organizationHoursService.getOrganizationHours(organizationId)
				: null;

			// Calculate precise work session
			const workSession = TimeCalculatorUtil.calculateWorkSession(
				checkIn,
				checkOut,
				breakDetails,
				totalBreakTime,
				orgHours,
			);

			// Calculate punctuality using organization hours
			const punctuality = await this.calculatePunctuality(checkIn, checkOut, organizationId);

			// Calculate overtime
			const overtime = await this.calculateOvertime(organizationId, checkIn, workSession.netWorkMinutes);

			// Calculate efficiency
			const efficiency = TimeCalculatorUtil.calculateEfficiency(
				workSession.netWorkMinutes,
				workSession.totalMinutes,
			);

			return {
				workSession,
				punctuality,
				overtime,
				efficiency,
			};
		} catch (error) {
			this.logger.error('Error calculating enhanced work session:', error);
			throw error;
		}
	}

	/**
	 * Calculate punctuality based on organization hours
	 */
	async calculatePunctuality(checkIn: Date, checkOut: Date | null, organizationId?: number) {
		if (!organizationId) {
			// Fallback to default calculation
			return TimeCalculatorUtil.calculatePunctuality(checkIn, checkOut);
		}

		const lateInfo = await this.organizationHoursService.isUserLate(organizationId, checkIn);
		let earlyInfo = { isEarly: false, earlyMinutes: 0 };

		if (checkOut) {
			earlyInfo = await this.organizationHoursService.isUserEarly(organizationId, checkOut);
		}

		return {
			isLate: lateInfo.isLate,
			isEarly: earlyInfo.isEarly,
			lateMinutes: lateInfo.lateMinutes,
			earlyMinutes: earlyInfo.earlyMinutes,
		};
	}

	/**
	 * Calculate overtime using organization-specific standards
	 */
	async calculateOvertime(organizationId: number | undefined, workDate: Date, actualWorkMinutes: number) {
		if (!organizationId) {
			// Fallback to default calculation
			const standardMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
			const isOvertime = actualWorkMinutes > standardMinutes;
			const overtimeMinutes = Math.max(0, actualWorkMinutes - standardMinutes);

			return { isOvertime, overtimeMinutes };
		}

		const overtimeInfo = await this.organizationHoursService.calculateOvertime(
			organizationId,
			workDate,
			actualWorkMinutes,
		);

		return {
			isOvertime: overtimeInfo.isOvertime,
			overtimeMinutes: overtimeInfo.overtimeMinutes,
		};
	}

	/**
	 * Process attendance record with enhanced calculations (maintains original response structure)
	 * Duration is now capped at expected work hours, with overtime capturing excess hours
	 */
	async processAttendanceRecord(attendance: Attendance): Promise<{
		duration: string;
		netWorkHours: number;
		isOvertime: boolean;
		overtimeMinutes: number;
		efficiency: number;
	}> {
		if (!attendance.checkIn || !attendance.checkOut) {
			return {
				duration: '0h 0m',
				netWorkHours: 0,
				isOvertime: false,
				overtimeMinutes: 0,
				efficiency: 0,
			};
		}

		const organizationId = attendance.organisation?.uid;

		const metrics = await this.calculateEnhancedWorkSession(
			attendance.checkIn,
			attendance.checkOut,
			attendance.breakDetails,
			attendance.totalBreakTime,
			organizationId,
		);

		// Get expected work minutes to cap duration
		let expectedWorkMinutes = TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES;
		if (organizationId) {
			try {
				const workingDayInfo = await this.organizationHoursService.getWorkingDayInfo(
					organizationId,
					attendance.checkIn,
				);
				expectedWorkMinutes = workingDayInfo.expectedWorkMinutes || expectedWorkMinutes;
			} catch (error) {
				this.logger.warn(`Failed to get expected work minutes, using default: ${expectedWorkMinutes}`);
			}
		}

		// Cap duration at expected work hours
		const durationMinutes = Math.min(metrics.workSession.netWorkMinutes, expectedWorkMinutes);
		const overtimeMinutes = Math.max(0, metrics.workSession.netWorkMinutes - expectedWorkMinutes);

		return {
			duration: TimeCalculatorUtil.formatDuration(durationMinutes),
			netWorkHours: metrics.workSession.netWorkHours,
			isOvertime: overtimeMinutes > 0,
			overtimeMinutes: overtimeMinutes,
			efficiency: metrics.efficiency,
		};
	}

	/**
	 * Calculate daily stats with enhanced precision (maintains original response structure)
	 */
	async calculateDailyStats(
		attendanceRecords: Attendance[],
		activeShift?: Attendance,
		organizationId?: number,
	): Promise<{ dailyWorkTime: number; dailyBreakTime: number }> {
		let totalWorkTimeMs = 0;
		let totalBreakTimeMs = 0;

		// Process completed shifts
		for (const record of attendanceRecords) {
			if (record.checkIn && record.checkOut) {
				const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					record.breakDetails,
					record.totalBreakTime,
				);

				const totalMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));

				const workMinutes = Math.max(0, totalMinutes - breakMinutes);

				totalWorkTimeMs += workMinutes * 60 * 1000; // Convert to milliseconds
				totalBreakTimeMs += breakMinutes * 60 * 1000;
			}
		}

		// Process active shift if exists
		if (activeShift && activeShift.checkIn) {
			const now = new Date();
			const currentDuration = differenceInMilliseconds(now, new Date(activeShift.checkIn));

			let breakMs = 0;

			// Calculate break time for active shift
			if (activeShift.status === AttendanceStatus.ON_BREAK && activeShift.breakStartTime) {
				const currentBreakDuration = differenceInMilliseconds(now, new Date(activeShift.breakStartTime));

				// Add completed breaks
				const completedBreakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					activeShift.breakDetails,
					activeShift.totalBreakTime,
				);
				breakMs = completedBreakMinutes * 60 * 1000 + currentBreakDuration;
			} else {
				// Just completed breaks
				const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					activeShift.breakDetails,
					activeShift.totalBreakTime,
				);
				breakMs = breakMinutes * 60 * 1000;
			}

			totalBreakTimeMs += breakMs;
			totalWorkTimeMs += currentDuration - breakMs;
		}

		return {
			dailyWorkTime: totalWorkTimeMs,
			dailyBreakTime: totalBreakTimeMs,
		};
	}

	/**
	 * Calculate average times with enhanced precision
	 * @param attendanceRecords - Array of attendance records
	 * @param organizationTimezone - Optional timezone for conversion (e.g., 'Africa/Johannesburg')
	 */
	calculateAverageTimes(
		attendanceRecords: Attendance[], 
		organizationTimezone?: string
	): {
		averageCheckInTime: string;
		averageCheckOutTime: string;
		averageShiftDuration: number;
		averageBreakDuration: number;
	} {
		if (attendanceRecords.length === 0) {
			return {
				averageCheckInTime: 'N/A',
				averageCheckOutTime: 'N/A',
				averageShiftDuration: 0,
				averageBreakDuration: 0,
			};
		}

		// Calculate average check-in time with timezone conversion
		const checkInTimes = attendanceRecords.map((record) => {
			const time = new Date(record.checkIn);
			return organizationTimezone 
				? TimezoneUtil.toOrganizationTime(time, organizationTimezone)
				: time;
		});
		const averageCheckInTime = TimeCalculatorUtil.calculateAverageTime(checkInTimes);

		// Calculate average check-out time with timezone conversion
		const completedShifts = attendanceRecords.filter((record) => record.checkOut);
		const checkOutTimes = completedShifts.map((record) => {
			const time = new Date(record.checkOut!);
			return organizationTimezone
				? TimezoneUtil.toOrganizationTime(time, organizationTimezone)
				: time;
		});
		const averageCheckOutTime = TimeCalculatorUtil.calculateAverageTime(checkOutTimes);

		// Calculate average shift duration
		const shiftDurations = completedShifts.map((record) => {
			const workMinutes = differenceInMinutes(new Date(record.checkOut!), new Date(record.checkIn));
			return TimeCalculatorUtil.minutesToHours(workMinutes, TimeCalculatorUtil.PRECISION.HOURS);
		});

		const averageShiftDuration =
			shiftDurations.length > 0
				? TimeCalculatorUtil.roundToHours(
						shiftDurations.reduce((sum, duration) => sum + duration, 0) / shiftDurations.length,
						TimeCalculatorUtil.PRECISION.HOURS,
				  )
				: 0;

		// Calculate average break duration
		const breakDurations = attendanceRecords.map((record) => {
			const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
				record.breakDetails,
				record.totalBreakTime,
			);
			return TimeCalculatorUtil.minutesToHours(breakMinutes, TimeCalculatorUtil.PRECISION.HOURS);
		});

		const averageBreakDuration =
			breakDurations.length > 0
				? TimeCalculatorUtil.roundToHours(
						breakDurations.reduce((sum, duration) => sum + duration, 0) / breakDurations.length,
						TimeCalculatorUtil.PRECISION.HOURS,
				  )
				: 0;

		return {
			averageCheckInTime,
			averageCheckOutTime,
			averageShiftDuration,
			averageBreakDuration,
		};
	}

	/**
	 * Calculate organization-aware punctuality and productivity metrics
	 */
	async calculateProductivityMetrics(
		attendanceRecords: Attendance[],
		organizationId?: number,
	): Promise<{
		punctualityScore: number;
		overtimeFrequency: number;
		workEfficiencyScore: number;
		shiftCompletionRate: number;
		lateArrivalsCount: number;
		earlyDeparturesCount: number;
	}> {
		const completedShifts = attendanceRecords.filter((record) => record.checkOut);

		let lateArrivalsCount = 0;
		let earlyDeparturesCount = 0;
		let overtimeShifts = 0;
		let totalWorkMinutes = 0;
		let totalBreakMinutes = 0;

		// Process each attendance record
		for (const record of attendanceRecords) {
			// Check punctuality using organization hours
			const punctuality = await this.calculatePunctuality(record.checkIn, record.checkOut, organizationId);

			if (punctuality.isLate) {
				lateArrivalsCount++;
			}

			if (punctuality.isEarly) {
				earlyDeparturesCount++;
			}

			if (record.checkOut) {
				// Calculate work and break times
				const workMinutes = differenceInMinutes(new Date(record.checkOut), new Date(record.checkIn));
				const breakMinutes = TimeCalculatorUtil.calculateTotalBreakMinutes(
					record.breakDetails,
					record.totalBreakTime,
				);

				totalWorkMinutes += workMinutes;
				totalBreakMinutes += breakMinutes;

				// Check for overtime
				const overtime = await this.calculateOvertime(
					organizationId,
					record.checkIn,
					workMinutes - breakMinutes,
				);

				if (overtime.isOvertime) {
					overtimeShifts++;
				}
			}
		}

		// Calculate metrics
		const punctualityScore =
			attendanceRecords.length > 0
				? TimeCalculatorUtil.calculatePercentage(
						attendanceRecords.length - lateArrivalsCount,
						attendanceRecords.length,
				  )
				: 0;

		const overtimeFrequency =
			completedShifts.length > 0
				? TimeCalculatorUtil.calculatePercentage(overtimeShifts, completedShifts.length)
				: 0;

		const workEfficiencyScore =
			totalWorkMinutes > 0
				? TimeCalculatorUtil.calculateEfficiency(totalWorkMinutes - totalBreakMinutes, totalWorkMinutes)
				: 0;

		const shiftCompletionRate =
			attendanceRecords.length > 0
				? TimeCalculatorUtil.calculatePercentage(completedShifts.length, attendanceRecords.length)
				: 0;

		return {
			punctualityScore,
			overtimeFrequency,
			workEfficiencyScore,
			shiftCompletionRate,
			lateArrivalsCount,
			earlyDeparturesCount,
		};
	}
}
