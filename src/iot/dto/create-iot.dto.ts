import { 
  IsString, 
  IsNumber, 
  IsEnum, 
  IsOptional, 
  IsBoolean, 
  IsObject, 
  ValidateNested, 
  IsNotEmpty, 
  IsIP, 
  IsPort,
  IsArray,
  IsDateString,
  Min,
  Max,
  Length,
  IsEmail,
  Matches
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceType, DeviceStatus } from '../../lib/enums/iot';
import { DeviceAnalytics, DeviceTimeEvent } from '../../lib/interfaces/iot.interface';

/**
 * DTO for creating a new IoT device
 * 
 * This DTO handles the registration of new IoT devices in the system.
 * Each device must be associated with an organization and branch.
 * The system will automatically initialize analytics and set default status.
 * 
 * @example
 * ```json
 * {
 *   "orgID": 123,
 *   "branchID": 456,
 *   "deviceID": "DOOR_SENSOR_001",
 *   "deviceType": "DOOR_SENSOR",
 *   "deviceIP": "192.168.1.100",
 *   "devicePort": 8080,
 *   "devicLocation": "Main Entrance, Building A",
 *   "deviceTag": "Front Door Access Control",
 *   "currentStatus": "ONLINE"
 * }
 * ```
 */
export class CreateDeviceDto {
  @ApiProperty({ 
    description: 'Organization ID that owns this device',
    example: 123,
    minimum: 1,
    type: 'number'
  })
  @IsNumber({}, { message: 'Organization ID must be a valid number' })
  @IsNotEmpty({ message: 'Organization ID is required' })
  @Min(1, { message: 'Organization ID must be greater than 0' })
  orgID: number;

  @ApiProperty({ 
    description: 'Branch ID where the device is located',
    example: 456,
    minimum: 1,
    type: 'number'
  })
  @IsNumber({}, { message: 'Branch ID must be a valid number' })
  @IsNotEmpty({ message: 'Branch ID is required' })
  @Min(1, { message: 'Branch ID must be greater than 0' })
  branchID: number;

  @ApiProperty({ 
    description: 'Unique device identifier (must be unique within organization)',
    example: 'DOOR_SENSOR_001',
    minLength: 3,
    maxLength: 50,
    pattern: '^[A-Z0-9_-]+$'
  })
  @IsString({ message: 'Device ID must be a string' })
  @IsNotEmpty({ message: 'Device ID is required' })
  @Length(3, 50, { message: 'Device ID must be between 3 and 50 characters' })
  @Matches(/^[A-Z0-9_-]+$/, { message: 'Device ID can only contain uppercase letters, numbers, underscores, and hyphens' })
  deviceID: string;

  @ApiPropertyOptional({ 
    description: 'Type of IoT device',
    enum: DeviceType,
    example: DeviceType.DOOR_SENSOR,
    default: DeviceType.DOOR_SENSOR
  })
  @IsEnum(DeviceType, { message: 'Device type must be a valid enum value' })
  @IsOptional()
  deviceType?: DeviceType;

  @ApiProperty({ 
    description: 'IP address of the device (IPv4 or IPv6)',
    example: '192.168.1.100',
    format: 'ip'
  })
  @IsIP(undefined, { message: 'Device IP must be a valid IP address' })
  @IsNotEmpty({ message: 'Device IP is required' })
  deviceIP: string;

  @ApiProperty({ 
    description: 'Port number the device listens on',
    example: 8080,
    minimum: 1,
    maximum: 65535
  })
  @IsNumber({}, { message: 'Device port must be a valid number' })
  @IsNotEmpty({ message: 'Device port is required' })
  @Min(1, { message: 'Port must be between 1 and 65535' })
  @Max(65535, { message: 'Port must be between 1 and 65535' })
  devicePort: number;

  @ApiProperty({ 
    description: 'Physical location description of the device',
    example: 'Main Entrance, Building A, Floor 1',
    minLength: 5,
    maxLength: 200
  })
  @IsString({ message: 'Device location must be a string' })
  @IsNotEmpty({ message: 'Device location is required' })
  @Length(5, 200, { message: 'Device location must be between 5 and 200 characters' })
  devicLocation: string;

  @ApiProperty({ 
    description: 'Human-readable tag or label for the device',
    example: 'Front Door Access Control System',
    minLength: 3,
    maxLength: 100
  })
  @IsString({ message: 'Device tag must be a string' })
  @IsNotEmpty({ message: 'Device tag is required' })
  @Length(3, 100, { message: 'Device tag must be between 3 and 100 characters' })
  deviceTag: string;

