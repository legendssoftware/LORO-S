import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';

/**
 * Timezone utility class for handling timezone conversions
 */
export class TimezoneUtil {
	/**
	 * Get safe default timezone
	 */
	static getSafeTimezone(): string {
		return 'Africa/Johannesburg';
	}

	/**
	 * Format date in organization timezone
	 */
	static formatInOrganizationTime(date: Date, format: string, timezone: string): string {
		try {
			return formatInTimeZone(date, timezone, format);
		} catch (error) {
			// Fallback to ISO string if formatting fails
			return date.toISOString();
		}
	}

	/**
	 * Get current time in organization timezone
	 */
	static getCurrentOrganizationTime(timezone: string): Date {
		try {
			const now = new Date();
			return toZonedTime(now, timezone);
		} catch (error) {
			// Fallback to current time if conversion fails
			return new Date();
		}
	}

	/**
	 * Add minutes to a date in organization timezone
	 */
	static addMinutesInOrganizationTime(date: Date, minutes: number, timezone: string): Date {
		try {
			// Convert to organization timezone first
			const zonedDate = toZonedTime(date, timezone);
			// Add minutes
			const newDate = new Date(zonedDate);
			newDate.setMinutes(newDate.getMinutes() + minutes);
			// Convert back to UTC
			return fromZonedTime(newDate, timezone);
		} catch (error) {
			// Fallback: just add minutes to original date
			const newDate = new Date(date);
			newDate.setMinutes(newDate.getMinutes() + minutes);
			return newDate;
		}
	}

	/**
	 * Convert date to organization timezone
	 */
	static toOrganizationTime(date: Date, timezone: string): Date {
		try {
			return toZonedTime(date, timezone);
		} catch (error) {
			// Fallback to original date if conversion fails
			return date;
		}
	}
}

