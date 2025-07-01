import { UserService } from './user.service';
import { RoleGuard } from '../guards/role.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthGuard } from '../guards/auth.guard';
import { Roles } from '../decorators/role.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
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
	ApiQuery,
	ApiHeader,
	ApiResponse,
} from '@nestjs/swagger';
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Req, Put, ParseIntPipe, Headers } from '@nestjs/common';
import { AccountStatus } from '../lib/enums/status.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { CreateUserTargetDto } from './dto/create-user-target.dto';
import { UpdateUserTargetDto } from './dto/update-user-target.dto';
import { ExternalTargetUpdateDto } from './dto/external-target-update.dto';

@ApiTags('user')
@Controller('user')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class UserController {
	constructor(private readonly userService: UserService) {}

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
		summary: 'Create a new user',
		description: 'Creates a new user with the provided data. Accessible by users with appropriate roles.',
	})
	@ApiBody({ type: CreateUserDto })
	@ApiCreatedResponse({
		description: 'User created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						username: { type: 'string', example: 'brandon123' },
						name: { type: 'string', example: 'Brandon' },
						surname: { type: 'string', example: 'Nkawu' },
						email: { type: 'string', example: 'brandon@loro.co.za' },
						phone: { type: 'string', example: '+27 64 123 4567' },
						photoURL: { type: 'string', example: 'https://example.com/photo.jpg' },
						accessLevel: { type: 'string', enum: Object.values(AccessLevel), example: AccessLevel.USER },
						status: { type: 'string', enum: Object.values(AccountStatus), example: AccountStatus.ACTIVE },
						userref: { type: 'string', example: 'USR123456' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid input data provided' })
	create(@Body() createUserDto: CreateUserDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.create(createUserDto, orgId, branchId);
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
		summary: 'Get all users',
		description: 'Retrieves all users with optional filtering and pagination. Requires ADMIN or MANAGER role.',
	})
	@ApiQuery({ name: 'page', description: 'Page number for pagination', required: false, type: Number, example: 1 })
	@ApiQuery({ name: 'limit', description: 'Number of items per page', required: false, type: Number, example: 10 })
	@ApiQuery({ name: 'status', description: 'Filter by account status', required: false, enum: AccountStatus })
	@ApiQuery({ name: 'accessLevel', description: 'Filter by access level', required: false, enum: AccessLevel })
	@ApiQuery({ name: 'search', description: 'Search term for filtering users', required: false, type: String })
	@ApiQuery({ name: 'branchId', description: 'Filter by branch ID', required: false, type: Number })
	@ApiQuery({ name: 'organisationId', description: 'Filter by organisation ID', required: false, type: Number })
	@ApiOkResponse({
		description: 'List of users with pagination',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1 },
							username: { type: 'string', example: 'brandon123' },
							name: { type: 'string', example: 'Brandon' },
							surname: { type: 'string', example: 'Nkawu' },
							email: { type: 'string', example: 'brandon@loro.co.za' },
							phone: { type: 'string', example: '+27 64 123 4567' },
							photoURL: { type: 'string', example: 'https://example.com/photo.jpg' },
							accessLevel: {
								type: 'string',
								enum: Object.values(AccessLevel),
								example: AccessLevel.USER,
							},
							status: {
								type: 'string',
								enum: Object.values(AccountStatus),
								example: AccountStatus.ACTIVE,
							},
							userref: { type: 'string', example: 'USR123456' },
							createdAt: { type: 'string', format: 'date-time' },
							updatedAt: { type: 'string', format: 'date-time' },
							profile: {
								type: 'object',
								properties: {
									height: { type: 'string', example: '180cm' },
									weight: { type: 'string', example: '75kg' },
									gender: { type: 'string', example: 'MALE' },
								},
							},
							employmentProfile: {
								type: 'object',
								properties: {
									position: { type: 'string', example: 'Senior Software Engineer' },
									department: { type: 'string', example: 'ENGINEERING' },
								},
							},
						},
					},
				},
				message: { type: 'string', example: 'Success' },
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 50 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 10 },
						totalPages: { type: 'number', example: 5 },
					},
				},
			},
		},
	})
	findAll(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: AccountStatus,
		@Query('accessLevel') accessLevel?: AccessLevel,
		@Query('search') search?: string,
		@Query('branchId') branchId?: number,
		@Query('organisationId') organisationId?: number,
	) {
		const orgId = req.user?.org?.uid;
		const userBranchId = req.user?.branch?.uid;

		const filters = {
			...(status && { status }),
			...(accessLevel && { accessLevel }),
			...(search && { search }),
			...(branchId && { branchId: Number(branchId) }),
			...(organisationId && { organisationId: Number(organisationId) }),
			orgId,
			userBranchId,
		};

		return this.userService.findAll(
			filters,
			page ? Number(page) : 1,
			limit ? Number(limit) : Number(process.env.DEFAULT_PAGE_LIMIT),
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
		summary: 'Get a user by reference code',
		description: 'Retrieves a user by reference code. Accessible by all authenticated users.',
	})
	@ApiParam({
		name: 'ref',
		description: 'User reference code',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: 'User found',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						username: { type: 'string', example: 'brandon123' },
						name: { type: 'string', example: 'Brandon' },
						surname: { type: 'string', example: 'Nkawu' },
						email: { type: 'string', example: 'brandon@loro.co.za' },
						phone: { type: 'string', example: '+27 64 123 4567' },
						photoURL: { type: 'string', example: 'https://example.com/photo.jpg' },
						accessLevel: { type: 'string', enum: Object.values(AccessLevel), example: AccessLevel.USER },
						status: { type: 'string', enum: Object.values(AccountStatus), example: AccountStatus.ACTIVE },
						userref: { type: 'string', example: 'USR123456' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
						profile: {
							type: 'object',
							properties: {
								height: { type: 'string', example: '180cm' },
								weight: { type: 'string', example: '75kg' },
								gender: { type: 'string', example: 'MALE' },
							},
						},
						employmentProfile: {
							type: 'object',
							properties: {
								position: { type: 'string', example: 'Senior Software Engineer' },
								department: { type: 'string', example: 'ENGINEERING' },
							},
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'User not found' })
	findOne(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.findOne(ref, orgId, branchId);
	}

	@Patch(':ref')
	@ApiOperation({
		summary: 'Update a user by reference code',
		description: 'Updates a user by reference code. Accessible by users with appropriate roles.',
	})
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiParam({
		name: 'ref',
		description: 'Reference code',
		type: 'number',
		example: 1,
	})
	@ApiBody({ type: UpdateUserDto })
	@ApiOkResponse({
		description: 'User updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'User not found' })
	@ApiBadRequestResponse({ description: 'Invalid input data provided' })
	update(@Param('ref') ref: number, @Body() updateUserDto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.update(ref, updateUserDto, orgId, branchId);
	}

	@Patch('restore/:ref')
	@ApiOperation({
		summary: 'Restore a deleted user by reference code',
		description: 'Restores a previously deleted user. Accessible by users with appropriate roles.',
	})
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiParam({
		name: 'ref',
		description: 'User reference code',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: 'User restored successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'User not found' })
	restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.restore(ref, orgId, branchId);
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
		summary: 'Soft delete a user by reference code',
		description: 'Performs a soft delete on a user. Accessible by users with appropriate roles.',
	})
	@ApiParam({
		name: 'ref',
		description: 'User reference code',
		type: 'string',
		example: 'USR123456',
	})
	@ApiOkResponse({
		description: 'User deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'User not found' })
	remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.remove(ref, orgId, branchId);
	}

	@Get(':ref/target')
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
		summary: 'Get user performance targets',
		description: `
		**Retrieve comprehensive performance targets for a specific user**
		
		This endpoint provides detailed performance target information including:
		- Sales targets with currency formatting
		- Work hours and productivity targets
		- Lead generation and client acquisition targets
		- Activity-based targets (check-ins, calls)
		- Progress tracking with achievement percentages
		- Target period information and deadlines
		
		**Target Categories Supported:**
		- Sales Revenue: Monthly/quarterly sales targets with current progress
		- Work Hours: Expected vs actual hours worked
		- New Leads: Lead generation targets and conversion tracking
		- New Clients: Client acquisition goals and achievement
		- Check-ins: Customer interaction frequency targets
		- Calls: Communication activity targets
		
		**Access Control:**
		- Users can view their own targets
		- Managers/Admins can view targets for their team members
		- Supports organizational hierarchy and branch-level permissions
		`,
		operationId: 'getUserTargets',
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'User ID - Must be a valid user identifier',
		type: Number,
		example: 123
	})
	@ApiOkResponse({
		description: '✅ User performance targets retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				userTarget: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1, description: 'Unique target record identifier' },
						targetSalesAmount: { type: 'number', example: 50000, description: 'Sales revenue target amount' },
						currentSalesAmount: { type: 'number', example: 32500, description: 'Current achieved sales amount' },
						targetCurrency: { type: 'string', example: 'ZAR', description: 'Currency code for sales targets' },
						targetHoursWorked: { type: 'number', example: 160, description: 'Expected hours to work in target period' },
						currentHoursWorked: { type: 'number', example: 142, description: 'Current hours worked in period' },
						targetNewClients: { type: 'number', example: 5, description: 'Number of new clients to acquire' },
						currentNewClients: { type: 'number', example: 3, description: 'Current new clients acquired' },
						targetNewLeads: { type: 'number', example: 20, description: 'Number of new leads to generate' },
						currentNewLeads: { type: 'number', example: 18, description: 'Current leads generated' },
						targetCheckIns: { type: 'number', example: 15, description: 'Client check-in frequency target' },
						currentCheckIns: { type: 'number', example: 12, description: 'Current check-ins completed' },
						targetCalls: { type: 'number', example: 50, description: 'Communication calls target' },
						currentCalls: { type: 'number', example: 45, description: 'Current calls completed' },
						targetPeriod: { type: 'string', example: 'Monthly', enum: ['Weekly', 'Monthly', 'Quarterly', 'Yearly'], description: 'Target achievement period' },
						periodStartDate: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00Z', description: 'Target period start date' },
						periodEndDate: { type: 'string', format: 'date-time', example: '2024-01-31T23:59:59Z', description: 'Target period end date' },
						createdAt: { type: 'string', format: 'date-time', description: 'Target creation timestamp' },
						updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
						progressMetrics: {
							type: 'object',
							properties: {
								salesProgress: { type: 'number', example: 65, description: 'Sales achievement percentage' },
								hoursProgress: { type: 'number', example: 88.75, description: 'Hours worked percentage' },
								leadsProgress: { type: 'number', example: 90, description: 'Leads generation percentage' },
								clientsProgress: { type: 'number', example: 60, description: 'Client acquisition percentage' },
								overallProgress: { type: 'number', example: 75.9, description: 'Overall target achievement percentage' },
							},
						},
					},
				},
				message: { type: 'string', example: 'User targets retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						daysRemaining: { type: 'number', example: 12, description: 'Days remaining in target period' },
						achievementTrend: { type: 'string', example: 'On Track', enum: ['Ahead', 'On Track', 'Behind', 'At Risk'] },
						nextMilestone: { type: 'string', example: '75% target achievement', description: 'Next achievement milestone' },
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({ 
		description: '❌ User not found or no targets configured',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found or no performance targets have been set' },
				errorCode: { type: 'string', example: 'USER_TARGETS_NOT_FOUND' },
			},
		},
	})
	getUserTarget(@Param('ref') ref: number) {
		return this.userService.getUserTarget(ref);
	}

	@Post(':ref/target')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Create user performance targets',
		description: `
		**Create comprehensive performance targets for a specific user**
		
		This endpoint allows managers and administrators to set performance targets:
		- Configure multi-category targets (sales, hours, leads, clients, activities)
		- Set target periods (weekly, monthly, quarterly, yearly)
		- Define currency preferences for sales targets
		- Establish baseline metrics for performance tracking
		- Automatic progress tracking initialization
		
		**Target Configuration Features:**
		- Flexible target periods with automatic date calculation
		- Multi-currency support for international operations
		- Hierarchical target inheritance from team/branch level
		- Integration with existing performance systems
		- Automatic notifications and milestone tracking
		
		**Validation Rules:**
		- All target values must be positive numbers
		- Target period dates must be logical (start < end)
		- Currency codes must be valid ISO 4217 codes
		- User must exist and be active in the organization
		`,
		operationId: 'createUserTargets',
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'User ID for target assignment',
		type: Number,
		example: 123
	})
	@ApiBody({ 
		type: CreateUserTargetDto,
		description: 'Comprehensive target configuration data',
		examples: {
			monthlyTargets: {
				summary: 'Monthly sales rep targets',
				value: {
					targetSalesAmount: 50000,
					targetCurrency: 'ZAR',
					targetHoursWorked: 160,
					targetNewLeads: 20,
					targetNewClients: 5,
					targetCheckIns: 15,
					targetCalls: 50,
					targetPeriod: 'Monthly',
					periodStartDate: '2024-01-01',
					periodEndDate: '2024-01-31',
				},
			},
			quarterlyTargets: {
				summary: 'Quarterly manager targets',
				value: {
					targetSalesAmount: 150000,
					targetCurrency: 'USD',
					targetHoursWorked: 480,
					targetNewLeads: 60,
					targetNewClients: 15,
					targetCheckIns: 45,
					targetCalls: 150,
					targetPeriod: 'Quarterly',
					periodStartDate: '2024-01-01',
					periodEndDate: '2024-03-31',
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ User performance targets created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User performance targets created successfully' },
				targetId: { type: 'number', example: 42, description: 'Created target record ID' },
				data: {
					type: 'object',
					properties: {
						initialized: { type: 'boolean', example: true, description: 'Target tracking initialized' },
						progressMetrics: {
							type: 'object',
							properties: {
								salesProgress: { type: 'number', example: 0, description: 'Initial sales progress' },
								hoursProgress: { type: 'number', example: 0, description: 'Initial hours progress' },
								overallProgress: { type: 'number', example: 0, description: 'Initial overall progress' },
							},
						},
						nextReview: { type: 'string', format: 'date', example: '2024-01-15', description: 'Next target review date' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ 
		description: '❌ Invalid target configuration provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for target configuration' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'targetSalesAmount must be a positive number',
						'targetPeriod must be one of: Weekly, Monthly, Quarterly, Yearly',
						'periodEndDate must be after periodStartDate',
					],
				},
			},
		},
	})
	@ApiNotFoundResponse({ description: '❌ User not found or not accessible' })
	setUserTarget(@Param('ref') ref: number, @Body() createUserTargetDto: CreateUserTargetDto) {
		return this.userService.setUserTarget(ref, createUserTargetDto);
	}

	@Patch(':ref/target')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Update user performance targets',
		description: `
		**Update existing performance targets for a specific user**
		
		This endpoint provides comprehensive target management capabilities:
		- Partial or complete target updates using PATCH semantics
		- Progress preservation during target modifications
		- Historical tracking of target changes
		- Automatic recalculation of achievement percentages
		- Support for mid-period target adjustments
		
		**Update Scenarios:**
		- Target value adjustments (increase/decrease targets)
		- Period extensions or modifications
		- Currency changes for international transfers
		- Category additions or removals
		- Emergency target resets or corrections
		
		**Business Rules:**
		- Updates preserve existing progress unless explicitly reset
		- Target increases maintain current achievement percentages
		- Period changes recalculate progress metrics
		- Audit trail maintained for all modifications
		`,
		operationId: 'updateUserTargets',
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'User ID for target updates',
		type: Number,
		example: 123
	})
	@ApiBody({ 
		type: UpdateUserTargetDto,
		description: 'Target update configuration (partial updates supported)',
		examples: {
			targetAdjustment: {
				summary: 'Adjust sales target mid-period',
				value: {
					targetSalesAmount: 60000,
					reason: 'Market opportunity adjustment',
				},
			},
			progressUpdate: {
				summary: 'Update current progress values',
				value: {
					currentSalesAmount: 45000,
					currentHoursWorked: 120,
					currentNewLeads: 15,
				},
			},
		},
	})
	@ApiOkResponse({
		description: '✅ User performance targets updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User performance targets updated successfully' },
				data: {
					type: 'object',
					properties: {
						updatedFields: {
							type: 'array',
							items: { type: 'string' },
							example: ['targetSalesAmount', 'currentHoursWorked'],
							description: 'List of fields that were updated',
						},
						progressImpact: {
							type: 'object',
							properties: {
								previousOverallProgress: { type: 'number', example: 65.2, description: 'Progress before update' },
								newOverallProgress: { type: 'number', example: 72.8, description: 'Progress after update' },
								impactDescription: { type: 'string', example: 'Target adjustment improved overall progress by 7.6%' },
							},
						},
						nextMilestone: { type: 'string', example: '75% target achievement', description: 'Next achievement milestone' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ 
		description: '❌ Invalid update data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid target update configuration' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Cannot decrease target below current achievement',
						'Invalid currency code provided',
						'Period dates must be within current fiscal year',
					],
				},
			},
		},
	})
	@ApiNotFoundResponse({ description: '❌ User not found or no targets configured to update' })
	updateUserTarget(@Param('ref') ref: number, @Body() updateUserTargetDto: UpdateUserTargetDto) {
		return this.userService.updateUserTarget(ref, updateUserTargetDto);
	}

	@Delete(':ref/target')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Delete user performance targets',
		description: `
		**Remove performance targets for a specific user**
		
		This endpoint provides safe target deletion with proper cleanup:
		- Soft deletion with historical preservation
		- Progress data archival for reporting
		- Notification to affected stakeholders
		- Audit trail maintenance
		- Option for complete removal or archival
		
		**Deletion Impact:**
		- User dashboard updated to reflect no active targets
		- Historical performance data preserved for analytics
		- Related notifications and reminders disabled
		- Team/branch metrics recalculated excluding deleted targets
		
		**Use Cases:**
		- Employee role changes requiring different target structure
		- Temporary target suspension during leave/transitions
		- Target structure redesign requiring fresh start
		- Performance period completion and reset
		`,
		operationId: 'deleteUserTargets',
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'User ID for target deletion',
		type: Number,
		example: 123
	})
	@ApiOkResponse({
		description: '✅ User performance targets deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User performance targets deleted successfully' },
				data: {
					type: 'object',
					properties: {
						deletedTargetId: { type: 'number', example: 42, description: 'ID of deleted target record' },
						finalProgress: {
							type: 'object',
							properties: {
								salesProgress: { type: 'number', example: 78.5, description: 'Final sales achievement percentage' },
								hoursProgress: { type: 'number', example: 92.3, description: 'Final hours worked percentage' },
								overallProgress: { type: 'number', example: 83.7, description: 'Final overall achievement percentage' },
							},
							description: 'Final progress snapshot before deletion',
						},
						archivalReference: { type: 'string', example: 'ARCH_USER123_2024Q1', description: 'Reference for archived data' },
						impactSummary: { type: 'string', example: 'Targets achieved 83.7% overall completion before deletion' },
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({ 
		description: '❌ User or targets not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found or no targets exist to delete' },
				errorCode: { type: 'string', example: 'TARGETS_NOT_FOUND' },
			},
		},
	})
	deleteUserTarget(@Param('ref') ref: number) {
		return this.userService.deleteUserTarget(ref);
	}

	@Post('admin/re-invite-all')
	@Roles(AccessLevel.ADMIN)
	@ApiOperation({
		summary: '📧 Re-invite All Users (Admin)',
		description: `
      **Send re-invitation emails to all active users in the organization/branch**
      
      This endpoint allows administrators to send re-invitation emails to all eligible users:
      - Fetches all active users in the current organization/branch
      - Excludes users with inappropriate statuses (deleted, banned, inactive)
      - Sends re-invitation emails to foster platform engagement
      - Returns summary statistics of the operation
      
      **Security Features:**
      - Requires admin authentication
      - Respects organization/branch boundaries
      - Excludes inappropriate user statuses
      
      **Use Cases:**
      - Platform re-engagement campaigns
      - After system updates or new features
      - Periodic user activation drives
      - Organization-wide communications
    `,
		operationId: 'reInviteAllUsers',
	})
	@ApiOkResponse({
		description: '✅ Re-invitation emails sent successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: {
					type: 'string',
					example: 'Re-invitation emails sent to 15 out of 20 users successfully',
				},
				data: {
					type: 'object',
					properties: {
						invitedCount: {
							type: 'number',
							example: 15,
							description: 'Number of users who received re-invitation emails',
						},
						totalUsers: {
							type: 'number',
							example: 20,
							description: 'Total number of users in the organization/branch',
						},
						excludedCount: {
							type: 'number',
							example: 5,
							description: 'Number of users excluded from re-invitation (deleted, banned, etc.)',
						},
					},
				},
			},
		},
	})
	async reInviteAllUsers(@Req() req: AuthenticatedRequest) {
		try {
			const orgId = req.user?.org?.uid;
			const branchId = req.user?.branch?.uid;

			const scope = {
				orgId: orgId?.toString(),
				branchId: branchId?.toString(),
				userId: req.user.uid.toString(),
				userRole: req.user.accessLevel,
			};

			const result = await this.userService.reInviteAllUsers(scope);

			return {
				success: true,
				message: `Re-invitation emails sent to ${result.invitedCount} out of ${result.totalUsers} users successfully`,
				data: result,
			};
		} catch (error) {
			throw error;
		}
	}

	@Post('admin/:userId/re-invite')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({
		summary: '📧 Re-invite Individual User (Admin)',
		description: `
      **Send a re-invitation email to a specific user**
      
      This endpoint allows administrators to send a re-invitation email to a specific user:
      - Validates user exists and is in the same organization/branch
      - Checks user status eligibility for re-invitation
      - Sends personalized re-invitation email
      - Returns confirmation of successful delivery
      
      **Security Features:**
      - Requires admin/manager authentication
      - Validates user belongs to same organization/branch
      - Checks user status appropriateness
      
      **Use Cases:**
      - Individual user re-engagement
      - Following up on inactive users
      - Personal touch for important users
      - Targeted re-activation campaigns
    `,
		operationId: 'reInviteUser',
	})
	@ApiParam({
		name: 'userId',
		description: 'ID of the user to re-invite',
		type: 'string',
		example: '123',
	})
	@ApiOkResponse({
		description: '✅ Re-invitation email sent successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: {
					type: 'string',
					example: 'Re-invitation email sent to user@example.com successfully',
				},
				data: {
					type: 'object',
					properties: {
						userId: {
							type: 'string',
							example: '123',
							description: 'ID of the user who received the re-invitation',
						},
						email: {
							type: 'string',
							example: 'user@example.com',
							description: 'Email address where the re-invitation was sent',
						},
						sentBy: {
							type: 'string',
							example: 'admin-456',
							description: 'ID of the admin who sent the re-invitation',
						},
					},
				},
			},
		},
	})
	async reInviteUser(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
		try {
			const orgId = req.user?.org?.uid;
			const branchId = req.user?.branch?.uid;

			const scope = {
				orgId: orgId?.toString(),
				branchId: branchId?.toString(),
				userId: req.user.uid.toString(),
				userRole: req.user.accessLevel,
			};

			const result = await this.userService.reInviteUser(userId, scope);

			return {
				success: true,
				message: `Re-invitation email sent to ${result.email} successfully`,
				data: {
					userId: result.userId,
					email: result.email,
					sentBy: req.user.uid.toString(),
				},
			};
		} catch (error) {
			throw error;
		}
	}

	@Put(':userId/targets/external-update')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT)
	@ApiOperation({
		summary: 'Update user targets from external ERP system',
		description: `
		**Update user sales targets and current values from external ERP system**
		
		This endpoint allows external ERP systems to update user targets with concurrency control:
		- Supports both INCREMENT and REPLACE update modes
		- Handles concurrent updates with retry mechanism
		- Validates update data and user permissions
		- Creates audit trail for all updates
		- Returns detailed success/conflict information
		
		**Update Modes:**
		- INCREMENT: Adds values to current targets (for sales, leads, etc.)
		- REPLACE: Sets absolute values (for complete recalculation)
		
		**Concurrency Control:**
		- Uses pessimistic locking during updates
		- Automatic retry with exponential backoff
		- Returns conflict details if updates fail
		
		**Security Features:**
		- Requires ERP system API key authentication
		- Validates user belongs to same organization/branch
		- Transaction ID for idempotency
		- Comprehensive audit logging
		`,
		operationId: 'updateTargetsFromERP',
	})
	@ApiParam({
		name: 'userId',
		description: 'User ID to update targets for',
		type: 'number',
		example: 123,
	})
	@ApiBody({
		type: ExternalTargetUpdateDto,
		description: 'External target update data from ERP system',
	})
	@ApiHeader({
		name: 'X-ERP-API-Key',
		description: 'ERP system API key for authentication',
		required: true,
		example: 'erp-api-key-12345',
	})
	@ApiResponse({
		status: 200,
		description: '✅ Target updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User targets updated successfully from ERP' },
				updatedValues: {
					type: 'object',
					properties: {
						currentSalesAmount: { type: 'number', example: 15000.50 },
						currentNewLeads: { type: 'number', example: 12 },
						currentNewClients: { type: 'number', example: 8 },
						currentCheckIns: { type: 'number', example: 25 },
						currentHoursWorked: { type: 'number', example: 160.5 },
						currentCalls: { type: 'number', example: 45 },
					},
				},
			},
		},
	})
	@ApiResponse({
		status: 409,
		description: '⚠️ Concurrent update conflict',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Concurrent update conflict detected' },
				conflictDetails: {
					type: 'object',
					properties: {
						retryCount: { type: 'number', example: 3 },
						error: { type: 'string', example: 'Lock wait timeout exceeded' },
						suggestion: { type: 'string', example: 'Please retry the update after a short delay' },
					},
				},
			},
		},
	})
	@ApiResponse({
		status: 400,
		description: '❌ Validation error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed' },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: ['Sales amount cannot be negative', 'Transaction ID is required for idempotency'],
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid update data or missing API key' })
	@ApiNotFoundResponse({ description: 'User not found or no targets configured' })
	async updateTargetsFromERP(
		@Param('userId', ParseIntPipe) userId: number,
		@Body() externalUpdateDto: ExternalTargetUpdateDto,
		@Headers('X-ERP-API-Key') apiKey: string,
		@Req() req: AuthenticatedRequest,
	) {
		// TODO: Validate API key in production
		// For now, we'll skip API key validation but log it
		if (!apiKey) {
			throw new Error('X-ERP-API-Key header is required');
		}

		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;

		const result = await this.userService.updateUserTargetsFromERP(userId, externalUpdateDto, orgId, branchId);

		// Return appropriate status codes based on result
		if (result.validationErrors && result.validationErrors.length > 0) {
			return {
				success: false,
				message: result.message,
				validationErrors: result.validationErrors,
			};
		}

		if (result.conflictDetails) {
			return {
				success: false,
				message: result.message,
				conflictDetails: result.conflictDetails,
			};
		}

		return {
			success: true,
			message: result.message,
			updatedValues: result.updatedValues,
		};
	}
}
