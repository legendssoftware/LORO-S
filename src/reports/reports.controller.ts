import { Controller, Get, UseGuards, Req, BadRequestException, Logger, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiTags,
	ApiOkResponse,
	ApiBadRequestResponse,
	ApiUnauthorizedResponse,
	ApiQuery,
} from '@nestjs/swagger';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';

@ApiBearerAuth('JWT-auth')
@ApiTags('📊 Reports')
@Controller('reports')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class ReportsController {
	private readonly logger = new Logger(ReportsController.name);

	constructor(private readonly reportsService: ReportsService) {}

	// Get Map Data endpoint
	@Get('map')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🗺️ Get map data for visualization',
		description: `
# Map Data Dashboard

Real-time map visualization data including employee locations, client locations, and business metrics.

## 🗺️ **Map Visualization Data**
- **Employee Locations**: Real-time employee locations with check-in status
- **Client Locations**: Active client locations with detailed information
- **Competitor Locations**: Competitor mapping with threat analysis
- **Quotation Locations**: Recent quotations mapped to client locations
- **Recent Events**: Timeline of recent activities (check-ins, tasks, leads, etc.)
- **Territory Mapping**: Sales territory visualization
- **Performance Mapping**: Performance metrics by location

## 📊 **Location Analytics**
- **Geographic Distribution**: Entity distribution by location
- **Density Analysis**: Concentration of activities
- **Route Optimization**: Optimal route planning
- **Territory Performance**: Performance by territory
- **Market Coverage**: Market coverage analysis
- **Travel Patterns**: Employee travel patterns

## 🔧 **Query Parameters**
- **orgId**: Override organization ID (optional, defaults to user's org)
- **branchId**: Filter by specific branch (optional)
- **userId**: User context for authorization (optional)
		`,
	})
	@ApiQuery({
		name: 'orgId',
		required: false,
		type: String,
		description: 'Organization ID to filter data (defaults to user organization)',
	})
	@ApiQuery({
		name: 'branchId',
		required: false,
		type: String,
		description: 'Branch ID to filter data (optional)',
	})
	@ApiQuery({
		name: 'userId',
		required: false,
		type: String,
		description: 'User ID for authorization context (optional)',
	})
	@ApiOkResponse({
		description: 'Map data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						workers: { 
							type: 'array',
							description: 'Array of workers with location data and check-in status'
						},
						clients: { 
							type: 'array',
							description: 'Array of clients with comprehensive business information'
						},
						competitors: { 
							type: 'array',
							description: 'Array of competitors with threat analysis data'
						},
						quotations: { 
							type: 'array',
							description: 'Array of recent quotations mapped to client locations'
						},
						events: { 
							type: 'array',
							description: 'Array of recent events (check-ins, tasks, leads, etc.)'
						},
						mapConfig: {
							type: 'object',
							description: 'Map configuration including default center and regions',
							properties: {
								defaultCenter: {
									type: 'object',
									properties: {
										lat: { type: 'number' },
										lng: { type: 'number' }
									}
								},
								orgRegions: { type: 'array' }
							}
						}
					},
				},
				summary: {
					type: 'object',
					properties: {
						totalWorkers: { type: 'number' },
						totalClients: { type: 'number' },
						totalCompetitors: { type: 'number' },
						totalQuotations: { type: 'number' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid parameters or missing organization ID',
	})
	async getMapData(
		@Req() request: AuthenticatedRequest,
		@Query('orgId') queryOrgId?: string,
		@Query('branchId') queryBranchId?: string,
		@Query('userId') queryUserId?: string
	) {
		this.logger.log(`Getting map data - Query params: orgId=${queryOrgId}, branchId=${queryBranchId}, userId=${queryUserId}`);

		// Use query parameters or fall back to user's organization/branch
		const orgId = queryOrgId ? parseInt(queryOrgId, 10) : (request.user.org?.uid || request.user.organisationRef);
		const branchId = queryBranchId ? parseInt(queryBranchId, 10) : request.user.branch?.uid;
		const userId = queryUserId ? parseInt(queryUserId, 10) : request.user.uid;

		this.logger.debug(`Resolved parameters - orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}`);

		if (!orgId) {
			this.logger.error('Organization ID is required for map data generation');
			throw new BadRequestException('Organization ID is required');
		}

		// Validate numeric parameters
		if (isNaN(orgId)) {
			this.logger.error(`Invalid organization ID: ${queryOrgId}`);
			throw new BadRequestException('Organization ID must be a valid number');
		}

		if (queryBranchId && isNaN(branchId)) {
			this.logger.error(`Invalid branch ID: ${queryBranchId}`);
			throw new BadRequestException('Branch ID must be a valid number');
		}

		if (queryUserId && isNaN(userId)) {
			this.logger.error(`Invalid user ID: ${queryUserId}`);
			throw new BadRequestException('User ID must be a valid number');
		}

		this.logger.log(`Generating map data for organisation ${orgId}${branchId ? `, branch ${branchId}` : ''}${userId ? `, user ${userId}` : ''}`);

		return this.reportsService.generateMapData({ 
			organisationId: orgId, 
			branchId,
			userId
		});
	}
}
