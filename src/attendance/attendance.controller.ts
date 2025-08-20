import { AttendanceService } from './attendance.service';
import { AttendanceReportsService } from './services/attendance.reports.service';
import {
	ApiOperation,
	ApiTags,
	ApiBody,
	ApiParam,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiForbiddenResponse,
	ApiInternalServerErrorResponse,
	ApiQuery,
	ApiProperty,
	ApiExtraModels,
} from '@nestjs/swagger';
import { Controller, Post, Body, Param, Get, UseGuards, Query, UseInterceptors, Req } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { CreateCheckInDto } from './dto/create.attendance.check.in.dto';
import { CreateCheckOutDto } from './dto/create.attendance.check.out.dto';
import { CreateBreakDto } from './dto/create.attendance.break.dto';
import { OrganizationReportQueryDto } from './dto/organization.report.query.dto';
import { UserMetricsResponseDto } from './dto/user-metrics-response.dto';
import { RequestReportDto } from './dto/request.report.dto';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { Attendance } from './entities/attendance.entity';
import { CurrentUser } from '../decorators/current-user.decorator';
import { User } from '../user/entities/user.entity';
import { OvertimeReminderService } from './services/overtime.reminder.service';
import { UserService } from '../user/user.service';

// Reusable Schema Definitions for Swagger Documentation
export class UserProfileSchema {
	@ApiProperty({ type: 'number', example: 45 })
	uid: number;

	@ApiProperty({ type: 'string', example: 'john.doe' })
	username: string;

	@ApiProperty({ type: 'string', example: 'John' })
	name: string;

	@ApiProperty({ type: 'string', example: 'Doe' })
	surname: string;

	@ApiProperty({ type: 'string', example: 'john.doe@company.com' })
	email: string;

	@ApiProperty({ type: 'string', example: '+27123456789', nullable: true })
	phone: string;

	@ApiProperty({ type: 'string', example: 'https://example.com/photo.jpg', nullable: true })
	photoURL: string;

	@ApiProperty({ type: 'string', example: 'https://example.com/avatar.jpg', nullable: true })
	avatar: string;

	@ApiProperty({ type: 'string', example: 'employee' })
	role: string;

	@ApiProperty({ type: 'string', example: 'active' })
	status: string;

	@ApiProperty({ enum: AccessLevel, example: 'USER' })
	accessLevel: AccessLevel;

	@ApiProperty({ type: 'string', format: 'date-time' })
	createdAt: Date;

	@ApiProperty({ type: 'string', format: 'date-time' })
	updatedAt: Date;
}

export class BranchSchema {
	@ApiProperty({ type: 'number', example: 12 })
	uid: number;

	@ApiProperty({ type: 'string', example: 'Main Branch' })
	name: string;

	@ApiProperty({ type: 'string', example: 'MB001' })
	ref: string;

	@ApiProperty({ type: 'string', example: '123 Main Street, City' })
	address: string;
}

export class OrganisationSchema {
	@ApiProperty({ type: 'number', example: 1 })
	uid: number;

	@ApiProperty({ type: 'string', example: 'ABC Corporation' })
	name: string;

	@ApiProperty({ type: 'string', example: 'ABC001' })
	ref: string;
}

export class AttendanceWithUserProfileSchema {
	@ApiProperty({ type: 'number', example: 123 })
	uid: number;

	@ApiProperty({ enum: ['PRESENT', 'COMPLETED', 'ON_BREAK'], example: 'COMPLETED' })
	status: string;

	@ApiProperty({ type: 'string', format: 'date-time', example: '2024-03-01T09:00:00Z' })
	checkIn: Date;

	@ApiProperty({ type: 'string', format: 'date-time', example: '2024-03-01T17:30:00Z', nullable: true })
	checkOut: Date;

	@ApiProperty({ type: 'string', example: '8h 30m', nullable: true })
	duration: string;

	@ApiProperty({ type: 'number', example: -26.2041, nullable: true })
	checkInLatitude: number;

	@ApiProperty({ type: 'number', example: 28.0473, nullable: true })
	checkInLongitude: number;

	@ApiProperty({ type: 'string', example: 'Started work early today', nullable: true })
	checkInNotes: string;

	@ApiProperty({ type: 'string', example: 'Completed all tasks', nullable: true })
	checkOutNotes: string;

	@ApiProperty({ type: 'string', example: '1h 15m', nullable: true })
	totalBreakTime: string;

	@ApiProperty({ type: 'number', example: 2, nullable: true })
	breakCount: number;

	@ApiProperty({ type: UserProfileSchema })
	owner: UserProfileSchema;

	@ApiProperty({ type: BranchSchema, nullable: true })
	branch: BranchSchema;

	@ApiProperty({ type: OrganisationSchema, nullable: true })
	organisation: OrganisationSchema;
}

@ApiTags('⏰ Attendance')
@Controller('att')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('reports')
@ApiUnauthorizedResponse({
	description: '🔒 Unauthorized - Authentication required',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Authentication token is required for attendance operations' },
			error: { type: 'string', example: 'Unauthorized' },
			statusCode: { type: 'number', example: 401 },
		},
	},
})
@ApiForbiddenResponse({
	description: '🚫 Forbidden - Insufficient permissions',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'You do not have permission to access attendance data' },
			error: { type: 'string', example: 'Forbidden' },
			statusCode: { type: 'number', example: 403 },
		},
	},
})
@ApiInternalServerErrorResponse({
	description: '💥 Internal Server Error - Attendance system failure',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Attendance service temporarily unavailable' },
			error: { type: 'string', example: 'Internal Server Error' },
			statusCode: { type: 'number', example: 500 },
		},
	},
})
@ApiExtraModels(UserProfileSchema, BranchSchema, OrganisationSchema, AttendanceWithUserProfileSchema)
export class AttendanceController {
	constructor(
		private readonly attendanceService: AttendanceService,
		private readonly attendanceReportsService: AttendanceReportsService,
		private readonly overtimeReminderService: OvertimeReminderService,
		private readonly userService: UserService,
	) {}