  @ApiPropertyOptional({ 
    description: 'Initial status of the device',
    enum: DeviceStatus,
    example: DeviceStatus.ONLINE,
    default: DeviceStatus.OFFLINE
  })
  @IsEnum(DeviceStatus, { message: 'Device status must be a valid enum value' })
  @IsOptional()
  currentStatus?: DeviceStatus;

  @ApiPropertyOptional({ 
    description: 'Initial analytics data (will be auto-generated if not provided)',
    example: {
      "openCount": 0,
      "closeCount": 0,
      "totalCount": 0,
      "lastOpenAt": "2025-01-04T09:00:00.000Z",
      "lastCloseAt": "2025-01-04T17:00:00.000Z",
      "onTimeCount": 0,
      "lateCount": 0,
      "daysAbsent": 0
    }
  })
  @IsObject({ message: 'Analytics must be a valid object' })
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  analytics?: Partial<DeviceAnalytics>;
}

/**
 * DTO for creating device time records
 * 
 * This DTO handles the creation of individual device open/close events.
 * It supports both creating new records and updating existing ones for the same day.
 * 
 * @example
 * ```json
 * {
 *   "deviceId": 789,
 *   "openTime": 1672905600,
 *   "closeTime": null,
 *   "metadata": {
 *     "userAgent": "IoTDevice/1.0",
 *     "signalStrength": 85,
 *     "batteryLevel": 92
 *   }
 * }
 * ```
 */
export class CreateDeviceRecordDto {
  @ApiProperty({ 
    description: 'Database ID of the device (foreign key)',
    example: 789,
    minimum: 1
  })
  @IsNumber({}, { message: 'Device ID must be a valid number' })
  @IsNotEmpty({ message: 'Device ID is required' })
  @Min(1, { message: 'Device ID must be greater than 0' })
  deviceId: number;

  @ApiPropertyOptional({ 
    description: 'Device open time as Unix timestamp (seconds since epoch)',
    example: 1672905600,
    minimum: 946684800
  })
  @IsNumber({}, { message: 'Open time must be a valid Unix timestamp' })
  @IsOptional()
  @Min(946684800, { message: 'Open time must be after year 2000' })
  openTime?: number;

  @ApiPropertyOptional({ 
    description: 'Device close time as Unix timestamp (seconds since epoch)',
    example: 1672939200,
    minimum: 946684800
  })
  @IsNumber({}, { message: 'Close time must be a valid Unix timestamp' })
  @IsOptional()
  @Min(946684800, { message: 'Close time must be after year 2000' })
  closeTime?: number;

  @ApiPropertyOptional({ 
    description: 'Additional metadata about the event',
    example: {
      "userAgent": "IoTDevice/1.0",
      "signalStrength": 85,
      "batteryLevel": 92,
      "temperature": 23.5,
      "humidity": 45
    }
  })
  @IsObject({ message: 'Metadata must be a valid object' })
  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * DTO for recording device time events (CORE ENDPOINT)
 * 
 * This is the main DTO used by IoT devices to report open/close events.
 * The system will automatically handle record creation/updates and analytics.
 * 
 * @example
 * ```json
 * {
 *   "deviceID": "DOOR_SENSOR_001",
 *   "eventType": "open",
 *   "timestamp": 1672905600,
 *   "location": "Main Entrance, Building A",
 *   "ipAddress": "192.168.1.100",
 *   "metadata": {
 *     "userAgent": "IoTDevice/1.0",
 *     "signalStrength": 85,
 *     "batteryLevel": 92,
 *     "firmwareVersion": "2.1.3"
 *   }
 * }
 * ```
 */
export class DeviceTimeRecordDto implements DeviceTimeEvent {
  @ApiProperty({ 
    description: 'Unique device identifier (must match registered device)',
    example: 'DOOR_SENSOR_001',
    minLength: 3,
    maxLength: 50
  })
  @IsString({ message: 'Device ID must be a string' })
  @IsNotEmpty({ message: 'Device ID is required' })
  @Length(3, 50, { message: 'Device ID must be between 3 and 50 characters' })
  deviceID: string;

  @ApiProperty({ 
    description: 'Type of event being recorded',
    enum: ['open', 'close'],
    example: 'open'
  })
  @IsEnum(['open', 'close'], { message: 'Event type must be either "open" or "close"' })
  @IsNotEmpty({ message: 'Event type is required' })
  eventType: 'open' | 'close';

  @ApiProperty({ 
    description: 'Unix timestamp when the event occurred (seconds since epoch)',
    example: 1672905600,
    minimum: 946684800
  })
  @IsNumber({}, { message: 'Timestamp must be a valid Unix timestamp' })
  @IsNotEmpty({ message: 'Timestamp is required' })
  @Min(946684800, { message: 'Timestamp must be after year 2000' })
  timestamp: number;

