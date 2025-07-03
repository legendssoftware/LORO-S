import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Req } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
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
} from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { Client } from './entities/client.entity';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { GeneralStatus } from '../lib/enums/status.enums';

@ApiTags('👥 Clients')
@Controller('clients')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('clients')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
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
		summary: 'Create a new client',
		description: 'Creates a new client with the provided details including contact information and address',
	})
	@ApiBody({ type: CreateClientDto })
	@ApiCreatedResponse({
		description: 'Client created successfully',
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
				message: { type: 'string', example: 'Error creating client' },
			},
		},
	})
	create(@Body() createClientDto: CreateClientDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.create(createClientDto, orgId, branchId);
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
		summary: 'Get all clients',
		description: 'Retrieves a paginated list of all clients with optional filtering',
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
		description: 'List of clients retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: { type: 'object' },
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 100 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 10 },
						totalPages: { type: 'number', example: 10 },
					},
				},
				message: { type: 'string', example: 'Success' },
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
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		const filters = { status, category, search };

		return this.clientsService.findAll(
			page ? Number(page) : 1,
			limit ? Number(limit) : Number(process.env.DEFAULT_PAGE_LIMIT),
			orgId,
			branchId,
			filters,
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
		summary: 'Get a client by reference code',
		description: 'Retrieves detailed information about a specific client',
	})
	@ApiParam({ name: 'ref', description: 'Client reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Client details retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				client: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						name: { type: 'string' },
						email: { type: 'string' },
						phone: { type: 'string' },
						// Other client properties
					},
				},
				message: { type: 'string', example: 'Success' },
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
		const orgId = req.user?.org?.uid;
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
		summary: 'Update a client',
		description: 'Updates an existing client with the provided information. Can be used to convert leads to clients by setting status to "converted".',
	})
	@ApiParam({ name: 'ref', description: 'Client reference code or ID', type: 'number' })
	@ApiBody({ type: UpdateClientDto })
	@ApiOkResponse({
		description: 'Client updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Client not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client not found' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error updating client' },
			},
		},
	})
	update(@Param('ref') ref: number, @Body() updateClientDto: UpdateClientDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
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
		summary: 'Restore a deleted client',
		description: 'Restores a previously deleted client',
	})
	@ApiParam({ name: 'ref', description: 'Client reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Client restored successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Client not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client not found' },
			},
		},
	})
	restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
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
		summary: 'Soft delete a client',
		description: 'Marks a client as deleted without removing it from the database',
	})
	@ApiParam({ name: 'ref', description: 'Client reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Client deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Client not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error deleting client' },
			},
		},
	})
	remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.remove(ref, orgId, branchId);
	}

	@Get('nearby')
	@ApiOperation({
		summary: 'Find nearby clients',
		description: 'Finds clients near the provided GPS coordinates within the specified radius',
	})
	@ApiOkResponse({
		description: 'List of nearby clients',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				clients: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							distance: { type: 'number', description: 'Distance in kilometers' },
							gpsCoordinates: { type: 'string' },
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid coordinates',
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
		summary: 'Get client check-in history',
		description: 'Retrieves check-in history with location data for a specific client',
	})
	@ApiParam({ name: 'clientId', description: 'Client ID', type: 'number' })
	@ApiOkResponse({
		description: 'Client check-in history retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkIns: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							checkInTime: { type: 'string', format: 'date-time' },
							checkInLocation: { type: 'string' },
							checkOutTime: { type: 'string', format: 'date-time', nullable: true },
							checkOutLocation: { type: 'string', nullable: true },
							duration: { type: 'string', nullable: true },
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Client not found',
	})
	getClientCheckIns(
		@Param('clientId') clientId: number,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.clientsService.getClientCheckIns(clientId, orgId, branchId);
	}

	@Post('test-task-generation')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Test communication task generation',
		description: 'Manually trigger the communication task generation cron job for testing purposes. Admin/Manager access only.',
	})
	@ApiCreatedResponse({
		description: 'Task generation completed successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Communication task generation completed successfully' },
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
}
