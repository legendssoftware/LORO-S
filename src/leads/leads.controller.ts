import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Headers, Req, UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import {
	ApiTags,
	ApiOperation,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiQuery,
	ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { LeadStatus, LeadTemperature, LeadPriority, LeadSource } from '../lib/enums/lead.enums';
import { PaginatedResponse } from '../lib/interfaces/paginated-response';
import { Lead } from './entities/lead.entity';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { RepetitionType } from '../lib/enums/task.enums';
import { CsvFileValidator } from './validators/csv-file.validator';

@ApiTags('🎯 Leads')
@Controller('leads')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('leads')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class LeadsController {
	constructor(private readonly leadsService: LeadsService) {}

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
		summary: 'Create a new lead',
		description: 'Creates a new lead with the provided details',
	})
	@ApiBody({ type: CreateLeadDto })
	@ApiCreatedResponse({
		description: 'Lead created successfully',
		schema: {
			type: 'object',
			properties: {
				lead: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						name: { type: 'string' },
						email: { type: 'string' },
						phone: { type: 'string' },
						companyName: { type: 'string' },
						status: { type: 'string', enum: Object.values(LeadStatus) },
						source: { type: 'string' },
						notes: { type: 'string' },
						leadScore: { type: 'number', description: 'Calculated lead score (0-100)' },
						temperature: { type: 'string', description: 'Lead temperature (HOT, WARM, COLD, FROZEN)' },
						priority: { type: 'string', description: 'Lead priority level' },
						estimatedValue: { type: 'number', description: 'Estimated value in currency' },
						nextFollowUpDate: { type: 'string', format: 'date-time', description: 'Next scheduled follow-up date' },
						attachments: { type: 'array', items: { type: 'string' }, description: 'Array of attachment URLs' },
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error creating lead' },
			},
		},
	})
	create(@Body() createLeadDto: CreateLeadDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.leadsService.create(createLeadDto, Number(orgId), branchId);
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
		summary: 'Get all leads',
		description:
			'Retrieves a paginated list of leads with optional filtering by status, search term, and date range',
	})
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to 25',
	})
	@ApiQuery({ name: 'status', enum: LeadStatus, required: false, description: 'Filter by lead status' })
	@ApiQuery({
		name: 'search',
		type: String,
		required: false,
		description: 'Search term to filter leads by name, email, or company',
	})
	@ApiQuery({ name: 'startDate', type: Date, required: false, description: 'Filter by start date (ISO format)' })
	@ApiQuery({ name: 'endDate', type: Date, required: false, description: 'Filter by end date (ISO format)' })
	@ApiQuery({ name: 'temperature', type: String, required: false, description: 'Filter by lead temperature (HOT, WARM, COLD, FROZEN)' })
	@ApiQuery({ name: 'minScore', type: Number, required: false, description: 'Filter by minimum lead score (0-100)' })
	@ApiQuery({ name: 'maxScore', type: Number, required: false, description: 'Filter by maximum lead score (0-100)' })
	@ApiQuery({ name: 'priority', type: String, required: false, description: 'Filter by lead priority level' })
	@ApiQuery({ name: 'source', type: String, required: false, description: 'Filter by lead source' })
	@ApiOkResponse({
		description: 'Leads retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							email: { type: 'string' },
							phone: { type: 'string' },
							companyName: { type: 'string' },
							status: { type: 'string', enum: Object.values(LeadStatus) },
							source: { type: 'string' },
							notes: { type: 'string' },
							leadScore: { type: 'number', description: 'Calculated lead score (0-100)' },
							temperature: { type: 'string', description: 'Lead temperature (HOT, WARM, COLD, FROZEN)' },
							priority: { type: 'string', description: 'Lead priority level' },
							estimatedValue: { type: 'number', description: 'Estimated value in currency' },
							nextFollowUpDate: { type: 'string', format: 'date-time', description: 'Next scheduled follow-up date' },
							lastContactDate: { type: 'string', format: 'date-time', description: 'Last contact date' },
							totalInteractions: { type: 'number', description: 'Total number of interactions' },
							averageResponseTime: { type: 'number', description: 'Average response time in hours' },
							attachments: { type: 'array', items: { type: 'string' }, description: 'Array of attachment URLs' },
							createdAt: { type: 'string', format: 'date-time' },
							updatedAt: { type: 'string', format: 'date-time' },
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 100 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 25 },
						totalPages: { type: 'number', example: 4 },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	async findAll(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: LeadStatus,
		@Query('search') search?: string,
		@Query('startDate') startDate?: Date,
		@Query('endDate') endDate?: Date,
		@Query('temperature') temperature?: LeadTemperature,
		@Query('minScore') minScore?: number,
		@Query('maxScore') maxScore?: number,
		@Query('priority') priority?: LeadPriority,
		@Query('source') source?: LeadSource,
	): Promise<PaginatedResponse<Lead>> {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const userId = req.user?.uid;
		const userAccessLevel = req.user?.role;

		const filters = {
			...(status && { status }),
			...(search && { search }),
			...(startDate &&
				endDate && {
					startDate: new Date(startDate),
					endDate: new Date(endDate),
				}),
			...(temperature && { temperature }),
			...(minScore && { minScore }),
			...(maxScore && { maxScore }),
			...(priority && { priority }),
			...(source && { source }),
		};

		return this.leadsService.findAll(
			filters,
			page ? Number(page) : 1,
			limit ? Number(limit) : 25,
			Number(orgId),
			branchId,
			userId,
			userAccessLevel,
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
		summary: 'Get a lead by reference code',
		description: 'Retrieves detailed information about a specific lead',
	})
	@ApiParam({ name: 'ref', description: 'Lead reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Lead retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				lead: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						name: { type: 'string' },
						email: { type: 'string' },
						phone: { type: 'string' },
						companyName: { type: 'string' },
						status: { type: 'string', enum: Object.values(LeadStatus) },
						source: { type: 'string' },
						notes: { type: 'string' },
						leadScore: { type: 'number', description: 'Calculated lead score (0-100)' },
						temperature: { type: 'string', description: 'Lead temperature (HOT, WARM, COLD, FROZEN)' },
						priority: { type: 'string', description: 'Lead priority level' },
						estimatedValue: { type: 'number', description: 'Estimated value in currency' },
						nextFollowUpDate: { type: 'string', format: 'date-time', description: 'Next scheduled follow-up date' },
						lastContactDate: { type: 'string', format: 'date-time', description: 'Last contact date' },
						totalInteractions: { type: 'number', description: 'Total number of interactions' },
						averageResponseTime: { type: 'number', description: 'Average response time in hours' },
						attachments: { type: 'array', items: { type: 'string' }, description: 'Array of attachment URLs' },
						scoringData: {
							type: 'object',
							description: 'Detailed lead scoring breakdown',
							properties: {
								totalScore: { type: 'number' },
								engagementScore: { type: 'number' },
								demographicScore: { type: 'number' },
								behavioralScore: { type: 'number' },
								fitScore: { type: 'number' },
								lastCalculated: { type: 'string', format: 'date-time' },
							},
						},
						activityData: {
							type: 'object',
							description: 'Lead activity tracking data',
							properties: {
								lastContactDate: { type: 'string', format: 'date-time' },
								nextFollowUpDate: { type: 'string', format: 'date-time' },
								totalInteractions: { type: 'number' },
								engagementLevel: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
								unresponsiveStreak: { type: 'number', description: 'Days without response' },
							},
						},
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
						assignedTo: {
							type: 'object',
							properties: {
								uid: { type: 'number' },
								name: { type: 'string' },
								email: { type: 'string' },
							},
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Lead not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Lead not found' },
				lead: { type: 'null' },
			},
		},
	})
	findOne(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const userId = req.user?.uid;
		const userAccessLevel = req.user?.role;
		return this.leadsService.findOne(ref, Number(orgId), branchId, userId, userAccessLevel);
	}

	@Get('for/:ref')
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
		summary: 'Get leads by user reference code',
		description: 'Retrieves all leads assigned to a specific user',
	})
	@ApiParam({ name: 'ref', description: 'User reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'User leads retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				leads: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							status: { type: 'string', enum: Object.values(LeadStatus) },
							createdAt: { type: 'string', format: 'date-time' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'User not found or has no leads',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No leads found for this user' },
				leads: { type: 'array', items: {}, example: [] },
			},
		},
	})
	leadsByUser(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const requestingUserId = req.user?.uid;
		const userAccessLevel = req.user?.role;
		return this.leadsService.leadsByUser(ref, Number(orgId), branchId, requestingUserId, userAccessLevel);
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
		summary: 'Update a lead',
		description: 'Updates a lead with the provided details',
	})
	@ApiParam({ name: 'ref', description: 'Lead reference code or ID', type: 'number' })
	@ApiBody({ type: UpdateLeadDto })
	@ApiOkResponse({
		description: 'Lead updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Lead not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Lead not found' },
			},
		},
	})
	update(@Param('ref') ref: number, @Body() updateLeadDto: UpdateLeadDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const userId = req.user?.uid;
		return this.leadsService.update(ref, updateLeadDto, Number(orgId), branchId, userId);
	}

	@Patch(':ref/restore')
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
		summary: 'Restore a deleted lead',
		description: 'Restores a previously soft-deleted lead',
	})
	@ApiParam({ name: 'ref', description: 'Lead reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Lead restored successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Lead not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Lead not found' },
			},
		},
	})
	restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.leadsService.restore(ref, Number(orgId), branchId);
	}

	@Patch(':ref/reactivate')
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
		summary: 'Reactivate a lead',
		description: 'Reactivates a declined or cancelled lead by setting its status back to pending',
	})
	@ApiParam({ name: 'ref', description: 'Lead reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Lead reactivated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Lead not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Lead not found' },
			},
		},
	})
	reactivate(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const userId = req.user?.uid;
		return this.leadsService.reactivate(ref, Number(orgId), branchId, userId);
	}

	@Post('import-csv')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@UseInterceptors(FileInterceptor('file'))
	@ApiConsumes('multipart/form-data')
	@ApiOperation({
		summary: 'Import leads from CSV file',
		description: 'Uploads a CSV file and imports leads, assigning them evenly to sales reps with recurring follow-up tasks',
	})
	@ApiQuery({
		name: 'followUpInterval',
		enum: RepetitionType,
		required: false,
		description: 'Follow-up interval for recurring tasks (DAILY, WEEKLY, MONTHLY)',
		example: RepetitionType.WEEKLY,
	})
	@ApiQuery({
		name: 'followUpDuration',
		type: Number,
		required: false,
		description: 'Duration in days for recurring follow-ups',
		example: 90,
	})
	@ApiQuery({
		name: 'assignedUserIds',
		type: String,
		required: false,
		description: 'Comma-separated list of user IDs to assign leads to. If not provided, leads will be assigned to all active sales reps.',
		example: '12,13,15',
	})
	@ApiOkResponse({
		description: 'Leads imported successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean' },
				imported: { type: 'number' },
				failed: { type: 'number' },
				errors: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							row: { type: 'number' },
							error: { type: 'string' },
						},
					},
				},
				assignments: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							leadId: { type: 'number' },
							userId: { type: 'number' },
							userName: { type: 'string' },
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid file or missing required fields',
	})
	async importLeadsFromCSV(
		@UploadedFile(
			new ParseFilePipe({
				validators: [
					new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
					new CsvFileValidator({}),
				],
				errorHttpStatusCode: 400,
			}),
		)
		file: Express.Multer.File,
		@Req() req: AuthenticatedRequest,
		@Query('followUpInterval') followUpInterval: RepetitionType = RepetitionType.WEEKLY,
		@Query('followUpDuration') followUpDuration: number = 90,
		@Query('assignedUserIds') assignedUserIds?: string,
	) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		
		// Parse assigned user IDs from comma-separated string
		const userIds = assignedUserIds
			? assignedUserIds.split(',').map((id) => Number(id.trim())).filter((id) => !isNaN(id))
			: undefined;

		return this.leadsService.importLeadsFromCSV(
			file,
			Number(orgId),
			branchId,
			followUpInterval,
			Number(followUpDuration),
			userIds,
		);
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
		summary: 'Delete a lead',
		description: 'Soft-deletes a lead by marking it as deleted',
	})
	@ApiParam({ name: 'ref', description: 'Lead reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Lead deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Lead not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Lead not found' },
			},
		},
	})
	remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.leadsService.remove(ref, Number(orgId), branchId);
	}
}
