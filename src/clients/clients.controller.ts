import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Req, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { BulkCreateClientDto, BulkCreateClientResponse } from './dto/bulk-create-client.dto';
import { BulkUpdateClientDto, BulkUpdateClientResponse } from './dto/bulk-update-client.dto';
import { UpdateCommunicationScheduleDto } from './dto/communication-schedule.dto';
import { CreditLimitExtensionDto } from './dto/credit-limit-extension.dto';
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
import { getDynamicDate, getDynamicDateTime, getFutureDate, getPastDate, createApiDescription } from '../lib/utils/swagger-helpers';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { Client } from './entities/client.entity';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { AuthenticatedRequest, getClerkOrgId, getClerkUserId } from '../lib/interfaces/authenticated-request.interface';
import { GeneralStatus } from '../lib/enums/status.enums';
import { OrganisationService } from '../organisation/organisation.service';

@ApiBearerAuth('JWT-auth')
@ApiTags('💎 Clients')
@Controller('clients')
@UseGuards(ClerkAuthGuard, RoleGuard)
// @EnterpriseOnly('clients') // Temporarily commented out to debug
@ApiConsumes('application/json')
@ApiProduces('application/json')
// @ApiUnauthorizedResponse({
// 	description: '🔒 Unauthorized - Authentication required',
// 	schema: {
// 		type: 'object',
// 		properties: {
// 			message: { type: 'string', example: 'Authentication token is required' },
// 			error: { type: 'string', example: 'Unauthorized' },
// 			statusCode: { type: 'number', example: 401 },
// 		},
// 	},
// }) // Temporarily commented out to debug
export class ClientsController {
	private readonly logger = new Logger(ClientsController.name);

	constructor(
		private readonly clientsService: ClientsService,
		private readonly organisationService: OrganisationService,
	) {}

