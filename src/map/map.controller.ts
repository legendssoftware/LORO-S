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
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBadRequestResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiInternalServerErrorResponse, ApiOkResponse } from '@nestjs/swagger';
import { MapService } from './map.service';
import { CreateMapDto } from './dto/create-map.dto';
import { UpdateMapDto } from './dto/update-map.dto';
import { getDynamicDate, getDynamicDateTime, getPastDate, createApiDescription } from '../lib/utils/swagger-helpers';

@ApiTags('🗺️ Map')
@Controller('map')
export class MapController {
	constructor(private readonly mapService: MapService) {}

	/**
	 * Generate comprehensive map data for an organization
	 * Includes workers, clients, competitors, and quotations
	 */
	@Get('data')
	@ApiOperation({
		summary: '🗺️ Get comprehensive map data for organization',
		description: createApiDescription(
			'Retrieves comprehensive map data including workers, clients, competitors, and quotations for a specific organization and optional branch. Provides real-time location data for visualization and route planning.',
			'The service method `MapService.generateMapData()` queries checked-in workers, client locations, competitor data, recent quotations, organization configuration, and returns aggregated map data with caching for performance.',
			'MapService',
			'generateMapData',
			'aggregates map data from multiple sources including workers, clients, competitors, and quotations',
			'an object containing workers, clients, competitors, quotations, and map configuration',
			['Worker location tracking', 'Client location aggregation', 'Competitor data retrieval', 'Quotation location mapping', 'Caching']
		),
	})
	@ApiQuery({
		name: 'organisationId',
		description: 'Organization ID (required)',
		type: Number,
		required: true,
		example: 12345
	})
	@ApiQuery({
		name: 'branchId',
		description: 'Branch ID (optional - filters data to specific branch)',
		type: Number,
		required: false,
		example: 67890
	})
	@ApiQuery({
		name: 'userId',
		description: 'User ID for authorization context (optional)',
		type: Number,
		required: false,
		example: 11111
	})
	@ApiOkResponse({
		description: '✅ Map data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				data: {
					type: 'object',
					properties: {
						workers: {
							type: 'array',
							description: 'Currently checked-in employees with location data',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 12345 },
									name: { type: 'string', example: 'John Doe' },
									latitude: { type: 'number', example: -25.7479 },
									longitude: { type: 'number', example: 28.2293 },
									status: { type: 'string', example: 'CHECKED_IN' }
								}
							}
						},
						clients: {
							type: 'array',
							description: 'Client locations with comprehensive data',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 54321 },
									name: { type: 'string', example: 'ABC Corporation' },
									latitude: { type: 'number', example: -25.7479 },
									longitude: { type: 'number', example: 28.2293 },
									address: { type: 'string', example: '123 Main St' }
								}
							}
						},
						competitors: {
							type: 'array',
							description: 'Competitor locations with market intelligence',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 98765 },
									name: { type: 'string', example: 'Competitor Inc' },
									latitude: { type: 'number', example: -25.7479 },
									longitude: { type: 'number', example: 28.2293 }
								}
							}
						},
						quotations: {
							type: 'array',
							description: 'Recent quotations with client locations',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 11111 },
									clientRef: { type: 'number', example: 54321 },
									latitude: { type: 'number', example: -25.7479 },
									longitude: { type: 'number', example: 28.2293 },
									status: { type: 'string', example: 'PENDING' }
								}
							}
						},
						mapConfig: {
							type: 'object',
							properties: {
								defaultCenter: {
									type: 'object',
									properties: {
										lat: { type: 'number', example: -25.7479 },
										lng: { type: 'number', example: 28.2293 },
									},
								},
								orgRegions: {
									type: 'array',
									description: 'Organization-specific map regions',
									items: { type: 'object' }
								},
							},
						},
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad request - Invalid parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Organisation ID is required' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Access denied',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Access denied' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Not found - Organization or branch not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Organization not found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal server error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve map data. Please try again.' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
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

	@Get('trip-history/:userId')
	@ApiOperation({
		summary: '🚗 Get sales rep trip history with routing',
		description: createApiDescription(
			'Retrieves trip history for a sales representative including tracking points, route planning, distance calculations, and duration analysis. Uses Google Maps API for route optimization.',
			'The service method `MapService.getTripHistory()` queries tracking points for the user within date range, calculates route using Google Maps API, computes total distance and duration, caches results, and returns trip history with route data.',
			'MapService',
			'getTripHistory',
			'retrieves tracking points, plans route using Google Maps, calculates distance and duration',
			'an object containing route, tracking points, total distance, and total duration',
			['Tracking point retrieval', 'Route planning', 'Distance calculation', 'Duration analysis', 'Caching']
		),
	})
	@ApiParam({
		name: 'userId',
		description: 'Sales representative user ID',
		type: Number,
		example: 12345
	})
	@ApiQuery({
		name: 'startDate',
		description: 'Start date for trip history (ISO format: YYYY-MM-DD). Defaults to today if not provided.',
		required: false,
		type: String,
		example: getPastDate(7)
	})
	@ApiQuery({
		name: 'endDate',
		description: 'End date for trip history (ISO format: YYYY-MM-DD). Defaults to today if not provided.',
		required: false,
		type: String,
		example: getDynamicDate()
	})
	@ApiOkResponse({
		description: '✅ Trip history retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				route: {
					type: 'object',
					properties: {
						totalDistance: { type: 'number', example: 45.5, description: 'Total distance in kilometers' },
						totalDuration: { type: 'number', example: 3600, description: 'Total duration in seconds' },
						waypoints: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									latitude: { type: 'number', example: -25.7479 },
									longitude: { type: 'number', example: 28.2293 }
								}
							}
						}
					}
				},
				points: {
					type: 'array',
					description: 'Tracking points for the trip',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 11111 },
							latitude: { type: 'number', example: -25.7479 },
							longitude: { type: 'number', example: 28.2293 },
							createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
						}
					}
				},
				totalDistance: { type: 'number', example: 45.5, description: 'Total distance in kilometers' },
				totalDuration: { type: 'number', example: 3600, description: 'Total duration in seconds' }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad request - Invalid user ID or date format',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid user ID' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	async getTripHistory(
		@Param('userId') userId: string,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	) {
		const userIdNum = parseInt(userId, 10);
		if (isNaN(userIdNum)) {
			throw new BadRequestException('Invalid user ID');
		}

		return this.mapService.getTripHistory({
			userId: userIdNum,
			startDate: startDate ? new Date(startDate) : undefined,
			endDate: endDate ? new Date(endDate) : undefined,
		});
	}
}
