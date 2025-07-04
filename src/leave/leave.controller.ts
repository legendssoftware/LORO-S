import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Request, Req } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { UpdateLeaveDto } from './dto/update-leave.dto';
import {
	ApiOperation,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiForbiddenResponse,
	ApiConflictResponse,
	ApiUnprocessableEntityResponse,
	ApiInternalServerErrorResponse,
	ApiServiceUnavailableResponse,
	ApiConsumes,
	ApiProduces,
	ApiBearerAuth,
	ApiQuery,
} from '@nestjs/swagger';
import { Roles } from '../decorators/role.decorator';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { LeaveStatus, LeaveType } from '../lib/enums/leave.enums';

@ApiBearerAuth('JWT-auth')
@ApiTags('🌴 Leave Management')
@Controller('leave')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('leave')
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
@ApiInternalServerErrorResponse({
	description: '💥 Internal Server Error - Leave management system failure',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Leave management service temporarily unavailable' },
			error: { type: 'string', example: 'Internal Server Error' },
			statusCode: { type: 'number', example: 500 },
			timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
			path: { type: 'string', example: '/leave' }
		}
	}
})
@ApiServiceUnavailableResponse({
	description: '🔧 Service Unavailable - Leave management service maintenance',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Leave management service is temporarily unavailable for maintenance' },
			error: { type: 'string', example: 'Service Unavailable' },
			statusCode: { type: 'number', example: 503 },
			retryAfter: { type: 'number', example: 300 }
		}
	}
})
export class LeaveController {
	constructor(private readonly leaveService: LeaveService) {}

