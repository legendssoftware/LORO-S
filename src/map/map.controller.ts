import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	Query,
	BadRequestException,
	ForbiddenException,
	NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { MapService } from './map.service';
import { CreateMapDto } from './dto/create-map.dto';
import { UpdateMapDto } from './dto/update-map.dto';

@ApiTags('Map')
@Controller('map')
export class MapController {
	constructor(private readonly mapService: MapService) {}

	/**
	 * Generate comprehensive map data for an organization
	 * Includes workers, clients, competitors, and quotations
	 */
	@Get('data')
	@ApiOperation({
		summary: 'Get map data for organization',
		description:
			'Retrieves comprehensive map data including workers, clients, competitors, and quotations for a specific organization and optional branch',
	})
	@ApiQuery({
		name: 'organisationId',
		description: 'Organization ID (required)',
		type: Number,
		required: true,
	})
	@ApiQuery({
		name: 'branchId',
		description: 'Branch ID (optional - filters data to specific branch)',
		type: Number,
		required: false,
	})
	@ApiQuery({
		name: 'userId',
		description: 'User ID for authorization context (optional)',
		type: Number,
		required: false,
	})
	@ApiResponse({
		status: 200,
		description: 'Map data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				workers: {
					type: 'array',
					description: 'Currently checked-in employees with location data',
				},
				clients: {
					type: 'array',
					description: 'Client locations with comprehensive data',
				},
				competitors: {
					type: 'array',
					description: 'Competitor locations with market intelligence',
				},
				quotations: {
					type: 'array',
					description: 'Recent quotations with client locations',
				},
				mapConfig: {
					type: 'object',
					properties: {
						defaultCenter: {
							type: 'object',
							properties: {
								lat: { type: 'number' },
								lng: { type: 'number' },
							},
						},
						orgRegions: {
							type: 'array',
							description: 'Organization-specific map regions',
						},
					},
				},
			},
		},
	})
	@ApiResponse({ status: 400, description: 'Bad request - Invalid parameters' })
	@ApiResponse({ status: 403, description: 'Forbidden - Access denied' })
	@ApiResponse({ status: 404, description: 'Not found - Organization or branch not found' })
	@ApiResponse({ status: 500, description: 'Internal server error' })
	async getMapData(
		@Query('organisationId') organisationId: string,
		@Query('branchId') branchId?: string,
		@Query('userId') userId?: string,
	) {
		try {
			// Validate required parameters
			if (!organisationId) {
				throw new BadRequestException('Organisation ID is required');
			}

			const orgId = parseInt(organisationId, 10);
			if (isNaN(orgId) || orgId <= 0) {
				throw new BadRequestException('Invalid organisation ID provided');
			}

			// Validate optional branch ID
			let branchIdNumber: number | undefined;
			if (branchId) {
				branchIdNumber = parseInt(branchId, 10);
				if (isNaN(branchIdNumber) || branchIdNumber <= 0) {
					throw new BadRequestException('Invalid branch ID provided');
				}
			}

			// Validate optional user ID
			let userIdNumber: number | undefined;
			if (userId) {
				userIdNumber = parseInt(userId, 10);
				if (isNaN(userIdNumber) || userIdNumber <= 0) {
					throw new BadRequestException('Invalid user ID provided');
				}
			}

			const result = await this.mapService.generateMapData({
				organisationId: orgId,
				branchId: branchIdNumber,
				userId: userIdNumber,
			});

			return {
				success: true,
				data: result,
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			// Handle specific error types
			if (error.message.includes('Access denied')) {
				throw new ForbiddenException(error.message);
			}

			if (error.message.includes('not found')) {
				throw new NotFoundException(error.message);
			}

			if (error.message.includes('Bad request') || error.message.includes('Invalid')) {
				throw new BadRequestException(error.message);
			}

			// Log unexpected errors
			console.error('Unexpected error in getMapData:', error);
			throw new BadRequestException('Failed to retrieve map data. Please try again.');
		}
	}
}
