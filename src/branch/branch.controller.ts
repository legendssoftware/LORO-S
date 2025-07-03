import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { BranchService } from './branch.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
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
	ApiBearerAuth,
	ApiForbiddenResponse,
	ApiConflictResponse,
	ApiUnprocessableEntityResponse,
	ApiInternalServerErrorResponse,
	ApiServiceUnavailableResponse,
	ApiConsumes,
	ApiProduces,
	ApiQuery
} from '@nestjs/swagger';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { isPublic } from '../decorators/public.decorator';
import { Branch } from './entities/branch.entity';

@ApiBearerAuth('JWT-auth')
@ApiTags('🏪 Branches')
@Controller('branch')
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
@ApiForbiddenResponse({
	description: '🚫 Forbidden - Insufficient permissions',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Insufficient permissions to access this resource' },
			error: { type: 'string', example: 'Forbidden' },
			statusCode: { type: 'number', example: 403 }
		}
	}
})
@ApiInternalServerErrorResponse({
	description: '💥 Internal Server Error',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'An unexpected error occurred while processing your request' },
			error: { type: 'string', example: 'Internal Server Error' },
			statusCode: { type: 'number', example: 500 }
		}
	}
})
@ApiServiceUnavailableResponse({
	description: '⚠️ Service Unavailable',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Branch service is temporarily unavailable' },
			error: { type: 'string', example: 'Service Unavailable' },
			statusCode: { type: 'number', example: 503 }
		}
	}
})
export class BranchController {
	constructor(private readonly branchService: BranchService) {}

