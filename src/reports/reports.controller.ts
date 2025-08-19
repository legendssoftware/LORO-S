import { Controller, Get, UseGuards, Req, BadRequestException, Logger } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiTags,
	ApiOkResponse,
	ApiBadRequestResponse,
	ApiUnauthorizedResponse,
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
- **Employee Locations**: Real-time employee locations
- **Client Locations**: Active client locations
- **Competitor Locations**: Competitor mapping
- **Quotation Locations**: Quotation and order locations
- **Territory Mapping**: Sales territory visualization
- **Performance Mapping**: Performance metrics by location

## 📊 **Location Analytics**
- **Geographic Distribution**: Entity distribution by location
- **Density Analysis**: Concentration of activities
- **Route Optimization**: Optimal route planning
- **Territory Performance**: Performance by territory
- **Market Coverage**: Market coverage analysis
- **Travel Patterns**: Employee travel patterns
		`,
	})
	@ApiOkResponse({
		description: 'Map data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						workers: { type: 'array' },
						clients: { type: 'array' },
						competitors: { type: 'array' },
						quotations: { type: 'array' },
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
		description: 'Bad Request - Invalid parameters',
	})
	async getMapData(@Req() request: AuthenticatedRequest) {
		this.logger.log('Getting map data');

		const orgId = request.user.org?.uid || request.user.organisationRef;
		const branchId = request.user.branch?.uid;

		if (!orgId) {
			throw new BadRequestException('Organization ID is required');
		}

		return this.reportsService.generateMapData({ organisationId: orgId, branchId });
	}
}
