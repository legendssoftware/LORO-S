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

	/**
	 * Convert date to organization timezone for JSON serialization
	 * Creates a Date object where the UTC timestamp represents the local time
	 * When serialized to JSON, this will show the organization timezone time
	 * 
	 * Example: If database has 06:57 UTC and timezone is GMT+2 (08:57 local),
	 * this creates a Date that serializes to "2025-01-26T08:57:00.000Z"
	 * instead of "2025-01-26T06:57:00.000Z"
	 */
	static toOrganizationTimeForSerialization(date: Date, timezone: string): Date {
		try {
			// Get local time components in organization timezone
			const zonedDate = toZonedTime(date, timezone);
			
			// Extract local time components
			const year = zonedDate.getFullYear();
			const month = zonedDate.getMonth();
			const day = zonedDate.getDate();
			const hours = zonedDate.getHours();
			const minutes = zonedDate.getMinutes();
			const seconds = zonedDate.getSeconds();
			const milliseconds = zonedDate.getMilliseconds();
			
			// Create Date object treating local time components as UTC
			// This ensures when serialized to JSON, it shows the organization timezone time
			return new Date(Date.UTC(year, month, day, hours, minutes, seconds, milliseconds));
		} catch (error) {
			// Fallback to original date if conversion fails
			return date;
		}
	}
}