	@Post()
	@isPublic()
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
		summary: '🏗️ Create a new branch',
		description: `
# Create Branch Location

Establishes a new branch location within your organization with comprehensive setup capabilities.

## 🏢 **Branch Types**
- **Retail Branches**: Customer-facing locations with point-of-sale systems
- **Office Branches**: Administrative and operational headquarters
- **Warehouse Branches**: Storage and distribution centers
- **Service Centers**: Technical support and maintenance facilities
- **Remote Locations**: Temporary or mobile service points

## 🔧 **Setup Features**
- Automatic branch code generation and reference assignment
- GPS coordinates and location mapping integration
- Staff assignment and access permission configuration
- Operating hours and business rules establishment
- Integration with existing organizational infrastructure

## 📋 **Required Information**
- Branch name and descriptive information
- Complete address and contact details
- Operational parameters and business hours
- Management structure and reporting hierarchy
- Service offerings and capabilities

## 🎯 **Use Cases**
- **Business Expansion**: Open new locations to serve growing customer base
- **Operational Efficiency**: Distribute services across geographic regions
- **Compliance Requirements**: Meet regulatory requirements for local presence
- **Customer Service**: Provide localized support and service delivery
- **Resource Management**: Optimize staff and resource allocation

## 🔒 **Security & Compliance**
- Role-based access control for branch creation
- Audit trail for all branch establishment activities
- Compliance with local business registration requirements
- Data protection and privacy policy enforcement
		`
	})
	@ApiBody({ 
		type: CreateBranchDto,
		description: 'Branch creation payload with all required setup information',
		examples: {
			retail: {
				summary: '🏪 Retail Branch',
				description: 'Customer-facing retail location setup',
				value: {
					name: 'Downtown Retail Store',
					description: 'Main retail location serving the city center',
					address: '123 Main Street, Downtown District',
					city: 'Johannesburg',
					province: 'Gauteng',
					postalCode: '2001',
					country: 'South Africa',
					phone: '+27-11-123-4567',
					email: 'downtown@company.co.za',
					branchType: 'RETAIL',
					operatingHours: {
						monday: '08:00-17:00',
						tuesday: '08:00-17:00',
						wednesday: '08:00-17:00',
						thursday: '08:00-17:00',
						friday: '08:00-17:00',
						saturday: '09:00-13:00',
						sunday: 'Closed'
					},
					managerId: 45,
					latitude: -26.2041,
					longitude: 28.0473
				}
			},
			office: {
				summary: '🏢 Corporate Office',
				description: 'Administrative headquarters setup',
				value: {
					name: 'Corporate Headquarters',
					description: 'Main administrative and management office',
					address: '456 Business Park Drive, Sandton',
					city: 'Sandton',
					province: 'Gauteng',
					postalCode: '2196',
					country: 'South Africa',
					phone: '+27-11-987-6543',
					email: 'headquarters@company.co.za',
					branchType: 'OFFICE',
					operatingHours: {
						monday: '07:30-17:00',
						tuesday: '07:30-17:00',
						wednesday: '07:30-17:00',
						thursday: '07:30-17:00',
						friday: '07:30-16:00',
						saturday: 'Closed',
						sunday: 'Closed'
					},
					managerId: 23,
					latitude: -26.1076,
					longitude: 28.0567
				}
			},
			warehouse: {
				summary: '📦 Distribution Center',
				description: 'Warehouse and distribution facility',
				value: {
					name: 'Central Distribution Hub',
					description: 'Primary warehouse and logistics center',
					address: '789 Industrial Avenue, Kempton Park',
					city: 'Kempton Park',
					province: 'Gauteng',
					postalCode: '1619',
					country: 'South Africa',
					phone: '+27-11-555-0123',
					email: 'warehouse@company.co.za',
					branchType: 'WAREHOUSE',
					operatingHours: {
						monday: '06:00-18:00',
						tuesday: '06:00-18:00',
						wednesday: '06:00-18:00',
						thursday: '06:00-18:00',
						friday: '06:00-18:00',
						saturday: '08:00-12:00',
						sunday: 'Closed'
					},
					managerId: 67,
					latitude: -26.1225,
					longitude: 28.2314
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Branch created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Branch created successfully' },
				branch: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'Downtown Branch' },
						email: { type: 'string', example: 'downtown@company.com' },
						phone: { type: 'string', example: '+1-555-0123' },
						address: { type: 'string', example: '123 Main St, City, State 12345' },
						refCode: { type: 'string', example: 'BR-DT-001' },
						isActive: { type: 'boolean', example: true },
						createdAt: { type: 'string', example: '2024-01-15T10:30:00Z' },
						updatedAt: { type: 'string', example: '2024-01-15T10:30:00Z' }
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Validation failed: Branch name is required, email must be valid format' 
				},
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Branch name must be at least 3 characters long',
						'Email must be a valid email address',
						'Phone number format is invalid'
					]
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '🔄 Conflict - Branch with similar details already exists',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'A branch with this name already exists in your organization' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflictField: { type: 'string', example: 'name' }
			}
		}
	})
	@ApiUnprocessableEntityResponse({
		description: '🔧 Unprocessable Entity - Business logic validation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot create branch: Organization has reached maximum branch limit' },
				error: { type: 'string', example: 'Unprocessable Entity' },
				statusCode: { type: 'number', example: 422 },
				reason: { type: 'string', example: 'BRANCH_LIMIT_EXCEEDED' }
			}
		}
	})
	create(@Body() createBranchDto: CreateBranchDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.branchService.create(createBranchDto, orgId, branchId);
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
		summary: '📋 Get all branches',
		description: `
# Branch Directory

Retrieves a comprehensive directory of all active branches within your organization.

## 📊 **Directory Features**
- **Real-time Status**: Current operational status and availability
- **Performance Metrics**: Key performance indicators and statistics
- **Staff Information**: Employee count and management details
- **Contact Details**: Complete contact information and addresses
- **Service Capabilities**: Services offered and operational capacity

## 🔍 **Filtering & Sorting**
- Filter by branch type (Retail, Office, Warehouse, Service Center)
- Sort by performance metrics, location, or establishment date
- Search by name, location, or contact information
- Filter by operational status (Active, Maintenance, Temporary Closure)

## 📈 **Business Intelligence**
- **Performance Analytics**: Revenue, productivity, and efficiency metrics
- **Staff Utilization**: Employee allocation and capacity planning
- **Operational Insights**: Hours of operation and service delivery
- **Geographic Distribution**: Location-based analysis and coverage

## 🎯 **Use Cases**
- **Operational Planning**: Resource allocation and capacity management
- **Performance Monitoring**: Track branch performance and productivity
- **Customer Service**: Provide accurate branch information to customers
- **Compliance Reporting**: Generate regulatory and compliance reports
- **Strategic Planning**: Expansion and optimization decision support

## 🔒 **Access Control**
- Results filtered based on user permissions and organizational access
- Branch-specific data access based on user assignments
- Role-based information visibility and data protection
		`
	})
	@ApiOkResponse({
		description: '📊 Branches retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				branches: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 12345 },
							name: { type: 'string', example: 'Downtown Branch' },
							email: { type: 'string', example: 'downtown@company.com' },
							phone: { type: 'string', example: '+1-555-0123' },
							address: { type: 'string', example: '123 Main St, City, State 12345' },
							refCode: { type: 'string', example: 'BR-DT-001' },
							isActive: { type: 'boolean', example: true },
							staffCount: { type: 'number', example: 25 },
							createdAt: { type: 'string', example: '2024-01-15T10:30:00Z' },
							updatedAt: { type: 'string', example: '2024-01-15T10:30:00Z' }
						}
					}
				},
				totalCount: { type: 'number', example: 5 },
				activeCount: { type: 'number', example: 4 },
				inactiveCount: { type: 'number', example: 1 },
				message: { type: 'string', example: 'Branches retrieved successfully' }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 No branches found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No branches found for your organization' },
				branches: { type: 'array', items: {}, example: [] },
				totalCount: { type: 'number', example: 0 }
			}
		}
	})
	findAll(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.branchService.findAll(orgId, branchId);
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
		summary: '🔍 Get branch by reference code',
		description: `
# Branch Profile & Analytics

Retrieves comprehensive information about a specific branch including detailed analytics and operational insights.

## 🏢 **Branch Profile**
- **Identity Information**: Complete branch details, contact information, and location data
- **Operational Status**: Current status, operating hours, and service capabilities
- **Management Structure**: Leadership team, reporting hierarchy, and organizational structure
- **Performance Metrics**: Key performance indicators, productivity measurements, and efficiency ratings
- **Historical Data**: Establishment date, milestone achievements, and growth trajectory

## 👥 **Staff Information**
- **Employee Directory**: Complete staff roster with roles and contact information
- **Management Team**: Branch leadership and key personnel details
- **Capacity Planning**: Staffing levels, utilization rates, and resource allocation
- **Performance Tracking**: Individual and team performance metrics
- **Training Records**: Certification status and professional development tracking

## 📊 **Analytics Dashboard**
- **Revenue Analytics**: Sales performance, revenue trends, and financial metrics
- **Operational Efficiency**: Process optimization and productivity measurements
- **Customer Metrics**: Service quality scores, customer satisfaction ratings
- **Resource Utilization**: Equipment usage, facility capacity, and asset management
- **Cost Analysis**: Operational expenses, cost per transaction, and budget tracking

## 🎯 **Use Cases**
- **Performance Review**: Comprehensive branch performance evaluation
- **Operational Planning**: Resource allocation and capacity management
- **Compliance Auditing**: Regulatory compliance and policy adherence verification
- **Strategic Planning**: Expansion planning and optimization strategies
- **Customer Service**: Detailed branch information for customer inquiries
- **Staff Management**: Employee administration and performance tracking

## 🔒 **Security & Access**
- Role-based access control for sensitive branch information
- Audit trail for all branch profile access and modifications
- Data protection compliance for employee and customer information
		`
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Unique branch reference code (e.g., BR-DT-001)', 
		type: 'string',
		example: 'BR-DT-001'
	})
	@ApiOkResponse({
		description: '🏢 Branch details retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				branch: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'Downtown Branch' },
						email: { type: 'string', example: 'downtown@company.com' },
						phone: { type: 'string', example: '+1-555-0123' },
						address: { type: 'string', example: '123 Main St, City, State 12345' },
						refCode: { type: 'string', example: 'BR-DT-001' },
						isActive: { type: 'boolean', example: true },
						description: { type: 'string', example: 'Main downtown location serving the city center' },
						operatingHours: {
							type: 'object',
							properties: {
								monday: { type: 'string', example: '09:00-17:00' },
								tuesday: { type: 'string', example: '09:00-17:00' },
								wednesday: { type: 'string', example: '09:00-17:00' },
								thursday: { type: 'string', example: '09:00-17:00' },
								friday: { type: 'string', example: '09:00-17:00' },
								saturday: { type: 'string', example: '10:00-14:00' },
								sunday: { type: 'string', example: 'Closed' }
							}
						},
						staff: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 456 },
									name: { type: 'string', example: 'John Doe' },
									role: { type: 'string', example: 'Manager' },
									isActive: { type: 'boolean', example: true }
								}
							}
						},
						metrics: {
							type: 'object',
							properties: {
								totalStaff: { type: 'number', example: 25 },
								activeStaff: { type: 'number', example: 23 },
								totalSales: { type: 'number', example: 125000.50 },
								monthlyTarget: { type: 'number', example: 150000.00 }
							}
						},
						createdAt: { type: 'string', example: '2024-01-15T10:30:00Z' },
						updatedAt: { type: 'string', example: '2024-01-15T10:30:00Z' }
					}
				},
				message: { type: 'string', example: 'Branch details retrieved successfully' }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Branch not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Branch with reference code "BR-DT-001" not found or you don\'t have access to it' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				requestedRef: { type: 'string', example: 'BR-DT-001' }
			}
		}
	})
	findOne(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.branchService.findOne(ref, orgId, branchId);
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
		summary: '✏️ Update branch information',
		description: `
# Branch Management System

Updates existing branch information with comprehensive validation and audit trail capabilities.

## 🔄 **Update Categories**
- **Basic Information**: Name, description, contact details, and address modifications
- **Operational Settings**: Operating hours, service capabilities, and business rules
- **Staff Management**: Manager assignments, employee allocations, and role changes
- **Financial Parameters**: Budget allocations, cost centers, and financial reporting
- **Compliance Updates**: Regulatory requirements, policy adherence, and certification status

## 🔒 **Security & Validation**
- **Permission Checks**: Role-based authorization for different update categories
- **Business Rule Validation**: Ensures updates comply with organizational policies
- **Data Integrity**: Maintains consistency across related systems and records
- **Audit Trail**: Complete logging of all changes with user identification and timestamps
- **Rollback Capability**: Ability to revert changes if issues are identified

## 📋 **Supported Operations**
- **Partial Updates**: Modify only specific fields without affecting others
- **Bulk Updates**: Apply multiple changes in a single transaction
- **Conditional Updates**: Apply changes based on current state conditions
- **Scheduled Updates**: Plan and execute updates at specific times
- **Approval Workflows**: Route sensitive changes through approval processes

## 🎯 **Common Use Cases**
- **Contact Information**: Update phone numbers, email addresses, and physical addresses
- **Operational Changes**: Modify operating hours, service offerings, and capacity
- **Staff Changes**: Update management assignments and employee allocations
- **Performance Tuning**: Adjust operational parameters based on performance metrics
- **Compliance Updates**: Ensure adherence to regulatory requirements and policies
- **Technology Updates**: Integrate new systems and update technical specifications

## 📊 **Change Management**
- **Impact Analysis**: Assess the impact of changes on operations and staff
- **Communication**: Notify relevant stakeholders of important changes
- **Documentation**: Maintain comprehensive records of all modifications
- **Monitoring**: Track the effectiveness of changes and identify issues
		`
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Unique branch reference code to update', 
		type: 'string',
		example: 'BR-DT-001'
	})
	@ApiBody({ 
		type: UpdateBranchDto,
		description: 'Branch update payload with fields to modify. All fields are optional - only provided fields will be updated.',
		examples: {
			contactUpdate: {
				summary: '📞 Contact Information Update',
				description: 'Update branch contact details and address',
				value: {
					phone: '+27-11-999-8888',
					email: 'newcontact@company.co.za',
					address: '456 New Business Street, Updated District',
					city: 'Cape Town',
					province: 'Western Cape',
					postalCode: '8001'
				}
			},
			operationalUpdate: {
				summary: '🕐 Operational Hours Update',
				description: 'Modify branch operating hours and service capabilities',
				value: {
					operatingHours: {
						monday: '07:00-18:00',
						tuesday: '07:00-18:00',
						wednesday: '07:00-18:00',
						thursday: '07:00-18:00',
						friday: '07:00-17:00',
						saturday: '08:00-14:00',
						sunday: 'Closed'
					},
					serviceCapabilities: ['Customer Service', 'Technical Support', 'Sales'],
					maxCapacity: 150
				}
			},
			managementUpdate: {
				summary: '👥 Management Assignment',
				description: 'Update branch management and staff assignments',
				value: {
					managerId: 89,
					assistantManagerId: 45,
					staffCapacity: 25,
					departments: ['Sales', 'Customer Service', 'Administration']
				}
			},
			statusUpdate: {
				summary: '🔄 Status and Configuration',
				description: 'Update branch status and operational configuration',
				value: {
					isActive: true,
					branchType: 'RETAIL',
					priority: 'HIGH',
					specialServices: ['Express Service', 'VIP Lounge', 'Corporate Banking']
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Branch updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Branch updated successfully' },
				branch: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'Downtown Branch - Updated' },
						email: { type: 'string', example: 'downtown.updated@company.com' },
						phone: { type: 'string', example: '+1-555-0124' },
						address: { type: 'string', example: '123 Main St, City, State 12345' },
						refCode: { type: 'string', example: 'BR-DT-001' },
						isActive: { type: 'boolean', example: true },
						updatedAt: { type: 'string', example: '2024-01-15T15:45:00Z' }
					}
				},
				updatedFields: {
					type: 'array',
					items: { type: 'string' },
					example: ['name', 'email', 'phone']
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Branch not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Branch with reference code "BR-DT-001" not found or you don\'t have permission to update it' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				requestedRef: { type: 'string', example: 'BR-DT-001' }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid update data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed: Invalid email format provided' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Email must be a valid email address',
						'Phone number format is invalid'
					]
				}
			}
		}
	})
	@ApiConflictResponse({
		description: '🔄 Conflict - Update would create duplicate',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'A branch with this name already exists in your organization' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflictField: { type: 'string', example: 'name' },
				existingBranch: { type: 'string', example: 'BR-DT-002' }
			}
		}
	})
	update(@Param('ref') ref: string, @Body() updateBranchDto: UpdateBranchDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.branchService.update(ref, updateBranchDto, orgId, branchId);
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
		summary: '🗑️ Soft delete a branch',
		description: `
# Branch Deactivation System

Safely deactivates a branch while preserving all historical data and maintaining system integrity.

## 🔒 **Safe Deactivation Process**
- **Soft Delete**: Branch is marked as inactive but remains in database
- **Data Preservation**: All historical records, transactions, and relationships maintained
- **Audit Trail**: Complete logging of deactivation process with user identification
- **Reversible Action**: Deactivated branches can be restored if needed
- **Compliance**: Maintains regulatory compliance for record retention

## ⚠️ **Pre-Deactivation Checks**
- **Staff Reassignment**: All active staff must be reassigned to other branches
- **Asset Transfer**: Physical assets and equipment must be reallocated
- **Financial Reconciliation**: All financial transactions must be completed and reconciled
- **Customer Communication**: Customer notifications and service transfer arrangements
- **Compliance Verification**: Ensures all regulatory requirements are met

## 📋 **Deactivation Process**
- **Impact Assessment**: Analyze the impact on operations, staff, and customers
- **Stakeholder Notification**: Inform all relevant parties of the deactivation
- **Data Migration**: Transfer active records to appropriate systems
- **Asset Management**: Redistribute physical and digital assets
- **Final Reporting**: Generate comprehensive deactivation reports

## 🎯 **Common Scenarios**
- **Business Restructuring**: Organizational changes requiring branch consolidation
- **Performance Issues**: Underperforming branches requiring closure
- **Location Changes**: Relocating branch operations to new premises
- **Regulatory Compliance**: Meeting regulatory requirements for branch operations
- **Cost Optimization**: Reducing operational costs through branch consolidation
- **Strategic Planning**: Aligning branch network with business strategy

## 🔄 **Recovery Options**
- **Restoration Process**: Reactivate deactivated branches with full data integrity
- **Partial Recovery**: Restore specific data or functionality as needed
- **Data Export**: Extract historical data for reporting or compliance purposes
- **Archive Management**: Long-term storage and retrieval of branch information

## 🔒 **Security & Compliance**
- **Authorization Controls**: Multiple approval levels for branch deactivation
- **Data Protection**: Ensures customer and employee data remains secure
- **Regulatory Compliance**: Maintains compliance with industry regulations
- **Audit Requirements**: Comprehensive documentation for audit purposes
		`
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Unique branch reference code to delete', 
		type: 'string',
		example: 'BR-DT-001'
	})
	@ApiOkResponse({
		description: '✅ Branch deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Branch deleted successfully' },
				branch: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'Downtown Branch' },
						refCode: { type: 'string', example: 'BR-DT-001' },
						isDeleted: { type: 'boolean', example: true },
						deletedAt: { type: 'string', example: '2024-01-15T16:30:00Z' }
					}
				},
				affectedRecords: {
					type: 'object',
					properties: {
						staffReassigned: { type: 'number', example: 3 },
						activeTasksTransferred: { type: 'number', example: 12 },
						pendingOrdersHandled: { type: 'number', example: 5 }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Branch not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Branch with reference code "BR-DT-001" not found or you don\'t have permission to delete it' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				requestedRef: { type: 'string', example: 'BR-DT-001' }
			}
		}
	})
	@ApiUnprocessableEntityResponse({
		description: '🔧 Unprocessable Entity - Cannot delete branch',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot delete branch: Active staff members are still assigned to this branch' },
				error: { type: 'string', example: 'Unprocessable Entity' },
				statusCode: { type: 'number', example: 422 },
				reason: { type: 'string', example: 'ACTIVE_STAFF_ASSIGNED' },
				blockers: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'5 active staff members assigned',
						'3 pending orders in queue',
						'Branch is set as primary location'
					]
				}
			}
		}
	})
	remove(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.branchService.remove(ref, orgId, branchId);
	}
}
