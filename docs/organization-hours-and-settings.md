# Organization Hours & Settings Integration Guide

## 🏢 Overview

The Organization Hours and Settings system provides a comprehensive framework for managing business operations, working hours, and organizational policies. This system integrates deeply with the attendance reporting service to provide accurate, real-time operational insights.

## 📊 System Architecture

### Organization Entity Structure

```typescript
Organisation {
  uid: number                    // Unique identifier
  name: string                   // Organization name
  email: string                  // Primary contact email
  phone: string                  // Primary contact phone
  contactPerson: string          // Primary contact person
  website: string                // Organization website
  logo: string                   // Organization logo URL
  ref: string                    // Organization reference code
  
  // Relationships
  branches: Branch[]             // Organization branches
  settings: OrganisationSettings // Business configuration
  appearance: OrganisationAppearance // Branding & UI
  hours: OrganisationHours[]     // Working hours configuration
  assets: Asset[]                // Organization assets
  products: Product[]            // Product catalog
  clients: Client[]              // Customer relationships
  users: User[]                  // Employee directory
  resellers: Reseller[]          // Partner network
  leaves: Leave[]                // Leave policies & requests
}
```

### Organization Settings Deep Dive

```typescript
OrganisationSettings {
  uid: number
  organisationId: number
  
  // Attendance Configuration
  attendanceSettings: {
    requireGeoLocation: boolean      // GPS requirement for clock-in
    maxClockDistance: number         // Maximum distance in meters
    autoClockOut: boolean            // Automatic clock-out enabled
    overtimeThreshold: number        // Daily overtime threshold (hours)
    breakDuration: number            // Default break duration (minutes)
    lateThreshold: number            // Late arrival threshold (minutes)
    gracePeriod: number              // Grace period for late arrivals
    enableGeofencing: boolean        // Geofencing for attendance
    allowMobileClockIn: boolean      // Mobile app clock-in permission
    requirePhotos: boolean           // Photo requirement for attendance
  }
  
  // Notification Preferences
  notificationSettings: {
    emailNotifications: boolean      // Email notifications enabled
    smsNotifications: boolean        // SMS notifications enabled
    pushNotifications: boolean       // Push notifications enabled
    attendanceAlerts: boolean        // Attendance-related alerts
    reportSchedules: boolean         // Scheduled report delivery
    managerNotifications: boolean    // Manager-specific notifications
  }
  
  // Business Rules
  businessConfiguration: {
    timezone: string                 // Organization timezone
    currency: string                 // Default currency
    dateFormat: string               // Date display format
    timeFormat: string               // Time display format (12/24 hour)
    weekStartDay: number             // Week start day (0=Sunday, 1=Monday)
    fiscalYearStart: string          // Fiscal year start month-day
    holidayCalendar: string          // Holiday calendar reference
  }
  
  // Security Settings
  securitySettings: {
    passwordPolicy: object           // Password requirements
    sessionTimeout: number           // Session timeout (minutes)
    twoFactorRequired: boolean       // 2FA requirement
    ipRestrictions: string[]         // Allowed IP addresses
    deviceRestrictions: boolean      // Device-based restrictions
  }
  
  // Integration Configuration
  integrationSettings: {
    apiEnabled: boolean              // API access enabled
    webhookUrls: string[]            // Webhook endpoints
    thirdPartyServices: object       // External service configs
    erpIntegration: object           // ERP system configuration
    biometricDevices: object         // Biometric device settings
  }
}
```

### Organization Hours Configuration

