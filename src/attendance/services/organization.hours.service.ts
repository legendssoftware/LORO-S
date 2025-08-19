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
		const schedule = orgHours.weeklySchedule;
		const isWorkingDay = schedule[dayOfWeek.toLowerCase() as keyof typeof schedule];

		if (!isWorkingDay) {
			return {
				isWorkingDay: false,
				startTime: null,
				endTime: null,
				expectedWorkMinutes: 0,
			};
		}

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
}
