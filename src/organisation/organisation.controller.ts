import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { OrganisationService } from './organisation.service';
import { CreateOrganisationDto } from './dto/create-organisation.dto';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';
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
	ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { AuthenticatedRequest, getClerkOrgId } from '../lib/interfaces/authenticated-request.interface';

@ApiTags('🏢 Organisation')
@Controller('org')
@UseGuards(ClerkAuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class OrganisationController {
	constructor(private readonly organisationService: OrganisationService) {}

	@Post()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '🏢 Create a new organisation',
		description: `
# Organization Creation System

Creates a comprehensive organization with advanced configuration options, integrated settings, and complete operational framework.

## 📋 **Core Features**
- **Complete Organization Setup**: Comprehensive organization profile with contact information
- **Multi-Branch Support**: Hierarchical structure supporting multiple branches and locations
- **Integrated Settings**: Automatic creation of organization settings and working hours
- **Asset Management**: Built-in support for organization assets and resource allocation
- **Product Catalog**: Integrated product management and inventory tracking
- **Client Management**: Customer relationship management and client assignment
- **User Management**: Employee management with role-based access control
- **Reseller Network**: Support for reseller partnerships and channel management

## 🎯 **Business Configuration**
- **Working Hours**: Configurable business hours for attendance tracking and scheduling
- **Time Zones**: Multi-timezone support for global operations
- **Holiday Calendars**: Custom holiday and non-working day management
- **Approval Workflows**: Configurable approval processes for various business operations
- **Notification Settings**: Customizable notification preferences and communication channels
- **Appearance Customization**: Branding and theme customization options

## 🔧 **Advanced Features**
- **Asset Tracking**: Complete asset lifecycle management and tracking
- **Leave Management**: Comprehensive leave policy configuration and tracking
- **Performance Management**: Built-in performance tracking and analytics
- **Reporting Framework**: Advanced reporting and business intelligence capabilities
- **Integration Support**: API-ready for external system integrations
- **Audit Trail**: Complete audit logging for compliance and security

## 🎪 **Operational Excellence**
- **Attendance Management**: Integrated time and attendance tracking with organization hours
- **Task Management**: Project and task management with team collaboration
- **Client Portals**: Customer-facing portals and self-service capabilities
- **Document Management**: Centralized document storage and version control
- **Communication Tools**: Built-in messaging and notification systems
- **Analytics Dashboard**: Real-time business metrics and performance indicators

## 🔒 **Security & Compliance**
- **Role-Based Access**: Granular permission management and access control
- **Data Protection**: GDPR and privacy compliance features
- **Audit Logging**: Comprehensive audit trails for regulatory compliance
- **Backup & Recovery**: Automated backup and disaster recovery capabilities
- **Multi-Factor Authentication**: Enhanced security with MFA support
- **API Security**: Secure API access with rate limiting and monitoring

## 📈 **Business Intelligence**
- **Performance Metrics**: Real-time organization performance tracking
- **Financial Analytics**: Revenue, expense, and profitability analysis
- **Employee Analytics**: Workforce analytics and productivity metrics
- **Customer Insights**: Client behavior and satisfaction analysis
- **Operational Efficiency**: Process optimization and resource utilization
- **Predictive Analytics**: Forecasting and trend analysis capabilities

## 🌍 **Global Operations**
- **Multi-Currency**: Support for multiple currencies and exchange rates
- **Localization**: Multi-language support and regional customization
- **Tax Management**: Regional tax compliance and calculation
- **Legal Compliance**: Country-specific legal and regulatory compliance
- **Cultural Adaptation**: Regional business practice customization
- **Time Zone Management**: Global time zone coordination and scheduling
		`,
	})
	@ApiBody({ 
		type: CreateOrganisationDto,
		description: 'Comprehensive organization creation payload with business configuration',
		examples: {
			technologyCompany: {
				summary: '🏢 Technology Company Setup',
				description: 'Complete setup for a technology company with multiple departments',
				value: {
					name: 'Orrbit Technologies',
					email: 'info@loro.co.za',
					phone: '+27 11 123 4567',
					contactPerson: 'The Guy',
					website: 'https://www.loro.co.za',
					logo: 'https://www.loro.co.za/logo.png',
					address: {
						street: '123 Innovation Drive',
						city: 'Pretoria',
						state: 'Gauteng',
						postalCode: '0001',
						country: 'South Africa',
						latitude: -25.7479,
						longitude: 28.2293
					},
					industry: 'Technology',
					companySize: '50-200',
					timeZone: 'Africa/Johannesburg',
					currency: 'ZAR',
					registrationNumber: 'REG123456789',
					taxNumber: 'TAX987654321'
				}
			},
			consultingFirm: {
				summary: '💼 Consulting Firm Setup',
				description: 'Professional services firm with client management focus',
				value: {
					name: 'Strategic Business Consultants',
					email: 'contact@strategic-bc.co.za',
					phone: '+27 21 456 7890',
					contactPerson: 'Jane Smith',
					website: 'https://www.strategic-bc.co.za',
					address: {
						street: '456 Business Park',
						city: 'Cape Town',
						state: 'Western Cape',
						postalCode: '8001',
						country: 'South Africa',
						latitude: -33.9249,
						longitude: 18.4241
					},
					industry: 'Professional Services',
					companySize: '10-50',
					timeZone: 'Africa/Johannesburg',
					currency: 'ZAR'
				}
			},
			retailChain: {
				summary: '🛍️ Retail Chain Setup',
				description: 'Multi-location retail operation with inventory management',
				value: {
					name: 'African Retail Group',
					email: 'operations@african-retail.co.za',
					phone: '+27 31 789 0123',
					contactPerson: 'Mike Johnson',
					website: 'https://www.african-retail.co.za',
					address: {
						street: '789 Commerce Centre',
						city: 'Durban',
						state: 'KwaZulu-Natal',
						postalCode: '4000',
						country: 'South Africa',
						latitude: -29.8587,
						longitude: 31.0218
					},
					industry: 'Retail',
					companySize: '200+',
					timeZone: 'Africa/Johannesburg',
					currency: 'ZAR'
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Organisation created successfully with complete setup',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Success message from environment variable (SUCCESS_MESSAGE)'
				},
				organizationDetails: {
					type: 'object',
					description: 'Created organization information',
					properties: {
						uid: { type: 'number', example: 1, description: 'Unique organization identifier' },
						name: { type: 'string', example: 'Orrbit Technologies', description: 'Organization name' },
						email: { type: 'string', example: 'info@loro.co.za', description: 'Primary contact email' },
						phone: { type: 'string', example: '+27 11 123 4567', description: 'Primary contact phone' },
						contactPerson: { type: 'string', example: 'The Guy', description: 'Primary contact person' },
						website: { type: 'string', example: 'https://www.loro.co.za', description: 'Organization website' },
						logo: { type: 'string', example: 'https://www.loro.co.za/logo.png', description: 'Organization logo URL' },
						ref: { type: 'string', example: 'ORG123456', description: 'Organization reference code' },
						timeZone: { type: 'string', example: 'Africa/Johannesburg', description: 'Organization timezone' },
						createdAt: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
						updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
						isDeleted: { type: 'boolean', example: false, description: 'Soft delete status' }
					}
				},
				setupComponents: {
					type: 'object',
					description: 'Automatically created organization components',
					properties: {
						settings: { type: 'boolean', example: true, description: 'Organization settings created' },
						workingHours: { type: 'boolean', example: true, description: 'Default working hours configured' },
						appearance: { type: 'boolean', example: true, description: 'Appearance settings initialized' },
						branchStructure: { type: 'boolean', example: true, description: 'Branch hierarchy established' }
					}
				}
			},
			required: ['message', 'organizationDetails']
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid organization data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for organization creation' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Organization name is required',
						'Email must be a valid email address',
						'Phone number must be in valid format',
						'Contact person name is required'
					]
				},
				fieldErrors: {
					type: 'object',
					properties: {
						name: { type: 'string', example: 'Organization name must be between 2 and 100 characters' },
						email: { type: 'string', example: 'Email must be a valid email address' },
						phone: { type: 'string', example: 'Phone number must be in international format' }
					}
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to create organizations' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER', 'SUPPORT', 'DEVELOPER']
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Organization already exists',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Organization with this name or email already exists' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflictingFields: {
					type: 'array',
					items: { type: 'string' },
					example: ['name', 'email']
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Organization creation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to create organization due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/org' }
			}
		}
	})
	create(@Body() createOrganisationDto: CreateOrganisationDto, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		return this.organisationService.create(createOrganisationDto, orgId, branchId);
	}

	@Get()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '📋 Get all organisations',
		description: `
# Organization Directory

Retrieves a comprehensive list of all organizations with advanced filtering, branch information, and operational metrics.

## 📊 **Response Features**
- **Organization Profiles**: Complete organization information including contact details
- **Branch Structure**: Hierarchical view of all branches and locations
- **Operational Status**: Real-time status and activity metrics
- **Settings Overview**: Key configuration and settings information
- **Asset Summary**: Asset allocation and resource utilization
- **Performance Metrics**: Key performance indicators and analytics

## 🔍 **Data Scope & Filtering**
- **Organization Hierarchy**: Respects organizational access boundaries
- **Role-Based Access**: Different data visibility based on user role
- **Branch Filtering**: Option to filter by specific branches
- **Status Filtering**: Active, inactive, and maintenance status options
- **Geographic Filtering**: Filter by location, timezone, or region
- **Industry Filtering**: Filter by business sector or industry type

## 📈 **Business Intelligence**
- **Organization Analytics**: Registration trends and growth metrics
- **Operational Efficiency**: Resource utilization and productivity metrics
- **Branch Performance**: Multi-location performance comparison
- **Asset Distribution**: Asset allocation across organizations
- **User Activity**: Employee count and engagement metrics
- **Financial Overview**: Revenue and cost center analysis

## 🎯 **Use Cases**
- **Multi-Tenant Management**: Manage multiple organizations from one interface
- **Branch Operations**: Coordinate activities across multiple locations
- **Resource Planning**: Allocate resources and assets efficiently
- **Performance Monitoring**: Track organizational performance metrics
- **Compliance Reporting**: Generate compliance and audit reports
- **Strategic Planning**: Analyze trends for business strategy

## 🔒 **Security & Access Control**
- **Organization Scoping**: Users only see their authorized organizations
- **Role-Based Data**: Information displayed based on access level
- **Audit Logging**: All access is logged for security monitoring
- **Data Privacy**: Sensitive information is masked based on permissions
- **Branch Permissions**: Branch-level access control and filtering

## 🌍 **Global Operations Support**
- **Multi-Timezone**: Display times in appropriate timezones
- **Currency Support**: Multi-currency financial information
- **Localization**: Region-specific data formatting
- **Compliance**: Regional regulatory compliance information
- **Language Support**: Multi-language organization names and descriptions
		`,
	})
	@ApiOkResponse({
		description: '✅ Organizations retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				organisations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1, description: 'Unique organization identifier' },
							name: { type: 'string', example: 'Orrbit Technologies', description: 'Organization name' },
							email: { type: 'string', example: 'info@loro.co.za', description: 'Primary contact email' },
							phone: { type: 'string', example: '+27 11 123 4567', description: 'Primary contact phone' },
							contactPerson: { type: 'string', example: 'The Guy', description: 'Primary contact person' },
							website: { type: 'string', example: 'https://www.loro.co.za', description: 'Organization website' },
							logo: { type: 'string', example: 'https://www.loro.co.za/logo.png', description: 'Organization logo URL' },
							ref: { type: 'string', example: 'ORG123456', description: 'Organization reference code' },
							createdAt: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
							updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
							isDeleted: { type: 'boolean', example: false, description: 'Soft delete status' },
							branches: {
								type: 'array',
								description: 'Organization branches',
								items: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 1, description: 'Branch identifier' },
										name: { type: 'string', example: 'Pretoria South Africa', description: 'Branch name' },
										phone: { type: 'string', example: '+27 11 123 4567', description: 'Branch phone' },
										email: { type: 'string', example: 'pretoria@loro.co.za', description: 'Branch email' },
										website: { type: 'string', example: 'https://pretoria.loro.co.za', description: 'Branch website' }
									}
								}
							},
							operationalStatus: {
								type: 'object',
								description: 'Real-time operational metrics',
								properties: {
									activeUsers: { type: 'number', example: 45, description: 'Active user count' },
									totalEmployees: { type: 'number', example: 50, description: 'Total employee count' },
									activeBranches: { type: 'number', example: 3, description: 'Active branch count' },
									lastActivity: { type: 'string', format: 'date-time', description: 'Last system activity' }
								}
							}
						},
					},
				},
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Success message from environment variable'
				},
				metadata: {
					type: 'object',
					description: 'Response metadata and summary',
					properties: {
						total: { type: 'number', example: 5, description: 'Total organizations found' },
						activeCount: { type: 'number', example: 4, description: 'Active organizations' },
						inactiveCount: { type: 'number', example: 1, description: 'Inactive organizations' },
						totalBranches: { type: 'number', example: 12, description: 'Total branches across all organizations' },
						cacheInfo: {
							type: 'object',
							properties: {
								cached: { type: 'boolean', example: true, description: 'Data served from cache' },
								cacheAge: { type: 'number', example: 300, description: 'Cache age in seconds' }
							}
						}
					},
				},
			},
			required: ['organisations', 'message']
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to view organizations',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view organizations' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER', 'SUPPORT', 'DEVELOPER']
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve organizations',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Unable to retrieve organisations at this time. Please try again later.' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/org' }
			}
		}
	})
	findAll(@Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		return this.organisationService.findAll(orgId, branchId);
	}

	@Get(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '🔍 Get organisation by reference code',
		description: `
# Organization Profile Retrieval

Retrieves comprehensive organization information including settings, working hours, branches, assets, and operational data.

## 📊 **Complete Organization Profile**
- **Basic Information**: Contact details, address, and company information
- **Branch Network**: All branches and locations with individual settings
- **Organization Settings**: Business rules, preferences, and configuration
- **Working Hours**: Detailed working hours for attendance and scheduling
- **Appearance Settings**: Branding, themes, and visual customization
- **Asset Management**: Organization assets, resources, and equipment
- **Product Catalog**: Available products and services
- **Client Portfolio**: Customer base and relationship information
- **User Directory**: Employee information and organizational structure
- **Reseller Network**: Partner and reseller relationship data

## ⚙️ **Organization Settings Deep Dive**
- **Business Configuration**: Core business rules and operational settings
- **Attendance Policies**: Clock-in/out rules, overtime policies, break schedules
- **Leave Policies**: Vacation, sick leave, and holiday management
- **Approval Workflows**: Multi-level approval processes for various operations
- **Notification Settings**: Email, SMS, and push notification preferences
- **Security Settings**: Password policies, session management, access controls
- **Integration Settings**: Third-party API configurations and webhooks
- **Reporting Configuration**: Custom report templates and scheduled reports

## 🕐 **Working Hours Configuration**
- **Standard Hours**: Default working hours for the organization
- **Branch-Specific Hours**: Individual working hours for each branch
- **Holiday Calendars**: National and regional holiday configurations
- **Special Hours**: Seasonal adjustments and special operating hours
- **Timezone Support**: Multi-timezone operations and automatic conversions
- **Shift Patterns**: Flexible shift configurations and rotation schedules
- **Overtime Rules**: Automatic overtime calculation and approval workflows
- **Break Schedules**: Mandatory and optional break periods

## 📈 **Business Intelligence**
- **Performance Metrics**: Key performance indicators and operational metrics
- **Financial Overview**: Revenue streams, cost centers, and profitability
- **Resource Utilization**: Asset usage, capacity planning, and efficiency metrics
- **Employee Analytics**: Workforce statistics, productivity, and engagement
- **Client Analytics**: Customer acquisition, retention, and satisfaction metrics
- **Operational Efficiency**: Process optimization and workflow performance

## 🔒 **Security & Compliance**
- **Data Protection**: Privacy settings and data retention policies
- **Audit Trails**: Complete audit logging and compliance reporting
- **Access Controls**: Role-based permissions and security boundaries
- **Compliance Framework**: Regulatory compliance and certification status
- **Risk Management**: Security assessments and risk mitigation strategies

## 🎯 **Use Cases**
- **Organization Administration**: Complete organization management and configuration
- **Branch Operations**: Multi-location coordination and management
- **Asset Planning**: Resource allocation and asset lifecycle management
- **Performance Monitoring**: Real-time operational metrics and analytics
- **Compliance Reporting**: Regulatory compliance and audit preparation
- **Strategic Planning**: Data-driven business strategy and planning
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'Organisation reference code - unique identifier for the organization',
		type: 'string',
		example: 'ORG123456',
	})
	@ApiOkResponse({
		description: '✅ Organisation profile retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				organisation: {
					type: 'object',
					nullable: true,
					description: 'Complete organization profile with all related data',
					properties: {
						uid: { type: 'number', example: 1, description: 'Unique organization identifier' },
						name: { type: 'string', example: 'Orrbit Technologies', description: 'Organization name' },
						email: { type: 'string', example: 'info@loro.co.za', description: 'Primary contact email' },
						phone: { type: 'string', example: '+27 11 123 4567', description: 'Primary contact phone' },
						contactPerson: { type: 'string', example: 'The Guy', description: 'Primary contact person' },
						website: { type: 'string', example: 'https://www.loro.co.za', description: 'Organization website' },
						logo: { type: 'string', example: 'https://www.loro.co.za/logo.png', description: 'Organization logo URL' },
						ref: { type: 'string', example: 'ORG123456', description: 'Organization reference code' },
						createdAt: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
						updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
						isDeleted: { type: 'boolean', example: false, description: 'Soft delete status' },
						branches: {
							type: 'array',
							description: 'Organization branches and locations',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1, description: 'Branch identifier' },
									name: { type: 'string', example: 'Pretoria South Africa', description: 'Branch name' },
									phone: { type: 'string', example: '+27 11 123 4567', description: 'Branch phone' },
									email: { type: 'string', example: 'pretoria@loro.co.za', description: 'Branch email' },
									website: { type: 'string', example: 'https://pretoria.loro.co.za', description: 'Branch website' },
									address: { type: 'string', example: '123 Business Park, Pretoria', description: 'Branch address' }
								}
							}
						},
						settings: {
							type: 'object',
							nullable: true,
							description: 'Organization settings and business configuration',
							properties: {
								uid: { type: 'number', example: 1, description: 'Settings identifier' },
								attendanceSettings: {
									type: 'object',
									description: 'Attendance and time tracking configuration',
									properties: {
										requireGeoLocation: { type: 'boolean', example: true, description: 'Require GPS for clock-in' },
										maxClockDistance: { type: 'number', example: 100, description: 'Maximum distance in meters' },
										autoClockOut: { type: 'boolean', example: true, description: 'Automatic clock-out enabled' },
										overtimeThreshold: { type: 'number', example: 8.5, description: 'Daily overtime threshold in hours' }
									}
								},
								notificationSettings: {
									type: 'object',
									description: 'Communication and notification preferences',
									properties: {
										emailNotifications: { type: 'boolean', example: true, description: 'Email notifications enabled' },
										smsNotifications: { type: 'boolean', example: false, description: 'SMS notifications enabled' },
										pushNotifications: { type: 'boolean', example: true, description: 'Push notifications enabled' }
									}
								}
							}
						},
						appearance: {
							type: 'object',
							nullable: true,
							description: 'Branding and visual customization settings',
							properties: {
								uid: { type: 'number', example: 1, description: 'Appearance settings identifier' },
								primaryColor: { type: 'string', example: '#1E40AF', description: 'Primary brand color' },
								secondaryColor: { type: 'string', example: '#64748B', description: 'Secondary brand color' },
								logoUrl: { type: 'string', example: 'https://loro.co.za/logo.png', description: 'Custom logo URL' },
								theme: { type: 'string', example: 'modern', description: 'UI theme preference' }
							}
						},
						hours: {
							type: 'array',
							description: 'Organization working hours configuration',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1, description: 'Working hours identifier' },
									dayOfWeek: { type: 'string', example: 'MONDAY', description: 'Day of the week' },
									startTime: { type: 'string', example: '08:00', description: 'Start time (HH:MM format)' },
									endTime: { type: 'string', example: '17:00', description: 'End time (HH:MM format)' },
									isWorkingDay: { type: 'boolean', example: true, description: 'Whether this is a working day' },
									breakDuration: { type: 'number', example: 60, description: 'Break duration in minutes' },
									timezone: { type: 'string', example: 'Africa/Johannesburg', description: 'Timezone for this schedule' }
								}
							}
						},
						assets: {
							type: 'array',
							description: 'Organization assets and resources',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1, description: 'Asset identifier' },
									name: { type: 'string', example: 'Company Vehicle', description: 'Asset name' },
									type: { type: 'string', example: 'VEHICLE', description: 'Asset type' },
									status: { type: 'string', example: 'ACTIVE', description: 'Asset status' },
									assignedTo: { type: 'number', example: 123, description: 'Assigned user ID' }
								}
							}
						},
						products: {
							type: 'array',
							description: 'Organization product catalog',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1, description: 'Product identifier' },
									name: { type: 'string', example: 'Software License', description: 'Product name' },
									category: { type: 'string', example: 'Software', description: 'Product category' },
									price: { type: 'number', example: 999.99, description: 'Product price' },
									currency: { type: 'string', example: 'ZAR', description: 'Price currency' }
								}
							}
						},
						clients: {
							type: 'array',
							description: 'Organization client portfolio',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1, description: 'Client identifier' },
									name: { type: 'string', example: 'ABC Corporation', description: 'Client name' },
									contactPerson: { type: 'string', example: 'John Smith', description: 'Primary contact' },
									email: { type: 'string', example: 'john@abc-corp.com', description: 'Client email' },
									status: { type: 'string', example: 'ACTIVE', description: 'Client status' }
								}
							}
						},
						users: {
							type: 'array',
							description: 'Organization user directory',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1, description: 'User identifier' },
									name: { type: 'string', example: 'The Guy', description: 'User full name' },
									email: { type: 'string', example: 'theguy@loro.co.za', description: 'User email' },
									role: { type: 'string', example: 'DEVELOPER', description: 'User role' },
									status: { type: 'string', example: 'ACTIVE', description: 'User status' }
								}
							}
						},
						resellers: {
							type: 'array',
							description: 'Organization reseller network',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1, description: 'Reseller identifier' },
									name: { type: 'string', example: 'Partner Corp', description: 'Reseller name' },
									contactPerson: { type: 'string', example: 'Jane Doe', description: 'Primary contact' },
									commissionRate: { type: 'number', example: 10.5, description: 'Commission rate percentage' },
									status: { type: 'string', example: 'ACTIVE', description: 'Reseller status' }
								}
							}
						},
						leaves: {
							type: 'array',
							description: 'Organization leave policies and requests',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1, description: 'Leave record identifier' },
									type: { type: 'string', example: 'ANNUAL', description: 'Leave type' },
									policyName: { type: 'string', example: 'Annual Leave Policy', description: 'Leave policy name' },
									maxDays: { type: 'number', example: 21, description: 'Maximum days allowed' },
									carryOverDays: { type: 'number', example: 5, description: 'Days that can carry over' }
								}
							}
						}
					},
				},
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Success message from environment variable'
				}
			},
			required: ['organisation', 'message']
		},
	})
	@ApiNotFoundResponse({ 
		description: '❌ Organisation not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Organisation not found. Please verify the reference code and try again.' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the organization reference code is correct',
						'Check if the organization has been deleted',
						'Ensure you have permission to access this organization'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No access to organization',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to access this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Organization belongs to different tenant or insufficient permissions' }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Profile retrieval failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Unable to retrieve organisation details. Please try again later.' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/org/ORG123456' }
			}
		}
	})
	findOne(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		return this.organisationService.findOne(ref, orgId, branchId);
	}

	@Patch(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '✏️ Update organisation information',
		description: `
# Organization Management System

Updates existing organization information with comprehensive validation, audit trail maintenance, and automatic system reconfiguration.

## 🔄 **Supported Updates**
- **Basic Information**: Name, contact details, address, and company information
- **Contact Management**: Phone, email, website, and primary contact person updates
- **Branding Updates**: Logo, appearance settings, and visual identity changes
- **Configuration Changes**: Business settings, operational parameters, and system preferences
- **Location Updates**: Address changes with automatic timezone and regional setting adjustments
- **Compliance Updates**: Registration numbers, tax information, and regulatory details

## 🔧 **Advanced Configuration**
- **Working Hours Management**: Update business hours affecting attendance calculations
- **Branch Coordination**: Changes propagate to all related branches automatically
- **User Impact Analysis**: Automatic assessment of changes affecting users and operations
- **Asset Reallocation**: Asset assignments and resource allocation updates
- **Integration Updates**: Third-party system configurations and API settings
- **Notification Settings**: Communication preferences and alert configurations

## 🔒 **Security & Validation**
- **Permission Validation**: Updates require appropriate organizational access
- **Data Integrity**: Business rule validation prevents invalid state changes
- **Audit Trail**: Complete logging of all changes with user identification and timestamps
- **Rollback Capability**: Previous configurations preserved for recovery purposes
- **Impact Assessment**: Analysis of downstream effects on users, branches, and operations
- **Approval Workflows**: Sensitive changes may require additional approval

## 📊 **System Integration**
- **Attendance System**: Working hours updates automatically affect attendance calculations
- **User Management**: Changes to organization settings impact user experience
- **Branch Operations**: Updates cascade to all branch locations appropriately
- **Asset Management**: Configuration changes affect asset tracking and allocation
- **Reporting Framework**: Updated information reflects in all organizational reports
- **Third-Party Systems**: API configurations and integration settings management

## 🎯 **Common Update Scenarios**
- **Company Rebranding**: Logo, name, and visual identity updates
- **Office Relocation**: Address, phone, and regional setting changes
- **Business Expansion**: Contact information and operational scope updates
- **Compliance Updates**: Legal information and regulatory requirement changes
- **Operational Changes**: Business hours, policies, and procedural updates
- **Contact Updates**: Key personnel changes and communication preferences

## 📈 **Business Intelligence**
- **Change Analytics**: Track organizational evolution and update patterns
- **Impact Measurement**: Assess business impact of configuration changes
- **Compliance Tracking**: Monitor regulatory compliance and update requirements
- **Performance Metrics**: Measure effectiveness of organizational changes
- **Trend Analysis**: Historical analysis of organizational development
- **Operational Efficiency**: Impact of changes on operational performance
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'Organisation reference code - unique identifier for the organization to update',
		type: 'string',
		example: 'ORG123456',
	})
	@ApiBody({ 
		type: UpdateOrganisationDto,
		description: 'Organization update payload with fields to modify - supports partial updates',
		examples: {
			basicInfoUpdate: {
				summary: '📝 Basic Information Update',
				description: 'Update core organization information',
				value: {
					name: 'Orrbit Technologies (Pty) Ltd',
					contactPerson: 'The Guy - CTO',
					phone: '+27 11 123 4567',
					email: 'info@loro.co.za',
					website: 'https://www.loro.co.za'
				}
			},
			addressUpdate: {
				summary: '📍 Address and Location Update',
				description: 'Update organization address and location details',
				value: {
					address: {
						street: '456 Innovation Hub',
						city: 'Pretoria',
						state: 'Gauteng',
						postalCode: '0001',
						country: 'South Africa',
						latitude: -25.7479,
						longitude: 28.2293
					}
				}
			},
			brandingUpdate: {
				summary: '🎨 Branding and Visual Identity Update',
				description: 'Update logo and branding elements',
				value: {
					logo: 'https://www.loro.co.za/new-logo.png',
					website: 'https://www.loro.co.za',
					name: 'Orrbit Technologies - Innovation Leaders'
				}
			},
			contactUpdate: {
				summary: '📞 Contact Information Update',
				description: 'Update contact details and communication preferences',
				value: {
					phone: '+27 11 987 6543',
					email: 'contact@loro.co.za',
					contactPerson: 'Jane Smith - Operations Manager',
					website: 'https://www.loro.co.za'
				}
			},
			comprehensiveUpdate: {
				summary: '🔄 Comprehensive Organization Update',
				description: 'Update multiple aspects of organization profile',
				value: {
					name: 'Orrbit Technologies (Pty) Ltd',
					email: 'info@loro.co.za',
					phone: '+27 11 123 4567',
					contactPerson: 'The Guy - Chief Technology Officer',
					website: 'https://www.loro.co.za',
					logo: 'https://www.loro.co.za/updated-logo.png',
					address: {
						street: '789 Technology Park',
						city: 'Johannesburg',
						state: 'Gauteng',
						postalCode: '2000',
						country: 'South Africa',
						latitude: -26.2041,
						longitude: 28.0473
					}
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Organisation updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable (SUCCESS_MESSAGE)'
				},
				updateSummary: {
					type: 'object',
					description: 'Summary of changes applied',
					properties: {
						updatedFields: {
							type: 'array',
							items: { type: 'string' },
							example: ['name', 'email', 'phone', 'logo'],
							description: 'List of fields that were updated'
						},
						impactedSystems: {
							type: 'array',
							items: { type: 'string' },
							example: ['user_management', 'attendance_system', 'reporting'],
							description: 'Systems affected by the update'
						},
						cacheCleared: { type: 'boolean', example: true, description: 'Whether cache was cleared' }
					}
				}
			},
			required: ['message']
		}
	})
	@ApiNotFoundResponse({ 
		description: '🔍 Organisation not found for update',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Organisation not found or you do not have permission to modify it.' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the organization reference code is correct',
						'Check if the organization has been deleted',
						'Ensure you have permission to modify this organization'
					]
				}
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid update data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for organization update' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Email must be a valid email address',
						'Phone number must be in valid format',
						'Organization name must be between 2 and 100 characters'
					]
				},
				fieldErrors: {
					type: 'object',
					properties: {
						email: { type: 'string', example: 'Email must be a valid email address' },
						phone: { type: 'string', example: 'Phone number must be in international format' },
						name: { type: 'string', example: 'Organization name is required and must be unique' }
					}
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to update organization',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to update this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Organization belongs to different tenant or insufficient role permissions' },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER', 'SUPPORT', 'DEVELOPER']
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Update conflicts with existing data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot update organization - conflicting data exists' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Organization name already exists',
						'Email address is already in use by another organization',
						'Cannot change critical settings while users are active'
					]
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Update failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Unable to update organisation. Please try again later.' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/org/ORG123456' }
			}
		}
	})
	update(
		@Param('ref') ref: string,
		@Body() updateOrganisationDto: UpdateOrganisationDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		return this.organisationService.update(ref, updateOrganisationDto, orgId, branchId);
	}

	@Patch('restore/:ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '🔄 Restore a deleted organisation',
		description: `
# Organization Recovery System

Restores a previously deleted organization back to active status with comprehensive data validation, system reintegration, and audit trail maintenance.

## 🔄 **Recovery Process**
- **Data Validation**: Comprehensive validation of organization data integrity
- **System Reintegration**: Automatic reactivation of all related systems and services
- **Branch Restoration**: Reactivation of all associated branches and locations
- **User Reactivation**: Restoration of user access and permissions
- **Asset Recovery**: Reactivation of organization assets and resources
- **Settings Restoration**: Recovery of all configuration and preference settings
- **Audit Trail**: Complete logging of restoration activity with timestamps

## ⚠️ **Recovery Requirements**
- **Retention Period**: Organization must be within retention period (typically 90 days)
- **Data Integrity**: All related records must be intact and consistent
- **Permission Checks**: User must have appropriate restoration permissions
- **System Availability**: All dependent systems must be operational
- **Business Rules**: Organization must meet current business criteria for restoration
- **Compliance Check**: Regulatory and compliance requirements validation

## 🔒 **Security Features**
- **Authorization**: Only authorized users can restore organizations
- **Audit Logging**: Complete audit trail of restoration activity
- **Data Validation**: Ensures restored organization data is valid and current
- **Impact Assessment**: Analysis of restoration impact on related systems
- **Rollback Protection**: Prevents restoration if data integrity is compromised
- **Permission Restoration**: Careful restoration of user permissions and access

## 📊 **System Integration**
- **User Management**: Restoration of user accounts and organizational access
- **Branch Operations**: Reactivation of all branch locations and operations
- **Asset Management**: Recovery of asset assignments and tracking
- **Attendance System**: Restoration of attendance tracking and working hours
- **Client Relationships**: Reactivation of client accounts and relationships
- **Product Catalog**: Recovery of product listings and inventory
- **Reporting Framework**: Restoration of reporting access and configurations

## 📋 **Common Use Cases**
- **Accidental Deletion**: Recover organizations deleted by mistake
- **Business Reactivation**: Restore organizations returning to active status
- **Process Errors**: Restore organizations deleted due to workflow errors
- **Data Recovery**: Recover organizations lost during system issues
- **Compliance Requirements**: Restore organizations required for regulatory compliance
- **Merger Recovery**: Restore organizations after failed merger attempts

## 🎯 **Business Continuity**
- **Operational Continuity**: Seamless restoration with minimal operational disruption
- **Data Consistency**: Ensures all related data maintains consistency
- **User Experience**: Transparent restoration process for end users
- **Performance Impact**: Minimal impact on system performance during restoration
- **Service Availability**: Maintains service availability during recovery process
- **Integration Integrity**: Preserves all third-party integrations and configurations

## 📈 **Success Metrics**
- **Recovery Time**: Time taken to complete full organization restoration
- **Data Integrity**: Percentage of data successfully recovered
- **System Integration**: Number of systems successfully reintegrated
- **User Satisfaction**: User feedback on restoration process
- **Business Impact**: Measure of business continuity during restoration
- **Compliance Status**: Regulatory compliance maintained during recovery
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'Organisation reference code of the deleted organization to restore',
		type: 'string',
		example: 'ORG123456',
	})
	@ApiOkResponse({
		description: '✅ Organisation restored successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable (SUCCESS_MESSAGE)'
				},
				restorationSummary: {
					type: 'object',
					description: 'Comprehensive restoration summary',
					properties: {
						organizationRestored: { type: 'boolean', example: true, description: 'Organization successfully restored' },
						branchesRestored: { type: 'number', example: 3, description: 'Number of branches restored' },
						usersReactivated: { type: 'number', example: 45, description: 'Number of users reactivated' },
						assetsRecovered: { type: 'number', example: 12, description: 'Number of assets recovered' },
						clientsReactivated: { type: 'number', example: 78, description: 'Number of client relationships restored' },
						restorationTimestamp: { type: 'string', format: 'date-time', description: 'Restoration completion time' },
						dataIntegrityScore: { type: 'number', example: 98.5, description: 'Data integrity percentage' }
					}
				}
			},
			required: ['message']
		}
	})
	@ApiNotFoundResponse({ 
		description: '🔍 Deleted organisation not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Organisation not found or you do not have permission to restore it.' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				reasons: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Organization was never deleted',
						'Organization has been permanently purged',
						'Organization reference code is incorrect',
						'Organization belongs to different tenant'
					]
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the organization reference code is correct',
						'Check if organization was recently permanently deleted',
						'Ensure you have permission to access this organization',
						'Contact administrator for organization recovery options'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to restore organizations',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to restore organizations' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Insufficient permissions or organization belongs to different tenant' },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER', 'SUPPORT', 'DEVELOPER']
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Organization cannot be restored',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot restore organization - retention period has expired' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Retention period expired 15 days ago',
						'Organization data has been archived',
						'Related records have been purged',
						'Another organization with same name exists'
					]
				},
				resolution: {
					type: 'object',
					properties: {
						possibleActions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Contact system administrator for manual recovery',
								'Check archived data sources',
								'File data recovery request with IT department',
								'Create new organization with different name'
							]
						},
						escalationPath: { type: 'string', example: 'Contact IT Support for advanced recovery options' }
					}
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Restoration failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to restore organization due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/org/restore/ORG123456' },
				recoveryOptions: {
					type: 'object',
					properties: {
						retryable: { type: 'boolean', example: true, description: 'Whether the operation can be retried' },
						supportReference: { type: 'string', example: 'SR-2023-001234', description: 'Support ticket reference' },
						estimatedRecoveryTime: { type: 'string', example: '2-4 hours', description: 'Estimated time for manual recovery' }
					}
				}
			}
		}
	})
	restore(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		return this.organisationService.restore(ref, orgId, branchId);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '🗑️ Soft delete an organisation',
		description: `
# Organization Deactivation System

Marks an organization as deleted without permanently removing it from the database, ensuring data integrity, maintaining audit trails, and preserving business continuity.

## 🔒 **Safety Features**
- **Soft Delete**: Organization is marked as deleted but remains in database for recovery
- **Audit Trail**: Deletion is logged with complete user identification and timestamps
- **Recovery Support**: Deleted organizations can be restored using restore endpoint
- **Data Preservation**: All related records (branches, users, assets) are preserved
- **Impact Assessment**: Automatic analysis of deletion impact on related systems
- **Rollback Capability**: Complete rollback protection with recovery mechanisms

## ⚠️ **Pre-Deletion Validation**
- **Active User Check**: Cannot delete organizations with active user sessions
- **Asset Dependencies**: Assessment of critical asset assignments and dependencies
- **Financial Obligations**: Check for pending transactions and financial commitments
- **Client Relationships**: Analysis of active client contracts and relationships
- **Branch Operations**: Evaluation of active branch operations and dependencies
- **Integration Status**: Assessment of third-party integrations and API connections
- **Compliance Requirements**: Regulatory compliance checks before deletion

## 📊 **System Integration**
- **User Management**: Automatic deactivation of all organizational users
- **Branch Operations**: Cascading deactivation of all branch locations
- **Asset Management**: Automatic return and reassignment of organizational assets
- **Attendance System**: Suspension of attendance tracking and working hours
- **Client Relationships**: Temporary suspension of client access and services
- **Product Catalog**: Deactivation of product listings and inventory
- **Reporting Framework**: Archival of organizational reports and analytics

## 📋 **Common Use Cases**
- **Business Closure**: Formal business closure with data preservation
- **Temporary Suspension**: Temporary organization deactivation for restructuring
- **Compliance Action**: Regulatory-required organization suspension
- **Data Cleanup**: Archival of inactive or obsolete organizations
- **Security Incident**: Immediate organization deactivation for security reasons
- **Merger Activities**: Organization deactivation during merger processes

## 🔄 **Recovery Process**
- **Retention Period**: Organizations remain recoverable for configurable period (default 90 days)
- **Data Recovery**: Complete recovery of all organization data and configurations
- **User Restoration**: Automatic restoration of user accounts and permissions
- **System Reintegration**: Seamless reintegration with all related systems
- **Audit Recovery**: Complete audit trail recovery for compliance purposes
- **Performance Recovery**: Restoration of all performance metrics and analytics

## 🎯 **Impact Assessment**
- **User Impact**: Assessment of impact on organizational users and their access
- **Branch Impact**: Analysis of impact on branch operations and local users
- **Client Impact**: Evaluation of impact on client relationships and services
- **Asset Impact**: Assessment of asset utilization and reassignment requirements
- **Financial Impact**: Analysis of financial implications and pending transactions
- **Integration Impact**: Assessment of third-party integration disruptions

## 📈 **Business Intelligence**
- **Deletion Analytics**: Track organization deletion patterns and trends
- **Recovery Statistics**: Monitor organization recovery rates and success metrics
- **Impact Analysis**: Measure business impact of organization deactivations
- **Compliance Tracking**: Track regulatory compliance during deletion processes
- **Performance Metrics**: Monitor system performance during deletion operations
- **User Behavior**: Analyze user behavior patterns around organization deletions
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'Organisation reference code of the organization to delete',
		type: 'string',
		example: 'ORG123456',
	})
	@ApiOkResponse({
		description: '✅ Organisation deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable (SUCCESS_MESSAGE)'
				},
				deletionSummary: {
					type: 'object',
					description: 'Comprehensive deletion summary',
					properties: {
						organizationDeleted: { type: 'boolean', example: true, description: 'Organization successfully deleted' },
						branchesAffected: { type: 'number', example: 3, description: 'Number of branches affected' },
						usersDeactivated: { type: 'number', example: 45, description: 'Number of users deactivated' },
						assetsReturned: { type: 'number', example: 12, description: 'Number of assets returned' },
						clientsAffected: { type: 'number', example: 78, description: 'Number of client relationships affected' },
						deletionTimestamp: { type: 'string', format: 'date-time', description: 'Deletion completion time' },
						recoveryDeadline: { type: 'string', format: 'date-time', description: 'Recovery deadline (retention period)' },
						retentionPeriod: { type: 'number', example: 90, description: 'Retention period in days' }
					}
				}
			},
			required: ['message']
		}
	})
	@ApiNotFoundResponse({ 
		description: '🔍 Organisation not found for deletion',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Organisation not found, has already been removed, or you do not have permission to delete it.' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				reasons: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Organization reference code does not exist',
						'Organization has already been deleted',
						'Organization belongs to different tenant',
						'Organization has been permanently purged'
					]
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the organization reference code is correct',
						'Check if the organization has already been deleted',
						'Ensure you have permission to access this organization',
						'Contact administrator if organization should exist'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to delete organization',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to delete this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Insufficient permissions or organization belongs to different tenant' },
				requiredRoles: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER', 'SUPPORT', 'DEVELOPER']
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Organization cannot be deleted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot delete organization - organization has active dependencies' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				blockingFactors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Organization has 25 active user sessions',
						'Organization has 5 critical assets assigned',
						'Organization has 12 pending client contracts',
						'Organization has active financial obligations'
					]
				},
				resolution: {
					type: 'object',
					properties: {
						requiredActions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'End all active user sessions',
								'Return or reassign critical assets',
								'Complete or transfer pending client contracts',
								'Settle financial obligations'
							]
						},
						estimatedResolutionTime: { type: 'string', example: '2-5 business days' },
						alternativeOptions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Schedule deletion for later date',
								'Perform phased deactivation',
								'Transfer dependencies to another organization'
							]
						}
					}
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Deletion failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Unable to remove organisation. Please try again later.' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/org/ORG123456' },
				errorDetails: {
					type: 'object',
					properties: {
						component: { type: 'string', example: 'Organization Management Service' },
						operation: { type: 'string', example: 'SOFT_DELETE' },
						errorCode: { type: 'string', example: 'ORG_DELETE_FAILURE' },
						retryable: { type: 'boolean', example: true, description: 'Whether the operation can be retried' },
						supportReference: { type: 'string', example: 'DEL-2023-001234', description: 'Support ticket reference' }
					}
				}
			}
		}
	})
	remove(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		return this.organisationService.remove(ref, orgId, branchId);
	}
}
