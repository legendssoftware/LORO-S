import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO, format } from 'date-fns';
import { Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';

export interface DateRanges {
	today: { start: Date; end: Date };
	week: { start: Date; end: Date };
	month: { start: Date; end: Date };
	year: { start: Date; end: Date };
}

export interface DateFilters {
	today: any;
	week: any;
	month: any;
	dateRange: any;
}

export class DateRangeUtil {
	private static cache = new Map<string, DateRanges>();
	private static cacheExpiry = 60 * 60 * 1000; // 1 hour in milliseconds

	/**
	 * Get optimized date ranges with caching
	 */
	static getDateRanges(date: Date = new Date()): DateRanges {
		const cacheKey = format(date, 'yyyy-MM-dd');
		const cached = this.cache.get(cacheKey);

		if (cached) {
			return cached;
		}

		const ranges: DateRanges = {
			today: {
				start: startOfDay(date),
				end: endOfDay(date),
			},
			week: {
				start: startOfWeek(date, { weekStartsOn: 1 }), // Monday start
				end: endOfWeek(date, { weekStartsOn: 1 }),
			},
			month: {
				start: startOfMonth(date),
				end: endOfMonth(date),
			},
			year: {
				start: new Date(date.getFullYear(), 0, 1),
				end: new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999),
			},
		};

		// Cache with expiry
		this.cache.set(cacheKey, ranges);
		setTimeout(() => this.cache.delete(cacheKey), this.cacheExpiry);

		return ranges;
	}

	/**
	 * Create standardized TypeORM date filters
	 */
	static createDateFilters(fromDate?: string, toDate?: string): DateFilters {
		const ranges = this.getDateRanges();

		const dateRange =
			fromDate && toDate ? Between(startOfDay(parseISO(fromDate)), endOfDay(parseISO(toDate))) : null;

		return {
			today: Between(ranges.today.start, ranges.today.end),
			week: Between(ranges.week.start, ranges.week.end),
			month: Between(ranges.month.start, ranges.month.end),
			dateRange,
		};
	}

	/**
	 * Get specific date range filter
	 */
	static getDateFilter(period: 'today' | 'week' | 'month' | 'year', date?: Date) {
		const ranges = this.getDateRanges(date);
		const range = ranges[period];
		return Between(range.start, range.end);
	}

	/**
	 * Create date range for queries with start and end dates
	 */
	static createDateRangeFilter(startDate: Date, endDate: Date) {
		return Between(startOfDay(startDate), endOfDay(endDate));
	}

	/**
	 * Get attendance query filters optimized for different periods
	 */
	static getAttendanceFilters(
		period: 'today' | 'week' | 'month' | 'year' | 'custom',
		customRange?: { from: string; to: string },
	) {
		if (period === 'custom' && customRange) {
			return {
				checkIn: this.createDateRangeFilter(parseISO(customRange.from), parseISO(customRange.to)),
			};
		}

		if (period === 'custom') {
			throw new Error('Custom range requires from and to dates');
		}

		return {
			checkIn: this.getDateFilter(period as 'today' | 'week' | 'month' | 'year'),
		};
	}

	/**
	 * Clear cache manually if needed
	 */
	static clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Validate date range inputs
	 */
	static validateDateRange(fromDate?: string, toDate?: string): { isValid: boolean; error?: string } {
		if (!fromDate || !toDate) {
			return { isValid: true }; // Optional dates are valid
		}

		try {
			const from = parseISO(fromDate);
			const to = parseISO(toDate);

			if (isNaN(from.getTime()) || isNaN(to.getTime())) {
				return { isValid: false, error: 'Invalid date format. Please use YYYY-MM-DD format.' };
			}

			if (from > to) {
				return { isValid: false, error: 'Start date cannot be after end date.' };
			}

			return { isValid: true };
		} catch (error) {
			return { isValid: false, error: 'Invalid date format. Please use YYYY-MM-DD format.' };
		}
	}

	/**
	 * Calculate working days between dates (excluding weekends)
	 */
	static calculateWorkingDays(startDate: Date, endDate: Date): number {
		let count = 0;
		const current = new Date(startDate);

		while (current <= endDate) {
			const dayOfWeek = current.getDay();
			if (dayOfWeek !== 0 && dayOfWeek !== 6) {
				// Not Sunday (0) or Saturday (6)
				count++;
			}
			current.setDate(current.getDate() + 1);
		}

		return count;
	}

	/**
	 * Get date boundaries for database queries
	 */
	static getQueryBoundaries(date: Date) {
		return {
			startOfDay: startOfDay(date),
			endOfDay: endOfDay(date),
			startOfWeek: startOfWeek(date, { weekStartsOn: 1 }),
			endOfWeek: endOfWeek(date, { weekStartsOn: 1 }),
			startOfMonth: startOfMonth(date),
			endOfMonth: endOfMonth(date),
		};
	}
}