	/**
	 * Safely converts a value to a number
	 * @param value - Value to convert (string, number, or undefined)
	 * @returns Number or undefined if conversion fails
	 */
	private toNumber(value: string | number | undefined): number | undefined {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const numValue = Number(value);
		return isNaN(numValue) || !isFinite(numValue) ? undefined : numValue;
	}

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
# Create Comprehensive Client Profile

Creates a new client record in the system with comprehensive business relationship management capabilities and full CRM integration.

## 📋 **Core Features**
- **Complete Client Profile**: Business contact information, industry classification, and relationship management
- **Financial Management**: Credit limits, payment terms, outstanding balances, and pricing tier assignments
- **Geographic Services**: Address verification, GPS coordinates, and geofencing capabilities
- **Communication Scheduling**: Automated follow-up schedules and preferred contact methods
- **Sales Pipeline Integration**: Lead conversion tracking and sales representative assignment
- **Business Intelligence**: Customer segmentation, acquisition analytics, and lifetime value tracking

## 🎯 **Use Cases**
- **New Customer Onboarding**: Register new customers with complete business profiles and contact information
- **Lead Conversion**: Convert qualified sales leads into active clients with full relationship tracking
- **Partner Management**: Add business partners, vendors, and strategic clients to the system
- **Enterprise Accounts**: Manage large enterprise clients with complex organizational structures
- **Geographic Expansion**: Track clients across multiple locations with regional sales rep assignment
- **Customer Segmentation**: Organize clients by industry, company size, value tier, and risk profile

## 🔧 **Advanced Features**
- **Price Tier Management**: Assign clients to different pricing structures based on volume or relationship
- **Risk Assessment**: Evaluate and continuously monitor client financial risk levels and payment history
- **Geofencing Integration**: Location-based services with customizable radius and notification preferences
- **Communication Automation**: Schedule regular follow-ups with preferred contact method routing
- **Acquisition Analytics**: Track how clients were acquired and measure channel effectiveness
- **Lifetime Value Tracking**: Calculate and predict client lifetime value with revenue forecasting
- **Portal Access Management**: Enable client self-service portal with customizable access levels

## 📝 **Field Categories**

### Required Core Fields
- **Identity**: name, contactPerson, email (unique within organization)
- **Communication**: phone, address with complete geographic information
- **Business**: industry, companySize, category classification

### Optional Business Fields
- **Financial**: creditLimit, paymentTerms, priceTier, discountPercentage
- **Relationship**: assignedSalesRep, acquisitionChannel, acquisitionDate
- **Classification**: type, category, industry, riskLevel, tags

### Geographic & Location (Optional)
- **Address Details**: street, city, state, country, postalCode
- **GPS Coordinates**: latitude, longitude for mapping and geofencing
- **Geofencing**: enableGeofence, geofenceRadius, geofenceType

### Communication Preferences (Optional)
- **Contact Methods**: preferredContactMethod, alternativePhone, website
- **Social Profiles**: LinkedIn, Twitter, Facebook, Instagram links
- **Scheduling**: communicationSchedules with frequency and timing preferences

### Advanced Features (Optional)
- **Custom Fields**: Flexible key-value pairs for industry-specific data
- **Tags & Categories**: Multi-dimensional classification system
- **Portal Access**: hasPortalAccess with authentication credentials
- **Integration**: Custom fields for third-party system integration

## 🔒 **Security & Validation**
- Email uniqueness validation within organization scope
- Phone number format validation with international support
- Address verification and geocoding integration
- Financial data validation and encryption
- Access control based on user permissions and organization boundaries
- Comprehensive audit logging for all client data changes
	`,
	})
	@ApiBody({
		type: CreateClientDto,
		description: 'Comprehensive client creation payload with business relationship management data',
		examples: {
			enterpriseClient: {
				summary: '🏢 Enterprise Client',
				description: 'Example of creating a comprehensive enterprise client account',
				value: {
					name: 'LORO CORP',
					contactPerson: 'The Guy',
					email: 'theguy@example.co.za',
					phone: '+27 11 555 0123',
					alternativePhone: '+27 11 555 0124',
					website: 'https://www.example.co.za',
					industry: 'Technology',
					companySize: 'LARGE',
					category: 'enterprise',
					type: 'B2B',
					status: 'ACTIVE',
					creditLimit: 500000,
					paymentTerms: 'NET_30',
					priceTier: 'ENTERPRISE',
					discountPercentage: 15,
					riskLevel: 'LOW',
					acquisitionChannel: 'REFERRAL',
					acquisitionDate: getPastDate(30),
					address: {
						street: '123 Business Park Drive',
						suburb: 'Pretoria South Africa',
						city: 'Pretoria',
						state: 'Gauteng',
						country: 'South Africa',
						postalCode: '0002'
					},
					latitude: -25.746111,
					longitude: 28.188056,
					enableGeofence: true,
					geofenceRadius: 1000,
					geofenceType: 'NOTIFY',
					preferredContactMethod: 'EMAIL',
					description: 'Leading technology solutions provider in South Africa',
					tags: ['enterprise', 'technology', 'high-value'],
					socialProfiles: {
						linkedin: 'https://linkedin.com/company/loro-corp',
						website: 'https://www.example.co.za'
					},
					customFields: {
						sector: 'FinTech',
						employees: '100-500',
						annualRevenue: '50M-100M'
					},
					communicationSchedules: [
						{
							communicationType: 'EMAIL',
							frequency: 'MONTHLY',
							preferredDays: [2, 4],
							preferredTime: '10:00',
							notes: 'Monthly technology updates and product roadmap discussions'
						}
					]
				}
			},
			smallBusiness: {
				summary: '🏪 Small Business Client',
				description: 'Example of creating a small business client account',
				value: {
					name: 'Local Coffee Shop',
					contactPerson: 'John Smith',
					email: 'john@localcoffee.co.za',
					phone: '+27 82 123 4567',
					website: 'https://localcoffee.co.za',
					industry: 'Food & Beverage',
					companySize: 'SMALL',
					category: 'small_business',
					type: 'B2C',
					status: 'ACTIVE',
					creditLimit: 25000,
					paymentTerms: 'NET_15',
					priceTier: 'STANDARD',
					riskLevel: 'MEDIUM',
					acquisitionChannel: 'DIRECT',
					address: {
						street: '45 Main Street',
						suburb: 'Hatfield',
						city: 'Pretoria',
						state: 'Gauteng',
						country: 'South Africa',
						postalCode: '0028'
					},
					latitude: -25.748889,
					longitude: 28.230556,
					preferredContactMethod: 'PHONE',
					description: 'Local artisanal coffee shop with community focus',
					tags: ['small-business', 'local', 'food-service']
				}
			},
			basicClient: {
				summary: '👤 Basic Client',
				description: 'Example of creating a basic client with minimal required fields',
				value: {
					name: 'Simple Client Ltd',
					contactPerson: 'Jane Doe',
					email: 'jane@simpleclient.co.za',
					phone: '+27 83 987 6543',
					industry: 'Services',
					category: 'standard',
					address: {
						street: '789 Business Avenue',
						city: 'Cape Town',
						state: 'Western Cape',
						country: 'South Africa',
						postalCode: '8001'
					}
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Client created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' }
			}
		},
		examples: {
			success: {
				summary: '✅ Client Created Successfully',
				value: {
					message: 'Success'
				}
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid or missing required data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'A client with this email already exists' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Email must be a valid email address',
						'Phone number must be in valid format',
						'Address is required for geofencing'
					]
				}
			}
		},
		examples: {
			duplicateEmail: {
				summary: '📧 Duplicate Email',
				value: {
					message: 'A client with this email already exists',
					statusCode: 400
				}
			},
			invalidCoordinates: {
				summary: '📍 Invalid Geofencing Data',
				value: {
					message: 'Coordinates are required for geofencing',
					statusCode: 400
				}
			},
			organizationNotFound: {
				summary: '🏢 Organization Not Found',
				value: {
					message: 'Organisation with ID 999 not found',
					statusCode: 400
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to create clients in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Client already exists',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'A client with this email already exists' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - System malfunction',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to create client due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	@ApiBody({
		type: CreateClientDto,
		description: 'Client creation payload with all required and optional information',
		examples: {
			basicClient: {
				summary: '🏢 Basic Business Client',
				description: 'Standard business client with essential information',
				value: {
					name: 'LORO CORP',
					contactPerson: 'The Guy',
					email: 'theguy@example.co.za',
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
					name: 'LORO CORP Premium',
					contactPerson: 'The Guy',
					email: 'theguy@example.co.za',
					phone: '+27 12 555 0123',
					alternativePhone: '+27 82 555 0123',
					website: 'https://www.example.co.za',
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
					acquisitionDate: getPastDate(365),
					tags: ['High Value', 'Tech Partner', 'Strategic Account'],
					socialProfiles: {
						linkedin: 'https://linkedin.com/company/loro-corp',
						twitter: 'https://twitter.com/loro-corp',
					},
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ Client created successfully with automated onboarding email',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Success message indicating client was created and onboarding email was sent'
				},
				},
			},
		examples: {
			success: {
				summary: '✅ Successful Client Creation',
				value: {
					message: 'Success'
				}
			}
		}
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
						name: { type: 'string', example: 'LORO CORP' },
						email: { type: 'string', example: 'theguy@example.co.za' },
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
				timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
				path: { type: 'string', example: '/clients' },
			},
		},
	})
	create(@Body() createClientDto: CreateClientDto, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.clientsService.create(createClientDto, orgId, branchId);
	}

	@Post('bulk')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '🏢 Create multiple clients in bulk',
		description: `
# Bulk Client Creation

Create multiple clients simultaneously with transaction support and advanced features.

## Features
- **Transaction Safety**: All-or-nothing creation with rollback on failures
- **Detailed Results**: Individual success/failure tracking for each client
- **Email Notifications**: Optional welcome emails for new clients
- **Auto-Assignment**: Automatic sales rep assignment based on territory
- **Address Validation**: Optional geocoding and validation
- **Organization Scoping**: Automatic association with user's organization/branch

## Usage
- Submit up to 50 clients per request
- Each client follows the standard CreateClientDto schema
- Failed clients don't affect successful ones (when possible)
- Duplicate email addresses are automatically detected and rejected

## Response
Returns detailed results including:
- Total requested/created/failed counts
- Success rate percentage
- Individual client results with error details
- Performance metrics and execution time
- Optional email and validation counts

## Limits
- Maximum 50 clients per request
- Email addresses must be unique within the system
- All required fields must be provided for each client
		`,
	})
	@ApiBody({
		type: BulkCreateClientDto,
		description: 'Array of clients to create with optional settings',
		examples: {
			'Enterprise Onboarding': {
				summary: 'Create multiple enterprise clients with full details',
				value: {
					orgId: 1,
					branchId: 1,
					sendWelcomeEmails: true,
					autoAssignSalesReps: true,
					validateAddresses: true,
					clients: [
						{
							name: 'LORO Corp',
							contactPerson: 'The Guy',
							email: 'theguy@example.co.za',
							phone: '+27 11 123 4567',
							alternativePhone: '+27 82 987 6543',
							website: 'https://www.example.co.za',
							description: 'Leading technology solutions provider in South Africa',
							address: {
								street: '123 Innovation Drive',
								suburb: 'Pretoria South Africa',
								city: 'Pretoria',
								state: 'Gauteng',
								country: 'South Africa',
								postalCode: '0002'
							},
							category: 'enterprise',
							industry: 'Technology',
							companySize: 250,
							annualRevenue: 50000000,
							creditLimit: 1000000,
							priceTier: 'ENTERPRISE',
							preferredContactMethod: 'EMAIL',
							preferredLanguage: 'English',
							riskLevel: 'LOW',
							acquisitionChannel: 'REFERRAL',
							latitude: -25.7479,
							longitude: 28.2293,
							assignedSalesRep: { uid: 1 },
							tags: ['Enterprise', 'Technology', 'High Value'],
							visibleCategories: ['Software', 'Hardware', 'Services']
						},
						{
							name: 'Digital Solutions SA',
							contactPerson: 'Business Manager',
							email: 'manager@digitalsolutions.co.za',
							phone: '+27 21 555 0123',
							website: 'https://www.digitalsolutions.co.za',
							description: 'Digital transformation specialists for SMEs',
							address: {
								street: '456 Tech Park Avenue',
								suburb: 'Cape Town',
								city: 'Cape Town',
								state: 'Western Cape',
								country: 'South Africa',
								postalCode: '8001'
							},
							category: 'enterprise',
							industry: 'Digital Services',
							companySize: 150,
							annualRevenue: 25000000,
							creditLimit: 500000,
							priceTier: 'PREMIUM',
							preferredContactMethod: 'PHONE',
							riskLevel: 'LOW',
							acquisitionChannel: 'MARKETING',
							latitude: -33.9249,
							longitude: 18.4241,
							assignedSalesRep: { uid: 2 },
							tags: ['SME', 'Digital', 'Growth']
						}
					]
				}
			},
			'SME Client Batch': {
				summary: 'Create multiple SME clients with essential information',
				value: {
					sendWelcomeEmails: true,
					autoAssignSalesReps: false,
					clients: [
						{
							name: 'Johannesburg Retailers',
							contactPerson: 'Store Manager',
							email: 'manager@jhbretailers.co.za',
							phone: '+27 11 444 5555',
							address: {
								street: '789 Retail Street',
								suburb: 'Johannesburg',
								city: 'Johannesburg',
								state: 'Gauteng',
								country: 'South Africa',
								postalCode: '2000'
							},
							category: 'SME',
							industry: 'Retail',
							companySize: 50,
							creditLimit: 200000,
							priceTier: 'STANDARD',
							preferredContactMethod: 'WHATSAPP',
							riskLevel: 'MEDIUM'
						},
						{
							name: 'Durban Manufacturing',
							contactPerson: 'Operations Director',
							email: 'ops@durbanmanufacturing.co.za',
							phone: '+27 31 777 8888',
							address: {
								street: '321 Industrial Road',
								suburb: 'Durban',
								city: 'Durban',
								state: 'KwaZulu-Natal',
								country: 'South Africa',
								postalCode: '4000'
							},
							category: 'SME',
							industry: 'Manufacturing',
							companySize: 75,
							creditLimit: 300000,
							priceTier: 'STANDARD',
							preferredContactMethod: 'EMAIL',
							riskLevel: 'LOW'
						}
					]
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Bulk creation completed successfully',
		type: BulkCreateClientResponse,
		schema: {
			type: 'object',
			properties: {
				totalRequested: { type: 'number', example: 10, description: 'Total clients requested for creation' },
				totalCreated: { type: 'number', example: 8, description: 'Total clients successfully created' },
				totalFailed: { type: 'number', example: 2, description: 'Total clients that failed creation' },
				successRate: { type: 'number', example: 80.0, description: 'Success rate percentage' },
				message: { type: 'string', example: 'Bulk creation completed: 8 clients created, 2 failed' },
				duration: { type: 'number', example: 1250, description: 'Operation duration in milliseconds' },
				results: {
					type: 'array',
					description: 'Detailed results for each client',
					items: {
						type: 'object',
						properties: {
							client: { type: 'object', description: 'Created client data or null if failed' },
							success: { type: 'boolean', example: true },
							error: { type: 'string', example: 'Email already exists', description: 'Error message if failed' },
							index: { type: 'number', example: 0, description: 'Index in original array' },
							name: { type: 'string', example: 'LORO Corp' },
							email: { type: 'string', example: 'theguy@example.co.za' }
						}
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid request data or validation errors',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for bulk client creation' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during bulk creation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Internal server error during bulk client creation' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async createBulkClients(@Body() bulkCreateClientDto: BulkCreateClientDto, @Req() req: AuthenticatedRequest): Promise<BulkCreateClientResponse> {
		// Automatically set orgId and branchId from authenticated user if not provided
		if (!bulkCreateClientDto.orgId) {
			const clerkOrgId = getClerkOrgId(req);
			if (!clerkOrgId) {
				throw new BadRequestException('Organization context required');
			}
			// Resolve Clerk org ID to numeric uid
			const orgUid = await this.organisationService.findUidByClerkId(clerkOrgId);
			if (!orgUid) {
				throw new BadRequestException(`Organization not found for ID: ${clerkOrgId}`);
			}
			bulkCreateClientDto.orgId = orgUid;
		}
		if (!bulkCreateClientDto.branchId) {
			bulkCreateClientDto.branchId = this.toNumber(req.user?.branch?.uid);
		}
		
		return this.clientsService.createBulkClients(bulkCreateClientDto);
	}

	@Patch('bulk')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '📝 Update multiple clients in bulk',
		description: `
# Bulk Client Update

Update multiple clients simultaneously with transaction support and validation.

## Features
- **Transaction Safety**: All-or-nothing updates with rollback on failures
- **Field Tracking**: Tracks which fields were updated for each client
- **Notification Emails**: Optional emails for significant changes
- **Sales Rep Validation**: Optional validation of assigned sales representatives
- **Address Geocoding**: Optional coordinate updates for address changes
- **Cache Management**: Intelligent cache invalidation for updated clients

## Usage
- Submit up to 50 client updates per request
- Each update specifies client ID (ref) and fields to update
- Only provided fields are updated (partial updates supported)
- Failed updates don't affect successful ones

## Response
Returns detailed results including:
- Total requested/updated/failed counts
- Success rate percentage
- Individual update results with field tracking
- Performance metrics and execution time
- Optional validation and notification counts

## Limits
- Maximum 50 client updates per request
- Client IDs must exist and not be soft-deleted
- Sales rep IDs must be valid (when validation enabled)
		`,
	})
	@ApiBody({
		type: BulkUpdateClientDto,
		description: 'Array of client updates with options',
		examples: {
			'Business Updates': {
				summary: 'Update client business information and assignments',
				value: {
					sendNotificationEmails: true,
					validateSalesReps: true,
					updateCoordinates: false,
					updates: [
						{
							ref: 123,
							data: {
								contactPerson: 'New Contact Manager',
								phone: '+27 11 999 8888',
								creditLimit: 750000,
								priceTier: 'PREMIUM',
								assignedSalesRep: { uid: 3 },
								tags: ['VIP', 'Premium Customer', 'High Value'],
								description: 'Updated business description with new focus areas'
							}
						},
						{
							ref: 124,
							data: {
								status: 'ACTIVE',
								category: 'enterprise',
								companySize: 300,
								annualRevenue: 75000000,
								industry: 'Financial Services',
								preferredContactMethod: 'EMAIL'
							}
						}
					]
				}
			},
			'Contact Information Update': {
				summary: 'Update client contact details and preferences',
				value: {
					sendNotificationEmails: false,
					validateSalesReps: false,
					updates: [
						{
							ref: 125,
							data: {
								email: 'new.email@example.co.za',
								alternativePhone: '+27 82 555 9999',
								preferredContactMethod: 'WHATSAPP',
								preferredLanguage: 'Afrikaans',
								nextContactDate: '2024-03-15T10:00:00Z'
							}
						},
						{
							ref: 126,
							data: {
								address: {
									street: '456 New Business Park',
									suburb: 'Sandton',
									city: 'Johannesburg',
									state: 'Gauteng',
									country: 'South Africa',
									postalCode: '2196'
								},
								website: 'https://www.newdomain.co.za',
								description: 'Relocated to new headquarters in Sandton'
							}
						}
					]
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Bulk update completed successfully',
		type: BulkUpdateClientResponse,
		schema: {
			type: 'object',
			properties: {
				totalRequested: { type: 'number', example: 10, description: 'Total clients requested for update' },
				totalUpdated: { type: 'number', example: 9, description: 'Total clients successfully updated' },
				totalFailed: { type: 'number', example: 1, description: 'Total clients that failed update' },
				successRate: { type: 'number', example: 90.0, description: 'Success rate percentage' },
				message: { type: 'string', example: 'Bulk update completed: 9 clients updated, 1 failed' },
				duration: { type: 'number', example: 850, description: 'Operation duration in milliseconds' },
				results: {
					type: 'array',
					description: 'Detailed results for each client update',
					items: {
						type: 'object',
						properties: {
							ref: { type: 'number', example: 123, description: 'Client reference ID' },
							success: { type: 'boolean', example: true },
							error: { type: 'string', example: 'Client not found', description: 'Error message if failed' },
							index: { type: 'number', example: 0, description: 'Index in original array' },
							name: { type: 'string', example: 'LORO Corp' },
							email: { type: 'string', example: 'theguy@example.co.za' },
							updatedFields: { type: 'array', items: { type: 'string' }, example: ['contactPerson', 'phone', 'creditLimit'] }
						}
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid request data or validation errors'
	})
	@ApiNotFoundResponse({
		description: '🔍 One or more client IDs not found'
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Server error during bulk update'
	})
	async updateBulkClients(@Body() bulkUpdateClientDto: BulkUpdateClientDto, @Req() req: AuthenticatedRequest): Promise<BulkUpdateClientResponse> {
		return this.clientsService.updateBulkClients(bulkUpdateClientDto);
	}

	@Get('admin/all')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.OWNER,
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
		description: '✅ All clients retrieved successfully for admin view with comprehensive data',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					description: 'Array of client objects with complete information',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 12345, description: 'Unique client identifier' },
							name: { type: 'string', example: 'LORO CORP', description: 'Client company name' },
							contactPerson: { type: 'string', example: 'The Guy', description: 'Primary contact person' },
							email: { type: 'string', example: 'theguy@example.co.za', description: 'Primary email address' },
							phone: { type: 'string', example: '+27 11 123 4567', description: 'Primary phone number' },
							alternativePhone: { type: 'string', example: '+27 82 123 4567', description: 'Secondary phone number' },
							website: { type: 'string', example: 'https://www.example.co.za', description: 'Company website' },
							description: { type: 'string', example: 'Leading technology company in South Africa', description: 'Company description' },
							status: { type: 'string', example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'CONVERTED', 'PROSPECT', 'LEAD'], description: 'Client status' },
							category: { type: 'string', example: 'enterprise', description: 'Client category' },
							industry: { type: 'string', example: 'Technology', description: 'Industry sector' },
							companySize: { type: 'number', example: 250, description: 'Number of employees' },
							annualRevenue: { type: 'number', example: 25000000, description: 'Annual revenue in ZAR' },
							creditLimit: { type: 'number', example: 500000, description: 'Credit limit in ZAR' },
							outstandingBalance: { type: 'number', example: 75000, description: 'Current outstanding balance' },
							lifetimeValue: { type: 'number', example: 850000, description: 'Total lifetime value' },
							priceTier: { type: 'string', example: 'ENTERPRISE', enum: ['STANDARD', 'PREMIUM', 'ENTERPRISE'], description: 'Pricing tier' },
							preferredContactMethod: { type: 'string', example: 'EMAIL', enum: ['EMAIL', 'PHONE', 'WHATSAPP', 'SMS'], description: 'Preferred contact method' },
							preferredLanguage: { type: 'string', example: 'English', description: 'Preferred communication language' },
							riskLevel: { type: 'string', example: 'LOW', enum: ['LOW', 'MEDIUM', 'HIGH'], description: 'Credit risk assessment' },
							acquisitionChannel: { type: 'string', example: 'REFERRAL', description: 'How client was acquired' },
							acquisitionDate: { type: 'string', format: 'date', example: '2023-01-15', description: 'Date client was acquired' },
							assignedSalesRep: {
								type: 'object',
								nullable: true,
								description: 'Assigned sales representative information',
								properties: {
									uid: { type: 'number', example: 42 },
									name: { type: 'string', example: 'John Smith' },
									surname: { type: 'string', example: 'Smith' },
									email: { type: 'string', example: 'john.smith@example.co.za' },
									phone: { type: 'string', example: '+27 82 555 0123' },
								},
							},
							organisation: {
								type: 'object',
								nullable: true,
								description: 'Organization the client belongs to',
								properties: {
									uid: { type: 'number', example: 1 },
									name: { type: 'string', example: 'LORO CORP' },
									description: { type: 'string', example: 'Leading CRM provider' },
								},
							},
							branch: {
								type: 'object',
								nullable: true,
								description: 'Branch the client belongs to',
								properties: {
									uid: { type: 'number', example: 5 },
									name: { type: 'string', example: 'Pretoria South Africa' },
									address: { type: 'string', example: 'Pretoria, South Africa' },
								},
							},
							address: {
								type: 'object',
								nullable: true,
								description: 'Client physical address',
								properties: {
									street: { type: 'string', example: '123 Business Park Drive' },
									suburb: { type: 'string', example: 'Pretoria South Africa' },
									city: { type: 'string', example: 'Pretoria' },
									state: { type: 'string', example: 'Gauteng' },
									country: { type: 'string', example: 'South Africa' },
									postalCode: { type: 'string', example: '0002' },
								},
							},
							latitude: { type: 'number', example: -25.7479, description: 'GPS latitude coordinate' },
							longitude: { type: 'number', example: 28.2293, description: 'GPS longitude coordinate' },
							tags: {
								type: 'array',
								items: { type: 'string' },
								example: ['High Value', 'Tech Partner', 'Strategic Account'],
								description: 'Client tags for categorization'
							},
							socialProfiles: {
								type: 'object',
								nullable: true,
								description: 'Social media profiles',
								properties: {
									linkedin: { type: 'string', example: 'https://linkedin.com/company/loro-corp' },
									twitter: { type: 'string', example: 'https://twitter.com/loro-corp' },
									facebook: { type: 'string', example: 'https://facebook.com/loro' },
								},
							},
							customFields: {
								type: 'object',
								nullable: true,
								description: 'Custom fields for additional data',
								additionalProperties: true,
								example: {
									primaryTechnology: 'Cloud Computing',
									complianceLevel: 'Enterprise Grade',
									contractType: 'Annual'
								}
							},
							enableGeofence: { type: 'boolean', example: true, description: 'Whether geofencing is enabled' },
							geofenceRadius: { type: 'number', example: 500, description: 'Geofence radius in meters' },
							lastVisitDate: { type: 'string', format: 'date-time', example: '2023-11-15T14:30:00Z', description: 'Last visit date' },
							nextContactDate: { type: 'string', format: 'date-time', example: '2023-12-20T09:00:00Z', description: 'Next scheduled contact' },
							createdAt: { type: 'string', format: 'date-time', example: '2023-01-15T10:00:00Z', description: 'Client creation timestamp' },
							updatedAt: { type: 'string', format: 'date-time', example: '2023-11-20T14:30:00Z', description: 'Last update timestamp' },
							isDeleted: { type: 'boolean', example: false, description: 'Soft delete flag' },
						},
					},
				},
				meta: {
					type: 'object',
					description: 'Pagination metadata',
					properties: {
						total: {
							type: 'number',
							example: 1250,
							description: 'Total number of clients matching criteria across all pages',
						},
						page: { 
							type: 'number', 
							example: 1, 
							description: 'Current page number (1-based indexing)' 
						},
						limit: { 
							type: 'number', 
							example: 500, 
							description: 'Number of records per page (admin default: 500, max: 1000)' 
						},
						totalPages: { 
							type: 'number', 
							example: 3, 
							description: 'Total number of pages available based on limit' 
						},
					},
				},
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Operation result message'
				},
			},
		},
		examples: {
			successWithData: {
				summary: '✅ Successful Admin Client Retrieval',
				value: {
					data: [
						{
							uid: 12345,
							name: 'LORO CORP',
							contactPerson: 'The Guy',
							email: 'theguy@example.co.za',
							phone: '+27 11 123 4567',
							status: 'ACTIVE',
							category: 'enterprise',
							industry: 'Technology',
							companySize: 250,
							lifetimeValue: 850000,
							assignedSalesRep: {
								uid: 42,
								name: 'John Smith',
								email: 'john.smith@example.co.za'
							},
							organisation: {
								uid: 1,
								name: 'LORO CORP'
							},
							branch: {
								uid: 5,
								name: 'Pretoria South Africa'
							},
							createdAt: '2023-01-15T10:00:00Z'
						}
					],
					meta: {
						total: 1250,
						page: 1,
						limit: 500,
						totalPages: 3
					},
					message: 'Success'
				}
			},
			emptyResult: {
				summary: '📭 No Clients Found',
				value: {
					data: [],
					meta: {
						total: 0,
						page: 1,
						limit: 500,
						totalPages: 0
					},
					message: 'Success'
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid query parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid status value provided' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient admin permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Admin access required for this operation' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Not Found - No clients found matching criteria',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No clients found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - System malfunction',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve clients due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	findAllForAdmin(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: GeneralStatus,
		@Query('search') search?: string,
	): Promise<PaginatedResponse<Client>> {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const filters = { status, search };
		const userId = req.user?.uid;
		return this.clientsService.findAll(
			page ? Number(page) : 1,
			limit ? Number(limit) : 500,
			orgId,
			filters,
			userId
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
		AccessLevel.MEMBER,
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
		description: '✅ Clients retrieved successfully with user-specific filtering and role-based access control',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					description: 'Array of client objects filtered based on user permissions and access level',
					items: {
						$ref: '#/components/schemas/Client'
					},
				},
				meta: {
								type: 'object',
					description: 'Pagination metadata and filtering information',
								properties: {
						total: { 
							type: 'number', 
							example: 47, 
							description: 'Total clients accessible to current user based on role and assignments' 
						},
						page: { 
							type: 'number', 
							example: 1, 
							description: 'Current page number (1-based indexing)' 
						},
						limit: { 
							type: 'number', 
							example: 20, 
							description: 'Number of records per page (user default: 20, admin default: 500)' 
						},
						totalPages: { 
							type: 'number', 
							example: 3, 
							description: 'Total pages available based on user access and limit' 
						},
					},
				},
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Operation result message' 
				},
			},
		},
		examples: {
			regularUserAccess: {
				summary: '👤 Regular User Access',
				value: {
					data: [
						{
							uid: 12345,
							name: 'LORO CORP',
							contactPerson: 'The Guy',
							email: 'theguy@example.co.za',
							phone: '+27 11 456 7890',
							status: 'ACTIVE',
							category: 'enterprise',
							industry: 'Technology',
							assignedSalesRep: {
								uid: 25,
								name: 'Mike Wilson',
								email: 'mike.wilson@example.co.za'
							},
							address: {
								street: '456 Innovation Drive',
								suburb: 'Pretoria South Africa',
								city: 'Pretoria',
								state: 'Gauteng',
								country: 'South Africa'
							},
							lastVisitDate: '2023-11-15T14:30:00Z',
							nextContactDate: '2023-12-20T09:00:00Z',
							createdAt: '2023-01-15T10:00:00Z',
							lifetimeValue: 250000,
							tags: ['High Priority', 'Tech Partner']
						}
					],
				meta: {
						total: 47,
						page: 1,
						limit: 20,
						totalPages: 3
					},
					message: 'Success'
				}
			},
			elevatedUserAccess: {
				summary: '👑 Admin/Manager Access',
				value: {
					data: [
						{
							uid: 12345,
							name: 'LORO CORP',
							contactPerson: 'The Guy',
							email: 'theguy@example.co.za',
							phone: '+27 11 456 7890',
							status: 'ACTIVE',
							category: 'enterprise',
							assignedSalesRep: {
								uid: 25,
								name: 'Mike Wilson',
								email: 'mike.wilson@example.co.za'
							}
						},
						{
							uid: 12346,
							name: 'Another Client Ltd',
							contactPerson: 'Jane Smith',
							email: 'jane@anotherclient.co.za',
							phone: '+27 21 555 0199',
							status: 'PROSPECT',
							category: 'sme',
							assignedSalesRep: {
								uid: 42,
								name: 'John Doe',
								email: 'john.doe@example.co.za'
							}
						}
					],
					meta: {
						total: 1250,
						page: 1,
						limit: 20,
						totalPages: 63
					},
					message: 'Success'
				}
			},
			filteredResults: {
				summary: '🔍 Filtered Search Results',
				value: {
					data: [
						{
							uid: 12345,
							name: 'LORO CORP',
							contactPerson: 'The Guy',
							email: 'theguy@example.co.za',
							phone: '+27 11 456 7890',
							status: 'ACTIVE',
							category: 'enterprise'
						}
					],
					meta: {
						total: 1,
						page: 1,
						limit: 20,
						totalPages: 1
					},
					message: 'Success'
				}
			},
			noAssignedClients: {
				summary: '📭 No Assigned Clients',
				value: {
					data: [],
					meta: {
						total: 0,
						page: 1,
						limit: 20,
						totalPages: 0
					},
					message: 'No clients assigned to user'
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid query parameters or filters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid status value provided' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to access clients',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to access clients' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Not Found - No clients found or user not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - System malfunction',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve clients due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	findAll(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: GeneralStatus,
		@Query('category') category?: string,
		@Query('search') search?: string,
	): Promise<PaginatedResponse<Client>> {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const userId = req.user?.uid;
		const filters = { status, category, search };

		return this.clientsService.findAll(
			page ? Number(page) : 1,
			limit ? Number(limit) : Number(process.env.DEFAULT_PAGE_LIMIT),
			orgId,
			filters,
			userId,
		);
	}

	@Get('me')
	@Roles(AccessLevel.CLIENT, AccessLevel.MEMBER)
	@ApiOperation({
		summary: '👤 Get my linked client (full profile)',
		description: `
Returns the linked client for the authenticated user with full related data for use in profile tabs.

**Included data:** client record with quotations, orders, projects, assignedSalesRep, branch, organisation, checkIns.

**Security:** CLIENT role only; uses req.user.clientUid (set from User.linkedClientUid by the auth guard).
		`,
	})
	@ApiOkResponse({
		description: '✅ Linked client with full profile retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				client: {
					type: 'object',
					description: 'Client with relations: quotations, orders, projects, assignedSalesRep, branch, organisation',
				},
			},
		},
	})
	@ApiForbiddenResponse({ description: 'Client context not found (user not linked to a client)' })
	async getMyLinkedClient(@Req() req: AuthenticatedRequest) {
		const clientUid = req.user?.clientUid;
		if (clientUid == null) {
			throw new ForbiddenException('Client context not found');
		}
		return this.clientsService.getLinkedClientWithFullProfile(Number(clientUid));
	}

	@Get(':ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.MEMBER,
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
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid client reference ID',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid client reference ID provided' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No access to this client',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to access this client' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Not Found - Client not found or does not exist',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client not found' },
				client: { type: 'null' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		},
		examples: {
			clientNotFound: {
				summary: '🔍 Client Not Found',
				value: {
					message: 'Client not found',
					client: null,
					error: 'Not Found',
					statusCode: 404
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - System malfunction',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve client due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	findOne(@Param('ref') ref: number, @Req() req: AuthenticatedRequest): Promise<{ message: string; client: Client | null }> {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const userId = req.user?.uid;
		return this.clientsService.findOne(ref, orgId, userId);
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
		description: '✅ Client updated successfully with optional lead conversion notifications and communication schedule management',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Update success message. Automated emails are sent if lead was converted to client status.'
				},
			},
		},
		examples: {
			standardUpdate: {
				summary: '✅ Standard Client Update',
				value: {
					message: 'Success'
				}
			},
			leadConversion: {
				summary: '🎯 Lead Conversion Success',
				value: {
					message: 'Success'
				}
			},
			communicationScheduleUpdate: {
				summary: '📅 Communication Schedules Updated',
				value: {
					message: 'Success'
				}
			},
			geofenceUpdate: {
				summary: '🗺️ Geofencing Configuration Updated',
				value: {
					message: 'Success'
				}
			}
		}
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
	update(@Param('ref') ref: number, @Body() updateClientDto: UpdateClientDto, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const userId = req.user?.uid;
		return this.clientsService.update(ref, updateClientDto, orgId, userId);
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
		description: '✅ Client restored successfully with all associated data and relationships preserved',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Confirmation that client has been restored to ACTIVE status with all data intact'
				},
			},
		},
		examples: {
			successfulRestore: {
				summary: '✅ Successful Client Restoration',
				value: {
					message: 'Success'
				}
			}
		}
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
	restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		return this.clientsService.restore(ref, orgId);
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
		description: '✅ Client soft-deleted successfully with complete data preservation for future restoration',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Confirmation that client has been soft-deleted with all data preserved for restoration'
				},
			},
		},
		examples: {
			successfulDeletion: {
				summary: '✅ Successful Soft Deletion',
				value: {
					message: 'Success'
				}
			}
		}
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
	remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const userId = req.user?.uid;
		return this.clientsService.remove(ref, orgId, userId);
	}

	@Get('nearby')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.SUPERVISOR,
		AccessLevel.TECHNICIAN,
	)
	@ApiQuery({ name: 'latitude', type: Number, required: true, description: 'GPS latitude coordinate (-90 to 90)', example: -26.195246 })
	@ApiQuery({ name: 'longitude', type: Number, required: true, description: 'GPS longitude coordinate (-180 to 180)', example: 28.034088 })
	@ApiQuery({ name: 'radius', type: Number, required: false, description: 'Search radius in kilometers (default: 5, max: 50)', example: 5 })
	@ApiQuery({ name: 'orgId', type: Number, required: false, description: 'Organization ID filter' })
	@ApiOperation({
		summary: '🗺️ Find Nearby Clients',
		description: `
# Find Nearby Clients

Discovers clients within a specified radius of given GPS coordinates, enabling location-based services and route optimization for field operations.

## 🔐 **Security & Permissions**
- **Role-Based Access**: Available to all authenticated users with client access permissions
- **Organization Scope**: Only finds clients within user's organization
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
		description: '✅ Nearby clients found and sorted by distance with precise geolocation data',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Operation success confirmation'
				},
				clients: {
					type: 'array',
					description: 'Array of clients within specified radius, sorted by distance (closest first)',
					items: {
						allOf: [
							{ $ref: '#/components/schemas/Client' },
							{
						type: 'object',
						properties: {
							distance: {
								type: 'number',
										example: 2.345,
										description: 'Calculated distance in kilometers from search point (using Haversine formula)',
									}
								},
								required: ['distance']
							}
						]
					},
				},
			},
		},
		examples: {
			nearbyClientsFound: {
				summary: '✅ Clients Found Within Radius',
				value: {
					message: 'Success',
					clients: [
						{
							uid: 12345,
							name: 'LORO CORP',
							contactPerson: 'The Guy',
							email: 'theguy@example.co.za',
							phone: '+27 11 555 0123',
							distance: 1.234,
							latitude: -26.195246,
							longitude: 28.034088,
							address: {
								street: '123 Business Park Drive',
								suburb: 'Pretoria South Africa',
								city: 'Pretoria',
								state: 'Gauteng',
								country: 'South Africa',
								postalCode: '0002'
							},
							status: 'ACTIVE',
							category: 'enterprise',
							assignedSalesRep: {
								uid: 25,
								name: 'John Smith',
								email: 'john.smith@example.co.za',
								phone: '+27 82 555 0123'
							},
							lastVisitDate: '2023-11-15T10:00:00Z',
							tags: ['High Priority', 'Tech Partner'],
							enableGeofence: true,
							geofenceRadius: 500
						},
						{
							uid: 12346,
							name: 'Another Client Ltd',
							contactPerson: 'Jane Smith',
							email: 'jane@anotherclient.co.za',
							phone: '+27 21 555 0199',
							distance: 3.876,
							latitude: -26.189123,
							longitude: 28.041567,
							address: {
								street: '456 Innovation Drive',
								suburb: 'Pretoria South Africa',
								city: 'Pretoria',
								state: 'Gauteng',
								country: 'South Africa'
							},
							status: 'ACTIVE',
							category: 'sme'
						}
					]
				}
			},
			noClientsInRadius: {
				summary: '📭 No Clients Found',
				value: {
					message: 'Success',
					clients: []
				}
			},
			singleClientNearby: {
				summary: '📍 Single Client Found',
				value: {
					message: 'Success',
					clients: [
						{
							uid: 12345,
							name: 'Nearby Client Ltd',
							contactPerson: 'Close Contact',
							email: 'contact@nearbyclient.co.za',
							phone: '+27 11 555 0123',
							distance: 0.567,
							latitude: -26.195246,
							longitude: 28.034088,
							status: 'ACTIVE',
							category: 'enterprise'
						}
					]
				}
			}
		}
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
		@Req() req?: AuthenticatedRequest,
	): Promise<{ message: string; clients: Array<Client & { distance: number }> }> {
		const userId = req?.user?.uid;
		return this.clientsService.findNearbyClients(latitude, longitude, radius, orgId, userId);
	}

	@Get(':clientId/check-ins')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.SUPERVISOR,
		AccessLevel.TECHNICIAN,
	)
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
		description: '✅ Client check-in history retrieved successfully with comprehensive visit data and analytics',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Success',
					description: 'Success message for check-in history retrieval'
				},
				checkIns: {
					type: 'array',
					description: 'Array of check-in records sorted by date (most recent first)',
					items: {
						$ref: '#/components/schemas/CheckIn'
					},
				},
			},
		},
		examples: {
			checkInsWithHistory: {
				summary: '✅ Check-ins Retrieved',
				value: {
					message: 'Success',
					checkIns: [
						{
							uid: 789,
							checkInTime: '2023-11-20T09:00:00Z',
							checkInLocation: 'LORO CORP Office - 123 Business Park Drive, Pretoria',
							checkInCoordinates: {
								latitude: -25.7479,
								longitude: 28.2293
							},
							checkOutTime: '2023-11-20T11:30:00Z',
							checkOutLocation: 'LORO CORP Office - 123 Business Park Drive, Pretoria',
							duration: '2h 30m',
							visitPurpose: 'Monthly business review and system maintenance',
							visitType: 'SCHEDULED_VISIT',
							status: 'COMPLETED',
							owner: {
								uid: 25,
								name: 'John Smith',
								email: 'john.smith@example.co.za',
								phone: '+27 82 555 0123'
							},
							notes: 'Client satisfied with service. Discussed upcoming project requirements and system upgrades.',
							geofenceValidation: {
								withinGeofence: true,
								distance: 45,
								accuracy: 5
							},
							createdAt: '2023-11-20T09:00:00Z',
							updatedAt: '2023-11-20T11:30:00Z'
						},
						{
							uid: 788,
							checkInTime: '2023-11-13T14:00:00Z',
							checkInLocation: 'LORO CORP Office - 123 Business Park Drive, Pretoria',
							checkOutTime: '2023-11-13T15:45:00Z',
							duration: '1h 45m',
							visitPurpose: 'Support ticket resolution',
							visitType: 'SUPPORT_VISIT',
							status: 'COMPLETED',
							owner: {
								uid: 25,
								name: 'John Smith',
								email: 'john.smith@example.co.za'
							},
							notes: 'Resolved network connectivity issues. System running smoothly.',
							createdAt: '2023-11-13T14:00:00Z'
						}
					]
				}
			},
			noCheckIns: {
				summary: '📭 No Check-ins Found',
				value: {
					message: 'Success',
					checkIns: []
				}
			},
			ongoingCheckIn: {
				summary: '🔄 Ongoing Check-in',
				value: {
					message: 'Success',
					checkIns: [
						{
							uid: 790,
							checkInTime: '2023-11-21T10:00:00Z',
							checkInLocation: 'LORO CORP Office - 123 Business Park Drive, Pretoria',
							checkOutTime: null,
							duration: null,
							visitPurpose: 'Quarterly business review',
							visitType: 'SCHEDULED_VISIT',
							status: 'IN_PROGRESS',
							owner: {
								uid: 25,
								name: 'John Smith',
								email: 'john.smith@example.co.za'
							},
							notes: 'Meeting in progress with leadership team.',
							createdAt: '2023-11-21T10:00:00Z'
						}
					]
				}
			}
		}
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
	getClientCheckIns(@Param('clientId') clientId: number, @Req() req: AuthenticatedRequest): Promise<{ message: string; checkIns: CheckIn[] }> {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const userId = req.user?.uid;
		return this.clientsService.getClientCheckIns(clientId, orgId, userId);
	}

	@Patch('profile')
	@Roles(AccessLevel.CLIENT, AccessLevel.MEMBER)
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
		description: '✅ Client profile updated successfully through client portal with email notifications sent',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Client profile updated successfully',
					description: 'Confirmation that profile update was successful with email notifications sent'
				},
				data: {
					type: 'object',
					description: 'Additional information about the update',
					properties: {
						clientId: { 
							type: 'number', 
							example: 12345,
							description: 'Unique identifier of the updated client'
						},
						updatedFields: {
							type: 'array',
							items: { type: 'string' },
							example: ['phone', 'website', 'description', 'address', 'communicationSchedules'],
							description: 'List of fields that were successfully updated'
						},
						lastUpdated: { 
							type: 'string', 
							format: 'date-time', 
							example: '2023-12-01T10:00:00Z',
							description: 'Timestamp of the profile update'
					},
				},
			},
		},
		},
		examples: {
			contactInfoUpdate: {
				summary: '✅ Contact Information Updated',
				value: {
					message: 'Client profile updated successfully',
					data: {
						clientId: 12345,
						updatedFields: ['phone', 'alternativePhone', 'website'],
						lastUpdated: '2023-12-01T10:00:00Z'
					}
				}
			},
			companyDetailsUpdate: {
				summary: '🏢 Company Details Updated',
				value: {
					message: 'Client profile updated successfully',
					data: {
						clientId: 12345,
						updatedFields: ['description', 'industry', 'companySize', 'address'],
						lastUpdated: '2023-12-01T10:15:00Z'
					}
				}
			},
			communicationSchedulesUpdate: {
				summary: '📅 Communication Preferences Updated',
				value: {
					message: 'Client profile updated successfully',
					data: {
						clientId: 12345,
						updatedFields: ['preferredContactMethod', 'communicationSchedules'],
						lastUpdated: '2023-12-01T10:30:00Z'
					}
				}
			},
			socialProfilesUpdate: {
				summary: '🌐 Social Profiles Updated',
				value: {
					message: 'Client profile updated successfully',
					data: {
						clientId: 12345,
						updatedFields: ['website', 'socialProfiles'],
						lastUpdated: '2023-12-01T10:45:00Z'
					}
				}
			}
		}
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
				timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
			},
		},
	})
	updateClientProfile(@Body() updateClientDto: UpdateClientDto, @Req() req: AuthenticatedRequest): Promise<{ message: string; data?: any }> {
		// Extract client auth ID from JWT token (this is the ClientAuth.uid, not Client.uid)
		const clientAuthId = req.user?.uid;
		const organisationRef = getClerkOrgId(req);
		if (!organisationRef) {
			throw new BadRequestException('Organization context required');
		}

		if (!clientAuthId) {
			throw new Error('Client authentication ID not found in token');
		}

		return this.clientsService.updateClientProfile(clientAuthId, updateClientDto, organisationRef);
	}

	@Post('profile/credit-limit-extension')
	@Roles(AccessLevel.CLIENT, AccessLevel.MEMBER)
	@ApiOperation({
		summary: '💳 Request Credit Limit Extension',
		description: `
# Request Credit Limit Extension

Allows clients to request an increase in their credit limit through an approval workflow.

## 🔐 **Security & Permissions**
- **Access**: Restricted to CLIENT role or MEMBER with a linked client
- **Identity**: Resolved from token → user profile → linked client (supports client portal users and staff with linked client)
- **Approval Required**: All requests require approval from organization managers/admins

## 📋 **Use Cases**
- **Business Growth**: Request higher credit limit due to increased order volume
- **Seasonal Needs**: Request temporary credit limit increase for peak seasons
- **Project Funding**: Request extension for large project orders
- **Payment Terms**: Request extension to accommodate longer payment cycles

## 🔧 **Approval Process**
1. Client submits request with requested limit and optional reason
2. Request validated (must be greater than current limit)
3. Approval request created and routed to financial approvers
4. Approvers review and approve/reject request
5. Client notified of decision
6. Credit limit updated automatically upon approval

## ⚠️ **Validation Rules**
- Requested limit must be greater than current limit
- Reason is optional but recommended for faster approval
- All requests are logged for audit purposes
		`,
	})
	@ApiBody({
		type: CreditLimitExtensionDto,
		description: 'Credit limit extension request data',
	})
	@ApiCreatedResponse({
		description: '✅ Credit limit extension request submitted, or returns existing pending approval info',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Credit limit extension request submitted for approval' },
				status: { type: 'string', enum: ['submitted', 'pending_approval'], description: 'submitted = new request created; pending_approval = existing request already in review' },
				data: {
					type: 'object',
					properties: {
						approvalId: { type: 'number', example: 123 },
						approvalReference: { type: 'string', example: 'APP-2024-001' },
						status: { type: 'string', example: 'pending' },
						clientId: { type: 'number', example: 456 },
						currentLimit: { type: 'number', example: 50000 },
						requestedLimit: { type: 'number', example: 100000 },
						increaseAmount: { type: 'number', example: 50000 },
						submittedAt: { type: 'string', format: 'date-time', description: 'Submission timestamp (ISO 8601)' },
						deadline: { type: 'string', format: 'date-time', description: 'Approval deadline (7 days from submission, ISO 8601)' },
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
				message: { type: 'string', example: 'Requested limit must be greater than current limit' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
			},
		},
	})
	requestCreditLimitExtension(@Body() creditLimitDto: CreditLimitExtensionDto, @Req() req: AuthenticatedRequest): Promise<{ message: string; status?: 'submitted' | 'pending_approval'; data?: any }> {
		// Resolve identity from token: user id from token → find user → linked client → do application
		const clerkUserId = getClerkUserId(req);
		const organisationRef = getClerkOrgId(req) ?? (req.user?.organisationRef != null ? String(req.user.organisationRef) : undefined);
		this.logger.log(
			`[CREDIT_LIMIT_EXTENSION] Controller received request clerkUserId=${clerkUserId ?? 'none'} organisationRef=${organisationRef ?? 'none'} requestedLimit=${creditLimitDto.requestedLimit}`,
		);
		if (!organisationRef) {
			throw new BadRequestException('Organization context required');
		}

		if (!clerkUserId) {
			throw new BadRequestException('User ID not found in token');
		}

		return this.clientsService.requestCreditLimitExtension(clerkUserId, creditLimitDto, organisationRef);
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
		description: '✅ Communication task generation triggered successfully with automated 3-month scheduling',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Communication task generation completed successfully',
					description: 'Confirmation that task generation process was triggered and completed'
				},
			},
		},
		examples: {
			successfulGeneration: {
				summary: '✅ Tasks Generated Successfully',
				value: {
					message: 'Communication task generation completed successfully'
				}
			},
			generationFailed: {
				summary: '❌ Generation Failed',
				value: {
					message: 'Task generation failed: Database connection timeout'
				}
			},
			noActiveSchedules: {
				summary: '📭 No Active Schedules',	
				value: {
					message: 'Communication task generation completed successfully'
				}
			}
		}
	})
	async testTaskGeneration(@Req() req: AuthenticatedRequest) {
		try {
			await this.clientsService.generateWeeklyCommunicationTasks();
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
	@Roles(AccessLevel.CLIENT, AccessLevel.MEMBER)
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
	getClientCommunicationSchedules(@Req() req: AuthenticatedRequest): Promise<{ message: string; schedules?: any[] }> {
		const clientAuthId = req.user?.uid;
		const organisationRef = getClerkOrgId(req);
		if (!organisationRef) {
			throw new BadRequestException('Organization context required');
		}
		return this.clientsService.getClientCommunicationSchedules(clientAuthId, organisationRef);
	}

	@Patch('profile/communication-schedules/:scheduleId')
	@Roles(AccessLevel.CLIENT, AccessLevel.MEMBER)
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
		description: '✅ Communication schedule updated successfully with automatic task regeneration',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Communication schedule updated successfully',
					description: 'Confirmation that the communication schedule has been updated'
				},
			},
		},
		examples: {
			scheduleUpdated: {
				summary: '✅ Schedule Updated',
				value: {
					message: 'Communication schedule updated successfully'
				}
			}
		}
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
	): Promise<{ message: string }> {
		const clientAuthId = req.user?.uid;
		const organisationRef = getClerkOrgId(req);
		if (!organisationRef) {
			throw new BadRequestException('Organization context required');
		}
		return this.clientsService.updateClientCommunicationSchedule(
			clientAuthId,
			scheduleId,
			updateDto,
			organisationRef,
		);
	}

	@Delete('profile/communication-schedules/:scheduleId')
	@Roles(AccessLevel.CLIENT, AccessLevel.MEMBER)
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
		description: '✅ Communication schedule deleted successfully with existing tasks preserved',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Communication schedule deleted successfully',
					description: 'Confirmation that the communication schedule has been permanently deleted'
				},
			},
		},
		examples: {
			scheduleDeleted: {
				summary: '✅ Schedule Deleted',
				value: {
					message: 'Communication schedule deleted successfully'
				}
			}
		}
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
	deleteClientCommunicationSchedule(@Param('scheduleId') scheduleId: number, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		const clientAuthId = req.user?.uid;
		const organisationRef = getClerkOrgId(req);
		if (!organisationRef) {
			throw new BadRequestException('Organization context required');
		}
		return this.clientsService.deleteClientCommunicationSchedule(clientAuthId, scheduleId, organisationRef);
	}

	@Get('my-communication-schedules')
	@Roles(AccessLevel.USER, AccessLevel.MANAGER, AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📅 Get My Communication Schedules',
		description: `
# Get My Communication Schedules

Retrieve all communication schedules assigned to the authenticated user.

## 🎯 **Purpose**
- View all client communication schedules assigned to the current user
- Plan and organize upcoming client interactions
- Track communication frequencies and schedules
- Prepare for the upcoming week's client engagements

## 🔐 **Security & Permissions**
- **Authenticated Users**: Users, Managers, Admins, and Owners can access this endpoint
- **Personal Schedules**: Users only see schedules assigned to them
- **Organization Scoped**: Results are filtered by user's organization
- **Branch Filtered**: Results can be filtered by branch if specified

## 📊 **Response Data**
- **Schedule Details**: Communication type, frequency, preferred time
- **Client Information**: Client name, contact details, last interaction
- **Next Scheduled**: When the next communication is due
- **Status**: Active/inactive status of each schedule

## 📅 **Use Cases**
- **Weekly Planning**: Sales reps planning their week on Sunday/Monday
- **Daily Review**: Checking today's scheduled communications
- **Client Relationship Management**: Maintaining regular client contact
- **Performance Tracking**: Monitoring communication consistency

## 🎯 **Filters**
- **Status**: Filter by active/inactive schedules
- **Communication Type**: Filter by phone, email, visit, etc.
- **Client**: Filter by specific client
- **Date Range**: Filter by next scheduled date range

## ⏰ **Timing**
- Perfect for Sunday planning sessions
- Daily morning reviews
- Weekly schedule optimization
		`,
	})
	@ApiQuery({
		name: 'page',
		required: false,
		type: Number,
		description: 'Page number for pagination (default: 1)',
		example: 1,
	})
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'Number of schedules per page (default: 20)',
		example: 20,
	})
	@ApiQuery({
		name: 'status',
		required: false,
		type: String,
		description: 'Filter by schedule status (active/inactive)',
		example: 'active',
	})
	@ApiQuery({
		name: 'communicationType',
		required: false,
		type: String,
		description: 'Filter by communication type',
		example: 'PHONE_CALL',
	})
	@ApiQuery({
		name: 'clientId',
		required: false,
		type: Number,
		description: 'Filter by specific client ID',
		example: 123,
	})
	@ApiQuery({
		name: 'startDate',
		required: false,
		type: String,
		description: 'Filter schedules from this date (ISO format)',
		example: '2024-01-01T00:00:00.000Z',
	})
	@ApiQuery({
		name: 'endDate',
		required: false,
		type: String,
		description: 'Filter schedules until this date (ISO format)',
		example: '2024-12-31T23:59:59.999Z',
	})
	@ApiOkResponse({
		description: '✅ Communication schedules retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'My communication schedules retrieved successfully',
				},
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1 },
							communicationType: { type: 'string', example: 'PHONE_CALL' },
							frequency: { type: 'string', example: 'WEEKLY' },
							preferredTime: { type: 'string', example: '09:00' },
							nextScheduledDate: { type: 'string', example: '2024-01-15T09:00:00.000Z' },
							lastCompletedDate: { type: 'string', example: '2024-01-08T09:30:00.000Z' },
							isActive: { type: 'boolean', example: true },
							client: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 123 },
									name: { type: 'string', example: 'LORO Corp' },
									email: { type: 'string', example: 'contact@loro.co.za' },
									phone: { type: 'string', example: '+27 11 123 4567' },
								}
							},
							visitCount: { type: 'number', example: 12 },
							notes: { type: 'string', example: 'Monthly check-in call' },
						}
					}
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 45 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 20 },
						totalPages: { type: 'number', example: 3 },
					}
				}
			},
		},
		examples: {
			weeklySchedules: {
				summary: '📅 Weekly Communication Schedules',
				value: {
					message: 'My communication schedules retrieved successfully',
					data: [
						{
							uid: 1,
							communicationType: 'PHONE_CALL',
							frequency: 'WEEKLY',
							preferredTime: '09:00',
							nextScheduledDate: '2024-01-15T09:00:00.000Z',
							lastCompletedDate: '2024-01-08T09:30:00.000Z',
							isActive: true,
							client: {
								uid: 123,
								name: 'LORO Corp',
								email: 'contact@loro.co.za',
								phone: '+27 11 123 4567'
							},
							visitCount: 12,
							notes: 'Weekly progress call'
						},
						{
							uid: 2,
							communicationType: 'IN_PERSON_VISIT',
							frequency: 'MONTHLY',
							preferredTime: '14:00',
							nextScheduledDate: '2024-01-20T14:00:00.000Z',
							lastCompletedDate: '2023-12-20T14:30:00.000Z',
							isActive: true,
							client: {
								uid: 456,
								name: 'TechStart Solutions',
								email: 'hello@techstart.co.za',
								phone: '+27 21 987 6543'
							},
							visitCount: 5,
							notes: 'Monthly client review meeting'
						}
					],
					meta: {
						total: 8,
						page: 1,
						limit: 20,
						totalPages: 1
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid request parameters',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Invalid date format or pagination parameters',
				},
			},
		},
	})
	async getMyCommunicationSchedules(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: string,
		@Query('communicationType') communicationType?: string,
		@Query('clientId') clientId?: number,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	): Promise<{ message: string; data?: any[]; meta?: any }> {
		const userId = req.user?.uid;
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);

		return this.clientsService.getUserCommunicationSchedules(
			userId,
			{
				page: page || 1,
				limit: limit || 20,
				status: status === 'active' ? true : status === 'inactive' ? false : undefined,
				communicationType,
				clientId,
				startDate: startDate ? new Date(startDate) : undefined,
				endDate: endDate ? new Date(endDate) : undefined,
			},
			orgId,
			branchId,
		);
	}
}
