import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	Query,
	UseGuards,
	Req,
	UseInterceptors,
	BadRequestException,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { UpdateInteractionDto } from './dto/update-interaction.dto';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { AuthenticatedRequest, getClerkOrgId } from '../lib/interfaces/authenticated-request.interface';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, getFutureDate, getPastDate, createApiDescription } from '../lib/utils/swagger-helpers';

@ApiBearerAuth('JWT-auth')
@ApiTags('💭 Interactions')
@Controller('interactions')
@UseGuards(ClerkAuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class InteractionsController {
	constructor(private readonly interactionsService: InteractionsService) {}

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
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Create a new interaction',
		description: createApiDescription(
			'Creates a new interaction with comprehensive tracking and relationship management.',
			'The service method `InteractionsService.create()` processes interaction creation, validates relationships with leads/clients/quotations, assigns organization and branch context, handles caching, and returns the created interaction with success message.',
			'InteractionsService',
			'create',
			'creates a new interaction, validates relationships, and assigns organizational context',
			'an object containing the created interaction data and success message',
			['Lead/client/quotation relationship validation', 'Organization and branch assignment', 'Cache management', 'User assignment'],
		),
	})
	@ApiBody({ type: CreateInteractionDto })
	@ApiCreatedResponse({
		description: 'Interaction created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						message: { type: 'string' },
						type: { type: 'string' },
						// Other interaction properties
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error creating interaction' },
			},
		},
	})
	create(@Body() createInteractionDto: CreateInteractionDto, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		const user = req.user?.uid;

		return this.interactionsService.create(createInteractionDto, orgId, branchId, user);
	}

	@Get()
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get all interactions',
		description: createApiDescription(
			'Retrieves a paginated list of all interactions with advanced filtering capabilities.',
			'The service method `InteractionsService.findAll()` processes the query with filters, applies organization and branch scoping, handles pagination, performs database queries with relationships, manages caching, and returns paginated interaction results.',
			'InteractionsService',
			'findAll',
			'retrieves interactions with filtering, pagination, and organization scoping',
			'a paginated response containing interactions array, metadata, and total count',
			['Search filtering', 'Date range filtering', 'Lead/client filtering', 'Pagination', 'Cache management'],
		),
	})
	@ApiOkResponse({
		description: 'Interactions retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							// Other interaction properties
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number' },
						page: { type: 'number' },
						limit: { type: 'number' },
						totalPages: { type: 'number' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	findAll(
		@Req() req: AuthenticatedRequest,
		@Query('page') page: number = 1,
		@Query('limit') limit: number = 25,
		@Query('search') search?: string,
		@Query('startDate') startDate?: Date,
		@Query('endDate') endDate?: Date,
		@Query('leadUid') leadUid?: number,
		@Query('clientUid') clientUid?: number,
	) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);

		return this.interactionsService.findAll(
			{
				search,
				startDate,
				endDate,
				leadUid,
				clientUid,
			},
			page,
			limit,
			orgId,
			branchId,
		);
	}

	@Get('lead/:ref')
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get interactions by lead',
		description: createApiDescription(
			'Retrieves all interactions associated with a specific lead reference.',
			'The service method `InteractionsService.findByLead()` validates the lead reference, applies organization and branch filters, queries interactions linked to the lead, handles caching, and returns the filtered interaction list.',
			'InteractionsService',
			'findByLead',
			'retrieves interactions filtered by lead reference with organization scoping',
			'an array of interactions associated with the specified lead',
			['Lead validation', 'Organization scoping', 'Cache management'],
		),
	})
	@ApiParam({ name: 'ref', description: 'Lead reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Lead interactions retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							// Other interaction properties
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number' },
						page: { type: 'number' },
						limit: { type: 'number' },
						totalPages: { type: 'number' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	findByLead(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.interactionsService.findByLead(+ref, orgId, branchId);
	}

	@Get('client/:ref')
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get interactions by client',
		description: createApiDescription(
			'Retrieves all interactions associated with a specific client reference.',
			'The service method `InteractionsService.findByClient()` validates the client reference, applies organization and branch filters, queries interactions linked to the client, handles caching, and returns the filtered interaction list.',
			'InteractionsService',
			'findByClient',
			'retrieves interactions filtered by client reference with organization scoping',
			'an array of interactions associated with the specified client',
			['Client validation', 'Organization scoping', 'Cache management'],
		),
	})
	@ApiParam({ name: 'ref', description: 'Client reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Client interactions retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							// Other interaction properties
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number' },
						page: { type: 'number' },
						limit: { type: 'number' },
						totalPages: { type: 'number' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	findByClient(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.interactionsService.findByClient(+ref, orgId, branchId);
	}

	@Get('quotation/:ref')
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get interactions by quotation',
		description: createApiDescription(
			'Retrieves all interactions associated with a specific quotation reference.',
			'The service method `InteractionsService.findByQuotation()` validates the quotation reference, applies organization and branch filters, queries interactions linked to the quotation, handles caching, and returns the filtered interaction list.',
			'InteractionsService',
			'findByQuotation',
			'retrieves interactions filtered by quotation reference with organization scoping',
			'an array of interactions associated with the specified quotation',
			['Quotation validation', 'Organization scoping', 'Cache management'],
		),
	})
	@ApiParam({ name: 'ref', description: 'Quotation reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Quotation interactions retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							// Other interaction properties
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number' },
						page: { type: 'number' },
						limit: { type: 'number' },
						totalPages: { type: 'number' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	findByQuotation(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.interactionsService.findByQuotation(+ref, orgId, branchId);
	}

	@Get(':ref')
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get an interaction by reference code',
		description: createApiDescription(
			'Retrieves detailed information about a specific interaction by its reference code.',
			'The service method `InteractionsService.findOne()` validates the interaction reference, applies organization and branch filters, loads related entities (lead, client, quotation, user), handles caching, and returns the complete interaction details.',
			'InteractionsService',
			'findOne',
			'retrieves a single interaction by reference with full relationship data',
			'an object containing the interaction details with related entities',
			['Reference validation', 'Organization scoping', 'Relationship loading', 'Cache management'],
		),
	})
	@ApiParam({ name: 'ref', description: 'Interaction reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Interaction details retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				interaction: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						// Other interaction properties
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Interaction not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Interaction not found' },
				interaction: { type: 'null' },
			},
		},
	})
	findOne(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.interactionsService.findOne(+ref, orgId, branchId);
	}

	@Patch(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Update an interaction',
		description: createApiDescription(
			'Updates an existing interaction with the provided details.',
			'The service method `InteractionsService.update()` validates the interaction reference, applies organization and branch filters, updates interaction fields, invalidates cache, and returns success confirmation.',
			'InteractionsService',
			'update',
			'updates an interaction with validation and cache invalidation',
			'a success message confirming the update',
			['Reference validation', 'Organization scoping', 'Field updates', 'Cache invalidation'],
		),
	})
	@ApiParam({ name: 'ref', description: 'Interaction reference code', type: 'number' })
	@ApiBody({ type: UpdateInteractionDto })
	@ApiOkResponse({
		description: 'Interaction updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Interaction not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Interaction not found' },
			},
		},
	})
	update(
		@Param('ref') ref: string,
		@Body() updateInteractionDto: UpdateInteractionDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.interactionsService.update(+ref, updateInteractionDto, orgId, branchId);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR)
	@ApiOperation({
		summary: 'Delete an interaction',
		description: createApiDescription(
			'Marks an interaction as deleted using soft delete (sets isDeleted flag).',
			'The service method `InteractionsService.remove()` validates the interaction reference, applies organization and branch filters, performs soft delete, invalidates cache, and returns success confirmation.',
			'InteractionsService',
			'remove',
			'performs soft delete on an interaction with validation and cache invalidation',
			'a success message confirming the deletion',
			['Reference validation', 'Organization scoping', 'Soft delete', 'Cache invalidation'],
		),
	})
	@ApiParam({ name: 'ref', description: 'Interaction reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Interaction deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Interaction not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Interaction not found' },
			},
		},
	})
	remove(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.interactionsService.remove(+ref, orgId, branchId);
	}
}
