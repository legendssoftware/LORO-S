import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganisationHours } from '../../organisation/entities/organisation-hours.entity';
import { TimezoneUtil } from '../utils/timezone.util';

export interface OrganizationTimezoneInfo {
	timezone: string;
	openTime: string;
	closeTime: string;
	isWorkingDay: boolean;
	workingDayInfo?: {
		startTime: string;
		endTime: string;
	};
}

export interface TimezoneConversionResult {
	originalTime: Date;
	convertedTime: Date;
	timezone: string;
	formattedTime: string;
	formattedDate: string;
}

/**
 * OrganizationTimezoneService
 *
 * Service for handling timezone conversions based on organization settings.
 * Integrates with OrganizationHours entity to provide accurate timezone conversions
 * for attendance data and reporting.
 */
@Injectable()
export class OrganizationTimezoneService {
	private readonly logger = new Logger(OrganizationTimezoneService.name);

	constructor(
		@InjectRepository(OrganisationHours)
		private readonly organizationHoursRepository: Repository<OrganisationHours>,
	) {}

	/**
	 * Get organization timezone information
	 */
	async getOrganizationTimezoneInfo(organizationId: number): Promise<OrganizationTimezoneInfo> {
		try {
			this.logger.debug(`Getting timezone info for organization: ${organizationId}`);

			const orgHours = await this.organizationHoursRepository.findOne({
				where: {
					organisationUid: organizationId,
					isDeleted: false,
				},
				relations: ['organisation'],
			});

			if (!orgHours) {
				this.logger.warn(`No organization hours found for organization: ${organizationId}, using defaults`);
				return this.getDefaultTimezoneInfo();
			}

			const timezone = TimezoneUtil.getOrganizationTimezone(orgHours);
			const isWorkingDay = await this.isWorkingDay(orgHours);

			const result: OrganizationTimezoneInfo = {
				timezone,
				openTime: orgHours.openTime,
				closeTime: orgHours.closeTime,
				isWorkingDay,
				workingDayInfo: isWorkingDay
					? {
							startTime: orgHours.openTime,
							endTime: orgHours.closeTime,
					  }
					: undefined,
			};

			this.logger.debug(`Retrieved timezone info for org ${organizationId}`);
			return result;
		} catch (error) {
			this.logger.error(`Error getting timezone info for organization ${organizationId}:`, error);
			return this.getDefaultTimezoneInfo();
		}
	}

	/**
	 * Convert server time to organization timezone
	 */
	async convertToOrganizationTime(serverTime: Date, organizationId: number): Promise<TimezoneConversionResult> {
		try {
			this.logger.debug(`Converting time for org ${organizationId}: ${serverTime.toISOString()}`);
			const timezoneInfo = await this.getOrganizationTimezoneInfo(organizationId);
			this.logger.debug(`Using timezone: ${timezoneInfo.timezone} for org ${organizationId}`);

			const convertedTime = TimezoneUtil.toOrganizationTime(serverTime, timezoneInfo.timezone);
			this.logger.debug(`Converted time: ${convertedTime.toISOString()} (diff: ${convertedTime.getTime() - serverTime.getTime()}ms)`);

			return {
				originalTime: serverTime,
				convertedTime,
				timezone: timezoneInfo.timezone,
				formattedTime: TimezoneUtil.formatInOrganizationTime(serverTime, 'HH:mm:ss', timezoneInfo.timezone),
				formattedDate: TimezoneUtil.formatInOrganizationTime(serverTime, 'yyyy-MM-dd', timezoneInfo.timezone),
			};
		} catch (error) {
			this.logger.error(`Error converting time for organization ${organizationId}:`, error);
			// Fallback to original time
			return {
				originalTime: serverTime,
				convertedTime: serverTime,
				timezone: 'UTC',
				formattedTime: serverTime.toTimeString().slice(0, 8),
				formattedDate: serverTime.toISOString().split('T')[0],
			};
		}
	}

	/**
	 * Convert multiple server times to organization timezone
	 */
	async convertMultipleToOrganizationTime(
		serverTimes: Date[],
		organizationId: number,
	): Promise<TimezoneConversionResult[]> {
		const results: TimezoneConversionResult[] = [];

		for (const serverTime of serverTimes) {
			const result = await this.convertToOrganizationTime(serverTime, organizationId);
			results.push(result);
		}

		return results;
	}

