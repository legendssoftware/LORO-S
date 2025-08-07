import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Req } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { UpdateCommunicationScheduleDto } from './dto/communication-schedule.dto';
import {
	ApiOperation,
	ApiQuery,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiBearerAuth,
	ApiForbiddenResponse,
	ApiConflictResponse,
	ApiUnprocessableEntityResponse,
	ApiInternalServerErrorResponse,
	ApiServiceUnavailableResponse,
	ApiConsumes,
	ApiProduces,
} from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { Client } from './entities/client.entity';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { GeneralStatus } from '../lib/enums/status.enums';

@ApiBearerAuth('JWT-auth')
@ApiTags('💎 Clients')
@Controller('clients')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('clients')
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
export class ClientsController {
	constructor(private readonly clientsService: ClientsService) {}

	@Post()
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '➕ Create a new client',
		description: `
# Create Client

Creates a new client record in the system with comprehensive tracking capabilities and CRM integration.

## 📋 **Use Cases**
- **New Customer Onboarding**: Register new customers with complete contact information
- **Lead Conversion**: Convert qualified leads into active clients
- **Partner Management**: Add business partners and vendors to the system
- **Customer Segmentation**: Organize clients by industry, size, or value tier
- **Sales Pipeline**: Track potential customers through the sales process

## 🔧 **Features**
- Comprehensive contact management with multiple communication channels
- Address verification and GPS coordinate tracking
- CRM integration with sales rep assignment
- Financial tracking with credit limits and outstanding balances
- Geofencing capabilities for location-based services
- Communication scheduling and preference management
- Customer segmentation and tagging system

## 📝 **Required Fields**
- Client name and contact person information
- Primary email address (unique across organization)
- Phone number with country code
- Complete physical address with GPS coordinates
- Sales representative assignment

## 💡 **Advanced Features**
- **Price Tier Management**: Assign clients to different pricing structures
- **Risk Assessment**: Evaluate and track client financial risk levels
- **Communication Preferences**: Set preferred contact methods and schedules
- **Acquisition Tracking**: Monitor how clients were acquired and their journey
- **Lifetime Value Calculation**: Track and predict client lifetime value
- **Social Media Integration**: Connect client social media profiles
- **Custom Fields**: Store industry-specific client information
	`,
	})
	@ApiBody({
		type: CreateClientDto,
		description: 'Client creation payload with all required and optional information',
		examples: {
			basicClient: {
				summary: '🏢 Basic Business Client',
				description: 'Standard business client with essential information',
				value: {
					name: 'Orrbit Technologies',
					contactPerson: 'The Guy',
					email: 'theguy@orrbit.co.za',
					phone: '+27 11 123 4567',
					address: {
						street: '123 Business Park Drive',
						suburb: 'Pretoria South Africa',
						city: 'Pretoria',
						state: 'Gauteng',
						country: 'South Africa',
						postalCode: '0002',
					},
					category: 'enterprise',
					assignedSalesRep: { uid: 42 },
					priceTier: 'PREMIUM',
					preferredContactMethod: 'EMAIL',
					industry: 'Technology',
					companySize: 250,
				},
			},
			premiumClient: {
				summary: '⭐ Premium Client with CRM Features',
				description: 'High-value client with comprehensive CRM data',
				value: {
					name: 'Orrbit Technologies Premium',
					contactPerson: 'The Guy',
					email: 'theguy@orrbit.co.za',
					phone: '+27 12 555 0123',
					alternativePhone: '+27 82 555 0123',
					website: 'https://www.orrbit.co.za',
					description: 'Leading provider of innovative business technology solutions in South Africa',
					address: {
						street: '456 Innovation Avenue',
						suburb: 'Pretoria South Africa',
						city: 'Pretoria',
						state: 'Gauteng',
						country: 'South Africa',
						postalCode: '0002',
					},
					category: 'premium',
					assignedSalesRep: { uid: 15 },
					creditLimit: 500000,
					priceTier: 'ENTERPRISE',
					preferredContactMethod: 'EMAIL',
					industry: 'Software Development',
					companySize: 150,
					annualRevenue: 25000000,
					acquisitionChannel: 'REFERRAL',
					acquisitionDate: '2023-01-15',
					tags: ['High Value', 'Tech Partner', 'Strategic Account'],
					socialProfiles: {
						linkedin: 'https://linkedin.com/company/orrbit-technologies',
						twitter: 'https://twitter.com/orrbit_tech',
					},
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ Client created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client created successfully' },
				data: {
					type: 'object',
									properties: {
					uid: { type: 'number', example: 12345 },
					name: { type: 'string', example: 'Orrbit Technologies' },
					email: { type: 'string', example: 'theguy@orrbit.co.za' },
					phone: { type: 'string', example: '+27 11 123 4567' },
					status: { type: 'string', example: 'ACTIVE' },
					createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid or missing required data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed: Email is required' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
											example: [
							'Please provide a valid email address',
							'Please provide a valid South African phone number with country code (+27)',
							'Street address is required',
							'Assigned sales representative must be an object with uid property',
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
				message: { type: 'string', example: 'You do not have permission to create clients in this branch' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
			},
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Client already exists',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'A client with this email already exists' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				existingClient: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 9876 },
						name: { type: 'string', example: 'Orrbit Technologies' },
						email: { type: 'string', example: 'theguy@orrbit.co.za' },
					},
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - System malfunction',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to create client due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/clients' },
			},
		},
	})
	create(@Body() createClientDto: CreateClientDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.create(createClientDto, orgId, branchId);
	}

	@Get('admin/all')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPERVISOR,
	)
	@ApiOperation({
		summary: '👑 Get All Clients (Admin Access)',
		description: `
# Get All Clients - Admin View

Retrieves a comprehensive list of all clients without user-specific filtering for administrative purposes and system management tasks.

## 🔐 **Security & Permissions**
- **Admin-Only Access**: Requires elevated permissions (Admin, Manager, Support, Developer, Owner, Supervisor)
- **No User Filtering**: Bypasses individual user client assignments
- **Organization Scope**: Results filtered by user's organization
- **Branch Scope**: Results filtered by user's branch (if applicable)

## 📋 **Use Cases**
- **User Assignment**: Assign clients to sales representatives and team members
- **System Administration**: Complete client overview for system maintenance
- **Data Analysis**: Generate comprehensive reports across all clients
- **Client Management**: Bulk operations and administrative tasks
- **Audit & Compliance**: Review all client records for compliance purposes
- **Migration & Import**: Verify data integrity during system migrations

## 🔧 **Features**
- **High Volume Pagination**: Default 500 records per page for admin efficiency
- **Advanced Filtering**: Filter by status, search across multiple fields
- **Complete Data Access**: No restrictions based on user assignments
- **Organization Isolation**: Secure multi-tenant data separation
- **Performance Optimized**: Efficient queries for large datasets

## 📊 **Filtering Options**
- **Status Filter**: Active, inactive, converted, or any specific status
- **Search Functionality**: Search across client name, email, and phone number
- **Pagination Controls**: Manage large datasets with configurable page sizes
- **Sort Options**: Results ordered by creation date (newest first)

## 💡 **Admin Benefits**
- **Complete Visibility**: See all clients regardless of assignments
- **Bulk Operations**: Efficient handling of large client datasets
- **Assignment Management**: Easy client-to-user assignment workflows
- **Data Integrity**: Comprehensive view for data validation and cleanup
- **Reporting Foundation**: Base data for administrative reports and analytics
		`,
	})
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to 500 for admin purposes',
	})
	@ApiQuery({
		name: 'status',
		enum: GeneralStatus,
		required: false,
		description: 'Filter by client status',
	})
	@ApiQuery({
		name: 'search',
		type: String,
		required: false,
		description: 'Search term for client name, email, or phone',
	})
	@ApiOkResponse({
		description: '✅ All clients retrieved successfully for admin view',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 12345 },
							name: { type: 'string', example: 'ACME Corporation' },
							email: { type: 'string', example: 'contact@acme.co.za' },
							phone: { type: 'string', example: '+27 11 123 4567' },
							status: { type: 'string', example: 'ACTIVE' },
							category: { type: 'string', example: 'enterprise' },
							assignedSalesRep: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 42 },
									name: { type: 'string', example: 'John Smith' },
									email: { type: 'string', example: 'john.smith@company.co.za' },
								},
							},
							organisation: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1 },
									name: { type: 'string', example: 'Your Organization' },
								},
							},
							branch: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 5 },
									name: { type: 'string', example: 'Main Branch' },
								},
							},
							createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
							industry: { type: 'string', example: 'Technology' },
							companySize: { type: 'number', example: 250 },
							lifetimeValue: { type: 'number', example: 500000 },
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: {
							type: 'number',
							example: 1250,
							description: 'Total number of clients in organization',
						},
						page: { type: 'number', example: 1, description: 'Current page number' },
						limit: { type: 'number', example: 500, description: 'Records per page (admin default: 500)' },
						totalPages: { type: 'number', example: 3, description: 'Total number of pages available' },
					},
				},
				message: { type: 'string', example: 'All clients retrieved successfully for admin view' },
			},
		},
	})
	findAllForAdmin(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: GeneralStatus,
		@Query('search') search?: string,
	) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const filters = { status, search };

		// For admin purposes, we don't pass userId to bypass user-specific filtering
		return this.clientsService.findAll(
			page ? Number(page) : 1,
			limit ? Number(limit) : 500, // Higher default limit for admin purposes
			orgId,
			branchId,
			filters,
			undefined, // No userId = no user-specific filtering
		);
	}

	@Get()
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '📋 Get Clients (User Access)',
		description: `
# Get Clients - User View

Retrieves a paginated list of clients with user-specific filtering and role-based access control for daily operational use.

## 🔐 **Security & Permissions**
- **Role-Based Access**: Available to all authenticated users with appropriate permissions
- **User Filtering**: Results filtered based on user's assigned clients (for regular users)
- **Elevated Access**: Admins, Managers, and Supervisors see all clients in their organization
- **Organization Scope**: Results automatically filtered by user's organization
- **Branch Scope**: Results filtered by user's branch context

## 📋 **Use Cases**
- **Daily Operations**: View clients assigned to the current user
- **Sales Management**: Track and manage client relationships
- **Customer Service**: Access client information for support activities
- **Lead Management**: Monitor client status and conversion pipeline
- **Contact Management**: Maintain up-to-date client contact information
- **Task Planning**: Identify clients needing attention or follow-up

## 🔧 **Features**
- **Smart Filtering**: Automatically shows relevant clients based on user role
- **Advanced Search**: Search across client name, email, and phone number
- **Multi-Field Filtering**: Filter by status, category, and other client attributes
- **Pagination Support**: Efficient handling of large client lists
- **Real-time Data**: Up-to-date client information and status

## 📊 **Filtering & Search Options**
- **Status Filter**: Active, inactive, converted, leads, prospects
- **Category Filter**: Enterprise, SME, individual, or custom categories
- **Search Terms**: Full-text search across multiple client fields
- **Pagination**: Configurable page size with system defaults
- **Sort Order**: Results ordered by creation date (newest first)

## 👥 **User Role Behavior**
- **Regular Users**: See only assigned clients
- **Admins/Managers**: See all clients in organization
- **Supervisors**: See all clients in their branch
- **Support**: Access based on support assignment scope

## 💡 **Performance Features**
- **Intelligent Caching**: Frequently accessed data cached for speed
- **Optimized Queries**: Efficient database queries with proper indexing
- **Lazy Loading**: Load additional data as needed
- **Result Limiting**: Reasonable default page sizes for optimal performance
		`,
	})
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to system setting',
	})
	@ApiQuery({
		name: 'status',
		enum: GeneralStatus,
		required: false,
		description: 'Filter by client status',
	})
	@ApiQuery({
		name: 'category',
		type: String,
		required: false,
		description: 'Filter by client category',
	})
	@ApiQuery({
		name: 'search',
		type: String,
		required: false,
		description: 'Search term for client name, email, or phone',
	})
	@ApiOkResponse({
		description: '✅ Clients retrieved successfully with user-specific filtering',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 12345 },
							name: { type: 'string', example: 'Tech Solutions Ltd' },
							email: { type: 'string', example: 'info@techsolutions.co.za' },
							phone: { type: 'string', example: '+27 11 456 7890' },
							contactPerson: { type: 'string', example: 'Sarah Johnson' },
							status: { type: 'string', example: 'ACTIVE' },
							category: { type: 'string', example: 'enterprise' },
							industry: { type: 'string', example: 'Software Development' },
							assignedSalesRep: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 25 },
									name: { type: 'string', example: 'Mike Wilson' },
									email: { type: 'string', example: 'mike.wilson@company.co.za' },
								},
							},
							address: {
								type: 'object',
								properties: {
									street: { type: 'string', example: '456 Innovation Drive' },
									city: { type: 'string', example: 'Cape Town' },
									state: { type: 'string', example: 'Western Cape' },
									country: { type: 'string', example: 'South Africa' },
								},
							},
							lastVisitDate: { type: 'string', format: 'date-time', example: '2023-11-15T14:30:00Z' },
							nextContactDate: { type: 'string', format: 'date-time', example: '2023-12-20T09:00:00Z' },
							createdAt: { type: 'string', format: 'date-time', example: '2023-01-15T10:00:00Z' },
							lifetimeValue: { type: 'number', example: 250000 },
							tags: {
								type: 'array',
								items: { type: 'string' },
								example: ['High Priority', 'Tech Partner'],
							},
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 47, description: 'Total clients accessible to current user' },
						page: { type: 'number', example: 1, description: 'Current page number' },
						limit: { type: 'number', example: 20, description: 'Records per page' },
						totalPages: { type: 'number', example: 3, description: 'Total pages available' },
					},
				},
				message: { type: 'string', example: 'Clients retrieved successfully' },
			},
		},
	})
	findAll(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: GeneralStatus,
		@Query('category') category?: string,
		@Query('search') search?: string,
	) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const userId = req.user?.uid;
		const filters = { status, category, search };

		return this.clientsService.findAll(
			page ? Number(page) : 1,
			limit ? Number(limit) : Number(process.env.DEFAULT_PAGE_LIMIT),
			orgId,
			branchId,
			filters,
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
	)
	@ApiOperation({
		summary: '🔍 Get Client Details',
		description: `
# Get Client Details

Retrieves comprehensive information about a specific client including all related data such as contact details, sales history, tasks, and relationship information.

## 🔐 **Security & Permissions**
- **Role-Based Access**: Available to all authenticated users with client access permissions
- **Organization Scope**: Client must belong to user's organization
- **Branch Scope**: Filtered by user's branch context (if applicable)
- **Assignment Validation**: Regular users can only access their assigned clients

## 📋 **Use Cases**
- **Client Consultation**: Access complete client profile before meetings or calls
- **Customer Service**: Comprehensive client information for support interactions
- **Sales Planning**: Review client history and relationship data for sales strategies
- **Task Management**: View client-related tasks and upcoming activities
- **Lead Conversion**: Access detailed prospect information for conversion planning
- **Relationship Management**: Understand client engagement history and preferences

## 🔧 **Detailed Information Included**
- **Contact Information**: Complete contact details and communication preferences
- **Business Profile**: Company information, industry, size, and business context
- **Financial Data**: Credit limits, outstanding balances, lifetime value
- **Relationship Data**: Assigned sales rep, interaction history, task assignments
- **Geographic Data**: Address information and GPS coordinates (if available)
- **Sales History**: Past quotations, orders, and transaction history
- **Engagement Tracking**: Check-ins, visits, and communication records
- **Custom Fields**: Industry-specific or organization-specific data

## 📊 **Related Data Access**
- **Quotations**: All quotes generated for this client
- **Check-ins**: Location-based visit history
- **Tasks**: Assigned tasks and activity tracking
- **Communications**: Scheduled communications and preferences
- **Sales Pipeline**: Current opportunities and deal status

## 🔄 **Real-time Data**
- **Live Status**: Current client status and engagement level
- **Recent Activity**: Latest interactions and system updates
- **Upcoming Events**: Scheduled meetings, calls, and follow-ups
- **Alert Information**: Important notifications or action items

## 💡 **Advanced Features**
- **Relationship Mapping**: Connected contacts and stakeholder information
- **Geolocation**: Map integration for location-based services
- **Communication History**: Complete interaction timeline
- **Performance Metrics**: Client engagement and value analytics
		`,
	})
	@ApiParam({ name: 'ref', description: 'Client reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ Client details retrieved successfully with complete information',
		schema: {
			type: 'object',
			properties: {
				client: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'Tech Innovators Ltd' },
						contactPerson: { type: 'string', example: 'Emily Carter' },
						email: { type: 'string', example: 'emily.carter@techinnovators.co.za' },
						phone: { type: 'string', example: '+27 21 555 0199' },
						alternativePhone: { type: 'string', example: '+27 82 555 0199' },
						website: { type: 'string', example: 'https://www.techinnovators.co.za' },
						description: {
							type: 'string',
							example: 'Leading provider of innovative tech solutions for enterprises',
						},
						status: { type: 'string', example: 'ACTIVE' },
						category: { type: 'string', example: 'enterprise' },
						industry: { type: 'string', example: 'Technology' },
						companySize: { type: 'number', example: 150 },
						address: {
							type: 'object',
							properties: {
								street: { type: 'string', example: '789 Innovation Hub' },
								suburb: { type: 'string', example: 'Stellenbosch' },
								city: { type: 'string', example: 'Cape Town' },
								state: { type: 'string', example: 'Western Cape' },
								country: { type: 'string', example: 'South Africa' },
								postalCode: { type: 'string', example: '7600' },
							},
						},
						assignedSalesRep: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 33 },
								name: { type: 'string', example: 'David Thompson' },
								email: { type: 'string', example: 'david.thompson@company.co.za' },
								phone: { type: 'string', example: '+27 82 123 4567' },
							},
						},
						organisation: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'Your Organization' },
							},
						},
						branch: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 3 },
								name: { type: 'string', example: 'Cape Town Branch' },
							},
						},
						quotations: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 789 },
									title: { type: 'string', example: 'Q2024-001 - Enterprise Software License' },
									amount: { type: 'number', example: 125000 },
									status: { type: 'string', example: 'PENDING' },
									createdAt: { type: 'string', format: 'date-time' },
								},
							},
						},
						checkIns: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 456 },
									checkInTime: { type: 'string', format: 'date-time' },
									checkInLocation: { type: 'string', example: 'Client Office - Stellenbosch' },
									duration: { type: 'string', example: '2h 30m' },
								},
							},
						},
						creditLimit: { type: 'number', example: 500000 },
						outstandingBalance: { type: 'number', example: 75000 },
						lifetimeValue: { type: 'number', example: 850000 },
						priceTier: { type: 'string', example: 'ENTERPRISE' },
						preferredContactMethod: { type: 'string', example: 'EMAIL' },
						preferredLanguage: { type: 'string', example: 'English' },
						tags: {
							type: 'array',
							items: { type: 'string' },
							example: ['Strategic Account', 'High Value', 'Tech Partner'],
						},
						socialProfiles: {
							type: 'object',
							properties: {
								linkedin: { type: 'string', example: 'https://linkedin.com/company/techinnovators' },
								twitter: { type: 'string', example: 'https://twitter.com/techinnovators_za' },
							},
						},
						customFields: {
							type: 'object',
							properties: {
								primaryTechnology: { type: 'string', example: 'Cloud Computing' },
								complianceLevel: { type: 'string', example: 'Enterprise Grade' },
							},
						},
						createdAt: { type: 'string', format: 'date-time', example: '2023-01-15T10:00:00Z' },
						updatedAt: { type: 'string', format: 'date-time', example: '2023-11-20T14:30:00Z' },
						lastVisitDate: { type: 'string', format: 'date-time', example: '2023-11-15T09:00:00Z' },
						nextContactDate: { type: 'string', format: 'date-time', example: '2023-12-15T10:00:00Z' },
					},
				},
				message: { type: 'string', example: 'Client details retrieved successfully' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Client not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client not found' },
				client: { type: 'null' },
			},
		},
	})
	findOne(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.findOne(ref, orgId, branchId);
	}

	@Patch(':ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '✏️ Update Client Information',
		description: `
# Update Client Information

Updates an existing client with new information, handles lead conversion, and manages communication schedules with comprehensive email notifications.

## 🔐 **Security & Permissions**
- **Role-Based Access**: Available to users with client management permissions
- **Organization Scope**: Can only update clients within user's organization
- **Branch Scope**: Filtered by user's branch context (if applicable)
- **Assignment Validation**: Regular users can only update their assigned clients

## 📋 **Use Cases**
- **Profile Updates**: Modify client contact information and business details
- **Lead Conversion**: Convert prospects to active clients with status updates
- **Relationship Management**: Update assigned sales representatives and ownership
- **Financial Updates**: Modify credit limits, pricing tiers, and payment terms
- **Communication Preferences**: Update contact methods and communication schedules
- **Business Intelligence**: Update industry, company size, and business metrics
- **Geographic Updates**: Modify address information and geofencing settings

## 🔄 **Special Operations**
- **Lead Conversion**: Setting status to 'CONVERTED' triggers automated email notifications
- **Schedule Management**: Update or replace communication schedules
- **Status Transitions**: Handle client lifecycle status changes
- **Assignment Changes**: Transfer client ownership between team members

## 📧 **Email Notifications**
When converting a lead to client (status = 'CONVERTED'):
- **Client Welcome**: Professional welcome email with onboarding information
- **Sales Rep Notification**: Alert assigned sales rep about successful conversion
- **Admin Notification**: Notify management about new client acquisition

## 🔧 **Updatable Fields**
- **Contact Information**: Name, email, phone, contact person, website
- **Business Profile**: Description, industry, company size, annual revenue
- **Financial Data**: Credit limits, pricing tiers, payment terms, discounts
- **Address Information**: Complete address details with GPS coordinates
- **Relationship Data**: Assigned sales rep, tags, custom fields
- **Communication Preferences**: Contact methods, languages, schedules
- **Marketing Data**: Acquisition channel, customer satisfaction scores
- **System Fields**: Status, category, visibility settings

## 💡 **Advanced Features**
- **Geofencing Updates**: Modify location-based service settings
- **Communication Schedules**: Bulk update or replace communication preferences
- **Custom Fields**: Update industry-specific or organization-specific data
- **Social Profiles**: Update social media and online presence information
- **Relationship Mapping**: Update connected contacts and stakeholder information

## ⚠️ **Important Notes**
- **Partial Updates**: Only provided fields are updated, others remain unchanged
- **Validation**: All updates subject to business rule validation
- **Audit Trail**: All changes logged for compliance and tracking
- **Cache Invalidation**: Updated data immediately available across system
		`,
	})
	@ApiParam({ name: 'ref', description: 'Client unique identifier or reference number', type: 'number' })
	@ApiBody({
		type: UpdateClientDto,
		description: 'Client update payload with fields to be modified',
		examples: {
			contactUpdate: {
				summary: '📞 Contact Information Update',
				description: 'Update client contact details and communication preferences',
				value: {
					phone: '+27 11 999 8888',
					alternativePhone: '+27 82 999 8888',
					website: 'https://www.updatedclient.co.za',
					contactPerson: 'Updated Contact Person',
					preferredContactMethod: 'WHATSAPP',
				},
			},
			leadConversion: {
				summary: '🎯 Lead to Client Conversion',
				description: 'Convert a lead to an active client with email notifications',
				value: {
					status: 'CONVERTED',
					assignedSalesRep: { uid: 25 },
					priceTier: 'STANDARD',
					creditLimit: 100000,
					preferredContactMethod: 'EMAIL',
					tags: ['Converted Lead', 'New Client'],
				},
			},
			businessUpdate: {
				summary: '🏢 Business Profile Update',
				description: 'Update comprehensive business information and metrics',
				value: {
					description: 'Updated company description with expanded services',
					industry: 'Financial Technology',
					companySize: 300,
					annualRevenue: 15000000,
					address: {
						street: '456 New Business District',
						suburb: 'Sandton City',
						city: 'Johannesburg',
						state: 'Gauteng',
						country: 'South Africa',
						postalCode: '2196',
					},
				},
			},
			communicationSchedules: {
				summary: '📅 Communication Schedule Update',
				description: 'Update client communication preferences and schedules',
				value: {
					communicationSchedules: [
						{
							communicationType: 'PHONE_CALL',
							frequency: 'MONTHLY',
							preferredTime: '10:00',
							preferredDays: [1, 3, 5],
							isActive: true,
							notes: 'Monthly business review calls',
						},
					],
				},
			},
			financialUpdate: {
				summary: '💰 Financial Information Update',
				description: 'Update credit limits, pricing tiers, and financial data',
				value: {
					creditLimit: 750000,
					priceTier: 'ENTERPRISE',
					paymentTerms: 'Net 45',
					discountPercentage: 15,
					lifetimeValue: 1200000,
				},
			},
		},
	})
	@ApiOkResponse({
		description: '✅ Client updated successfully with optional conversion notifications',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client updated successfully' },
				data: {
					type: 'object',
					properties: {
						clientId: { type: 'number', example: 12345 },
						updatedFields: {
							type: 'array',
							items: { type: 'string' },
							example: ['phone', 'status', 'assignedSalesRep', 'communicationSchedules'],
						},
						conversionTriggered: {
							type: 'boolean',
							example: true,
							description: 'True if lead was converted to client',
						},
						emailsSent: {
							type: 'object',
							properties: {
								clientWelcome: { type: 'boolean', example: true },
								salesRepNotification: { type: 'boolean', example: true },
							},
						},
						lastUpdated: { type: 'string', format: 'date-time', example: '2023-12-01T15:30:00Z' },
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Client not found or access denied',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Client not found or you do not have permission to update this client',
				},
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				context: {
					type: 'object',
					properties: {
						clientId: { type: 'number', example: 12345 },
						organizationId: { type: 'number', example: 1 },
						branchId: { type: 'number', example: 3 },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid data or validation errors',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for client update' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Email must be a valid email address',
						'Credit limit cannot be negative',
						'Assigned sales rep does not exist',
						'Communication schedule frequency is invalid',
					],
				},
				rejectedFields: {
					type: 'array',
					items: { type: 'string' },
					example: ['invalidEmailFormat', 'negativeCredit'],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions for client update',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'You do not have permission to update clients in this organization',
				},
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				requiredPermissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['CLIENT_UPDATE', 'ORGANIZATION_ACCESS'],
				},
			},
		},
	})
	update(@Param('ref') ref: number, @Body() updateClientDto: UpdateClientDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.update(ref, updateClientDto, orgId, branchId);
	}

	@Patch('restore/:ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '🔄 Restore Deleted Client',
		description: `
# Restore Deleted Client

Restores a previously soft-deleted client back to active status, recovering all associated data and relationships.

## 🔐 **Security & Permissions**
- **Role-Based Access**: Available to users with client management permissions
- **Organization Scope**: Can only restore clients within user's organization
- **Branch Scope**: Filtered by user's branch context (if applicable)
- **Assignment Validation**: Regular users can only restore their assigned clients

## 📋 **Use Cases**
- **Accidental Deletion Recovery**: Restore clients that were deleted by mistake
- **Data Recovery**: Recover client data after administrative cleanup
- **Relationship Restoration**: Restore client relationships and history
- **Compliance Requirements**: Restore clients for audit or legal purposes
- **Business Continuity**: Recover critical client relationships
- **Customer Reactivation**: Restore former clients returning to business

## 🔧 **Restoration Process**
- **Data Integrity**: All client data and relationships are preserved during restoration
- **Status Reset**: Client status automatically set to ACTIVE upon restoration
- **Relationship Recovery**: All associated data (tasks, quotations, check-ins) restored
- **Cache Invalidation**: Updated data immediately available across the system
- **Audit Trail**: Restoration logged for compliance and tracking

## 📊 **What Gets Restored**
- **Client Profile**: Complete client information and business details
- **Contact Information**: All communication details and preferences
- **Financial Data**: Credit limits, payment terms, and financial history
- **Relationship Data**: Sales rep assignments and team relationships
- **Communication Schedules**: All scheduled communications and preferences
- **Historical Data**: Past interactions, visits, and engagement history
- **Custom Fields**: Organization-specific and industry-specific data

## 🔄 **System Impact**
- **Immediate Availability**: Client becomes immediately accessible to authorized users
- **Search Indexing**: Client re-added to search and filtering results
- **Reporting**: Client data included in reports and analytics
- **Workflow Integration**: Client available for tasks and automation
- **Permission Inheritance**: All access permissions restored based on current assignments

## ⚠️ **Important Notes**
- **Permanent Action**: Restoration cannot be undone without administrative intervention
- **Data Validation**: Restored data validated against current business rules
- **Relationship Verification**: Associated users and assignments verified for validity
- **Backup Consideration**: Consider creating backup before restoration if needed
		`,
	})
	@ApiParam({ name: 'ref', description: 'Client reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ Client restored successfully with all associated data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client restored successfully' },
				data: {
					type: 'object',
					properties: {
						clientId: { type: 'number', example: 12345 },
						clientName: { type: 'string', example: 'Restored Client Ltd' },
						restoredAt: { type: 'string', format: 'date-time', example: '2023-12-01T16:00:00Z' },
						previousStatus: { type: 'string', example: 'DELETED' },
						newStatus: { type: 'string', example: 'ACTIVE' },
						dataIntegrity: {
							type: 'object',
							properties: {
								quotationsRestored: { type: 'number', example: 5 },
								checkInsRestored: { type: 'number', example: 12 },
								tasksRestored: { type: 'number', example: 8 },
								communicationSchedulesRestored: { type: 'number', example: 3 },
							},
						},
						accessPermissions: {
							type: 'object',
							properties: {
								searchable: { type: 'boolean', example: true },
								reportingIncluded: { type: 'boolean', example: true },
								workflowEnabled: { type: 'boolean', example: true },
							},
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Client not found or not in deleted state',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client not found or is not in deleted state' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				context: {
					type: 'object',
					properties: {
						clientId: { type: 'number', example: 12345 },
						currentStatus: { type: 'string', example: 'ACTIVE' },
						reason: { type: 'string', example: 'Client is not deleted and cannot be restored' },
					},
				},
			},
		},
	})
	restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.restore(ref, orgId, branchId);
	}

	@Delete(':ref')
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
		summary: '🗑️ Soft Delete Client',
		description: `
# Soft Delete Client

Marks a client as deleted without permanently removing data from the database, allowing for future restoration while maintaining data integrity.

## 🔐 **Security & Permissions**
- **Role-Based Access**: Available to users with client management permissions
- **Organization Scope**: Can only delete clients within user's organization
- **Branch Scope**: Filtered by user's branch context (if applicable)
- **Assignment Validation**: Regular users can only delete their assigned clients

## 📋 **Use Cases**
- **Client Deactivation**: Temporarily remove inactive clients from active lists
- **Data Cleanup**: Archive old or obsolete client records
- **Compliance Management**: Remove clients for GDPR or data retention compliance
- **Business Restructuring**: Archive clients during business reorganization
- **Relationship Termination**: Remove clients who are no longer served
- **System Maintenance**: Clean up duplicate or test client records

## 🔧 **Soft Delete Process**
- **Data Preservation**: Client data remains in database for potential restoration
- **Visibility Control**: Client removed from standard searches and lists
- **Relationship Maintenance**: Associated data (tasks, quotations) preserved
- **Audit Trail**: Deletion logged with timestamp and user information
- **Reversible Action**: Client can be restored using the restore endpoint

## 📊 **What Gets Hidden**
- **Search Results**: Client excluded from standard client searches
- **User Lists**: Client removed from user-assigned client lists
- **Reports**: Client excluded from standard reporting (unless specifically included)
- **Workflow**: Client removed from active workflow and automation
- **Dashboard**: Client metrics excluded from dashboard statistics

## 🔄 **System Impact**
- **Immediate Effect**: Client becomes immediately inaccessible to standard operations
- **Cache Invalidation**: All cached client data cleared across the system
- **Related Data**: Associated tasks, quotations, and schedules remain but are linked to deleted client
- **Reporting**: Historical data preserved for compliance and audit purposes
- **User Assignments**: Client removed from user assignment lists

## ⚠️ **Important Notes**
- **Soft Delete**: Data not permanently removed - use restore endpoint to recover
- **Compliance**: Ensure deletion complies with data retention policies
- **Related Data**: Consider impact on quotations, tasks, and schedules
- **User Notification**: Consider notifying assigned users about client deletion
- **Backup**: Consider creating backup before deletion for critical clients

## 🔄 **Restoration Options**
- **Restore Endpoint**: Use PATCH /clients/restore/:ref to restore deleted client
- **Admin Recovery**: Administrators can restore deleted clients at any time
- **Data Integrity**: All data relationships preserved during soft delete period
		`,
	})
	@ApiParam({ name: 'ref', description: 'Client reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ Client soft-deleted successfully with data preservation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client deleted successfully' },
				data: {
					type: 'object',
					properties: {
						clientId: { type: 'number', example: 12345 },
						clientName: { type: 'string', example: 'Deleted Client Ltd' },
						deletedAt: { type: 'string', format: 'date-time', example: '2023-12-01T17:00:00Z' },
						deletedBy: { type: 'string', example: 'John Smith' },
						previousStatus: { type: 'string', example: 'ACTIVE' },
						newStatus: { type: 'string', example: 'DELETED' },
						dataPreservation: {
							type: 'object',
							properties: {
								quotationsPreserved: { type: 'number', example: 5 },
								checkInsPreserved: { type: 'number', example: 12 },
								tasksPreserved: { type: 'number', example: 8 },
								communicationSchedulesPreserved: { type: 'number', example: 3 },
							},
						},
						restorationInfo: {
							type: 'object',
							properties: {
								canBeRestored: { type: 'boolean', example: true },
								restoreEndpoint: { type: 'string', example: 'PATCH /clients/restore/12345' },
								retentionPeriod: { type: 'string', example: 'Indefinite (until manually removed)' },
							},
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Client not found or already deleted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client not found or is already deleted' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				context: {
					type: 'object',
					properties: {
						clientId: { type: 'number', example: 12345 },
						currentStatus: { type: 'string', example: 'DELETED' },
						reason: { type: 'string', example: 'Client is already in deleted state' },
					},
				},
			},
		},
	})
	remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.remove(ref, orgId, branchId);
	}

	@Get('nearby')
	@ApiOperation({
		summary: '🗺️ Find Nearby Clients',
		description: `
# Find Nearby Clients

Discovers clients within a specified radius of given GPS coordinates, enabling location-based services and route optimization for field operations.

## 🔐 **Security & Permissions**
- **Role-Based Access**: Available to all authenticated users with client access permissions
- **Organization Scope**: Only finds clients within user's organization
- **Branch Scope**: Filtered by user's branch context (if applicable)
- **Assignment Validation**: Regular users see only their assigned clients in results

## 📋 **Use Cases**
- **Field Service**: Find clients near a technician's current location
- **Route Optimization**: Plan efficient client visit routes
- **Emergency Response**: Locate clients in emergency situations
- **Sales Territory**: Identify clients within a sales representative's area
- **Service Delivery**: Optimize service delivery routes and schedules
- **Customer Meetings**: Find clients near a meeting location
- **Territory Management**: Understand client distribution across geographic areas

## 🔧 **Location Features**
- **GPS Coordinate Search**: Search based on latitude and longitude
- **Radius Filtering**: Configurable search radius (default: 5km)
- **Distance Calculation**: Accurate distance calculation using Haversine formula
- **Sorted Results**: Clients sorted by distance from search point
- **Address Validation**: Only includes clients with valid GPS coordinates
- **Real-time Data**: Up-to-date client location information

## 📊 **Search Parameters**
- **Latitude**: GPS latitude coordinate (-90 to 90)
- **Longitude**: GPS longitude coordinate (-180 to 180)
- **Radius**: Search radius in kilometers (default: 5km, max: 50km)
- **Organization ID**: Filter by specific organization (optional)
- **Branch ID**: Filter by specific branch (optional)

## 🗺️ **Geographic Calculations**
- **Haversine Formula**: Accurate distance calculation considering Earth's curvature
- **Kilometer Precision**: Distance calculated to 3 decimal places
- **Coordinate Validation**: Input validation for valid GPS coordinates
- **Radius Constraints**: Reasonable limits to prevent excessive searches

## 💡 **Advanced Features**
- **Geofencing Integration**: Respects client geofencing settings
- **Address Geocoding**: Converts addresses to coordinates where needed
- **Map Integration**: Results compatible with mapping services
- **Mobile Optimization**: Optimized for mobile device location services
- **Batch Processing**: Efficient handling of large client datasets

## ⚠️ **Important Notes**
- **Privacy**: Only returns clients user has permission to access
- **Accuracy**: Distance calculations approximate - actual travel distance may vary
- **Data Quality**: Results depend on accuracy of client GPS coordinates
- **Performance**: Large radius searches may impact performance
		`,
	})
	@ApiOkResponse({
		description: '✅ Nearby clients found and sorted by distance',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Nearby clients retrieved successfully' },
				clients: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 12345 },
							name: { type: 'string', example: 'Nearby Client Ltd' },
							contactPerson: { type: 'string', example: 'Jane Doe' },
							email: { type: 'string', example: 'jane.doe@nearbyclient.co.za' },
							phone: { type: 'string', example: '+27 11 555 0123' },
							distance: {
								type: 'number',
								example: 2.34,
								description: 'Distance in kilometers from search point',
							},
							latitude: { type: 'number', example: -26.195246 },
							longitude: { type: 'number', example: 28.034088 },
							address: {
								type: 'object',
								properties: {
									street: { type: 'string', example: '123 Nearby Street' },
									suburb: { type: 'string', example: 'Sandton' },
									city: { type: 'string', example: 'Johannesburg' },
									state: { type: 'string', example: 'Gauteng' },
									postalCode: { type: 'string', example: '2196' },
								},
							},
							status: { type: 'string', example: 'ACTIVE' },
							category: { type: 'string', example: 'enterprise' },
							assignedSalesRep: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 25 },
									name: { type: 'string', example: 'Sales Rep' },
									phone: { type: 'string', example: '+27 82 555 0123' },
								},
							},
							lastVisitDate: { type: 'string', format: 'date-time', example: '2023-11-15T10:00:00Z' },
							nextScheduledVisit: {
								type: 'string',
								format: 'date-time',
								example: '2023-12-20T14:00:00Z',
							},
							tags: {
								type: 'array',
								items: { type: 'string' },
								example: ['Priority', 'Regular Service'],
							},
							geofenceEnabled: { type: 'boolean', example: true },
							geofenceRadius: {
								type: 'number',
								example: 200,
								description: 'Client geofence radius in meters',
							},
						},
					},
				},
				searchInfo: {
					type: 'object',
					properties: {
						searchCenter: {
							type: 'object',
							properties: {
								latitude: { type: 'number', example: -26.195246 },
								longitude: { type: 'number', example: 28.034088 },
							},
						},
						searchRadius: { type: 'number', example: 5, description: 'Search radius in kilometers' },
						resultsCount: { type: 'number', example: 3 },
						maxDistance: {
							type: 'number',
							example: 4.87,
							description: 'Distance to furthest client in results',
						},
						averageDistance: {
							type: 'number',
							example: 2.45,
							description: 'Average distance of all results',
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid coordinates or search parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid coordinates or radius provided' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Latitude must be between -90 and 90',
						'Longitude must be between -180 and 180',
						'Radius must be between 0.1 and 50 kilometers',
						'Coordinates must be valid decimal numbers',
					],
				},
				providedValues: {
					type: 'object',
					properties: {
						latitude: { type: 'number', example: 91.5 },
						longitude: { type: 'number', example: 200.1 },
						radius: { type: 'number', example: 100 },
					},
				},
			},
		},
	})
	findNearbyClients(
		@Query('latitude') latitude: number,
		@Query('longitude') longitude: number,
		@Query('radius') radius: number = 5,
		@Query('orgId') orgId?: number,
		@Query('branchId') branchId?: number,
	) {
		return this.clientsService.findNearbyClients(latitude, longitude, radius, orgId, branchId);
	}

	@Get(':clientId/check-ins')
	@ApiOperation({
		summary: '🕐 Get Client Check-in History',
		description: `
# Get Client Check-in History

Retrieves comprehensive check-in history with location data, visit duration, and engagement metrics for a specific client.

## 🔐 **Security & Permissions**
- **Role-Based Access**: Available to users with client access permissions
- **Organization Scope**: Client must belong to user's organization
- **Branch Scope**: Filtered by user's branch context (if applicable)
- **Assignment Validation**: Regular users can only access check-ins for their assigned clients

## 📋 **Use Cases**
- **Visit Tracking**: Monitor field representative visits to client locations
- **Service History**: Track service delivery and support visit history
- **Engagement Analysis**: Analyze client engagement patterns and frequency
- **Time Management**: Review visit duration and efficiency metrics
- **Compliance Monitoring**: Ensure required client visits are being conducted
- **Territory Management**: Understand field team coverage and client attention
- **Billing Verification**: Validate billable hours and service delivery

## 🔧 **Check-in Data Included**
- **Visit Details**: Check-in and check-out timestamps with duration
- **Location Information**: GPS coordinates and address details
- **Team Member**: User who conducted the check-in
- **Purpose**: Visit purpose and activity type
- **Notes**: Visit notes and observations
- **Attachments**: Photos, documents, or other media from the visit
- **Status**: Check-in status and completion state

## 📊 **Historical Insights**
- **Visit Frequency**: How often client is visited
- **Average Duration**: Typical visit length and engagement time
- **Location Patterns**: Where visits typically occur
- **Team Engagement**: Which team members visit most frequently
- **Timing Analysis**: Optimal visit times and patterns
- **Service Consistency**: Regular vs. irregular visit patterns

## 📈 **Metrics & Analytics**
- **Total Visits**: Complete count of all check-ins
- **Visit Duration**: Average and total time spent with client
- **Last Visit**: Most recent client interaction
- **Visit Trends**: Increasing or decreasing visit frequency
- **Engagement Score**: Client attention and service level metrics
- **Geographic Distribution**: Visit location patterns and coverage

## 🗓️ **Chronological View**
- **Sorted by Date**: Most recent check-ins first
- **Time Range**: Complete historical record
- **Visit Patterns**: Weekly, monthly, and seasonal patterns
- **Milestone Tracking**: Important visit milestones and achievements
- **Comparative Analysis**: Visit frequency compared to other clients

## 💡 **Advanced Features**
- **Geofencing Integration**: Verify visits within client geofence areas
- **Route Optimization**: Understand visit efficiency and travel patterns
- **Mobile Integration**: Optimized for mobile check-in applications
- **Offline Capability**: Support for offline check-in synchronization
- **Photo Documentation**: Visual documentation of visits and services
		`,
	})
	@ApiParam({ name: 'clientId', description: 'Client ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ Client check-in history retrieved successfully with comprehensive data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client check-in history retrieved successfully' },
				checkIns: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 789 },
							checkInTime: { type: 'string', format: 'date-time', example: '2023-11-20T09:00:00Z' },
							checkInLocation: {
								type: 'string',
								example: 'Client Office - 123 Business Street, Sandton',
							},
							checkInCoordinates: {
								type: 'object',
								properties: {
									latitude: { type: 'number', example: -26.195246 },
									longitude: { type: 'number', example: 28.034088 },
								},
							},
							checkOutTime: {
								type: 'string',
								format: 'date-time',
								example: '2023-11-20T11:30:00Z',
								nullable: true,
							},
							checkOutLocation: {
								type: 'string',
								example: 'Client Office - 123 Business Street, Sandton',
								nullable: true,
							},
							duration: { type: 'string', example: '2h 30m', nullable: true },
							visitPurpose: { type: 'string', example: 'Monthly business review and service check' },
							visitType: { type: 'string', example: 'SCHEDULED_VISIT' },
							status: { type: 'string', example: 'COMPLETED' },
							owner: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 25 },
									name: { type: 'string', example: 'John Smith' },
									email: { type: 'string', example: 'john.smith@company.co.za' },
									phone: { type: 'string', example: '+27 82 555 0123' },
								},
							},
							notes: {
								type: 'string',
								example: 'Client satisfied with service. Discussed upcoming project requirements.',
							},
							attachments: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 456 },
										filename: { type: 'string', example: 'client_meeting_photo.jpg' },
										fileType: { type: 'string', example: 'image/jpeg' },
										url: {
											type: 'string',
											example: 'https://storage.company.com/attachments/456.jpg',
										},
									},
								},
							},
							activities: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										activity: { type: 'string', example: 'Equipment maintenance' },
										duration: { type: 'string', example: '45 minutes' },
										completed: { type: 'boolean', example: true },
									},
								},
							},
							geofenceValidation: {
								type: 'object',
								properties: {
									withinGeofence: { type: 'boolean', example: true },
									distance: {
										type: 'number',
										example: 45,
										description: 'Distance from client location in meters',
									},
									accuracy: { type: 'number', example: 5, description: 'GPS accuracy in meters' },
								},
							},
							weather: {
								type: 'object',
								properties: {
									temperature: { type: 'number', example: 22 },
									conditions: { type: 'string', example: 'Partly cloudy' },
								},
							},
							createdAt: { type: 'string', format: 'date-time', example: '2023-11-20T09:00:00Z' },
							updatedAt: { type: 'string', format: 'date-time', example: '2023-11-20T11:30:00Z' },
						},
					},
				},
				analytics: {
					type: 'object',
					properties: {
						totalCheckIns: { type: 'number', example: 24 },
						totalVisitTime: { type: 'string', example: '48h 30m' },
						averageVisitDuration: { type: 'string', example: '2h 1m' },
						lastVisit: { type: 'string', format: 'date-time', example: '2023-11-20T09:00:00Z' },
						visitFrequency: { type: 'string', example: 'Bi-weekly' },
						mostActiveUser: {
							type: 'object',
							properties: {
								name: { type: 'string', example: 'John Smith' },
								visits: { type: 'number', example: 18 },
							},
						},
						engagementScore: {
							type: 'number',
							example: 8.5,
							description: 'Client engagement score out of 10',
						},
						lastMonth: {
							type: 'object',
							properties: {
								visits: { type: 'number', example: 4 },
								totalTime: { type: 'string', example: '8h 15m' },
							},
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Client not found or access denied',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Client not found or you do not have permission to access this client',
				},
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				context: {
					type: 'object',
					properties: {
						clientId: { type: 'number', example: 12345 },
						userId: { type: 'number', example: 25 },
						organizationId: { type: 'number', example: 1 },
					},
				},
			},
		},
	})
	getClientCheckIns(@Param('clientId') clientId: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.getClientCheckIns(clientId, orgId, branchId);
	}

	@Patch('profile')
	@Roles(AccessLevel.CLIENT)
	@ApiOperation({
		summary: '✏️ Update client profile (Client Portal)',
		description: `
# Update Client Profile

Allows authenticated clients to update their own profile information through the client portal.

## 🔐 **Security & Permissions**
- **Client-Only Access**: Only authenticated clients can access this endpoint
- **Self-Update Only**: Clients can only update their own profile data
- **Organization Validation**: Ensures client belongs to the correct organization
- **JWT Token Validation**: Validates client authentication through portal credentials

## 📧 **Email Notifications**
After successful profile update:
- **Admin Notification**: Organization administrators receive notification of client profile changes
- **Client Confirmation**: Client receives congratulatory email for maintaining complete profile

## 📝 **Updatable Fields**
Clients can update the following information:
- **Contact Information**: Phone numbers, alternative contacts, website
- **Company Details**: Description, industry, company size
- **Communication Preferences**: Preferred contact method, language
- **Address Information**: Complete business address details
- **Social Media**: Professional social media profiles

## ⚠️ **Restrictions**
- Cannot change: Name, email, organization, branch assignments
- Cannot modify: Financial data, credit limits, pricing tiers
- Cannot update: Sales rep assignments, internal tags, risk levels

## 🔄 **Process Flow**
1. Validate client authentication and permissions
2. Extract client ID from JWT token
3. Update allowed profile fields
4. Send admin notification email
5. Send client confirmation email
6. Return success response
	`,
	})
	@ApiBody({
		type: UpdateClientDto,
		description: 'Client profile update payload with allowed fields only',
		examples: {
			basicUpdate: {
				summary: '📞 Contact Information Update',
				description: 'Update contact details and communication preferences',
				value: {
					phone: '+27 11 987 6543',
					alternativePhone: '+27 82 987 6543',
					website: 'https://www.updatedcompany.co.za',
					preferredContactMethod: 'WHATSAPP',
					preferredLanguage: 'English',
				},
			},
			companyUpdate: {
				summary: '🏢 Company Information Update',
				description: 'Update company description and business details',
				value: {
					description:
						'Leading provider of innovative business solutions with 15 years of industry experience',
					industry: 'Business Consulting',
					companySize: 75,
					address: {
						street: '789 Updated Business Avenue',
						suburb: 'Rosebank',
						city: 'Johannesburg',
						state: 'Gauteng',
						country: 'South Africa',
						postalCode: '2196',
					},
				},
			},
			socialUpdate: {
				summary: '🌐 Social Media & Online Presence',
				description: 'Update digital presence and social media profiles',
				value: {
					website: 'https://www.newcompanysite.co.za',
					socialProfiles: {
						linkedin: 'https://linkedin.com/company/newcompany',
						twitter: 'https://twitter.com/newcompany_za',
						facebook: 'https://facebook.com/newcompany',
					},
				},
			},
		},
	})
	@ApiOkResponse({
		description: '✅ Client profile updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client profile updated successfully' },
				data: {
					type: 'object',
					properties: {
						clientId: { type: 'number', example: 12345 },
						updatedFields: {
							type: 'array',
							items: { type: 'string' },
							example: ['phone', 'website', 'description', 'address'],
						},
						lastUpdated: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid data or unauthorized field update',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot update restricted fields: email, organization' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				restrictedFields: {
					type: 'array',
					items: { type: 'string' },
					example: ['email', 'name', 'organisation', 'branch', 'creditLimit', 'priceTier'],
				},
			},
		},
	})
	@ApiUnauthorizedResponse({
		description: '🔒 Unauthorized - Invalid client authentication',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid client credentials or expired session' },
				error: { type: 'string', example: 'Unauthorized' },
				statusCode: { type: 'number', example: 401 },
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Not a client or insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Access denied. This endpoint is for client portal users only.' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
			},
		},
	})
	@ApiNotFoundResponse({
		description: '📭 Not Found - Client profile not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client profile not found or organization mismatch' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - System malfunction',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to update client profile due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
			},
		},
	})
	updateClientProfile(@Body() updateClientDto: UpdateClientDto, @Req() req: AuthenticatedRequest) {
		// Extract client auth ID from JWT token (this is the ClientAuth.uid, not Client.uid)
		const clientAuthId = req.user?.uid;
		const organisationRef = req.user?.organisationRef;

		if (!clientAuthId) {
			throw new Error('Client authentication ID not found in token');
		}

		return this.clientsService.updateClientProfile(clientAuthId, updateClientDto, organisationRef);
	}

	@Post('test-task-generation')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🧪 Test Communication Task Generation',
		description: `
# Test Communication Task Generation

Manually triggers the automated communication task generation cron job for testing, debugging, and immediate task creation purposes.

## 🔐 **Security & Permissions**
- **Admin-Only Access**: Restricted to Admin, Manager, Developer, and Owner roles
- **System-Level Operation**: Affects all clients with active communication schedules
- **Organization Scope**: Operates within the user's organization context
- **Audit Logging**: All manual task generation events are logged for compliance

## 📋 **Use Cases**
- **Testing**: Verify communication task generation logic during development
- **Debugging**: Troubleshoot issues with automated task scheduling
- **Immediate Generation**: Create tasks without waiting for scheduled cron job
- **System Recovery**: Recover from failed automated task generation
- **Maintenance**: Generate tasks after system maintenance or updates
- **Development**: Test new features related to communication scheduling

## 🔧 **Generation Process**
- **Schedule Processing**: Processes all active communication schedules
- **3-Month Window**: Generates tasks for the next 3 months
- **Duplicate Prevention**: Prevents creation of duplicate tasks
- **User Assignment**: Assigns tasks to designated team members
- **Email Notifications**: Sends task creation notifications to assigned users
- **Status Updates**: Updates next scheduled dates for communication schedules

## 📊 **What Gets Generated**
- **Communication Tasks**: Tasks for phone calls, emails, visits, video calls
- **Task Assignments**: Proper assignment to designated team members
- **Schedule Updates**: Next scheduled dates updated for all processed schedules
- **Email Notifications**: Users notified about newly created tasks
- **Calendar Integration**: Tasks integrated with user calendars and workflows

## 🔄 **Process Flow**
1. **Schedule Retrieval**: Fetch all active communication schedules
2. **Date Calculation**: Calculate task dates for 3-month window
3. **Duplicate Check**: Verify no duplicate tasks exist
4. **Task Creation**: Create tasks using TasksService
5. **User Notification**: Send email notifications to assigned users
6. **Schedule Update**: Update next scheduled dates
7. **Result Summary**: Return generation statistics

## 📈 **Performance Considerations**
- **Batch Processing**: Handles large numbers of schedules efficiently
- **Error Handling**: Continues processing even if individual tasks fail
- **Resource Management**: Optimized for minimal system impact
- **Timeout Protection**: Prevents long-running operations from blocking system

## ⚠️ **Important Notes**
- **Production Impact**: Use carefully in production environments
- **Duplicate Prevention**: System prevents duplicate task creation
- **Email Volume**: May trigger multiple notification emails
- **System Load**: Can cause temporary increase in system activity
- **Backup Recommended**: Consider system backup before manual generation

## 🔄 **Expected Results**
- **Task Creation**: New tasks created for upcoming communication requirements
- **User Assignments**: Tasks properly assigned to team members
- **Email Notifications**: Users receive task creation notifications
- **Schedule Updates**: Communication schedules updated with next dates
- **System Integration**: Tasks integrated with existing workflows
		`,
	})
	@ApiCreatedResponse({
		description: '✅ Communication task generation completed successfully with detailed results',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Communication task generation completed successfully' },
				data: {
					type: 'object',
					properties: {
						executionTime: {
							type: 'number',
							example: 2847,
							description: 'Total execution time in milliseconds',
						},
						processedSchedules: {
							type: 'number',
							example: 45,
							description: 'Number of communication schedules processed',
						},
						tasksCreated: { type: 'number', example: 127, description: 'Total number of tasks created' },
						usersNotified: {
							type: 'number',
							example: 12,
							description: 'Number of users who received email notifications',
						},
						scheduleBreakdown: {
							type: 'object',
							properties: {
								phoneCall: { type: 'number', example: 35, description: 'Phone call tasks created' },
								email: { type: 'number', example: 28, description: 'Email tasks created' },
								inPersonVisit: {
									type: 'number',
									example: 22,
									description: 'In-person visit tasks created',
								},
								videoCall: { type: 'number', example: 18, description: 'Video call tasks created' },
								whatsapp: { type: 'number', example: 15, description: 'WhatsApp tasks created' },
								sms: { type: 'number', example: 9, description: 'SMS tasks created' },
							},
						},
						timeWindow: {
							type: 'object',
							properties: {
								startDate: { type: 'string', format: 'date', example: '2023-12-01' },
								endDate: { type: 'string', format: 'date', example: '2024-03-01' },
								windowDays: {
									type: 'number',
									example: 91,
									description: 'Number of days in generation window',
								},
							},
						},
						userTaskDistribution: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									userId: { type: 'number', example: 25 },
									userName: { type: 'string', example: 'John Smith' },
									tasksAssigned: { type: 'number', example: 18 },
									emailSent: { type: 'boolean', example: true },
								},
							},
						},
						errors: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									scheduleId: { type: 'number', example: 123 },
									clientName: { type: 'string', example: 'Failed Client Ltd' },
									error: { type: 'string', example: 'Invalid communication type specified' },
									timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:30:00Z' },
								},
							},
						},
						performanceMetrics: {
							type: 'object',
							properties: {
								averageTasksPerSchedule: { type: 'number', example: 2.82 },
								processingRate: {
									type: 'number',
									example: 15.8,
									description: 'Schedules processed per second',
								},
								successRate: {
									type: 'number',
									example: 97.2,
									description: 'Percentage of successful task creations',
								},
								duplicatesSkipped: {
									type: 'number',
									example: 23,
									description: 'Number of duplicate tasks skipped',
								},
							},
						},
						nextScheduledRun: { type: 'string', format: 'date-time', example: '2023-12-02T06:00:00Z' },
						triggeredBy: {
							type: 'object',
							properties: {
								userId: { type: 'number', example: 1 },
								userName: { type: 'string', example: 'Admin User' },
								timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T14:30:00Z' },
							},
						},
					},
				},
			},
		},
	})
	async testTaskGeneration(@Req() req: AuthenticatedRequest) {
		try {
			await this.clientsService.generateCommunicationTasks();
			return {
				message: 'Communication task generation completed successfully',
			};
		} catch (error) {
			return {
				message: `Task generation failed: ${error.message}`,
			};
		}
	}

	@Get('profile/communication-schedules')
	@Roles(AccessLevel.CLIENT)
	@ApiOperation({
		summary: '📅 Get Client Communication Schedules (Client Portal)',
		description: `
# Get Client Communication Schedules

Retrieves all communication schedules for the authenticated client through the client portal.

## 🔐 **Security & Permissions**
- **Client-Only Access**: Only authenticated clients can access this endpoint
- **Self-Access Only**: Clients can only view their own communication schedules
- **Organization Validation**: Ensures client belongs to the correct organization

## 📅 **Schedule Information**
Each schedule includes:
- **Communication Type**: Phone call, email, in-person visit, video call, SMS, WhatsApp
- **Frequency**: Daily, weekly, monthly, quarterly, annually, or custom intervals
- **Preferred Time**: Preferred time of day for communication
- **Preferred Days**: Specific days of the week for communication
- **Next Scheduled Date**: When the next communication is scheduled
- **Status**: Whether the schedule is active or inactive
- **Notes**: Additional information about the communication schedule
		`,
	})
	@ApiOkResponse({
		description: '✅ Communication schedules retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Communication schedules retrieved successfully' },
				schedules: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1 },
							communicationType: { type: 'string', example: 'PHONE_CALL' },
							frequency: { type: 'string', example: 'WEEKLY' },
							preferredTime: { type: 'string', example: '09:00' },
							preferredDays: { type: 'array', items: { type: 'number' }, example: [1, 2, 3, 4, 5] },
							nextScheduledDate: { type: 'string', format: 'date-time', example: '2024-03-15T09:00:00Z' },
							isActive: { type: 'boolean', example: true },
							notes: { type: 'string', example: 'Weekly check-in calls' },
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Client profile not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client profile not found' },
			},
		},
	})
	getClientCommunicationSchedules(@Req() req: AuthenticatedRequest) {
		const clientAuthId = req.user?.uid;
		const organisationRef = req.user?.organisationRef;
		return this.clientsService.getClientCommunicationSchedules(clientAuthId, organisationRef);
	}

	@Patch('profile/communication-schedules/:scheduleId')
	@Roles(AccessLevel.CLIENT)
	@ApiOperation({
		summary: '✏️ Update Client Communication Schedule (Client Portal)',
		description: `
# Update Client Communication Schedule

Allows authenticated clients to update their communication schedule preferences through the client portal.

## 🔐 **Security & Permissions**
- **Client-Only Access**: Only authenticated clients can access this endpoint
- **Self-Update Only**: Clients can only update their own communication schedules
- **Schedule Ownership**: Validates that the schedule belongs to the authenticated client
- **Organization Validation**: Ensures client belongs to the correct organization

## 📝 **Updatable Fields**
Clients can update the following schedule information:
- **Communication Type**: Change between phone, email, video call, etc.
- **Frequency**: Modify how often they want to be contacted
- **Preferred Time**: Set preferred time of day for communication
- **Preferred Days**: Choose specific days of the week
- **Status**: Activate or deactivate the schedule
- **Notes**: Add or update notes about the communication schedule
		`,
	})
	@ApiParam({ name: 'scheduleId', description: 'Communication schedule ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ Communication schedule updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Communication schedule updated successfully' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Communication schedule not found',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Communication schedule not found or does not belong to this client',
				},
			},
		},
	})
	updateClientCommunicationSchedule(
		@Param('scheduleId') scheduleId: number,
		@Body() updateDto: UpdateCommunicationScheduleDto,
		@Req() req: AuthenticatedRequest,
	) {
		const clientAuthId = req.user?.uid;
		const organisationRef = req.user?.organisationRef;
		return this.clientsService.updateClientCommunicationSchedule(
			clientAuthId,
			scheduleId,
			updateDto,
			organisationRef,
		);
	}

	@Delete('profile/communication-schedules/:scheduleId')
	@Roles(AccessLevel.CLIENT)
	@ApiOperation({
		summary: '🗑️ Delete Client Communication Schedule (Client Portal)',
		description: `
# Delete Client Communication Schedule

Allows authenticated clients to delete their communication schedules through the client portal.

## 🔐 **Security & Permissions**
- **Client-Only Access**: Only authenticated clients can access this endpoint
- **Self-Delete Only**: Clients can only delete their own communication schedules
- **Schedule Ownership**: Validates that the schedule belongs to the authenticated client
- **Organization Validation**: Ensures client belongs to the correct organization

## ⚠️ **Important Notes**
- **Permanent Action**: Deleting a schedule cannot be undone
- **Task Impact**: Existing tasks generated from this schedule will remain
- **Alternative**: Consider deactivating the schedule instead of deleting it
		`,
	})
	@ApiParam({ name: 'scheduleId', description: 'Communication schedule ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ Communication schedule deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Communication schedule deleted successfully' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Communication schedule not found',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Communication schedule not found or does not belong to this client',
				},
			},
		},
	})
	deleteClientCommunicationSchedule(@Param('scheduleId') scheduleId: number, @Req() req: AuthenticatedRequest) {
		const clientAuthId = req.user?.uid;
		const organisationRef = req.user?.organisationRef;
		return this.clientsService.deleteClientCommunicationSchedule(clientAuthId, scheduleId, organisationRef);
	}
}
