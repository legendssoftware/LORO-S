import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  Query, 
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Headers,
  BadRequestException
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse, 
  ApiQuery, 
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiConsumes,
  ApiProduces,
  ApiUnprocessableEntityResponse,
  ApiHeader
} from '@nestjs/swagger';
import { IotService, PaginatedResponse } from './iot.service';
import { Device, DeviceRecords } from './entities/iot.entity';
import { DeviceStatus, DeviceType } from '../lib/enums/iot';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { 
  CreateIotDto, 
  CreateDeviceDto, 
  CreateDeviceRecordDto, 
  DeviceTimeRecordDto 
} from './dto/create-iot.dto';
import { 
  UpdateIotDto, 
  UpdateDeviceDto, 
  UpdateDeviceRecordDto, 
  UpdateDeviceStatusDto,
  UpdateDeviceAnalyticsDto
} from './dto/update-iot.dto';

@ApiBearerAuth('JWT-auth')
@ApiTags('🤖 IoT Devices & Time Tracking')
@Controller('iot')
@UseGuards(AuthGuard, RoleGuard)
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({ 
  description: '🔒 Unauthorized - Authentication required',
  schema: {
    type: 'object',
    properties: {
      message: { type: 'string', example: 'Authentication token is required' },
      error: { type: 'string', example: 'Unauthorized' },
      statusCode: { type: 'number', example: 401 }
    }
  }
})
/**
 * ## 🎯 IoT Device & Time Tracking Management System
 * 
 * This controller provides comprehensive IoT device management and time tracking capabilities:
 * 
 * ### **Device Management Operations**
 * - **POST /devices** - Register new IoT devices with comprehensive configuration
 * - **GET /devices** - Retrieve devices with advanced filtering and analytics
 * - **GET /devices/:id** - Get detailed device information with historical data
 * - **PATCH /devices/:id** - Update device configuration and settings
 * - **DELETE /devices/:id** - Safely deactivate devices with data preservation
 * 
 * ### **Time Tracking & Records**
 * - **POST /records/time-event** - CORE: Record open/close events from devices
 * - **POST /records** - Create/update time records with smart daily aggregation
 * - **GET /records** - Retrieve time records with comprehensive filtering
 * - **PATCH /records/:id** - Update time records with audit trail
 * 
 * ### **Analytics & Reporting**
 * - **GET /devices/:id/analytics** - Detailed device performance analytics
 * - **GET /analytics/summary** - Organization-wide IoT analytics dashboard
 * 
 * ### **Smart Time Tracking Logic**
 * 
 * #### **Daily Time Record Management:**
 * The system intelligently handles device time events:
 * - **Morning Open Event**: Creates new daily record or updates existing openTime
 * - **Evening Close Event**: Updates same daily record with closeTime
 * - **One Record Per Device Per Day**: Automatic aggregation prevents duplicate records
 * - **Attendance Analytics**: Real-time calculation of attendance patterns
 * 
 * #### **Device Event Processing:**
 * - **Automatic Event Detection**: Determines if event is morning open or evening close
 * - **Smart Analytics**: Updates device analytics (open count, close count, patterns)
 * - **Real-Time Dashboard**: Live updates to attendance dashboards
 * - **Historical Tracking**: Complete audit trail of all device interactions
 * 
 * ### **Business Intelligence Features**
 * - **Attendance Monitoring**: Track employee arrival/departure patterns
 * - **Device Health**: Monitor device status and connectivity
 * - **Usage Analytics**: Analyze device utilization and performance
 * - **Compliance Reporting**: Generate attendance reports for HR/payroll
 * - **Predictive Insights**: Identify patterns and anomalies in time tracking
 * 
 * ### **Security & Access Control**
 * - **Role-Based Access**: Different permissions for admins, managers, and users
 * - **Organization Boundaries**: Devices scoped to organizations and branches
 * - **Audit Trail**: Complete logging of all device and record operations
 * - **Data Encryption**: Secure handling of all time tracking data
 */
export class IotController {
  constructor(private readonly iotService: IotService) {}

  /**
   * Determines access scope for the authenticated user
   * @param user - Authenticated user object
   * @returns Access scope with orgId and branchId (null for org-wide access)
   */
  private getAccessScope(user: any) {
    const isElevatedUser = [
      AccessLevel.ADMIN,
      AccessLevel.OWNER,
      AccessLevel.MANAGER,
      AccessLevel.DEVELOPER,
      AccessLevel.SUPPORT
    ].includes(user?.role);

    const orgId = user?.org?.uid || user?.organisationRef;
    const branchId = isElevatedUser ? null : user?.branch?.uid; // null = org-wide access for elevated users

    return {
      orgId,
      branchId,
      isElevated: isElevatedUser
    };
  }

