import { differenceInMinutes, differenceInMilliseconds, parseISO, format } from 'date-fns';
import { BreakDetail } from '../interfaces/break-detail.interface';
import { OrganisationHours } from '../../organisation/entities/organisation-hours.entity';

export interface WorkSession {
  totalMinutes: number;
  breakMinutes: number;
  netWorkMinutes: number;
  netWorkHours: number;
  isOvertime: boolean;
  overtimeMinutes: number;
}

export interface PunctualityInfo {
  isLate: boolean;
  isEarly: boolean;
  lateMinutes: number;
  earlyMinutes: number;
  graceMinutes: number;
}

export interface ShiftSegment {
  date: string; // YYYY-MM-DD format
  startTime: Date;
  endTime: Date;
  workMinutes: number;
  breakMinutes: number;
  netWorkMinutes: number;
}

export interface SplitShiftResult {
  segments: ShiftSegment[];
  totalDays: number;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  isMultiDay: boolean;
}

export class TimeCalculatorUtil {
  // Precision constants for different use cases
  static readonly PRECISION = {
    HOURS: 2,           // For HR reports: 8.25 hours
    MINUTES: 0,         // For time tracking: 495 minutes  
    CURRENCY: 4,        // For payroll precision: 8.2500 hours
    PERCENTAGE: 1,      // For efficiency scores: 87.5%
    DISPLAY: 1          // For UI display: 8.3 hours
  };

  // Default work constants (fallback when org hours not available)
  static readonly DEFAULT_WORK = {
    STANDARD_HOURS: 8,
    STANDARD_MINUTES: 480,
    PUNCTUALITY_GRACE_MINUTES: 15,
    START_TIME: '09:00',
    END_TIME: '17:00'
  };

  /**
   * Calculate precise work session with organization-aware break handling
   */
  static calculateWorkSession(
    checkIn: Date,
    checkOut: Date,
    breakDetails?: BreakDetail[],
    totalBreakTime?: string,
    orgHours?: OrganisationHours
  ): WorkSession {
    const totalMinutes = differenceInMinutes(checkOut, checkIn);
    const breakMinutes = this.calculateTotalBreakMinutes(breakDetails, totalBreakTime);
    const netWorkMinutes = Math.max(0, totalMinutes - breakMinutes);
    const netWorkHours = this.roundToHours(netWorkMinutes / 60, this.PRECISION.CURRENCY);
    
    const standardWorkMinutes = this.getStandardWorkMinutes(orgHours);
    const isOvertime = netWorkMinutes > standardWorkMinutes;
    const overtimeMinutes = Math.max(0, netWorkMinutes - standardWorkMinutes);

    return {
      totalMinutes,
      breakMinutes,
      netWorkMinutes,
      netWorkHours,
      isOvertime,
      overtimeMinutes
    };
  }

  /**
   * Calculate break time with multiple format support and precision
   */
  static calculateTotalBreakMinutes(breakDetails?: BreakDetail[], totalBreakTime?: string): number {
    // Prefer breakDetails for accuracy
    if (breakDetails && breakDetails.length > 0) {
      return breakDetails.reduce((total, breakItem) => {
        try {
          // Check if both startTime and endTime exist and are not null
          if (!breakItem.startTime || !breakItem.endTime) {
            return total;
          }

          // Convert to Date objects if they aren't already
          const startDate = breakItem.startTime instanceof Date 
            ? breakItem.startTime 
            : new Date(breakItem.startTime);
          const endDate = breakItem.endTime instanceof Date 
            ? breakItem.endTime 
            : new Date(breakItem.endTime);

          // Validate that dates are valid
          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return total;
          }

          // Calculate break duration
          const breakMs = differenceInMilliseconds(endDate, startDate);
          
          // Only add positive break durations (endTime should be after startTime)
          if (breakMs > 0) {
            return total + Math.round(breakMs / 60000); // Convert ms to minutes
          }
          
          return total;
        } catch (error) {
          // If any error occurs, skip this break item and continue
          return total;
        }
      }, 0);
    }

    // Fallback to totalBreakTime string parsing
    if (totalBreakTime) {
      return this.parseBreakTimeString(totalBreakTime);
    }

