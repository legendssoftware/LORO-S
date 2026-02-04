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
	 * Build a UTC Date from a reference date's calendar day in org timezone at a given time (HH:mm or HH:mm:ss).
	 * Use when setting close time to "same calendar day in org at 16:30" etc.
	 */
	static buildUtcFromOrgDateAndTime(date: Date, timezone: string, timeStr: string): Date {
		try {
			const dateStr = formatInTimeZone(date, timezone, 'yyyy-MM-dd');
			const [y, m, d] = dateStr.split('-').map(Number);
			const parts = timeStr.split(':').map(Number);
			const hours = parts[0] ?? 0;
			const minutes = parts[1] ?? 0;
			const seconds = parts[2] ?? 0;
			const localDate = new Date(y, m - 1, d, hours, minutes, seconds, 0);
			return fromZonedTime(localDate, timezone);
		} catch (error) {
			return date;
		}
	}

	/**
	 * Return whether two dates fall on the same calendar day in the given timezone.
	 */
	static isSameCalendarDayInOrgTimezone(date1: Date, date2: Date, timezone: string): boolean {
		try {
			const s1 = formatInTimeZone(date1, timezone, 'yyyy-MM-dd');
			const s2 = formatInTimeZone(date2, timezone, 'yyyy-MM-dd');
			return s1 === s2;
		} catch (error) {
			return false;
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