	@Post('in')
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
		summary: '🕐 Employee check-in',
		description: `
# Smart Check-In System

Advanced employee check-in system with location verification, biometric support, and comprehensive tracking.

## 📍 **Location-Based Check-In**
- **GPS Verification**: Verify employee location against designated work sites
- **Geofencing**: Automatic check-in when entering predefined work areas
- **QR Code Scanning**: Quick check-in using location-specific QR codes
- **Bluetooth Beacons**: Proximity-based check-in for indoor locations
- **Manual Override**: Supervisor approval for remote or off-site check-ins

## 🛡️ **Security & Verification**
- **Biometric Authentication**: Fingerprint, face recognition, or voice verification
- **Photo Capture**: Optional photo capture for identity verification
- **Device Verification**: Ensure check-in from authorized devices only
- **Time Constraints**: Enforce check-in within allowed time windows
- **Duplicate Prevention**: Prevent multiple check-ins for the same shift

## 📊 **Smart Analytics**
- **Pattern Recognition**: Learn employee check-in patterns and preferences
- **Anomaly Detection**: Identify unusual check-in behavior or locations
- **Predictive Analytics**: Forecast attendance patterns and staffing needs
- **Performance Insights**: Track punctuality and attendance trends
- **Compliance Monitoring**: Ensure adherence to labor laws and policies

## 🎯 **Use Cases**
- **Office Work**: Traditional office-based employee check-in
- **Field Work**: Remote and mobile workforce attendance tracking
- **Retail Operations**: Store and branch employee time tracking
- **Manufacturing**: Factory and production line attendance management
- **Healthcare**: Hospital and clinic staff scheduling and tracking
- **Construction**: Job site and project-based attendance monitoring

## 📱 **Multi-Platform Support**
- **Mobile Apps**: Native iOS and Android applications
- **Web Portal**: Browser-based check-in for desktop users
- **Kiosk Mode**: Dedicated tablet or terminal-based check-in
- **SMS Integration**: Simple SMS-based check-in for basic phones
- **Voice Commands**: Voice-activated check-in for hands-free operations

## 🔒 **Compliance & Reporting**
- **Labor Law Compliance**: Ensure adherence to working time regulations
- **Audit Trail**: Comprehensive logging for compliance and auditing
- **Privacy Protection**: GDPR and POPIA compliant data handling
- **Real-time Reporting**: Live attendance dashboards and alerts
		`,
	})
	@ApiBody({
		type: CreateCheckInDto,
		description: 'Check-in payload with location, timing, and verification information',
		examples: {
			standardCheckIn: {
				summary: '🏢 Standard Office Check-In',
				description: 'Regular office-based employee check-in',
				value: {
					userId: 45,
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 10,
					},
					timestamp: '2023-12-01T08:30:00Z',
					notes: 'Starting work day',
					deviceInfo: {
						deviceId: 'mobile-12345',
						platform: 'iOS',
						appVersion: '2.1.0',
					},
				},
			},
			qrCodeCheckIn: {
				summary: '📱 QR Code Check-In',
				description: 'Check-in using location QR code',
				value: {
					userId: 67,
					qrCodeData: 'CHK_LOC_MAIN_OFFICE_2023',
					timestamp: '2023-12-01T09:00:00Z',
					notes: 'QR code scan at main entrance',
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 5,
					},
				},
			},
			biometricCheckIn: {
				summary: '👆 Biometric Check-In',
				description: 'Check-in with biometric verification',
				value: {
					userId: 89,
					biometricData: {
						type: 'FINGERPRINT',
						templateHash: 'bio_hash_abc123',
						confidence: 0.98,
					},
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 8,
					},
					timestamp: '2023-12-01T08:45:00Z',
					notes: 'Biometric verification successful',
				},
			},
			remoteCheckIn: {
				summary: '🏠 Remote Work Check-In',
				description: 'Check-in for remote work with approval',
				value: {
					userId: 23,
					workType: 'REMOTE',
					approvedBy: 156,
					location: {
						latitude: -26.1234,
						longitude: 28.5678,
						accuracy: 15,
						address: 'Home Office - Cape Town',
					},
					timestamp: '2023-12-01T08:00:00Z',
					notes: 'Working from home - pre-approved',
					remoteWorkReason: 'Scheduled remote work day',
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: 'Check-in recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error recording check-in' },
			},
		},
	})
	@Post('in')
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
		summary: '🕐 Employee check-in',
		description: `
# Smart Check-In System

Advanced employee check-in system with location verification, biometric support, and comprehensive tracking.

## 📍 **Location-Based Check-In**
- **GPS Verification**: Verify employee location against designated work sites
- **Geofencing**: Automatic check-in when entering predefined work areas
- **QR Code Scanning**: Quick check-in using location-specific QR codes
- **Bluetooth Beacons**: Proximity-based check-in for indoor locations
- **Manual Override**: Supervisor approval for remote or off-site check-ins

## 🛡️ **Security & Verification**
- **Biometric Authentication**: Fingerprint, face recognition, or voice verification
- **Photo Capture**: Optional photo capture for identity verification
- **Device Verification**: Ensure check-in from authorized devices only
- **Time Constraints**: Enforce check-in within allowed time windows
- **Duplicate Prevention**: Prevent multiple check-ins for the same shift

## 📊 **Smart Analytics**
- **Pattern Recognition**: Learn employee check-in patterns and preferences
- **Anomaly Detection**: Identify unusual check-in behavior or locations
- **Predictive Analytics**: Forecast attendance patterns and staffing needs
- **Performance Insights**: Track punctuality and attendance trends
- **Compliance Monitoring**: Ensure adherence to labor laws and policies

## 🎯 **Use Cases**
- **Office Work**: Traditional office-based employee check-in
- **Field Work**: Remote and mobile workforce attendance tracking
- **Retail Operations**: Store and branch employee time tracking
- **Manufacturing**: Factory and production line attendance management
- **Healthcare**: Hospital and clinic staff scheduling and tracking
- **Construction**: Job site and project-based attendance monitoring

## 📱 **Multi-Platform Support**
- **Mobile Apps**: Native iOS and Android applications
- **Web Portal**: Browser-based check-in for desktop users
- **Kiosk Mode**: Dedicated tablet or terminal-based check-in
- **SMS Integration**: Simple SMS-based check-in for basic phones
- **Voice Commands**: Voice-activated check-in for hands-free operations

## 🔒 **Compliance & Reporting**
- **Labor Law Compliance**: Ensure adherence to working time regulations
- **Audit Trail**: Comprehensive logging for compliance and auditing
- **Privacy Protection**: GDPR and POPIA compliant data handling
- **Real-time Reporting**: Live attendance dashboards and alerts
		`,
	})
	@ApiBody({
		type: CreateCheckInDto,
		description: 'Check-in payload with location, timing, and verification information',
		examples: {
			standardCheckIn: {
				summary: '🏢 Standard Office Check-In',
				description: 'Regular office-based employee check-in',
				value: {
					userId: 45,
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 10,
					},
					timestamp: '2023-12-01T08:30:00Z',
					notes: 'Starting work day',
					deviceInfo: {
						deviceId: 'mobile-12345',
						platform: 'iOS',
						appVersion: '2.1.0',
					},
				},
			},
			qrCodeCheckIn: {
				summary: '📱 QR Code Check-In',
				description: 'Check-in using location QR code',
				value: {
					userId: 67,
					qrCodeData: 'CHK_LOC_MAIN_OFFICE_2023',
					timestamp: '2023-12-01T09:00:00Z',
					notes: 'QR code scan at main entrance',
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 5,
					},
				},
			},
			biometricCheckIn: {
				summary: '👆 Biometric Check-In',
				description: 'Check-in with biometric verification',
				value: {
					userId: 89,
					biometricData: {
						type: 'FINGERPRINT',
					},
					timestamp: '2023-12-01T08:45:00Z',
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 8,
					},
					notes: 'Biometric check-in at security gate',
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ Check-in recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Check-in recorded successfully' },
				data: {
					type: 'object',
					properties: {
						attendanceId: { type: 'number', example: 12345 },
						userId: { type: 'number', example: 45 },
						checkInTime: { type: 'string', format: 'date-time', example: '2023-12-01T08:30:00Z' },
						status: { type: 'string', example: 'PRESENT' },
						organisationId: { type: 'number', example: 1 },
						branchId: { type: 'number', example: 2 },
						location: {
							type: 'object',
							properties: {
								latitude: { type: 'number', example: -26.2041 },
								longitude: { type: 'number', example: 28.0473 },
								accuracy: { type: 'number', example: 10 },
							},
						},
						xpAwarded: { type: 'number', example: 10 },
						timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T08:30:00Z' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error recording check-in' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User ID is required',
						'Check-in location is required',
						'Invalid timestamp format',
						'User already checked in',
					],
				},
			},
		},
	})
	checkIn(@Body() createAttendanceDto: CreateCheckInDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;

		return this.attendanceService.checkIn(createAttendanceDto, orgId, branchId);
	}

	@Post('out')
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
		summary: '🕕 Employee check-out',
		description: `
# Smart Check-Out System

Advanced employee check-out system with location verification, work summary calculation, and comprehensive tracking.

## 📍 **Location-Based Check-Out**
- **GPS Verification**: Verify employee location against designated work sites
- **Geofencing**: Automatic check-out when leaving predefined work areas
- **QR Code Scanning**: Quick check-out using location-specific QR codes
- **Manual Override**: Supervisor approval for remote or off-site check-outs
- **Route Tracking**: Optional route tracking for field workers

## 🛡️ **Security & Verification**
- **Identity Verification**: Photo capture or biometric verification
- **Device Verification**: Ensure check-out from authorized devices only
- **Time Validation**: Prevent check-out during restricted hours
- **Work Completion**: Optional work summary and task completion status
- **Supervisor Approval**: Required approval for early departures

## 📊 **Work Summary Analytics**
- **Time Calculation**: Automatic calculation of total work hours
- **Break Deduction**: Intelligent break time calculation and deduction
- **Overtime Detection**: Automatic overtime calculation and flagging
- **Productivity Metrics**: Work efficiency and output measurements
- **Performance Insights**: Daily productivity and attendance patterns

## 🎯 **Use Cases**
- **Standard Shifts**: Regular office-based employee check-out
- **Field Work**: Mobile workforce and remote location check-out
- **Retail Operations**: Store and branch employee time tracking
- **Manufacturing**: Factory and production line attendance management
- **Healthcare**: Hospital and clinic staff scheduling tracking
- **Construction**: Job site and project-based attendance monitoring

## 📱 **Multi-Platform Support**
- **Mobile Apps**: Native iOS and Android applications
- **Web Portal**: Browser-based check-out for desktop users
- **Kiosk Mode**: Dedicated tablet or terminal-based check-out
- **Voice Commands**: Voice-activated check-out for hands-free operations
- **Automated Systems**: API-based check-out for integrated systems

## 🔒 **Compliance & Reporting**
- **Labor Law Compliance**: Ensure adherence to working time regulations
- **Audit Trail**: Comprehensive logging for compliance and auditing
- **Privacy Protection**: GDPR and POPIA compliant data handling
- **Real-time Reporting**: Live attendance dashboards and alerts
		`,
	})
	@ApiBody({
		type: CreateCheckOutDto,
		description: 'Check-out payload with location, timing, and work summary information',
		examples: {
			standardCheckOut: {
				summary: '🏢 Standard Office Check-Out',
				description: 'Regular office-based employee check-out',
				value: {
					userId: 45,
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 10,
					},
					timestamp: '2023-12-01T17:30:00Z',
					notes: 'Completed all daily tasks',
					workSummary: {
						tasksCompleted: 8,
						projectsWorked: ['PROJECT-A', 'PROJECT-B'],
						productivity: 'HIGH',
					},
				},
			},
			fieldWorkCheckOut: {
				summary: '🚗 Field Work Check-Out',
				description: 'Check-out from field work or client site',
				value: {
					userId: 67,
					location: {
						latitude: -26.1234,
						longitude: 28.5678,
						accuracy: 15,
						address: 'Client Site - Sandton',
					},
					timestamp: '2023-12-01T16:45:00Z',
					notes: 'Site inspection completed',
					workSummary: {
						clientVisits: 3,
						reportsGenerated: 2,
						kmTraveled: 45,
					},
				},
			},
			overtimeCheckOut: {
				summary: '⏰ Overtime Check-Out',
				description: 'Check-out after overtime work',
				value: {
					userId: 89,
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 8,
					},
					timestamp: '2023-12-01T19:30:00Z',
					notes: 'Overtime work for project deadline',
					overtimeReason: 'Project deadline completion',
					supervisorApproval: 156,
					workSummary: {
						extraHours: 2.5,
						urgentTasks: 3,
						projectProgress: '95%',
					},
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ Check-out recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Check-out recorded successfully' },
				data: {
					type: 'object',
					properties: {
						attendanceId: { type: 'number', example: 12345 },
						userId: { type: 'number', example: 45 },
						checkOutTime: { type: 'string', format: 'date-time', example: '2023-12-01T17:30:00Z' },
						totalWorkTime: { type: 'string', example: '8h 30m' },
						totalBreakTime: { type: 'string', example: '45m' },
						overtimeHours: { type: 'string', example: '0h 30m' },
						status: { type: 'string', example: 'COMPLETED' },
						workSummary: {
							type: 'object',
							properties: {
								productivity: { type: 'string', example: 'HIGH' },
								tasksCompleted: { type: 'number', example: 8 },
								efficiency: { type: 'number', example: 95 },
							},
						},
					},
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T17:30:00Z' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error recording check-out' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User ID is required',
						'Check-out location is required',
						'Invalid timestamp format',
						'User is not currently checked in',
					],
				},
			},
		},
	})
	checkOut(@Body() createAttendanceDto: CreateCheckOutDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.attendanceService.checkOut(createAttendanceDto, orgId, branchId);
	}

	@Post('break')
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
		summary: '☕ Manage employee breaks',
		description: `
# Smart Break Management System

Comprehensive break tracking system with intelligent timing, policy enforcement, and wellness monitoring.

## ⏰ **Break Types & Management**
- **Regular Breaks**: Standard 15-minute coffee and rest breaks
- **Lunch Breaks**: Extended meal breaks with customizable duration
- **Wellness Breaks**: Mental health and wellness-focused break periods
- **Emergency Breaks**: Unscheduled breaks for urgent personal needs
- **Team Breaks**: Coordinated group breaks for team activities

## 🛡️ **Policy Enforcement**
- **Duration Limits**: Automatic enforcement of maximum break durations
- **Frequency Control**: Prevent excessive break frequency
- **Mandatory Breaks**: Ensure compliance with labor law requirements
- **Overtime Breaks**: Additional break allowances during overtime
- **Supervisor Approval**: Required approval for extended or frequent breaks

## 📊 **Break Analytics**
- **Usage Patterns**: Track individual and team break patterns
- **Productivity Impact**: Analyze break timing impact on productivity
- **Wellness Metrics**: Monitor break frequency for employee wellness
- **Compliance Tracking**: Ensure adherence to labor regulations
- **Cost Analysis**: Calculate break-related time and cost impacts

## 🎯 **Use Cases**
- **Manufacturing**: Regulated break schedules for production workers
- **Office Work**: Flexible break management for knowledge workers
- **Healthcare**: Critical break management for medical staff
- **Retail**: Customer service break coordination
- **Remote Work**: Self-managed break tracking for remote employees
- **Call Centers**: Optimized break scheduling for continuous operations

## 📱 **Smart Features**
- **Auto-Detection**: Intelligent break detection using device sensors
- **Location Awareness**: Break area verification and monitoring
- **Wellness Reminders**: Proactive break suggestions for employee health
- **Team Coordination**: Coordinated break scheduling to maintain coverage
- **Integration**: Seamless integration with productivity and wellness apps

## 🔒 **Compliance & Reporting**
- **Labor Law Compliance**: Ensure adherence to break requirements
- **Audit Trail**: Complete break activity logging
- **Privacy Protection**: Secure handling of break and wellness data
- **Real-time Monitoring**: Live break status and team coverage dashboards
		`,
	})
	@ApiBody({
		type: CreateBreakDto,
		description: 'Break management payload with timing, type, and policy information',
		examples: {
			startLunchBreak: {
				summary: '🍽️ Start Lunch Break',
				description: 'Begin extended lunch break period',
				value: {
					userId: 45,
					action: 'START',
					breakType: 'LUNCH',
					expectedDuration: 60,
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 10,
					},
					timestamp: '2023-12-01T12:30:00Z',
					notes: 'Lunch break at cafeteria',
				},
			},
			endCoffeeBreak: {
				summary: '☕ End Coffee Break',
				description: 'Complete short coffee break',
				value: {
					userId: 67,
					action: 'END',
					breakType: 'COFFEE',
					actualDuration: 15,
					location: {
						latitude: -26.2041,
						longitude: 28.0473,
						accuracy: 8,
					},
					timestamp: '2023-12-01T10:15:00Z',
					notes: 'Quick coffee break completed',
				},
			},
			emergencyBreak: {
				summary: '🚨 Emergency Break',
				description: 'Unscheduled emergency break',
				value: {
					userId: 89,
					action: 'START',
					breakType: 'EMERGENCY',
					reason: 'Personal urgent matter',
					supervisorNotified: true,
					timestamp: '2023-12-01T14:45:00Z',
					notes: 'Emergency personal call required',
				},
			},
			wellnessBreak: {
				summary: '🧘 Wellness Break',
				description: 'Mental health and wellness break',
				value: {
					userId: 23,
					action: 'START',
					breakType: 'WELLNESS',
					expectedDuration: 20,
					wellnessActivity: 'MEDITATION',
					timestamp: '2023-12-01T15:30:00Z',
					notes: 'Mindfulness break for stress relief',
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ Break action processed successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Break started/ended successfully' },
				data: {
					type: 'object',
					properties: {
						breakId: { type: 'number', example: 67890 },
						userId: { type: 'number', example: 45 },
						action: { type: 'string', example: 'START', enum: ['START', 'END'] },
						breakType: { type: 'string', example: 'LUNCH' },
						startTime: { type: 'string', format: 'date-time', example: '2023-12-01T12:30:00Z' },
						endTime: { type: 'string', format: 'date-time', example: null, nullable: true },
						duration: { type: 'string', example: '30m', nullable: true },
						remainingBreakTime: { type: 'string', example: '30m' },
						policyCompliant: { type: 'boolean', example: true },
						wellnessScore: { type: 'number', example: 85 },
						nextBreakAllowed: { type: 'string', format: 'date-time', example: '2023-12-01T15:30:00Z' },
						teamCoverage: {
							type: 'object',
							properties: {
								available: { type: 'number', example: 8 },
								onBreak: { type: 'number', example: 2 },
								coverage: { type: 'string', example: 'ADEQUATE' },
							},
						},
					},
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T12:30:00Z' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error processing break action' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User ID is required',
						'Break action must be START or END',
						'Break type is required',
						'User is not currently checked in',
						'Maximum break duration exceeded',
					],
				},
				policyViolations: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Maximum daily break time exceeded',
						'Break frequency limit reached',
						'Insufficient time since last break',
					],
				},
			},
		},
	})
	manageBreak(@Body() breakDto: CreateBreakDto) {
		return this.attendanceService.manageBreak(breakDto);
	}

	@Get()
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
		summary: '📋 Get all attendance records',
		description: `
# Comprehensive Attendance Directory

Retrieves complete attendance records with advanced filtering, analytics, and comprehensive employee information.

## 📊 **Data Richness**
- **Complete Employee Profiles**: Full user information including photos, contact details, and roles
- **Branch Information**: Detailed branch data with location and management details
- **Time Analytics**: Comprehensive timing data with duration calculations and break tracking
- **Verification Status**: Security verification details and authentication logs
- **Performance Metrics**: Productivity indicators and attendance patterns

## 🔍 **Advanced Filtering**
- **Date Range Filtering**: Filter by specific date ranges or periods
- **Department Filtering**: Filter by specific departments or teams
- **Status Filtering**: Filter by attendance status (Present, Completed, On Break)
- **Branch Filtering**: Filter by specific branch locations
- **Role-Based Filtering**: Filter by employee roles and access levels

## 📈 **Analytics & Insights**
- **Attendance Patterns**: Identify trends and patterns in employee attendance
- **Productivity Analysis**: Correlate attendance with productivity metrics
- **Compliance Monitoring**: Track adherence to attendance policies
- **Performance Indicators**: Key performance metrics and benchmarks
- **Anomaly Detection**: Identify unusual attendance patterns or behaviors

## 🎯 **Use Cases**
- **Management Oversight**: Comprehensive view of organizational attendance
- **HR Analytics**: Detailed analysis for HR planning and decision making
- **Payroll Processing**: Accurate time tracking for payroll calculations
- **Compliance Reporting**: Generate reports for regulatory compliance
- **Performance Management**: Monitor employee attendance performance
- **Resource Planning**: Optimize staffing based on attendance patterns

## 🔒 **Security & Privacy**
- **Role-Based Access**: Data visibility based on user permissions and roles
- **Privacy Compliance**: GDPR and POPIA compliant data handling
- **Audit Trail**: Complete access logging for security and compliance
- **Data Encryption**: Secure transmission and storage of sensitive data

## 📱 **Export & Integration**
- **Multiple Formats**: Export data in various formats (Excel, PDF, CSV)
- **API Integration**: Seamless integration with HR and payroll systems
- **Real-time Updates**: Live data with real-time synchronization
- **Custom Reports**: Generate custom reports based on specific criteria
		`,
	})
	@ApiOkResponse({
		description: 'Attendance records retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkIns: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 123 },
							status: {
								type: 'string',
								enum: ['PRESENT', 'COMPLETED', 'ON_BREAK'],
								example: 'COMPLETED',
							},
							checkIn: { type: 'string', format: 'date-time', example: '2024-03-01T09:00:00Z' },
							checkOut: {
								type: 'string',
								format: 'date-time',
								example: '2024-03-01T17:30:00Z',
								nullable: true,
							},
							duration: { type: 'string', example: '8h 30m', nullable: true },
							checkInLatitude: { type: 'number', example: -26.2041, nullable: true },
							checkInLongitude: { type: 'number', example: 28.0473, nullable: true },
							checkOutLatitude: { type: 'number', example: -26.2041, nullable: true },
							checkOutLongitude: { type: 'number', example: 28.0473, nullable: true },
							checkInNotes: { type: 'string', example: 'Started work early today', nullable: true },
							checkOutNotes: { type: 'string', example: 'Completed all tasks', nullable: true },
							totalBreakTime: { type: 'string', example: '1h 15m', nullable: true },
							breakCount: { type: 'number', example: 2, nullable: true },
							createdAt: { type: 'string', format: 'date-time' },
							updatedAt: { type: 'string', format: 'date-time' },
							verifiedAt: { type: 'string', format: 'date-time', nullable: true },
							owner: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 45 },
									username: { type: 'string', example: 'john.doe' },
									name: { type: 'string', example: 'John' },
									surname: { type: 'string', example: 'Doe' },
									email: { type: 'string', example: 'john.doe@company.com' },
									phone: { type: 'string', example: '+27123456789', nullable: true },
									photoURL: {
										type: 'string',
										example: 'https://example.com/photo.jpg',
										nullable: true,
									},
									role: { type: 'string', example: 'employee' },
									status: { type: 'string', example: 'active' },
									accessLevel: {
										type: 'string',
										enum: ['ADMIN', 'MANAGER', 'USER', 'TECHNICIAN'],
										example: 'USER',
									},
									createdAt: { type: 'string', format: 'date-time' },
									updatedAt: { type: 'string', format: 'date-time' },
									branch: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 12 },
											name: { type: 'string', example: 'Main Branch' },
											ref: { type: 'string', example: 'MB001' },
											address: { type: 'string', example: '123 Main Street, City' },
										},
										nullable: true,
									},
									organisation: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 1 },
											name: { type: 'string', example: 'ABC Corporation' },
											ref: { type: 'string', example: 'ABC001' },
										},
										nullable: true,
									},
									userProfile: {
										type: 'object',
										properties: {
											uid: { type: 'number' },
											bio: { type: 'string', nullable: true },
											dateOfBirth: { type: 'string', format: 'date', nullable: true },
											address: { type: 'string', nullable: true },
											emergencyContact: { type: 'string', nullable: true },
										},
										nullable: true,
									},
								},
							},
							verifiedBy: {
								type: 'object',
								properties: {
									uid: { type: 'number' },
									name: { type: 'string' },
									surname: { type: 'string' },
									email: { type: 'string' },
									accessLevel: { type: 'string' },
								},
								nullable: true,
							},
							organisation: {
								type: 'object',
								properties: {
									uid: { type: 'number' },
									name: { type: 'string' },
									ref: { type: 'string' },
								},
								nullable: true,
							},
							branch: {
								type: 'object',
								properties: {
									uid: { type: 'number' },
									name: { type: 'string' },
									ref: { type: 'string' },
									address: { type: 'string' },
								},
								nullable: true,
							},
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'No attendance records found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No attendance records found' },
				checkIns: { type: 'null' },
			},
		},
	})
	allCheckIns(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.attendanceService.allCheckIns(orgId, branchId);
	}

	@Get('date/:date')
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
		summary: '📅 Get attendance records by date',
		description: `
# Date-Based Attendance Analytics

Retrieves comprehensive attendance records for a specific date with advanced filtering, user profiles, and performance analytics.

## 📊 **Data Richness**
- **Complete Employee Profiles**: Full user information including photos, contact details, and department assignments
- **Branch Analytics**: Detailed branch performance metrics and location-specific data
- **Time Tracking**: Precise check-in/check-out times with duration calculations
- **Break Analysis**: Comprehensive break patterns and compliance tracking
- **Verification Status**: Security verification details and authentication audit trails

## 🔍 **Advanced Analytics**
- **Daily Performance**: Individual and team performance metrics for the selected date
- **Attendance Patterns**: Identify punctuality trends and timing patterns
- **Productivity Insights**: Correlate attendance with work efficiency metrics
- **Compliance Monitoring**: Track adherence to company policies and labor regulations
- **Exception Reporting**: Identify anomalies, late arrivals, or policy violations

## 📈 **Historical Context**
- **Trend Analysis**: Compare current date performance with historical averages
- **Seasonal Patterns**: Identify seasonal attendance variations and trends
- **Comparative Analytics**: Benchmark against organization-wide performance metrics
- **Predictive Insights**: Use historical data to forecast future attendance patterns

## 🎯 **Use Cases**
- **Daily Management**: Real-time oversight of daily attendance performance
- **Payroll Processing**: Accurate time tracking for payroll calculations and overtime
- **Performance Reviews**: Historical attendance data for employee evaluations
- **Compliance Auditing**: Generate reports for regulatory compliance requirements
- **Resource Planning**: Optimize staffing based on historical attendance patterns
- **Shift Management**: Monitor shift coverage and identify staffing gaps

## 📱 **Integration & Reporting**
- **Real-time Updates**: Live data synchronization with attendance tracking systems
- **Export Capabilities**: Generate reports in multiple formats (Excel, PDF, CSV)
- **Dashboard Integration**: Seamless integration with management dashboards
- **API Access**: Programmatic access for third-party systems and applications
- **Notification Systems**: Automated alerts for attendance anomalies or policy violations

## 🔒 **Security & Privacy**
- **Role-Based Access**: Data visibility controlled by user permissions and organizational hierarchy
- **Privacy Compliance**: GDPR and POPIA compliant data handling and retention
- **Audit Trail**: Complete access logging for security and compliance requirements
- **Data Encryption**: Secure transmission and storage of sensitive attendance data
		`,
	})
	@ApiParam({
		name: 'date',
		description:
			'Date in YYYY-MM-DD format to filter attendance records. Supports both current and historical dates for trend analysis.',
		type: 'string',
		example: '2024-03-01',
		examples: {
			today: {
				summary: "📅 Today's Records",
				description: 'Get attendance records for today',
				value: '2024-03-01',
			},
			yesterday: {
				summary: "📅 Yesterday's Records",
				description: 'Get attendance records for yesterday',
				value: '2024-02-29',
			},
			monthStart: {
				summary: '📅 Month Start',
				description: 'Get attendance records for the first day of the month',
				value: '2024-03-01',
			},
			weekend: {
				summary: '📅 Weekend Records',
				description: 'Get attendance records for weekend work',
				value: '2024-03-02',
			},
		},
	})
	@ApiOkResponse({
		description: '✅ Date-filtered attendance records retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkIns: {
					type: 'array',
					description:
						'Array of attendance records for the specified date, ordered by check-in time (newest first)',
					items: {
						$ref: '#/components/schemas/AttendanceWithUserProfileSchema',
					},
				},
				analytics: {
					type: 'object',
					description: 'Daily attendance analytics and insights',
					properties: {
						totalEmployees: {
							type: 'number',
							example: 25,
							description: 'Total employees with attendance records',
						},
						presentEmployees: {
							type: 'number',
							example: 23,
							description: 'Number of employees currently present',
						},
						completedShifts: { type: 'number', example: 20, description: 'Number of completed shifts' },
						averageCheckInTime: {
							type: 'string',
							example: '08:47:00',
							description: 'Average check-in time',
						},
						averageCheckOutTime: {
							type: 'string',
							example: '17:23:00',
							description: 'Average check-out time',
						},
						punctualityRate: {
							type: 'number',
							example: 87.5,
							description: 'Percentage of on-time arrivals',
						},
						overtimeShifts: { type: 'number', example: 5, description: 'Number of shifts with overtime' },
						totalWorkHours: { type: 'number', example: 184.5, description: 'Total work hours for the day' },
						totalBreakTime: { type: 'number', example: 23.5, description: 'Total break time in hours' },
						attendanceRate: {
							type: 'number',
							example: 92.0,
							description: 'Daily attendance rate percentage',
						},
					},
				},
				dateInfo: {
					type: 'object',
					description: 'Information about the selected date',
					properties: {
						date: { type: 'string', example: '2024-03-01', description: 'Selected date' },
						dayOfWeek: { type: 'string', example: 'Friday', description: 'Day of the week' },
						isWeekend: { type: 'boolean', example: false, description: 'Whether the date is a weekend' },
						isHoliday: {
							type: 'boolean',
							example: false,
							description: 'Whether the date is a company holiday',
						},
						totalRecords: {
							type: 'number',
							example: 25,
							description: 'Total number of attendance records',
						},
					},
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2024-03-01T18:00:00Z',
					description: 'Report generation timestamp',
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ No attendance records found for the specified date',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No attendance records found for 2024-03-01' },
				checkIns: { type: 'null' },
				analytics: { type: 'null' },
				dateInfo: {
					type: 'object',
					properties: {
						date: { type: 'string', example: '2024-03-01' },
						dayOfWeek: { type: 'string', example: 'Friday' },
						isWeekend: { type: 'boolean', example: false },
						isHoliday: { type: 'boolean', example: false },
						totalRecords: { type: 'number', example: 0 },
					},
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Check if the date is a weekend or holiday',
						'Verify employees were scheduled to work on this date',
						'Try a different date range',
						'Contact system administrator if this seems incorrect',
					],
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-01T18:00:00Z' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid date format or parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid date format. Please use YYYY-MM-DD format' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				checkIns: { type: 'null' },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Date must be in YYYY-MM-DD format',
						'Date cannot be in the future',
						'Date cannot be before system implementation date',
						'Invalid date value provided',
					],
				},
				supportedFormats: {
					type: 'array',
					items: { type: 'string' },
					example: ['YYYY-MM-DD', '2024-03-01', '2024-12-31'],
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-01T18:00:00Z' },
			},
		},
	})
	checkInsByDate(@Param('date') date: string, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.attendanceService.checkInsByDate(date, orgId, branchId);
	}

	@Get('user/:ref')
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
		summary: '👤 Get attendance records by user',
		description: `
# Individual Employee Attendance Analytics

Retrieves comprehensive attendance records for a specific user with detailed analytics, performance insights, and historical trends.

## 👥 **Employee Profile Integration**
- **Complete User Profile**: Full employee information including photo, contact details, and role assignments
- **Department Context**: Department and team information with organizational hierarchy
- **Branch Assignment**: Location-specific data and branch performance metrics
- **Employment History**: Job title, start date, and career progression within the organization
- **Performance Ratings**: Integration with performance management systems and ratings

## 📊 **Comprehensive Analytics**
- **Attendance Patterns**: Historical attendance trends and punctuality analysis
- **Work-Life Balance**: Analysis of work hours, overtime patterns, and time-off usage
- **Productivity Metrics**: Correlation between attendance and productivity indicators
- **Compliance Tracking**: Adherence to company policies and labor law requirements
- **Performance Insights**: Attendance impact on individual and team performance

## 🔍 **Detailed Time Tracking**
- **Precision Timing**: Exact check-in and check-out times with location verification
- **Break Analysis**: Detailed break patterns, duration, and frequency analysis
- **Overtime Tracking**: Overtime hours with approval status and compensation details
- **Time Adjustments**: Manual time corrections and supervisor approvals
- **Schedule Compliance**: Comparison with scheduled hours and shift assignments

## 📈 **Historical Analysis**
- **Trend Identification**: Long-term attendance patterns and seasonal variations
- **Comparative Analysis**: Performance against team and organization averages
- **Improvement Tracking**: Progress monitoring and attendance improvement initiatives
- **Predictive Analytics**: Forecast future attendance based on historical patterns
- **Risk Assessment**: Identify potential attendance issues before they become problems

## 🎯 **Use Cases**
- **Performance Reviews**: Comprehensive attendance data for employee evaluations
- **Payroll Processing**: Accurate time tracking for salary and overtime calculations
- **HR Analytics**: Individual employee insights for HR planning and development
- **Compliance Auditing**: Detailed records for regulatory compliance and auditing
- **Team Management**: Monitor individual contributions to team performance
- **Career Development**: Track attendance as part of professional development plans

## 📱 **Management Tools**
- **Dashboard Integration**: Real-time attendance monitoring and alerts
- **Report Generation**: Custom reports for management and HR purposes
- **Notification System**: Automated alerts for attendance anomalies or issues
- **Mobile Access**: Mobile-optimized views for managers and supervisors
- **Integration APIs**: Seamless integration with HRIS and payroll systems

## 🔒 **Privacy & Security**
- **Data Protection**: GDPR and POPIA compliant handling of personal data
- **Access Control**: Role-based access to sensitive employee information
- **Audit Trail**: Complete logging of data access and modifications
- **Consent Management**: Employee consent tracking for data processing
- **Anonymization**: Options for anonymized reporting and analytics
		`,
	})
	@ApiParam({
		name: 'ref',
		description:
			'User ID to retrieve attendance records for. Supports both numeric user IDs and username references for flexible querying.',
		type: 'number',
		example: 45,
		examples: {
			numericId: {
				summary: '🔢 Numeric User ID',
				description: 'Get attendance records using numeric user ID',
				value: 45,
			},
			managerId: {
				summary: '👨‍💼 Manager ID',
				description: 'Get attendance records for a manager',
				value: 123,
			},
			newEmployeeId: {
				summary: '🆕 New Employee ID',
				description: 'Get attendance records for a recently hired employee',
				value: 789,
			},
			seniorEmployeeId: {
				summary: '👴 Senior Employee ID',
				description: 'Get attendance records for a long-term employee',
				value: 12,
			},
		},
	})
	@ApiOkResponse({
		description: '✅ User attendance records retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkIns: {
					type: 'array',
					description:
						'Array of attendance records for the specified user, ordered by check-in time (newest first)',
					items: {
						$ref: '#/components/schemas/AttendanceWithUserProfileSchema',
					},
				},
				user: {
					type: 'object',
					description: 'Complete user profile information including branch and organization details',
					properties: {
						uid: { type: 'number', example: 45 },
						username: { type: 'string', example: 'john.doe' },
						name: { type: 'string', example: 'John' },
						surname: { type: 'string', example: 'Doe' },
						email: { type: 'string', example: 'john.doe@company.com' },
						phone: { type: 'string', example: '+27123456789', nullable: true },
						photoURL: { type: 'string', example: 'https://example.com/photo.jpg', nullable: true },
						role: { type: 'string', example: 'employee' },
						status: { type: 'string', example: 'active' },
						accessLevel: {
							type: 'string',
							enum: ['ADMIN', 'MANAGER', 'USER', 'TECHNICIAN', 'HR'],
							example: 'USER',
						},
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
						branch: {
							type: 'object',
							description: 'Branch information where the user is assigned',
							properties: {
								uid: { type: 'number', example: 12 },
								name: { type: 'string', example: 'Main Branch' },
								ref: { type: 'string', example: 'MB001' },
								address: { type: 'string', example: '123 Main Street, City' },
							},
							nullable: true,
						},
						organisation: {
							type: 'object',
							description: 'Organization information the user belongs to',
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'ABC Corporation' },
								ref: { type: 'string', example: 'ABC001' },
							},
							nullable: true,
						},
						userProfile: {
							type: 'object',
							description: 'Additional user profile information',
							properties: {
								uid: { type: 'number' },
								bio: { type: 'string', nullable: true },
								dateOfBirth: { type: 'string', format: 'date', nullable: true },
								address: { type: 'string', nullable: true },
								emergencyContact: { type: 'string', nullable: true },
							},
							nullable: true,
						},
					},
				},
				userAnalytics: {
					type: 'object',
					description: 'Individual user attendance analytics and performance metrics',
					properties: {
						totalRecords: {
							type: 'number',
							example: 45,
							description: 'Total attendance records for this user',
						},
						attendanceRate: {
							type: 'number',
							example: 95.5,
							description: 'Overall attendance rate percentage',
						},
						averageHoursPerDay: {
							type: 'number',
							example: 8.2,
							description: 'Average hours worked per day',
						},
						punctualityScore: {
							type: 'number',
							example: 87.5,
							description: 'Punctuality score percentage',
						},
						overtimeFrequency: {
							type: 'number',
							example: 15.5,
							description: 'Percentage of shifts with overtime',
						},
						averageCheckInTime: {
							type: 'string',
							example: '08:47:00',
							description: 'Average check-in time',
						},
						averageCheckOutTime: {
							type: 'string',
							example: '17:23:00',
							description: 'Average check-out time',
						},
						totalWorkHours: {
							type: 'number',
							example: 368.5,
							description: 'Total work hours across all records',
						},
						totalBreakTime: { type: 'number', example: 42.5, description: 'Total break time in hours' },
						longestShift: {
							type: 'string',
							example: '11h 30m',
							description: 'Longest single shift duration',
						},
						shortestShift: {
							type: 'string',
							example: '6h 15m',
							description: 'Shortest single shift duration',
						},
						attendanceStreak: {
							type: 'number',
							example: 12,
							description: 'Current consecutive attendance streak',
						},
						lastAttendance: {
							type: 'string',
							format: 'date-time',
							example: '2024-03-01T17:30:00Z',
							description: 'Last attendance record timestamp',
						},
					},
				},
				performanceInsights: {
					type: 'object',
					description: 'Performance insights and recommendations',
					properties: {
						strengths: {
							type: 'array',
							items: { type: 'string' },
							example: ['Excellent punctuality', 'Consistent attendance', 'Good work-life balance'],
							description: 'Identified performance strengths',
						},
						improvements: {
							type: 'array',
							items: { type: 'string' },
							example: ['Consider reducing overtime hours', 'Optimize break timing'],
							description: 'Suggested areas for improvement',
						},
						trendAnalysis: {
							type: 'object',
							properties: {
								trend: {
									type: 'string',
									example: 'IMPROVING',
									enum: ['IMPROVING', 'STABLE', 'DECLINING'],
								},
								confidence: {
									type: 'number',
									example: 85.5,
									description: 'Confidence level of trend analysis',
								},
								details: {
									type: 'string',
									example: 'Punctuality has improved by 12% over the last 3 months',
								},
							},
						},
					},
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2024-03-01T18:00:00Z',
					description: 'Report generation timestamp',
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ User not found or no attendance records found for user',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No attendance records found for user ID 45' },
				checkIns: { type: 'null' },
				user: { type: 'null' },
				userAnalytics: { type: 'null' },
				performanceInsights: { type: 'null' },
				errorDetails: {
					type: 'object',
					properties: {
						errorType: {
							type: 'string',
							example: 'USER_NOT_FOUND',
							enum: ['USER_NOT_FOUND', 'NO_RECORDS_FOUND', 'ACCESS_DENIED'],
						},
						userId: { type: 'number', example: 45, description: 'The user ID that was queried' },
						possibleCauses: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'User ID does not exist in the system',
								'User has been deactivated or deleted',
								'User has not yet recorded any attendance',
								'User belongs to a different organization',
								'Access permissions do not allow viewing this user',
							],
						},
					},
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the user ID is correct',
						'Check if the user is active in the system',
						"Ensure you have permission to view this user's data",
						'Contact system administrator if the user should exist',
						'Try searching by username or email instead',
					],
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-01T18:00:00Z' },
			},
		},
	})
	checkInsByUser(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.attendanceService.checkInsByUser(ref, orgId, branchId);
	}

	@Get('status/:ref')
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
		summary: '📊 Get user attendance status',
		description: `
# Real-Time Attendance Status Monitoring

Retrieves the current attendance status for a specific user with live updates, shift information, and intelligent next-action recommendations.

## ⏰ **Real-Time Status Tracking**
- **Live Status Updates**: Real-time attendance status with automatic refresh capabilities
- **Shift Information**: Current shift details including start time, expected end time, and duration
- **Break Status**: Current break status and remaining break time allowances
- **Location Tracking**: Last known location and current work site information
- **Device Status**: Last active device and platform information for security monitoring

## 🤖 **Intelligent Action Recommendations**
- **Next Action Suggestions**: Smart recommendations for next user action (check-in, check-out, break)
- **Policy Compliance**: Automatic compliance checking against company policies
- **Overtime Alerts**: Proactive notifications for approaching overtime thresholds
- **Break Reminders**: Intelligent break suggestions based on work patterns and regulations
- **Schedule Optimization**: Recommendations for optimal shift timing and productivity

## 📱 **Multi-Platform Status**
- **Cross-Device Synchronization**: Status updates across all user devices and platforms
- **Mobile App Integration**: Real-time status updates for mobile applications
- **Web Dashboard**: Live status monitoring for web-based management dashboards
- **API Integration**: Status data available for third-party integrations
- **Notification Systems**: Push notifications for status changes and reminders

## 🔍 **Advanced Analytics**
- **Current Shift Analysis**: Detailed analysis of current shift performance
- **Historical Context**: Comparison with previous shifts and performance patterns
- **Productivity Metrics**: Real-time productivity indicators and efficiency scoring
- **Team Context**: Individual status within team and organizational context
- **Performance Insights**: Immediate feedback on current shift performance

## 🎯 **Use Cases**
- **Shift Management**: Real-time monitoring of employee shift status
- **Payroll Accuracy**: Live time tracking for accurate payroll processing
- **Compliance Monitoring**: Ensure adherence to labor laws and company policies
- **Team Coordination**: Monitor team member availability and status
- **Performance Management**: Real-time performance feedback and coaching
- **Emergency Response**: Quick access to employee status during emergencies

## 📊 **Status Intelligence**
- **Predictive Analytics**: Forecast likely next actions based on historical patterns
- **Anomaly Detection**: Identify unusual patterns or potential issues
- **Efficiency Scoring**: Real-time efficiency and productivity calculations
- **Trend Analysis**: Short-term trends and pattern recognition
- **Risk Assessment**: Identify potential attendance or performance risks

## 🔒 **Security & Privacy**
- **Secure Status Monitoring**: Encrypted status data transmission and storage
- **Privacy Controls**: User control over status visibility and sharing
- **Access Logging**: Complete audit trail of status access and modifications
- **Compliance Assurance**: GDPR and POPIA compliant status data handling
- **Role-Based Visibility**: Status information visibility based on user roles and permissions
		`,
	})
	@ApiParam({
		name: 'ref',
		description:
			'User ID to retrieve attendance status for. Returns comprehensive status information including current shift details and next action recommendations.',
		type: 'number',
		example: 45,
		examples: {
			activeEmployee: {
				summary: '🟢 Active Employee',
				description: 'Get status for currently active employee',
				value: 45,
			},
			managerStatus: {
				summary: '👨‍💼 Manager Status',
				description: 'Get attendance status for a manager',
				value: 123,
			},
			onBreakEmployee: {
				summary: '☕ Employee on Break',
				description: 'Get status for employee currently on break',
				value: 78,
			},
			overtimeEmployee: {
				summary: '⏰ Overtime Employee',
				description: 'Get status for employee working overtime',
				value: 156,
			},
		},
	})
	@ApiOkResponse({
		description: '✅ User attendance status retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				startTime: {
					type: 'string',
					description: 'Check-in timestamp for the latest shift',
					example: '2024-03-01T09:00:00.000Z',
				},
				endTime: {
					type: 'string',
					description: 'Check-out timestamp (null if currently active)',
					example: '2024-03-01T17:30:00.000Z',
					nullable: true,
				},
				createdAt: { type: 'string', format: 'date-time' },
				updatedAt: { type: 'string', format: 'date-time' },
				verifiedAt: { type: 'string', format: 'date-time', nullable: true },
				nextAction: {
					type: 'string',
					description: 'Suggested next action for the user',
					enum: ['Start Shift', 'End Shift', 'Take Break', 'End Break'],
					example: 'End Shift',
				},
				isLatestCheckIn: {
					type: 'boolean',
					description: 'Whether the latest check-in was today',
					example: true,
				},
				checkedIn: {
					type: 'boolean',
					description: 'Current check-in status of the user',
					example: true,
				},
				user: {
					type: 'object',
					description: 'Complete user profile information',
					properties: {
						uid: { type: 'number', example: 45 },
						username: { type: 'string', example: 'john.doe' },
						name: { type: 'string', example: 'John' },
						surname: { type: 'string', example: 'Doe' },
						email: { type: 'string', example: 'john.doe@company.com' },
						phone: { type: 'string', example: '+27123456789', nullable: true },
						photoURL: { type: 'string', example: 'https://example.com/photo.jpg', nullable: true },
						role: { type: 'string', example: 'employee' },
						status: { type: 'string', example: 'active' },
						accessLevel: {
							type: 'string',
							enum: ['ADMIN', 'MANAGER', 'USER', 'TECHNICIAN', 'HR'],
							example: 'USER',
						},
						branch: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12 },
								name: { type: 'string', example: 'Main Branch' },
								ref: { type: 'string', example: 'MB001' },
							},
							nullable: true,
						},
						organisation: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'ABC Corporation' },
								ref: { type: 'string', example: 'ABC001' },
							},
							nullable: true,
						},
					},
				},
				attendance: {
					type: 'object',
					description: 'Complete attendance record details',
					properties: {
						uid: { type: 'number', example: 123 },
						status: { type: 'string', enum: ['PRESENT', 'COMPLETED', 'ON_BREAK'], example: 'PRESENT' },
						checkIn: { type: 'string', format: 'date-time' },
						checkOut: { type: 'string', format: 'date-time', nullable: true },
						duration: { type: 'string', example: '8h 30m', nullable: true },
						checkInLatitude: { type: 'number', nullable: true },
						checkInLongitude: { type: 'number', nullable: true },
						checkOutLatitude: { type: 'number', nullable: true },
						checkOutLongitude: { type: 'number', nullable: true },
						totalBreakTime: { type: 'string', example: '1h 15m', nullable: true },
						breakCount: { type: 'number', example: 2, nullable: true },
					},
				},
				statusAnalytics: {
					type: 'object',
					description: 'Real-time status analytics and insights',
					properties: {
						currentShiftDuration: {
							type: 'string',
							example: '7h 45m',
							description: 'Current shift duration',
						},
						expectedEndTime: {
							type: 'string',
							format: 'date-time',
							example: '2024-03-01T17:00:00Z',
							description: 'Expected shift end time',
						},
						overtime: { type: 'boolean', example: false, description: 'Whether currently in overtime' },
						breakTimeRemaining: {
							type: 'string',
							example: '45m',
							description: 'Remaining break time allowance',
						},
						productivityScore: {
							type: 'number',
							example: 85.5,
							description: 'Current shift productivity score',
						},
						complianceStatus: {
							type: 'string',
							example: 'COMPLIANT',
							enum: ['COMPLIANT', 'WARNING', 'VIOLATION'],
						},
						riskLevel: { type: 'string', example: 'LOW', enum: ['LOW', 'MEDIUM', 'HIGH'] },
					},
				},
				recommendations: {
					type: 'object',
					description: 'Intelligent recommendations for optimal performance',
					properties: {
						nextBreakSuggestion: {
							type: 'string',
							format: 'date-time',
							example: '2024-03-01T14:30:00Z',
							nullable: true,
						},
						optimalCheckoutTime: { type: 'string', format: 'date-time', example: '2024-03-01T17:00:00Z' },
						wellnessAlert: {
							type: 'string',
							example: 'Consider taking a break for optimal performance',
							nullable: true,
						},
						efficiencyTips: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Take regular breaks to maintain productivity',
								'Stay hydrated throughout the shift',
							],
						},
					},
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2024-03-01T18:00:00Z',
					description: 'Status check timestamp',
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ User not found or no attendance records found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No attendance records found for user ID 45' },
				startTime: { type: 'null' },
				endTime: { type: 'null' },
				nextAction: { type: 'null' },
				isLatestCheckIn: { type: 'boolean', example: false },
				checkedIn: { type: 'boolean', example: false },
				user: { type: 'null' },
				attendance: { type: 'null' },
				statusAnalytics: { type: 'null' },
				recommendations: { type: 'null' },
				errorDetails: {
					type: 'object',
					properties: {
						errorType: {
							type: 'string',
							example: 'NO_STATUS_FOUND',
							enum: ['NO_STATUS_FOUND', 'USER_NOT_FOUND', 'INACTIVE_USER'],
						},
						userId: { type: 'number', example: 45 },
						lastKnownStatus: { type: 'string', example: 'COMPLETED', nullable: true },
						lastActivity: {
							type: 'string',
							format: 'date-time',
							example: '2024-02-28T17:30:00Z',
							nullable: true,
						},
					},
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Check if user has checked in today',
						'Verify user is active and has attendance permissions',
						'User may need to check in to start tracking',
						'Contact system administrator if user should have status',
					],
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-01T18:00:00Z' },
			},
		},
	})
	checkInsByStatus(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.attendanceService.checkInsByStatus(ref, orgId, branchId);
	}

	@Get('branch/:ref')
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
		summary: '🏢 Get attendance records by branch',
		description: `
# Branch-Level Attendance Analytics

Retrieves comprehensive attendance records for a specific branch with advanced analytics, team performance metrics, and operational insights.

## 🏢 **Branch-Specific Analytics**
- **Complete Branch Profile**: Detailed branch information including location, capacity, and operational details
- **Team Performance Metrics**: Comprehensive team attendance patterns and productivity analysis
- **Operational Insights**: Branch-specific operational efficiency and resource utilization metrics
- **Location Analytics**: Geographic and facility-based attendance patterns and trends
- **Capacity Management**: Employee density, workspace utilization, and capacity planning insights

## 📊 **Comprehensive Team Analytics**
- **Team Attendance Patterns**: Historical and real-time team attendance trends
- **Performance Benchmarking**: Branch performance against organizational standards
- **Productivity Analysis**: Correlation between attendance and team productivity metrics
- **Resource Allocation**: Optimal staffing patterns and resource distribution analysis
- **Shift Coverage**: Comprehensive shift coverage analysis and gap identification

## 🔍 **Advanced Filtering & Analysis**
- **Multi-Dimensional Filtering**: Filter by department, role, shift, or time period
- **Comparative Analysis**: Compare branch performance with other branches
- **Trend Analysis**: Identify seasonal patterns and long-term trends
- **Exception Reporting**: Highlight anomalies and attendance policy violations
- **Predictive Insights**: Forecast future attendance patterns and staffing needs

## 📈 **Performance Metrics**
- **Attendance Rates**: Overall branch attendance rates and punctuality metrics
- **Productivity Indicators**: Team productivity correlation with attendance patterns
- **Efficiency Scores**: Branch operational efficiency and effectiveness metrics
- **Cost Analysis**: Labor cost analysis and optimization opportunities
- **Quality Metrics**: Service quality correlation with attendance and staffing levels

## 🎯 **Use Cases**
- **Branch Management**: Comprehensive branch performance monitoring and optimization
- **Resource Planning**: Strategic staffing and resource allocation decisions
- **Performance Review**: Branch-level performance evaluation and improvement planning
- **Compliance Monitoring**: Ensure adherence to labor laws and organizational policies
- **Cost Optimization**: Identify cost-saving opportunities through attendance optimization
- **Expansion Planning**: Use attendance data for future branch planning and expansion

## 📱 **Management Dashboard**
- **Real-Time Monitoring**: Live branch attendance and performance monitoring
- **Executive Reports**: High-level executive reporting and insights
- **Operational Dashboards**: Detailed operational views for branch managers
- **Mobile Access**: Mobile-optimized views for on-the-go management
- **Alert Systems**: Automated alerts for attendance anomalies and issues

## 🔒 **Security & Compliance**
- **Access Control**: Role-based access to branch-specific data
- **Data Privacy**: GDPR and POPIA compliant data handling and protection
- **Audit Trail**: Complete audit trail for all branch data access
- **Compliance Reporting**: Automated compliance reporting and monitoring
- **Security Monitoring**: Enhanced security monitoring for branch-specific data
		`,
	})
	@ApiParam({
		name: 'ref',
		description:
			'Branch reference code to filter attendance records. Supports both branch codes and names for flexible querying.',
		type: 'string',
		example: 'MB001',
		examples: {
			mainBranch: {
				summary: '🏢 Main Branch',
				description: 'Get attendance records for the main branch',
				value: 'MB001',
			},
			salesBranch: {
				summary: '💼 Sales Branch',
				description: 'Get attendance records for sales branch',
				value: 'SB001',
			},
			techBranch: {
				summary: '💻 Technology Branch',
				description: 'Get attendance records for technology branch',
				value: 'TB001',
			},
			regionalBranch: {
				summary: '🌍 Regional Branch',
				description: 'Get attendance records for regional branch',
				value: 'RB001',
			},
		},
	})
	@ApiOkResponse({
		description: '✅ Branch attendance records retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkIns: {
					type: 'array',
					description:
						'Array of attendance records for the specified branch, ordered by check-in time (newest first)',
					items: {
						$ref: '#/components/schemas/AttendanceWithUserProfileSchema',
					},
				},
				branch: {
					type: 'object',
					description: 'Complete branch information',
					properties: {
						uid: { type: 'number', example: 12 },
						name: { type: 'string', example: 'Main Branch' },
						ref: { type: 'string', example: 'MB001' },
						address: { type: 'string', example: '123 Main Street, City' },
						city: { type: 'string', example: 'Johannesburg' },
						province: { type: 'string', example: 'Gauteng' },
						postalCode: { type: 'string', example: '2000' },
						phone: { type: 'string', example: '+27111234567', nullable: true },
						email: { type: 'string', example: 'mainbranch@company.com', nullable: true },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
					nullable: true,
				},
				totalUsers: {
					type: 'number',
					description: 'Number of unique users who have attendance records in this branch',
					example: 15,
				},
				branchAnalytics: {
					type: 'object',
					description: 'Comprehensive branch analytics and performance metrics',
					properties: {
						totalRecords: {
							type: 'number',
							example: 85,
							description: 'Total attendance records for this branch',
						},
						averageAttendanceRate: {
							type: 'number',
							example: 92.5,
							description: 'Average attendance rate percentage',
						},
						averageHoursPerEmployee: {
							type: 'number',
							example: 8.1,
							description: 'Average hours worked per employee',
						},
						punctualityRate: {
							type: 'number',
							example: 89.2,
							description: 'Branch punctuality rate percentage',
						},
						overtimeFrequency: {
							type: 'number',
							example: 18.5,
							description: 'Percentage of shifts with overtime',
						},
						averageCheckInTime: {
							type: 'string',
							example: '08:52:00',
							description: 'Average check-in time for the branch',
						},
						averageCheckOutTime: {
							type: 'string',
							example: '17:18:00',
							description: 'Average check-out time for the branch',
						},
						totalWorkHours: {
							type: 'number',
							example: 682.5,
							description: 'Total work hours for all employees',
						},
						totalBreakTime: { type: 'number', example: 78.5, description: 'Total break time in hours' },
						activeEmployees: {
							type: 'number',
							example: 12,
							description: 'Number of currently active employees',
						},
						completedShifts: { type: 'number', example: 73, description: 'Number of completed shifts' },
						peakActivity: {
							type: 'string',
							example: '09:00-10:00',
							description: 'Peak activity time period',
						},
					},
				},
				performanceMetrics: {
					type: 'object',
					description: 'Branch performance metrics and benchmarking',
					properties: {
						efficiencyScore: { type: 'number', example: 87.5, description: 'Branch efficiency score' },
						productivityIndex: { type: 'number', example: 91.2, description: 'Branch productivity index' },
						complianceRate: {
							type: 'number',
							example: 95.8,
							description: 'Policy compliance rate percentage',
						},
						costEfficiency: { type: 'number', example: 82.3, description: 'Cost efficiency score' },
						teamCollaboration: { type: 'number', example: 88.7, description: 'Team collaboration score' },
						benchmarkComparison: {
							type: 'object',
							properties: {
								organizationAverage: {
									type: 'number',
									example: 85.2,
									description: 'Organization average score',
								},
								industryBenchmark: {
									type: 'number',
									example: 83.4,
									description: 'Industry benchmark score',
								},
								ranking: { type: 'number', example: 2, description: 'Ranking among all branches' },
							},
						},
					},
				},
				operationalInsights: {
					type: 'object',
					description: 'Operational insights and recommendations',
					properties: {
						capacityUtilization: {
							type: 'number',
							example: 78.5,
							description: 'Workspace capacity utilization percentage',
						},
						optimalStaffing: {
							type: 'number',
							example: 16,
							description: 'Recommended optimal staffing level',
						},
						peakHours: {
							type: 'array',
							items: { type: 'string' },
							example: ['09:00-11:00', '14:00-16:00'],
							description: 'Peak activity hours',
						},
						improvements: {
							type: 'array',
							items: { type: 'string' },
							example: ['Optimize break scheduling', 'Implement flexible work hours'],
							description: 'Recommended improvements',
						},
					},
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2024-03-01T18:00:00Z',
					description: 'Report generation timestamp',
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Branch not found or no attendance records found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No attendance records found for branch MB001' },
				checkIns: { type: 'null' },
				branch: { type: 'null' },
				totalUsers: { type: 'number', example: 0 },
				branchAnalytics: { type: 'null' },
				performanceMetrics: { type: 'null' },
				operationalInsights: { type: 'null' },
				errorDetails: {
					type: 'object',
					properties: {
						errorType: {
							type: 'string',
							example: 'BRANCH_NOT_FOUND',
							enum: ['BRANCH_NOT_FOUND', 'NO_RECORDS_FOUND', 'INACTIVE_BRANCH'],
						},
						branchRef: {
							type: 'string',
							example: 'MB001',
							description: 'The branch reference that was queried',
						},
						possibleCauses: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Branch reference code does not exist',
								'Branch has been deactivated or closed',
								'No employees assigned to this branch',
								'Branch belongs to a different organization',
								'Access permissions do not allow viewing this branch',
							],
						},
					},
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the branch reference code is correct',
						'Check if the branch is active in the system',
						'Ensure employees are assigned to this branch',
						'Verify you have permission to view this branch data',
						'Contact system administrator if the branch should exist',
					],
				},
				alternativeBranches: {
					type: 'array',
					items: { type: 'string' },
					example: ['MB002', 'SB001', 'TB001'],
					description: 'Available branch references that might be relevant',
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-01T18:00:00Z' },
			},
		},
	})
	checkInsByBranch(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		return this.attendanceService.checkInsByBranch(ref, orgId);
	}

	@Get('daily-stats/:uid')
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
		summary: '📊 Get daily attendance statistics',
		description: `
# Daily Attendance Statistics & Analytics

Retrieves comprehensive daily attendance statistics for a specific user with detailed time analysis, productivity metrics, and performance insights.

## ⏱️ **Precise Time Tracking**
- **Millisecond Precision**: Exact time calculations in milliseconds for accurate payroll and analytics
- **Work Time Analysis**: Detailed breakdown of actual work time excluding breaks and non-productive periods
- **Break Time Tracking**: Comprehensive break time analysis with duration and frequency metrics
- **Overtime Calculations**: Automatic overtime detection and calculation based on company policies
- **Time Adjustments**: Support for manual time adjustments and corrections with audit trails

## 📈 **Productivity Analytics**
- **Productivity Scoring**: Real-time productivity scoring based on work patterns and output
- **Efficiency Metrics**: Work efficiency calculations comparing actual vs. expected performance
- **Performance Benchmarking**: Comparison with historical performance and team averages
- **Goal Tracking**: Progress tracking against daily and weekly productivity goals
- **Quality Indicators**: Work quality metrics and performance indicators

## 🔍 **Advanced Analytics**
- **Pattern Recognition**: Identify daily work patterns and productivity trends
- **Anomaly Detection**: Detect unusual work patterns or potential issues
- **Predictive Insights**: Forecast daily performance based on current trends
- **Comparative Analysis**: Compare daily performance with previous days and periods
- **Wellness Indicators**: Monitor work-life balance and employee wellness metrics

## 🎯 **Use Cases**
- **Payroll Processing**: Accurate time tracking for daily payroll calculations
- **Performance Management**: Daily performance monitoring and feedback
- **Resource Planning**: Optimize daily resource allocation and task assignment
- **Compliance Monitoring**: Ensure adherence to daily work hour regulations
- **Wellness Tracking**: Monitor employee wellness and work-life balance
- **Project Management**: Track daily project progress and time allocation

## 📊 **Statistical Insights**
- **Time Distribution**: Detailed breakdown of how daily time is spent
- **Productivity Curves**: Identify peak productivity periods throughout the day
- **Efficiency Trends**: Track efficiency improvements and decline patterns
- **Comparison Metrics**: Compare with team, department, and organizational averages
- **Goal Achievement**: Track progress toward daily and weekly objectives

## 🔄 **Real-Time Updates**
- **Live Statistics**: Real-time updates of daily statistics as the day progresses
- **Dynamic Calculations**: Automatic recalculation of statistics as new data arrives
- **Instant Feedback**: Immediate feedback on daily performance and productivity
- **Progressive Tracking**: Track progress throughout the day with hourly updates
- **Milestone Alerts**: Automatic alerts for achieving daily goals and milestones

## 🔒 **Data Security & Privacy**
- **Secure Access**: Role-based access control for sensitive daily statistics
- **Privacy Protection**: GDPR and POPIA compliant handling of personal time data
- **Audit Trail**: Complete audit trail of all daily statistics access and modifications
- **Data Retention**: Configurable data retention policies for daily statistics
- **Confidentiality**: Ensure confidentiality of individual performance data
		`,
	})
	@ApiParam({
		name: 'uid',
		description:
			'User ID to retrieve daily statistics for. Supports both numeric user IDs and flexible user identification.',
		type: 'number',
		example: 45,
		examples: {
			employeeStats: {
				summary: '👤 Employee Statistics',
				description: 'Get daily statistics for regular employee',
				value: 45,
			},
			managerStats: {
				summary: '👨‍💼 Manager Statistics',
				description: 'Get daily statistics for manager role',
				value: 123,
			},
			teamLeadStats: {
				summary: '👥 Team Lead Statistics',
				description: 'Get daily statistics for team lead',
				value: 78,
			},
			seniorStaffStats: {
				summary: '⭐ Senior Staff Statistics',
				description: 'Get daily statistics for senior staff member',
				value: 156,
			},
		},
	})
	@ApiQuery({
		name: 'date',
		required: false,
		description:
			'Date in YYYY-MM-DD format (defaults to today). Supports both current and historical dates for trend analysis.',
		type: 'string',
		example: '2024-03-01',
		examples: {
			today: {
				summary: "📅 Today's Statistics",
				description: 'Get statistics for today (default)',
				value: '2024-03-01',
			},
			yesterday: {
				summary: "📅 Yesterday's Statistics",
				description: 'Get statistics for yesterday',
				value: '2024-02-29',
			},
			weekStart: {
				summary: '📅 Week Start',
				description: 'Get statistics for the start of the week',
				value: '2024-02-26',
			},
			monthStart: {
				summary: '📅 Month Start',
				description: 'Get statistics for the first day of the month',
				value: '2024-03-01',
			},
		},
	})
	@ApiOkResponse({
		description: '✅ Daily attendance statistics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				dailyWorkTime: {
					type: 'number',
					example: 28800000,
					description: 'Total work time for the day in milliseconds (excluding breaks)',
				},
				dailyBreakTime: {
					type: 'number',
					example: 3600000,
					description: 'Total break time for the day in milliseconds',
				},
				detailedStatistics: {
					type: 'object',
					description: 'Comprehensive daily statistics and analytics',
					properties: {
						totalActiveTime: {
							type: 'number',
							example: 32400000,
							description: 'Total active time including breaks (ms)',
						},
						effectiveWorkTime: {
							type: 'number',
							example: 28800000,
							description: 'Effective work time excluding all breaks (ms)',
						},
						overtimeMinutes: { type: 'number', example: 30, description: 'Overtime minutes worked' },
						productiveHours: {
							type: 'number',
							example: 7.5,
							description: 'Productive hours based on activity metrics',
						},
						idleTime: { type: 'number', example: 900000, description: 'Total idle time in milliseconds' },
						checkInTime: {
							type: 'string',
							format: 'time',
							example: '08:30:00',
							description: 'Check-in time for the day',
						},
						checkOutTime: {
							type: 'string',
							format: 'time',
							example: '17:30:00',
							nullable: true,
							description: 'Check-out time for the day',
						},
						totalShiftDuration: {
							type: 'string',
							example: '9h 0m',
							description: 'Total shift duration including breaks',
						},
						netWorkDuration: {
							type: 'string',
							example: '8h 0m',
							description: 'Net work duration excluding breaks',
						},
					},
				},
				breakAnalysis: {
					type: 'object',
					description: 'Detailed break time analysis and patterns',
					properties: {
						totalBreaks: { type: 'number', example: 3, description: 'Number of breaks taken' },
						averageBreakDuration: {
							type: 'number',
							example: 1200000,
							description: 'Average break duration in milliseconds',
						},
						longestBreak: {
							type: 'number',
							example: 1800000,
							description: 'Longest break duration in milliseconds',
						},
						shortestBreak: {
							type: 'number',
							example: 600000,
							description: 'Shortest break duration in milliseconds',
						},
						lunchBreakDuration: {
							type: 'number',
							example: 1800000,
							description: 'Lunch break duration in milliseconds',
						},
						coffeeBreakTotal: {
							type: 'number',
							example: 1800000,
							description: 'Total coffee break time in milliseconds',
						},
						breakDistribution: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									startTime: { type: 'string', format: 'time', example: '10:15:00' },
									endTime: { type: 'string', format: 'time', example: '10:30:00' },
									duration: { type: 'number', example: 900000 },
									type: { type: 'string', example: 'COFFEE' },
								},
							},
							description: 'Detailed breakdown of all breaks taken',
						},
					},
				},
				productivityMetrics: {
					type: 'object',
					description: 'Productivity and performance metrics for the day',
					properties: {
						productivityScore: {
							type: 'number',
							example: 87.5,
							description: 'Overall productivity score (0-100)',
						},
						efficiencyRating: {
							type: 'number',
							example: 92.3,
							description: 'Work efficiency rating based on output',
						},
						focusTime: {
							type: 'number',
							example: 25200000,
							description: 'Time spent in focused work (ms)',
						},
						interruptionCount: { type: 'number', example: 8, description: 'Number of work interruptions' },
						taskCompletionRate: {
							type: 'number',
							example: 85.7,
							description: 'Percentage of planned tasks completed',
						},
						goalAchievement: {
							type: 'number',
							example: 95.2,
							description: 'Percentage of daily goals achieved',
						},
						qualityScore: {
							type: 'number',
							example: 88.9,
							description: 'Work quality score based on output',
						},
						collaborationTime: {
							type: 'number',
							example: 7200000,
							description: 'Time spent in collaborative activities (ms)',
						},
					},
				},
				comparativeAnalysis: {
					type: 'object',
					description: 'Comparative analysis with historical and team data',
					properties: {
						vsYesterday: {
							type: 'object',
							properties: {
								workTimeChange: {
									type: 'number',
									example: 5.2,
									description: 'Percentage change in work time',
								},
								productivityChange: {
									type: 'number',
									example: -2.1,
									description: 'Percentage change in productivity',
								},
								breakTimeChange: {
									type: 'number',
									example: 15.8,
									description: 'Percentage change in break time',
								},
							},
						},
						vsWeekAverage: {
							type: 'object',
							properties: {
								workTimeVariance: {
									type: 'number',
									example: -3.5,
									description: 'Variance from weekly average work time',
								},
								productivityVariance: {
									type: 'number',
									example: 8.2,
									description: 'Variance from weekly average productivity',
								},
								efficiencyRank: {
									type: 'number',
									example: 2,
									description: 'Rank within the week (1-7)',
								},
							},
						},
						vsTeamAverage: {
							type: 'object',
							properties: {
								performanceRank: {
									type: 'number',
									example: 3,
									description: 'Rank within team performance',
								},
								teamSize: { type: 'number', example: 12, description: 'Size of comparison team' },
								percentile: {
									type: 'number',
									example: 75.8,
									description: 'Performance percentile within team',
								},
							},
						},
					},
				},
				wellness: {
					type: 'object',
					description: 'Employee wellness and work-life balance indicators',
					properties: {
						workLifeBalance: {
							type: 'number',
							example: 82.4,
							description: 'Work-life balance score (0-100)',
						},
						stressLevel: {
							type: 'string',
							example: 'LOW',
							enum: ['LOW', 'MODERATE', 'HIGH'],
							description: 'Estimated stress level',
						},
						burnoutRisk: { type: 'number', example: 15.2, description: 'Burnout risk percentage' },
						wellnessScore: { type: 'number', example: 88.7, description: 'Overall wellness score' },
						recommendedBreaks: {
							type: 'number',
							example: 1,
							description: 'Number of additional breaks recommended',
						},
						hydrationReminders: {
							type: 'number',
							example: 3,
							description: 'Number of hydration reminders sent',
						},
					},
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2024-03-01T18:00:00Z',
					description: 'Statistics generation timestamp',
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ User not found or no attendance data for the specified date',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No attendance data found for user ID 45 on 2024-03-01' },
				dailyWorkTime: { type: 'number', example: 0 },
				dailyBreakTime: { type: 'number', example: 0 },
				detailedStatistics: { type: 'null' },
				breakAnalysis: { type: 'null' },
				productivityMetrics: { type: 'null' },
				comparativeAnalysis: { type: 'null' },
				wellness: { type: 'null' },
				errorDetails: {
					type: 'object',
					properties: {
						errorType: {
							type: 'string',
							example: 'NO_DATA_FOUND',
							enum: ['NO_DATA_FOUND', 'USER_NOT_FOUND', 'FUTURE_DATE', 'INVALID_DATE'],
						},
						userId: { type: 'number', example: 45 },
						date: { type: 'string', example: '2024-03-01' },
						possibleReasons: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'User did not work on this date',
								'Date is a weekend or holiday',
								'User was on leave or vacation',
								'System was not operational on this date',
								'Data has not been processed yet',
							],
						},
					},
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Check if the user worked on this date',
						'Verify the date is not a weekend or holiday',
						'Try a different date when the user was active',
						'Check if the user has any attendance records',
						'Contact system administrator if data should exist',
					],
				},
				alternativeDates: {
					type: 'array',
					items: { type: 'string' },
					example: ['2024-02-29', '2024-03-02', '2024-03-03'],
					description: 'Recent dates with available data for this user',
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-01T18:00:00Z' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid date format or user ID',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid date format. Please use YYYY-MM-DD format' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				dailyWorkTime: { type: 'number', example: 0 },
				dailyBreakTime: { type: 'number', example: 0 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Date must be in YYYY-MM-DD format',
						'User ID must be a positive integer',
						'Date cannot be in the future',
						'Date must be a valid calendar date',
					],
				},
				supportedFormats: {
					type: 'object',
					properties: {
						dateFormats: {
							type: 'array',
							items: { type: 'string' },
							example: ['YYYY-MM-DD', '2024-03-01', '2024-12-31'],
						},
						userIdFormat: { type: 'string', example: 'Positive integer (e.g., 45, 123, 789)' },
						examples: {
							type: 'object',
							properties: {
								validDate: { type: 'string', example: '2024-03-01' },
								validUserId: { type: 'number', example: 45 },
							},
						},
					},
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-01T18:00:00Z' },
			},
		},
	})
	getDailyStats(@Param('uid') uid: number, @Query('date') date: string) {
		return this.attendanceService.getDailyStats(uid, date);
	}

	// ======================================================
	// ATTENDANCE METRICS ENDPOINTS
	// ======================================================

	@Get('metrics/:uid')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
		AccessLevel.HR,
	)
	@ApiOperation({
		summary: '📈 Get comprehensive user attendance metrics',
		description: `
# Comprehensive User Attendance Analytics

Retrieves detailed attendance analytics for a specific user including historical data, productivity insights, break patterns, timing analysis, and performance metrics across different time periods.

## 📊 **Advanced Analytics Suite**
- **Historical Analysis**: Complete historical attendance patterns and trends over time
- **Productivity Insights**: Deep dive into productivity patterns and performance correlations
- **Break Pattern Analysis**: Comprehensive break behavior analysis and optimization recommendations
- **Timing Analysis**: Detailed timing patterns including punctuality and consistency metrics
- **Performance Metrics**: Multi-dimensional performance analysis across various time periods

## 🔍 **Deep Dive Metrics**
- **Attendance Patterns**: Long-term attendance trends, seasonal variations, and pattern recognition
- **Work-Life Balance**: Analysis of work hours distribution and work-life balance indicators
- **Efficiency Tracking**: Work efficiency measurements and productivity optimization insights
- **Compliance Analysis**: Adherence to company policies and labor law requirements
- **Goal Achievement**: Progress tracking against individual and team objectives

## 📈 **Multi-Period Analysis**
- **All-Time Metrics**: Complete historical performance since employee onboarding
- **Monthly Analysis**: Current month performance with trend analysis
- **Weekly Insights**: Current week performance and productivity patterns
- **Daily Tracking**: Today's performance in context of historical patterns
- **Comparative Benchmarking**: Performance comparison against team and organizational averages

## 🎯 **Performance Intelligence**
- **Productivity Scoring**: Advanced productivity algorithms considering multiple factors
- **Efficiency Optimization**: Identify optimal work patterns and improvement opportunities
- **Risk Assessment**: Early warning systems for attendance and performance issues
- **Predictive Analytics**: Forecast future performance based on current trends
- **Personalized Insights**: Customized recommendations for individual performance improvement

## 🔄 **Real-Time Integration**
- **Live Updates**: Real-time metric updates as new attendance data becomes available
- **Dynamic Calculations**: Automatic recalculation of metrics with each new data point
- **Instant Feedback**: Immediate performance feedback and coaching opportunities
- **Alert Systems**: Proactive alerts for performance anomalies or improvement opportunities
- **Dashboard Integration**: Seamless integration with performance management dashboards

## 🎯 **Use Cases**
- **Performance Reviews**: Comprehensive data for annual and quarterly performance evaluations
- **Career Development**: Track progress and identify development opportunities
- **Team Management**: Monitor individual contributions to team success
- **HR Analytics**: Data-driven insights for HR planning and employee development
- **Compliance Reporting**: Detailed reports for regulatory compliance and auditing
- **Coaching & Development**: Personalized coaching based on detailed performance analytics

## 📱 **Management Tools**
- **Executive Dashboards**: High-level performance summaries for senior management
- **Manager Views**: Detailed views for direct managers and team leads
- **Self-Service Analytics**: Employee access to personal performance metrics
- **Mobile Insights**: Mobile-optimized performance tracking and insights
- **Custom Reports**: Flexible reporting capabilities for various stakeholders

## 🔒 **Privacy & Compliance**
- **Data Protection**: GDPR and POPIA compliant handling of sensitive performance data
- **Access Control**: Role-based access ensuring appropriate data visibility
- **Audit Trail**: Complete logging of metric access and usage
- **Consent Management**: Employee consent tracking for performance data usage
- **Confidentiality**: Secure handling of individual performance insights
		`,
	})
	@ApiParam({
		name: 'uid',
		description:
			'User ID to retrieve comprehensive attendance metrics for. Returns detailed analytics across multiple time periods and performance dimensions.',
		type: 'number',
		example: 45,
		examples: {
			regularEmployee: {
				summary: '👤 Regular Employee',
				description: 'Get comprehensive metrics for regular employee',
				value: 45,
			},
			seniorManager: {
				summary: '👨‍💼 Senior Manager',
				description: 'Get comprehensive metrics for senior manager',
				value: 123,
			},
			newHire: {
				summary: '🆕 New Hire',
				description: 'Get comprehensive metrics for recently hired employee',
				value: 789,
			},
			topPerformer: {
				summary: '⭐ Top Performer',
				description: 'Get comprehensive metrics for high-performing employee',
				value: 156,
			},
		},
	})
	@ApiOkResponse({
		description: '✅ Attendance metrics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				metrics: {
					type: 'object',
					description: 'Comprehensive attendance metrics and analytics',
					properties: {
						firstAttendance: {
							type: 'object',
							description: "Information about the user's first recorded attendance",
							properties: {
								date: { type: 'string', format: 'date', example: '2024-01-15', nullable: true },
								checkInTime: { type: 'string', example: '08:30:00', nullable: true },
								daysAgo: { type: 'number', example: 45, nullable: true },
							},
						},
						lastAttendance: {
							type: 'object',
							description: "Information about the user's most recent attendance",
							properties: {
								date: { type: 'string', format: 'date', example: '2024-03-01', nullable: true },
								checkInTime: { type: 'string', example: '09:00:00', nullable: true },
								checkOutTime: { type: 'string', example: '17:30:00', nullable: true },
								daysAgo: { type: 'number', example: 1, nullable: true },
							},
						},
						totalHours: {
							type: 'object',
							description: 'Total working hours across different time periods',
							properties: {
								allTime: {
									type: 'number',
									example: 320.5,
									description: 'Total hours worked since first attendance',
								},
								thisMonth: {
									type: 'number',
									example: 160.0,
									description: 'Hours worked in current month',
								},
								thisWeek: {
									type: 'number',
									example: 40.0,
									description: 'Hours worked in current week',
								},
								today: { type: 'number', example: 8.0, description: 'Hours worked today' },
							},
						},
						totalShifts: {
							type: 'object',
							description: 'Total number of shifts worked across different time periods',
							properties: {
								allTime: {
									type: 'number',
									example: 45,
									description: 'Total shifts since first attendance',
								},
								thisMonth: {
									type: 'number',
									example: 20,
									description: 'Shifts worked in current month',
								},
								thisWeek: { type: 'number', example: 5, description: 'Shifts worked in current week' },
								today: { type: 'number', example: 1, description: 'Shifts worked today' },
							},
						},
						averageHoursPerDay: {
							type: 'number',
							example: 7.1,
							description: 'Average hours worked per day since first attendance',
						},
						attendanceStreak: {
							type: 'number',
							example: 5,
							description: 'Number of consecutive days with attendance records',
						},
						breakAnalytics: {
							type: 'object',
							description: 'Comprehensive break time analysis and patterns',
							properties: {
								totalBreakTime: {
									type: 'object',
									description: 'Total break time across different periods (in minutes)',
									properties: {
										allTime: {
											type: 'number',
											example: 450,
											description: 'Total break minutes since first attendance',
										},
										thisMonth: {
											type: 'number',
											example: 240,
											description: 'Break minutes in current month',
										},
										thisWeek: {
											type: 'number',
											example: 75,
											description: 'Break minutes in current week',
										},
										today: { type: 'number', example: 30, description: 'Break minutes today' },
									},
								},
								averageBreakDuration: {
									type: 'number',
									example: 22,
									description: 'Average break duration per shift in minutes',
								},
								breakFrequency: {
									type: 'number',
									example: 1.8,
									description: 'Average number of breaks per shift',
								},
								longestBreak: {
									type: 'number',
									example: 45,
									description: 'Longest single break duration in minutes',
								},
								shortestBreak: {
									type: 'number',
									example: 5,
									description: 'Shortest single break duration in minutes',
								},
							},
						},
						timingPatterns: {
							type: 'object',
							description: 'Analysis of check-in/check-out timing patterns',
							properties: {
								averageCheckInTime: {
									type: 'string',
									example: '08:52:00',
									description: 'Average check-in time across all shifts',
								},
								averageCheckOutTime: {
									type: 'string',
									example: '17:23:00',
									description: 'Average check-out time across completed shifts',
								},
								punctualityScore: {
									type: 'number',
									example: 85,
									description: 'Percentage of on-time arrivals (before 9:15 AM)',
								},
								overtimeFrequency: {
									type: 'number',
									example: 30,
									description: 'Percentage of shifts with overtime (>8 hours)',
								},
							},
						},
						productivityInsights: {
							type: 'object',
							description: 'Productivity and performance analysis',
							properties: {
								workEfficiencyScore: {
									type: 'number',
									example: 88,
									description:
										'Work efficiency percentage (work time vs total time including breaks)',
								},
								shiftCompletionRate: {
									type: 'number',
									example: 95,
									description: 'Percentage of shifts that were properly checked out',
								},
								lateArrivalsCount: {
									type: 'number',
									example: 3,
									description: 'Number of late arrivals (after 9:15 AM)',
								},
								earlyDeparturesCount: {
									type: 'number',
									example: 1,
									description: 'Number of early departures (before 5:00 PM)',
								},
							},
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'User not found or no attendance data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No attendance data found for user' },
			},
		},
	})
	getUserAttendanceMetrics(@Param('uid') uid: number) {
		return this.attendanceService.getUserAttendanceMetrics(uid);
	}

	@Get('report')
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(300) // Cache for 5 minutes
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.HR)
	@ApiOperation({
		summary: '📊 Generate comprehensive organization attendance report',
		description: `
# Organization-Wide Attendance Analytics & Reporting

Generates comprehensive attendance reports with advanced analytics, multi-dimensional insights, and detailed breakdowns for strategic decision-making and compliance reporting.

## 📈 **Enterprise-Level Analytics**
- **Organization-Wide Metrics**: Complete attendance overview across all branches and departments
- **Executive Dashboards**: High-level performance indicators for senior management
- **Trend Analysis**: Historical attendance patterns and forecasting insights
- **Comparative Analytics**: Performance comparison across branches, roles, and time periods
- **Strategic Planning**: Data-driven insights for workforce planning and optimization

## 🏢 **Multi-Dimensional Reporting**
- **Branch-Level Analysis**: Detailed performance metrics for each branch location
- **Role-Based Insights**: Attendance patterns segmented by employee roles and responsibilities
- **Department Analytics**: Team performance analysis and cross-functional insights
- **Time Period Comparisons**: Month-over-month, quarter-over-quarter, and year-over-year analysis
- **Custom Segmentation**: Flexible filtering for specific employee groups or criteria

## 📊 **Advanced Report Features**
- **Real-Time Data**: Live attendance data with automatic updates and refresh capabilities
- **Predictive Analytics**: Forecasting models for attendance trends and potential issues
- **Anomaly Detection**: Automated identification of unusual patterns or outliers
- **Correlation Analysis**: Relationship analysis between different attendance metrics
- **Performance Benchmarking**: Industry standards comparison and best practice identification

## 🎯 **Strategic Use Cases**
- **Executive Reporting**: Monthly and quarterly attendance reports for senior leadership
- **HR Analytics**: Workforce planning, policy evaluation, and employee engagement analysis
- **Compliance Audits**: Regulatory compliance reporting and documentation
- **Budget Planning**: Resource allocation and cost analysis based on attendance patterns
- **Performance Management**: Team productivity assessment and improvement identification

## 📋 **Comprehensive Data Points**
- **Individual Metrics**: Detailed employee-level attendance statistics and performance indicators
- **Team Analytics**: Group performance metrics and collaborative insights
- **Operational Metrics**: Check-in/check-out patterns, overtime analysis, and break utilization
- **Productivity Indicators**: Work efficiency measurements and optimization opportunities
- **Compliance Tracking**: Policy adherence and regulatory requirement fulfillment

## 🔄 **Dynamic Filtering & Customization**
- **Flexible Date Ranges**: Custom reporting periods from daily to annual timeframes
- **Multi-Branch Support**: Cross-branch analysis and individual branch deep-dives
- **Role-Based Views**: Customized reports based on employee access levels and responsibilities
- **Export Capabilities**: Multiple format support for further analysis and distribution
- **Automated Scheduling**: Recurring report generation and distribution

## 🎨 **Report Visualization**
- **Interactive Charts**: Dynamic graphs and visual representations of attendance data
- **Heat Maps**: Geographic and temporal attendance pattern visualization
- **Trend Lines**: Historical performance tracking and future projection displays
- **Comparative Charts**: Side-by-side analysis of different time periods or groups
- **Dashboard Integration**: Seamless integration with existing business intelligence tools

## 🔒 **Security & Compliance**
- **Data Privacy**: GDPR and POPIA compliant handling of employee attendance data
- **Access Control**: Role-based access ensuring appropriate data visibility and privacy
- **Audit Trail**: Complete logging of report generation and access activities
- **Secure Distribution**: Encrypted report delivery and secure sharing capabilities
- **Retention Policies**: Automated data retention and archival according to compliance requirements
		`,
	})
	@ApiQuery({
		name: 'dateFrom',
		required: false,
		description:
			'Start date for report period (YYYY-MM-DD format). Defaults to beginning of current month if not specified.',
		example: '2024-01-01',
		examples: {
			currentMonth: {
				summary: '📅 Current Month',
				description: 'Generate report for current month',
				value: '2024-03-01',
			},
			lastQuarter: {
				summary: '📈 Last Quarter',
				description: 'Generate report for previous quarter',
				value: '2024-01-01',
			},
			yearToDate: {
				summary: '📊 Year to Date',
				description: 'Generate report from beginning of year',
				value: '2024-01-01',
			},
		},
	})
	@ApiQuery({
		name: 'dateTo',
		required: false,
		description: 'End date for report period (YYYY-MM-DD format). Defaults to current date if not specified.',
		example: '2024-03-31',
		examples: {
			currentDate: {
				summary: '🗓️ Current Date',
				description: 'Generate report up to current date',
				value: '2024-03-31',
			},
			monthEnd: {
				summary: '📅 Month End',
				description: 'Generate report up to end of month',
				value: '2024-03-31',
			},
			quarterEnd: {
				summary: '📈 Quarter End',
				description: 'Generate report up to end of quarter',
				value: '2024-03-31',
			},
		},
	})
	@ApiQuery({
		name: 'branchId',
		required: false,
		description: 'Filter report by specific branch ID. Omit to include all branches in organization.',
		example: '12',
		examples: {
			mainBranch: {
				summary: '🏢 Main Branch',
				description: 'Generate report for main branch only',
				value: '1',
			},
			salesBranch: {
				summary: '💼 Sales Branch',
				description: 'Generate report for sales branch only',
				value: '5',
			},
			techBranch: {
				summary: '💻 Tech Branch',
				description: 'Generate report for technology branch only',
				value: '8',
			},
		},
	})
	@ApiQuery({
		name: 'role',
		required: false,
		enum: AccessLevel,
		description: 'Filter report by specific role/access level. Omit to include all roles.',
		example: 'USER',
		examples: {
			managers: {
				summary: '👨‍💼 Managers Only',
				description: 'Generate report for managers only',
				value: 'MANAGER',
			},
			regularUsers: {
				summary: '👤 Regular Users',
				description: 'Generate report for regular users only',
				value: 'USER',
			},
			technicians: {
				summary: '🔧 Technicians',
				description: 'Generate report for technicians only',
				value: 'TECHNICIAN',
			},
		},
	})
	@ApiQuery({
		name: 'includeUserDetails',
		required: false,
		type: 'boolean',
		description:
			'Include individual user breakdowns and detailed metrics in the report. Set to false for summary-only reports.',
		example: true,
		examples: {
			detailedReport: {
				summary: '📋 Detailed Report',
				description: 'Include individual user breakdowns and detailed metrics',
				value: true,
			},
			summaryOnly: {
				summary: '📊 Summary Only',
				description: 'Generate organization-level summary without individual details',
				value: false,
			},
		},
	})
	@ApiOkResponse({
		description: '✅ Organization attendance report generated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				report: {
					type: 'object',
					description: 'Comprehensive organization attendance report with analytics',
					properties: {
						reportPeriod: {
							type: 'object',
							description: 'Report period information and metadata',
							properties: {
								from: { type: 'string', example: '2024-01-01', description: 'Report start date' },
								to: { type: 'string', example: '2024-03-31', description: 'Report end date' },
								totalDays: { type: 'number', example: 90, description: 'Total days in report period' },
								workingDays: {
									type: 'number',
									example: 65,
									description: 'Working days in report period',
								},
								generatedAt: {
									type: 'string',
									example: '2024-04-01T10:30:00Z',
									description: 'Report generation timestamp',
								},
								reportType: {
									type: 'string',
									example: 'COMPREHENSIVE',
									description: 'Type of report generated',
								},
								filters: {
									type: 'object',
									description: 'Applied filters for report generation',
									properties: {
										branchId: { type: 'string', example: '12', nullable: true },
										role: { type: 'string', example: 'USER', nullable: true },
										includeUserDetails: { type: 'boolean', example: true },
									},
								},
							},
						},
						userMetrics: {
							type: 'array',
							description: 'Individual user metrics and performance data',
							items: {
								type: 'object',
								properties: {
									userId: { type: 'number', example: 45, description: 'User identification number' },
									userInfo: {
										type: 'object',
										description: 'Basic user information',
										properties: {
											name: { type: 'string', example: 'John Doe', description: 'Full name' },
											email: {
												type: 'string',
												example: 'john.doe@company.com',
												description: 'Email address',
											},
											role: { type: 'string', example: 'USER', description: 'User role' },
											branch: {
												type: 'string',
												example: 'Main Branch',
												description: 'Branch name',
											},
											department: {
												type: 'string',
												example: 'Engineering',
												description: 'Department name',
											},
											employeeId: {
												type: 'string',
												example: 'EMP001',
												description: 'Employee ID',
											},
										},
									},
									metrics: {
										type: 'object',
										description: 'Detailed attendance metrics',
										properties: {
											totalHours: {
												type: 'object',
												description: 'Total hours worked across different periods',
												properties: {
													reportPeriod: {
														type: 'number',
														example: 320.5,
														description: 'Total hours in report period',
													},
													thisMonth: {
														type: 'number',
														example: 160.0,
														description: 'Hours worked this month',
													},
													thisWeek: {
														type: 'number',
														example: 40.0,
														description: 'Hours worked this week',
													},
													dailyAverage: {
														type: 'number',
														example: 8.0,
														description: 'Average hours per day',
													},
												},
											},
											totalShifts: {
												type: 'object',
												description: 'Total shifts worked across different periods',
												properties: {
													reportPeriod: {
														type: 'number',
														example: 45,
														description: 'Total shifts in report period',
													},
													thisMonth: {
														type: 'number',
														example: 20,
														description: 'Shifts worked this month',
													},
													thisWeek: {
														type: 'number',
														example: 5,
														description: 'Shifts worked this week',
													},
													completed: {
														type: 'number',
														example: 42,
														description: 'Completed shifts',
													},
													incomplete: {
														type: 'number',
														example: 3,
														description: 'Incomplete shifts',
													},
												},
											},
											attendanceRate: {
												type: 'number',
												example: 96.5,
												description: 'Attendance rate percentage',
											},
											punctualityRate: {
												type: 'number',
												example: 88.2,
												description: 'Punctuality rate percentage',
											},
											averageHoursPerDay: {
												type: 'number',
												example: 7.8,
												description: 'Average hours per working day',
											},
											attendanceStreak: {
												type: 'number',
												example: 12,
												description: 'Consecutive days with attendance',
											},
											overtimeHours: {
												type: 'number',
												example: 25.5,
												description: 'Total overtime hours',
											},
											breakTimeTotal: {
												type: 'number',
												example: 180,
												description: 'Total break time in minutes',
											},
										},
									},
									performance: {
										type: 'object',
										description: 'Performance indicators and insights',
										properties: {
											efficiency: {
												type: 'number',
												example: 87.5,
												description: 'Work efficiency percentage',
											},
											consistency: {
												type: 'number',
												example: 92.0,
												description: 'Consistency score',
											},
											trend: {
												type: 'string',
												example: 'IMPROVING',
												description: 'Performance trend',
											},
											ranking: {
												type: 'number',
												example: 8,
												description: 'Performance ranking within organization',
											},
										},
									},
								},
							},
						},
						organizationMetrics: {
							type: 'object',
							description: 'Organization-level aggregated metrics',
							properties: {
								summary: {
									type: 'object',
									description: 'High-level organizational summary',
									properties: {
										totalEmployees: {
											type: 'number',
											example: 125,
											description: 'Total employees in organization',
										},
										activeEmployees: {
											type: 'number',
											example: 118,
											description: 'Active employees during period',
										},
										totalHours: {
											type: 'number',
											example: 15750.5,
											description: 'Total hours worked',
										},
										totalShifts: {
											type: 'number',
											example: 2250,
											description: 'Total shifts completed',
										},
										overtimeHours: {
											type: 'number',
											example: 890.2,
											description: 'Total overtime hours',
										},
										averageHoursPerEmployee: {
											type: 'number',
											example: 133.3,
											description: 'Average hours per employee',
										},
									},
								},
								averageTimes: {
									type: 'object',
									description: 'Average timing patterns across organization',
									properties: {
										startTime: {
											type: 'string',
											example: '09:15:30',
											description: 'Average start time',
										},
										endTime: {
											type: 'string',
											example: '17:45:20',
											description: 'Average end time',
										},
										shiftDuration: {
											type: 'number',
											example: 8.5,
											description: 'Average shift duration in hours',
										},
										breakDuration: {
											type: 'number',
											example: 1.0,
											description: 'Average break duration in hours',
										},
										lunchDuration: {
											type: 'number',
											example: 0.75,
											description: 'Average lunch duration in hours',
										},
									},
								},
								byBranch: {
									type: 'array',
									description: 'Branch-level performance breakdown',
									items: {
										type: 'object',
										properties: {
											branchId: {
												type: 'string',
												example: '12',
												description: 'Branch identifier',
											},
											branchName: {
												type: 'string',
												example: 'Main Branch',
												description: 'Branch name',
											},
											employeeCount: {
												type: 'number',
												example: 45,
												description: 'Number of employees',
											},
											totalHours: {
												type: 'number',
												example: 5680.5,
												description: 'Total branch hours',
											},
											averageHoursPerEmployee: {
												type: 'number',
												example: 126.2,
												description: 'Average hours per employee',
											},
											attendanceRate: {
												type: 'number',
												example: 94.8,
												description: 'Branch attendance rate',
											},
											punctualityRate: {
												type: 'number',
												example: 89.5,
												description: 'Branch punctuality rate',
											},
											performance: {
												type: 'string',
												example: 'ABOVE_AVERAGE',
												description: 'Branch performance rating',
											},
										},
									},
								},
								byRole: {
									type: 'array',
									description: 'Role-based performance breakdown',
									items: {
										type: 'object',
										properties: {
											role: { type: 'string', example: 'USER', description: 'Employee role' },
											employeeCount: {
												type: 'number',
												example: 85,
												description: 'Number of employees in role',
											},
											totalHours: {
												type: 'number',
												example: 10200.5,
												description: 'Total role hours',
											},
											averageHoursPerEmployee: {
												type: 'number',
												example: 120.0,
												description: 'Average hours per employee',
											},
											attendanceRate: {
												type: 'number',
												example: 95.2,
												description: 'Role attendance rate',
											},
											punctualityRate: {
												type: 'number',
												example: 87.8,
												description: 'Role punctuality rate',
											},
											overtimeFrequency: {
												type: 'number',
												example: 32.5,
												description: 'Overtime frequency percentage',
											},
										},
									},
								},
								insights: {
									type: 'object',
									description: 'Advanced analytics and insights',
									properties: {
										attendanceRate: {
											type: 'number',
											example: 95.2,
											description: 'Overall attendance rate',
										},
										punctualityRate: {
											type: 'number',
											example: 88.7,
											description: 'Overall punctuality rate',
										},
										averageHoursPerDay: {
											type: 'number',
											example: 7.9,
											description: 'Average hours per day',
										},
										peakCheckInTime: {
											type: 'string',
											example: '08:45:00',
											description: 'Most common check-in time',
										},
										peakCheckOutTime: {
											type: 'string',
											example: '17:30:00',
											description: 'Most common check-out time',
										},
										productivityScore: {
											type: 'number',
											example: 89.3,
											description: 'Overall productivity score',
										},
										efficiencyTrend: {
											type: 'string',
											example: 'STABLE',
											description: 'Efficiency trend analysis',
										},
										recommendations: {
											type: 'array',
											description: 'AI-generated recommendations for improvement',
											items: { type: 'string' },
											example: [
												'Consider flexible start times to improve punctuality',
												'Implement break time optimization for better efficiency',
												'Focus on specific branch performance improvements',
											],
										},
									},
								},
								compliance: {
									type: 'object',
									description: 'Compliance and regulatory metrics',
									properties: {
										laborLawCompliance: {
											type: 'number',
											example: 98.5,
											description: 'Labor law compliance percentage',
										},
										breakPolicyAdherence: {
											type: 'number',
											example: 94.2,
											description: 'Break policy adherence percentage',
										},
										overtimeCompliance: {
											type: 'number',
											example: 96.8,
											description: 'Overtime policy compliance percentage',
										},
										documentationCompleteness: {
											type: 'number',
											example: 99.1,
											description: 'Documentation completeness percentage',
										},
									},
								},
							},
						},
					},
				},
				analytics: {
					type: 'object',
					description: 'Advanced analytics and performance insights',
					properties: {
						generationTime: {
							type: 'number',
							example: 1.25,
							description: 'Report generation time in seconds',
						},
						dataPoints: { type: 'number', example: 15680, description: 'Number of data points analyzed' },
						cacheStatus: { type: 'string', example: 'GENERATED', description: 'Cache status for report' },
						nextRefresh: {
							type: 'string',
							example: '2024-04-01T10:35:00Z',
							description: 'Next scheduled refresh time',
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid query parameters or data errors',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid date format or query parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Invalid date format: dateFrom must be YYYY-MM-DD',
						'End date must be after start date',
						'Branch ID must be a valid number',
						'Role must be a valid AccessLevel enum value',
					],
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Use YYYY-MM-DD format for date parameters',
						'Ensure end date is after start date',
						'Verify branch ID exists in organization',
						'Check available roles for your access level',
					],
				},
			},
		},
	})
	@ApiUnauthorizedResponse({
		description: '🔒 Unauthorized - Insufficient permissions for report generation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Insufficient permissions to generate organization reports' },
				error: { type: 'string', example: 'Unauthorized' },
				statusCode: { type: 'number', example: 401 },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER', 'HR'],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '⛔ Forbidden - Access denied to specific report data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Access denied to requested branch or role data' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				accessibleBranches: {
					type: 'array',
					items: { type: 'string' },
					example: ['Main Branch', 'Sales Branch'],
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Not Found - No data available for specified criteria',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No attendance data found for specified criteria' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				availableRanges: {
					type: 'object',
					properties: {
						earliestDate: { type: 'string', example: '2024-01-01' },
						latestDate: { type: 'string', example: '2024-03-31' },
						availableBranches: {
							type: 'array',
							items: { type: 'string' },
							example: ['Main Branch', 'Sales Branch', 'Tech Branch'],
						},
					},
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Report generation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Report generation failed due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				retryable: { type: 'boolean', example: true },
				estimatedRetryTime: { type: 'string', example: '2024-04-01T10:35:00Z' },
			},
		},
	})
	getOrganizationReport(@Query() queryDto: OrganizationReportQueryDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;

		return this.attendanceService.generateOrganizationReport(queryDto, orgId, branchId);
	}

	@Post('reports/morning/send')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.HR)
	@ApiOperation({
		summary: '🌅 Send automated morning attendance report',
		description: `
# Morning Attendance Report Automation

Triggers the generation and distribution of comprehensive morning attendance reports to designated stakeholders, providing real-time insights into daily attendance patterns and operational readiness.

## 🕐 **Morning Report Features**
- **Real-Time Attendance Overview**: Current attendance status for all employees across the organization
- **Check-In Analytics**: Detailed analysis of morning check-in patterns and punctuality metrics
- **Operational Readiness**: Assessment of organizational readiness for the day's operations
- **Absence Tracking**: Identification of absent employees and impact on daily operations
- **Punctuality Insights**: Analysis of on-time arrivals and late check-ins

## 📊 **Report Components**
- **Executive Summary**: High-level overview for senior management and decision-makers
- **Branch Breakdown**: Detailed attendance metrics for each branch location
- **Department Analytics**: Team-specific attendance patterns and performance indicators
- **Individual Alerts**: Specific notifications for attendance exceptions and anomalies
- **Trend Analysis**: Comparison with previous days and weekly patterns

## 🎯 **Automation Benefits**
- **Proactive Management**: Early identification of attendance issues before they impact operations
- **Resource Planning**: Real-time insights for daily resource allocation and scheduling
- **Compliance Monitoring**: Automated tracking of attendance policy adherence
- **Performance Tracking**: Daily performance metrics and productivity indicators
- **Communication Enhancement**: Automated stakeholder communication and updates

## 📧 **Distribution & Recipients**
- **Management Team**: Directors, managers, and team leaders receive comprehensive reports
- **HR Department**: Detailed HR analytics and compliance tracking information
- **Operations Team**: Operational readiness and resource availability insights
- **Executive Leadership**: Strategic overview and organizational performance metrics
- **Custom Recipients**: Configurable recipient lists based on organizational needs

## 🔄 **Automation Scheduling**
- **Daily Automation**: Automatically triggered every morning at configured times
- **Manual Trigger**: On-demand report generation for testing or ad-hoc analysis
- **Custom Timing**: Flexible scheduling to match organizational work patterns
- **Holiday Handling**: Intelligent scheduling that adapts to organizational calendar
- **Retry Logic**: Automatic retry mechanisms for failed report deliveries

## 📱 **Multi-Channel Delivery**
- **Email Distribution**: Professional email reports with charts and detailed analytics
- **Dashboard Updates**: Real-time updates to management dashboards and portals
- **Mobile Notifications**: Push notifications for critical attendance alerts
- **API Integration**: Data feeds for third-party systems and business intelligence tools
- **Slack/Teams Integration**: Automated posting to collaboration platforms

## 📈 **Advanced Analytics**
- **Predictive Insights**: Forecasting of daily productivity based on attendance patterns
- **Anomaly Detection**: Automated identification of unusual attendance patterns
- **Comparative Analysis**: Day-over-day and week-over-week attendance comparisons
- **Seasonal Trends**: Long-term pattern analysis and seasonal attendance variations
- **Performance Correlation**: Relationship analysis between attendance and productivity

## 🔒 **Security & Compliance**
- **Data Privacy**: Secure handling of employee attendance data in compliance with regulations
- **Access Control**: Role-based access ensuring appropriate information visibility
- **Audit Trail**: Complete logging of report generation and distribution activities
- **Encryption**: Secure transmission and storage of sensitive attendance information
- **Retention Policies**: Automated data retention and archival according to compliance requirements
		`,
	})
	@ApiCreatedResponse({
		description: '✅ Morning attendance report sent successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Morning attendance report sent successfully' },
				recipients: {
					type: 'number',
					example: 8,
					description: 'Total number of recipients who received the report',
				},
				reportId: {
					type: 'string',
					example: 'MORNING-2024-03-15-001',
					description: 'Unique report identifier',
				},
				generatedAt: { type: 'string', format: 'date-time', example: '2024-03-15T07:30:00Z' },
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-15T07:30:00Z' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Unable to send morning report due to data or configuration issues',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Unable to send morning report: insufficient attendance data' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				errorType: { type: 'string', example: 'INSUFFICIENT_DATA', description: 'Type of error encountered' },
				issues: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'No attendance data available for today',
						'Organization configuration incomplete',
						'Email service unavailable',
						'No recipients configured for morning reports',
					],
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify organization has active employees with attendance data',
						'Check email service configuration and status',
						'Ensure recipient list is properly configured',
						'Verify organization settings are complete',
					],
				},
			},
		},
	})
	@ApiUnauthorizedResponse({
		description: '🔒 Unauthorized - Insufficient permissions to send reports',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Insufficient permissions to send morning attendance reports' },
				error: { type: 'string', example: 'Unauthorized' },
				statusCode: { type: 'number', example: 401 },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'OWNER', 'HR'],
				},
				permissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['reports:send', 'attendance:view_organization', 'notifications:send'],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '⛔ Forbidden - Access denied to organization report features',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Access denied to organization-level reporting features' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				restrictions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Organization-level reporting requires elevated permissions',
						'Branch-level users cannot access organization reports',
						'Report distribution requires HR or Admin role',
					],
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Report generation or delivery failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Report generation failed due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				errorDetails: {
					type: 'object',
					description: 'Technical error information',
					properties: {
						component: {
							type: 'string',
							example: 'REPORT_GENERATOR',
							description: 'Component where error occurred',
						},
						stage: {
							type: 'string',
							example: 'EMAIL_DELIVERY',
							description: 'Stage of process where error occurred',
						},
						retryable: {
							type: 'boolean',
							example: true,
							description: 'Whether the operation can be retried',
						},
						estimatedRetryTime: {
							type: 'string',
							format: 'date-time',
							example: '2024-03-15T07:35:00Z',
							description: 'Estimated time for retry',
						},
					},
				},
				supportInfo: {
					type: 'object',
					description: 'Support and troubleshooting information',
					properties: {
						incidentId: {
							type: 'string',
							example: 'INC-2024-03-15-001',
							description: 'Support incident identifier',
						},
						supportContact: {
							type: 'string',
							example: 'support@company.com',
							description: 'Support contact information',
						},
						expectedResolution: {
							type: 'string',
							example: '30 minutes',
							description: 'Expected resolution time',
						},
					},
				},
			},
		},
	})
	async sendMorningReport(@Req() req: AuthenticatedRequest) {
		try {
			const orgId = req.user?.org?.uid || req.user?.organisationRef;

			if (!orgId) {
				return { message: 'Organization not found' };
			}

			await this.attendanceReportsService.generateAndSendMorningReport(orgId);
			return {
				message: 'Morning attendance report sent successfully',
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			return {
				message: `Error sending morning report: ${error.message}`,
				timestamp: new Date().toISOString(),
			};
		}
	}

	@Post('reports/evening/send')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.HR)
	@ApiOperation({
		summary: '🌆 Send automated evening attendance report',
		description: `
# Evening Attendance Report Automation

Triggers the generation and distribution of comprehensive evening attendance reports to stakeholders, providing end-of-day insights, productivity analysis, and completion metrics for operational planning and performance evaluation.

## 🕕 **Evening Report Features**
- **End-of-Day Summary**: Complete daily attendance overview with final check-out statistics
- **Productivity Analytics**: Comprehensive analysis of daily productivity and work efficiency
- **Completion Metrics**: Assessment of task completion rates and operational achievements
- **Overtime Analysis**: Detailed overtime tracking and policy compliance monitoring
- **Performance Insights**: Daily performance evaluation and trend identification

## 📊 **Report Components**
- **Daily Summary**: Complete overview of daily attendance and performance metrics
- **Branch Performance**: Individual branch productivity and efficiency comparisons
- **Employee Analytics**: Individual performance tracking and achievement recognition
- **Overtime Dashboard**: Detailed overtime analysis and compliance tracking
- **Next Day Planning**: Insights and recommendations for upcoming operational planning

## 🎯 **Evening Report Benefits**
- **Performance Evaluation**: Comprehensive daily performance assessment and feedback
- **Operational Closure**: Complete operational day closure with detailed analytics
- **Planning Insights**: Data-driven insights for next-day operational planning
- **Compliance Tracking**: End-of-day compliance verification and reporting
- **Resource Optimization**: Analysis for improved resource allocation and scheduling

## 📧 **Distribution & Recipients**
- **Management Team**: Comprehensive performance reports for managers and team leaders
- **HR Department**: Employee performance analytics and compliance tracking
- **Operations Team**: Operational efficiency metrics and improvement opportunities
- **Executive Leadership**: Strategic performance overview and organizational insights
- **Planning Teams**: Data for next-day operational planning and resource allocation

## 🔄 **Automation Scheduling**
- **Daily Automation**: Automatically triggered every evening after operational hours
- **Manual Trigger**: On-demand report generation for immediate analysis or testing
- **Flexible Timing**: Customizable scheduling to match organizational end-of-day patterns
- **Holiday Management**: Intelligent scheduling that adapts to organizational calendar
- **Retry Mechanisms**: Automated retry logic for failed report deliveries

## 📱 **Multi-Channel Delivery**
- **Email Reports**: Professional email summaries with detailed analytics and charts
- **Dashboard Updates**: Real-time updates to management dashboards and portals
- **Mobile Notifications**: Push notifications for critical performance alerts and achievements
- **API Integration**: Data feeds for third-party systems and business intelligence tools
- **Collaboration Platforms**: Automated posting to Slack, Teams, and other communication tools

## 📈 **Advanced Analytics**
- **Performance Trends**: Daily performance trend analysis and pattern recognition
- **Efficiency Metrics**: Work efficiency calculations and optimization recommendations
- **Comparative Analysis**: Day-over-day and historical performance comparisons
- **Predictive Insights**: Forecasting for next-day productivity and resource needs
- **Achievement Tracking**: Recognition of daily achievements and milestone completion

## 🔒 **Security & Compliance**
- **Data Protection**: Secure handling of employee performance data in compliance with regulations
- **Access Control**: Role-based access ensuring appropriate information visibility
- **Audit Trail**: Complete logging of report generation and distribution activities
- **Secure Transmission**: Encrypted delivery and storage of sensitive performance information
- **Retention Management**: Automated data retention and archival according to compliance requirements
		`,
	})
	@ApiCreatedResponse({
		description: '✅ Evening attendance report sent successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Evening attendance report sent successfully' },
				recipients: {
					type: 'number',
					example: 8,
					description: 'Total number of recipients who received the report',
				},
				reportId: {
					type: 'string',
					example: 'EVENING-2024-03-15-001',
					description: 'Unique report identifier',
				},
				generatedAt: {
					type: 'string',
					format: 'date-time',
					example: '2024-03-15T18:00:00Z',
					description: 'Report generation timestamp',
				},
				reportSummary: {
					type: 'object',
					description: 'End-of-day attendance summary',
					properties: {
						totalEmployees: { type: 'number', example: 125, description: 'Total employees tracked' },
						completedShifts: {
							type: 'number',
							example: 118,
							description: 'Employees who completed their shifts',
						},
						activeEmployees: { type: 'number', example: 3, description: 'Employees still active/working' },
						overtimeEmployees: { type: 'number', example: 15, description: 'Employees working overtime' },
						averageShiftDuration: {
							type: 'string',
							example: '8h 25m',
							description: 'Average shift duration',
						},
						totalProductiveHours: {
							type: 'number',
							example: 987.5,
							description: 'Total productive hours for the day',
						},
					},
				},
				deliveryChannels: {
					type: 'object',
					description: 'Report delivery channels used',
					properties: {
						email: { type: 'number', example: 8, description: 'Reports sent via email' },
						dashboard: { type: 'number', example: 3, description: 'Dashboards updated' },
						slack: { type: 'number', example: 2, description: 'Slack notifications sent' },
						mobile: { type: 'number', example: 5, description: 'Mobile notifications sent' },
					},
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-03-15T18:00:00Z' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Unable to send report',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Unable to send evening report: insufficient data' },
			},
		},
	})
	@ApiUnauthorizedResponse({
		description: '🔒 Unauthorized - Insufficient permissions to send reports',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Insufficient permissions to send evening attendance reports' },
				error: { type: 'string', example: 'Unauthorized' },
				statusCode: { type: 'number', example: 401 },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'OWNER', 'HR'],
				},
				permissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['reports:send', 'attendance:view_organization', 'notifications:send'],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '⛔ Forbidden - Access denied to organization report features',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Access denied to organization-level reporting features' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				restrictions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Organization-level reporting requires elevated permissions',
						'Branch-level users cannot access organization reports',
						'Report distribution requires HR or Admin role',
					],
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Report generation or delivery failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Report generation failed due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				errorDetails: {
					type: 'object',
					description: 'Technical error information',
					properties: {
						component: {
							type: 'string',
							example: 'REPORT_GENERATOR',
							description: 'Component where error occurred',
						},
						stage: {
							type: 'string',
							example: 'EMAIL_DELIVERY',
							description: 'Stage of process where error occurred',
						},
						retryable: {
							type: 'boolean',
							example: true,
							description: 'Whether the operation can be retried',
						},
						estimatedRetryTime: {
							type: 'string',
							format: 'date-time',
							example: '2024-03-15T07:35:00Z',
							description: 'Estimated time for retry',
						},
					},
				},
				supportInfo: {
					type: 'object',
					description: 'Support and troubleshooting information',
					properties: {
						incidentId: {
							type: 'string',
							example: 'INC-2024-03-15-001',
							description: 'Support incident identifier',
						},
						supportContact: {
							type: 'string',
							example: 'support@company.com',
							description: 'Support contact information',
						},
						expectedResolution: {
							type: 'string',
							example: '30 minutes',
							description: 'Expected resolution time',
						},
					},
				},
			},
		},
	})
	async sendEveningReport(@Req() req: AuthenticatedRequest) {
		try {
			const orgId = req.user?.org?.uid || req.user?.organisationRef;

			if (!orgId) {
				return { message: 'Organization not found' };
			}

			await this.attendanceReportsService.generateAndSendEveningReport(orgId);
			return {
				message: 'Evening attendance report sent successfully',
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			return {
				message: `Error sending evening report: ${error.message}`,
				timestamp: new Date().toISOString(),
			};
		}
	}

	@Post('reports/request')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.HR, AccessLevel.MANAGER)
	@ApiOperation({
		summary: '📊 Request attendance report for personal viewing',
		description: `
# Personal Attendance Report Request

Generates and sends a comprehensive attendance report of the specified type (morning or evening) directly to the requesting user. This provides on-demand access to attendance analytics and insights without affecting the automated report distribution system.

## 🎯 **Request Features**
- **On-Demand Generation**: Instant report generation based on current data
- **Personal Delivery**: Report sent only to the requesting user's email
- **Real-Time Data**: Uses the most current attendance and performance data
- **Full Report Content**: Identical data to automated reports with complete analytics
- **Custom Timing**: Available at any time, not restricted to scheduled report times

## 📊 **Report Types Available**
- **Morning Report**: Start-of-day attendance overview with punctuality analysis
- **Evening Report**: End-of-day comprehensive performance and completion metrics
- **Current Data**: Both reports use real-time data regardless of request time
- **Historical Context**: Includes yesterday comparisons and trend analysis
- **Branch Breakdown**: Detailed analytics by branch and department

## 🔄 **Use Cases**
- **Ad-Hoc Analysis**: Quick access to attendance insights for immediate decision-making
- **Presentation Preparation**: Generate reports for meetings and presentations
- **Performance Review**: Detailed data for employee performance evaluations
- **Operational Planning**: Current metrics for scheduling and resource allocation
- **Compliance Verification**: On-demand compliance checks and documentation

## 📧 **Delivery & Data**
- **Email Delivery**: Professional email report sent to requesting user only
- **Data Response**: Complete report data returned in API response for integration
- **Immediate Access**: No waiting for scheduled report times
- **Privacy Focused**: Report sent only to authenticated requesting user
- **Audit Trail**: Request logging for compliance and tracking purposes

## 🔒 **Security & Access**
- **Role-Based Access**: Limited to management and HR roles for data protection
- **Organization Scope**: Reports limited to user's organization data only
- **Secure Delivery**: Encrypted email transmission and secure API responses
- **Access Logging**: Complete audit trail of report requests and deliveries
- **Data Protection**: Full compliance with privacy and data protection regulations
		`,
	})
	@ApiBody({
		type: RequestReportDto,
		description: 'Request payload for generating attendance reports',
		examples: {
			morningReport: {
				summary: '🌅 Morning Report Request',
				description: 'Request morning attendance report with punctuality analysis',
				value: {
					reportType: 'morning',
				},
			},
			eveningReport: {
				summary: '🌆 Evening Report Request',
				description: 'Request evening attendance report with completion metrics',
				value: {
					reportType: 'evening',
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ Attendance report generated and sent successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Morning attendance report generated and sent successfully' },
				reportType: { type: 'string', example: 'morning', description: 'Type of report that was generated' },
				sentTo: {
					type: 'string',
					example: 'manager@company.com',
					description: 'Email address where report was sent',
				},
				generatedAt: {
					type: 'string',
					format: 'date-time',
					example: '2024-03-15T10:30:00Z',
					description: 'Report generation timestamp',
				},
				organizationId: { type: 'number', example: 123, description: 'Organization ID for the report' },
				reportData: {
					type: 'object',
					description: 'Complete report data (structure varies by report type)',
					properties: {
						organizationName: { type: 'string', example: 'ABC Corporation' },
						reportDate: { type: 'string', example: 'Friday, March 15th, 2024' },
						summary: {
							type: 'object',
							properties: {
								totalEmployees: { type: 'number', example: 125 },
								presentCount: { type: 'number', example: 118 },
								attendanceRate: { type: 'number', example: 94.4 },
								totalActualHours: { type: 'number', example: 987.5 },
							},
						},
						insights: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Excellent attendance: 118/125 team present (94.4%)',
								'Perfect punctuality: All present employees arrived on time',
							],
						},
						recommendations: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Continue current successful practices',
								'Recognize punctual team members for their reliability',
							],
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid report request',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid report type specified' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validTypes: {
					type: 'array',
					items: { type: 'string' },
					example: ['morning', 'evening'],
				},
			},
		},
	})
	@ApiUnauthorizedResponse({
		description: '🔒 Unauthorized - Insufficient permissions to request reports',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Insufficient permissions to request attendance reports' },
				error: { type: 'string', example: 'Unauthorized' },
				statusCode: { type: 'number', example: 401 },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'OWNER', 'HR', 'MANAGER'],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '⛔ Forbidden - Access denied to attendance reports',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Access denied to attendance reporting features' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Report generation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Report generation failed due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
			},
		},
	})
	async requestAttendanceReport(@Body() requestDto: RequestReportDto, @Req() req: AuthenticatedRequest) {
		try {
			const orgId = req.user?.org?.uid || req.user?.organisationRef;
			const userId = req.user?.uid;

			if (!orgId) {
				return { message: 'Organization not found', statusCode: 400 };
			}

			if (!userId) {
				return { message: 'User ID not found', statusCode: 400 };
			}

			// Get user details including email
			const userResult = await this.userService.findOneByUid(userId);

			if (!userResult.user || !userResult.user.email) {
				return { message: 'User email not found', statusCode: 400 };
			}

			const userEmail = userResult.user.email;
			const { reportType } = requestDto;

			if (!['morning', 'evening'].includes(reportType)) {
				return {
					message: 'Invalid report type specified',
					statusCode: 400,
					validTypes: ['morning', 'evening'],
				};
			}

			let reportData;

			if (reportType === 'morning') {
				reportData = await this.attendanceReportsService.generateAndSendMorningReportToUser(orgId, userEmail);
			} else {
				reportData = await this.attendanceReportsService.generateAndSendEveningReportToUser(orgId, userEmail);
			}

			return {
				message: `${
					reportType.charAt(0).toUpperCase() + reportType.slice(1)
				} attendance report generated and sent successfully`,
				reportType,
				sentTo: userEmail,
				generatedAt: new Date().toISOString(),
				organizationId: orgId,
				reportData,
			};
		} catch (error) {
			return {
				message: `Error generating ${requestDto.reportType} report: ${error.message}`,
				statusCode: 500,
				timestamp: new Date().toISOString(),
			};
		}
	}

	@Post('manual-overtime-check')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({
		summary: '⏰ Trigger manual overtime policy check',
		description: `
# Manual Overtime Policy Check & Enforcement

Manually triggers the overtime policy check system to identify employees working beyond defined limits, send notifications, and ensure compliance with labor regulations and organizational policies.

## ⚡ **Overtime Detection Features**
- **Real-Time Monitoring**: Instant detection of employees exceeding standard work hours
- **Policy Enforcement**: Automatic application of organization-specific overtime policies
- **Compliance Checking**: Verification against labor law requirements and regulations
- **Exception Handling**: Smart identification of authorized overtime vs. policy violations
- **Escalation Management**: Automatic escalation to appropriate management levels

## 📊 **Check Components**
- **Work Hours Analysis**: Detailed analysis of daily and weekly work hour patterns
- **Break Compliance**: Verification of mandatory break periods and rest time requirements
- **Shift Validation**: Confirmation that shifts comply with maximum duration policies
- **Weekly Limits**: Tracking of weekly hour accumulation and limit enforcement
- **Consecutive Days**: Monitoring of consecutive work days without rest periods

## 🎯 **Policy Benefits**
- **Compliance Assurance**: Automatic compliance with labor laws and organizational policies
- **Employee Wellness**: Protection of employee health through work-life balance enforcement
- **Cost Management**: Control of overtime costs through proactive monitoring and alerts
- **Risk Mitigation**: Reduction of legal and operational risks associated with overtime violations
- **Performance Optimization**: Insights into scheduling efficiency and resource utilization

## 📧 **Notification System**
- **Employee Alerts**: Direct notifications to employees about overtime status and policies
- **Manager Notifications**: Alerts to managers about team overtime patterns and exceptions
- **HR Notifications**: Comprehensive reports to HR for policy compliance and tracking
- **Executive Dashboards**: High-level overtime analytics for strategic decision-making
- **Compliance Reports**: Automated compliance documentation for regulatory requirements

## 🔄 **Automation Features**
- **Scheduled Checks**: Regular automated checks during business hours
- **Manual Triggers**: On-demand checks for immediate policy verification
- **Real-Time Alerts**: Instant notifications when overtime thresholds are exceeded
- **Batch Processing**: Efficient processing of multiple employees simultaneously
- **Historical Analysis**: Trend analysis and pattern recognition for policy optimization

## 📱 **Multi-Channel Alerts**
- **Email Notifications**: Professional email alerts with detailed overtime information
- **SMS Alerts**: Urgent text message notifications for critical overtime violations
- **Push Notifications**: Mobile app notifications for real-time awareness
- **Dashboard Alerts**: Visual alerts on management dashboards and portals
- **Slack/Teams Integration**: Automated posting to team communication channels

## 📈 **Advanced Analytics**
- **Overtime Patterns**: Analysis of overtime trends and recurring patterns
- **Cost Analysis**: Calculation of overtime costs and budget impact
- **Compliance Metrics**: Tracking of policy adherence and violation rates
- **Performance Impact**: Correlation between overtime and productivity metrics
- **Resource Planning**: Insights for improved staffing and scheduling decisions

## 🔒 **Security & Compliance**
- **Data Protection**: Secure handling of employee work hour data and personal information
- **Access Control**: Role-based access ensuring appropriate information visibility
- **Audit Trail**: Complete logging of overtime checks and policy enforcement actions
- **Regulatory Compliance**: Adherence to labor law requirements and industry standards
- **Privacy Protection**: Safeguarding of employee privacy while maintaining compliance monitoring
		`,
	})
	@ApiCreatedResponse({
		description: '✅ Overtime policy check completed successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Overtime policy check completed successfully' },
				processed: { type: 'number', example: 125, description: 'Number of employees processed in the check' },
				overtimeDetected: {
					type: 'object',
					description: 'Summary of overtime violations detected',
					properties: {
						totalViolations: {
							type: 'number',
							example: 8,
							description: 'Total overtime policy violations detected',
						},
						dailyViolations: { type: 'number', example: 5, description: 'Daily overtime limit violations' },
						weeklyViolations: {
							type: 'number',
							example: 3,
							description: 'Weekly overtime limit violations',
						},
						breakViolations: { type: 'number', example: 2, description: 'Mandatory break violations' },
						consecutiveDaysViolations: {
							type: 'number',
							example: 1,
							description: 'Consecutive work days violations',
						},
					},
				},
				notificationsSent: {
					type: 'object',
					description: 'Notifications sent as a result of the check',
					properties: {
						employeeNotifications: {
							type: 'number',
							example: 8,
							description: 'Notifications sent to employees',
						},
						managerNotifications: {
							type: 'number',
							example: 3,
							description: 'Notifications sent to managers',
						},
						hrNotifications: { type: 'number', example: 1, description: 'Notifications sent to HR' },
						executiveAlerts: { type: 'number', example: 1, description: 'Alerts sent to executives' },
					},
				},
				complianceStatus: {
					type: 'object',
					description: 'Overall compliance status after the check',
					properties: {
						complianceRate: {
							type: 'number',
							example: 93.6,
							description: 'Percentage of employees in compliance',
						},
						riskLevel: {
							type: 'string',
							example: 'LOW',
							description: 'Overall risk level (LOW, MEDIUM, HIGH)',
						},
						immediateActions: {
							type: 'number',
							example: 2,
							description: 'Number of immediate actions required',
						},
						followUpRequired: {
							type: 'number',
							example: 5,
							description: 'Number of cases requiring follow-up',
						},
					},
				},
				processingDetails: {
					type: 'object',
					description: 'Details about the check processing',
					properties: {
						checkId: {
							type: 'string',
							example: 'OT-CHECK-2024-03-15-001',
							description: 'Unique check identifier',
						},
						processingTime: {
							type: 'string',
							example: '2.3 seconds',
							description: 'Time taken to complete the check',
						},
						triggeredBy: {
							type: 'string',
							example: 'John Manager',
							description: 'User who triggered the check',
						},
						timestamp: {
							type: 'string',
							format: 'date-time',
							example: '2024-03-15T16:30:00Z',
							description: 'Check completion timestamp',
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Unable to perform overtime check',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Unable to perform overtime check: no active employees found' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				errorType: { type: 'string', example: 'NO_ACTIVE_EMPLOYEES', description: 'Type of error encountered' },
				issues: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'No employees currently checked in',
						'Overtime policies not configured',
						'System time synchronization issues',
					],
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify employees are checked in for the day',
						'Configure overtime policies in system settings',
						'Check system time synchronization',
					],
				},
			},
		},
	})
	@ApiUnauthorizedResponse({
		description: '🔒 Unauthorized - Insufficient permissions to trigger overtime checks',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Insufficient permissions to trigger overtime policy checks' },
				error: { type: 'string', example: 'Unauthorized' },
				statusCode: { type: 'number', example: 401 },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'OWNER', 'MANAGER'],
				},
				permissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['overtime:check', 'attendance:manage', 'policies:enforce'],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '⛔ Forbidden - Access denied to overtime policy management',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Access denied to overtime policy management features' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				restrictions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Overtime policy management requires management-level access',
						'Branch-level users cannot trigger organization-wide checks',
						'Policy enforcement requires HR or Admin role',
					],
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Overtime check system failure',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Overtime check system failed due to internal error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				errorDetails: {
					type: 'object',
					description: 'Technical error information',
					properties: {
						component: {
							type: 'string',
							example: 'OVERTIME_SERVICE',
							description: 'Component where error occurred',
						},
						stage: {
							type: 'string',
							example: 'POLICY_EVALUATION',
							description: 'Stage of process where error occurred',
						},
						affectedEmployees: {
							type: 'number',
							example: 125,
							description: 'Number of employees affected by the error',
						},
						retryable: {
							type: 'boolean',
							example: true,
							description: 'Whether the operation can be retried',
						},
					},
				},
				supportInfo: {
					type: 'object',
					description: 'Support and troubleshooting information',
					properties: {
						incidentId: {
							type: 'string',
							example: 'INC-2024-03-15-002',
							description: 'Support incident identifier',
						},
						supportContact: {
							type: 'string',
							example: 'support@company.com',
							description: 'Support contact information',
						},
						expectedResolution: {
							type: 'string',
							example: '15 minutes',
							description: 'Expected resolution time',
						},
					},
				},
			},
		},
	})
	@Get('metrics/user/:ref')
	@ApiOperation({
		summary: 'Get user attendance metrics for a date range',
		description:
			'Retrieves detailed attendance metrics and performance insights for a specific user within a date range',
	})
	@ApiParam({ name: 'ref', description: 'User ID', type: 'number' })
	@ApiQuery({ name: 'startDate', description: 'Start date (YYYY-MM-DD)', required: true })
	@ApiQuery({ name: 'endDate', description: 'End date (YYYY-MM-DD)', required: true })
	@ApiQuery({
		name: 'includeInsights',
		description: 'Include performance insights',
		required: false,
		type: 'boolean',
	})
	@ApiOkResponse({
		description: 'User metrics retrieved successfully',
		type: UserMetricsResponseDto,
	})
	@ApiBadRequestResponse({ description: 'Invalid parameters provided' })
	@ApiNotFoundResponse({ description: 'User not found' })
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(AccessLevel.USER, AccessLevel.ADMIN, AccessLevel.OWNER)
	async getUserMetrics(
		@Param('ref') ref: number,
		@Query('startDate') startDate: string,
		@Query('endDate') endDate: string,
		@Query('includeInsights') includeInsights: boolean = true,
		@Req() req: AuthenticatedRequest,
	): Promise<UserMetricsResponseDto> {
		// Validate access - users can only view their own metrics unless they're admin/owner
		if (
			req.user.accessLevel !== AccessLevel.ADMIN &&
			req.user.accessLevel !== AccessLevel.OWNER &&
			req.user.uid !== Number(ref)
		) {
			throw new Error("You do not have permission to view this user's metrics");
		}

		return this.attendanceService.getUserMetricsForDateRange(
			Number(ref),
			startDate,
			endDate,
			typeof includeInsights === 'string' ? (includeInsights === 'false' ? false : true) : includeInsights,
		);
	}

	@Get('report/:ref/:startDate/:endDate')
	@ApiOperation({
		summary: 'Get user attendance metrics for a specific date range',
		description:
			'Retrieves detailed attendance metrics and performance insights for a specific user within a date range using path parameters',
	})
	@ApiParam({ name: 'ref', description: 'User ID', type: 'number' })
	@ApiParam({ name: 'startDate', description: 'Start date (YYYY-MM-DD)', type: 'string' })
	@ApiParam({ name: 'endDate', description: 'End date (YYYY-MM-DD)', type: 'string' })
	@ApiQuery({
		name: 'includeInsights',
		description: 'Include performance insights',
		required: false,
		type: 'boolean',
	})
	@ApiOkResponse({
		description: 'User metrics retrieved successfully',
		type: UserMetricsResponseDto,
	})
	@ApiBadRequestResponse({ description: 'Invalid parameters provided' })
	@ApiNotFoundResponse({ description: 'User not found' })
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(AccessLevel.USER, AccessLevel.ADMIN, AccessLevel.OWNER)
	async getUserMetricsWithPathParams(
		@Param('ref') ref: number,
		@Param('startDate') startDate: string,
		@Param('endDate') endDate: string,
		@Query('includeInsights') includeInsights: boolean = true,
	): Promise<UserMetricsResponseDto> {

		return this.attendanceService.getUserMetricsForDateRange(
			Number(ref),
			startDate,
			endDate,
			typeof includeInsights === 'string' ? (includeInsights === 'false' ? false : true) : includeInsights,
		);
	}

	async triggerOvertimeCheck(@CurrentUser() user: User): Promise<{ message: string; processed: number }> {
		// Optional manual trigger for testing overtime reminders
		return this.overtimeReminderService.triggerOvertimeCheck();
	}
}
