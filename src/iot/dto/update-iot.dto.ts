import { PartialType } from '@nestjs/swagger';
import { 
  CreateIotDto, 
  CreateDeviceDto, 
  CreateDeviceRecordDto, 
  DeviceTimeRecordDto 
} from './create-iot.dto';
import { 
  IsString, 
  IsNumber, 
  IsEnum, 
  IsOptional, 
  IsBoolean, 
  IsObject, 
  IsNotEmpty,
  ValidateNested,
  IsArray,
  Min,
  Max,
  Length 
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceType, DeviceStatus } from '../../lib/enums/iot';
import { DeviceAnalytics } from '../../lib/interfaces/iot.interface';

/**
 * DTO for updating an existing IoT device
 * 
 * This DTO allows partial updates to device information.
 * All fields are optional, only provided fields will be updated.
 * 
 * @example
 * ```json
 * {
 *   "id": 789,
 *   "deviceIP": "192.168.1.101",
 *   "devicePort": 8081,
 *   "devicLocation": "Updated: Main Entrance, Building A, Floor 1",
 *   "currentStatus": "MAINTENANCE",
 *   "isDeleted": false
 * }
 * ```
 */
export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {
  @ApiPropertyOptional({ 
    description: 'Database ID of the device to update',
    example: 789,
    minimum: 1
  })
  @IsNumber({}, { message: 'Device ID must be a valid number' })
  @IsOptional()
  @Min(1, { message: 'Device ID must be greater than 0' })
  id?: number;

  @ApiPropertyOptional({ 
    description: 'Soft delete flag - marks device as deleted without removing from database',
    example: false,
    default: false
  })
  @IsBoolean({ message: 'isDeleted must be a boolean value' })
  @IsOptional()
  isDeleted?: boolean;

  @ApiPropertyOptional({ 
    description: 'Reason for the update (for audit trail)',
    example: 'Device relocated to new building',
    maxLength: 500
  })
  @IsString({ message: 'Update reason must be a string' })
  @IsOptional()
  @Length(0, 500, { message: 'Update reason must be less than 500 characters' })
  updateReason?: string;

  @ApiPropertyOptional({ 
    description: 'User ID who is performing the update',
    example: 123,
    minimum: 1
  })
  @IsNumber({}, { message: 'Updated by user ID must be a valid number' })
  @IsOptional()
  @Min(1, { message: 'Updated by user ID must be greater than 0' })
  updatedBy?: number;
}

/**
 * DTO for updating device records
 * 
 * Allows modification of existing device time records.
 * Useful for correcting timing errors or adding missing data.
 * 
 * @example
 * ```json
 * {
 *   "id": 456,
 *   "openTime": 1672905600,
 *   "closeTime": 1672939200,
 *   "metadata": {
 *     "correctionReason": "Time zone adjustment",
 *     "originalOpenTime": 1672901000,
 *     "correctedBy": "admin@orrbit.co.za"
 *   }
 * }
 * ```
 */
export class UpdateDeviceRecordDto extends PartialType(CreateDeviceRecordDto) {
  @ApiPropertyOptional({ 
    description: 'Database ID of the record to update',
    example: 456,
    minimum: 1
  })
  @IsNumber({}, { message: 'Record ID must be a valid number' })
  @IsOptional()
  @Min(1, { message: 'Record ID must be greater than 0' })
  id?: number;

  @ApiPropertyOptional({ 
    description: 'Reason for updating this record',
    example: 'Correcting time zone offset',
    maxLength: 300
  })
  @IsString({ message: 'Update reason must be a string' })
  @IsOptional()
  @Length(0, 300, { message: 'Update reason must be less than 300 characters' })
  updateReason?: string;

  @ApiPropertyOptional({ 
    description: 'Whether this is a manual correction vs automatic update',
    example: true,
    default: false
  })
  @IsBoolean({ message: 'Manual correction flag must be a boolean' })
  @IsOptional()
  isManualCorrection?: boolean;
}

/**
 * DTO for updating device status
 * 
 * Used for changing device operational status with proper audit trail.
 * Status changes trigger notifications and analytics updates.
 * 
 * @example
 * ```json
 * {
 *   "currentStatus": "MAINTENANCE",
 *   "reason": "Scheduled maintenance for firmware update",
 *   "scheduledDowntime": {
 *     "start": "2025-01-04T18:00:00.000Z",
 *     "end": "2025-01-04T20:00:00.000Z"
 *   },
 *   "notifyAdmins": true
 * }
 * ```
 */
