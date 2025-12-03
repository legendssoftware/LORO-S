import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganisationHours } from '../../organisation/entities/organisation-hours.entity';
import { TimeCalculatorUtil } from '../../lib/utils/time-calculator.util';

export interface WorkingDayInfo {
	isWorkingDay: boolean;
	startTime: string | null;
	endTime: string | null;
	expectedWorkMinutes: number;
}

@Injectable()
export class OrganizationHoursService {
	private readonly logger = new Logger(OrganizationHoursService.name);
	private hoursCache = new Map<number, OrganisationHours>();
	private cacheExpiry = 30 * 60 * 1000; // 30 minutes

	constructor(
		@InjectRepository(OrganisationHours)
		private organisationHoursRepository: Repository<OrganisationHours>,
	) {}

	/**
	 * Get organization hours with caching
	 */
	async getOrganizationHours(organizationId: number): Promise<OrganisationHours | null> {
		try {
			// Check cache first
			const cached = this.hoursCache.get(organizationId);
			if (cached) {
				return cached;
			}

			const orgHours = await this.organisationHoursRepository.findOne({
				where: {
					organisationUid: organizationId,
					isDeleted: false,
				},
			});

			if (orgHours) {
				// Cache the result
				this.hoursCache.set(organizationId, orgHours);
				setTimeout(() => this.hoursCache.delete(organizationId), this.cacheExpiry);
			}

			return orgHours;
		} catch (error) {
			this.logger.error(`Error fetching organization hours for org ${organizationId}:`, error);
			return null;
		}
	}

	/**
	 * Get working day information for a specific date
	 */
	async getWorkingDayInfo(organizationId: number, date: Date): Promise<WorkingDayInfo> {
		const orgHours = await this.getOrganizationHours(organizationId);
		const dayOfWeek = TimeCalculatorUtil.getDayOfWeek(date);

		if (!orgHours) {
			return {
				isWorkingDay: true,
				startTime: TimeCalculatorUtil.DEFAULT_WORK.START_TIME,
				endTime: TimeCalculatorUtil.DEFAULT_WORK.END_TIME,
				expectedWorkMinutes: TimeCalculatorUtil.DEFAULT_WORK.STANDARD_MINUTES,
			};
		}

		// Check for special hours first
		const dateString = date.toISOString().split('T')[0];
		const specialHour = orgHours.specialHours?.find((sh) => sh.date === dateString);

		if (specialHour) {
			const startMinutes = TimeCalculatorUtil.timeToMinutes(specialHour.openTime);
			const endMinutes = TimeCalculatorUtil.timeToMinutes(specialHour.closeTime);

			return {
				isWorkingDay: true,
				startTime: specialHour.openTime,
				endTime: specialHour.closeTime,
				expectedWorkMinutes: Math.max(0, endMinutes - startMinutes),
			};
		}

		// Check regular schedule
		const weeklySchedule = orgHours.weeklySchedule;
		const isWorkingDay = weeklySchedule[dayOfWeek.toLowerCase() as keyof typeof weeklySchedule];

		if (!isWorkingDay) {
			return {
				isWorkingDay: false,
				startTime: null,
				endTime: null,
				expectedWorkMinutes: 0,
			};
		}

		// Check if per-day schedule exists and has times for this day
		const daySchedule = orgHours.schedule?.[dayOfWeek.toLowerCase() as keyof typeof orgHours.schedule];
		if (daySchedule && !daySchedule.closed && daySchedule.start && daySchedule.end) {
			const startMinutes = TimeCalculatorUtil.timeToMinutes(daySchedule.start);
			const endMinutes = TimeCalculatorUtil.timeToMinutes(daySchedule.end);
			return {
				isWorkingDay: true,
				startTime: daySchedule.start,
				endTime: daySchedule.end,
				expectedWorkMinutes: Math.max(0, endMinutes - startMinutes),
			};
		}

		// Fall back to global openTime/closeTime
		const startMinutes = TimeCalculatorUtil.timeToMinutes(orgHours.openTime);
		const endMinutes = TimeCalculatorUtil.timeToMinutes(orgHours.closeTime);

		return {
			isWorkingDay: true,
			startTime: orgHours.openTime,
			endTime: orgHours.closeTime,
			expectedWorkMinutes: Math.max(0, endMinutes - startMinutes),
		};
	}

