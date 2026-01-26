import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Request } from '@nestjs/common';
import { WarningsService } from './warnings.service';
import { CreateWarningDto } from './dto/create-warning.dto';
import { UpdateWarningDto } from './dto/update-warning.dto';
import {
	ApiTags,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiForbiddenResponse,
	ApiInternalServerErrorResponse,
	ApiBearerAuth,
	ApiConsumes,
	ApiProduces,
	ApiBody
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { Warning, WarningStatus, WarningSeverity } from './entities/warning.entity';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('⚠️ Warnings & Disciplinary Management')
@Controller('warnings')
@UseGuards(ClerkAuthGuard, RoleGuard)
@EnterpriseOnly('warnings')
@ApiBearerAuth('JWT-auth')
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
@ApiForbiddenResponse({ 
	description: '🚫 Forbidden - Insufficient permissions for warnings management',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Insufficient permissions to manage warnings' },
			error: { type: 'string', example: 'Forbidden' },
			statusCode: { type: 'number', example: 403 }
		}
	}
})
export class WarningsController {
	constructor(private readonly warningsService: WarningsService) {}

	@Post()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ 
		summary: '📝 Issue a formal employee warning with comprehensive tracking',
		description: `
# ⚠️ Employee Warning System

Issue formal warnings to employees with comprehensive tracking, automated notifications, and complete audit trails for HR compliance and performance management.

## 🎯 **Core Purpose**
- **Performance Management**: Address performance issues with formal documentation
- **Disciplinary Actions**: Structured approach to employee discipline and improvement
- **Legal Compliance**: Maintain proper documentation for labor law requirements
- **Progressive Discipline**: Support for escalating disciplinary measures
- **HR Automation**: Streamlined warning process with automated notifications

## 📋 **Warning Categories**
- **🎯 Performance Issues**: Productivity, quality, or goal achievement concerns
- **🕐 Attendance Problems**: Tardiness, absenteeism, or scheduling violations
- **👔 Conduct Violations**: Inappropriate behavior, policy breaches, or misconduct
- **🔒 Safety Infractions**: Safety protocol violations or workplace hazards
- **💼 Policy Breaches**: Company policy violations or procedural non-compliance
- **🤝 Professional Standards**: Communication, teamwork, or professionalism issues

## 🔧 **System Features**
- **Severity Levels**: LOW, MEDIUM, HIGH, CRITICAL classification system
- **Automated Notifications**: Email alerts to employees and supervisors
- **Expiration Tracking**: Automatic warning expiry based on company policy
- **Progressive Discipline**: Track warning escalation and patterns
- **Documentation**: Complete audit trail for legal and HR purposes
- **Integration**: Links to performance reviews and HR records

## 📊 **Compliance & Reporting**
- **Labor Law Compliance**: Structured documentation meeting legal requirements
- **HR Analytics**: Warning trends, patterns, and departmental insights
- **Performance Correlation**: Link warnings to performance review cycles
- **Escalation Tracking**: Monitor progressive discipline pathways
- **Audit Support**: Complete records for internal and external audits

## 🔔 **Notification System**
- **Employee Alerts**: Immediate notification to warned employee
- **Supervisor Updates**: Automatic updates to management hierarchy
- **HR Dashboard**: Central monitoring for HR team
- **Reminder System**: Automated follow-ups and review schedules
- **Escalation Alerts**: Notifications when warning patterns emerge
		`
	})
	@ApiBody({ 
		type: CreateWarningDto,
		description: 'Warning issuance details with comprehensive documentation',
		examples: {
			performance: {
				summary: '🎯 Performance Warning',
				description: 'Issue a performance-related warning with improvement plan',
				value: {
					owner: { uid: 123 },
					issuedBy: { uid: 456 },
					reason: 'Consistent failure to meet quarterly sales targets. Performance has been below expectations for the past three months.',
					severity: 'MEDIUM',
					expiresAt: '2024-06-01T23:59:59Z',
					status: 'ACTIVE',
					category: 'PERFORMANCE',
					improvementPlan: 'Employee must complete sales training and achieve 85% of quota for next two quarters',
					followUpDate: '2024-03-01T00:00:00Z'
				}
			},
			attendance: {
				summary: '🕐 Attendance Warning',
				description: 'Issue an attendance-related warning for tardiness patterns',
				value: {
					owner: { uid: 789 },
					issuedBy: { uid: 456 },
					reason: 'Excessive tardiness: Late to work 8 times in the past month without valid justification.',
					severity: 'LOW',
					expiresAt: '2024-03-01T23:59:59Z',
					status: 'ACTIVE',
					category: 'ATTENDANCE',
					previousWarnings: 0,
					actionRequired: 'Improve punctuality and maintain consistent arrival times'
				}
			},
			conduct: {
				summary: '👔 Conduct Warning',
				description: 'Issue a conduct warning for policy violations',
				value: {
					owner: { uid: 321 },
					issuedBy: { uid: 654 },
					reason: 'Inappropriate behavior during team meetings, including interrupting colleagues and using unprofessional language.',
					severity: 'HIGH',
					expiresAt: '2024-12-01T23:59:59Z',
					status: 'ACTIVE',
					category: 'CONDUCT',
					witnessReports: true,
					disciplinaryMeeting: '2023-12-15T14:00:00Z'
				}
			},
			safety: {
				summary: '🔒 Safety Warning',
				description: 'Issue a safety-related warning for protocol violations',
				value: {
					owner: { uid: 555 },
					issuedBy: { uid: 666 },
					reason: 'Failure to wear required personal protective equipment in designated safety zones.',
					severity: 'CRITICAL',
					expiresAt: '2025-12-01T23:59:59Z',
					status: 'ACTIVE',
					category: 'SAFETY',
					immediateAction: 'Mandatory safety training completion within 48 hours',
					safetyOfficerNotified: true
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Warning successfully issued and documented',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'Warning successfully issued and documented' },
				data: {
					type: 'object',
					properties: {
						warning: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								reason: { type: 'string', example: 'Consistent failure to meet performance targets' },
								severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], example: 'MEDIUM' },
								status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUPERSEDED'], example: 'ACTIVE' },
								issuedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								expiresAt: { type: 'string', format: 'date-time', example: '2024-06-01T23:59:59Z' },
								owner: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 123 },
										name: { type: 'string', example: 'John' },
										surname: { type: 'string', example: 'Doe' },
										email: { type: 'string', example: 'john.doe@company.com' },
										department: { type: 'string', example: 'Sales' }
									}
								},
								issuedBy: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 456 },
										name: { type: 'string', example: 'Jane' },
										surname: { type: 'string', example: 'Manager' },
										email: { type: 'string', example: 'jane.manager@company.com' },
										position: { type: 'string', example: 'Sales Manager' }
									}
								},
								warningNumber: { type: 'string', example: 'WRN-2023-001' },
								category: { type: 'string', example: 'PERFORMANCE' },
								daysUntilExpiry: { type: 'number', example: 182 }
							}
						},
						notifications: {
							type: 'object',
							properties: {
								employeeNotified: { type: 'boolean', example: true },
								supervisorNotified: { type: 'boolean', example: true },
								hrNotified: { type: 'boolean', example: true },
								notificationTimestamp: { type: 'string', format: 'date-time' }
							}
						},
						auditTrail: {
							type: 'object',
							properties: {
								actionId: { type: 'string', example: 'WARN-ACT-1701423600' },
								ipAddress: { type: 'string', example: '192.168.1.100' },
								userAgent: { type: 'string', example: 'Mozilla/5.0...' },
								timestamp: { type: 'string', format: 'date-time' }
							}
						}
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Invalid warning data or validation errors',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { 
					type: 'string',
					examples: [
						'Owner user is required',
						'Warning reason must be at least 10 characters',
						'Invalid severity level provided',
						'Expiry date must be in the future',
						'Employee not found in system',
						'Issuer lacks authority to issue warnings'
					]
				},
				errors: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							field: { type: 'string', example: 'reason' },
							message: { type: 'string', example: 'Reason must be at least 10 characters long' },
							code: { type: 'string', example: 'MIN_LENGTH_ERROR' }
						}
					}
				},
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({ 
		description: '💥 Internal server error during warning processing',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { 
					type: 'string', 
					examples: [
						'Database connection failed during warning creation',
						'Email notification system temporarily unavailable',
						'Audit logging service error',
						'User lookup service timeout'
					]
				},
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				reference: { type: 'string', example: 'ERR-WARN-1701423600' }
			}
		}
	})
	create(@Body() createWarningDto: CreateWarningDto, @Request() req: any) {
		const clerkUserId = req.user?.clerkUserId;
		return this.warningsService.create(createWarningDto, clerkUserId);
	}

	@Get()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ 
		summary: '📊 Retrieve comprehensive warnings with advanced filtering and analytics',
		description: `
# 📊 Warning Management Dashboard

Access comprehensive warning data with advanced filtering, search capabilities, and real-time analytics for effective HR management and compliance monitoring.

## 🔍 **Advanced Search & Filtering**
- **Status-based Filtering**: Active, expired, revoked, or superseded warnings
- **Severity Levels**: Filter by LOW, MEDIUM, HIGH, or CRITICAL warnings
- **Date Range Filtering**: Custom date ranges for issuance, expiry, or follow-up dates
- **Department Filtering**: Departmental and team-based warning analysis
- **Employee Filtering**: Individual employee warning history and patterns
- **Issuer Filtering**: Track warnings by issuing manager or HR personnel
- **Category Filtering**: Performance, attendance, conduct, safety, or policy warnings

## 📈 **Analytics & Insights**
- **Trend Analysis**: Warning patterns and frequency over time
- **Department Metrics**: Departmental warning statistics and comparisons
- **Severity Distribution**: Breakdown of warning types and escalation patterns
- **Compliance Tracking**: Monitor policy adherence and improvement trends
- **Performance Correlation**: Link warnings to performance review outcomes
- **Predictive Analytics**: Identify potential escalation risks and intervention points

## 📋 **Comprehensive Data**
- **Employee Information**: Complete employee details and organizational context
- **Warning Details**: Full warning documentation with attachments and notes
- **Timeline Tracking**: Issuance, acknowledgment, and resolution timelines
- **Follow-up Status**: Track improvement plans and corrective actions
- **Escalation History**: Progressive discipline tracking and outcomes
- **Legal Documentation**: Compliance-ready documentation for audits

## 🎯 **Management Tools**
- **Bulk Operations**: Mass actions for warning management and updates
- **Export Capabilities**: Generate reports for management and compliance
- **Notification Management**: Control alert preferences and escalation rules
- **Template Library**: Standardized warning templates for consistency
- **Approval Workflows**: Multi-stage approval for high-severity warnings
		`
	})
	@ApiQuery({ 
		name: 'status', 
		enum: WarningStatus, 
		required: false, 
		description: 'Filter warnings by current status (ACTIVE, EXPIRED, REVOKED, SUPERSEDED)',
		example: 'ACTIVE'
	})
	@ApiQuery({ 
		name: 'severity', 
		enum: WarningSeverity, 
		required: false, 
		description: 'Filter warnings by severity level (LOW, MEDIUM, HIGH, CRITICAL)',
		example: 'MEDIUM'
	})
	@ApiQuery({ 
		name: 'ownerId', 
		type: Number, 
		required: false, 
		description: 'Filter warnings for specific employee by user ID',
		example: 123
	})
	@ApiQuery({ 
		name: 'issuerId', 
		type: Number, 
		required: false, 
		description: 'Filter warnings issued by specific manager/HR personnel',
		example: 456
	})
	@ApiQuery({ 
		name: 'isExpired', 
		type: Boolean, 
		required: false, 
		description: 'Filter by expiration status (true for expired, false for active)',
		example: false
	})
	@ApiQuery({ 
		name: 'startDate', 
		type: String, 
		required: false, 
		description: 'Filter warnings issued after this date (ISO 8601 format)',
		example: '2023-01-01T00:00:00Z'
	})
	@ApiQuery({ 
		name: 'endDate', 
		type: String, 
		required: false, 
		description: 'Filter warnings issued before this date (ISO 8601 format)',
		example: '2023-12-31T23:59:59Z'
	})
	@ApiQuery({ 
		name: 'department', 
		type: String, 
		required: false, 
		description: 'Filter warnings by employee department',
		example: 'Sales'
	})
	@ApiQuery({ 
		name: 'category', 
		type: String, 
		required: false, 
		description: 'Filter warnings by category (PERFORMANCE, ATTENDANCE, CONDUCT, SAFETY, POLICY)',
		example: 'PERFORMANCE'
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
		description: 'Number of warnings per page (max 100)',
		example: 20
	})
	@ApiQuery({
		name: 'sortBy',
		type: String,
		required: false,
		description: 'Sort field: issuedAt, severity, status, expiresAt',
		example: 'issuedAt'
	})
	@ApiQuery({
		name: 'sortOrder',
		type: String,
		required: false,
		description: 'Sort order: ASC or DESC',
		example: 'DESC'
	})
	@ApiOkResponse({
		description: '✅ Warnings retrieved successfully with comprehensive data and analytics',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				data: {
					type: 'object',
					properties: {
						warnings: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 123 },
									reason: { type: 'string', example: 'Persistent tardiness affecting team productivity' },
									severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], example: 'MEDIUM' },
									status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUPERSEDED'], example: 'ACTIVE' },
									issuedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
									expiresAt: { type: 'string', format: 'date-time', example: '2024-06-01T23:59:59Z' },
									isExpired: { type: 'boolean', example: false },
									daysUntilExpiry: { type: 'number', example: 182 },
									owner: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 789 },
											name: { type: 'string', example: 'John' },
											surname: { type: 'string', example: 'Doe' },
											email: { type: 'string', example: 'john.doe@company.com' },
											department: { type: 'string', example: 'Sales' },
											position: { type: 'string', example: 'Sales Representative' }
										}
									},
									issuedBy: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 456 },
											name: { type: 'string', example: 'Jane' },
											surname: { type: 'string', example: 'Manager' },
											email: { type: 'string', example: 'jane.manager@company.com' },
											position: { type: 'string', example: 'Sales Manager' }
										}
									},
									warningNumber: { type: 'string', example: 'WRN-2023-001' },
									category: { type: 'string', example: 'ATTENDANCE' },
									acknowledgmentDate: { type: 'string', format: 'date-time', nullable: true },
									followUpDate: { type: 'string', format: 'date-time', nullable: true },
									improvementPlan: { type: 'string', nullable: true },
									relatedWarnings: { type: 'number', example: 2, description: 'Count of related warnings for this employee' }
								}
							}
						},
						pagination: {
							type: 'object',
							properties: {
								total: { type: 'number', example: 150, description: 'Total number of warnings matching filters' },
								page: { type: 'number', example: 1, description: 'Current page number' },
								limit: { type: 'number', example: 20, description: 'Number of items per page' },
								totalPages: { type: 'number', example: 8, description: 'Total number of pages' },
								hasNext: { type: 'boolean', example: true, description: 'Whether next page exists' },
								hasPrev: { type: 'boolean', example: false, description: 'Whether previous page exists' }
							}
						},
						analytics: {
							type: 'object',
							properties: {
								totalWarnings: { type: 'number', example: 150 },
								activeWarnings: { type: 'number', example: 87 },
								expiredWarnings: { type: 'number', example: 45 },
								severityBreakdown: {
									type: 'object',
									properties: {
										LOW: { type: 'number', example: 60 },
										MEDIUM: { type: 'number', example: 55 },
										HIGH: { type: 'number', example: 25 },
										CRITICAL: { type: 'number', example: 10 }
									}
								},
								categoryBreakdown: {
									type: 'object',
									properties: {
										PERFORMANCE: { type: 'number', example: 45 },
										ATTENDANCE: { type: 'number', example: 40 },
										CONDUCT: { type: 'number', example: 35 },
										SAFETY: { type: 'number', example: 20 },
										POLICY: { type: 'number', example: 10 }
									}
								},
								departmentStats: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											department: { type: 'string', example: 'Sales' },
											count: { type: 'number', example: 25 },
											percentage: { type: 'number', example: 16.7 }
										}
									}
								},
								trends: {
									type: 'object',
									properties: {
										thisMonth: { type: 'number', example: 12 },
										lastMonth: { type: 'number', example: 8 },
										percentageChange: { type: 'number', example: 50.0 }
									}
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Warnings retrieved successfully with analytics' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	findAll(
		@Query('status') status?: WarningStatus,
		@Query('severity') severity?: WarningSeverity,
		@Query('ownerId') ownerId?: number,
		@Query('issuerId') issuerId?: number,
		@Query('isExpired') isExpired?: string,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('department') department?: string,
		@Query('category') category?: string,
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Query('sortBy') sortBy?: string,
		@Query('sortOrder') sortOrder?: string,
	) {
		const filters: any = {};
		if (status) filters.status = status;
		if (severity) filters.severity = severity;
		if (ownerId) filters.ownerId = +ownerId;
		if (issuerId) filters.issuerId = +issuerId;
		if (isExpired !== undefined) filters.isExpired = isExpired === 'true';
		if (startDate) filters.startDate = new Date(startDate);
		if (endDate) filters.endDate = new Date(endDate);
		if (department) filters.department = department;
		if (category) filters.category = category;
		if (sortBy) filters.sortBy = sortBy;
		if (sortOrder) filters.sortOrder = sortOrder;

		return this.warningsService.findAll(
			filters,
			page ? parseInt(page, 10) : 1,
			limit ? parseInt(limit, 10) : Number(process.env.DEFAULT_PAGE_LIMIT || 10),
		);
	}

	@Get(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ 
		summary: '🔍 Get detailed warning information with complete audit trail',
		description: `
# 🔍 Detailed Warning Information

Retrieve comprehensive details about a specific warning including complete documentation, audit trail, related actions, and compliance information.

## 📋 **Complete Documentation**
- **Warning Details**: Full warning documentation with all supporting information
- **Employee Information**: Complete employee profile and organizational context
- **Issuer Information**: Details about the manager or HR personnel who issued the warning
- **Timeline Data**: Detailed timestamps for all warning-related activities
- **Compliance Records**: Documentation for legal and audit requirements

## 🔍 **Audit Trail**
- **Action History**: Complete log of all actions taken on the warning
- **Status Changes**: Track all status modifications with timestamps and reasons
- **Acknowledgments**: Employee acknowledgment status and timestamps
- **Follow-up Actions**: Record of improvement plans and progress tracking
- **Related Incidents**: Links to related warnings, incidents, or disciplinary actions

## 📊 **Analytics & Context**
- **Pattern Analysis**: Employee warning history and patterns
- **Performance Correlation**: Links to performance reviews and outcomes
- **Escalation Path**: Progressive discipline tracking and next steps
- **Compliance Status**: Legal and policy compliance verification
- **Impact Assessment**: Effect on employee status and progression
		`
	})
	@ApiParam({
		name: 'ref',
		description: 'Unique warning identifier (UID)',
		example: 123,
		schema: { type: 'number' }
	})
	@ApiOkResponse({
		description: '✅ Warning details retrieved successfully with complete information',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				data: {
					type: 'object',
					properties: {
						warning: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								warningNumber: { type: 'string', example: 'WRN-2023-001' },
								reason: { type: 'string', example: 'Persistent tardiness affecting team productivity and missing important meetings' },
								severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], example: 'MEDIUM' },
								status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUPERSEDED'], example: 'ACTIVE' },
								category: { type: 'string', example: 'ATTENDANCE' },
								issuedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								expiresAt: { type: 'string', format: 'date-time', example: '2024-06-01T23:59:59Z' },
								isExpired: { type: 'boolean', example: false },
								daysUntilExpiry: { type: 'number', example: 182 },
								acknowledgmentDate: { type: 'string', format: 'date-time', nullable: true },
								improvementPlan: { type: 'string', nullable: true, example: 'Employee must maintain 95% attendance rate for next 6 months' },
								followUpDate: { type: 'string', format: 'date-time', nullable: true },
								nextReviewDate: { type: 'string', format: 'date-time', nullable: true },
								attachments: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											fileName: { type: 'string', example: 'attendance_report.pdf' },
											url: { type: 'string', example: 'https://storage.loro.co.za/warnings/attachments/file.pdf' },
											uploadedAt: { type: 'string', format: 'date-time' }
										}
									}
								}
							}
						},
						employee: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 789 },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
								email: { type: 'string', example: 'john.doe@company.com' },
								employeeId: { type: 'string', example: 'EMP-2023-001' },
								department: { type: 'string', example: 'Sales' },
								position: { type: 'string', example: 'Sales Representative' },
								hireDate: { type: 'string', format: 'date-time' },
								manager: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 456 },
										name: { type: 'string', example: 'Jane Manager' },
										email: { type: 'string', example: 'jane.manager@company.com' }
									}
								},
								warningHistory: {
									type: 'object',
									properties: {
										totalWarnings: { type: 'number', example: 3 },
										activeWarnings: { type: 'number', example: 1 },
										lastWarningDate: { type: 'string', format: 'date-time' },
										warningProgression: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													date: { type: 'string', format: 'date-time' },
													severity: { type: 'string', example: 'LOW' },
													category: { type: 'string', example: 'ATTENDANCE' },
													status: { type: 'string', example: 'EXPIRED' }
												}
											}
										}
									}
								}
							}
						},
						issuer: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456 },
								name: { type: 'string', example: 'Jane' },
								surname: { type: 'string', example: 'Manager' },
								email: { type: 'string', example: 'jane.manager@company.com' },
								position: { type: 'string', example: 'Sales Manager' },
								department: { type: 'string', example: 'Sales' },
								authority: { type: 'string', example: 'MANAGER' }
							}
						},
						auditTrail: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									action: { type: 'string', example: 'WARNING_ISSUED' },
									timestamp: { type: 'string', format: 'date-time' },
									performedBy: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 456 },
											name: { type: 'string', example: 'Jane Manager' },
											email: { type: 'string', example: 'jane.manager@company.com' }
										}
									},
									details: { type: 'string', example: 'Warning issued for attendance violations' },
									ipAddress: { type: 'string', example: '192.168.1.100' },
									userAgent: { type: 'string', example: 'Mozilla/5.0...' }
								}
							}
						},
						compliance: {
							type: 'object',
							properties: {
								legalRequirementsMet: { type: 'boolean', example: true },
								documentationComplete: { type: 'boolean', example: true },
								employeeNotified: { type: 'boolean', example: true },
								managerApproved: { type: 'boolean', example: true },
								hrReviewed: { type: 'boolean', example: true },
								retentionPeriod: { type: 'string', example: '7 years' },
								nextAction: { type: 'string', example: 'Follow-up meeting scheduled' }
							}
						}
					}
				},
				message: { type: 'string', example: 'Warning details retrieved successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiNotFoundResponse({ 
		description: '❌ Warning not found or access denied',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Warning not found or you do not have permission to view it' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	findOne(@Param('ref') ref: string) {
		return this.warningsService.findOne(+ref);
	}

	@Get('user/:ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ 
		summary: '👤 Get comprehensive warning history for a specific employee',
		description: `
# 👤 Employee Warning History & Analysis

Retrieve complete warning history for a specific employee with comprehensive analytics, pattern analysis, and progression tracking for effective performance management.

## 📊 **Comprehensive History**
- **Complete Record**: All warnings issued to the employee regardless of status
- **Chronological Timeline**: Detailed timeline of warning progression and outcomes
- **Category Analysis**: Breakdown of warning types and recurring issues
- **Severity Progression**: Track escalation patterns and improvement trends
- **Resolution Tracking**: Monitor improvement plans and corrective action outcomes

## 🔍 **Pattern Analysis**
- **Recurring Issues**: Identify patterns in warning categories and timing
- **Seasonal Trends**: Analyze warning frequency across different time periods
- **Improvement Indicators**: Track positive trends and behavioral changes
- **Risk Assessment**: Evaluate potential for future issues and interventions
- **Performance Correlation**: Link warnings to performance review outcomes

## 📈 **Management Insights**
- **Intervention Opportunities**: Identify optimal times for support and coaching
- **Resource Allocation**: Determine training and development needs
- **Escalation Planning**: Prepare for progressive disciplinary measures
- **Success Metrics**: Measure effectiveness of improvement plans
- **Compliance Monitoring**: Ensure proper documentation for legal requirements
		`
	})
	@ApiParam({
		name: 'ref',
		description: 'Employee user ID to retrieve warning history for (string)',
		example: '123',
		schema: { type: 'string' }
	})
	@ApiOkResponse({
		description: '✅ Employee warning history retrieved successfully with comprehensive analytics',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				data: {
					type: 'object',
					properties: {
						employee: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
								email: { type: 'string', example: 'john.doe@company.com' },
								employeeId: { type: 'string', example: 'EMP-2023-001' },
								department: { type: 'string', example: 'Sales' },
								position: { type: 'string', example: 'Sales Representative' },
								hireDate: { type: 'string', format: 'date-time' },
								currentStatus: { type: 'string', example: 'ACTIVE' }
							}
						},
						warnings: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 123 },
									warningNumber: { type: 'string', example: 'WRN-2023-001' },
									reason: { type: 'string', example: 'Persistent tardiness affecting team productivity' },
									severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], example: 'MEDIUM' },
									status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUPERSEDED'], example: 'ACTIVE' },
									category: { type: 'string', example: 'ATTENDANCE' },
									issuedAt: { type: 'string', format: 'date-time' },
									expiresAt: { type: 'string', format: 'date-time' },
									isExpired: { type: 'boolean', example: false },
									issuedBy: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 456 },
											name: { type: 'string', example: 'Jane Manager' },
											email: { type: 'string', example: 'jane.manager@company.com' }
										}
									},
									improvementPlan: { type: 'string', nullable: true },
									outcomeStatus: { type: 'string', example: 'IMPROVEMENT_SHOWN' },
									followUpCompleted: { type: 'boolean', example: true }
								}
							}
						},
						analytics: {
							type: 'object',
							properties: {
								summary: {
									type: 'object',
									properties: {
										totalWarnings: { type: 'number', example: 5 },
										activeWarnings: { type: 'number', example: 1 },
										expiredWarnings: { type: 'number', example: 3 },
										revokedWarnings: { type: 'number', example: 1 },
										averageWarningsPerYear: { type: 'number', example: 2.5 },
										daysSinceLastWarning: { type: 'number', example: 45 }
									}
								},
								categoryBreakdown: {
									type: 'object',
									properties: {
										PERFORMANCE: { type: 'number', example: 2 },
										ATTENDANCE: { type: 'number', example: 2 },
										CONDUCT: { type: 'number', example: 1 },
										SAFETY: { type: 'number', example: 0 },
										POLICY: { type: 'number', example: 0 }
									}
								},
								severityProgression: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											date: { type: 'string', format: 'date-time' },
											severity: { type: 'string', example: 'LOW' },
											trend: { type: 'string', example: 'ESCALATING' }
										}
									}
								},
								patterns: {
									type: 'object',
									properties: {
										mostCommonCategory: { type: 'string', example: 'ATTENDANCE' },
										averageTimeBetweenWarnings: { type: 'number', example: 120, description: 'Days' },
										improvementTrend: { type: 'string', enum: ['IMPROVING', 'STABLE', 'DECLINING'], example: 'IMPROVING' },
										riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], example: 'MEDIUM' }
									}
								},
								recommendations: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											type: { type: 'string', example: 'TRAINING' },
											description: { type: 'string', example: 'Recommend time management training' },
											priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'], example: 'MEDIUM' }
										}
									}
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Employee warning history retrieved successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	getUserWarnings(@Param('ref') ref: string) {
		return this.warningsService.getUserWarnings(ref);
	}

	@Patch(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ 
		summary: '✏️ Update warning details with comprehensive audit tracking',
		description: `
# ✏️ Warning Update & Management

Update warning details including status changes, improvements, and administrative modifications with complete audit trail and compliance tracking.

## 🔄 **Update Capabilities**
- **Status Changes**: Modify warning status (activate, expire, revoke, supersede)
- **Improvement Tracking**: Update improvement plans and progress notes
- **Administrative Updates**: Correct details, add documentation, update timelines
- **Compliance Actions**: Record acknowledgments, follow-ups, and resolutions
- **Escalation Management**: Modify severity levels and escalation paths

## 📋 **Audit & Compliance**
- **Change Tracking**: Complete audit trail of all modifications
- **Authorization Verification**: Ensure proper permissions for changes
- **Legal Documentation**: Maintain compliance with labor regulations
- **Notification System**: Alert relevant parties of significant changes
- **Version Control**: Track document versions and revision history
		`
	})
	@ApiParam({
		name: 'ref',
		description: 'Warning ID to update',
		example: 123,
		schema: { type: 'number' }
	})
	@ApiBody({ 
		type: UpdateWarningDto,
		description: 'Warning update data with change justification',
		examples: {
			statusUpdate: {
				summary: 'Status Update',
				description: 'Update warning status with justification',
				value: {
					status: 'REVOKED',
					reason: 'Warning revoked due to procedural errors in initial issuance',
					updatedBy: { uid: 456 },
					effectiveDate: '2023-12-15T00:00:00Z'
				}
			},
			improvementUpdate: {
				summary: 'Improvement Plan Update',
				description: 'Update improvement plan and progress',
				value: {
					improvementPlan: 'Updated plan: Complete time management course and maintain 95% attendance',
					progressNotes: 'Employee showing significant improvement, attendance at 98% for past month',
					followUpDate: '2024-01-15T10:00:00Z'
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Warning updated successfully with audit trail',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'Warning updated successfully' },
				data: {
					type: 'object',
					properties: {
						warning: { $ref: '#/components/schemas/Warning' },
						changes: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									field: { type: 'string', example: 'status' },
									oldValue: { type: 'string', example: 'ACTIVE' },
									newValue: { type: 'string', example: 'REVOKED' },
									reason: { type: 'string', example: 'Procedural error correction' }
								}
							}
						},
						auditInfo: {
							type: 'object',
							properties: {
								updatedBy: { type: 'string', example: 'jane.manager@company.com' },
								updatedAt: { type: 'string', format: 'date-time' },
								ipAddress: { type: 'string', example: '192.168.1.100' },
								changeReference: { type: 'string', example: 'CHG-WARN-1701423600' }
							}
						}
					}
				}
			}
		}
	})
	update(@Param('ref') ref: string, @Body() updateWarningDto: UpdateWarningDto) {
		return this.warningsService.update(+ref, updateWarningDto);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({ 
		summary: '🗑️ Delete warning with comprehensive audit and compliance verification',
		description: `
# 🗑️ Warning Deletion & Archive Management

Permanently delete warning records with comprehensive audit trails, compliance verification, and data retention management for legal and organizational requirements.

## ⚠️ **Critical Considerations**
- **Legal Compliance**: Ensure deletion complies with labor law requirements
- **Audit Requirements**: Maintain audit trails even after deletion
- **Data Retention**: Consider organizational data retention policies
- **Employee Rights**: Verify employee consent or legal basis for deletion
- **System Integrity**: Ensure deletion doesn't impact related records

## 🔒 **Security & Authorization**
- **Administrative Only**: Restricted to admin and owner roles
- **Multi-step Verification**: Require explicit confirmation for deletion
- **Audit Logging**: Complete documentation of deletion activities
- **Backup Retention**: Secure archival of deleted records for compliance
- **Access Control**: Strict permission verification before deletion
		`
	})
	@ApiParam({
		name: 'ref',
		description: 'Warning ID to delete (admin/owner only)',
		example: 123,
		schema: { type: 'number' }
	})
	@ApiOkResponse({
		description: '✅ Warning deleted successfully with audit documentation',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'Warning deleted successfully with audit documentation' },
				data: {
					type: 'object',
					properties: {
						deletedWarning: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								warningNumber: { type: 'string', example: 'WRN-2023-001' },
								employeeName: { type: 'string', example: 'John Doe' },
								deletedAt: { type: 'string', format: 'date-time' }
							}
						},
						auditInfo: {
							type: 'object',
							properties: {
								deletedBy: { type: 'string', example: 'admin@company.com' },
								deletionReason: { type: 'string', example: 'Administrative correction' },
								backupLocation: { type: 'string', example: 'Archive-2023-001' },
								complianceVerified: { type: 'boolean', example: true }
							}
						}
					}
				}
			}
		}
	})
	remove(@Param('ref') ref: string) {
		return this.warningsService.remove(+ref);
	}
}
