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
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { UpdateInteractionDto } from './dto/update-interaction.dto';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
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

@ApiBearerAuth('JWT-auth')
@ApiTags('💭 Interactions')
@Controller('interactions')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class InteractionsController {
	constructor(private readonly interactionsService: InteractionsService) {}

	@Post()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Create a new interaction',
		description: 'Creates a new interaction with the provided details',
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
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const user = req.user?.uid;

		return this.interactionsService.create(createInteractionDto, orgId, branchId, user);
	}

	@Get()
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get all interactions',
		description: 'Retrieves a list of all interactions with optional filtering',
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
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;

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
		description: 'Retrieves all interactions associated with a specific lead',
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
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.interactionsService.findByLead(+ref, orgId, branchId);
	}

	@Get('client/:ref')
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get interactions by client',
		description: 'Retrieves all interactions associated with a specific client',
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
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.interactionsService.findByClient(+ref, orgId, branchId);
	}

	@Get('quotation/:ref')
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get interactions by quotation',
		description: 'Retrieves all interactions associated with a specific quotation',
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
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.interactionsService.findByQuotation(+ref, orgId, branchId);
	}

	@Get(':ref')
	@UseInterceptors(CacheInterceptor)
	@CacheTTL(30) // Cache for 30 seconds
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get an interaction by reference code',
		description: 'Retrieves detailed information about a specific interaction',
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
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.interactionsService.findOne(+ref, orgId, branchId);
	}

	@Patch(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR, AccessLevel.USER)
	@ApiOperation({
		summary: 'Update an interaction',
		description: 'Updates an existing interaction with the provided details',
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
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.interactionsService.update(+ref, updateInteractionDto, orgId, branchId);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR)
	@ApiOperation({
		summary: 'Delete an interaction',
		description: 'Marks an interaction as deleted (soft delete)',
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
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.interactionsService.remove(+ref, orgId, branchId);
	}
}
