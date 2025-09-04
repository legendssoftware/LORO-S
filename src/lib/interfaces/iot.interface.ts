import { DeviceStatus, DeviceType } from '../enums/iot';

/**
 * Core IoT Device Analytics Interface
 */
export interface DeviceAnalytics {
  openCount: number;
  closeCount: number;
  totalCount: number;
  lastOpenAt: Date;
  lastCloseAt: Date;
  onTimeCount: number;
  lateCount: number;
  daysAbsent: number;
  lastEventAt?: Date;
  successfulEvents?: number;
  failedEvents?: number;
  weeklyPattern?: {
    monday: number;
    tuesday: number;
    wednesday: number;
    thursday: number;
    friday: number;
    saturday: number;
    sunday: number;
  };
  monthlyStats?: {
    eventsThisMonth: number;
    averageEventsPerDay: number;
    peakHour: number;
    efficiency: number;
  };
}

/**
 * IoT Device Time Event Interface
 */
export interface DeviceTimeEvent {
  deviceID: string;
  eventType: 'open' | 'close';
  timestamp: number;
  location?: string;
  ipAddress?: string;
  metadata?: Record<string, any>;
}

/**
 * IoT Device Information Interface
 */
export interface DeviceInfo {
  id: number;
  orgID: number;
  branchID: number;
  deviceID: string;
  deviceType: DeviceType;
  deviceIP: string;
  devicePort: number;
  devicLocation: string;
  deviceTag: string;
  currentStatus: DeviceStatus;
  analytics: DeviceAnalytics;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * IoT Device Record Interface
 */
export interface DeviceRecord {
  id: number;
  openTime?: number;
  closeTime?: number;
  deviceId: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * IoT Device Monitoring Report Interface
 */
export interface DeviceMonitoringReport {
  reportDate: string;
  generatedAt: string;
  organizationId: number;
  summary: DeviceReportSummary;
  deviceBreakdown: DeviceReportBreakdown[];
  alerts: DeviceAlerts;
  insights: DeviceInsights;
  recommendations: DeviceRecommendations;
}

/**
 * Device Report Summary Interface
 */
export interface DeviceReportSummary {
  totalDevices: number;
  activeDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  totalOpenEvents: number;
  totalCloseEvents: number;
  averageUptime: number;
  organizationEfficiency: number;
  totalWorkingHours: number;
  lateOpenings: number;
  earlyClosings: number;
  punctualityRate: number;
}

/**
 * Device Report Breakdown Interface
 */
export interface DeviceReportBreakdown {
  branchId: number;
  branchName: string;
  totalDevices: number;
  activeDevices: number;
  averageUptime: number;
  totalEvents: number;
  punctualityRate: number;
  devices: DeviceReportDevice[];
}

/**
 * Device Report Device Interface
 */
export interface DeviceReportDevice {
  id: number;
  deviceID: string;
  deviceType: DeviceType;
  location: string;
  currentStatus: DeviceStatus;
  lastOpenTime?: string;
  lastCloseTime?: string;
  todayOpenTime?: string;
  todayCloseTime?: string;
  isLateOpening?: boolean;
  isEarlyClosing?: boolean;
  lateMinutes?: number;
  efficiency?: number;
  uptime?: number;
  eventCount?: number;
}

/**
 * Device Alerts Interface
 */
export interface DeviceAlerts {
  critical: string[];
  warning: string[];
  info: string[];
}

/**
 * Device Insights Interface
 */
export interface DeviceInsights {
  topPerformingDevices: DeviceReportDevice[];
  concerningDevices: DeviceReportDevice[];
  trendsAnalysis: {
    uptimeImprovement: number;
    efficiencyTrend: number;
    punctualityTrend: number;
  };
}

/**
 * Device Recommendations Interface
 */
export interface DeviceRecommendations {
  immediate: string[];
  shortTerm: string[];
  longTerm: string[];
}

/**
 * Device Performance Metrics Interface
 */
export interface DevicePerformanceMetrics {
  deviceId: number;
  openTimePunctuality: number;
  closeTimePunctuality: number;
  uptimePercentage: number;
  efficiencyScore: number;
  reliabilityScore: number;
  maintenanceNeeded: boolean;
}

/**
 * Device Working Hours Interface
 */
export interface DeviceWorkingHours {
  deviceId: number;
  expectedOpenTime: string;
  expectedCloseTime: string;
  actualOpenTime?: string;
  actualCloseTime?: string;
  workingDuration?: number;
  isWithinSchedule: boolean;
  overtime?: number;
}

/**
 * Device Event Analytics Interface
 */
export interface DeviceEventAnalytics {
  totalEvents: number;
  openEvents: number;
  closeEvents: number;
  successfulEvents: number;
  failedEvents: number;
  averageResponseTime: number;
  peakUsageHours: number[];
  dailyPattern: Record<string, number>;
  weeklyPattern: Record<string, number>;
  monthlyTrends: Record<string, number>;
}

/**
 * Paginated Response Interface for IoT
 */
export interface PaginatedIoTResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * Device Configuration Interface
 */
export interface DeviceConfiguration {
  timezone: string;
  workingHours: {
    start: string;
    end: string;
  };
  alertSettings: {
    lateOpeningThreshold: number;
    earlyClosingThreshold: number;
    maintenanceAlerts: boolean;
    performanceAlerts: boolean;
  };
  reportingSettings: {
    enableDailyReports: boolean;
    enableWeeklyReports: boolean;
    enableMonthlyReports: boolean;
    reportRecipients: string[];
  };
}