	/**
	 * Check if user is late based on organization hours
	 */
	async isUserLate(
		organizationId: number,
		checkInTime: Date,
	): Promise<{
		isLate: boolean;
		lateMinutes: number;
		graceMinutes: number;
	}> {
		const workingDay = await this.getWorkingDayInfo(organizationId, checkInTime);

		if (!workingDay.isWorkingDay || !workingDay.startTime) {
			return {
				isLate: false,
				lateMinutes: 0,
				graceMinutes: TimeCalculatorUtil.DEFAULT_WORK.PUNCTUALITY_GRACE_MINUTES,
			};
		}

		const checkInMinutes = TimeCalculatorUtil.timeToMinutes(checkInTime.toTimeString().substring(0, 5));
		const expectedStartMinutes = TimeCalculatorUtil.timeToMinutes(workingDay.startTime);
		const graceMinutes = TimeCalculatorUtil.DEFAULT_WORK.PUNCTUALITY_GRACE_MINUTES;

		const isLate = checkInMinutes > expectedStartMinutes + graceMinutes;
		const lateMinutes = isLate ? checkInMinutes - expectedStartMinutes : 0;

		return {
			isLate,
			lateMinutes,
			graceMinutes,
		};
	}

	/**
	 * Check if user departed early based on organization hours
	 */
	async isUserEarly(
		organizationId: number,
		checkOutTime: Date,
	): Promise<{
		isEarly: boolean;
		earlyMinutes: number;
	}> {
		const workingDay = await this.getWorkingDayInfo(organizationId, checkOutTime);

		if (!workingDay.isWorkingDay || !workingDay.endTime) {
			return {
				isEarly: false,
				earlyMinutes: 0,
			};
		}

		const checkOutMinutes = TimeCalculatorUtil.timeToMinutes(checkOutTime.toTimeString().substring(0, 5));
		const expectedEndMinutes = TimeCalculatorUtil.timeToMinutes(workingDay.endTime);

		const isEarly = checkOutMinutes < expectedEndMinutes;
		const earlyMinutes = isEarly ? expectedEndMinutes - checkOutMinutes : 0;

		return {
			isEarly,
			earlyMinutes,
		};
	}

	/**
	 * Calculate overtime based on organization's standard work hours
	 */
	async calculateOvertime(
		organizationId: number,
		workDate: Date,
		actualWorkMinutes: number,
	): Promise<{
		isOvertime: boolean;
		overtimeMinutes: number;
		standardWorkMinutes: number;
	}> {
		const workingDay = await this.getWorkingDayInfo(organizationId, workDate);

		const standardWorkMinutes = workingDay.expectedWorkMinutes;
		const isOvertime = actualWorkMinutes > standardWorkMinutes;
		const overtimeMinutes = Math.max(0, actualWorkMinutes - standardWorkMinutes);

		return {
			isOvertime,
			overtimeMinutes,
			standardWorkMinutes,
		};
	}

	/**
	 * Get organization's peak working hours
	 */
	async getPeakWorkingHours(organizationId: number): Promise<{
		startTime: string;
		endTime: string;
		expectedDailyHours: number;
	}> {
		const orgHours = await this.getOrganizationHours(organizationId);

		if (!orgHours) {
			return {
				startTime: TimeCalculatorUtil.DEFAULT_WORK.START_TIME,
				endTime: TimeCalculatorUtil.DEFAULT_WORK.END_TIME,
				expectedDailyHours: TimeCalculatorUtil.DEFAULT_WORK.STANDARD_HOURS,
			};
		}

		const startMinutes = TimeCalculatorUtil.timeToMinutes(orgHours.openTime);
		const endMinutes = TimeCalculatorUtil.timeToMinutes(orgHours.closeTime);
		const dailyMinutes = Math.max(0, endMinutes - startMinutes);

		return {
			startTime: orgHours.openTime,
			endTime: orgHours.closeTime,
			expectedDailyHours: TimeCalculatorUtil.minutesToHours(dailyMinutes, 1),
		};
	}

	/**
	 * Clear cache manually
	 */
	clearCache(): void {
		this.hoursCache.clear();
	}

	/**
	 * Get working days for organization
	 */
	async getWorkingDays(organizationId: number): Promise<string[]> {
		const orgHours = await this.getOrganizationHours(organizationId);

		if (!orgHours) {
			return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
		}

		const schedule = orgHours.weeklySchedule;
		return Object.keys(schedule).filter((day) => schedule[day as keyof typeof schedule]);
	}