  @ApiPropertyOptional({ 
    description: 'Physical location where the event occurred',
    example: 'Main Entrance, Building A, Floor 1',
    maxLength: 200
  })
  @IsString({ message: 'Location must be a string' })
  @IsOptional()
  @Length(0, 200, { message: 'Location must be less than 200 characters' })
  location?: string;

  @ApiPropertyOptional({ 
    description: 'IP address from which the event was sent',
    example: '192.168.1.100',
    format: 'ip'
  })
  @IsIP(undefined, { message: 'IP address must be valid' })
  @IsOptional()
  ipAddress?: string;

  @ApiPropertyOptional({ 
    description: 'Additional event metadata and sensor data',
    example: {
      "userAgent": "IoTDevice/1.0",
      "signalStrength": 85,
      "batteryLevel": 92,
      "firmwareVersion": "2.1.3",
      "temperature": 23.5,
      "humidity": 45,
      "motionDetected": true
    }
  })
  @IsObject({ message: 'Metadata must be a valid object' })
  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * DTO for bulk device time recording
 * 
 * Allows multiple time events to be recorded in a single API call for efficiency.
 * 
 * @example
 * ```json
 * {
 *   "events": [
 *     {
 *       "deviceID": "DOOR_SENSOR_001",
 *       "eventType": "open",
 *       "timestamp": 1672905600
 *     },
 *     {
 *       "deviceID": "DOOR_SENSOR_002", 
 *       "eventType": "close",
 *       "timestamp": 1672906200
 *     }
 *   ],
 *   "batchId": "batch_20250104_001"
 * }
 * ```
 */
export class BulkDeviceTimeRecordDto {
  @ApiProperty({ 
    description: 'Array of time events to record',
    type: [DeviceTimeRecordDto],
    minItems: 1,
    maxItems: 100
  })
  @IsArray({ message: 'Events must be an array' })
  @ValidateNested({ each: true })
  @Type(() => DeviceTimeRecordDto)
  @IsNotEmpty({ message: 'At least one event is required' })
  events: DeviceTimeRecordDto[];

  @ApiPropertyOptional({ 
    description: 'Optional batch identifier for tracking',
    example: 'batch_20250104_001',
    maxLength: 50
  })
  @IsString({ message: 'Batch ID must be a string' })
  @IsOptional()
  @Length(0, 50, { message: 'Batch ID must be less than 50 characters' })
  batchId?: string;

  @ApiPropertyOptional({ 
    description: 'Whether to skip validation for faster processing',
    example: false,
    default: false
  })
  @IsBoolean({ message: 'Skip validation must be a boolean' })
  @IsOptional()
  skipValidation?: boolean;
}

/**
 * DTO for device analytics query
 * 
 * Used to query device analytics and performance metrics.
 * 
 * @example
 * ```json
 * {
 *   "deviceIds": [789, 790, 791],
 *   "dateRange": {
 *     "start": "2025-01-01T00:00:00.000Z",
 *     "end": "2025-01-04T23:59:59.999Z"
 *   },
 *   "metricsType": "daily",
 *   "includeEvents": true
 * }
 * ```
 */
export class DeviceAnalyticsQueryDto {
  @ApiPropertyOptional({ 
    description: 'Array of device IDs to include in analytics',
    type: [Number],
    example: [789, 790, 791]
  })
  @IsArray({ message: 'Device IDs must be an array' })
  @IsNumber({}, { each: true, message: 'Each device ID must be a number' })
  @IsOptional()
  deviceIds?: number[];

  @ApiProperty({ 
    description: 'Date range for analytics query',
    example: {
      "start": "2025-01-01T00:00:00.000Z",
      "end": "2025-01-04T23:59:59.999Z"
    }
  })
  @IsObject({ message: 'Date range must be an object' })
  @ValidateNested()
  @Type(() => Object)
  dateRange: {
    start: Date;
    end: Date;
  };

  @ApiPropertyOptional({ 
    description: 'Type of metrics aggregation',
    enum: ['daily', 'weekly', 'monthly'],
    example: 'daily',
    default: 'daily'
  })
  @IsEnum(['daily', 'weekly', 'monthly'], { message: 'Metrics type must be daily, weekly, or monthly' })
  @IsOptional()
  metricsType?: 'daily' | 'weekly' | 'monthly';

  @ApiPropertyOptional({ 
    description: 'Include individual events in response',
    example: true,
    default: false
  })
  @IsBoolean({ message: 'Include events must be a boolean' })
  @IsOptional()
  includeEvents?: boolean;
}

// Legacy DTO for backward compatibility
export class CreateIotDto extends CreateDeviceDto {}