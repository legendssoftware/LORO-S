import { format, isValid } from 'date-fns';

/**
 * TimezoneUtil
 * 
 * Comprehensive utility for handling timezone conversions in attendance reporting.
 * Ensures reports are sent at correct local times for each organization.
 */
export class TimezoneUtil {
  // Common timezone fallbacks
  static readonly DEFAULT_TIMEZONE = 'UTC';
  static readonly AFRICA_JOHANNESBURG = 'Africa/Johannesburg'; // CAT
  
  // Valid timezone list (can be expanded)
  static readonly VALID_TIMEZONES = [
    'UTC',
    'Africa/Johannesburg', // South Africa (CAT)
    'Europe/London', // UK (GMT/BST)
    'America/New_York', // US East (EST/EDT)
    'America/Los_Angeles', // US West (PST/PDT)
    'Asia/Dubai', // UAE (GST)
    'Australia/Sydney', // Australia (AEDT/AEST)
    'Africa/Cairo', // Egypt (EET)
    'Africa/Lagos', // Nigeria (WAT)
    'Africa/Nairobi', // Kenya (EAT)
  ];

  /**
   * Validate if a timezone string is valid
   */
  static isValidTimezone(timezone: string): boolean {
    if (!timezone || typeof timezone !== 'string') {
      return false;
    }

    try {
      // Test if we can create a date formatter in this timezone
      new Intl.DateTimeFormat('en-ZA', { timeZone: timezone });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get a safe timezone with fallback
   */
  static getSafeTimezone(timezone?: string): string {
    if (timezone && this.isValidTimezone(timezone)) {
      return timezone;
    }
    
    // Fallback to CAT for African businesses, UTC otherwise
    return this.AFRICA_JOHANNESBURG;
  }

  /**
   * Convert server time (UTC/stored time) to organization timezone for display
   * This adds the timezone offset so that stored times display correctly in local time
   */
  static toOrganizationTime(serverDate: Date, organizationTimezone?: string): Date {
    const safeTimezone = this.getSafeTimezone(organizationTimezone);
    
    try {
      if (!isValid(serverDate)) {
        return new Date();
      }

      // Format the date in the target timezone to get the local representation
      const formatter = new Intl.DateTimeFormat('en-ZA', {
        timeZone: safeTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      const parts = formatter.formatToParts(serverDate);
      const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00';

      // Build a new Date representing what the time "looks like" in the target timezone
      const year = parseInt(getPart('year'), 10);
      const month = parseInt(getPart('month'), 10) - 1; // JS months are 0-indexed
      const day = parseInt(getPart('day'), 10);
      const hour = parseInt(getPart('hour'), 10);
      const minute = parseInt(getPart('minute'), 10);
      const second = parseInt(getPart('second'), 10);

      return new Date(year, month, day, hour, minute, second);
    } catch (error) {
      // Fallback: return original date if conversion fails
      return serverDate;
    }
  }

  /**
   * Convert organization time to server time
   */
  static fromOrganizationTime(orgDate: Date, organizationTimezone?: string): Date {
    const safeTimezone = this.getSafeTimezone(organizationTimezone);
    
    try {
      // Create a date string in the organization timezone
      const orgDateString = `${orgDate.getFullYear()}-${String(orgDate.getMonth() + 1).padStart(2, '0')}-${String(orgDate.getDate()).padStart(2, '0')}T${String(orgDate.getHours()).padStart(2, '0')}:${String(orgDate.getMinutes()).padStart(2, '0')}:${String(orgDate.getSeconds()).padStart(2, '0')}`;
      
      // Parse this as if it's in the organization timezone
      const tempDate = new Date(orgDateString);
      const orgFormatter = new Intl.DateTimeFormat('en-ZA', {
        timeZone: safeTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const utcFormatter = new Intl.DateTimeFormat('en-ZA', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const orgTime = orgFormatter.format(tempDate);
      const utcTime = utcFormatter.format(tempDate);
      
      // Calculate the offset and adjust
      const orgMs = new Date(orgTime).getTime();
      const utcMs = new Date(utcTime).getTime();
      const offset = orgMs - utcMs;
      
      return new Date(tempDate.getTime() - offset);
    } catch (error) {
      return orgDate; // Fallback to original date
    }
  }

  /**
   * Get current time in organization timezone
   */
  static getCurrentOrganizationTime(organizationTimezone?: string): Date {
    const now = new Date();
    return this.toOrganizationTime(now, organizationTimezone);
  }

  /**
   * Format time in organization timezone for display
   */
  static formatInOrganizationTime(
    date: Date, 
    formatString: string, 
    organizationTimezone?: string
  ): string {
    const safeTimezone = this.getSafeTimezone(organizationTimezone);
    
    try {
      if (!isValid(date)) {
        return format(new Date(), formatString);
      }

      // Convert to organization timezone first
      const orgDate = this.toOrganizationTime(date, safeTimezone);
      
      // Format the converted date
      return format(orgDate, formatString);
    } catch (error) {
      return format(date, formatString);
    }
  }

  /**
   * Check if two times are within specified minutes of each other in organization timezone
   */
  static isWithinMinutes(
    time1: Date, 
    time2: Date, 
    withinMinutes: number,
    organizationTimezone?: string
  ): boolean {
    const orgTime1 = this.toOrganizationTime(time1, organizationTimezone);
    const orgTime2 = this.toOrganizationTime(time2, organizationTimezone);
    
    const diffMs = Math.abs(orgTime1.getTime() - orgTime2.getTime());
    const diffMinutes = diffMs / (1000 * 60);
    
    return diffMinutes <= withinMinutes;
  }

  /**
   * Parse time string in organization timezone
   */
  static parseTimeInOrganization(
    timeString: string, 
    baseDate: Date, 
    organizationTimezone?: string
  ): Date {
    const safeTimezone = this.getSafeTimezone(organizationTimezone);
    
    try {
      // Extract hours, minutes, and optional seconds from time string
      // Support both HH:mm and HH:mm:ss formats
      const timeMatch = timeString.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (!timeMatch) {
        throw new Error(`Invalid time format: ${timeString}`);
      }
      
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      
      // Validate time components
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
        throw new Error(`Invalid time values: ${timeString}`);
      }
      
      // Create date in organization timezone
      const orgDate = this.toOrganizationTime(baseDate, organizationTimezone);
      orgDate.setHours(hours, minutes, seconds, 0);
      
      return orgDate;
    } catch (error) {
      // Fallback: parse in server timezone
      const fallbackDate = new Date(baseDate);
      const timeMatch = timeString.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        
        // Only set if values are valid
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
          fallbackDate.setHours(hours, minutes, seconds, 0);
        }
      }
      return fallbackDate;
    }
  }

  /**
   * Get minutes since midnight in organization timezone
   */
  static getMinutesSinceMidnight(date: Date, organizationTimezone?: string): number {
    const orgDate = this.toOrganizationTime(date, organizationTimezone);
    return orgDate.getHours() * 60 + orgDate.getMinutes();
  }

  /**
   * Add minutes to time in organization timezone
   */
  static addMinutesInOrganizationTime(
    date: Date, 
    minutes: number, 
    organizationTimezone?: string
  ): Date {
    const orgDate = this.toOrganizationTime(date, organizationTimezone);
    orgDate.setMinutes(orgDate.getMinutes() + minutes);
    return orgDate;
  }

  /**
   * Check if current time is within report sending window for organization
   */
  static isWithinReportWindow(
    organizationStartTime: string,
    organizationEndTime: string,
    offsetMinutes: number,
    windowMinutes: number,
    organizationTimezone?: string,
    currentTime?: Date
  ): {
    isTimeForMorningReport: boolean;
    isTimeForEveningReport: boolean;
    organizationCurrentTime: Date;
    morningReportTime: Date;
    eveningReportTime: Date;
  } {
    const now = currentTime || new Date();
    const orgCurrentTime = this.toOrganizationTime(now, organizationTimezone);
    
    // Parse organization times in their timezone
    const morningReportTime = this.parseTimeInOrganization(organizationStartTime, orgCurrentTime, organizationTimezone);
    morningReportTime.setMinutes(morningReportTime.getMinutes() + offsetMinutes);
    
    const eveningReportTime = this.parseTimeInOrganization(organizationEndTime, orgCurrentTime, organizationTimezone);
    eveningReportTime.setMinutes(eveningReportTime.getMinutes() + offsetMinutes);
    
    // Check if we're within the window for each report
    const isTimeForMorningReport = this.isWithinMinutes(
      orgCurrentTime, 
      morningReportTime, 
      windowMinutes, 
      organizationTimezone
    );
    
    const isTimeForEveningReport = this.isWithinMinutes(
      orgCurrentTime, 
      eveningReportTime, 
      windowMinutes, 
      organizationTimezone
    );
    
    return {
      isTimeForMorningReport,
      isTimeForEveningReport,
      organizationCurrentTime: orgCurrentTime,
      morningReportTime,
      eveningReportTime,
    };
  }

  /**
   * Get organization timezone from organization hours or fallback
   */
  static getOrganizationTimezone(orgHours?: { timezone?: string }): string {
    return this.getSafeTimezone(orgHours?.timezone);
  }

  /**
   * Debug helper: Log timezone conversion information
   */
  static logTimezoneInfo(
    serverTime: Date, 
    organizationTimezone?: string, 
    label: string = 'Timezone Conversion'
  ): void {
    // Logging removed - method kept for API compatibility
  }
} 