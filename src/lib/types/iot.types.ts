import { DeviceStatus, DeviceType } from '../enums/iot';
import { 
  DeviceAnalytics, 
  DeviceRecord, 
  DeviceInfo,
  DeviceMonitoringReport,
  DeviceConfiguration,
  PaginatedIoTResponse 
} from '../interfaces/iot.interface';

/**
 * IoT Service Response Types
 */
export type IoTServiceResponse<T = any> = {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  timestamp: Date;
  requestId?: string;
};

/**
 * Device Creation Response Type
 */
export type DeviceCreationResponse = IoTServiceResponse<{
  device: Partial<DeviceInfo>;
  analytics: DeviceAnalytics;
}>;

/**
 * Device Record Response Type
 */
export type DeviceRecordResponse = IoTServiceResponse<{
  record: Partial<DeviceRecord>;
  eventProcessing: {
    isNewRecord: boolean;
    eventType: 'open' | 'close' | 'update';
    previousRecord?: Partial<DeviceRecord>;
  };
}>;

/**
 * Device Query Options Type
 */
export type DeviceQueryOptions = {
  orgID?: number;
  branchID?: number;
  deviceType?: DeviceType;
  status?: DeviceStatus;
  isDeleted?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'deviceID' | 'analytics.totalCount';
  sortOrder?: 'ASC' | 'DESC';
  search?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
};

/**
 * Device Analytics Query Type
 */
export type DeviceAnalyticsQuery = {
  deviceIds?: number[];
  branchIds?: number[];
  orgId?: number;
  dateRange: {
    start: Date;
    end: Date;
  };
  metricsType?: 'daily' | 'weekly' | 'monthly';
  includeEvents?: boolean;
  includePerformance?: boolean;
};

/**
 * Time Event Processing Options Type
 */
export type TimeEventProcessingOptions = {
  allowDuplicates?: boolean;
  updateExisting?: boolean;
  validateTiming?: boolean;
  notifyAdmins?: boolean;
  generateAlerts?: boolean;
  timezone?: string;
};

/**
 * Device Report Options Type
 */
export type DeviceReportOptions = {
  orgId: number;
  branchIds?: number[];
  deviceIds?: number[];
  reportType: 'morning' | 'evening' | 'daily' | 'weekly' | 'monthly';
  dateRange?: {
    start: Date;
    end: Date;
  };
  includeAnalytics?: boolean;
  includeRecommendations?: boolean;
  format?: 'json' | 'pdf' | 'excel' | 'csv';
};

/**
 * Device Bulk Operations Type
 */
export type DeviceBulkOperation = {
  operation: 'create' | 'update' | 'delete' | 'activate' | 'deactivate';
  deviceIds?: number[];
  data?: Partial<DeviceInfo>[];
  options?: {
    skipValidation?: boolean;
    updateAnalytics?: boolean;
    sendNotifications?: boolean;
  };
};

/**
 * Device Event Types
 */
export type DeviceEventType = 
  | 'device.created'
  | 'device.updated'
  | 'device.deleted'
  | 'device.activated'
  | 'device.deactivated'
  | 'device.opened'
  | 'device.closed'
  | 'device.offline'
  | 'device.online'
  | 'device.maintenance_needed'
  | 'device.alert_triggered';

/**
 * Device Event Payload Type
 */
export type DeviceEventPayload = {
  eventType: DeviceEventType;
  deviceId: number;
  deviceID: string;
  orgId: number;
  branchId: number;
  timestamp: Date;
  data?: Record<string, any>;
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
    location?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  };
};

/**
 * Device Validation Rules Type
 */
export type DeviceValidationRules = {
  deviceID: {
    minLength: number;
    maxLength: number;
    pattern: RegExp;
    uniquePerOrg: boolean;
  };
  deviceIP: {
    validateFormat: boolean;
    allowPrivateIPs: boolean;
    requireReachability: boolean;
  };
  devicePort: {
    minPort: number;
    maxPort: number;
    reservedPorts: number[];
  };
  location: {
    required: boolean;
    maxLength: number;
  };
};

/**
 * Device Performance Thresholds Type
 */
export type DevicePerformanceThresholds = {
  punctuality: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  uptime: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  efficiency: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  responseTime: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
};

/**
 * Device Alert Configuration Type
 */
export type DeviceAlertConfiguration = {
  enabled: boolean;
  thresholds: {
    offlineTimeout: number;
    lateOpeningMinutes: number;
    earlyClosingMinutes: number;
    lowEfficiencyPercentage: number;
    maintenanceInterval: number;
  };
  recipients: {
    admins: boolean;
    owners: boolean;
    managers: boolean;
    technicians: boolean;
    customEmails: string[];
  };
  channels: {
    email: boolean;
    sms: boolean;
    push: boolean;
    webhook: boolean;
  };
};

/**
 * Cache Keys for IoT Data
 */
export type IoTCacheKeys = 
  | `device:${number}`
  | `device:analytics:${number}`
  | `device:records:${number}:${string}`
  | `org:${number}:devices`
  | `branch:${number}:devices`
  | `device:report:${number}:${string}`
  | `device:performance:${number}:${string}`;

/**
 * Device Export Configuration Type
 */
export type DeviceExportConfiguration = {
  format: 'csv' | 'excel' | 'pdf' | 'json';
  fields: string[];
  includeAnalytics: boolean;
  includeRecords: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
  groupBy?: 'branch' | 'type' | 'status';
  filters?: Partial<DeviceQueryOptions>;
};

/**
 * Device Maintenance Schedule Type
 */
export type DeviceMaintenanceSchedule = {
  deviceId: number;
  scheduledDate: Date;
  maintenanceType: 'preventive' | 'corrective' | 'emergency';
  description: string;
  assignedTechnician?: string;
  estimatedDuration: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
};

/**
 * Device Integration Settings Type
 */
export type DeviceIntegrationSettings = {
  webhooks: {
    enabled: boolean;
    endpoints: string[];
    events: DeviceEventType[];
    authentication?: {
      type: 'bearer' | 'api_key' | 'basic';
      credentials: Record<string, string>;
    };
  };
  apis: {
    enableRestAPI: boolean;
    enableGraphQL: boolean;
    rateLimit: number;
    allowedOrigins: string[];
  };
  realtime: {
    enableWebSockets: boolean;
    enableSSE: boolean;
    channels: string[];
  };
};
