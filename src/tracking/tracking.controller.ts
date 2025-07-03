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
		description:
			'Creates a new GPS tracking record with the provided data. This endpoint is public and does not require authentication.',
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
}