```typescript
OrganisationHours {
  uid: number
  organisationId: number
  branchId?: number                  // Optional branch-specific hours
  
  // Schedule Configuration
  dayOfWeek: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'
  startTime: string                  // Format: 'HH:MM' (24-hour)
  endTime: string                    // Format: 'HH:MM' (24-hour)
  isWorkingDay: boolean              // Whether this is a working day
  
  // Break Configuration
  breakDuration: number              // Total break time (minutes)
  breakStartTime?: string            // Scheduled break start
  breakEndTime?: string              // Scheduled break end
  flexibleBreaks: boolean            // Allow flexible break timing
  mandatoryBreaks: boolean           // Breaks are mandatory
  
  // Overtime Configuration
  overtimeStart: string              // When overtime begins
  overtimeMultiplier: number         // Overtime rate multiplier
  maxOvertimeHours: number           // Maximum overtime per day
  overtimeApprovalRequired: boolean  // Requires manager approval
  
  // Timezone & Location
  timezone: string                   // Specific timezone for this schedule
  effectiveDate: Date                // When this schedule becomes active
  expiryDate?: Date                  // When this schedule expires
  
  // Shift Patterns
  shiftType: 'STANDARD' | 'ROTATING' | 'FLEXIBLE' | 'SPLIT'
  shiftPattern?: object              // Complex shift configurations
  allowFlexTime: boolean             // Flexible working hours
  coreHours?: {                      // Core hours (must be present)
    start: string
    end: string
  }
}
```

## 🕐 Working Hours System Functionality

### 1. Multi-Timezone Support

```typescript
// How organization hours handle timezones
class OrganizationHoursService {
  async getWorkingHoursForDate(organizationId: number, date: Date, timezone?: string) {
    const orgHours = await this.getOrganizationHours(organizationId);
    const effectiveTimezone = timezone || orgHours.defaultTimezone;
    
    // Convert working hours to specified timezone
    const localizedHours = this.convertToTimezone(orgHours, effectiveTimezone);
    
    return {
      dayOfWeek: this.getDayOfWeek(date),
      workingHours: localizedHours,
      isWorkingDay: this.isWorkingDay(date, orgHours),
      effectiveTimezone
    };
  }
}
```

### 2. Shift Pattern Management

```typescript
// Complex shift pattern handling
interface ShiftPattern {
  type: 'STANDARD' | 'ROTATING' | 'FLEXIBLE' | 'SPLIT';
  cycles?: {
    duration: number;           // Cycle duration in days
    shifts: ShiftDefinition[];  // Shift definitions in cycle
  };
  flexRules?: {
    minHours: number;          // Minimum hours per day
    maxHours: number;          // Maximum hours per day
    coreHours: TimeRange;      // Required presence hours
  };
}
```

### 3. Branch-Specific Hours

```typescript
// Branch-level hour overrides
class BranchHoursService {
  async getBranchWorkingHours(organizationId: number, branchId: number) {
    // Check for branch-specific hours first
    const branchHours = await this.getBranchSpecificHours(branchId);
    
    if (branchHours.length > 0) {
      return branchHours; // Use branch-specific configuration
    }
    
    // Fall back to organization default hours
    return this.getOrganizationDefaultHours(organizationId);
  }
}
```

## 📊 Integration with Attendance Reports Service

### 1. Real-Time Attendance Calculations

```typescript
// From attendance.reports.service.ts
class AttendanceReportsService {
  
  // Get organization timezone for accurate time calculations
  private async getOrganizationTimezone(organizationId: number): Promise<string> {
    const orgSettings = await this.organisationSettingsRepository.findOne({
      where: { organisationId }
    });
    
    return orgSettings?.timezone || 'UTC';
  }
  
  // Convert times to organization timezone
  private async convertTimeToOrgTimezone(date: Date, organizationId: number): Promise<string> {
    const timezone = await this.getOrganizationTimezone(organizationId);
    return moment(date).tz(timezone).format('YYYY-MM-DD HH:mm:ss');
  }
  
  // Calculate real-time hours worked using organization hours
  private async calculateRealTimeHoursWithOrgHours(
    attendance: Attendance,
    organizationId: number,
    currentTime: Date = new Date(),
    targetDate?: string
  ): Promise<number> {
    
    // Get organization working hours configuration
    const orgHours = await this.organizationHoursService.getWorkingHoursForDate(
      organizationId, 
      attendance.date
    );
    
    // Use organization-specific business rules for calculation
    const workingHours = this.calculateActualWorkingHours(
      attendance,
      orgHours,
      currentTime
    );
    
    return workingHours;
  }
}
```