  /**
   * Extracts time event data with header priority over body values
   * @param bodyData - Data from request body (DeviceTimeRecordDto)
   * @param req - Authenticated request containing headers
   * @returns Merged data with source information
   */
  private extractTimeEventData(bodyData: DeviceTimeRecordDto, req: AuthenticatedRequest) {
    const headers = req.headers;
    const sources: string[] = [];
    
    // Helper function to safely parse JSON metadata
    const parseMetadata = (metadataStr: string): Record<string, any> | undefined => {
      try {
        return JSON.parse(metadataStr);
      } catch (error) {
        // Log warning but don't fail the request
        console.warn('Failed to parse metadata JSON from header:', metadataStr, error);
        return undefined;
      }
    };

    // Extract values with header priority
    const mergedData: DeviceTimeRecordDto = {
      deviceID: (headers['x-device-id'] as string) || bodyData.deviceID,
      eventType: (headers['x-event-type'] as 'open' | 'close') || bodyData.eventType,
      timestamp: headers['x-timestamp'] 
        ? parseInt(headers['x-timestamp'] as string, 10) 
        : bodyData.timestamp,
      location: (headers['x-location'] as string) || bodyData.location,
      ipAddress: (headers['x-ip-address'] as string) || bodyData.ipAddress,
      metadata: headers['x-metadata'] 
        ? parseMetadata(headers['x-metadata'] as string) || bodyData.metadata
        : bodyData.metadata
    };

    // Track data sources for debugging and transparency
    if (headers['x-device-id']) sources.push('deviceID from header');
    else if (bodyData.deviceID) sources.push('deviceID from body');

    if (headers['x-event-type']) sources.push('eventType from header');
    else if (bodyData.eventType) sources.push('eventType from body');

    if (headers['x-timestamp']) sources.push('timestamp from header');
    else if (bodyData.timestamp) sources.push('timestamp from body');

    if (headers['x-location']) sources.push('location from header');
    else if (bodyData.location) sources.push('location from body');

    if (headers['x-ip-address']) sources.push('ipAddress from header');
    else if (bodyData.ipAddress) sources.push('ipAddress from body');

    if (headers['x-metadata']) sources.push('metadata from header');
    else if (bodyData.metadata) sources.push('metadata from body');

    // Determine overall source classification
    const hasHeaderData = Object.keys(headers).some(key => key.startsWith('x-'));
    const hasBodyData = Object.values(bodyData).some(value => value !== undefined && value !== null);
    
    let sourceType: string;
    if (hasHeaderData && hasBodyData) {
      sourceType = 'mixed';
    } else if (hasHeaderData) {
      sourceType = 'headers';
    } else {
      sourceType = 'body';
    }

    return {
      data: mergedData,
      sources,
      sourceType
    };
  }