	/**
	 * Check if organization is currently open based on hours configuration
	 * @param orgRef - Organization reference (we'll use the organization ID for compatibility)
	 * @param checkTime - Time to check (defaults to current time)
	 * @returns Object with organization status information
	 */
	async isOrganizationOpen(orgRef: string | number, checkTime: Date = new Date()): Promise<{
		isOpen: boolean;
		isWorkingDay: boolean;
		isHolidayMode: boolean;
		reason?: string;
		scheduledOpen?: string;
		scheduledClose?: string;
		dayOfWeek: string;
	}> {
		try {
			// Convert orgRef to organizationId if it's a string
			const organizationId = typeof orgRef === 'string' ? parseInt(orgRef) : orgRef;
			
			const hours = await this.getOrganizationHours(organizationId);
			
			if (!hours) {
				return {
					isOpen: true, // Default to open if no hours configured
					isWorkingDay: true,
					isHolidayMode: false,
					reason: 'No operating hours configured',
					dayOfWeek: this.getDayOfWeek(checkTime),
				};
			}

			const dayOfWeek = this.getDayOfWeek(checkTime);
			const currentTime = this.formatTime(checkTime);

			// Check holiday mode first
			if (hours.holidayMode) {
				const isStillHoliday = hours.holidayUntil ? checkTime <= hours.holidayUntil : true;
				if (isStillHoliday) {
					return {
						isOpen: false,
						isWorkingDay: false,
						isHolidayMode: true,
						reason: `Organization is in holiday mode${hours.holidayUntil ? ` until ${hours.holidayUntil.toDateString()}` : ''}`,
						dayOfWeek,
					};
				}
			}

			// Check detailed schedule first (if available)
			if (hours.schedule) {
				const daySchedule = hours.schedule[dayOfWeek.toLowerCase() as keyof typeof hours.schedule];
				if (daySchedule?.closed) {
					return {
						isOpen: false,
						isWorkingDay: false,
						isHolidayMode: false,
						reason: `Organization is closed on ${dayOfWeek}s`,
						dayOfWeek,
					};
				}

				if (daySchedule) {
					const isWithinHours = this.isTimeWithinRange(
						currentTime,
						daySchedule.start,
						daySchedule.end
					);

					return {
						isOpen: isWithinHours,
						isWorkingDay: true,
						isHolidayMode: false,
						reason: isWithinHours 
							? 'Within operating hours' 
							: `Outside operating hours (${daySchedule.start} - ${daySchedule.end})`,
						scheduledOpen: daySchedule.start,
						scheduledClose: daySchedule.end,
						dayOfWeek,
					};
				}
			}

			// Fall back to weeklySchedule and default times
			const isWorkingDay = hours.weeklySchedule[dayOfWeek.toLowerCase() as keyof typeof hours.weeklySchedule];
			
			if (!isWorkingDay) {
				return {
					isOpen: false,
					isWorkingDay: false,
					isHolidayMode: false,
					reason: `Organization is closed on ${dayOfWeek}s`,
					dayOfWeek,
				};
			}

			// Check if within operating hours
			const isWithinHours = this.isTimeWithinRange(
				currentTime,
				hours.openTime,
				hours.closeTime
			);

			return {
				isOpen: isWithinHours,
				isWorkingDay: true,
				isHolidayMode: false,
				reason: isWithinHours 
					? 'Within operating hours' 
					: `Outside operating hours (${hours.openTime} - ${hours.closeTime})`,
				scheduledOpen: hours.openTime,
				scheduledClose: hours.closeTime,
				dayOfWeek,
			};

		} catch (error) {
			this.logger.error(`Error checking organization hours: ${error.message}`);
			// If there's any error, default to open to avoid blocking legitimate check-ins
			return {
				isOpen: true,
				isWorkingDay: true,
				isHolidayMode: false,
				reason: `Error checking organization hours: ${error.message}`,
				dayOfWeek: this.getDayOfWeek(checkTime),
			};
		}
	}

	/**
	 * Get day of week from date
	 */
	private getDayOfWeek(date: Date): string {
		const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
		return days[date.getDay()];
	}

	/**
	 * Format time as HH:mm from Date object
	 */
	private formatTime(date: Date): string {
		return date.toTimeString().slice(0, 5);
	}

	/**
	 * Check if time is within range (handles overnight periods)
	 */
	private isTimeWithinRange(checkTime: string, startTime: string, endTime: string): boolean {
		const check = this.timeToMinutes(checkTime);
		const start = this.timeToMinutes(startTime);
		const end = this.timeToMinutes(endTime);

		if (start <= end) {
			// Same day range (e.g., 09:00 - 17:00)
			return check >= start && check <= end;
		} else {
			// Overnight range (e.g., 22:00 - 06:00)
			return check >= start || check <= end;
		}
	}

	/**
	 * Convert time string to minutes since midnight
	 */
	private timeToMinutes(time: string): number {
		const [hours, minutes] = time.split(':').map(Number);
		return hours * 60 + minutes;
	}
}
