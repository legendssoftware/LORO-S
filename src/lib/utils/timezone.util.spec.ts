import { TimezoneUtil } from './timezone.util';

describe('TimezoneUtil', () => {
  describe('isValidTimezone', () => {
    it('should validate correct timezones', () => {
      expect(TimezoneUtil.isValidTimezone('Africa/Johannesburg')).toBe(true);
      expect(TimezoneUtil.isValidTimezone('UTC')).toBe(true);
      expect(TimezoneUtil.isValidTimezone('America/New_York')).toBe(true);
    });

    it('should reject invalid timezones', () => {
      expect(TimezoneUtil.isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(TimezoneUtil.isValidTimezone('')).toBe(false);
      expect(TimezoneUtil.isValidTimezone(null as any)).toBe(false);
    });
  });

  describe('getSafeTimezone', () => {
    it('should return valid timezone when provided', () => {
      expect(TimezoneUtil.getSafeTimezone('UTC')).toBe('UTC');
      expect(TimezoneUtil.getSafeTimezone('Africa/Johannesburg')).toBe('Africa/Johannesburg');
    });

    it('should fallback to CAT for invalid timezones', () => {
      expect(TimezoneUtil.getSafeTimezone('Invalid/Timezone')).toBe('Africa/Johannesburg');
      expect(TimezoneUtil.getSafeTimezone(undefined)).toBe('Africa/Johannesburg');
    });
  });

  describe('timezone conversions', () => {
    it('should convert between server and organization time', () => {
      const serverTime = new Date('2024-01-15T14:00:00Z'); // 2 PM UTC
      
      // Convert to CAT (UTC+2)
      const catTime = TimezoneUtil.toOrganizationTime(serverTime, 'Africa/Johannesburg');
      expect(catTime.getHours()).toBe(16); // Should be 4 PM in CAT
      
      // Convert back to server time
      const backToServer = TimezoneUtil.fromOrganizationTime(catTime, 'Africa/Johannesburg');
      expect(Math.abs(backToServer.getTime() - serverTime.getTime())).toBeLessThan(60000); // Within 1 minute
    });
  });

  describe('isWithinReportWindow', () => {
    it('should correctly identify morning report window', () => {
      // Business opens at 7:30 AM CAT, report should be sent at 8:00 AM CAT
      const testTime = new Date('2024-01-15T06:00:00Z'); // 8:00 AM CAT (UTC+2)
      
      const result = TimezoneUtil.isWithinReportWindow(
        '07:30', // start time
        '17:00', // end time
        30,      // 30 minutes after start
        10,      // 10-minute window
        'Africa/Johannesburg',
        testTime
      );
      
      expect(result.isTimeForMorningReport).toBe(true);
      expect(result.isTimeForEveningReport).toBe(false);
    });

    it('should correctly identify evening report window', () => {
      // Business closes at 5:00 PM CAT, report should be sent at 5:30 PM CAT
      const testTime = new Date('2024-01-15T15:30:00Z'); // 5:30 PM CAT (UTC+2)
      
      const result = TimezoneUtil.isWithinReportWindow(
        '07:30', // start time
        '17:00', // end time
        30,      // 30 minutes after end
        10,      // 10-minute window
        'Africa/Johannesburg',
        testTime
      );
      
      expect(result.isTimeForMorningReport).toBe(false);
      expect(result.isTimeForEveningReport).toBe(true);
    });

    it('should handle different timezones correctly', () => {
      // Test with EST (UTC-5)
      const testTime = new Date('2024-01-15T13:00:00Z'); // 8:00 AM EST
      
      const result = TimezoneUtil.isWithinReportWindow(
        '07:30', // start time
        '17:00', // end time
        30,      // 30 minutes after start
        10,      // 10-minute window
        'America/New_York',
        testTime
      );
      
      expect(result.isTimeForMorningReport).toBe(true);
    });
  });

  describe('formatInOrganizationTime', () => {
    it('should format time in organization timezone', () => {
      const testTime = new Date('2024-01-15T14:00:00Z'); // 2 PM UTC
      
      const formatted = TimezoneUtil.formatInOrganizationTime(
        testTime,
        'HH:mm',
        'Africa/Johannesburg'
      );
      
      expect(formatted).toBe('16:00'); // 4 PM in CAT
    });
  });

  describe('getCurrentOrganizationTime', () => {
    it('should return current time in organization timezone', () => {
      const orgTime = TimezoneUtil.getCurrentOrganizationTime('Africa/Johannesburg');
      expect(orgTime).toBeInstanceOf(Date);
      expect(orgTime.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 60 * 60 * 1000); // Within 2 hours of now
    });
  });

  describe('edge cases', () => {
    it('should handle daylight saving time transitions', () => {
      // Test during DST transition (this is a basic test, real DST handling is complex)
      const dstTime = new Date('2024-03-10T07:00:00Z'); // Around DST transition
      
      const result = TimezoneUtil.toOrganizationTime(dstTime, 'America/New_York');
      expect(result).toBeInstanceOf(Date);
    });

    it('should handle invalid dates gracefully', () => {
      const invalidDate = new Date('invalid');
      
      const result = TimezoneUtil.toOrganizationTime(invalidDate, 'Africa/Johannesburg');
      expect(result).toBeInstanceOf(Date);
    });
  });
});

// Integration test helper
export const testTimezoneScenarios = () => {
  console.log('=== Timezone Utility Test Scenarios ===\n');
  
  // Scenario 1: South African business (CAT)
  console.log('Scenario 1: South African Business (CAT - UTC+2)');
  console.log('Business hours: 7:30 AM - 5:00 PM CAT');
  console.log('Morning report: 8:00 AM CAT (30min after opening)');
  console.log('Evening report: 5:30 PM CAT (30min after closing)\n');
  
  const catBusiness = {
    startTime: '07:30',
    endTime: '17:00',
    timezone: 'Africa/Johannesburg'
  };
  
  // Test morning report timing
  const morningTestUTC = new Date('2024-01-15T06:00:00Z'); // 8:00 AM CAT
  const morningWindow = TimezoneUtil.isWithinReportWindow(
    catBusiness.startTime,
    catBusiness.endTime,
    30, 10,
    catBusiness.timezone,
    morningTestUTC
  );
  
  console.log(`Morning test (UTC): ${morningTestUTC.toISOString()}`);
  console.log(`Organization time: ${TimezoneUtil.formatInOrganizationTime(morningTestUTC, 'HH:mm zzz', catBusiness.timezone)}`);
  console.log(`Should send morning report: ${morningWindow.isTimeForMorningReport}`);
  console.log(`Should send evening report: ${morningWindow.isTimeForEveningReport}\n`);
  
  // Test evening report timing
  const eveningTestUTC = new Date('2024-01-15T15:30:00Z'); // 5:30 PM CAT
  const eveningWindow = TimezoneUtil.isWithinReportWindow(
    catBusiness.startTime,
    catBusiness.endTime,
    30, 10,
    catBusiness.timezone,
    eveningTestUTC
  );
  
  console.log(`Evening test (UTC): ${eveningTestUTC.toISOString()}`);
  console.log(`Organization time: ${TimezoneUtil.formatInOrganizationTime(eveningTestUTC, 'HH:mm zzz', catBusiness.timezone)}`);
  console.log(`Should send morning report: ${eveningWindow.isTimeForMorningReport}`);
  console.log(`Should send evening report: ${eveningWindow.isTimeForEveningReport}\n`);
  
  // Scenario 2: US East Coast business (EST/EDT)
  console.log('Scenario 2: US East Coast Business (EST - UTC-5)');
  const estBusiness = {
    startTime: '09:00',
    endTime: '17:00',
    timezone: 'America/New_York'
  };
  
  const estMorningTestUTC = new Date('2024-01-15T14:30:00Z'); // 9:30 AM EST
  const estMorningWindow = TimezoneUtil.isWithinReportWindow(
    estBusiness.startTime,
    estBusiness.endTime,
    30, 10,
    estBusiness.timezone,
    estMorningTestUTC
  );
  
  console.log(`EST Morning test (UTC): ${estMorningTestUTC.toISOString()}`);
  console.log(`Organization time: ${TimezoneUtil.formatInOrganizationTime(estMorningTestUTC, 'HH:mm zzz', estBusiness.timezone)}`);
  console.log(`Should send morning report: ${estMorningWindow.isTimeForMorningReport}\n`);
  
  console.log('=== Test Complete ===');
}; 