  // Device Management Endpoints
  @Post('devices')
  @Roles(
    AccessLevel.ADMIN,
    AccessLevel.MANAGER,
    AccessLevel.SUPPORT,
    AccessLevel.DEVELOPER,
    AccessLevel.OWNER,
    AccessLevel.TECHNICIAN,
  )
  @ApiOperation({
    summary: '🤖 Register a new IoT device',
    description: `
# IoT Device Registration System

Register new IoT devices in your organization with comprehensive configuration and automatic integration capabilities.

## 📋 **Core Features**
- **Device Registration**: Complete device setup with unique identifiers and network configuration
- **Organization Integration**: Automatic assignment to organization and branch structure
- **Analytics Initialization**: Real-time analytics setup for attendance and usage tracking
- **Security Configuration**: Secure device authentication and access control setup
- **Network Validation**: IP address and port validation with connectivity testing
- **Status Monitoring**: Automatic device health monitoring and status reporting

## 🔧 **Device Configuration**
- **Network Settings**: IP address, port, and connectivity configuration
- **Physical Location**: Detailed location tracking for device placement
- **Device Types**: Support for door sensors, cameras, RFID readers, and more
- **Tag System**: Flexible tagging for device categorization and management
- **Analytics Setup**: Automatic initialization of performance tracking metrics

## 🎯 **Use Cases**
- **Access Control**: Door sensors for employee entry/exit tracking
- **Attendance Monitoring**: Automatic time and attendance recording
- **Security Systems**: Integration with security cameras and access control
- **Asset Tracking**: RFID and barcode readers for inventory management
- **Environmental Monitoring**: Temperature, humidity, and occupancy sensors
- **Meeting Rooms**: Room occupancy and booking system integration

## 🔒 **Security Features**
- **Unique Device IDs**: Prevent device duplication and conflicts
- **Network Security**: Secure communication protocols and encryption
- **Access Control**: Role-based device management permissions
- **Audit Trail**: Complete logging of device registration and configuration
- **Organization Boundaries**: Devices scoped to specific organizations and branches

## 📊 **Analytics & Monitoring**
- **Real-Time Status**: Live device connectivity and health monitoring
- **Usage Analytics**: Device utilization patterns and performance metrics
- **Attendance Tracking**: Automatic employee time tracking and reporting
- **Historical Data**: Complete history of device interactions and events
- **Performance Metrics**: Device reliability and uptime statistics

## 🎪 **Business Intelligence**
- **Workforce Analytics**: Employee attendance patterns and insights
- **Facility Utilization**: Space usage and occupancy analytics
- **Security Insights**: Access patterns and security event analysis
- **Operational Efficiency**: Device performance and maintenance scheduling
- **Compliance Reporting**: Automated reports for HR and regulatory requirements
    `,
    operationId: 'registerIoTDevice',
  })
  @ApiBody({ 
    type: CreateDeviceDto,
    description: 'Complete device registration configuration with network and location settings',
    examples: {
      doorSensor: {
        summary: '🚪 Door Sensor Registration',
        description: 'Register a door sensor for employee entry/exit tracking',
        value: {
          orgID: 1,
          branchID: 1,
          deviceID: 'DOOR_SENSOR_MAIN_001',
          deviceType: DeviceType.DOOR_SENSOR,
          deviceIP: '192.168.1.100',
          devicePort: 8080,
          devicLocation: 'Main Entrance - Pretoria South Africa',
          deviceTag: 'main-entrance-door',
          currentStatus: DeviceStatus.ONLINE,
          analytics: {
            openCount: 0,
            closeCount: 0,
            totalCount: 0,
            lastOpenAt: new Date(),
            lastCloseAt: new Date(),
            onTimeCount: 0,
            lateCount: 0,
            daysAbsent: 0,
          }
        }
      },
      rfidReader: {
        summary: '📱 RFID Reader Registration',
        description: 'Register an RFID reader for access control and tracking',
        value: {
          orgID: 1,
          branchID: 1,
          deviceID: 'RFID_READER_002',
          deviceType: DeviceType.RFID,
          deviceIP: '192.168.1.101',
          devicePort: 9090,
          devicLocation: 'Server Room - Orrbit Technologies Building',
          deviceTag: 'server-room-access',
          currentStatus: DeviceStatus.ONLINE
        }
      },
      securityCamera: {
        summary: '📹 Security Camera Registration',
        description: 'Register a security camera for monitoring and analytics',
        value: {
          orgID: 1,
          branchID: 1,
          deviceID: 'CAMERA_LOBBY_003',
          deviceType: DeviceType.CAMERA,
          deviceIP: '192.168.1.102',
          devicePort: 8554,
          devicLocation: 'Lobby Area - Main Building',
          deviceTag: 'lobby-security',
          currentStatus: DeviceStatus.ONLINE
        }
      }
    }
  })
  @ApiCreatedResponse({
    description: '✅ IoT device registered successfully',
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'string', 
          example: 'Device created successfully',
          description: 'Success message confirming device registration'
        },
        device: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 1, description: 'Internal device database ID' },
            deviceID: { type: 'string', example: 'DOOR_SENSOR_MAIN_001', description: 'Unique device identifier' },
            deviceType: { type: 'string', example: 'door_sensor', description: 'Type of IoT device' },
            currentStatus: { type: 'string', example: 'online', description: 'Current device status' }
          }
        }
      },
      required: ['message', 'device']
    }
  })
  @ApiBadRequestResponse({ 
    description: '❌ Bad Request - Invalid device configuration',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Failed to create device' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
        validationErrors: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'deviceID must be a non-empty string',
            'deviceIP must be a valid IP address',
            'devicePort must be a valid port number',
            'orgID must be a positive number',
            'branchID must be a positive number'
          ]
        }
      }
    }
  })
  @ApiForbiddenResponse({
    description: '🚫 Forbidden - Insufficient permissions',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'You do not have permission to register devices in this organization' },
        error: { type: 'string', example: 'Forbidden' },
        statusCode: { type: 'number', example: 403 }
      }
    }
  })
  @ApiConflictResponse({
    description: '⚠️ Conflict - Device ID already exists',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Device with ID DOOR_SENSOR_MAIN_001 already exists' },
        error: { type: 'string', example: 'Conflict' },
        statusCode: { type: 'number', example: 409 },
        conflictingDevice: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 5 },
            deviceID: { type: 'string', example: 'DOOR_SENSOR_MAIN_001' },
            location: { type: 'string', example: 'Main Entrance' }
          }
        }
      }
    }
  })
  @ApiInternalServerErrorResponse({
    description: '💥 Internal Server Error - Device registration failed',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Failed to create device due to system error' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:00:00Z' },
        path: { type: 'string', example: '/iot/devices' }
      }
    }
  })
  createDevice(@Body() createDeviceDto: CreateDeviceDto, @Req() req: AuthenticatedRequest) {
    const accessScope = this.getAccessScope(req.user);
    
    // Automatically set orgId and branchId from authenticated user if not provided
    if (!createDeviceDto.orgID) {
      createDeviceDto.orgID = accessScope.orgId;
    }
    if (!createDeviceDto.branchID) {
      createDeviceDto.branchID = accessScope.branchId;
    }

    return this.iotService.createDevice(createDeviceDto);
  }

  @Get('devices')
  @ApiOperation({ summary: 'Get all devices with optional filtering' })
  @ApiQuery({ name: 'orgId', required: false, type: Number })
  @ApiQuery({ name: 'branchId', required: false, type: Number })
  @ApiQuery({ name: 'deviceType', required: false, enum: ['door_sensor', 'camera', 'sensor', 'actuator', 'controller', 'gateway', 'rfid', 'nfc', 'barcode', 'beacon', 'other'] })
  @ApiQuery({ name: 'status', required: false, enum: ['online', 'offline', 'maintenance', 'disconnected'] })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10)' })
  @ApiResponse({ status: 200, description: 'Devices retrieved successfully' })
  findAllDevices(
    @Query('orgId') orgId?: number,
    @Query('branchId') branchId?: number,
    @Query('deviceType') deviceType?: string,
    @Query('status') status?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10
  ) {
    return this.iotService.findAllDevices({ orgId, branchId, deviceType, status }, page, limit);
  }

  @Get('devices/:id')
  @ApiOperation({ summary: 'Get device by ID with records' })
  @ApiResponse({ status: 200, description: 'Device found successfully' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  findOneDevice(@Param('id', ParseIntPipe) id: number) {
    return this.iotService.findOneDevice(id);
  }

  @Get('devices/by-device-id/:deviceId')
  @ApiOperation({ summary: 'Get device by unique device ID' })
  @ApiResponse({ status: 200, description: 'Device found successfully' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  findDeviceByDeviceId(@Param('deviceId') deviceId: string) {
    return this.iotService.findDeviceByDeviceId(deviceId);
  }

  @Patch('devices/:id')
  @ApiOperation({ summary: 'Update device information' })
  @ApiResponse({ status: 200, description: 'Device updated successfully' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  updateDevice(@Param('id', ParseIntPipe) id: number, @Body() updateDeviceDto: UpdateDeviceDto) {
    return this.iotService.updateDevice(id, updateDeviceDto);
  }

  @Patch('devices/:id/status')
  @ApiOperation({ summary: 'Update device status' })
  @ApiResponse({ status: 200, description: 'Device status updated successfully' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  updateDeviceStatus(@Param('id', ParseIntPipe) id: number, @Body() statusDto: UpdateDeviceStatusDto) {
    return this.iotService.updateDeviceStatus(id, statusDto);
  }

  @Patch('devices/:id/analytics')
  @ApiOperation({ summary: 'Update device analytics' })
  @ApiResponse({ status: 200, description: 'Device analytics updated successfully' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  updateDeviceAnalytics(@Param('id', ParseIntPipe) id: number, @Body() analyticsDto: UpdateDeviceAnalyticsDto) {
    return this.iotService.updateDeviceAnalytics(id, analyticsDto);
  }

  @Delete('devices/:id')
  @ApiOperation({ summary: 'Soft delete a device' })
  @ApiResponse({ status: 200, description: 'Device deleted successfully' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  removeDevice(@Param('id', ParseIntPipe) id: number) {
    return this.iotService.removeDevice(id);
  }

  // Device Records Management Endpoints
  @Post('records')
  @ApiOperation({ summary: 'Create or update device record' })
  @ApiResponse({ status: 201, description: 'Record created/updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid record data' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  createOrUpdateRecord(@Body() recordDto: CreateDeviceRecordDto) {
    return this.iotService.createOrUpdateRecord(recordDto);
  }

  @Post('records/time-event')
  @Roles(
    AccessLevel.ADMIN,
    AccessLevel.MANAGER,
    AccessLevel.SUPPORT,
    AccessLevel.DEVELOPER,
    AccessLevel.USER,
    AccessLevel.OWNER,
    AccessLevel.TECHNICIAN,
  )
  @ApiOperation({
    summary: '⏰ CORE: Record Device Open/Close Time Event',
    description: `
# Smart Time Tracking Event System

**THIS IS THE CORE ENDPOINT** that IoT devices use to record employee arrival and departure times with intelligent daily record management.

## 🎯 Core Functionality
This endpoint processes time events from IoT devices and automatically manages daily attendance records with smart logic for morning arrivals and evening departures.

## 📊 Smart Daily Record Logic
- **One Record Per Device Per Day**: Prevents duplicate attendance records
- **Automatic Aggregation**: Morning open + Evening close = Complete daily record
- **Real-Time Analytics**: Updates attendance metrics immediately

## 🔄 Event Type Logic
- **"open" Events:** Creates new daily record or updates openTime
- **"close" Events:** Updates existing record with closeTime

## 🔧 Flexible Data Input
This endpoint accepts data through **TWO METHODS** with **HEADER PRIORITY**:

### 1️⃣ Headers (PRIORITY) - Perfect for IoT devices with limited payload capacity
- X-Device-ID: Device identifier (e.g., "DOOR_SENSOR_001")
- X-Event-Type: Event type ("open" or "close")
- X-Timestamp: Unix timestamp (e.g., 1672905600)
- X-Location: Device location (optional)
- X-IP-Address: Source IP address (optional)
- X-Metadata: JSON metadata string (optional)

### 2️⃣ JSON Body (FALLBACK) - Traditional REST API approach
Standard JSON payload with deviceID, eventType, timestamp, location, ipAddress, and metadata fields.

### 🎯 Priority Logic:
1. **Headers are checked FIRST** - if present, they override body values
2. **Body values used as FALLBACK** - when headers are missing
3. **Mixed usage supported** - combine headers + body for maximum flexibility

## 🚀 IoT Device Integration Examples

### Minimal Header-Only Request:
Send POST to /iot/records/time-event with headers: X-Device-ID, X-Event-Type, X-Timestamp and empty body.

### Full Header Request:
Include all optional headers like X-Location, X-IP-Address, X-Metadata along with required headers.

### Traditional JSON Body:
Standard REST API call with complete JSON payload in request body.

### Mixed Headers + Body:
Headers override body values where present - useful for partial overrides.

## 🎯 Use Cases
- **Employee Attendance**: Automatic arrival/departure tracking
- **Access Control**: Door sensor integration for security
- **Work Hours**: Precise calculation of daily work hours
- **IoT Protocol Flexibility**: Support various IoT communication patterns
- **Lightweight Devices**: Minimize payload for resource-constrained devices
    `,
    operationId: 'recordDeviceTimeEvent',
  })
  @ApiHeader({
    name: 'X-Device-ID',
    description: 'Device identifier (takes priority over body.deviceID)',
    required: false,
    example: 'DOOR_SENSOR_001'
  })
  @ApiHeader({
    name: 'X-Event-Type',
    description: 'Event type: "open" or "close" (takes priority over body.eventType)',
    required: false,
    example: 'open'
  })
  @ApiHeader({
    name: 'X-Timestamp',
    description: 'Unix timestamp in seconds (takes priority over body.timestamp)',
    required: false,
    example: '1672905600'
  })
  @ApiHeader({
    name: 'X-Location',
    description: 'Device location (takes priority over body.location)',
    required: false,
    example: 'Main Entrance - Pretoria South Africa'
  })
  @ApiHeader({
    name: 'X-IP-Address',
    description: 'Source IP address (takes priority over body.ipAddress)',
    required: false,
    example: '192.168.1.100'
  })
  @ApiHeader({
    name: 'X-Metadata',
    description: 'JSON metadata string (takes priority over body.metadata)',
    required: false,
    example: '{"batteryLevel":92,"signalStrength":85}'
  })
  @ApiBody({
    type: DeviceTimeRecordDto,
    required: false,
    description: 'Optional JSON body - all fields can be provided via headers instead. Headers take priority when both are present.',
    examples: {
      fullBody: {
        summary: '📄 Complete JSON Body',
        description: 'Traditional REST API approach with all data in body',
        value: {
          deviceID: 'DOOR_SENSOR_001',
          eventType: 'open',
          timestamp: 1672905600,
          location: 'Main Entrance - Pretoria South Africa',
          ipAddress: '192.168.1.100',
          metadata: {
            batteryLevel: 92,
            signalStrength: 85,
            firmwareVersion: '2.1.3'
          }
        }
      },
      emptyBody: {
        summary: '🏷️ Header-Only Request (Empty Body)',
        description: 'IoT-friendly approach using only headers with empty body',
        value: {}
      },
      partialBody: {
        summary: '🔄 Mixed Headers + Body',
        description: 'Headers override body values where present',
        value: {
          deviceID: 'BODY_DEVICE_001',
          timestamp: 1672905600,
          metadata: { note: 'This will be used if no X-Metadata header' }
        }
      }
    }
  })
  @ApiCreatedResponse({
    description: '✅ Time event recorded successfully',
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'string', 
          example: 'Record updated successfully',
        },
        record: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 42 },
            openTime: { type: 'number', example: 1640995200 },
            closeTime: { type: 'number', example: 1641027600 },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        source: {
          type: 'string',
          example: 'headers',
          description: 'Data source used: "headers", "body", or "mixed"'
        },
        debug: {
          type: 'object',
          description: 'Debug information about data sources (only in development)',
          properties: {
            sourcesUsed: {
              type: 'array',
              items: { type: 'string' },
              example: ['deviceID from header', 'eventType from header', 'timestamp from body']
            }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ 
    description: '❌ Bad Request - Invalid time event data',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Failed to record time event' },
        statusCode: { type: 'number', example: 400 },
        details: {
          type: 'object',
          properties: {
            missingFields: {
              type: 'array',
              items: { type: 'string' },
              example: ['deviceID', 'eventType', 'timestamp']
            },
            invalidFields: {
              type: 'array',
              items: { type: 'string' },
              example: ['timestamp must be a valid Unix timestamp']
            }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({
    description: '🔍 Device not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Device not found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  @HttpCode(HttpStatus.CREATED)
  recordTimeEvent(@Body() timeEventDto: Partial<DeviceTimeRecordDto> = {}, @Req() req: AuthenticatedRequest) {
    // Extract values from headers with priority over body
    const mergedData = this.extractTimeEventData(timeEventDto as DeviceTimeRecordDto, req);
    
    // Validate that we have the required fields from either headers or body
    const missingFields: string[] = [];
    if (!mergedData.data.deviceID) missingFields.push('deviceID');
    if (!mergedData.data.eventType) missingFields.push('eventType');
    if (!mergedData.data.timestamp) missingFields.push('timestamp');
    
    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: 'Missing required fields',
        details: {
          missingFields,
          note: 'Required fields can be provided via headers (X-Device-ID, X-Event-Type, X-Timestamp) or request body',
          sources: mergedData.sources
        }
      });
    }
    
    // Validate eventType
    if (mergedData.data.eventType && !['open', 'close'].includes(mergedData.data.eventType)) {
      throw new BadRequestException({
        message: 'Invalid event type',
        details: {
          providedValue: mergedData.data.eventType,
          allowedValues: ['open', 'close'],
          field: 'eventType'
        }
      });
    }
    
    return this.iotService.recordTimeEvent(mergedData.data);
  }

  @Get('records')
  @ApiOperation({ summary: 'Get all device records with filtering' })
  @ApiQuery({ name: 'deviceId', required: false, type: Number })
  @ApiQuery({ name: 'orgId', required: false, type: Number })
  @ApiQuery({ name: 'branchId', required: false, type: Number })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Start date (ISO string)' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'End date (ISO string)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10)' })
  @ApiResponse({ status: 200, description: 'Records retrieved successfully' })
  findAllRecords(
    @Query('deviceId') deviceId?: number,
    @Query('orgId') orgId?: number,
    @Query('branchId') branchId?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10
  ) {
    return this.iotService.findAllRecords({ 
      deviceId, 
      orgId, 
      branchId, 
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined
    }, page, limit);
  }

  @Get('records/:id')
  @ApiOperation({ summary: 'Get record by ID' })
  @ApiResponse({ status: 200, description: 'Record found successfully' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  findOneRecord(@Param('id', ParseIntPipe) id: number) {
    return this.iotService.findOneRecord(id);
  }

  @Patch('records/:id')
  @ApiOperation({ summary: 'Update device record' })
  @ApiResponse({ status: 200, description: 'Record updated successfully' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  updateRecord(@Param('id', ParseIntPipe) id: number, @Body() updateRecordDto: UpdateDeviceRecordDto) {
    return this.iotService.updateRecord(id, updateRecordDto);
  }

  @Delete('records/:id')
  @ApiOperation({ summary: 'Delete device record' })
  @ApiResponse({ status: 200, description: 'Record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  removeRecord(@Param('id', ParseIntPipe) id: number) {
    return this.iotService.removeRecord(id);
  }

  // Analytics and Reporting Endpoints
  @Get('devices/:id/analytics')
  @ApiOperation({ summary: 'Get device analytics and statistics' })
  @ApiResponse({ status: 200, description: 'Analytics retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  getDeviceAnalytics(@Param('id', ParseIntPipe) id: number) {
    return this.iotService.getDeviceAnalytics(id);
  }

  @Get('analytics/summary')
  @ApiOperation({ summary: 'Get organization/branch analytics summary' })
  @ApiQuery({ name: 'orgId', required: false, type: Number })
  @ApiQuery({ name: 'branchId', required: false, type: Number })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Analytics summary retrieved successfully' })
  getAnalyticsSummary(
    @Query('orgId') orgId?: number,
    @Query('branchId') branchId?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.iotService.getAnalyticsSummary({
      orgId,
      branchId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined
    });
  }

  // IoT Device Reporting Endpoints (Similar to Attendance Reports)
  @Get('reports/morning')
  @Roles(
    AccessLevel.ADMIN,
    AccessLevel.MANAGER,
    AccessLevel.OWNER,
    AccessLevel.SUPPORT,
    AccessLevel.DEVELOPER
  )
  @ApiOperation({
    summary: '🌅 Generate Morning IoT Device Report',
    description: `
# Morning IoT Device Monitoring Report

**Similar to Morning Attendance Reports** - This endpoint generates comprehensive morning reports for IoT device monitoring, focusing on device startup times, availability, and early detection of issues.

## 📋 **Report Features**
- **Device Startup Analysis**: Monitor device opening times and punctuality
- **Overnight Issue Detection**: Identify devices that went offline overnight
- **Early/Late Opening Alerts**: Track devices opening outside expected hours
- **Branch Performance**: Compare device performance across different branches
- **Real-Time Dashboard**: Live device status and availability metrics

## 🎯 **Key Metrics Included**
- **Total Active Devices**: Count of operational devices
- **Device Availability**: Percentage of devices online and responding
- **Opening Punctuality**: Devices opening on time vs late
- **Overnight Issues**: Devices that encountered problems overnight
- **Branch Comparison**: Performance metrics by branch location

## 📊 **Report Sections**
- **Executive Summary**: High-level device performance overview
- **Device Status Breakdown**: Detailed analysis by branch and device type
- **Alert Summary**: Critical, warning, and info alerts for immediate action
- **Top Performers**: Best performing devices and locations
- **Concerning Devices**: Devices requiring attention or maintenance
- **Recommendations**: Actionable insights for improving device performance

## 🎪 **Business Intelligence**
- **Facility Management**: Monitor building access and usage patterns
- **Security Insights**: Track access control and security device status
- **Operational Efficiency**: Identify device maintenance needs
- **Compliance Monitoring**: Ensure devices meet operational requirements
- **Cost Optimization**: Optimize device placement and maintenance schedules

## 📧 **Automated Delivery**
Reports are automatically sent to administrators and owners:
- **Email Recipients**: admin@orrbit.co.za, owner@orrbit.co.za
- **Delivery Time**: Every morning at 8:00 AM
- **Format Options**: JSON (API), PDF (email), Excel (export)
    `,
    operationId: 'generateMorningIoTReport',
  })
  @ApiQuery({ 
    name: 'orgId', 
    required: false, 
    type: Number, 
    description: 'Organization ID (defaults to user organization)',
    example: 123
  })
  @ApiQuery({ 
    name: 'branchIds', 
    required: false, 
    type: String, 
    description: 'Comma-separated branch IDs to include',
    example: '456,789'
  })
  @ApiQuery({ 
    name: 'includeAnalytics', 
    required: false, 
    type: Boolean, 
    description: 'Include detailed analytics in response',
    example: true
  })
  @ApiOkResponse({
    description: '✅ Morning IoT device report generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Morning IoT device report generated successfully' },
        data: {
          type: 'object',
          properties: {
            reportDate: { type: 'string', example: '2025-01-04' },
            generatedAt: { type: 'string', format: 'date-time' },
            organizationId: { type: 'number', example: 123 },
            summary: {
              type: 'object',
              properties: {
                totalDevices: { type: 'number', example: 25 },
                activeDevices: { type: 'number', example: 23 },
                onlineDevices: { type: 'number', example: 22 },
                offlineDevices: { type: 'number', example: 3 },
                punctualityRate: { type: 'number', example: 87.5 },
                organizationEfficiency: { type: 'number', example: 91.2 }
              }
            },
            alerts: {
              type: 'object',
              properties: {
                critical: { 
                  type: 'array', 
                  items: { type: 'string' },
                  example: ['2 devices are offline and not responding']
                },
                warning: { 
                  type: 'array', 
                  items: { type: 'string' },
                  example: ['3 devices opened late this morning']
                }
              }
            }
          }
        },
        timestamp: { type: 'string', format: 'date-time' },
        requestId: { type: 'string', example: 'morning_report_1704369600000' }
      }
    }
  })
  @ApiBadRequestResponse({
    description: '❌ Bad Request - Invalid report parameters',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Invalid organization ID provided' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  generateMorningReport(
    @Req() req: AuthenticatedRequest,
    @Query('orgId') orgId?: number,
    @Query('branchIds') branchIds?: string,
    @Query('includeAnalytics') includeAnalytics?: boolean
  ) {
    const accessScope = this.getAccessScope(req.user);
    const organizationId = orgId || accessScope.orgId;
    const branchIdArray = branchIds ? branchIds.split(',').map(id => parseInt(id.trim())) : undefined;

    return this.iotService.generateMorningReport({
      orgId: organizationId,
      branchIds: branchIdArray,
      reportType: 'morning',
      includeAnalytics: includeAnalytics ?? true,
    });
  }

  @Get('reports/evening')
  @Roles(
    AccessLevel.ADMIN,
    AccessLevel.MANAGER,
    AccessLevel.OWNER,
    AccessLevel.SUPPORT,
    AccessLevel.DEVELOPER
  )
  @ApiOperation({
    summary: '🌆 Generate Evening IoT Device Report',
    description: `
# Evening IoT Device Performance Report

**Similar to Evening Attendance Reports** - This endpoint generates comprehensive evening reports for IoT device monitoring, focusing on daily usage analytics, performance metrics, and next-day preparation.

## 📋 **Report Features**
- **Daily Usage Analytics**: Complete analysis of device usage throughout the day
- **Performance Metrics**: Device efficiency, uptime, and reliability scores
- **Closing Time Analysis**: Monitor device shutdown times and patterns
- **Work Hours Calculation**: Total operational hours and usage patterns
- **Next Day Preparation**: Insights for tomorrow's device operations

## 🎯 **Key Metrics Included**
- **Total Operational Hours**: Device usage time across the organization
- **Efficiency Scores**: Performance ratings for each device and branch
- **Closing Punctuality**: Devices closing on time vs early/late
- **Daily Events**: Total open/close events and system interactions
- **Reliability Metrics**: Device uptime and connectivity statistics

## 📊 **Report Sections**
- **Daily Performance Summary**: Overall device performance for the day
- **Usage Analytics**: Detailed device utilization patterns
- **Branch Performance**: Comparative analysis across branches
- **Top Performers**: Best performing devices and highest efficiency scores
- **Performance Issues**: Devices with low efficiency or reliability
- **Tomorrow's Planning**: Preparation and recommendations for next day

## 🎪 **Business Intelligence**
- **Operational Insights**: Understanding facility usage patterns
- **Maintenance Planning**: Identify devices needing service or replacement
- **Resource Optimization**: Optimize device placement and configuration
- **Security Analysis**: Review access patterns and security events
- **Cost Management**: Track device performance ROI and efficiency

## 📧 **Automated Delivery**
Reports are automatically sent to administrators and owners:
- **Email Recipients**: admin@orrbit.co.za, owner@orrbit.co.za
- **Delivery Time**: Every evening at 6:00 PM
- **Format Options**: JSON (API), PDF (email), Excel (export)
    `,
    operationId: 'generateEveningIoTReport',
  })
  @ApiQuery({ 
    name: 'orgId', 
    required: false, 
    type: Number, 
    description: 'Organization ID (defaults to user organization)',
    example: 123
  })
  @ApiQuery({ 
    name: 'branchIds', 
    required: false, 
    type: String, 
    description: 'Comma-separated branch IDs to include',
    example: '456,789'
  })
  @ApiQuery({ 
    name: 'includeAnalytics', 
    required: false, 
    type: Boolean, 
    description: 'Include detailed analytics in response',
    example: true
  })
  @ApiOkResponse({
    description: '✅ Evening IoT device report generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Evening IoT device report generated successfully' },
        data: {
          type: 'object',
          properties: {
            reportDate: { type: 'string', example: '2025-01-04' },
            generatedAt: { type: 'string', format: 'date-time' },
            organizationId: { type: 'number', example: 123 },
            summary: {
              type: 'object',
              properties: {
                totalDevices: { type: 'number', example: 25 },
                totalWorkingHours: { type: 'number', example: 187.5 },
                averageUptime: { type: 'number', example: 94.2 },
                organizationEfficiency: { type: 'number', example: 88.7 },
                totalCloseEvents: { type: 'number', example: 22 }
              }
            },
            insights: {
              type: 'object',
              properties: {
                topPerformingDevices: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      deviceID: { type: 'string', example: 'DOOR_SENSOR_001' },
                      efficiency: { type: 'number', example: 96.5 },
                      uptime: { type: 'number', example: 99.2 }
                    }
                  }
                }
              }
            }
          }
        },
        timestamp: { type: 'string', format: 'date-time' },
        requestId: { type: 'string', example: 'evening_report_1704398400000' }
      }
    }
  })
  generateEveningReport(
    @Req() req: AuthenticatedRequest,
    @Query('orgId') orgId?: number,
    @Query('branchIds') branchIds?: string,
    @Query('includeAnalytics') includeAnalytics?: boolean
  ) {
    const accessScope = this.getAccessScope(req.user);
    const organizationId = orgId || accessScope.orgId;
    const branchIdArray = branchIds ? branchIds.split(',').map(id => parseInt(id.trim())) : undefined;

    return this.iotService.generateEveningReport({
      orgId: organizationId,
      branchIds: branchIdArray,
      reportType: 'evening',
      includeAnalytics: includeAnalytics ?? true,
    });
  }

  @Get('reports/device-timings/:deviceId')
  @Roles(
    AccessLevel.ADMIN,
    AccessLevel.MANAGER,
    AccessLevel.OWNER,
    AccessLevel.SUPPORT,
    AccessLevel.DEVELOPER
  )
  @ApiOperation({
    summary: '⏱️ Calculate Device Open/Close Times & Punctuality',
    description: `
# Device Time Analysis & Punctuality Calculator

Calculates comprehensive timing metrics for individual devices, including open/close time analysis, punctuality rates, and performance indicators.

## 📊 **Calculated Metrics**
- **Opening Punctuality**: Percentage of on-time vs late openings
- **Closing Punctuality**: Percentage of on-time vs early closings
- **Uptime Percentage**: Device availability and operational time
- **Efficiency Score**: Overall device performance rating
- **Reliability Score**: Device consistency and dependability
- **Maintenance Needed**: Automated assessment of service requirements

## 🎯 **Use Cases**
- **Performance Monitoring**: Track individual device performance over time
- **Maintenance Planning**: Identify devices requiring service or replacement
- **Compliance Reporting**: Generate timing reports for operational audits
- **Optimization**: Improve device placement and configuration
- **Troubleshooting**: Diagnose timing and performance issues
    `,
    operationId: 'calculateDeviceTimings',
  })
  @ApiParam({
    name: 'deviceId',
    description: 'Database ID of the device to analyze',
    example: 789,
    type: 'number'
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for analysis (ISO string, defaults to 30 days ago)',
    example: '2025-01-01T00:00:00.000Z'
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for analysis (ISO string, defaults to now)',
    example: '2025-01-04T23:59:59.999Z'
  })
  @ApiOkResponse({
    description: '✅ Device timing analysis completed successfully',
    schema: {
      type: 'object',
      properties: {
        deviceId: { type: 'number', example: 789 },
        openTimePunctuality: { type: 'number', example: 87.5, description: 'Percentage of on-time openings' },
        closeTimePunctuality: { type: 'number', example: 92.3, description: 'Percentage of on-time closings' },
        uptimePercentage: { type: 'number', example: 94.7, description: 'Device availability percentage' },
        efficiencyScore: { type: 'number', example: 91.5, description: 'Overall efficiency rating' },
        reliabilityScore: { type: 'number', example: 89.2, description: 'Device reliability rating' },
        maintenanceNeeded: { type: 'boolean', example: false, description: 'Whether device needs maintenance' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: '🔍 Device not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Device with ID 789 not found' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  calculateDeviceTimings(
    @Param('deviceId', ParseIntPipe) deviceId: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const dateRange = (startDate && endDate) ? {
      start: new Date(startDate),
      end: new Date(endDate)
    } : undefined;

    return this.iotService.calculateDeviceTimings(deviceId, dateRange);
  }
}