	@Post()
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
		summary: '➕ Create a new leave request',
		description: `
# Leave Request Creation System

Creates comprehensive leave requests with automated approval workflows and policy validation.

## 🌴 **Leave Types Supported**
- **Annual Leave**: Vacation and personal time off
- **Sick Leave**: Medical leave and health-related absences
- **Maternity/Paternity**: Family and parental leave
- **Study Leave**: Educational and training purposes
- **Compassionate Leave**: Bereavement and family emergencies
- **Unpaid Leave**: Extended absences without pay

## 🔄 **Automated Workflow**
- **Policy Validation**: Automatic checking against leave policies
- **Balance Verification**: Real-time leave balance calculation
- **Approval Routing**: Smart routing to appropriate managers
- **Calendar Integration**: Automatic calendar blocking and scheduling
- **Notification System**: Email and in-app notifications

## 📋 **Business Rules**
- **Advance Notice**: Configurable minimum notice periods
- **Blackout Periods**: Automatic blocking during busy periods
- **Team Coverage**: Workload distribution and handover management
- **Documentation**: Required supporting documents for certain leave types
- **Compliance**: Adherence to labor law and company policies

## 🎯 **Use Cases**
- **Employee Self-Service**: Staff submitting personal leave requests
- **Manager Delegation**: Managers submitting requests for team members
- **Bulk Scheduling**: Planning team leaves during slow periods
- **Emergency Leave**: Immediate leave for urgent situations
- **Recurring Leave**: Scheduled regular absences (e.g., medical appointments)

## 🔒 **Security & Compliance**
- **GDPR Compliance**: Secure handling of personal health information
- **Audit Trail**: Complete tracking of request lifecycle
- **Data Privacy**: Confidential handling of sensitive leave reasons
- **Labor Law Compliance**: Adherence to local employment regulations
		`,
	})
	@ApiBody({ 
		type: CreateLeaveDto,
		description: 'Leave request creation payload with all required information',
		examples: {
			annualLeave: {
				summary: '🏖️ Annual Leave - Summer Vacation',
				description: 'Standard vacation leave request',
				value: {
					leaveType: 'ANNUAL',
					startDate: '2024-07-15',
					endDate: '2024-07-29',
					reason: 'Summer vacation with family',
					isHalfDay: false,
					emergencyContact: {
						name: 'Jane Doe',
						phone: '+27-82-123-4567',
						relationship: 'Spouse'
					},
					handoverNotes: 'All projects handed over to John Smith. Client meetings rescheduled.'
				}
			},
			sickLeave: {
				summary: '🏥 Sick Leave - Medical Recovery',
				description: 'Medical leave with documentation',
				value: {
					leaveType: 'SICK',
					startDate: '2024-02-10',
					endDate: '2024-02-12',
					reason: 'Medical procedure recovery',
					isHalfDay: false,
					medicalCertificate: true,
					doctorNote: 'Attached medical certificate from Dr. Smith'
				}
			},
			maternityLeave: {
				summary: '👶 Maternity Leave - New Born',
				description: 'Maternity leave with extended duration',
				value: {
					leaveType: 'MATERNITY',
					startDate: '2024-05-01',
					endDate: '2024-08-31',
					reason: 'Maternity leave for newborn care',
					isHalfDay: false,
					expectedReturnDate: '2024-09-01',
					coveringManager: 'Sarah Johnson',
					transitionPlan: 'Detailed handover document attached'
				}
			},
			halfDayLeave: {
				summary: '🕐 Half Day Leave - Medical Appointment',
				description: 'Half day leave for routine appointment',
				value: {
					leaveType: 'SICK',
					startDate: '2024-03-15',
					endDate: '2024-03-15',
					reason: 'Routine medical checkup',
					isHalfDay: true,
					halfDayPeriod: 'MORNING',
					appointmentTime: '09:00',
					expectedReturn: '13:00'
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Leave request created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request created successfully' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						leaveRef: { type: 'string', example: 'LV-2024-001' },
						leaveType: { type: 'string', enum: Object.values(LeaveType), example: 'ANNUAL' },
						status: { type: 'string', enum: Object.values(LeaveStatus), example: 'PENDING' },
						startDate: { type: 'string', format: 'date', example: '2024-07-15' },
						endDate: { type: 'string', format: 'date', example: '2024-07-29' },
						duration: { type: 'number', example: 14 },
						remainingBalance: { type: 'number', example: 21 },
						approvalWorkflow: {
							type: 'object',
							properties: {
								nextApprover: { type: 'string', example: 'John Manager' },
								expectedApprovalDate: { type: 'string', format: 'date', example: '2024-07-10' },
								approvalSteps: { type: 'number', example: 2 }
							}
						},
						notifications: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Email sent to line manager',
								'Calendar invitation created',
								'Team notification scheduled'
							]
						},
						createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid leave request data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request validation failed' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Start date cannot be in the past',
						'End date must be after start date',
						'Insufficient leave balance (required: 14 days, available: 10 days)',
						'Leave type SICK requires medical certificate for absences longer than 3 days'
					]
				},
				policyViolations: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Minimum 7 days advance notice required for annual leave',
						'Blackout period: No leave allowed during December'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions or policy restrictions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You are not authorized to submit leave requests for this period' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				restrictions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User is on probation period',
						'Outstanding leave requests must be resolved first',
						'Manager approval required for leave longer than 5 days'
					]
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Leave request conflicts with existing schedules',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request conflicts with existing commitments' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							type: { type: 'string', example: 'EXISTING_LEAVE' },
							date: { type: 'string', format: 'date', example: '2024-07-20' },
							description: { type: 'string', example: 'Overlaps with approved sick leave' }
						}
					}
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Modify dates to avoid overlap',
						'Cancel conflicting leave request first',
						'Split leave into non-conflicting periods'
					]
				}
			}
		}
	})
	@ApiUnprocessableEntityResponse({
		description: '🔄 Unprocessable Entity - Business rule violations',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request violates business rules' },
				error: { type: 'string', example: 'Unprocessable Entity' },
				statusCode: { type: 'number', example: 422 },
				businessRuleViolations: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Maximum consecutive leave days exceeded (limit: 30 days)',
						'Team capacity: Cannot approve leave when 50% of team is already on leave',
						'Critical project deadline: Leave not allowed during project milestone week'
					]
				}
			}
		}
	})
	create(@Body() createLeaveDto: CreateLeaveDto, @Req() req: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.create(createLeaveDto, orgId, branchId, userId);
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
		summary: '📋 Retrieve leave requests with advanced filtering',
		description: `
# Leave Request Management Dashboard

Provides comprehensive leave request retrieval with advanced filtering, sorting, and analytics capabilities.

## 📊 **Advanced Filtering Options**
- **Status Filtering**: Filter by approval status (Pending, Approved, Rejected, Cancelled)
- **Type Filtering**: Filter by leave type (Annual, Sick, Maternity, Study, etc.)
- **Date Range**: Flexible date range filtering for planning and reporting
- **User Filtering**: View requests by specific employees or teams
- **Duration Filtering**: Filter by leave duration (half-day, multi-day, extended)

## 🔍 **Search & Analytics**
- **Smart Search**: Quick search across all leave request fields
- **Bulk Operations**: Mass approval/rejection capabilities
- **Export Options**: PDF and Excel export for reporting
- **Calendar View**: Visual calendar representation of leave schedules
- **Team Analytics**: Team coverage and capacity planning

## 📈 **Management Insights**
- **Approval Workflow**: Track requests through approval stages
- **Leave Patterns**: Identify seasonal trends and patterns
- **Balance Tracking**: Monitor team leave balances and utilization
- **Compliance Monitoring**: Ensure adherence to leave policies
- **Resource Planning**: Optimize team coverage and workload distribution

## 🎯 **Use Cases**
- **HR Dashboard**: Complete leave management overview
- **Manager Reviews**: Quick approval workflow management
- **Employee Self-Service**: Personal leave history and status
- **Payroll Integration**: Leave data for payroll calculations
- **Compliance Reporting**: Audit trails and regulatory reporting

## 🔒 **Security & Privacy**
- **Role-Based Access**: Users only see authorized leave requests
- **Data Anonymization**: Sensitive leave reasons protected based on permissions
- **Audit Logging**: Complete access and modification tracking
- **Privacy Controls**: GDPR-compliant data handling
		`,
	})
	@ApiQuery({ 
		name: 'status', 
		enum: LeaveStatus, 
		required: false, 
		description: 'Filter by leave approval status',
		example: 'PENDING'
	})
	@ApiQuery({ 
		name: 'leaveType', 
		enum: LeaveType, 
		required: false, 
		description: 'Filter by specific leave type',
		example: 'ANNUAL'
	})
	@ApiQuery({ 
		name: 'ownerUid', 
		type: String, 
		required: false, 
		description: 'Filter by employee user ID',
		example: '12345'
	})
	@ApiQuery({ 
		name: 'startDate', 
		type: String, 
		required: false, 
		description: 'Filter by leave start date (ISO format: YYYY-MM-DD)',
		example: '2024-01-01'
	})
	@ApiQuery({ 
		name: 'endDate', 
		type: String, 
		required: false, 
		description: 'Filter by leave end date (ISO format: YYYY-MM-DD)',
		example: '2024-12-31'
	})
	@ApiQuery({ 
		name: 'isApproved', 
		type: Boolean, 
		required: false, 
		description: 'Filter by final approval status',
		example: true
	})
	@ApiQuery({ 
		name: 'page', 
		type: Number, 
		required: false, 
		description: 'Page number for pagination (starts from 1)',
		example: 1
	})
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page (max 100)',
		example: 20
	})
	@ApiOkResponse({
		description: '✅ Leave requests retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave requests retrieved successfully' },
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 12345 },
							leaveRef: { type: 'string', example: 'LV-2024-001' },
							leaveType: { type: 'string', enum: Object.values(LeaveType), example: 'ANNUAL' },
							startDate: { type: 'string', format: 'date', example: '2024-07-15' },
							endDate: { type: 'string', format: 'date', example: '2024-07-29' },
							duration: { type: 'number', example: 14 },
							status: { type: 'string', enum: Object.values(LeaveStatus), example: 'APPROVED' },
							isHalfDay: { type: 'boolean', example: false },
							reason: { type: 'string', example: 'Summer vacation with family' },
							appliedDate: { type: 'string', format: 'date-time', example: '2024-06-01T10:00:00Z' },
							approvedDate: { type: 'string', format: 'date-time', example: '2024-06-02T14:30:00Z' },
							employee: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 54321 },
									name: { type: 'string', example: 'John Doe' },
									email: { type: 'string', example: 'john.doe@company.com' },
									department: { type: 'string', example: 'Engineering' }
								}
							},
							approver: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 67890 },
									name: { type: 'string', example: 'Jane Manager' },
									email: { type: 'string', example: 'jane.manager@company.com' }
								}
							}
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 156 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 20 },
						totalPages: { type: 'number', example: 8 },
						hasNextPage: { type: 'boolean', example: true },
						hasPreviousPage: { type: 'boolean', example: false },
						filters: {
							type: 'object',
							properties: {
								appliedFilters: { type: 'number', example: 2 },
								activeFilters: {
									type: 'array',
									items: { type: 'string' },
									example: ['status: PENDING', 'leaveType: ANNUAL']
								}
							}
						}
					},
				},
				analytics: {
					type: 'object',
					properties: {
						totalDaysRequested: { type: 'number', example: 234 },
						approvalRate: { type: 'number', example: 85.5 },
						averageProcessingTime: { type: 'number', example: 2.3 },
						topLeaveTypes: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									type: { type: 'string', example: 'ANNUAL' },
									count: { type: 'number', example: 45 },
									percentage: { type: 'number', example: 65.2 }
								}
							}
						}
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid query parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid query parameters provided' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				parameterErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Invalid date format for startDate (expected: YYYY-MM-DD)',
						'Page number must be greater than 0',
						'Limit cannot exceed 100 records per page',
						'Invalid leave status value'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to view leave requests',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view leave requests for this scope' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				accessLimitations: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Can only view own leave requests',
						'Manager access required to view team requests',
						'HR access required for organization-wide view'
					]
				}
			}
		}
	})
	findAll(
		@Query('status') status?: string,
		@Query('leaveType') leaveType?: string,
		@Query('ownerUid') ownerUid?: string,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('isApproved') isApproved?: string,
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Req() req?: any,
	) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		// Parse the filters
		const filters: any = {};
		if (status) filters.status = status;
		if (leaveType) filters.leaveType = leaveType;
		if (ownerUid) filters.ownerUid = parseInt(ownerUid, 10);
		if (startDate) filters.startDate = new Date(startDate);
		if (endDate) filters.endDate = new Date(endDate);
		if (isApproved) filters.isApproved = isApproved.toLowerCase() === 'true';

		return this.leaveService.findAll(
			filters,
			page ? parseInt(page, 10) : 1,
			limit ? parseInt(limit, 10) : Number(process.env.DEFAULT_PAGE_LIMIT),
			orgId,
			branchId,
			userId,
		);
	}

	@Get(':ref')
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
		summary: '🔍 Get detailed leave request information',
		description: `
# Leave Request Detail View

Provides comprehensive information about a specific leave request including approval history, documentation, and related data.

## 📋 **Detailed Information**
- **Complete Leave Details**: All request information and metadata
- **Approval Workflow**: Full approval chain and decision history
- **Documentation**: Associated files, certificates, and supporting documents
- **Timeline**: Complete request lifecycle from submission to resolution
- **Impact Analysis**: Team coverage and workload distribution effects

## 🔄 **Workflow Tracking**
- **Status History**: Track all status changes and transitions
- **Approver Chain**: View all approvers and their decisions
- **Comments & Notes**: Feedback and communication throughout the process
- **Deadline Tracking**: Monitor processing times and SLA compliance
- **Escalation History**: Track any escalations or special handling

## 📊 **Related Information**
- **Employee Profile**: Basic employee information and leave balance
- **Team Impact**: Coverage arrangements and workload redistribution
- **Calendar Integration**: Calendar events and scheduling conflicts
- **Policy Compliance**: Adherence to leave policies and regulations
- **Financial Impact**: Payroll and compensation calculations

## 🎯 **Use Cases**
- **Detailed Review**: Manager approval process and decision making
- **Employee Inquiry**: Self-service status checking and information
- **HR Investigation**: Audit trails and compliance verification
- **Payroll Processing**: Leave data for compensation calculations
- **Legal Compliance**: Documentation for regulatory requirements

## 🔒 **Privacy & Security**
- **Access Control**: Role-based access to sensitive information
- **Data Masking**: Protect confidential medical or personal information
- **Audit Logging**: Track all access and viewing activities
- **GDPR Compliance**: Secure handling of personal leave data
		`,
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Leave request unique reference ID',
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Leave request details retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request details retrieved successfully' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						leaveRef: { type: 'string', example: 'LV-2024-001' },
						leaveType: { type: 'string', enum: Object.values(LeaveType), example: 'ANNUAL' },
						startDate: { type: 'string', format: 'date', example: '2024-07-15' },
						endDate: { type: 'string', format: 'date', example: '2024-07-29' },
						duration: { type: 'number', example: 14 },
						status: { type: 'string', enum: Object.values(LeaveStatus), example: 'APPROVED' },
						isHalfDay: { type: 'boolean', example: false },
						reason: { type: 'string', example: 'Summer vacation with family' },
						appliedDate: { type: 'string', format: 'date-time', example: '2024-06-01T10:00:00Z' },
						approvedDate: { type: 'string', format: 'date-time', example: '2024-06-02T14:30:00Z' },
						employee: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 54321 },
								name: { type: 'string', example: 'John Doe' },
								email: { type: 'string', example: 'john.doe@company.com' },
								department: { type: 'string', example: 'Engineering' },
								jobTitle: { type: 'string', example: 'Senior Developer' },
								employeeId: { type: 'string', example: 'EMP-001' },
								leaveBalance: {
									type: 'object',
									properties: {
										annual: { type: 'number', example: 21 },
										sick: { type: 'number', example: 10 },
										personal: { type: 'number', example: 5 }
									}
								}
							}
						},
						approvalWorkflow: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									step: { type: 'number', example: 1 },
									approver: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 67890 },
											name: { type: 'string', example: 'Jane Manager' },
											email: { type: 'string', example: 'jane.manager@company.com' },
											role: { type: 'string', example: 'LINE_MANAGER' }
										}
									},
									status: { type: 'string', example: 'APPROVED' },
									decision: { type: 'string', example: 'Approved with conditions' },
									processedDate: { type: 'string', format: 'date-time', example: '2024-06-02T14:30:00Z' },
									comments: { type: 'string', example: 'Approved. Ensure handover is complete.' }
								}
							}
						},
						documents: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 456 },
									fileName: { type: 'string', example: 'medical_certificate.pdf' },
									fileType: { type: 'string', example: 'MEDICAL_CERTIFICATE' },
									uploadDate: { type: 'string', format: 'date-time', example: '2024-06-01T10:15:00Z' },
									fileSize: { type: 'number', example: 2048576 }
								}
							}
						},
						teamImpact: {
							type: 'object',
							properties: {
								coveringEmployees: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 78901 },
											name: { type: 'string', example: 'Alice Cover' },
											responsibilities: { type: 'string', example: 'Handle client meetings and code reviews' }
										}
									}
								},
								workloadDistribution: { type: 'string', example: 'Tasks redistributed among team members' },
								projectImpact: { type: 'string', example: 'No impact on current sprint delivery' }
							}
						},
						compliance: {
							type: 'object',
							properties: {
								policyCompliant: { type: 'boolean', example: true },
								minimumNotice: { type: 'boolean', example: true },
								maximumDuration: { type: 'boolean', example: true },
								documentationRequired: { type: 'boolean', example: false },
								managementApproval: { type: 'boolean', example: true }
							}
						}
					},
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Leave request not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found or access denied' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				details: {
					type: 'object',
					properties: {
						requestedRef: { type: 'number', example: 12345 },
						possibleReasons: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Leave request does not exist',
								'Leave request has been deleted',
								'Insufficient permissions to view this request',
								'Request belongs to different organization'
							]
						}
					}
				}
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Access denied to leave request details',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view this leave request' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				accessRestrictions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Can only view own leave requests',
						'Manager access required to view team member requests',
						'HR access required for sensitive leave types'
					]
				}
			}
		}
	})
	findOne(@Param('ref') ref: number, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.findOne(ref, orgId, branchId, userId);
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
		summary: '👤 Get employee leave history and analytics',
		description: `
# Employee Leave Management Profile

Provides comprehensive leave history, analytics, and balance information for a specific employee.

## 📊 **Employee Leave Analytics**
- **Leave History**: Complete chronological leave request history
- **Balance Tracking**: Real-time leave balance and accrual information
- **Usage Patterns**: Leave utilization trends and seasonal patterns
- **Approval Analytics**: Success rates and average processing times
- **Compliance Tracking**: Adherence to leave policies and regulations

## 🗓️ **Calendar Integration**
- **Upcoming Leave**: Scheduled and approved future leave dates
- **Leave Calendar**: Visual representation of leave patterns
- **Conflict Detection**: Identify potential scheduling conflicts
- **Team Coordination**: View leave in context of team schedules
- **Holiday Integration**: Automatic consideration of public holidays

## 📋 **Leave Balance Management**
- **Current Balances**: Real-time leave entitlements and usage
- **Accrual Tracking**: Leave earning rates and accumulation
- **Carry-over Rules**: Annual leave carry-over and expiry tracking
- **Pro-rata Calculations**: Accurate calculations for part-time employees
- **Leave Types**: Detailed breakdown by leave category

## 🎯 **Use Cases**
- **Employee Self-Service**: Personal leave history and balance checking
- **Manager Review**: Team member leave patterns and planning
- **HR Analytics**: Employee leave utilization and compliance monitoring
- **Payroll Integration**: Leave data for accurate compensation calculations
- **Performance Management**: Leave impact on productivity and planning

## 🔒 **Privacy & Access Control**
- **Role-Based Access**: Appropriate data visibility based on user permissions
- **Self-Service**: Employees can view their own complete leave history
- **Manager Access**: Managers can view team member leave information
- **HR Access**: Full access to leave data for administrative purposes
		`,
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Employee unique reference ID',
		type: 'number',
		example: 54321
	})
	@ApiOkResponse({
		description: '✅ Employee leave history retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Employee leave history retrieved successfully' },
				data: {
					type: 'object',
					properties: {
						employee: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 54321 },
								name: { type: 'string', example: 'John Doe' },
								email: { type: 'string', example: 'john.doe@company.com' },
								department: { type: 'string', example: 'Engineering' },
								jobTitle: { type: 'string', example: 'Senior Developer' },
								employeeId: { type: 'string', example: 'EMP-001' },
								startDate: { type: 'string', format: 'date', example: '2020-01-15' },
								employmentType: { type: 'string', example: 'FULL_TIME' }
							}
						},
						leaveBalance: {
							type: 'object',
							properties: {
								annual: {
									type: 'object',
									properties: {
										total: { type: 'number', example: 25 },
										used: { type: 'number', example: 4 },
										remaining: { type: 'number', example: 21 },
										pending: { type: 'number', example: 3 },
										accrualRate: { type: 'number', example: 2.08 }
									}
								},
								sick: {
									type: 'object',
									properties: {
										total: { type: 'number', example: 12 },
										used: { type: 'number', example: 2 },
										remaining: { type: 'number', example: 10 }
									}
								},
								personal: {
									type: 'object',
									properties: {
										total: { type: 'number', example: 5 },
										used: { type: 'number', example: 0 },
										remaining: { type: 'number', example: 5 }
									}
								}
							}
						},
						leaveHistory: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 12345 },
									leaveRef: { type: 'string', example: 'LV-2024-001' },
									leaveType: { type: 'string', enum: Object.values(LeaveType), example: 'ANNUAL' },
									startDate: { type: 'string', format: 'date', example: '2024-07-15' },
									endDate: { type: 'string', format: 'date', example: '2024-07-29' },
									duration: { type: 'number', example: 14 },
									status: { type: 'string', enum: Object.values(LeaveStatus), example: 'APPROVED' },
									isHalfDay: { type: 'boolean', example: false },
									appliedDate: { type: 'string', format: 'date-time', example: '2024-06-01T10:00:00Z' },
									approvedDate: { type: 'string', format: 'date-time', example: '2024-06-02T14:30:00Z' },
									approver: {
										type: 'object',
										properties: {
											name: { type: 'string', example: 'Jane Manager' },
											email: { type: 'string', example: 'jane.manager@company.com' }
										}
									}
								},
							},
						},
						analytics: {
							type: 'object',
							properties: {
								totalDaysTaken: { type: 'number', example: 18 },
								totalRequests: { type: 'number', example: 8 },
								approvalRate: { type: 'number', example: 87.5 },
								averageRequestDuration: { type: 'number', example: 6.2 },
								seasonalPattern: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											month: { type: 'string', example: 'July' },
											days: { type: 'number', example: 14 },
											requests: { type: 'number', example: 1 }
										}
									}
								},
								leaveTypeBreakdown: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											type: { type: 'string', example: 'ANNUAL' },
											count: { type: 'number', example: 6 },
											days: { type: 'number', example: 15 },
											percentage: { type: 'number', example: 83.3 }
										}
									}
								}
							}
						},
						upcomingLeave: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 12346 },
									leaveType: { type: 'string', example: 'ANNUAL' },
									startDate: { type: 'string', format: 'date', example: '2024-12-20' },
									endDate: { type: 'string', format: 'date', example: '2025-01-02' },
									duration: { type: 'number', example: 10 },
									status: { type: 'string', example: 'APPROVED' }
								}
							}
						}
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Employee not found or no leave history',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Employee not found or no leave history available' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Access denied to employee leave history',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view this employee leave history' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	leavesByUser(@Param('ref') ref: number, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.leavesByUser(ref, orgId, branchId, userId);
	}

	@Patch(':ref')
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
		summary: '✏️ Update leave request details',
		description: `
# Leave Request Modification System

Enables comprehensive updates to existing leave requests while maintaining audit trails and workflow integrity.

## 🔄 **Updateable Fields**
- **Leave Dates**: Modify start and end dates within policy constraints
- **Leave Type**: Change leave category (subject to approval requirements)
- **Duration**: Adjust leave duration and half-day settings
- **Reason**: Update leave reason and supporting documentation
- **Emergency Contacts**: Modify emergency contact information

## ⚠️ **Update Restrictions**
- **Status Dependent**: Updates allowed based on current approval status
- **Time Constraints**: Changes may be restricted close to leave start date
- **Policy Compliance**: All updates must comply with leave policies
- **Approval Reset**: Major changes may reset approval workflow
- **Documentation Requirements**: Certain changes require additional documentation

## 🔒 **Security & Audit**
- **Change Tracking**: Complete audit trail of all modifications
- **Version History**: Preserve previous versions of leave requests
- **Approval Impact**: Track how changes affect approval status
- **Notification System**: Automatic notifications to relevant stakeholders
- **Access Control**: Role-based permissions for different update types

## 🎯 **Common Use Cases**
- **Date Adjustments**: Modify leave dates due to work requirements
- **Duration Changes**: Extend or reduce leave duration
- **Type Corrections**: Correct leave type classification
- **Documentation Updates**: Add medical certificates or supporting documents
- **Emergency Modifications**: Last-minute changes due to urgent circumstances

## 📋 **Workflow Impact**
- **Approval Reset**: Significant changes may require re-approval
- **Notification Cascade**: Automatic updates to managers and HR
- **Calendar Sync**: Integration with calendar systems
- **Team Communication**: Updates to team coverage arrangements
		`,
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Leave request unique reference ID',
		type: 'number',
		example: 12345
	})
	@ApiBody({ 
		type: UpdateLeaveDto,
		description: 'Leave request update payload with modified information',
		examples: {
			dateAdjustment: {
				summary: '📅 Date Adjustment',
				description: 'Modify leave dates due to work commitments',
				value: {
					startDate: '2024-07-20',
					endDate: '2024-08-02',
					reason: 'Summer vacation - dates adjusted due to project deadline',
					notificationNote: 'Updated dates to accommodate critical project delivery'
				}
			},
			durationChange: {
				summary: '⏱️ Duration Modification',
				description: 'Change from full day to half day leave',
				value: {
					isHalfDay: true,
					halfDayPeriod: 'AFTERNOON',
					endDate: '2024-03-15',
					reason: 'Medical appointment - changed to half day as procedure is shorter than expected'
				}
			},
			typeCorrection: {
				summary: '🔄 Leave Type Correction',
				description: 'Correct leave type classification',
				value: {
					leaveType: 'SICK',
					reason: 'Medical procedure recovery',
					medicalCertificate: true,
					doctorNote: 'Medical certificate provided - reclassifying as sick leave'
				}
			},
			emergencyUpdate: {
				summary: '🚨 Emergency Modification',
				description: 'Emergency change due to family circumstances',
				value: {
					startDate: '2024-02-10',
					endDate: '2024-02-14',
					leaveType: 'COMPASSIONATE',
					reason: 'Family emergency - bereavement',
					urgentChange: true,
					emergencyContact: {
						name: 'Jane Doe',
						phone: '+27-82-987-6543',
						relationship: 'Sister'
					}
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Leave request updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request updated successfully' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						leaveRef: { type: 'string', example: 'LV-2024-001' },
						status: { type: 'string', example: 'PENDING_REAPPROVAL' },
						modifiedFields: {
							type: 'array',
							items: { type: 'string' },
							example: ['startDate', 'endDate', 'reason']
						},
						previousValues: {
							type: 'object',
							properties: {
								startDate: { type: 'string', format: 'date', example: '2024-07-15' },
								endDate: { type: 'string', format: 'date', example: '2024-07-29' }
							}
						},
						currentValues: {
							type: 'object',
							properties: {
								startDate: { type: 'string', format: 'date', example: '2024-07-20' },
								endDate: { type: 'string', format: 'date', example: '2024-08-02' }
							}
						},
						workflowImpact: {
							type: 'object',
							properties: {
								approvalReset: { type: 'boolean', example: true },
								notificationsSent: { type: 'number', example: 3 },
								nextApprover: { type: 'string', example: 'Jane Manager' },
								requiresReapproval: { type: 'boolean', example: true }
							}
						},
						updatedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						updatedBy: { type: 'string', example: 'John Doe' }
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Leave request not found for update',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found or access denied' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid update data or constraints',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request update validation failed' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Cannot modify dates for approved leave within 7 days of start date',
						'Leave balance insufficient for extended duration',
						'Invalid leave type transition from ANNUAL to SICK'
					]
				}
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Update not permitted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to update this leave request' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				restrictions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Leave request is already in progress',
						'Only request owner can modify pending requests',
						'Manager approval required for this type of change'
					]
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Update conflicts with business rules',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request update conflicts with existing commitments' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'New dates overlap with approved team member leave',
						'Updated leave type conflicts with previous approvals',
						'Modified duration exceeds annual leave balance'
					]
				}
			}
		}
	})
	update(@Param('ref') ref: number, @Body() updateLeaveDto: UpdateLeaveDto, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.update(ref, updateLeaveDto, orgId, branchId, userId);
	}

	@Patch(':ref/approve')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '✅ Approve leave request',
		description: `
# Leave Request Approval System

Processes leave request approvals with comprehensive workflow management and notification capabilities.

## 🔄 **Approval Workflow**
- **Multi-level Approval**: Support for hierarchical approval chains
- **Conditional Approval**: Approve with conditions or requirements
- **Bulk Approval**: Process multiple requests simultaneously
- **Delegation**: Approval delegation during manager absence
- **Escalation**: Automatic escalation for delayed approvals

## 📋 **Approval Validation**
- **Authority Checks**: Verify approver has sufficient authority
- **Policy Compliance**: Ensure request meets all policy requirements
- **Balance Verification**: Confirm adequate leave balance
- **Calendar Conflicts**: Check for scheduling conflicts
- **Team Impact**: Assess team coverage and capacity

## 🔔 **Notification System**
- **Employee Notification**: Immediate notification to request owner
- **HR Integration**: Automatic HR system updates
- **Calendar Updates**: Integration with calendar systems
- **Team Alerts**: Notification to team members about coverage
- **Payroll Sync**: Updates to payroll systems

## 📊 **Post-Approval Actions**
- **Leave Balance Update**: Automatic deduction from leave balance
- **Calendar Blocking**: Reserve dates in employee calendar
- **Handover Activation**: Activate handover procedures
- **Coverage Assignment**: Assign covering employees
- **Documentation**: Generate approval documentation

## 🎯 **Use Cases**
- **Standard Approval**: Regular leave request processing
- **Emergency Approval**: Fast-track urgent leave requests
- **Conditional Approval**: Approve with specific conditions
- **Partial Approval**: Approve modified dates or duration
- **Retrospective Approval**: Approve already taken leave
		`,
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Leave request unique reference ID',
		type: 'number',
		example: 12345
	})
	@ApiBody({
		description: 'Optional approval details and conditions',
		required: false,
		schema: {
			type: 'object',
			properties: {
				approvalComments: { 
					type: 'string', 
					example: 'Approved with condition that handover is completed',
					description: 'Comments from the approver'
				},
				conditions: {
					type: 'array',
					items: { type: 'string' },
					example: ['Complete project handover', 'Ensure team coverage'],
					description: 'Approval conditions that must be met'
				},
				effectiveDate: {
					type: 'string',
					format: 'date',
					example: '2024-07-15',
					description: 'Effective date if different from request start date'
				},
				urgentApproval: {
					type: 'boolean',
					example: false,
					description: 'Mark as urgent approval for expedited processing'
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Leave request approved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request approved successfully' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						leaveRef: { type: 'string', example: 'LV-2024-001' },
						status: { type: 'string', example: 'APPROVED' },
						approvedDate: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						approver: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 67890 },
								name: { type: 'string', example: 'Jane Manager' },
								email: { type: 'string', example: 'jane.manager@company.com' },
								role: { type: 'string', example: 'LINE_MANAGER' }
							}
						},
						approvalDetails: {
							type: 'object',
							properties: {
								comments: { type: 'string', example: 'Approved with condition that handover is completed' },
								conditions: {
									type: 'array',
									items: { type: 'string' },
									example: ['Complete project handover', 'Ensure team coverage']
								},
								processingTime: { type: 'number', example: 2.5, description: 'Days taken to process' }
							}
						},
						leaveBalance: {
							type: 'object',
							properties: {
								previousBalance: { type: 'number', example: 25 },
								deducted: { type: 'number', example: 14 },
								newBalance: { type: 'number', example: 11 }
							}
						},
						notifications: {
							type: 'object',
							properties: {
								employeeNotified: { type: 'boolean', example: true },
								hrNotified: { type: 'boolean', example: true },
								teamNotified: { type: 'boolean', example: true },
								calendarUpdated: { type: 'boolean', example: true }
							}
						},
						nextSteps: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Employee will receive approval confirmation',
								'Calendar events will be created',
								'Handover process initiated',
								'Team coverage arrangements activated'
							]
						}
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Leave request not found for approval',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found or already processed' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient approval authority',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have authority to approve this leave request' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				requirements: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Manager role required for approval',
						'Must be direct line manager of employee',
						'Leave amount exceeds approval authority limit'
					]
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Cannot approve due to business rules',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request cannot be approved due to policy violations' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				violations: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Insufficient leave balance (requires 14 days, employee has 10)',
						'Team capacity exceeded (50% of team already on leave)',
						'Blackout period restriction (no leave during December)'
					]
				}
			}
		}
	})
	approve(@Param('ref') ref: number, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;
		const approverUid = req.user?.uid;

		return this.leaveService.approveLeave(ref, approverUid, orgId, branchId, userId);
	}

	@Patch(':ref/reject')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '❌ Reject leave request with detailed reasoning',
		description: `
# Leave Request Rejection System

Processes leave request rejections with comprehensive feedback and alternative suggestions.

## 🔄 **Rejection Workflow**
- **Detailed Reasoning**: Mandatory detailed rejection reasons
- **Alternative Suggestions**: Propose alternative dates or solutions
- **Policy References**: Link rejections to specific policy violations
- **Constructive Feedback**: Guidance for future leave requests
- **Escalation Options**: Information about appeal processes

## 📋 **Common Rejection Reasons**
- **Business Needs**: Critical business periods or staffing requirements
- **Policy Violations**: Non-compliance with leave policies
- **Insufficient Balance**: Inadequate leave balance for request
- **Team Capacity**: Excessive team absence during requested period
- **Documentation**: Missing or inadequate supporting documentation

## 🔔 **Post-Rejection Process**
- **Employee Notification**: Detailed rejection communication
- **Alternative Proposals**: Suggest alternative dates or arrangements
- **Policy Guidance**: Clear explanation of policy requirements
- **Appeal Information**: Process for challenging rejection decisions
- **Future Planning**: Guidance for successful future requests

## 📊 **Analytics & Tracking**
- **Rejection Patterns**: Track common rejection reasons
- **Manager Analytics**: Approval vs rejection rates by manager
- **Policy Impact**: Monitor policy effectiveness
- **Employee Feedback**: Collect feedback on rejection experiences
- **Process Improvement**: Identify areas for workflow enhancement
		`,
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Leave request unique reference ID',
		type: 'number',
		example: 12345
	})
	@ApiBody({
		description: 'Rejection details with mandatory reasoning',
		schema: {
			type: 'object',
			properties: {
				rejectionReason: { 
					type: 'string', 
					example: 'Unable to approve due to critical project deadlines during requested period',
					description: 'Detailed reason for rejection (mandatory)'
				},
				policyReference: {
					type: 'string',
					example: 'Leave Policy Section 4.2 - Business Critical Periods',
					description: 'Reference to specific policy if applicable'
				},
				alternativeSuggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Consider taking leave the following week (July 22-29)',
						'Apply for partial leave (3 days instead of 14)',
						'Coordinate with team for coverage arrangement'
					],
					description: 'Suggested alternatives or solutions'
				},
				appealProcess: {
					type: 'boolean',
					example: true,
					description: 'Inform employee about appeal options'
				},
				followUpRequired: {
					type: 'boolean',
					example: false,
					description: 'Whether follow-up discussion is needed'
				}
			},
			required: ['rejectionReason'],
		},
	})
	@ApiOkResponse({
		description: '✅ Leave request rejected with detailed feedback',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request rejected with detailed feedback provided' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						leaveRef: { type: 'string', example: 'LV-2024-001' },
						status: { type: 'string', example: 'REJECTED' },
						rejectedDate: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						rejectedBy: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 67890 },
								name: { type: 'string', example: 'Jane Manager' },
								email: { type: 'string', example: 'jane.manager@company.com' },
								role: { type: 'string', example: 'LINE_MANAGER' }
							}
						},
						rejectionDetails: {
							type: 'object',
							properties: {
								reason: { type: 'string', example: 'Unable to approve due to critical project deadlines during requested period' },
								policyReference: { type: 'string', example: 'Leave Policy Section 4.2 - Business Critical Periods' },
								alternatives: {
									type: 'array',
									items: { type: 'string' },
									example: [
										'Consider taking leave the following week (July 22-29)',
										'Apply for partial leave (3 days instead of 14)'
									]
								}
							}
						},
						employeeFeedback: {
							type: 'object',
							properties: {
								notificationSent: { type: 'boolean', example: true },
								appealOptionsProvided: { type: 'boolean', example: true },
								alternativesOffered: { type: 'boolean', example: true },
								followUpScheduled: { type: 'boolean', example: false }
							}
						},
						nextSteps: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Employee will receive detailed rejection notification',
								'Appeal process information has been provided',
								'Alternative date suggestions included in communication',
								'Leave balance remains unchanged'
							]
						}
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Leave request not found for rejection',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found or already processed' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient rejection authority',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have authority to reject this leave request' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid rejection data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Rejection reason is required and must be detailed' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				requirements: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Rejection reason must be at least 20 characters',
						'Must provide constructive feedback',
						'Policy reference recommended for policy-based rejections'
					]
				}
			}
		}
	})
	reject(@Param('ref') ref: number, @Body() body: { rejectionReason: string }, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.rejectLeave(ref, body.rejectionReason, orgId, branchId, userId);
	}

	@Patch(':ref/cancel')
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
		summary: '🚫 Cancel leave request',
		description: `
# Leave Request Cancellation System

Enables flexible cancellation of leave requests with proper workflow management and balance restoration.

## 🔄 **Cancellation Process**
- **Self-Service Cancellation**: Employees can cancel their own pending/approved requests
- **Manager Cancellation**: Managers can cancel team member requests when necessary
- **Emergency Cancellation**: Fast-track cancellation for urgent business needs
- **Partial Cancellation**: Cancel specific days from multi-day leave requests
- **Automatic Notifications**: Immediate notifications to all stakeholders

## ⚠️ **Cancellation Rules**
- **Timing Restrictions**: May be restricted based on proximity to leave start date
- **Status Dependent**: Different rules for pending vs approved requests
- **Policy Compliance**: Must adhere to cancellation policies and notice periods
- **Financial Impact**: Automatic handling of paid time off and benefits
- **Team Coordination**: Automatic notification to covering team members

## 🔔 **Post-Cancellation Actions**
- **Balance Restoration**: Automatic restoration of leave balance
- **Calendar Updates**: Remove calendar events and blocks
- **Team Notifications**: Alert team members of changed coverage arrangements
- **Documentation**: Generate cancellation records for audit trails
- **Workflow Reset**: Clear approval workflows and reset request status
		`,
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Leave request unique reference ID',
		type: 'number',
		example: 12345
	})
	@ApiBody({
		description: 'Cancellation details with mandatory reasoning',
		schema: {
			type: 'object',
			properties: {
				cancellationReason: { 
					type: 'string', 
					example: 'Project deadline moved up - need to be available for critical deliverables',
					description: 'Detailed reason for cancellation (mandatory)'
				},
				urgentCancellation: {
					type: 'boolean',
					example: false,
					description: 'Whether this is an urgent cancellation requiring immediate processing'
				},
				notifyTeam: {
					type: 'boolean',
					example: true,
					description: 'Whether to notify team members about the cancellation'
				},
				refundBalance: {
					type: 'boolean',
					example: true,
					description: 'Whether to restore leave balance (default: true)'
				}
			},
			required: ['cancellationReason'],
		},
	})
	@ApiOkResponse({
		description: '✅ Leave request cancelled successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request cancelled successfully' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						leaveRef: { type: 'string', example: 'LV-2024-001' },
						status: { type: 'string', example: 'CANCELLED' },
						cancelledDate: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						cancelledBy: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 54321 },
								name: { type: 'string', example: 'John Doe' },
								email: { type: 'string', example: 'john.doe@company.com' },
								role: { type: 'string', example: 'EMPLOYEE' }
							}
						},
						cancellationDetails: {
							type: 'object',
							properties: {
								reason: { type: 'string', example: 'Project deadline moved up - need to be available for critical deliverables' },
								urgent: { type: 'boolean', example: false },
								daysBeforeStart: { type: 'number', example: 15 }
							}
						},
						balanceImpact: {
							type: 'object',
							properties: {
								restoredDays: { type: 'number', example: 14 },
								previousBalance: { type: 'number', example: 11 },
								newBalance: { type: 'number', example: 25 }
							}
						},
						notifications: {
							type: 'object',
							properties: {
								employeeNotified: { type: 'boolean', example: true },
								managerNotified: { type: 'boolean', example: true },
								teamNotified: { type: 'boolean', example: true },
								hrNotified: { type: 'boolean', example: true },
								calendarUpdated: { type: 'boolean', example: true }
							}
						}
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Leave request not found for cancellation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found or cannot be cancelled' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Cannot cancel leave request',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to cancel this leave request' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Cannot cancel due to timing or status restrictions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request cannot be cancelled due to timing restrictions' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				restrictions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Cannot cancel leave that has already started',
						'Minimum 24 hours notice required for cancellation',
						'Leave request is already completed'
					]
				}
			}
		}
	})
	cancel(@Param('ref') ref: number, @Body() body: { cancellationReason: string }, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.cancelLeave(ref, body.cancellationReason, userId, orgId, branchId);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🗑️ Safely delete leave request',
		description: `
# Leave Request Safe Deletion System

Provides secure and auditable removal of leave requests with comprehensive safety checks and data preservation.

## 🔒 **Safe Deletion Process**
- **Soft Deletion**: Data marked as deleted but preserved for audit
- **Reversible Action**: Deletion can be undone if needed
- **Audit Trail**: Complete deletion audit trail maintained
- **Data Preservation**: Original data maintained for compliance
- **Administrative Override**: Requires elevated permissions

## 🔄 **Deletion Workflow**
- **Pre-deletion Validation**: Comprehensive safety checks
- **Status Verification**: Ensure request can be safely deleted
- **Impact Assessment**: Evaluate deletion impact on workflows
- **Stakeholder Notification**: Inform relevant parties
- **Recovery Options**: Maintain ability to restore if needed

## 📋 **Deletion Restrictions**
- **Status Dependent**: Different rules for different request statuses
- **Financial Impact**: Special handling for leave with financial implications
- **Audit Requirements**: Cannot delete leave under audit/investigation
- **Legal Hold**: Cannot delete leave subject to legal proceedings
- **System Integrity**: Maintain referential integrity

## 🎯 **Common Use Cases**
- **Erroneous Requests**: Remove requests created by mistake
- **Duplicate Entries**: Clean up duplicate leave requests
- **Administrative Cleanup**: Remove test or invalid requests
- **Data Maintenance**: Periodic cleanup of old/invalid data
- **Compliance**: Meet data management policy requirements
		`,
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Leave request unique reference ID',
		type: 'number',
		example: 12345
	})
	@ApiBody({
		description: 'Deletion confirmation and justification',
		required: true,
		schema: {
			type: 'object',
			properties: {
				deletionReason: { 
					type: 'string', 
					example: 'Duplicate request created by error - original request LV-2024-002 is valid',
					description: 'Mandatory detailed reason for deletion'
				},
				confirmDeletion: {
					type: 'boolean',
					example: true,
					description: 'Explicit confirmation of deletion intent (required)'
				},
				preserveAudit: {
					type: 'boolean',
					example: true,
					description: 'Whether to preserve audit trail (default: true)'
				},
				notifyStakeholders: {
					type: 'boolean',
					example: false,
					description: 'Whether to notify affected stakeholders'
				}
			},
			required: ['deletionReason', 'confirmDeletion'],
		},
	})
	@ApiOkResponse({
		description: '✅ Leave request deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request deleted successfully with audit trail preserved' },
				data: {
					type: 'object',
					properties: {
						deletedRef: { type: 'string', example: 'LV-2024-001' },
						deletedUid: { type: 'number', example: 12345 },
						deletionDate: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						deletedBy: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 67890 },
								name: { type: 'string', example: 'Admin User' },
								email: { type: 'string', example: 'admin@company.com' },
								role: { type: 'string', example: 'ADMIN' }
							}
						},
						deletionDetails: {
							type: 'object',
							properties: {
								reason: { type: 'string', example: 'Duplicate request created by error - original request LV-2024-002 is valid' },
								softDelete: { type: 'boolean', example: true },
								auditPreserved: { type: 'boolean', example: true },
								recoverable: { type: 'boolean', example: true }
							}
						},
						originalData: {
							type: 'object',
							properties: {
								employeeName: { type: 'string', example: 'John Doe' },
								leaveType: { type: 'string', example: 'ANNUAL' },
								startDate: { type: 'string', format: 'date', example: '2024-07-15' },
								endDate: { type: 'string', format: 'date', example: '2024-07-29' },
								duration: { type: 'number', example: 14 },
								status: { type: 'string', example: 'PENDING' }
							}
						},
						recoveryInfo: {
							type: 'object',
							properties: {
								recoveryPeriod: { type: 'string', example: '30 days' },
								recoveryProcess: { type: 'string', example: 'Contact admin with reference ID for recovery' },
								auditTrailId: { type: 'string', example: 'AUD-DEL-2023-12-001' }
							}
						}
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Leave request not found for deletion',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found or already deleted' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient deletion authority',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have authority to delete leave requests' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Cannot delete due to business rules',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request cannot be deleted due to business rule violations' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				restrictions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Cannot delete approved leave requests',
						'Cannot delete leave in progress',
						'Cannot delete leave with payroll implications'
					]
				}
			}
		}
	})
	remove(@Param('ref') ref: number, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.remove(ref, orgId, branchId, userId);
	}
}