    return 0;
  }

  /**
   * Enhanced break time string parser with multiple format support
   */
  static parseBreakTimeString(breakTimeString: string): number {
    if (!breakTimeString) return 0;
    
    // Handle different formats
    const trimmed = breakTimeString.trim();
    
    // Format: "2h 30m" or "2 hours 30 minutes"
    const hourMinuteMatch = trimmed.match(/(\d+)h?\s*(\d+)m?/i);
    if (hourMinuteMatch) {
      const hours = parseInt(hourMinuteMatch[1], 10) || 0;
      const minutes = parseInt(hourMinuteMatch[2], 10) || 0;
      return hours * 60 + minutes;
    }

    // Format: "HH:MM:SS" or "HH:MM"
    const parts = trimmed.split(':');
    if (parts.length >= 2) {
      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      const seconds = parts.length > 2 ? parseInt(parts[2], 10) || 0 : 0;
      return hours * 60 + minutes + Math.round(seconds / 60);
    }

    // Format: just minutes "30"
    const minutesOnly = parseInt(trimmed, 10);
    if (!isNaN(minutesOnly)) {
      return minutesOnly;
    }

    return 0;
  }

  /**
   * Organization-aware punctuality calculation
   */
  static calculatePunctuality(
    checkInTime: Date,
    checkOutTime: Date | null,
    orgHours?: OrganisationHours
  ): PunctualityInfo {
    const dayOfWeek = this.getDayOfWeek(checkInTime);
    const workingHours = this.getWorkingHoursForDay(orgHours, dayOfWeek);
    
    if (!workingHours.isWorkingDay) {
      return {
        isLate: false,
        isEarly: false,
        lateMinutes: 0,
        earlyMinutes: 0,
        graceMinutes: this.DEFAULT_WORK.PUNCTUALITY_GRACE_MINUTES
      };
    }

    const checkInMinutes = this.timeToMinutes(format(checkInTime, 'HH:mm'));
    const expectedStartMinutes = this.timeToMinutes(workingHours.startTime);
    const graceMinutes = this.DEFAULT_WORK.PUNCTUALITY_GRACE_MINUTES;

    const isLate = checkInMinutes > (expectedStartMinutes + graceMinutes);
    const lateMinutes = isLate ? checkInMinutes - expectedStartMinutes : 0;

    let isEarly = false;
    let earlyMinutes = 0;

    if (checkOutTime && workingHours.endTime) {
      const checkOutMinutes = this.timeToMinutes(format(checkOutTime, 'HH:mm'));
      const expectedEndMinutes = this.timeToMinutes(workingHours.endTime);
      
      isEarly = checkOutMinutes < expectedEndMinutes;
      earlyMinutes = isEarly ? expectedEndMinutes - checkOutMinutes : 0;
    }

    return {
      isLate,
      isEarly,
      lateMinutes,
      earlyMinutes,
      graceMinutes
    };
  }

  /**
   * Get working hours for specific day with fallback
   */
  static getWorkingHoursForDay(orgHours?: OrganisationHours, dayOfWeek?: string) {
    if (!orgHours || !dayOfWeek) {
      return {
        isWorkingDay: true,
        startTime: this.DEFAULT_WORK.START_TIME,
        endTime: this.DEFAULT_WORK.END_TIME
      };
    }

    const schedule = orgHours.weeklySchedule;
    const isWorkingDay = schedule[dayOfWeek.toLowerCase() as keyof typeof schedule];

    return {
      isWorkingDay,
      startTime: isWorkingDay ? orgHours.openTime : null,
      endTime: isWorkingDay ? orgHours.closeTime : null
    };
  }

  /**
   * Get standard work minutes from organization settings
   */
  static getStandardWorkMinutes(orgHours?: OrganisationHours): number {
    if (!orgHours) {
      return this.DEFAULT_WORK.STANDARD_MINUTES;
    }

    const startMinutes = this.timeToMinutes(orgHours.openTime);
    const endMinutes = this.timeToMinutes(orgHours.closeTime);
    
    return Math.max(0, endMinutes - startMinutes);
  }

  /**
   * Precise rounding with configurable precision
   */
  static roundToHours(value: number, precision: number = this.PRECISION.HOURS): number {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  /**
   * Round minutes with appropriate precision
   */
  static roundMinutes(value: number): number {
    return Math.round(value);
  }

  /**
   * Calculate efficiency score with precision
   */
  static calculateEfficiency(workMinutes: number, totalMinutes: number): number {
    if (totalMinutes === 0) return 0;
    const efficiency = (workMinutes / totalMinutes) * 100;
    return this.roundToHours(efficiency, this.PRECISION.PERCENTAGE);
  }

  /**
   * Format duration for display (maintains existing format)
   */
  static formatDuration(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  /**
   * Convert time string to minutes since midnight
   */
  static timeToMinutes(timeString: string): number {
    if (!timeString) return 0;
    
    const [hours, minutes] = timeString.split(':').map(part => parseInt(part, 10) || 0);
    return hours * 60 + minutes;
  }

  /**
   * Get day of week string
   */
  static getDayOfWeek(date: Date): string {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
  }

  /**
   * Calculate average time with proper handling
   */
  static calculateAverageTime(times: Date[]): string {
    if (times.length === 0) return 'N/A';
    
    const totalMinutes = times.reduce((sum, time) => {
      return sum + (time.getHours() * 60) + time.getMinutes();
    }, 0);
    
    const avgMinutes = Math.round(totalMinutes / times.length);
    const avgHours = Math.floor(avgMinutes / 60);
    const remainingMinutes = avgMinutes % 60;
    
    return `${avgHours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}`;
  }

  /**
   * Convert minutes to hours with specified precision
   */
  static minutesToHours(minutes: number, precision: number = this.PRECISION.HOURS): number {
    return this.roundToHours(minutes / 60, precision);
  }

  /**
   * Calculate percentage with precision
   */
  static calculatePercentage(part: number, total: number, precision: number = this.PRECISION.PERCENTAGE): number {
    if (total === 0) return 0;
    return this.roundToHours((part / total) * 100, precision);
  }

  /**
   * Split a multi-day shift at midnight boundaries
   * This ensures proper attribution of hours to their respective calendar days
   */
  static splitMultiDayShift(
    checkIn: Date,
    checkOut: Date | null,
    breakDetails?: BreakDetail[],
    totalBreakTime?: string
  ): SplitShiftResult {
    const startTime = new Date(checkIn);
    const endTime = checkOut ? new Date(checkOut) : new Date();
    
    // Check if it's actually a multi-day shift
    const startDate = this.formatDate(startTime, 'YYYY-MM-DD');
    const endDate = this.formatDate(endTime, 'YYYY-MM-DD');
    const isMultiDay = startDate !== endDate;
    
    if (!isMultiDay) {
      // Single day shift - return as single segment
      const totalMinutes = differenceInMinutes(endTime, startTime);
      const breakMinutes = this.calculateTotalBreakMinutes(breakDetails, totalBreakTime);
      const netWorkMinutes = Math.max(0, totalMinutes - breakMinutes);
      
      return {
        segments: [{
          date: startDate,
          startTime,
          endTime,
          workMinutes: totalMinutes,
          breakMinutes,
          netWorkMinutes
        }],
        totalDays: 1,
        totalWorkMinutes: totalMinutes,
        totalBreakMinutes: breakMinutes,
        isMultiDay: false
      };
    }
    
    // Multi-day shift - split at midnight boundaries
    const segments: ShiftSegment[] = [];
    let currentDate = new Date(startTime);
    let remainingBreakMinutes = this.calculateTotalBreakMinutes(breakDetails, totalBreakTime);
    let totalWorkMinutes = 0;
    let totalBreakMinutes = 0;
    
    while (this.formatDate(currentDate, 'YYYY-MM-DD') <= endDate) {
      const dayStart = currentDate;
      const dayEnd = this.formatDate(currentDate, 'YYYY-MM-DD') === endDate 
        ? endTime 
        : this.endOfDay(currentDate);
      
      const dayMinutes = differenceInMinutes(dayEnd, dayStart);
      
      // Proportionally distribute breaks across days based on work time
      const totalShiftMinutes = differenceInMinutes(endTime, startTime);
      const dayBreakMinutes = totalShiftMinutes > 0 
        ? Math.round((dayMinutes / totalShiftMinutes) * remainingBreakMinutes)
        : 0;
      
      const netWorkMinutes = Math.max(0, dayMinutes - dayBreakMinutes);
      
      segments.push({
        date: this.formatDate(currentDate, 'YYYY-MM-DD'),
        startTime: dayStart,
        endTime: dayEnd,
        workMinutes: dayMinutes,
        breakMinutes: dayBreakMinutes,
        netWorkMinutes
      });
      
      totalWorkMinutes += dayMinutes;
      totalBreakMinutes += dayBreakMinutes;
      
      // Move to next day at midnight
      currentDate = this.addDays(this.startOfDay(currentDate), 1);
    }
    
    return {
      segments,
      totalDays: segments.length,
      totalWorkMinutes,
      totalBreakMinutes,
      isMultiDay: true
    };
  }

  /**
   * Get start of day (midnight)
   */
  private static startOfDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  /**
   * Get end of day (23:59:59.999)
   */
  private static endOfDay(date: Date): Date {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end;
  }

  /**
   * Add days to a date
   */
  private static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Format date to string
   */
  private static formatDate(date: Date, format: string): string {
    if (format === 'YYYY-MM-DD') {
      return date.toISOString().split('T')[0];
    }
    return date.toISOString();
  }
} 