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
	Request,
	DefaultValuePipe,
	ParseIntPipe,
	BadRequestException,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiTags,
	ApiQuery,
	ApiParam,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiBody,
} from '@nestjs/swagger';
import { CompetitorsService } from './competitors.service';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';
import { FilterCompetitorDto } from './dto/filter-competitor.dto';
import { Competitor } from './entities/competitor.entity';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { PaginatedResponse } from '../lib/interfaces/paginated-response.interface';
import { CompetitorStatus } from '../lib/enums/competitor.enums';

@ApiTags('⚡ Competitors')
@ApiBearerAuth()
@UseGuards(AuthGuard, RoleGuard)
@Controller('competitors')
// @EnterpriseOnly('competitors')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class CompetitorsController {
	constructor(private readonly competitorsService: CompetitorsService) {}

	// Helper method to safely extract and validate numeric values
	private safeNumericExtraction(value: any): number | undefined {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}

		const numValue = Number(value);
		
		if (isNaN(numValue) || !isFinite(numValue)) {
			return undefined;
		}

		return numValue;
	}

	// Helper method to safely extract org and branch IDs from JWT
	private extractOrgAndBranchIds(req: any): { orgId?: number; branchId?: number } {
		const orgIdRaw = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchIdRaw = req.user?.branch?.uid || req.branch?.uid;

		return {
			orgId: this.safeNumericExtraction(orgIdRaw),
			branchId: this.safeNumericExtraction(branchIdRaw),
		};
	}

	@Post()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Create a new competitor' })
	@ApiCreatedResponse({
		description: 'The competitor has been successfully created.',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
				competitor: { type: 'object' },
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Bad request.' })
	create(@Body() createCompetitorDto: CreateCompetitorDto, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.create(createCompetitorDto, req.user, orgId, branchId);
	}

	@Post('batch')
	// @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: 'Create multiple competitors in batch',
		description: 'Creates multiple competitors in a single transaction. All competitors will be created or none if any validation fails.'
	})
	@ApiBody({
		description: 'Array of competitor data to create',
		type: [CreateCompetitorDto],
		examples: {
			example1: {
				summary: 'Batch create example',
				description: 'Example of creating multiple competitors at once',
				value: [
					{
						name: "Competitor 1",
						description: "First competitor description",
						website: "https://competitor1.com",
						contactEmail: "contact@competitor1.com",
						address: {
							street: "123 Main St",
							suburb: "Downtown",
							city: "Cape Town",
							state: "Western Cape",
							country: "South Africa",
							postalCode: "8001",
							latitude: -33.9249,
							longitude: 18.4241
						},
						industry: "Hardware & Building Supplies",
						threatLevel: 3
					},
					{
						name: "Competitor 2", 
						description: "Second competitor description",
						website: "https://competitor2.com",
						contactEmail: "contact@competitor2.com",
						address: {
							street: "456 Oak Ave",
							suburb: "Midtown",
							city: "Johannesburg",
							state: "Gauteng",
							country: "South Africa",
							postalCode: "2001",
							latitude: -26.2041,
							longitude: 28.0473
						},
						industry: "Hardware & Building Supplies",
						threatLevel: 4
					}
				]
			}
		}
	})
	@ApiCreatedResponse({
		description: 'Batch competitor creation completed.',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Batch competitor creation completed' },
				totalProcessed: { type: 'number', example: 100 },
				successful: { type: 'number', example: 95 },
				failed: { type: 'number', example: 5 },
				results: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							index: { type: 'number', example: 0 },
							success: { type: 'boolean', example: true },
							competitor: { 
								type: 'object',
								description: 'Created competitor object (if successful)'
							},
							error: { 
								type: 'string', 
								example: 'Validation failed for name field',
								description: 'Error message (if failed)'
							}
						}
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: 'Bad request - Invalid input data or validation errors.',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed' },
				errors: { 
					type: 'array',
					items: { type: 'string' },
					example: ['name should not be empty', 'address is required']
				}
			}
		}
	})
	createBatch(@Body() createCompetitorDtos: CreateCompetitorDto[], @Request() req) {
		if (!Array.isArray(createCompetitorDtos)) {
			throw new BadRequestException('Request body must be an array of competitor objects');
		}

		if (createCompetitorDtos.length === 0) {
			throw new BadRequestException('Array cannot be empty');
		}

		if (createCompetitorDtos.length > 1000) {
			throw new BadRequestException('Batch size cannot exceed 1000 competitors');
		}

		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.createBatch(createCompetitorDtos, req.user, orgId, branchId);
	}

	@Get()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get all competitors',
		description: 'Retrieves a paginated list of all competitors with optional filtering',
	})
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to system setting',
	})
	@ApiQuery({ name: 'status', enum: CompetitorStatus, required: false, description: 'Filter by competitor status' })
	@ApiQuery({ name: 'isDirect', type: Boolean, required: false, description: 'Filter by direct competitor status' })
	@ApiQuery({ name: 'industry', type: String, required: false, description: 'Filter by industry' })
	@ApiQuery({ name: 'name', type: String, required: false, description: 'Filter by name (partial match)' })
	@ApiQuery({
		name: 'minThreatLevel',
		type: Number,
		required: false,
		description: 'Filter by minimum threat level (1-5)',
	})
	@ApiOkResponse({
		description: 'List of competitors retrieved successfully',
		type: Object,
	})
	findAll(
		@Query() filterDto: FilterCompetitorDto,
		@Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
		@Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
		@Request() req?: any,
	): Promise<PaginatedResponse<Competitor>> {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.findAll(filterDto, page, limit, orgId, branchId);
	}

	@Get('analytics')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Get competitor analytics' })
	@ApiOkResponse({
		description: 'Return competitor analytics',
		schema: {
			type: 'object',
			properties: {
				totalCompetitors: { type: 'number' },
				directCompetitors: { type: 'number' },
				indirectCompetitors: { type: 'number' },
				averageThreatLevel: { type: 'number' },
				topThreats: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							threatLevel: { type: 'number' },
							industry: { type: 'string' },
						},
					},
				},
				byIndustry: {
					type: 'object',
					additionalProperties: { type: 'number' },
				},
			},
		},
	})
	getCompetitorAnalytics(@Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.getCompetitorAnalytics(orgId, branchId);
	}

	@Get('by-industry')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Get competitors grouped by industry' })
	@ApiOkResponse({
		description: 'Return competitors grouped by industry',
		schema: {
			type: 'object',
			additionalProperties: { type: 'number' },
		},
	})
	getCompetitorsByIndustry(@Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.getCompetitorsByIndustry(orgId, branchId);
	}

	@Get('by-threat')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Get competitors by threat level' })
	@ApiQuery({ name: 'minThreatLevel', required: false, type: Number, description: 'Minimum threat level (1-5)' })
	@ApiOkResponse({
		description: 'Return competitors ordered by threat level',
		type: [Competitor],
	})
	findByThreatLevel(
		@Query('minThreatLevel', new DefaultValuePipe(0), ParseIntPipe) minThreatLevel = 0,
		@Request() req,
	) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.findByThreatLevel(minThreatLevel, orgId, branchId);
	}

	@Get('by-name')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Find competitors by name' })
	@ApiQuery({ name: 'name', required: true, type: String, description: 'Competitor name (partial match)' })
	@ApiOkResponse({
		description: 'Return competitors matching name',
		type: [Competitor],
	})
	findByName(@Query('name') name: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.findByName(name, orgId, branchId);
	}

	@Get(':id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get competitor by id' })
	@ApiParam({ name: 'id', description: 'Competitor ID' })
	@ApiOkResponse({
		description: 'Return the competitor',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
				competitor: { type: 'object', nullable: true },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'Competitor not found.' })
	findOne(@Param('id') id: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		// Convert string to number - let service handle validation
		const competitorId = Number(id);
		return this.competitorsService.findOne(competitorId, orgId, branchId);
	}

	@Get('ref/:ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get competitor by reference code' })
	@ApiParam({ name: 'ref', description: 'Competitor reference code' })
	@ApiOkResponse({
		description: 'Return the competitor',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
				competitor: { type: 'object', nullable: true },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'Competitor not found.' })
	findOneByRef(@Param('ref') ref: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.findOneByRef(ref, orgId, branchId);
	}

	@Patch(':id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Update competitor' })
	@ApiParam({ name: 'id', description: 'Competitor ID' })
	@ApiOkResponse({
		description: 'The competitor has been successfully updated.',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
				competitor: { type: 'object' },
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Bad request.' })
	@ApiNotFoundResponse({ description: 'Competitor not found.' })
	update(@Param('id') id: string, @Body() updateCompetitorDto: UpdateCompetitorDto, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		// Convert string to number - let service handle validation
		const competitorId = Number(id);
		return this.competitorsService.update(competitorId, updateCompetitorDto, orgId, branchId);
	}

	@Delete(':id')
	@Roles(AccessLevel.ADMIN)
	@ApiOperation({ summary: 'Delete competitor (soft delete)' })
	@ApiParam({ name: 'id', description: 'Competitor ID' })
	@ApiOkResponse({
		description: 'The competitor has been successfully soft-deleted.',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'Competitor not found.' })
	remove(@Param('id') id: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		// Convert string to number - let service handle validation
		const competitorId = Number(id);
		return this.competitorsService.remove(competitorId, orgId, branchId);
	}

	@Delete('hard/:id')
	@Roles(AccessLevel.ADMIN)
	@ApiOperation({ summary: 'Permanently delete competitor' })
	@ApiParam({ name: 'id', description: 'Competitor ID' })
	@ApiOkResponse({
		description: 'The competitor has been permanently deleted.',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'Competitor not found.' })
	hardRemove(@Param('id') id: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		// Convert string to number - let service handle validation
		const competitorId = Number(id);
		return this.competitorsService.hardRemove(competitorId, orgId, branchId);
	}

	@Get('map-data')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ summary: 'Get competitor data formatted for map display' })
	@ApiOkResponse({
		description: 'Return competitors with position data for map display',
		type: [Object],
	})
	getCompetitorsForMap(@Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);

		const filters = { isDeleted: false };
		return this.competitorsService.findAll(filters, 1, 1000, orgId, branchId)
			.then(({ data }) => {
				// Transform data into map-friendly format with mock positions
				return data.map(competitor => {
					// Create position (mock for now - would use geocoding in production)
					const position = this.createMockPosition();
					
					return {
						id: competitor.uid,
						name: competitor.name,
						position,
						markerType: 'competitor',
						threatLevel: competitor.threatLevel || 0,
						isDirect: competitor.isDirect || false,
						industry: competitor.industry || 'Unknown',
						status: competitor.status,
						website: competitor.website,
						logoUrl: competitor.logoUrl,
						competitorRef: competitor.competitorRef,
						address: competitor.address
					};
				});
			});
	}

	// Helper method to create mock positions
	private createMockPosition(): [number, number] {
		// Generate a position around Johannesburg
		const defaultLat = -26.1278;
		const defaultLng = 28.0582;
		
		// Generate a slight random offset (±0.05 degrees, roughly ±5km)
		const latOffset = (Math.random() - 0.5) * 0.1;
		const lngOffset = (Math.random() - 0.5) * 0.1;
		
		return [defaultLat + latOffset, defaultLng + lngOffset];
	}
}