### 2. Working Day Progress Calculation

```typescript
// Calculate work day progress using organization hours
private async calculateWorkDayProgressWithOrgHours(
  currentTime: Date,
  organizationId: number,
  date: Date
): Promise<number> {
  
  // Get organization working hours for the specific date
  const workingHours = await this.organizationHoursService.getWorkingHoursForDate(
    organizationId,
    date
  );
  
  if (!workingHours.isWorkingDay) {
    return 0; // Non-working day
  }
  
  const startTime = moment(date).set({
    hour: parseInt(workingHours.startTime.split(':')[0]),
    minute: parseInt(workingHours.startTime.split(':')[1])
  });
  
  const endTime = moment(date).set({
    hour: parseInt(workingHours.endTime.split(':')[0]),
    minute: parseInt(workingHours.endTime.split(':')[1])
  });
  
  const totalWorkingMinutes = endTime.diff(startTime, 'minutes');
  const elapsedMinutes = moment(currentTime).diff(startTime, 'minutes');
  
  return Math.min(100, Math.max(0, (elapsedMinutes / totalWorkingMinutes) * 100));
}
```

### 3. Overtime Calculation

```typescript
// Calculate overtime using organization settings
private async calculateTotalOvertimeWithOrgHours(
  todayAttendance: Attendance[],
  organizationId: number,
  currentTime: Date = new Date()
): Promise<number> {
  
  let totalOvertime = 0;
  
  for (const attendance of todayAttendance) {
    // Get organization-specific overtime rules
    const orgHours = await this.organizationHoursService.getWorkingHoursForDate(
      organizationId,
      attendance.date
    );
    
    const hoursWorked = await this.calculateRealTimeHoursWithOrgHours(
      attendance,
      organizationId,
      currentTime
    );
    
    // Apply organization overtime threshold
    const overtimeThreshold = orgHours.overtimeThreshold || 8;
    const overtime = Math.max(0, hoursWorked - overtimeThreshold);
    
    totalOvertime += overtime;
  }
  
  return totalOvertime;
}
```

### 4. Punctuality Analysis

```typescript
// Generate punctuality breakdown using organization hours
private async generatePunctualityBreakdown(
  organizationId: number,
  todayAttendance: Attendance[]
): Promise<PunctualityBreakdown> {
  
  const breakdown = {
    onTime: 0,
    late: 0,
    veryLate: 0,
    extremelyLate: 0
  };
  
  for (const attendance of todayAttendance) {
    // Get organization working hours for punctuality calculation
    const workingHours = await this.organizationHoursService.getWorkingHoursForDate(
      organizationId,
      attendance.date
    );
    
    // Get organization late thresholds from settings
    const settings = await this.getOrganizationSettings(organizationId);
    const lateThreshold = settings?.attendanceSettings?.lateThreshold || 15; // minutes
    
    const expectedStartTime = moment(attendance.date).set({
      hour: parseInt(workingHours.startTime.split(':')[0]),
      minute: parseInt(workingHours.startTime.split(':')[1])
    });
    
    const actualClockIn = moment(attendance.clockInTime);
    const lateMinutes = actualClockIn.diff(expectedStartTime, 'minutes');
    
    // Categorize based on organization-specific thresholds
    if (lateMinutes <= 0) {
      breakdown.onTime++;
    } else if (lateMinutes <= lateThreshold) {
      breakdown.late++;
    } else if (lateMinutes <= lateThreshold * 2) {
      breakdown.veryLate++;
    } else {
      breakdown.extremelyLate++;
    }
  }
  
  return breakdown;
}
```

## 🔧 System Integration Points

### 1. Cache Management

