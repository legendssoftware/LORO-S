import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { CreateTrackingDto } from './dto/create-tracking.dto';
import { JwtService } from '@nestjs/jwt';
import {
	ApiTags,
	ApiOperation,
	ApiBearerAuth,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { Roles } from '../decorators/role.decorator';
import { isPublic } from '../decorators/public.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthGuard } from '../guards/auth.guard';
import { Request } from 'express';
import { User } from '../user/entities/user.entity';

interface AuthenticatedRequest extends Request {
	user: User;
}

@ApiTags('🗺️ GPS Tracking')
@Controller('gps')
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class TrackingController {
	constructor(
		private readonly trackingService: TrackingService,
		private readonly jwtService: JwtService,
	) {}

	@Post()
	@isPublic()
	@ApiOperation({
		summary: 'Create a new tracking record',
		description: createApiDescription(
			'Creates a new GPS tracking record with the provided data. This endpoint is public and does not require authentication.',
			'The service method `TrackingService.create()` processes GPS tracking data, validates coordinates, stores location data, and returns the created tracking record.',
			'TrackingService',
			'create',
			'creates a new GPS tracking record, validates coordinates, and stores location data',
			'an object containing the created tracking record data',
			['Coordinate validation', 'Location storage', 'Timestamp handling'],
		),
	})
	@ApiBody({ type: CreateTrackingDto })
	@ApiCreatedResponse({
		description: 'Tracking record created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						latitude: { type: 'number', example: -33.9249 },
						longitude: { type: 'number', example: 18.4241 },
						accuracy: { type: 'number', example: 10.5 },
						altitude: { type: 'number', example: 100.2 },
						speed: { type: 'number', example: 5.7 },
						timestamp: { type: 'number', example: 1625097600000 },
						trackingRef: { type: 'string', example: 'TRK123456' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid input data provided' })
	create(@Body() createTrackingDto: CreateTrackingDto, @Req() req: Request) {
		// Extract token from request if available
		let userId = createTrackingDto.owner;
		let branchId = null;
		let orgId = null;

		try {
			// Check if Authorization header exists
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				const token = authHeader.substring(7);
				const decodedToken = this.jwtService.decode(token);
				
				if (decodedToken) {
					// If token contains user info, use it instead of the one in the DTO
					if (decodedToken['uid']) {
						userId = parseInt(decodedToken['uid'], 10);
					}
					
					// Extract branch and organization info if available
					if (decodedToken['branch'] && decodedToken['branch'].uid) {
						branchId = decodedToken['branch'].uid;
					}
					
					if (decodedToken['organisationRef']) {
						orgId = decodedToken['organisationRef'];
					}
				}
			}
		} catch (error) {
			// If token extraction fails, use the owner from the DTO
		}

		// Update the DTO with the extracted information
		createTrackingDto.owner = userId;
		
		return this.trackingService.create(createTrackingDto, branchId, orgId);
	}

	@Post('stops')
	@UseGuards(AuthGuard)
	@ApiBearerAuth()
	@ApiOperation({
		summary: 'Record a stop event',
		description: 'Records a stop event with location, duration, and address information. Requires authentication.',
	})
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				latitude: { type: 'number', example: -33.9249 },
				longitude: { type: 'number', example: 18.4241 },
				startTime: { type: 'number', example: 1625097600000 },
				endTime: { type: 'number', example: 1625098500000 },
				duration: { type: 'number', example: 900 },
				address: { type: 'string', example: '123 Main St, Cape Town, South Africa' },
			},
			required: ['latitude', 'longitude', 'startTime', 'endTime', 'duration'],
		},
	})
	@ApiCreatedResponse({
		description: 'Stop event recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						latitude: { type: 'number', example: -33.9249 },
						longitude: { type: 'number', example: 18.4241 },
						startTime: { type: 'number', example: 1625097600000 },
						endTime: { type: 'number', example: 1625098500000 },
						duration: { type: 'number', example: 900 },
						address: { type: 'string', example: '123 Main St, Cape Town, South Africa' },
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'John Doe' },
							},
						},
						createdAt: { type: 'string', format: 'date-time' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid input data provided' })
	createStopEvent(
		@Body()
		stopData: {
			latitude: number;
			longitude: number;
			startTime: number;
			endTime: number;
			duration: number;
			address?: string;
		},
		@Req() req: AuthenticatedRequest,
	) {
		return this.trackingService.createStopEvent(stopData, req.user.uid);
	}

	@Get()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get all tracking records',
		description:
			'Retrieves all GPS tracking records. Accessible by all authenticated users with appropriate roles.',
	})
	@ApiOkResponse({
		description: 'Tracking records retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1 },
							latitude: { type: 'number', example: -33.9249 },
							longitude: { type: 'number', example: 18.4241 },
							accuracy: { type: 'number', example: 10.5 },
							altitude: { type: 'number', example: 100.2 },
							speed: { type: 'number', example: 5.7 },
							timestamp: { type: 'number', example: 1625097600000 },
							trackingRef: { type: 'string', example: 'TRK123456' },
							createdAt: { type: 'string', format: 'date-time' },
							updatedAt: { type: 'string', format: 'date-time' },
							isDeleted: { type: 'boolean', example: false },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 100 },
					},
				},
			},
		},
	})
	findAll() {
		return this.trackingService.findAll();
	}

	@Get('stops')
	@UseGuards(AuthGuard)
	@ApiBearerAuth()
	@ApiOperation({
		summary: 'Get all stops for the current user',
		description: 'Retrieves all stop events for the authenticated user. Requires authentication.',
	})
	@ApiOkResponse({
		description: 'Stop events retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1 },
							latitude: { type: 'number', example: -33.9249 },
							longitude: { type: 'number', example: 18.4241 },
							startTime: { type: 'number', example: 1625097600000 },
							endTime: { type: 'number', example: 1625098500000 },
							duration: { type: 'number', example: 900 },
							address: { type: 'string', example: '123 Main St, Cape Town, South Africa' },
							createdAt: { type: 'string', format: 'date-time' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	getUserStops(@Req() req: AuthenticatedRequest) {
		return this.trackingService.getUserStops(req.user.uid);
	}

	@Get(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get a tracking record by reference code',
		description:
			'Retrieves a specific GPS tracking record by its reference code. Accessible by all authenticated users with appropriate roles.',
	})
	@ApiParam({
		name: 'ref',
		description: 'Tracking reference code',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: 'Tracking record found',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						latitude: { type: 'number', example: -33.9249 },
						longitude: { type: 'number', example: 18.4241 },
						accuracy: { type: 'number', example: 10.5 },
						altitude: { type: 'number', example: 100.2 },
						speed: { type: 'number', example: 5.7 },
						timestamp: { type: 'number', example: 1625097600000 },
						trackingRef: { type: 'string', example: 'TRK123456' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
						isDeleted: { type: 'boolean', example: false },
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'John Doe' },
								email: { type: 'string', example: 'john.doe@example.com' },
							},
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'Tracking record not found' })
	findOne(@Param('ref') ref: number) {
		return this.trackingService.findOne(ref);
	}

	@Get('for/:ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get tracking by user reference code',
		description:
			'Retrieves all GPS tracking records for a specific user. Accessible by all authenticated users with appropriate roles.',
	})
	@ApiParam({
		name: 'ref',
		description: 'User reference code',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: 'Tracking records for user retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1 },
							latitude: { type: 'number', example: -33.9249 },
							longitude: { type: 'number', example: 18.4241 },
							accuracy: { type: 'number', example: 10.5 },
							altitude: { type: 'number', example: 100.2 },
							speed: { type: 'number', example: 5.7 },
							timestamp: { type: 'number', example: 1625097600000 },
							trackingRef: { type: 'string', example: 'TRK123456' },
							createdAt: { type: 'string', format: 'date-time' },
							updatedAt: { type: 'string', format: 'date-time' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 50 },
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({ description: 'User not found or has no tracking records' })
	trackingByUser(@Param('ref') ref: number) {
		return this.trackingService.trackingByUser(ref);
	}

	@Get('daily/:ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.USER)
	@ApiOperation({
		summary: 'Get daily tracking summary for a user',
		description:
			'Retrieves a daily summary of GPS tracking data for a specific user. Accessible by all authenticated users with appropriate roles.',
	})
	@ApiParam({
		name: 'ref',
		description: 'User ID',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: 'Daily tracking summary retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							date: { type: 'string', example: '2023-07-01' },
							totalDistance: { type: 'number', example: 15.7 },
							totalDuration: { type: 'number', example: 7200 },
							averageSpeed: { type: 'number', example: 35.5 },
							stops: { type: 'number', example: 5 },
							points: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										latitude: { type: 'number', example: -33.9249 },
										longitude: { type: 'number', example: 18.4241 },
										timestamp: { type: 'number', example: 1625097600000 },
									},
								},
							},
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'User not found or has no tracking data' })
	getDailyTracking(@Param('ref') ref: number) {
		return this.trackingService.getDailyTracking(ref);
	}

	@Patch('/restore/:ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.USER)
	@ApiOperation({
		summary: 'Restore a deleted tracking record by reference code',
		description:
			'Restores a previously deleted GPS tracking record. Accessible by all authenticated users with appropriate roles.',
	})
	@ApiParam({
		name: 'ref',
		description: 'Tracking reference code',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: 'Tracking record restored successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'Tracking record not found' })
	restore(@Param('ref') ref: number) {
		return this.trackingService.restore(ref);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.USER)
	@ApiOperation({
		summary: 'Soft delete a tracking record by reference code',
		description:
			'Performs a soft delete on a GPS tracking record. Accessible by all authenticated users with appropriate roles.',
	})
	@ApiParam({
		name: 'ref',
		description: 'Tracking reference code',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: 'Tracking record deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'Tracking record not found' })
	remove(@Param('ref') ref: number) {
		return this.trackingService.remove(ref);
	}

	@Post('device-tracking')
	@isPublic()
	@ApiOperation({
		summary: 'Create a tracking record from device data',
		description:
			'Creates a new GPS tracking record from device data. This endpoint accepts the new data format with device information and checks for geofence events.',
	})
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				batteryLevel: { type: 'number', example: -1 },
				batteryState: { type: 'number', example: 0 },
				brand: { type: 'string', example: 'Apple' },
				coords: {
					type: 'object',
					properties: {
						accuracy: { type: 'number', example: 5 },
						altitude: { type: 'number', example: 0 },
						altitudeAccuracy: { type: 'number', example: -1 },
						heading: { type: 'number', example: -1 },
						latitude: { type: 'number', example: 37.785834 },
						longitude: { type: 'number', example: -122.406417 },
						speed: { type: 'number', example: -1 },
					},
				},
				manufacturer: { type: 'string', example: 'Apple' },
				modelID: { type: 'string', example: 'arm64' },
				modelName: { type: 'string', example: 'Simulator iOS' },
				network: {
					type: 'object',
					properties: {
						ipAddress: { type: 'string', example: '192.168.0.189' },
						state: {
							type: 'object',
							properties: {
								isConnected: { type: 'boolean', example: true },
								isInternetReachable: { type: 'boolean', example: true },
								type: { type: 'string', example: 'WIFI' },
							},
						},
					},
				},
				osName: { type: 'string', example: 'iOS' },
				osVersion: { type: 'string', example: '18.1' },
				timestamp: { type: 'number', example: 1740670776637 },
				owner: { type: 'number', example: 1 },
			},
			required: ['coords', 'owner'],
		},
	})
	@ApiCreatedResponse({
		description: 'Device tracking record created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						latitude: { type: 'number', example: 37.785834 },
						longitude: { type: 'number', example: -122.406417 },
						accuracy: { type: 'number', example: 5 },
						altitude: { type: 'number', example: 0 },
						speed: { type: 'number', example: -1 },
						timestamp: { type: 'number', example: 1740670776637 },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				geofenceInfo: {
					type: 'string',
					example: 'Geofence checking is being processed asynchronously',
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid input data provided' })
	createDeviceTracking(@Body() deviceData: any, @Req() req: Request) {
		// Ensure owner is provided
		let userId = deviceData.owner;
		let branchId = null;
		let orgId = null;

		try {
			// Check if Authorization header exists
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				const token = authHeader.substring(7);
				const decodedToken = this.jwtService.decode(token);
				
				if (decodedToken) {
					// If token contains user info, use it instead of the one in the DTO
					if (decodedToken['uid']) {
						userId = parseInt(decodedToken['uid'], 10);
						// If no owner was provided in the payload, use the one from the token
						if (!deviceData.owner) {
							deviceData.owner = userId;
						}
					}
					
					// Extract branch and organization info if available
					if (decodedToken['branch'] && decodedToken['branch'].uid) {
						branchId = decodedToken['branch'].uid;
					}
					
					if (decodedToken['organisationRef']) {
						orgId = decodedToken['organisationRef'];
					}
				}
			}
		} catch (error) {
			// If token extraction fails, use the owner from the DTO
		}

		if (!deviceData.owner) {
			return {
				message: 'Owner ID is required',
				tracking: null,
				warnings: [{ type: 'VALIDATION_ERROR', message: 'Owner ID is required' }],
			};
		}

		// Ensure coords are provided
		if (!deviceData.coords || !deviceData.coords.latitude || !deviceData.coords.longitude) {
			return {
				message: 'Valid coordinates are required',
				tracking: null,
				warnings: [{ type: 'VALIDATION_ERROR', message: 'Valid coordinates are required' }],
			};
		}

		// Create a tracking DTO from the device data
		const createTrackingDto: CreateTrackingDto = {
			owner: deviceData.owner,
			latitude: deviceData.coords.latitude,
			longitude: deviceData.coords.longitude,
			accuracy: deviceData.coords.accuracy,
			altitude: deviceData.coords.altitude,
			altitudeAccuracy: deviceData.coords.altitudeAccuracy,
			heading: deviceData.coords.heading,
			speed: deviceData.coords.speed,
			timestamp: deviceData.timestamp,
			batteryLevel: deviceData.batteryLevel,
			batteryState: deviceData.batteryState,
			brand: deviceData.brand,
			manufacturer: deviceData.manufacturer,
			modelID: deviceData.modelID,
			modelName: deviceData.modelName,
			osName: deviceData.osName,
			osVersion: deviceData.osVersion,
			network: deviceData.network,
		};

		const response = this.trackingService.create(createTrackingDto, branchId, orgId);

		// Add information about geofence checking
		return {
			...response,
			geofenceInfo: 'Geofence checking is being processed asynchronously',
		};
	}

	@Post('batch')
	@isPublic()
	@ApiOperation({
		summary: 'Create multiple tracking records in a single request',
		description: 'Creates multiple GPS tracking records efficiently. Maximum 100 points per batch.',
	})
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				points: {
					type: 'array',
					items: { type: 'object' },
					description: 'Array of tracking points (max 100)',
					maxItems: 100,
				},
			},
			required: ['points'],
		},
	})
	@ApiCreatedResponse({
		description: 'Batch tracking records created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Batch created successfully' },
				successful: { type: 'number', example: 95 },
				failed: { type: 'number', example: 5 },
				total: { type: 'number', example: 100 },
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid batch data or exceeds maximum size' })
	async createBatch(@Body() batchDto: { points: CreateTrackingDto[] }, @Req() req: Request) {
		if (!batchDto.points || !Array.isArray(batchDto.points)) {
			return {
				message: 'Points array is required',
				successful: 0,
				failed: 0,
				total: 0,
			};
		}

		if (batchDto.points.length > 100) {
			return {
				message: 'Maximum 100 points allowed per batch',
				successful: 0,
				failed: batchDto.points.length,
				total: batchDto.points.length,
			};
		}

		if (batchDto.points.length === 0) {
			return {
				message: 'At least one point is required',
				successful: 0,
				failed: 0,
				total: 0,
			};
		}

		// Extract branch and org from token if available
		let branchId = null;
		let orgId = null;

		try {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				const token = authHeader.substring(7);
				const decodedToken = this.jwtService.decode(token);
				
				if (decodedToken) {
					if (decodedToken['branch'] && decodedToken['branch'].uid) {
						branchId = decodedToken['branch'].uid;
					}
					if (decodedToken['organisationRef']) {
						orgId = decodedToken['organisationRef'];
					}
				}
			}
		} catch (error) {
			// Silent fail - use defaults
		}

		return this.trackingService.createBatch(batchDto.points, branchId, orgId);
	}

	// ======================================================
	// NEW COMPREHENSIVE TRACKING ENDPOINTS
	// ======================================================

	@Get('user/:userId/timeframe/:timeframe')
	@UseGuards(AuthGuard)
	@ApiBearerAuth()
	@Roles(AccessLevel.USER, AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Get tracking points for a user within a specific timeframe',
		description: `
		Retrieves comprehensive tracking data for a specific user within various timeframes.
		Includes detailed analytics, trip summaries, and location insights.
		
		**Supported Timeframes:**
		- \`today\` - Today's tracking data
		- \`yesterday\` - Yesterday's tracking data  
		- \`this_week\` - Current week's data (Monday to Sunday)
		- \`last_week\` - Previous week's data
		- \`this_month\` - Current month's data
		- \`last_month\` - Previous month's data
		- \`custom\` - Custom date range (requires startDate and endDate query params)
		
		**Analytics Included:**
		- Total distance traveled
		- Average and top speeds
		- Time spent moving vs stationary
		- Number of locations visited
		- Most visited location
		- Trip summaries with duration statistics
		
		**Use Cases:**
		- Employee tracking and productivity analysis
		- Fleet management and route optimization
		- Attendance verification through location data
		- Performance reporting and insights
		`,
	})
	@ApiParam({ 
		name: 'userId', 
		description: 'User ID to get tracking data for',
		type: 'number',
		example: 123
	})
	@ApiParam({ 
		name: 'timeframe', 
		description: 'Time period to fetch data for',
		enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'custom'],
		example: 'today'
	})
	@ApiOkResponse({
		description: 'Tracking data retrieved successfully with comprehensive analytics',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Tracking data retrieved successfully' },
				data: {
					type: 'object',
					properties: {
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
								email: { type: 'string', example: 'john.doe@loro.co.za' },
								branch: { type: 'string', example: 'Pretoria South Africa' },
								organisation: { type: 'string', example: 'Orrbit Technologies' }
							}
						},
						timeframe: { type: 'string', example: 'today' },
						period: {
							type: 'object',
							properties: {
								start: { type: 'string', format: 'date-time' },
								end: { type: 'string', format: 'date-time' }
							}
						},
						totalPoints: { type: 'number', example: 45 },
						trackingPoints: {
							type: 'array',
							description: 'Array of tracking points with coordinates, timestamps, and location data',
							items: { type: 'object' }
						},
						analytics: {
							type: 'object',
							properties: {
								totalDistance: { type: 'number', example: 25.7, description: 'Total distance in kilometers' },
								averageSpeed: { type: 'number', example: 35.5, description: 'Average speed in km/h' },
								topSpeed: { type: 'number', example: 80.2, description: 'Maximum speed recorded in km/h' },
								timeSpentMoving: { type: 'number', example: 120, description: 'Minutes spent in motion' },
								timeSpentStationary: { type: 'number', example: 480, description: 'Minutes spent stationary' },
								locationsVisited: { type: 'number', example: 8, description: 'Number of unique locations visited' },
								mostVisitedLocation: { type: 'string', example: '123 Main Street, Pretoria, South Africa' }
							}
						},
						tripSummary: {
							type: 'object',
							properties: {
								totalTrips: { type: 'number', example: 4, description: 'Number of distinct trips detected' },
								averageTripDuration: { type: 'number', example: 45, description: 'Average trip duration in minutes' },
								longestTrip: { type: 'number', example: 120, description: 'Longest trip duration in minutes' },
								shortestTrip: { type: 'number', example: 15, description: 'Shortest trip duration in minutes' }
							}
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({ 
		description: 'User not found or no tracking data available',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User with ID 123 not found' },
				data: { type: 'null' }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: 'Invalid parameters provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Valid user ID is required' },
				data: { type: 'null' }
			}
		}
	})
	async getTrackingByUserAndTimeframe(
		@Param('userId') userId: number,
		@Param('timeframe') timeframe: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom',
		@Req() req: AuthenticatedRequest
	) {
		const user = req.user;
		return this.trackingService.getTrackingPointsByUserAndTimeframe(
			Number(userId), 
			timeframe, 
			undefined, 
			undefined, 
			user?.organisation?.uid,
			user?.branch?.uid
		);
	}

	@Get('user/:userId/custom-range')
	@UseGuards(AuthGuard)
	@ApiBearerAuth()
	@Roles(AccessLevel.USER, AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Get tracking points for a user within a custom date range',
		description: `
		Retrieves tracking data for a specific user within a custom date range.
		This endpoint provides the same comprehensive analytics as the timeframe endpoint
		but allows for precise date range selection.
		
		**Query Parameters:**
		- \`startDate\` - Start date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)
		- \`endDate\` - End date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)
		
		**Example Usage:**
		\`\`\`
		GET /gps/user/123/custom-range?startDate=2024-01-01&endDate=2024-01-31
		\`\`\`
		
		**Business Applications:**
		- Monthly performance reports
		- Quarterly tracking analysis
		- Custom billing periods
		- Compliance reporting for specific date ranges
		- Investigation of specific incidents or time periods
		`,
	})
	@ApiParam({ 
		name: 'userId', 
		description: 'User ID to get tracking data for',
		type: 'number',
		example: 123
	})
	@ApiOkResponse({
		description: 'Custom range tracking data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Tracking data retrieved successfully' },
				data: { type: 'object', description: 'Same structure as timeframe endpoint' }
			}
		}
	})
	async getTrackingByUserCustomRange(
		@Param('userId') userId: number,
		@Req() req: AuthenticatedRequest
	) {
		const user = req.user;
		const { startDate, endDate } = req.query;
		
		if (!startDate || !endDate) {
			return {
				message: 'Start date and end date are required for custom range',
				data: null
			};
		}

		return this.trackingService.getTrackingPointsByUserAndTimeframe(
			Number(userId), 
			'custom', 
			new Date(startDate as string), 
			new Date(endDate as string), 
			user?.organisation?.uid,
			user?.branch?.uid
		);
	}

	@Post('multi-user/timeframe/:timeframe')
	@UseGuards(AuthGuard)
	@ApiBearerAuth()
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Get tracking data for multiple users within a timeframe',
		description: `
		Retrieves aggregated tracking data for multiple users within a specified timeframe.
		This endpoint is designed for organizational reporting and fleet management.
		
		**Request Body:**
		Send an array of user IDs to retrieve data for multiple users simultaneously.
		
		**Organizational Analytics:**
		- Total distance covered by all users
		- Average tracking points per user
		- Most and least active users identification
		- Aggregated performance metrics
		- Team productivity insights
		
		**Limitations:**
		- Maximum of 100 users can be processed at once
		- Only users within the requester's organization scope
		- Requires ADMIN or OWNER role privileges
		
		**Use Cases:**
		- Team performance dashboards
		- Fleet management reporting
		- Organizational productivity analysis
		- Comparative user performance studies
		- Bulk data export for analytics
		`,
	})
	@ApiParam({ 
		name: 'timeframe', 
		description: 'Time period to fetch data for all users',
		enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'custom'],
		example: 'today'
	})
	@ApiBody({
		description: 'Array of user IDs to get tracking data for',
		schema: {
			type: 'object',
			properties: {
				userIds: {
					type: 'array',
					items: { type: 'number' },
					example: [123, 124, 125, 126],
					description: 'Array of user IDs (maximum 100)',
					maxItems: 100
				}
			},
			required: ['userIds']
		}
	})
	@ApiOkResponse({
		description: 'Multi-user tracking data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Multi-user tracking data retrieved successfully' },
				data: {
					type: 'object',
					properties: {
						timeframe: { type: 'string', example: 'today' },
						period: {
							type: 'object',
							properties: {
								start: { type: 'string', format: 'date-time' },
								end: { type: 'string', format: 'date-time' }
							}
						},
						totalUsers: { type: 'number', example: 4, description: 'Number of users with data' },
						totalPoints: { type: 'number', example: 180, description: 'Total tracking points across all users' },
						users: {
							type: 'array',
							description: 'Individual user data and analytics',
							items: {
								type: 'object',
								properties: {
									user: { type: 'object', description: 'User information' },
									trackingPoints: { type: 'array', description: 'User\'s tracking points' },
									analytics: { type: 'object', description: 'User\'s calculated analytics' }
								}
							}
						},
						organizationSummary: {
							type: 'object',
							properties: {
								totalDistance: { type: 'number', example: 157.3, description: 'Combined distance of all users' },
								averagePointsPerUser: { type: 'number', example: 45, description: 'Average tracking points per user' },
								mostActiveUser: { type: 'object', description: 'User with most tracking points' },
								leastActiveUser: { type: 'object', description: 'User with least tracking points' }
							}
						}
					}
				}
			}
		}
	})
	async getMultiUserTracking(
		@Param('timeframe') timeframe: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom',
		@Body() body: { userIds: number[] },
		@Req() req: AuthenticatedRequest
	) {
		const user = req.user;
		const { userIds } = body;
		
		if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
			return {
				message: 'Array of user IDs is required',
				data: null
			};
		}

		return this.trackingService.getTrackingPointsForMultipleUsers(
			userIds, 
			timeframe, 
			undefined, 
			undefined, 
			user?.organisation?.uid,
			user?.branch?.uid
		);
	}

	@Get('analytics/summary')
	@UseGuards(AuthGuard)
	@ApiBearerAuth()
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Get organizational tracking analytics summary',
		description: `
		Provides high-level tracking analytics for the entire organization.
		This endpoint gives administrators and owners a quick overview of tracking activity.
		
		**Analytics Provided:**
		- Total tracking points recorded today
		- Number of active users (users with tracking data today)
		- Organization-wide distance statistics
		- Average daily activity metrics
		- System health and data quality indicators
		
		**Response Time:**
		This endpoint uses caching for optimal performance and can handle frequent requests
		without impacting database performance.
		`,
	})
	@ApiOkResponse({
		description: 'Organizational tracking summary retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Analytics summary retrieved successfully' },
				summary: {
					type: 'object',
					properties: {
						today: {
							type: 'object',
							properties: {
								totalPoints: { type: 'number', example: 1247 },
								activeUsers: { type: 'number', example: 23 },
								totalDistance: { type: 'number', example: 342.8 },
								averageDistancePerUser: { type: 'number', example: 14.9 }
							}
						},
						thisWeek: {
							type: 'object',
							properties: {
								totalPoints: { type: 'number', example: 8734 },
								activeUsers: { type: 'number', example: 45 },
								totalDistance: { type: 'number', example: 2156.3 },
								averageDistancePerUser: { type: 'number', example: 47.9 }
							}
						},
						dataQuality: {
							type: 'object',
							properties: {
								geocodingSuccessRate: { type: 'number', example: 94.2, description: 'Percentage of points with successful address resolution' },
								averageAccuracy: { type: 'number', example: 8.5, description: 'Average GPS accuracy in meters' },
								lastUpdateTime: { type: 'string', format: 'date-time', description: 'When data was last refreshed' }
							}
						}
					}
				}
			}
		}
	})
	async getAnalyticsSummary(@Req() req: AuthenticatedRequest) {
		// This would implement organization-wide analytics
		// For now, return a placeholder response
		const user = req.user;
		
		return {
			message: 'Analytics summary retrieved successfully',
			summary: {
				today: {
					totalPoints: 0,
					activeUsers: 0,
					totalDistance: 0,
					averageDistancePerUser: 0
				},
				thisWeek: {
					totalPoints: 0,
					activeUsers: 0,
					totalDistance: 0,
					averageDistancePerUser: 0
				},
				dataQuality: {
					geocodingSuccessRate: 0,
					averageAccuracy: 0,
					lastUpdateTime: new Date().toISOString()
				}
			}
		};
	}

	@Post('re-cal/:ref')
	@UseGuards(AuthGuard)
	@ApiBearerAuth()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.USER)
	@ApiOperation({
		summary: 'Recalculate tracking data for a user',
		description: `
		Recalculates tracking analytics for a specific user by filtering out virtual/fake locations 
		and recomputing all distance, speed, and location analytics.
		
		**What it does:**
		- Fetches all tracking points for the specified user and date
		- Filters out virtual locations (coordinates containing '122')
		- Recalculates distances, speeds, and trip analytics
		- Updates geocoding for points without addresses
		- Provides detailed information about filtered points
		
		**Use Cases:**
		- Correcting reports affected by fake GPS locations
		- Cleaning up tracking data after detecting anomalies
		- Regenerating accurate analytics after data quality issues
		- Administrative cleanup of corrupted tracking data
		
		**Query Parameters:**
		- \`date\` (optional) - Date in YYYY-MM-DD format (defaults to today)
		
		**Example Usage:**
		\`\`\`
		POST /gps/re-cal/123?date=2024-01-15
		\`\`\`
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'User ID to recalculate tracking data for',
		type: 'number',
		example: 123
	})
	@ApiBody({
		required: false,
		description: 'Optional request body (can be empty)',
		schema: {
			type: 'object',
			properties: {
				date: {
					type: 'string',
					format: 'date',
					example: '2024-01-15',
					description: 'Optional date override in YYYY-MM-DD format'
				}
			}
		}
	})
	@ApiOkResponse({
		description: 'Tracking data recalculated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Tracking data recalculated successfully with virtual locations filtered out' },
				data: {
					type: 'object',
					properties: {
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
								email: { type: 'string', example: 'john.doe@loro.co.za' },
								branch: { type: 'string', example: 'Pretoria South Africa' },
								organisation: { type: 'string', example: 'Orrbit Technologies' }
							}
						},
						date: { type: 'string', example: '2024-01-15' },
						totalDistance: { type: 'string', example: '25.7 km' },
						trackingPoints: { type: 'array', description: 'Filtered tracking points without virtual locations' },
						tripSummary: {
							type: 'object',
							properties: {
								totalDistanceKm: { type: 'number', example: 25.7 },
								totalTimeMinutes: { type: 'number', example: 480 },
								averageSpeedKmh: { type: 'number', example: 35.5 },
								movingTimeMinutes: { type: 'number', example: 120 },
								stoppedTimeMinutes: { type: 'number', example: 360 },
								numberOfStops: { type: 'number', example: 8 },
								maxSpeedKmh: { type: 'number', example: 80.2 }
							}
						},
						locationAnalysis: { type: 'object', description: 'Detailed location and stop analysis' },
						geocodingStatus: { type: 'object', description: 'Address resolution status' }
					}
				},
				recalculationInfo: {
					type: 'object',
					properties: {
						originalPointsCount: { type: 'number', example: 45, description: 'Total points before filtering' },
						filteredPointsCount: { type: 'number', example: 38, description: 'Valid points after filtering' },
						virtualPointsRemoved: { type: 'number', example: 7, description: 'Number of virtual/fake locations removed' },
						recalculatedAt: { type: 'string', format: 'date-time', description: 'When recalculation was performed' }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({ 
		description: 'User not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User with ID 123 not found' }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: 'Invalid user ID provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Valid user ID is required' }
			}
		}
	})
	async recalculateUserTracking(
		@Param('ref') ref: number,
		@Body() body: { date?: string } = {},
		@Req() req: AuthenticatedRequest
	) {
		try {
			// Validate user ID
			const userId = Number(ref);
			if (!userId || userId <= 0) {
				return {
					message: 'Valid user ID is required',
					data: null,
					recalculationInfo: {
						originalPointsCount: 0,
						filteredPointsCount: 0,
						virtualPointsRemoved: 0,
						recalculatedAt: new Date().toISOString(),
					}
				};
			}

			// Parse date from body or query params, or use today
			let targetDate = new Date();
			
			// Check body first, then query params
			const dateString = body.date || req.query.date;
			if (dateString) {
				const parsedDate = new Date(dateString as string);
				if (!isNaN(parsedDate.getTime())) {
					targetDate = parsedDate;
				} else {
					return {
						message: 'Invalid date format. Please use YYYY-MM-DD format.',
						data: null,
						recalculationInfo: {
							originalPointsCount: 0,
							filteredPointsCount: 0,
							virtualPointsRemoved: 0,
							recalculatedAt: new Date().toISOString(),
						}
					};
				}
			}

			// Call the service method to recalculate
			return this.trackingService.recalculateUserTrackingForDay(userId, targetDate);

		} catch (error) {
			return {
				message: `Failed to recalculate tracking data: ${error.message}`,
				data: null,
				recalculationInfo: {
					originalPointsCount: 0,
					filteredPointsCount: 0,
					virtualPointsRemoved: 0,
					recalculatedAt: new Date().toISOString(),
				}
			};
		}
	}
}