export class UpdateDeviceStatusDto {
  @ApiProperty({ 
    description: 'New operational status for the device',
    enum: DeviceStatus,
    example: DeviceStatus.MAINTENANCE
  })
  @IsEnum(DeviceStatus, { message: 'Status must be a valid DeviceStatus enum value' })
  @IsNotEmpty({ message: 'Device status is required' })
  currentStatus: DeviceStatus;

  @ApiPropertyOptional({ 
    description: 'Detailed reason for the status change',
    example: 'Scheduled maintenance for firmware update',
    maxLength: 500
  })
  @IsString({ message: 'Status change reason must be a string' })
  @IsOptional()
  @Length(0, 500, { message: 'Status change reason must be less than 500 characters' })
  reason?: string;

  @ApiPropertyOptional({ 
    description: 'Scheduled downtime window (for maintenance status)',
    example: {
      "start": "2025-01-04T18:00:00.000Z",
      "end": "2025-01-04T20:00:00.000Z"
    }
  })
  @IsObject({ message: 'Scheduled downtime must be a valid object' })
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  scheduledDowntime?: {
    start: Date;
    end: Date;
  };

  @ApiPropertyOptional({ 
    description: 'Whether to send notifications to administrators',
    example: true,
    default: true
  })
  @IsBoolean({ message: 'Notify admins flag must be a boolean' })
  @IsOptional()
  notifyAdmins?: boolean;

  @ApiPropertyOptional({ 
    description: 'Priority level of the status change',
    enum: ['low', 'medium', 'high', 'critical'],
    example: 'medium',
    default: 'medium'
  })
  @IsEnum(['low', 'medium', 'high', 'critical'], { message: 'Priority must be low, medium, high, or critical' })
  @IsOptional()
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * DTO for updating device analytics
 * 
 * Allows manual adjustment of device analytics data.
 * Should be used carefully as it affects performance calculations.
 * 
 * @example
 * ```json
 * {
 *   "analytics": {
 *     "openCount": 150,
 *     "closeCount": 148,
 *     "totalCount": 298,
 *     "onTimeCount": 145,
 *     "lateCount": 5,
 *     "daysAbsent": 2,
 *     "successfulEvents": 298,
 *     "failedEvents": 2
 *   },
 *   "resetCounters": false,
 *   "adjustmentReason": "Data recovery after system maintenance"
 * }
 * ```
 */
export class UpdateDeviceAnalyticsDto {
  @ApiProperty({ 
    description: 'Analytics data to update (partial updates supported)',
    example: {
      "openCount": 150,
      "closeCount": 148,
      "totalCount": 298,
      "onTimeCount": 145,
      "lateCount": 5,
      "daysAbsent": 2,
      "successfulEvents": 298,
      "failedEvents": 2,
      "weeklyPattern": {
        "monday": 45,
        "tuesday": 48,
        "wednesday": 52,
        "thursday": 47,
        "friday": 46
      }
    }
  })
  @IsObject({ message: 'Analytics must be a valid object' })
  @IsNotEmpty({ message: 'Analytics data is required' })
  @ValidateNested()
  @Type(() => Object)
  analytics: Partial<DeviceAnalytics>;

  @ApiPropertyOptional({ 
    description: 'Whether to reset all counters to zero before applying updates',
    example: false,
    default: false
  })
  @IsBoolean({ message: 'Reset counters flag must be a boolean' })
  @IsOptional()
  resetCounters?: boolean;

  @ApiPropertyOptional({ 
    description: 'Reason for the analytics adjustment',
    example: 'Data recovery after system maintenance',
    maxLength: 300
  })
  @IsString({ message: 'Adjustment reason must be a string' })
  @IsOptional()
  @Length(0, 300, { message: 'Adjustment reason must be less than 300 characters' })
  adjustmentReason?: string;