```typescript
// Organization data caching for performance
class OrganizationCacheService {
  private readonly CACHE_PREFIX = 'organization';
  private readonly HOURS_CACHE_TTL = 3600; // 1 hour
  
  async getWorkingHours(organizationId: number, date: Date) {
    const cacheKey = `${this.CACHE_PREFIX}:hours:${organizationId}:${date.toDateString()}`;
    
    let hours = await this.cacheManager.get(cacheKey);
    if (!hours) {
      hours = await this.loadWorkingHoursFromDB(organizationId, date);
      await this.cacheManager.set(cacheKey, hours, { ttl: this.HOURS_CACHE_TTL });
    }
    
    return hours;
  }
}
```

### 2. Event-Driven Updates

```typescript
// Organization changes trigger attendance recalculations
@EventPattern('organization.hours.updated')
async handleOrganizationHoursUpdate(data: { organizationId: number, effectiveDate: Date }) {
  // Invalidate related caches
  await this.cacheService.clearOrganizationCache(data.organizationId);
  
  // Recalculate attendance metrics for affected dates
  await this.attendanceService.recalculateMetrics(
    data.organizationId,
    data.effectiveDate
  );
  
  // Notify affected users
  await this.notificationService.notifyWorkingHoursChange(data.organizationId);
}
```

### 3. Multi-Branch Support

```typescript
// Branch-specific working hours override
class BranchWorkingHoursService {
  async getEffectiveWorkingHours(organizationId: number, branchId?: number, date: Date) {
    if (branchId) {
      // Check for branch-specific hours first
      const branchHours = await this.getBranchHours(branchId, date);
      if (branchHours) {
        return branchHours;
      }
    }
    
    // Fall back to organization default
    return this.getOrganizationHours(organizationId, date);
  }
}
```

## 📈 Business Intelligence Integration

### 1. Performance Metrics

```typescript
// Organization hours impact on performance metrics
class PerformanceMetricsService {
  async calculateOrganizationalEfficiency(organizationId: number, period: DateRange) {
    const settings = await this.getOrganizationSettings(organizationId);
    const workingHours = await this.getWorkingHoursForPeriod(organizationId, period);
    
    const metrics = {
      expectedWorkingHours: this.calculateExpectedHours(workingHours, period),
      actualWorkingHours: await this.getActualHours(organizationId, period),
      efficiency: 0,
      overtimeRate: 0,
      punctualityScore: 0
    };
    
    metrics.efficiency = (metrics.actualWorkingHours / metrics.expectedWorkingHours) * 100;
    
    return metrics;
  }
}
```

### 2. Reporting Framework

```typescript
// Organization-aware reporting
class OrganizationReportingService {
  async generateComprehensiveReport(organizationId: number, reportType: string) {
    const organization = await this.getOrganizationWithSettings(organizationId);
    
    const report = {
      organizationInfo: {
        name: organization.name,
        timezone: organization.settings.timezone,
        workingHoursModel: organization.hours
      },
      metrics: await this.calculateOrganizationMetrics(organizationId),
      insights: await this.generateInsights(organization),
      recommendations: await this.generateRecommendations(organization)
    };
    
    return report;
  }
}
```

## 🎯 Best Practices

### 1. Timezone Handling

```typescript
// Always use organization timezone for calculations
const orgTimezone = await this.getOrganizationTimezone(organizationId);
const localTime = moment(utcTime).tz(orgTimezone);
```

### 2. Caching Strategy

```typescript
// Cache organization settings with appropriate TTL
const cacheKey = `org:${organizationId}:settings`;
const ttl = 3600; // 1 hour for settings, shorter for dynamic data
```

### 3. Error Handling

```typescript
// Graceful fallback for missing organization data
const workingHours = await this.getWorkingHours(organizationId) || this.getDefaultWorkingHours();
```

### 4. Performance Optimization

```typescript
// Batch load organization data for multiple operations
const organizations = await this.batchLoadOrganizations(organizationIds);
const results = await Promise.all(
  organizations.map(org => this.processOrganization(org))
);
```

This comprehensive integration ensures that all attendance calculations, reporting, and business intelligence features respect the unique operational requirements of each organization while providing accurate, real-time insights into workforce management and organizational efficiency.