	/**
	 * Convert server time from organization timezone to UTC
	 */
	async convertFromOrganizationTime(orgTime: Date, organizationId: number): Promise<TimezoneConversionResult> {
		try {
			this.logger.debug(`Converting FROM org time for org ${organizationId}: ${orgTime.toISOString()}`);
			const timezoneInfo = await this.getOrganizationTimezoneInfo(organizationId);
			this.logger.debug(`Using timezone: ${timezoneInfo.timezone} for conversion FROM org time`);

			const convertedTime = TimezoneUtil.fromOrganizationTime(orgTime, timezoneInfo.timezone);
			this.logger.debug(`Converted FROM org time: ${convertedTime.toISOString()} (diff: ${convertedTime.getTime() - orgTime.getTime()}ms)`);

			return {
				originalTime: orgTime,
				convertedTime,
				timezone: timezoneInfo.timezone,
				formattedTime: orgTime.toTimeString().slice(0, 8),
				formattedDate: orgTime.toISOString().split('T')[0],
			};
		} catch (error) {
			this.logger.error(`Error converting from organization time for org ${organizationId}:`, error);
			return {
				originalTime: orgTime,
				convertedTime: orgTime,
				timezone: 'UTC',
				formattedTime: orgTime.toTimeString().slice(0, 8),
				formattedDate: orgTime.toISOString().split('T')[0],
			};
		}
	}

	/**
	 * Get current time in organization timezone
	 */
	async getCurrentOrganizationTime(organizationId: number): Promise<TimezoneConversionResult> {
		const now = new Date();
		return this.convertToOrganizationTime(now, organizationId);
	}

	/**
	 * Format time in organization timezone
	 */
	async formatTimeInOrganization(time: Date, formatPattern: string, organizationId: number): Promise<string> {
		try {
			const timezoneInfo = await this.getOrganizationTimezoneInfo(organizationId);
			return TimezoneUtil.formatInOrganizationTime(time, formatPattern, timezoneInfo.timezone);
		} catch (error) {
			this.logger.error(`Error formatting time for organization ${organizationId}:`, error);
			return time.toISOString();
		}
	}

	/**
	 * Check if current time is within organization working hours
	 */
	async isWithinWorkingHours(organizationId: number, currentTime?: Date): Promise<boolean> {
		try {
			const timezoneInfo = await this.getOrganizationTimezoneInfo(organizationId);

			if (!timezoneInfo.isWorkingDay || !timezoneInfo.workingDayInfo) {
				return false;
			}

			const now = currentTime || new Date();
			const orgTime = TimezoneUtil.toOrganizationTime(now, timezoneInfo.timezone);

			const currentMinutes = TimezoneUtil.getMinutesSinceMidnight(orgTime, timezoneInfo.timezone);
			const startMinutes = this.timeToMinutes(timezoneInfo.workingDayInfo.startTime);
			const endMinutes = this.timeToMinutes(timezoneInfo.workingDayInfo.endTime);

			return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
		} catch (error) {
			this.logger.error(`Error checking working hours for organization ${organizationId}:`, error);
			return false;
		}
	}

	/**
	 * Helper method to check if today is a working day
	 */
	private async isWorkingDay(orgHours: OrganisationHours): Promise<boolean> {
		try {
			const now = new Date();
			const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

			// Check if holiday mode is active
			if (orgHours.holidayMode && orgHours.holidayUntil) {
				if (now <= orgHours.holidayUntil) {
					return false;
				}
			}

			// Check weekly schedule
			if (orgHours.weeklySchedule && orgHours.weeklySchedule[dayOfWeek] === false) {
				return false;
			}

			// Check detailed schedule if available
			if (orgHours.schedule) {
				const daySchedule = orgHours.schedule[dayOfWeek];
				if (daySchedule && daySchedule.closed) {
					return false;
				}
			}

			return true;
		} catch (error) {
			this.logger.error('Error checking if today is working day:', error);
			return false; // Default to non-working day on error
		}
	}

	/**
	 * Convert time string (HH:mm) to minutes since midnight
	 */
	private timeToMinutes(timeString: string): number {
		const [hours, minutes] = timeString.split(':').map(Number);
		return hours * 60 + minutes;
	}

	/**
	 * Get default timezone info when organization hours not found
	 */
	private getDefaultTimezoneInfo(): OrganizationTimezoneInfo {
		return {
			timezone: TimezoneUtil.DEFAULT_TIMEZONE,
			openTime: '09:00:00',
			closeTime: '17:00:00',
			isWorkingDay: true,
			workingDayInfo: {
				startTime: '09:00:00',
				endTime: '17:00:00',
			},
		};
	}

	/**
	 * Log timezone conversion for debugging
	 */
	async logTimezoneConversion(
		serverTime: Date,
		organizationId: number,
		label: string = 'Timezone Conversion',
	): Promise<void> {
		try {
			const timezoneInfo = await this.getOrganizationTimezoneInfo(organizationId);
			TimezoneUtil.logTimezoneInfo(serverTime, timezoneInfo.timezone, label);
		} catch (error) {
			this.logger.error(`Error logging timezone conversion for org ${organizationId}:`, error);
		}
	}
}
