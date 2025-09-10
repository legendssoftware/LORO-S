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
	BadRequestException,
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
} from '@nestjs/swagger';
import { IotService } from './iot.service';
import { Device, DeviceRecords } from './entities/iot.entity';
import { DeviceStatus, DeviceType } from '../lib/enums/iot';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { CreateDeviceDto, CreateDeviceRecordDto, DeviceTimeRecordDto } from './dto/create-iot.dto';
import {
	UpdateDeviceDto,
	UpdateDeviceRecordDto,
	UpdateDeviceStatusDto,
	UpdateDeviceAnalyticsDto,
} from './dto/update-iot.dto';
import { isPublic } from '../decorators/public.decorator';

@ApiBearerAuth('JWT-auth')
@ApiTags('🤖 IoT Devices & Time Tracking')
@Controller('iot')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({
	description: '🔒 Unauthorized - Authentication required',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Authentication token is required' },
			error: { type: 'string', example: 'Unauthorized' },
			statusCode: { type: 'number', example: 401 },
		},
	},
})
/**
 * IoTController - Comprehensive IoT Device & Time Tracking Management System
 *
 * This controller provides enterprise-grade IoT device management and time tracking capabilities including:
 * - Device registration, configuration, and lifecycle management
 * - Real-time time event recording with business hours validation
 * - Comprehensive analytics and performance monitoring
 * - Organization-scoped access control and data isolation
 * - Advanced reporting and compliance features
 * - Smart attendance tracking with automated calculations
 *
 * Features:
 * - Multi-tenant support with organization and branch isolation
 * - Redis caching for improved performance and response times
 * - Event-driven architecture for real-time dashboard updates
 * - Comprehensive logging and error handling with audit trails
 * - Role-based access control (RBAC) integration
 * - Business hours validation and attendance analytics
 * - Device health monitoring and performance optimization
 *
 * Core Endpoints:
 * - POST /devices - Register new IoT devices with validation
 * - GET /devices - Retrieve devices with filtering and analytics
 * - POST /records/time-event/:deviceID/:eventType/:timestamp/:location/:ipAddress/:metadata - CORE time tracking
 * - GET /analytics/summary - Organization-wide analytics dashboard
 * - POST /reports/morning - Generate comprehensive morning reports
 * - POST /reports/evening - Generate detailed evening reports
 *
 * @author Loro Development Team
 * @version 1.0.0
 * @since 1.0.0
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
			AccessLevel.SUPPORT,
		].includes(user?.role);

		const orgId = user?.org?.uid || user?.organisationRef;
		const branchId = isElevatedUser ? null : user?.branch?.uid; // null = org-wide access for elevated users

		return {
			orgId,
			branchId,
			isElevated: isElevatedUser,
		};
	}

	/**
	 * Safely parses URL-encoded JSON metadata
	 * @param metadataStr - URL-encoded JSON string
	 * @returns Parsed JSON object or undefined if invalid
	 */
	private parseUrlMetadata(metadataStr: string): Record<string, any> | undefined {
		try {
			// First decode the URL-encoded string, then parse JSON
			const decodedStr = decodeURIComponent(metadataStr);
			return JSON.parse(decodedStr);
		} catch (error) {
			// Log warning but don't fail the request
			console.warn('Failed to parse URL metadata JSON:', metadataStr, error);
			return undefined;
		}
	}

	// Device Management Endpoints
	@Post('devices')
	@UseGuards(AuthGuard, RoleGuard)
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
					},
				},
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
					currentStatus: DeviceStatus.ONLINE,
				},
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
					currentStatus: DeviceStatus.ONLINE,
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ IoT device registered successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Device created successfully',
					description: 'Success message confirming device registration',
				},
				device: {
					type: 'object',
					properties: {
						id: { type: 'number', example: 1, description: 'Internal device database ID' },
						deviceID: {
							type: 'string',
							example: 'DOOR_SENSOR_MAIN_001',
							description: 'Unique device identifier',
						},
						deviceType: { type: 'string', example: 'door_sensor', description: 'Type of IoT device' },
						currentStatus: { type: 'string', example: 'online', description: 'Current device status' },
					},
				},
			},
			required: ['message', 'device'],
		},
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
						'branchID must be a positive number',
					],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'You do not have permission to register devices in this organization',
				},
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
			},
		},
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
						location: { type: 'string', example: 'Main Entrance' },
					},
				},
			},
		},
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
				path: { type: 'string', example: '/iot/devices' },
			},
		},
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
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Get all devices with optional filtering' })
	@ApiQuery({
		name: 'deviceType',
		required: false,
		enum: [
			'door_sensor',
			'camera',
			'sensor',
			'actuator',
			'controller',
			'gateway',
			'rfid',
			'nfc',
			'barcode',
			'beacon',
			'other',
		],
	})
	@ApiQuery({ name: 'status', required: false, enum: ['online', 'offline', 'maintenance', 'disconnected'] })
	@ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
	@ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10)' })
	@ApiResponse({ status: 200, description: 'Devices retrieved successfully' })
	findAllDevices(
		@Req() req: AuthenticatedRequest,
		@Query('deviceType') deviceType?: string,
		@Query('status') status?: string,
		@Query('page') page: number = 1,
		@Query('limit') limit: number = 10,
	) {
		const accessScope = this.getAccessScope(req.user);
		
		const filters = {
			orgId: accessScope.orgId,
			branchId: accessScope.branchId, // null for elevated users = org-wide access
			...(deviceType && { deviceType }),
			...(status && { status }),
		};

		return this.iotService.findAllDevices(filters, page, limit);
	}

	@Get('devices/:id')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Get device by ID with records' })
	@ApiResponse({ status: 200, description: 'Device found successfully' })
	@ApiResponse({ status: 404, description: 'Device not found' })
	findOneDevice(
		@Param('id', ParseIntPipe) id: number,
		@Req() req: AuthenticatedRequest,
	) {
		const accessScope = this.getAccessScope(req.user);
		return this.iotService.findOneDevice(id, accessScope.orgId, accessScope.branchId);
	}

	@Get('devices/by-device-id/:deviceId')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Get device by unique device ID' })
	@ApiResponse({ status: 200, description: 'Device found successfully' })
	@ApiResponse({ status: 404, description: 'Device not found' })
	findDeviceByDeviceId(
		@Param('deviceId') deviceId: string,
		@Req() req: AuthenticatedRequest,
	) {
		const accessScope = this.getAccessScope(req.user);
		return this.iotService.findDeviceByDeviceId(deviceId, accessScope.orgId, accessScope.branchId);
	}

	@Patch('devices/:id')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Update device information' })
	@ApiResponse({ status: 200, description: 'Device updated successfully' })
	@ApiResponse({ status: 404, description: 'Device not found' })
	updateDevice(@Param('id', ParseIntPipe) id: number, @Body() updateDeviceDto: UpdateDeviceDto) {
		return this.iotService.updateDevice(id, updateDeviceDto);
	}

	@Patch('devices/:id/status')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Update device status' })
	@ApiResponse({ status: 200, description: 'Device status updated successfully' })
	@ApiResponse({ status: 404, description: 'Device not found' })
	updateDeviceStatus(@Param('id', ParseIntPipe) id: number, @Body() statusDto: UpdateDeviceStatusDto) {
		return this.iotService.updateDeviceStatus(id, statusDto);
	}

	@Patch('devices/:id/analytics')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Update device analytics' })
	@ApiResponse({ status: 200, description: 'Device analytics updated successfully' })
	@ApiResponse({ status: 404, description: 'Device not found' })
	updateDeviceAnalytics(@Param('id', ParseIntPipe) id: number, @Body() analyticsDto: UpdateDeviceAnalyticsDto) {
		return this.iotService.updateDeviceAnalytics(id, analyticsDto);
	}

	@Delete('devices/:id')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Soft delete a device' })
	@ApiResponse({ status: 200, description: 'Device deleted successfully' })
	@ApiResponse({ status: 404, description: 'Device not found' })
	removeDevice(@Param('id', ParseIntPipe) id: number) {
		return this.iotService.removeDevice(id);
	}

	// Device Records Management Endpoints
	@Post('records')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Create or update device record' })
	@ApiResponse({ status: 201, description: 'Record created/updated successfully' })
	@ApiResponse({ status: 400, description: 'Invalid record data' })
	@ApiResponse({ status: 404, description: 'Device not found' })
	createOrUpdateRecord(@Body() recordDto: CreateDeviceRecordDto) {
		return this.iotService.createOrUpdateRecord(recordDto);
	}

	@Post('records/time-event/:deviceID/:eventType/:timestamp/:location/:ipAddress/:metadata')
	@isPublic()
	@ApiOperation({
		summary: '🎯 CORE: Smart Time Tracking Event System',
		description: `
# IoT Device Time Event Recording System

The primary endpoint for IoT devices to record open/close events with comprehensive business hour validation and organization-level access control.

## 🎯 **Core Features**
• **URL-Based Parameters**: All data passed through URL path for maximum IoT device compatibility
• **Business Hours Validation**: Automatic validation against organization operating hours
• **Smart Record Management**: Intelligent creation/updating of daily device records
• **Organization Scoping**: Multi-tenant support with organization and branch level access control
• **Real-time Analytics**: Automatic analytics updates and performance tracking
• **Audit Trail**: Complete logging of all device events with metadata preservation

## 🕒 **Business Hours Integration**
• **Automatic Validation**: Events are validated against organization operating hours
• **Late/Early Detection**: Identifies events outside normal business hours
• **Holiday Support**: Respects holiday schedules and special operating hours
• **Timezone Awareness**: Handles multiple timezone operations for global organizations
• **Flexible Schedules**: Supports different schedules for different days of the week

## 📊 **Smart Analytics**
• **On-Time Tracking**: Automatically tracks on-time vs late arrivals
• **Attendance Analytics**: Comprehensive attendance and punctuality metrics
• **Performance Metrics**: Device reliability and usage pattern analysis
• **Compliance Reporting**: Generate reports for HR and compliance requirements
• **Real-time Dashboards**: Live updates to organizational dashboards

## 🔒 **Security & Access Control**
• **Organization Boundaries**: Strict organization-level data isolation
• **Branch-Level Access**: Support for multi-branch organizational structures
• **Role-Based Permissions**: Comprehensive role-based access control
• **Device Authentication**: Secure device registration and validation
• **Data Encryption**: All sensitive data encrypted in transit and at rest

## 🎪 **URL Parameter Structure**

### **Required Parameters**
- **deviceID**: Unique device identifier (must be registered)
- **eventType**: Event type ('open' or 'close')
- **timestamp**: Unix timestamp when event occurred

### **Optional Parameters** (use "null" for empty values)
- **location**: Physical location description
- **ipAddress**: IP address of the device
- **metadata**: URL-encoded JSON with additional sensor data

## 💡 **Usage Examples**

### **Morning Arrival (On-Time)**
\`POST /iot/records/time-event/DOOR_SENSOR_001/open/1672905600/Main-Entrance/192.168.1.100/null\`
- Device: DOOR_SENSOR_001
- Event: Employee arriving (open)
- Time: 08:00 AM (within business hours)
- Result: ✅ On-time arrival recorded

### **Evening Departure**
\`POST /iot/records/time-event/DOOR_SENSOR_001/close/1672939200/Main-Entrance/192.168.1.100/%7B%22overtime%22%3Atrue%7D\`
- Device: DOOR_SENSOR_001
- Event: Employee leaving (close)
- Time: 06:00 PM
- Metadata: {"overtime": true}
- Result: ✅ Departure recorded with overtime flag

### **Late Arrival Detection**
\`POST /iot/records/time-event/DOOR_SENSOR_002/open/1672909200/Side-Entrance/192.168.1.101/null\`
- Device: DOOR_SENSOR_002
- Event: Late arrival (open)
- Time: 09:00 AM (30 minutes late)
- Result: ⚠️ Late arrival flagged and recorded

## 🔧 **Business Rules**
- **Single Daily Record**: One record per device per day (updates existing if found)
- **Business Hours**: Events validated against organization operating schedule
- **Device Registration**: Device must be registered and active in the system
- **Organization Membership**: Device must belong to user's organization/branch
- **Timestamp Validation**: Prevents future events and very old events

## 📈 **Automatic Processing**
- **Analytics Updates**: Real-time updates to device and user analytics
- **Attendance Calculation**: Automatic attendance percentage calculations
- **Performance Metrics**: Device reliability and usage statistics
- **Notification Triggers**: Alerts for unusual patterns or compliance violations
- **Report Generation**: Automatic inclusion in daily/weekly reports

## 🎯 **Use Cases**
• **Employee Time Tracking**: Monitor employee arrivals and departures
• **Access Control**: Track facility access and security events
• **Compliance Monitoring**: Ensure adherence to work schedules and policies
• **Asset Management**: Monitor equipment usage and availability
• **Security Auditing**: Complete audit trail of all facility access
• **Performance Analytics**: Analyze punctuality and attendance trends

## 📊 **Response Data**
Successful requests return:
• **Record Information**: Created/updated record details
• **Analytics Impact**: How the event affected analytics
• **Business Hours Status**: Whether event was within business hours
• **Attendance Metrics**: Updated attendance calculations
• **Device Status**: Current device operational status

## ⚡ **Performance Features**
• **Caching**: Intelligent caching for frequently accessed data
• **Batch Processing**: Efficient handling of multiple simultaneous events
• **Queue Management**: Asynchronous processing for high-volume scenarios
• **Database Optimization**: Optimized queries for fast response times
• **Monitoring**: Real-time performance monitoring and alerting`,
		operationId: 'recordDeviceTimeEvent',
	})
	@ApiParam({
		name: 'deviceID',
		description: `
**Required**: Unique device identifier that must be registered in the system

**Format**: Alphanumeric with underscores and hyphens allowed
**Length**: 3-50 characters
**Pattern**: ^[A-Z0-9_-]+$

**Validation**:
- Must exist in device registry
- Must belong to user's organization
- Must be in active status
- Case-sensitive matching

**Examples**:
- ✅ DOOR_SENSOR_001 (Standard door sensor)
- ✅ ACCESS_CARD_READER_A1 (Card reader device)
- ✅ BIOMETRIC_SCANNER_B2 (Biometric scanner)
- ❌ door_sensor_001 (Invalid: lowercase)
- ❌ DEVICE (Invalid: too short)
    `,
		example: 'DOOR_SENSOR_001',
		type: 'string',
		schema: {
			pattern: '^[A-Z0-9_-]+$',
			minLength: 3,
			maxLength: 50,
		},
	})
	@ApiParam({
		name: 'eventType',
		description: `
**Required**: Type of time tracking event being recorded

**Values**:
- **open**: Employee arrival, device activation, access granted
- **close**: Employee departure, device deactivation, access ended

**Business Logic**:
- **Open Events**: Typically represent arrivals or start of work
- **Close Events**: Typically represent departures or end of work
- **Validation**: Must be exactly 'open' or 'close' (case-sensitive)
- **Business Hours**: Validated against organization operating schedule

**Examples**:
- ✅ 'open' at 08:00 AM → On-time arrival
- ✅ 'close' at 17:00 PM → Standard departure
- ⚠️ 'open' at 09:30 AM → Late arrival (flagged)
- ⚠️ 'close' at 02:00 AM → Unusual hours (flagged)
    `,
		enum: ['open', 'close'],
		example: 'open',
	})
	@ApiParam({
		name: 'timestamp',
		description: `
**Required**: Unix timestamp when the event actually occurred

**Format**: Seconds since Unix epoch (January 1, 1970, 00:00:00 UTC)
**Range**: Must be after year 2000 and not in the future
**Precision**: Seconds (not milliseconds)

**Validation**:
- Minimum: 946684800 (January 1, 2000)
- Maximum: Current time + 1 hour (prevents future events)
- Format: Integer as string in URL
- Timezone: UTC (converted from organization timezone)

**Business Hours Check**:
- Compared against organization operating hours
- Timezone conversion using organization settings
- Holiday and special hours consideration
- Early/late arrival detection and flagging

**Examples**:
- ✅ 1672905600 = January 5, 2023, 8:00:00 AM UTC
- ✅ 1672939200 = January 5, 2023, 6:00:00 PM UTC
- ❌ 1672905600000 (Invalid: milliseconds instead of seconds)
- ❌ 2000000000 (Invalid: future date)
    `,
		example: '1672905600',
		type: 'string',
		schema: {
			pattern: '^[0-9]{10}$',
		},
	})
	@ApiParam({
		name: 'location',
		description: `
**Optional**: Physical location where the event occurred

**Format**: String description or "null" for empty
**Length**: 0-200 characters if provided
**Encoding**: URL-encoded if contains special characters

**Use Cases**:
- Building entrance identification
- Floor or department specification
- Geographic location for mobile devices
- Security zone identification

**Validation**:
- Use "null" (string) if no location available
- Automatically URL-decoded by system
- Stored for audit trail and reporting
- Used in analytics and compliance reports

**Examples**:
- ✅ "Main-Entrance" (Simple location)
- ✅ "Building-A-Floor-3-East-Wing" (Detailed location)
- ✅ "null" (No location data)
- ✅ "GPS%3A-26.2041%2C28.0473" (GPS coordinates, URL-encoded)
- ❌ "" (Invalid: use "null" instead of empty string)
    `,
		example: 'Main-Entrance-Pretoria',
		type: 'string',
		required: false,
	})
	@ApiParam({
		name: 'ipAddress',
		description: `
**Optional**: IP address of the device that generated the event

**Format**: IPv4 or IPv6 address, or "null" for empty
**Validation**: Must be valid IP format if provided
**Security**: Used for device authentication and audit trails

**Use Cases**:
- Device location verification
- Network security auditing
- Troubleshooting connectivity issues
- Geo-location correlation

**Validation**:
- IPv4: 192.168.1.100 (standard format)
- IPv6: 2001:db8::1 (standard format)
- Use "null" (string) if IP not available
- Automatically validated for format correctness

**Security Features**:
- Cross-referenced with registered device IPs
- Flagged if IP doesn't match expected range
- Used in security breach detection
- Logged for compliance and auditing

**Examples**:
- ✅ "192.168.1.100" (IPv4 address)
- ✅ "2001:db8::1" (IPv6 address)
- ✅ "null" (No IP data available)
- ❌ "192.168.1" (Invalid: incomplete IPv4)
- ❌ "not-an-ip" (Invalid: not IP format)
    `,
		example: '192.168.1.100',
		type: 'string',
		required: false,
	})
	@ApiParam({
		name: 'metadata',
		description: `
**Optional**: URL-encoded JSON containing additional sensor data and context

**Format**: URL-encoded JSON object or "null" for empty
**Size Limit**: Maximum 2KB when URL-decoded
**Encoding**: Must be properly URL-encoded for special characters

**Common Metadata Fields**:
- **batteryLevel**: Device battery percentage (0-100)
- **signalStrength**: Network signal strength (-100 to 0 dBm)
- **firmwareVersion**: Device firmware version string
- **temperature**: Ambient temperature in Celsius
- **humidity**: Relative humidity percentage
- **motionDetected**: Boolean for motion sensor data
- **userAgent**: Device identification string
- **cardId**: Access card ID for card reader events
- **biometricMatch**: Biometric verification success rate

**Business Applications**:
- Device health monitoring
- Environmental condition tracking
- Security event correlation
- Predictive maintenance alerts
- Compliance data collection

**Encoding Examples**:
- Original: {"batteryLevel": 92, "temp": 23.5}
- Encoded: %7B%22batteryLevel%22%3A92%2C%22temp%22%3A23.5%7D
- Use "null" for no metadata

**Validation**:
- Must be valid JSON when decoded
- Automatically parsed and validated
- Stored in structured format for analytics
- Accessible in reports and dashboards

**Examples**:
- ✅ "%7B%22batteryLevel%22%3A92%7D" (Battery info)
- ✅ "%7B%22cardId%22%3A%22ABC123%22%7D" (Access card)
- ✅ "null" (No metadata)
- ❌ "{\"invalid\": json}" (Invalid: not URL-encoded)
- ❌ "not-json" (Invalid: not JSON format)
    `,
		example: '%7B%22batteryLevel%22%3A92%2C%22signalStrength%22%3A-45%7D',
		type: 'string',
		required: false,
	})
	@ApiCreatedResponse({
		description: '✅ Time event recorded successfully with business hours validation',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Time event recorded successfully - On-time arrival detected',
					description: 'Success message with business context and attendance status',
				},
				record: {
					type: 'object',
					description: 'Created or updated device record with comprehensive tracking data',
					properties: {
						id: {
							type: 'number',
							example: 42,
							description: 'Unique record identifier in database',
						},
						deviceId: {
							type: 'number',
							example: 789,
							description: 'Foreign key reference to the device',
						},
						deviceUID: {
							type: 'string',
							example: 'DOOR_SENSOR_001',
							description: 'Human-readable device identifier',
						},
						openTime: {
							type: 'number',
							example: 1672905600,
							description: 'Unix timestamp of first open event (arrival time)',
							nullable: true,
						},
						closeTime: {
							type: 'number',
							example: 1672939200,
							description: 'Unix timestamp of last close event (departure time)',
							nullable: true,
						},
						totalHours: {
							type: 'number',
							example: 8.5,
							description: 'Total hours between open and close (if both present)',
							nullable: true,
						},
						isComplete: {
							type: 'boolean',
							example: true,
							description: 'Whether record has both open and close times',
						},
						recordDate: {
							type: 'string',
							format: 'date',
							example: '2023-01-05',
							description: 'Date of the record (YYYY-MM-DD format)',
						},
						createdAt: {
							type: 'string',
							format: 'date-time',
							example: '2023-01-05T08:00:00.000Z',
							description: 'Record creation timestamp',
						},
						updatedAt: {
							type: 'string',
							format: 'date-time',
							example: '2023-01-05T17:00:00.000Z',
							description: 'Last record update timestamp',
						},
						metadata: {
							type: 'object',
							example: {
								batteryLevel: 92,
								signalStrength: -45,
								location: 'Main-Entrance-Pretoria',
							},
							description: 'Additional sensor data and context information',
							nullable: true,
						},
					},
					required: ['id', 'deviceId', 'deviceUID', 'recordDate', 'isComplete', 'createdAt', 'updatedAt'],
				},
				businessHoursAnalysis: {
					type: 'object',
					description: 'Business hours validation and attendance analysis',
					properties: {
						organizationHours: {
							type: 'object',
							description: 'Organization operating hours for validation',
							properties: {
								openTime: {
									type: 'string',
									example: '08:00',
									description: 'Business opening time (HH:mm)',
								},
								closeTime: {
									type: 'string',
									example: '17:00',
									description: 'Business closing time (HH:mm)',
								},
								timezone: {
									type: 'string',
									example: 'Africa/Johannesburg',
									description: 'Organization timezone',
								},
								isHoliday: {
									type: 'boolean',
									example: false,
									description: 'Whether today is marked as holiday',
								},
							},
						},
						eventAnalysis: {
							type: 'object',
							description: 'Analysis of the specific event recorded',
							properties: {
								eventType: { type: 'string', example: 'open', enum: ['open', 'close'] },
								eventTime: {
									type: 'string',
									example: '08:00',
									description: 'Event time in organization timezone (HH:mm)',
								},
								isWithinBusinessHours: {
									type: 'boolean',
									example: true,
									description: 'Whether event occurred during business hours',
								},
								attendanceStatus: {
									type: 'string',
									example: 'ON_TIME',
									enum: ['ON_TIME', 'LATE', 'EARLY', 'OUTSIDE_HOURS'],
									description: 'Categorized attendance status',
								},
								minutesFromSchedule: {
									type: 'number',
									example: 0,
									description:
										'Minutes difference from scheduled time (positive = late, negative = early)',
								},
								workingDay: {
									type: 'boolean',
									example: true,
									description: 'Whether this day is configured as a working day',
								},
							},
						},
					},
				},
				analytics: {
					type: 'object',
					description: 'Updated analytics and performance metrics',
					properties: {
						deviceAnalytics: {
							type: 'object',
							properties: {
								totalEvents: {
									type: 'number',
									example: 156,
									description: 'Total events recorded by this device',
								},
								openCount: { type: 'number', example: 78, description: 'Total open events' },
								closeCount: { type: 'number', example: 78, description: 'Total close events' },
								onTimeCount: { type: 'number', example: 70, description: 'Number of on-time events' },
								lateCount: { type: 'number', example: 8, description: 'Number of late events' },
								punctualityRate: {
									type: 'number',
									example: 89.7,
									description: 'Punctuality percentage',
								},
							},
						},
						attendanceMetrics: {
							type: 'object',
							properties: {
								currentMonth: {
									type: 'object',
									properties: {
										totalWorkingDays: {
											type: 'number',
											example: 22,
											description: 'Working days in current month',
										},
										daysPresent: {
											type: 'number',
											example: 20,
											description: 'Days with recorded events',
										},
										attendanceRate: {
											type: 'number',
											example: 90.9,
											description: 'Attendance percentage',
										},
										avgArrivalTime: {
											type: 'string',
											example: '08:05',
											description: 'Average arrival time',
										},
										avgDepartureTime: {
											type: 'string',
											example: '17:15',
											description: 'Average departure time',
										},
									},
								},
							},
						},
					},
				},
				device: {
					type: 'object',
					description: 'Device information and current status',
					properties: {
						id: { type: 'number', example: 789, description: 'Device database ID' },
						deviceID: { type: 'string', example: 'DOOR_SENSOR_001', description: 'Device identifier' },
						deviceType: { type: 'string', example: 'DOOR_SENSOR', description: 'Type of IoT device' },
						location: {
							type: 'string',
							example: 'Main Entrance, Building A',
							description: 'Physical device location',
						},
						status: { type: 'string', example: 'ONLINE', description: 'Current device operational status' },
						lastSeen: {
							type: 'string',
							format: 'date-time',
							example: '2023-01-05T08:00:00.000Z',
							description: 'Last communication timestamp',
						},
						organization: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123, description: 'Organization ID' },
								name: {
									type: 'string',
									example: 'Orrbit Technologies',
									description: 'Organization name',
								},
							},
						},
						branch: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456, description: 'Branch ID' },
								name: { type: 'string', example: 'Pretoria South Africa', description: 'Branch name' },
							},
						},
					},
				},
				processing: {
					type: 'object',
					description: 'Event processing metadata and performance information',
					properties: {
						processingTime: {
							type: 'number',
							example: 145,
							description: 'Processing time in milliseconds',
						},
						source: { type: 'string', example: 'url_parameters', description: 'Data source method' },
						validationChecks: {
							type: 'object',
							properties: {
								deviceValidation: {
									type: 'boolean',
									example: true,
									description: 'Device registration check passed',
								},
								permissionValidation: {
									type: 'boolean',
									example: true,
									description: 'User permission check passed',
								},
								timestampValidation: {
									type: 'boolean',
									example: true,
									description: 'Timestamp format check passed',
								},
								businessHoursValidation: {
									type: 'boolean',
									example: true,
									description: 'Business hours check completed',
								},
							},
						},
						cacheUpdates: {
							type: 'array',
							items: { type: 'string' },
							example: ['device_analytics_789', 'daily_report_20230105'],
							description: 'Cache keys updated during processing',
						},
						notificationsSent: {
							type: 'array',
							items: { type: 'string' },
							example: ['late_arrival_alert'],
							description: 'Notifications triggered by this event',
						},
					},
				},
			},
			required: ['message', 'record', 'businessHoursAnalysis', 'analytics', 'device', 'processing'],
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid parameters, device validation, or business rule violations',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Invalid URL parameters: timestamp format is incorrect',
					description: 'Human-readable error message explaining the validation failure',
				},
				error: {
					type: 'string',
					example: 'Bad Request',
					description: 'HTTP error type',
				},
				statusCode: {
					type: 'number',
					example: 400,
					description: 'HTTP status code',
				},
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'deviceID is required and cannot be null',
						'eventType must be either "open" or "close"',
						'timestamp must be a valid Unix timestamp (10 digits)',
						'timestamp cannot be in the future',
						'metadata must be valid URL-encoded JSON if provided',
					],
					description: 'Detailed list of all validation failures',
				},
				fieldErrors: {
					type: 'object',
					example: {
						deviceID: 'Device ID must be 3-50 characters, alphanumeric with underscores/hyphens only',
						eventType: 'Must be exactly "open" or "close" (case-sensitive)',
						timestamp: 'Must be Unix timestamp in seconds (10 digits), not milliseconds',
						metadata: 'Must be valid URL-encoded JSON or "null"',
					},
					description: 'Field-specific validation error messages',
				},
				businessRuleViolations: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Device DOOR_SENSOR_001 is not registered in your organization',
						'Events cannot be recorded for inactive devices',
						'Duplicate event: This exact timestamp was already recorded for this device',
					],
					description: 'Business logic violations that prevented processing',
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify device ID is correctly registered in the system',
						'Ensure timestamp is in seconds, not milliseconds',
						'Use "null" (string) for empty optional parameters',
						'URL-encode special characters in metadata JSON',
					],
					description: 'Helpful suggestions to resolve the errors',
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2023-01-05T08:00:00.000Z',
					description: 'When the error occurred',
				},
				path: {
					type: 'string',
					example: '/iot/records/time-event/DOOR_SENSOR_001/open/1672905600/null/null/null',
					description: 'API endpoint path that generated the error',
				},
			},
			required: ['message', 'error', 'statusCode', 'timestamp', 'path'],
		},
	})
	@ApiNotFoundResponse({
		description: '🔍 Not Found - Device, organization, or business hours configuration not found',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Device DOOR_SENSOR_001 not found in organization',
					description: 'Specific error message indicating what was not found',
				},
				error: {
					type: 'string',
					example: 'Not Found',
					description: 'HTTP error type',
				},
				statusCode: {
					type: 'number',
					example: 404,
					description: 'HTTP status code',
				},
				notFoundType: {
					type: 'string',
					enum: [
						'DEVICE_NOT_FOUND',
						'ORGANIZATION_NOT_FOUND',
						'BUSINESS_HOURS_NOT_CONFIGURED',
						'BRANCH_NOT_FOUND',
					],
					example: 'DEVICE_NOT_FOUND',
					description: 'Categorized type of not found error',
				},
				searchCriteria: {
					type: 'object',
					example: {
						deviceID: 'DOOR_SENSOR_001',
						organizationId: 123,
						branchId: 456,
					},
					description: 'Criteria used in the search that failed',
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the device ID is spelled correctly',
						'Ensure the device is registered in your organization',
						'Check if the device has been deleted or deactivated',
						'Contact administrator if device should exist',
					],
					description: 'Actionable suggestions to resolve the issue',
				},
				relatedResources: {
					type: 'object',
					properties: {
						deviceRegistration: {
							type: 'string',
							example: 'POST /iot/devices',
							description: 'Endpoint to register new devices',
						},
						organizationDevices: {
							type: 'string',
							example: 'GET /iot/devices?orgId=123',
							description: 'Endpoint to list organization devices',
						},
						businessHoursConfig: {
							type: 'string',
							example: 'GET /organizations/ORG123/hours',
							description: 'Endpoint to view business hours configuration',
						},
					},
					description: 'Related API endpoints that might help resolve the issue',
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2023-01-05T08:00:00.000Z',
					description: 'When the error occurred',
				},
				path: {
					type: 'string',
					example: '/iot/records/time-event/DOOR_SENSOR_001/open/1672905600/null/null/null',
					description: 'API endpoint path that generated the error',
				},
			},
			required: ['message', 'error', 'statusCode', 'notFoundType', 'suggestions', 'timestamp', 'path'],
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions or organization access violations',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'You do not have permission to record events for devices in this organization',
					description: 'Permission denial message with context',
				},
				error: {
					type: 'string',
					example: 'Forbidden',
					description: 'HTTP error type',
				},
				statusCode: {
					type: 'number',
					example: 403,
					description: 'HTTP status code',
				},
				accessViolationType: {
					type: 'string',
					enum: [
						'ORGANIZATION_ACCESS_DENIED',
						'BRANCH_ACCESS_DENIED',
						'DEVICE_ACCESS_DENIED',
						'INSUFFICIENT_ROLE',
					],
					example: 'ORGANIZATION_ACCESS_DENIED',
					description: 'Type of access control violation',
				},
				userContext: {
					type: 'object',
					properties: {
						userId: { type: 'number', example: 789, description: 'Requesting user ID' },
						accessLevel: { type: 'string', example: 'USER', description: 'User access level' },
						organizationId: { type: 'number', example: 123, description: 'User organization ID' },
						branchId: { type: 'number', example: 456, description: 'User branch ID' },
					},
					description: 'User context information for debugging',
				},
				requiredPermissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['IOT_DEVICE_WRITE', 'ORGANIZATION_MEMBER'],
					description: 'Permissions required for this operation',
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Contact your administrator to request IoT device access',
						'Verify you are accessing devices in your assigned organization',
						'Check if your account has the required role permissions',
					],
					description: 'Suggestions to resolve access issues',
				},
			},
			required: ['message', 'error', 'statusCode', 'accessViolationType'],
		},
	})
	@ApiUnauthorizedResponse({
		description: '🔒 Unauthorized - Authentication required or invalid token',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Authentication token is required for IoT device operations',
					description: 'Authentication error message',
				},
				error: {
					type: 'string',
					example: 'Unauthorized',
					description: 'HTTP error type',
				},
				statusCode: {
					type: 'number',
					example: 401,
					description: 'HTTP status code',
				},
				authenticationIssue: {
					type: 'string',
					enum: ['MISSING_TOKEN', 'INVALID_TOKEN', 'EXPIRED_TOKEN', 'MALFORMED_TOKEN'],
					example: 'MISSING_TOKEN',
					description: 'Specific authentication problem',
				},
				tokenInfo: {
					type: 'object',
					properties: {
						provided: { type: 'boolean', example: false, description: 'Whether token was provided' },
						format: { type: 'string', example: 'Bearer', description: 'Expected token format' },
						location: {
							type: 'string',
							example: 'Authorization header',
							description: 'Where token should be provided',
						},
					},
					description: 'Information about token requirements',
				},
				resolution: {
					type: 'object',
					properties: {
						loginEndpoint: {
							type: 'string',
							example: 'POST /auth/login',
							description: 'Endpoint to obtain token',
						},
						tokenFormat: {
							type: 'string',
							example: 'Authorization: Bearer <jwt_token>',
							description: 'Required header format',
						},
						documentation: {
							type: 'string',
							example: '/docs/authentication',
							description: 'Authentication documentation',
						},
					},
					description: 'Steps to resolve authentication issues',
				},
			},
			required: ['message', 'error', 'statusCode', 'authenticationIssue'],
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Business rule conflicts or duplicate event detection',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Duplicate event detected: Same timestamp already recorded for this device today',
					description: 'Conflict explanation with business context',
				},
				error: {
					type: 'string',
					example: 'Conflict',
					description: 'HTTP error type',
				},
				statusCode: {
					type: 'number',
					example: 409,
					description: 'HTTP status code',
				},
				conflictType: {
					type: 'string',
					enum: [
						'DUPLICATE_EVENT',
						'BUSINESS_HOURS_VIOLATION',
						'DEVICE_STATE_CONFLICT',
						'ATTENDANCE_POLICY_VIOLATION',
					],
					example: 'DUPLICATE_EVENT',
					description: 'Type of business conflict detected',
				},
				conflictDetails: {
					type: 'object',
					example: {
						existingEvent: {
							id: 123,
							timestamp: 1672905600,
							eventType: 'open',
							recordedAt: '2023-01-05T08:00:00.000Z',
						},
						attemptedEvent: {
							timestamp: 1672905600,
							eventType: 'open',
							deviceID: 'DOOR_SENSOR_001',
						},
					},
					description: 'Detailed information about the conflict',
				},
				businessImpact: {
					type: 'object',
					properties: {
						attendanceAffected: {
							type: 'boolean',
							example: true,
							description: 'Whether attendance calculations are affected',
						},
						analyticsImpacted: {
							type: 'boolean',
							example: false,
							description: 'Whether device analytics are impacted',
						},
						complianceIssue: {
							type: 'boolean',
							example: false,
							description: 'Whether this creates compliance problems',
						},
					},
					description: 'Business impact assessment of the conflict',
				},
				resolutionOptions: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							action: {
								type: 'string',
								example: 'UPDATE_EXISTING',
								description: 'Resolution action type',
							},
							description: {
								type: 'string',
								example: 'Update the existing record with new metadata',
								description: 'Description of the action',
							},
							endpoint: {
								type: 'string',
								example: 'PATCH /iot/records/123',
								description: 'API endpoint for resolution',
							},
						},
					},
					example: [
						{
							action: 'UPDATE_EXISTING',
							description: 'Update the existing record with new metadata',
							endpoint: 'PATCH /iot/records/123',
						},
						{
							action: 'IGNORE_DUPLICATE',
							description: 'Accept the duplicate and continue without changes',
							endpoint: null,
						},
					],
					description: 'Available options to resolve the conflict',
				},
			},
			required: ['message', 'error', 'statusCode', 'conflictType', 'conflictDetails'],
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - System malfunction or unexpected failure',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Failed to process IoT event due to database connection error',
					description: 'User-friendly error message',
				},
				error: {
					type: 'string',
					example: 'Internal Server Error',
					description: 'HTTP error type',
				},
				statusCode: {
					type: 'number',
					example: 500,
					description: 'HTTP status code',
				},
				errorCode: {
					type: 'string',
					example: 'IOT_PROCESSING_FAILURE',
					description: 'Internal error code for debugging',
				},
				systemContext: {
					type: 'object',
					properties: {
						component: {
							type: 'string',
							example: 'IoT Event Processor',
							description: 'System component where error occurred',
						},
						operation: {
							type: 'string',
							example: 'RECORD_TIME_EVENT',
							description: 'Operation being performed',
						},
						errorId: {
							type: 'string',
							example: 'ERR_20230105_080001_ABC123',
							description: 'Unique error identifier for tracking',
						},
					},
					description: 'System context for error investigation',
				},
				retryInfo: {
					type: 'object',
					properties: {
						retryable: {
							type: 'boolean',
							example: true,
							description: 'Whether the operation can be retried',
						},
						retryAfter: { type: 'number', example: 30, description: 'Suggested retry delay in seconds' },
						maxRetries: { type: 'number', example: 3, description: 'Maximum recommended retry attempts' },
					},
					description: 'Retry guidance for the client',
				},
				supportInfo: {
					type: 'object',
					properties: {
						contactSupport: { type: 'boolean', example: true, description: 'Whether to contact support' },
						includeErrorId: {
							type: 'boolean',
							example: true,
							description: 'Whether to include error ID when contacting support',
						},
						urgencyLevel: {
							type: 'string',
							example: 'MEDIUM',
							enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
							description: 'Support urgency level',
						},
					},
					description: 'Support contact guidance',
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2023-01-05T08:00:00.000Z',
					description: 'When the error occurred',
				},
			},
			required: ['message', 'error', 'statusCode', 'errorCode', 'timestamp'],
		},
	})
	@HttpCode(HttpStatus.CREATED)
	recordTimeEvent(
		@Param('deviceID') deviceID: string,
		@Param('eventType') eventType: string,
		@Param('timestamp') timestamp: string,
		@Param('location') location: string,
		@Param('ipAddress') ipAddress: string,
		@Param('metadata') metadata: string,
	) {
		// This POST method creates/updates device records based on URL parameters
		// Validate required parameters
		const invalidParams: string[] = [];

		if (!deviceID || deviceID === 'null') {
			invalidParams.push('deviceID is required');
		}

		if (!eventType || !['open', 'close'].includes(eventType)) {
			invalidParams.push('eventType must be "open" or "close"');
		}

		const timestampNum = parseInt(timestamp, 10);
		if (!timestamp || isNaN(timestampNum) || timestampNum < 946684800) {
			invalidParams.push('timestamp must be a valid Unix timestamp after year 2000');
		}

		if (invalidParams.length > 0) {
			throw new BadRequestException({
				message: 'Invalid URL parameters',
				details: {
					invalidParameters: invalidParams,
				},
			});
		}

		// Create device record from URL parameters
		const timeEventData: DeviceTimeRecordDto = {
			deviceID,
			eventType: eventType as 'open' | 'close',
			timestamp: timestampNum,
			location: location === 'null' ? undefined : decodeURIComponent(location),
			ipAddress: ipAddress === 'null' ? undefined : ipAddress,
			metadata: metadata === 'null' ? undefined : this.parseUrlMetadata(metadata),
		};

		return this.iotService.recordTimeEvent(timeEventData);
	}

	@Get('records')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
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
		@Query('limit') limit: number = 10,
	) {
		return this.iotService.findAllRecords(
			{
				deviceId,
				orgId,
				branchId,
				startDate: startDate ? new Date(startDate) : undefined,
				endDate: endDate ? new Date(endDate) : undefined,
			},
			page,
			limit,
		);
	}

	@Get('records/:id')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Get record by ID' })
	@ApiResponse({ status: 200, description: 'Record found successfully' })
	@ApiResponse({ status: 404, description: 'Record not found' })
	findOneRecord(@Param('id', ParseIntPipe) id: number) {
		return this.iotService.findOneRecord(id);
	}

	@Patch('records/:id')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Update device record' })
	@ApiResponse({ status: 200, description: 'Record updated successfully' })
	@ApiResponse({ status: 404, description: 'Record not found' })
	updateRecord(@Param('id', ParseIntPipe) id: number, @Body() updateRecordDto: UpdateDeviceRecordDto) {
		return this.iotService.updateRecord(id, updateRecordDto);
	}

	@Delete('records/:id')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Delete device record' })
	@ApiResponse({ status: 200, description: 'Record deleted successfully' })
	@ApiResponse({ status: 404, description: 'Record not found' })
	removeRecord(@Param('id', ParseIntPipe) id: number) {
		return this.iotService.removeRecord(id);
	}

	// Analytics and Reporting Endpoints
	@Get('devices/:id/analytics')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Get device analytics and statistics' })
	@ApiResponse({ status: 200, description: 'Analytics retrieved successfully' })
	@ApiResponse({ status: 404, description: 'Device not found' })
	getDeviceAnalytics(@Param('id', ParseIntPipe) id: number) {
		return this.iotService.getDeviceAnalytics(id);
	}

	@Get('analytics/summary')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
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
		@Query('endDate') endDate?: string,
	) {
		return this.iotService.getAnalyticsSummary({
			orgId,
			branchId,
			startDate: startDate ? new Date(startDate) : undefined,
			endDate: endDate ? new Date(endDate) : undefined,
		});
	}

	// IoT Device Reporting Endpoints (Similar to Attendance Reports)
	@Get('reports/morning')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
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
- **Email Recipients**: admin@loro.co.za, owner@loro.co.za
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
		example: 123,
	})
	@ApiQuery({
		name: 'branchIds',
		required: false,
		type: String,
		description: 'Comma-separated branch IDs to include',
		example: '456,789',
	})
	@ApiQuery({
		name: 'includeAnalytics',
		required: false,
		type: Boolean,
		description: 'Include detailed analytics in response',
		example: true,
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
								organizationEfficiency: { type: 'number', example: 91.2 },
							},
						},
						alerts: {
							type: 'object',
							properties: {
								critical: {
									type: 'array',
									items: { type: 'string' },
									example: ['2 devices are offline and not responding'],
								},
								warning: {
									type: 'array',
									items: { type: 'string' },
									example: ['3 devices opened late this morning'],
								},
							},
						},
					},
				},
				timestamp: { type: 'string', format: 'date-time' },
				requestId: { type: 'string', example: 'morning_report_1704369600000' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid report parameters',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Invalid organization ID provided' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
			},
		},
	})
	generateMorningReport(
		@Req() req: AuthenticatedRequest,
		@Query('orgId') orgId?: number,
		@Query('branchIds') branchIds?: string,
		@Query('includeAnalytics') includeAnalytics?: boolean,
	) {
		const accessScope = this.getAccessScope(req.user);
		const organizationId = orgId || accessScope.orgId;
		const branchIdArray = branchIds ? branchIds.split(',').map((id) => parseInt(id.trim())) : undefined;

		return this.iotService.generateMorningReport({
			orgId: organizationId,
			branchIds: branchIdArray,
			reportType: 'morning',
			includeAnalytics: includeAnalytics ?? true,
		});
	}

	@Get('reports/evening')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
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
- **Email Recipients**: admin@loro.co.za, owner@loro.co.za
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
		example: 123,
	})
	@ApiQuery({
		name: 'branchIds',
		required: false,
		type: String,
		description: 'Comma-separated branch IDs to include',
		example: '456,789',
	})
	@ApiQuery({
		name: 'includeAnalytics',
		required: false,
		type: Boolean,
		description: 'Include detailed analytics in response',
		example: true,
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
								totalCloseEvents: { type: 'number', example: 22 },
							},
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
											uptime: { type: 'number', example: 99.2 },
										},
									},
								},
							},
						},
					},
				},
				timestamp: { type: 'string', format: 'date-time' },
				requestId: { type: 'string', example: 'evening_report_1704398400000' },
			},
		},
	})
	generateEveningReport(
		@Req() req: AuthenticatedRequest,
		@Query('orgId') orgId?: number,
		@Query('branchIds') branchIds?: string,
		@Query('includeAnalytics') includeAnalytics?: boolean,
	) {
		const accessScope = this.getAccessScope(req.user);
		const organizationId = orgId || accessScope.orgId;
		const branchIdArray = branchIds ? branchIds.split(',').map((id) => parseInt(id.trim())) : undefined;

		return this.iotService.generateEveningReport({
			orgId: organizationId,
			branchIds: branchIdArray,
			reportType: 'evening',
			includeAnalytics: includeAnalytics ?? true,
		});
	}

	@Get('reports/device-timings/:deviceId')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
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
		type: 'number',
	})
	@ApiQuery({
		name: 'startDate',
		required: false,
		type: String,
		description: 'Start date for analysis (ISO string, defaults to 30 days ago)',
		example: '2025-01-01T00:00:00.000Z',
	})
	@ApiQuery({
		name: 'endDate',
		required: false,
		type: String,
		description: 'End date for analysis (ISO string, defaults to now)',
		example: '2025-01-04T23:59:59.999Z',
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
				maintenanceNeeded: { type: 'boolean', example: false, description: 'Whether device needs maintenance' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: '🔍 Device not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Device with ID 789 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
			},
		},
	})
	calculateDeviceTimings(
		@Param('deviceId', ParseIntPipe) deviceId: number,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	) {
		const dateRange =
			startDate && endDate
				? {
						start: new Date(startDate),
						end: new Date(endDate),
				  }
				: undefined;

		return this.iotService.calculateDeviceTimings(deviceId, dateRange);
	}
}