  @ApiPropertyOptional({ 
    description: 'Whether to recalculate dependent metrics after update',
    example: true,
    default: true
  })
  @IsBoolean({ message: 'Recalculate metrics flag must be a boolean' })
  @IsOptional()
  recalculateMetrics?: boolean;
}

/**
 * DTO for bulk device updates
 * 
 * Allows updating multiple devices in a single operation.
 * Useful for organization-wide configuration changes.
 * 
 * @example
 * ```json
 * {
 *   "deviceIds": [789, 790, 791],
 *   "updates": {
 *     "currentStatus": "MAINTENANCE",
 *     "reason": "Firmware update rollout"
 *   },
 *   "operation": "status_update",
 *   "notifyAdmins": true
 * }
 * ```
 */
export class BulkDeviceUpdateDto {
  @ApiProperty({ 
    description: 'Array of device IDs to update',
    type: [Number],
    example: [789, 790, 791],
    minItems: 1,
    maxItems: 100
  })
  @IsArray({ message: 'Device IDs must be an array' })
  @IsNumber({}, { each: true, message: 'Each device ID must be a number' })
  @IsNotEmpty({ message: 'At least one device ID is required' })
  deviceIds: number[];

  @ApiProperty({ 
    description: 'Updates to apply to all specified devices',
    example: {
      "currentStatus": "MAINTENANCE",
      "reason": "Firmware update rollout"
    }
  })
  @IsObject({ message: 'Updates must be a valid object' })
  @IsNotEmpty({ message: 'Updates data is required' })
  updates: Partial<UpdateDeviceDto>;

  @ApiProperty({ 
    description: 'Type of bulk operation being performed',
    enum: ['status_update', 'configuration_update', 'soft_delete', 'restore'],
    example: 'status_update'
  })
  @IsEnum(['status_update', 'configuration_update', 'soft_delete', 'restore'], { 
    message: 'Operation must be status_update, configuration_update, soft_delete, or restore' 
  })
  @IsNotEmpty({ message: 'Operation type is required' })
  operation: 'status_update' | 'configuration_update' | 'soft_delete' | 'restore';

  @ApiPropertyOptional({ 
    description: 'Whether to send notifications about bulk updates',
    example: true,
    default: true
  })
  @IsBoolean({ message: 'Notify admins flag must be a boolean' })
  @IsOptional()
  notifyAdmins?: boolean;

  @ApiPropertyOptional({ 
    description: 'Whether to skip validation for faster processing',
    example: false,
    default: false
  })
  @IsBoolean({ message: 'Skip validation flag must be a boolean' })
  @IsOptional()
  skipValidation?: boolean;
}

/**
 * DTO for device configuration updates
 * 
 * Updates device-specific configuration settings.
 * 
 * @example
 * ```json
 * {
 *   "workingHours": {
 *     "start": "08:00",
 *     "end": "17:00"
 *   },
 *   "alertSettings": {
 *     "lateOpeningThreshold": 15,
 *     "earlyClosingThreshold": 30,
 *     "maintenanceAlerts": true
 *   },
 *   "timezone": "Africa/Johannesburg"
 * }
 * ```
 */
export class UpdateDeviceConfigurationDto {
  @ApiPropertyOptional({ 
    description: 'Expected working hours for the device',
    example: {
      "start": "08:00",
      "end": "17:00"
    }
  })
  @IsObject({ message: 'Working hours must be a valid object' })
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  workingHours?: {
    start: string;
    end: string;
  };

  @ApiPropertyOptional({ 
    description: 'Alert configuration settings',
    example: {
      "lateOpeningThreshold": 15,
      "earlyClosingThreshold": 30,
      "maintenanceAlerts": true,
      "performanceAlerts": true
    }
  })
  @IsObject({ message: 'Alert settings must be a valid object' })
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  alertSettings?: {
    lateOpeningThreshold: number;
    earlyClosingThreshold: number;
    maintenanceAlerts: boolean;
    performanceAlerts: boolean;
  };

  @ApiPropertyOptional({ 
    description: 'Timezone for device operations',
    example: 'Africa/Johannesburg',
    maxLength: 50
  })
  @IsString({ message: 'Timezone must be a string' })
  @IsOptional()
  @Length(0, 50, { message: 'Timezone must be less than 50 characters' })
  timezone?: string;

  @ApiPropertyOptional({ 
    description: 'Reporting configuration settings',
    example: {
      "enableDailyReports": true,
      "enableWeeklyReports": true,
      "reportRecipients": ["admin@orrbit.co.za"]
    }
  })
  @IsObject({ message: 'Reporting settings must be a valid object' })
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  reportingSettings?: {
    enableDailyReports: boolean;
    enableWeeklyReports: boolean;
    enableMonthlyReports: boolean;
    reportRecipients: string[];
  };
}

// Legacy DTO for backward compatibility
export class UpdateIotDto extends PartialType(CreateIotDto) {}