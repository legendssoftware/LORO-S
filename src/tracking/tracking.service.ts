import { Injectable, NotFoundException, Logger, BadRequestException, Inject } from '@nestjs/common';
import { CreateTrackingDto } from './dto/create-tracking.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Tracking } from './entities/tracking.entity';
import { DeepPartial, Repository, IsNull, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { LocationUtils } from '../lib/utils/location.utils';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, addDays } from 'date-fns';
import axios from 'axios';
import { User } from '../user/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class TrackingService {
	private readonly logger = new Logger(TrackingService.name);
	private readonly geocodingApiKey: string;
	private readonly CACHE_TTL: number;
	private readonly CACHE_PREFIX = 'tracking:';

	constructor(
		@InjectRepository(Tracking)
		private trackingRepository: Repository<Tracking>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
	) {
		this.geocodingApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default
		this.logger.log('TrackingService initialized with enhanced logging and caching capabilities');
		this.logger.debug(`Geocoding API configured: ${!!this.geocodingApiKey}`);
		this.logger.debug(`Cache TTL set to: ${this.CACHE_TTL}ms`);
	}

	// ======================================================
	// HELPER METHODS
	// ======================================================

	/**
	 * Generate cache key with prefix
	 * @param key - Cache key suffix
	 * @returns Full cache key
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Clear tracking cache for specific keys
	 * @param trackingId - Optional tracking ID to clear
	 * @param userId - Optional user ID to clear
	 */
	private async clearTrackingCache(trackingId?: number, userId?: number): Promise<void> {
		try {
			const keysToDelete: string[] = [];

			if (trackingId) {
				keysToDelete.push(this.getCacheKey(trackingId));
			}

			if (userId) {
				keysToDelete.push(this.getCacheKey(`user_${userId}`));
				keysToDelete.push(this.getCacheKey(`daily_${userId}`));
			}

			// Clear general tracking cache keys
			keysToDelete.push(this.getCacheKey('all'));

			for (const key of keysToDelete) {
				await this.cacheManager.del(key);
				this.logger.debug(`Cleared cache key: ${key}`);
			}

			this.logger.debug(`Cleared ${keysToDelete.length} tracking cache keys`);
		} catch (error) {
			this.logger.error('Error clearing tracking cache:', error.message);
		}
	}

	// ======================================================
	// TRACKING MANAGEMENT
	// ======================================================

	/**
	 * Create a new tracking point for a user
	 * Includes location validation, geocoding, and organization/branch scoping
	 * @param createTrackingDto - Tracking data including coordinates and user info
	 * @param branchId - Optional branch ID for scoping
	 * @param orgId - Optional organization ID for scoping
	 * @returns Success message with tracking data
	 * 
	 * @example
	 * ```typescript
	 * const trackingPoint = await trackingService.create({
	 *   userId: 123,
	 *   latitude: -26.2041,
	 *   longitude: 28.0473,
	 *   accuracy: 5,
	 *   speed: 0,
	 *   heading: 0,
	 *   timestamp: new Date()
	 * }, 1, 1);
	 * ```
	 */
	async create(createTrackingDto: CreateTrackingDto, branchId?: string | number | null, orgId?: string | number | null) {
		const startTime = Date.now();
		this.logger.log(
			    `Creating tracking point for user: ${createTrackingDto.owner} ${orgId ? `in org: ${orgId}` : ''} ${branchId ? `in branch: ${branchId}` : ''}`
		);

		try {
			// Validate input data
			this.logger.debug('Validating tracking data');
			if (!createTrackingDto.owner) {
				throw new BadRequestException('User ID is required for tracking');
			}

			// Extract coordinates from the DTO - handle both formats
			let latitude = createTrackingDto.latitude;
			let longitude = createTrackingDto.longitude;

			// If the data comes in the new format with coords object (from mobile app)
			if ((!latitude || !longitude) && createTrackingDto['coords']) {
				this.logger.debug('Extracting coordinates from coords object');
				const coords = createTrackingDto['coords'] as any;
				latitude = coords.latitude;
				longitude = coords.longitude;

				// Update the DTO with extracted values
				createTrackingDto.latitude = latitude;
				createTrackingDto.longitude = longitude;

				// Map other coordinate properties if they exist
				if (coords.accuracy !== undefined) createTrackingDto.accuracy = coords.accuracy;
				if (coords.altitude !== undefined) createTrackingDto.altitude = coords.altitude;
				if (coords.altitudeAccuracy !== undefined) createTrackingDto.altitudeAccuracy = coords.altitudeAccuracy;
				if (coords.heading !== undefined) createTrackingDto.heading = coords.heading;
				if (coords.speed !== undefined) createTrackingDto.speed = coords.speed;
			}

			// Now validate that we have coordinates after extraction
			if (!latitude || !longitude) {
				this.logger.error('Missing coordinates after extraction', {
					hasLatitude: !!latitude,
					hasLongitude: !!longitude,
					hasCoords: !!createTrackingDto['coords'],
					dtoKeys: Object.keys(createTrackingDto)
				});
				throw new BadRequestException('Latitude and longitude are required');
			}

			// Validate coordinates are within reasonable ranges
			if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
				throw new BadRequestException('Invalid coordinates provided');
			}

			this.logger.debug(`Processing coordinates: ${latitude}, ${longitude} with accuracy: ${createTrackingDto.accuracy || 'unknown'}`);

			// Get address from coordinates with retries and fallback
			this.logger.debug('Attempting to geocode coordinates');
			const { address, error: geocodingError } = await this.getAddressFromCoordinates(latitude, longitude);
			
			if (geocodingError) {
				this.logger.warn(`Geocoding failed for coordinates ${latitude}, ${longitude}: ${geocodingError}`);
			} else {
				this.logger.debug(`Successfully geocoded to address: ${address}`);
			}

			// Extract owner ID before creating tracking data
			const ownerId = createTrackingDto.owner;
			if (!ownerId) {
				throw new BadRequestException('Owner ID is required for tracking');
			}

			// Validate user exists and has access
			this.logger.debug(`Validating user access for user: ${ownerId}`);
			const userExists = await this.userRepository.findOne({
				where: { uid: ownerId },
				relations: ['organisation', 'branch'],
			});

			if (!userExists) {
				throw new BadRequestException(`User with ID ${ownerId} not found`);
			}

			// Create a new object without the owner property
			const { owner, ...trackingDataWithoutOwner } = createTrackingDto;

			// Create tracking entity with all available data
			const trackingData: DeepPartial<Tracking> = {
				...trackingDataWithoutOwner,
				address,
				addressDecodingError: geocodingError || null,
				// Store raw coordinates as fallback
				rawLocation: `${latitude},${longitude}`,
				// Set owner as a reference to User entity
				owner: { uid: ownerId } as any,
			};

			// Add branch and organization if provided (with validation)
			if (branchId) {
				trackingData.branch = { uid: Number(branchId) } as any;
				this.logger.debug(`Adding branch filter: ${branchId}`);
			}

			if (orgId) {
				trackingData.organisation = { uid: Number(orgId) } as any;
				this.logger.debug(`Adding organization filter: ${orgId}`);
			}

			this.logger.debug('Creating tracking entity in database');
			const tracking = this.trackingRepository.create(trackingData);
			await this.trackingRepository.save(tracking);

			// Clear cache for this user
			await this.clearTrackingCache(tracking.uid, ownerId);

			// Prepare response
			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Tracking point created successfully',
				data: tracking,
				warnings: geocodingError ? [{ type: 'GEOCODING_ERROR', message: geocodingError }] : [],
			};

			const executionTime = Date.now() - startTime;
			this.logger.log(`Tracking point created successfully for user: ${ownerId} in ${executionTime}ms`);

			return response;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				     `Failed to create tracking point for user: ${createTrackingDto.owner} after ${executionTime}ms. Error: ${error.message}`,
				error.stack
			);

			return {
				message: error?.message || 'Failed to create tracking point',
				tracking: null,
				warnings: [],
			};
		}
	}

	/**
	 * Get tracking points for a specific user within a timeframe
	 * Supports various timeframe options: today, yesterday, this_week, last_week, this_month, last_month, or custom date range
	 * @param userId - User ID to get tracking points for
	 * @param timeframe - Time period to fetch data for
	 * @param startDate - Custom start date (required if timeframe is 'custom')
	 * @param endDate - Custom end date (required if timeframe is 'custom')
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Tracking points with location analysis and trip statistics
	 * 
	 * @example
	 * ```typescript
	 * // Get today's tracking points
	 * const todayData = await trackingService.getTrackingPointsByUserAndTimeframe(123, 'today');
	 * 
	 * // Get last week's data
	 * const lastWeekData = await trackingService.getTrackingPointsByUserAndTimeframe(123, 'last_week');
	 * 
	 * // Get custom date range
	 * const customData = await trackingService.getTrackingPointsByUserAndTimeframe(
	 *   123, 'custom', new Date('2023-12-01'), new Date('2023-12-31')
	 * );
	 * ```
	 */
	async getTrackingPointsByUserAndTimeframe(
		userId: number,
		timeframe: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom',
		startDate?: Date,
		endDate?: Date,
		orgId?: number,
		branchId?: number
	): Promise<{
		message: string;
		data: {
			user: any;
			timeframe: string;
			period: { start: Date; end: Date };
			totalPoints: number;
			trackingPoints: Tracking[];
			analytics: {
				totalDistance: number;
				averageSpeed: number;
				topSpeed: number;
				timeSpentMoving: number;
				timeSpentStationary: number;
				locationsVisited: number;
				mostVisitedLocation: string | null;
			};
			tripSummary: {
				totalTrips: number;
				averageTripDuration: number;
				longestTrip: number;
				shortestTrip: number;
			};
		} | null;
	}> {
		const startTime = Date.now();
		this.logger.log(`Getting tracking points for user: ${userId}, timeframe: ${timeframe}`);

		try {
			// Validate user ID
			if (!userId || userId <= 0) {
				throw new BadRequestException('Valid user ID is required');
			}

			// Calculate date range based on timeframe
			const dateRange = this.calculateDateRange(timeframe, startDate, endDate);
			this.logger.debug(`Calculated date range: ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);

			// Check cache first
			const cacheKey = this.getCacheKey(`user_${userId}_${timeframe}_${dateRange.start.getTime()}_${dateRange.end.getTime()}`);
			const cachedResult = await this.cacheManager.get(cacheKey);

			if (cachedResult) {
				this.logger.debug(`Retrieved tracking data from cache for user: ${userId}`);
				return cachedResult as any;
			}

			// Validate user exists
			this.logger.debug(`Validating user exists: ${userId}`);
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation', 'branch'],
			});

			if (!user) {
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			// Build query conditions
			const whereConditions: any = {
				owner: { uid: userId },
				timestamp: Between(dateRange.start, dateRange.end),
			};

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
				this.logger.debug(`Added organization filter: ${orgId}`);
			}

			// Add branch filter if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
				this.logger.debug(`Added branch filter: ${branchId}`);
			}

			this.logger.debug('Querying tracking points from database');
			const trackingPoints = await this.trackingRepository.find({
				where: whereConditions,
				relations: ['owner', 'owner.branch', 'owner.organisation'],
				order: { timestamp: 'ASC' },
			});

			this.logger.debug(`Found ${trackingPoints.length} tracking points for user: ${userId}`);

			// Calculate analytics
			const analytics = this.calculateTrackingAnalytics(trackingPoints);
			const tripSummary = this.calculateTripSummary(trackingPoints);

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Tracking data retrieved successfully',
				data: {
					user: {
						uid: user.uid,
						name: user.name,
						surname: user.surname,
						email: user.email,
						branch: user.branch?.name,
						organisation: user.organisation?.name,
					},
					timeframe,
					period: dateRange,
					totalPoints: trackingPoints.length,
					trackingPoints,
					analytics,
					tripSummary,
				},
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);

			const executionTime = Date.now() - startTime;
			this.logger.log(`Successfully retrieved tracking data for user: ${userId} in ${executionTime}ms`);

			return response;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to get tracking points for user: ${userId} after ${executionTime}ms. Error: ${error.message}`,
				error.stack
			);

			return {
				message: error?.message || 'Failed to retrieve tracking data',
				data: null,
			};
		}
	}

	/**
	 * Get tracking points for multiple users within a timeframe
	 * Useful for organizational reporting and fleet management
	 * @param userIds - Array of user IDs to get tracking points for
	 * @param timeframe - Time period to fetch data for
	 * @param startDate - Custom start date (required if timeframe is 'custom')
	 * @param endDate - Custom end date (required if timeframe is 'custom')
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Aggregated tracking data for all specified users
	 * 
	 * @example
	 * ```typescript
	 * // Get today's tracking for multiple users
	 * const teamData = await trackingService.getTrackingPointsForMultipleUsers(
	 *   [123, 124, 125], 'today'
	 * );
	 * ```
	 */
	async getTrackingPointsForMultipleUsers(
		userIds: number[],
		timeframe: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom',
		startDate?: Date,
		endDate?: Date,
		orgId?: number,
		branchId?: number
	): Promise<{
		message: string;
		data: {
			timeframe: string;
			period: { start: Date; end: Date };
			totalUsers: number;
			totalPoints: number;
			users: Array<{
				user: any;
				trackingPoints: Tracking[];
				analytics: any;
			}>;
			organizationSummary: {
				totalDistance: number;
				averagePointsPerUser: number;
				mostActiveUser: any;
				leastActiveUser: any;
			};
		} | null;
	}> {
		const startTime = Date.now();
		this.logger.log(`Getting tracking points for ${userIds.length} users, timeframe: ${timeframe}`);

		try {
			// Validate input
			if (!userIds || userIds.length === 0) {
				throw new BadRequestException('At least one user ID is required');
			}

			if (userIds.length > 100) {
				throw new BadRequestException('Maximum of 100 users can be processed at once');
			}

			const dateRange = this.calculateDateRange(timeframe, startDate, endDate);
			this.logger.debug(`Processing ${userIds.length} users for date range: ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);

			const userDataPromises = userIds.map(userId => 
				this.getTrackingPointsByUserAndTimeframe(userId, timeframe, startDate, endDate, orgId, branchId)
			);

			const userDataResults = await Promise.allSettled(userDataPromises);

			const successfulResults = userDataResults
				.filter(result => result.status === 'fulfilled' && result.value.data)
				.map(result => (result as any).value.data);

			if (successfulResults.length === 0) {
				return {
					message: 'No tracking data found for any of the specified users',
					data: null,
				};
			}

			// Calculate organization summary
			const organizationSummary = this.calculateOrganizationSummary(successfulResults);

			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Multi-user tracking data retrieved successfully',
				data: {
					timeframe,
					period: dateRange,
					totalUsers: successfulResults.length,
					totalPoints: successfulResults.reduce((sum, userData) => sum + userData.totalPoints, 0),
					users: successfulResults.map(userData => ({
						user: userData.user,
						trackingPoints: userData.trackingPoints,
						analytics: userData.analytics,
					})),
					organizationSummary,
				},
			};

			const executionTime = Date.now() - startTime;
			this.logger.log(`Successfully retrieved multi-user tracking data for ${successfulResults.length}/${userIds.length} users in ${executionTime}ms`);

			return response;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to get multi-user tracking points after ${executionTime}ms. Error: ${error.message}`,
				error.stack
			);

			return {
				message: error?.message || 'Failed to retrieve multi-user tracking data',
				data: null,
			};
		}
	}

	/**
	 * Calculate date range based on timeframe parameter
	 * @param timeframe - The timeframe type
	 * @param customStartDate - Custom start date for 'custom' timeframe
	 * @param customEndDate - Custom end date for 'custom' timeframe
	 * @returns Start and end dates for the timeframe
	 */
	private calculateDateRange(
		timeframe: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom',
		customStartDate?: Date,
		customEndDate?: Date
	): { start: Date; end: Date } {
		const now = new Date();

		switch (timeframe) {
			case 'today':
				return {
					start: startOfDay(now),
					end: endOfDay(now),
				};

			case 'yesterday':
				const yesterday = subDays(now, 1);
				return {
					start: startOfDay(yesterday),
					end: endOfDay(yesterday),
				};

			case 'this_week':
				return {
					start: startOfWeek(now),
					end: endOfWeek(now),
				};

			case 'last_week':
				const lastWeekStart = subDays(startOfWeek(now), 7);
				const lastWeekEnd = subDays(endOfWeek(now), 7);
				return {
					start: lastWeekStart,
					end: lastWeekEnd,
				};

			case 'this_month':
				return {
					start: startOfMonth(now),
					end: endOfMonth(now),
				};

			case 'last_month':
				const lastMonth = subDays(startOfMonth(now), 1);
				return {
					start: startOfMonth(lastMonth),
					end: endOfMonth(lastMonth),
				};

			case 'custom':
				if (!customStartDate || !customEndDate) {
					throw new BadRequestException('Start date and end date are required for custom timeframe');
				}
				if (customStartDate > customEndDate) {
					throw new BadRequestException('Start date cannot be after end date');
				}
				return {
					start: startOfDay(customStartDate),
					end: endOfDay(customEndDate),
				};

			default:
				throw new BadRequestException(`Unsupported timeframe: ${timeframe}`);
		}
	}

	/**
	 * Calculate analytics for tracking points
	 * @param trackingPoints - Array of tracking points to analyze
	 * @returns Analytics object with distance, speed, and location data
	 */
	private calculateTrackingAnalytics(trackingPoints: Tracking[]): {
		totalDistance: number;
		averageSpeed: number;
		topSpeed: number;
		timeSpentMoving: number;
		timeSpentStationary: number;
		locationsVisited: number;
		mostVisitedLocation: string | null;
	} {
		if (trackingPoints.length === 0) {
			return {
				totalDistance: 0,
				averageSpeed: 0,
				topSpeed: 0,
				timeSpentMoving: 0,
				timeSpentStationary: 0,
				locationsVisited: 0,
				mostVisitedLocation: null,
			};
		}

		let totalDistance = 0;
		let totalSpeed = 0;
		let topSpeed = 0;
		let timeSpentMoving = 0;
		let timeSpentStationary = 0;
		const locations = new Map<string, number>();

		for (let i = 0; i < trackingPoints.length; i++) {
			const point = trackingPoints[i];
			const speed = point.speed || 0;

			// Track top speed
			if (speed > topSpeed) {
				topSpeed = speed;
			}

			// Accumulate speed for average
			totalSpeed += speed;

			// Track locations
			if (point.address) {
				locations.set(point.address, (locations.get(point.address) || 0) + 1);
			}

			// Calculate distance between consecutive points
			if (i > 0) {
				const prevPoint = trackingPoints[i - 1];
				const distance = LocationUtils.calculateDistance(
					prevPoint.latitude,
					prevPoint.longitude,
					point.latitude,
					point.longitude
				);
				totalDistance += distance;

				// Calculate time difference
				const timeDiff = new Date(point.timestamp).getTime() - new Date(prevPoint.timestamp).getTime();
				const timeDiffMinutes = timeDiff / (1000 * 60);

				// Classify as moving or stationary based on speed
				if (speed > 1) { // Moving if speed > 1 km/h
					timeSpentMoving += timeDiffMinutes;
				} else {
					timeSpentStationary += timeDiffMinutes;
				}
			}
		}

		// Find most visited location
		let mostVisitedLocation: string | null = null;
		let maxVisits = 0;
		for (const [location, visits] of locations) {
			if (visits > maxVisits) {
				maxVisits = visits;
				mostVisitedLocation = location;
			}
		}

		return {
			totalDistance: Math.round(totalDistance * 100) / 100, // Round to 2 decimal places
			averageSpeed: trackingPoints.length > 0 ? Math.round((totalSpeed / trackingPoints.length) * 100) / 100 : 0,
			topSpeed: Math.round(topSpeed * 100) / 100,
			timeSpentMoving: Math.round(timeSpentMoving),
			timeSpentStationary: Math.round(timeSpentStationary),
			locationsVisited: locations.size,
			mostVisitedLocation,
		};
	}

	/**
	 * Calculate trip summary from tracking points
	 * @param trackingPoints - Array of tracking points to analyze
	 * @returns Trip summary with trip count and duration statistics
	 */
	private calculateTripSummary(trackingPoints: Tracking[]): {
		totalTrips: number;
		averageTripDuration: number;
		longestTrip: number;
		shortestTrip: number;
	} {
		if (trackingPoints.length === 0) {
			return {
				totalTrips: 0,
				averageTripDuration: 0,
				longestTrip: 0,
				shortestTrip: 0,
			};
		}

		// Detect trips by analyzing stops and movements
		const trips: Array<{ start: Date; end: Date; duration: number }> = [];
		let currentTripStart: Date | null = null;
		const STATIONARY_THRESHOLD = 2; // Speed threshold for considering stationary (km/h)
		const STOP_DURATION_THRESHOLD = 5; // Minimum stop duration to end a trip (minutes)

		for (let i = 0; i < trackingPoints.length; i++) {
			const point = trackingPoints[i];
			const speed = point.speed || 0;
			const timestamp = new Date(point.timestamp);

			if (speed > STATIONARY_THRESHOLD) {
				// Moving - start trip if not already started
				if (!currentTripStart) {
					currentTripStart = timestamp;
				}
			} else {
				// Stationary - potentially end trip
				if (currentTripStart) {
					// Check if we've been stationary long enough
					let stationaryDuration = 0;
					for (let j = i; j < trackingPoints.length; j++) {
						const futurePoint = trackingPoints[j];
						if ((futurePoint.speed || 0) <= STATIONARY_THRESHOLD) {
							if (j === trackingPoints.length - 1) {
								// End of data
								stationaryDuration = (new Date(futurePoint.timestamp).getTime() - timestamp.getTime()) / (1000 * 60);
								break;
							}
						} else {
							// Moving again
							stationaryDuration = (new Date(futurePoint.timestamp).getTime() - timestamp.getTime()) / (1000 * 60);
							break;
						}
					}

					if (stationaryDuration >= STOP_DURATION_THRESHOLD || i === trackingPoints.length - 1) {
						// End the current trip
						const tripDuration = (timestamp.getTime() - currentTripStart.getTime()) / (1000 * 60);
						trips.push({
							start: currentTripStart,
							end: timestamp,
							duration: tripDuration,
						});
						currentTripStart = null;
					}
				}
			}
		}

		// Close any ongoing trip at the end
		if (currentTripStart && trackingPoints.length > 0) {
			const lastPoint = trackingPoints[trackingPoints.length - 1];
			const tripDuration = (new Date(lastPoint.timestamp).getTime() - currentTripStart.getTime()) / (1000 * 60);
			trips.push({
				start: currentTripStart,
				end: new Date(lastPoint.timestamp),
				duration: tripDuration,
			});
		}

		if (trips.length === 0) {
			return {
				totalTrips: 0,
				averageTripDuration: 0,
				longestTrip: 0,
				shortestTrip: 0,
			};
		}

		const durations = trips.map(trip => trip.duration);
		const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
		const averageDuration = totalDuration / trips.length;
		const longestTrip = Math.max(...durations);
		const shortestTrip = Math.min(...durations);

		return {
			totalTrips: trips.length,
			averageTripDuration: Math.round(averageDuration),
			longestTrip: Math.round(longestTrip),
			shortestTrip: Math.round(shortestTrip),
		};
	}

	/**
	 * Calculate organization-level summary for multiple users
	 * @param userDataArray - Array of user tracking data
	 * @returns Organization summary with aggregated statistics
	 */
	private calculateOrganizationSummary(userDataArray: any[]): {
		totalDistance: number;
		averagePointsPerUser: number;
		mostActiveUser: any;
		leastActiveUser: any;
	} {
		if (userDataArray.length === 0) {
			return {
				totalDistance: 0,
				averagePointsPerUser: 0,
				mostActiveUser: null,
				leastActiveUser: null,
			};
		}

		const totalDistance = userDataArray.reduce((sum, userData) => sum + userData.analytics.totalDistance, 0);
		const totalPoints = userDataArray.reduce((sum, userData) => sum + userData.totalPoints, 0);
		const averagePointsPerUser = Math.round(totalPoints / userDataArray.length);

		// Find most and least active users
		const sortedByPoints = [...userDataArray].sort((a, b) => b.totalPoints - a.totalPoints);
		const mostActiveUser = sortedByPoints[0]?.user || null;
		const leastActiveUser = sortedByPoints[sortedByPoints.length - 1]?.user || null;

		return {
			totalDistance: Math.round(totalDistance * 100) / 100,
			averagePointsPerUser,
			mostActiveUser,
			leastActiveUser,
		};
	}

	private async getAddressFromCoordinates(
		latitude: number,
		longitude: number,
	): Promise<{ address: string | null; error?: string }> {
		const MAX_RETRIES = 3;
		const RETRY_DELAY = 1000; // 1 second

		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				if (!this.geocodingApiKey) {
					return {
						address: null,
						error: 'Geocoding API key not configured',
					};
				}

				const response = await axios.get(
					`https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${this.geocodingApiKey}`,
					{ timeout: 5000 }, // 5 second timeout
				);

				if (response.data.status === 'ZERO_RESULTS') {
					return {
						address: null,
						error: 'No address found for these coordinates',
					};
				}

				if (response.data.status !== 'OK') {
					return {
						address: null,
						error: `Geocoding API error: ${response.data.status}`,
					};
				}

				if (response.data.results && response.data.results.length > 0) {
					return {
						address: response.data.results[0].formatted_address,
					};
				}

				return {
					address: null,
					error: 'No results in geocoding response',
				};
			} catch (error) {
				const isLastAttempt = attempt === MAX_RETRIES;

				if (error.response?.status === 429) {
					// Rate limit error
					if (!isLastAttempt) {
						await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * attempt));
						continue;
					}
					return {
						address: null,
						error: 'Geocoding API rate limit exceeded',
					};
				}

				if (isLastAttempt) {
					return {
						address: null,
						error: `Geocoding failed: ${error.message}`,
					};
				}

				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * attempt));
			}
		}

		return {
			address: null,
			error: 'Max retries exceeded for geocoding request',
		};
	}

	async getDailyTracking(userId: number, date: Date = new Date()) {
		try {
			const trackingPoints = await this.trackingRepository.find({
				where: {
					owner: { uid: userId },
					createdAt: Between(startOfDay(date), endOfDay(date)),
				},
				order: {
					createdAt: 'ASC',
				},
			});

			if (!trackingPoints.length) {
				return {
					message: 'No tracking data found for the specified date',
					data: null,
				};
			}

			// Enhanced trip analysis
			const tripAnalysis = this.generateTripAnalysis(trackingPoints);
			const stopAnalysis = this.detectAndAnalyzeStops(trackingPoints);

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: {
					totalDistance: tripAnalysis.formattedDistance,
					trackingPoints,
					locationAnalysis: {
						locationsVisited: stopAnalysis.locations,
						averageTimePerLocation: stopAnalysis.averageTimeFormatted,
						averageTimePerLocationMinutes: stopAnalysis.averageTimeMinutes,
						timeSpentByLocation: tripAnalysis.locationTimeSpent,
						averageTimePerLocationFormatted: LocationUtils.formatDuration(stopAnalysis.averageTimeMinutes),
					},
					tripSummary: {
						totalDistanceKm: tripAnalysis.totalDistanceKm,
						totalTimeMinutes: tripAnalysis.totalTimeMinutes,
						averageSpeedKmh: tripAnalysis.averageSpeedKmh,
						movingTimeMinutes: tripAnalysis.movingTimeMinutes,
						stoppedTimeMinutes: tripAnalysis.stoppedTimeMinutes,
						numberOfStops: stopAnalysis.stops.length,
						maxSpeedKmh: tripAnalysis.maxSpeedKmh,
					},
					stops: stopAnalysis.stops,
				},
			};
		} catch (error) {
			return {
				message: error.message,
				data: null,
			};
		}
	}

	private calculateTimeSpentAtLocations(trackingPoints: Tracking[]) {
		const locationMap = new Map<string, number>();

		for (let i = 0; i < trackingPoints.length - 1; i++) {
			const currentPoint = trackingPoints[i];
			const nextPoint = trackingPoints[i + 1];
			const timeSpent =
				(new Date(nextPoint.createdAt).getTime() - new Date(currentPoint.createdAt).getTime()) / 1000 / 60; // in minutes

			if (currentPoint.address) {
				locationMap.set(currentPoint.address, (locationMap.get(currentPoint.address) || 0) + timeSpent);
			}
		}

		return Object.fromEntries(locationMap);
	}

	private calculateAverageTimePerLocation(locationTimeSpent: Record<string, number>): number {
		const locations = Object.values(locationTimeSpent);
		if (!locations.length) return 0;
		return locations.reduce((sum, time) => sum + time, 0) / locations.length;
	}

	async findAll(): Promise<{ tracking: Tracking[] | null; message: string }> {
		try {
			const tracking = await this.trackingRepository.find({
				where: {
					deletedAt: IsNull(),
				},
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				tracking: tracking,
			};

			return response;
		} catch (error) {
			const response = {
				message: error.message,
				tracking: null,
			};

			return response;
		}
	}

	async findOne(ref: number): Promise<{ tracking: Tracking | null; message: string }> {
		try {
			const tracking = await this.trackingRepository.findOne({
				where: {
					uid: ref,
					deletedAt: IsNull(),
				},
				relations: ['branch', 'owner'],
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				tracking: tracking,
			};

			return response;
		} catch (error) {
			const response = {
				message: error.message,
				tracking: null,
			};

			return response;
		}
	}

	public async trackingByUser(ref: number): Promise<{ message: string; tracking: Tracking[] }> {
		try {
			const tracking = await this.trackingRepository.find({
				where: { owner: { uid: ref } },
			});

			if (!tracking) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				tracking,
			};

			return response;
		} catch (error) {
			const response = {
				message: `could not get tracking by user - ${error?.message}`,
				tracking: null,
			};

			return response;
		}
	}

	async update(ref: number, updateTrackingDto: UpdateTrackingDto) {
		try {
			await this.trackingRepository.update(ref, updateTrackingDto as unknown as DeepPartial<Tracking>);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error.message,
			};

			return response;
		}
	}

	async remove(ref: number): Promise<{ message: string }> {
		try {
			await this.trackingRepository.update(ref, {
				deletedAt: new Date(),
				deletedBy: 'system',
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error.message,
			};

			return response;
		}
	}

	async restore(ref: number): Promise<{ message: string }> {
		try {
			await this.trackingRepository.update(ref, {
				deletedAt: null,
				deletedBy: null,
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error.message,
			};

			return response;
		}
	}

	async createStopEvent(
		stopData: {
			latitude: number;
			longitude: number;
			startTime: number;
			endTime: number;
			duration: number;
			address?: string;
		},
		userId: number,
	) {
		try {
			// If no address is provided, try to get it from coordinates
			if (!stopData.address) {
				const { address } = await this.getAddressFromCoordinates(stopData.latitude, stopData.longitude);

				if (address) {
					stopData.address = address;
				}
			}

			// Get user information to extract branch and organization
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['branch', 'organisation']
			});

			// Create a tracking record for the stop
			const tracking = this.trackingRepository.create({
				latitude: stopData.latitude,
				longitude: stopData.longitude,
				owner: { uid: userId },
				address: stopData.address,
				// Store raw coordinates as fallback
				rawLocation: `${stopData.latitude},${stopData.longitude}`,
				// Add stop-specific data
				metadata: {
					isStop: true,
					startTime: new Date(stopData.startTime).toISOString(),
					endTime: new Date(stopData.endTime).toISOString(),
					durationMinutes: Math.round(stopData.duration / 60000), // Convert ms to minutes
				},
				// Add branch and organization if available from user
				branch: user?.branch ? { uid: user.branch.uid } : undefined,
				organisation: user?.organisation ? { uid: user.organisation.uid } : undefined,
			} as DeepPartial<Tracking>);

			await this.trackingRepository.save(tracking);

			return {
				message: 'Stop event recorded successfully',
				data: tracking,
			};
		} catch (error) {
			return {
				message: `Failed to record stop event: ${error.message}`,
				data: null,
			};
		}
	}

	async getUserStops(userId: number) {
		try {
			// Use raw query to find records with stop metadata
			const stops = await this.trackingRepository.find({
				where: {
					owner: { uid: userId },
					deletedAt: IsNull(),
				},
			});

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: stops,
			};
		} catch (error) {
			return {
				message: `Failed to get user stops: ${error.message}`,
				data: null,
			};
		}
	}

	/**
	 * Enhanced trip analysis with comprehensive metrics
	 */
	private generateTripAnalysis(trackingPoints: Tracking[]) {
		const totalDistanceKm = LocationUtils.calculateTotalDistance(trackingPoints);
		const formattedDistance = LocationUtils.formatDistance(totalDistanceKm);
		
		if (trackingPoints.length < 2) {
			return {
				totalDistanceKm: 0,
				formattedDistance: '0 km',
				totalTimeMinutes: 0,
				averageSpeedKmh: 0,
				movingTimeMinutes: 0,
				stoppedTimeMinutes: 0,
				maxSpeedKmh: 0,
				locationTimeSpent: {},
			};
		}

		// Calculate time metrics
		const startTime = new Date(trackingPoints[0].createdAt).getTime();
		const endTime = new Date(trackingPoints[trackingPoints.length - 1].createdAt).getTime();
		const totalTimeMinutes = (endTime - startTime) / (1000 * 60);

		// Calculate speeds and movement analysis
		let movingTimeMinutes = 0;
		let maxSpeedKmh = 0;
		const locationTimeSpent = new Map<string, number>();

		for (let i = 1; i < trackingPoints.length; i++) {
			const prevPoint = trackingPoints[i - 1];
			const currentPoint = trackingPoints[i];
			
			const timeIntervalMs = new Date(currentPoint.createdAt).getTime() - new Date(prevPoint.createdAt).getTime();
			const timeIntervalMinutes = timeIntervalMs / (1000 * 60);
			const timeIntervalHours = timeIntervalMinutes / 60;

			// Calculate distance between points
			const segmentDistance = LocationUtils.calculateDistance(
				prevPoint.latitude,
				prevPoint.longitude,
				currentPoint.latitude,
				currentPoint.longitude
			);

			// Calculate speed for this segment
			const speedKmh = timeIntervalHours > 0 ? segmentDistance / timeIntervalHours : 0;
			
			// Track max speed
			if (speedKmh > maxSpeedKmh) {
				maxSpeedKmh = speedKmh;
			}

			// Determine if this segment represents movement (speed > 1 km/h threshold)
			const isMoving = speedKmh > 1;
			if (isMoving) {
				movingTimeMinutes += timeIntervalMinutes;
			}

			// Track time spent at each location
			if (prevPoint.address) {
				const currentTime = locationTimeSpent.get(prevPoint.address) || 0;
				locationTimeSpent.set(prevPoint.address, currentTime + timeIntervalMinutes);
			}
		}

		const stoppedTimeMinutes = totalTimeMinutes - movingTimeMinutes;
		const averageSpeedKmh = movingTimeMinutes > 0 ? (totalDistanceKm / (movingTimeMinutes / 60)) : 0;

		return {
			totalDistanceKm,
			formattedDistance,
			totalTimeMinutes: Math.round(totalTimeMinutes),
			averageSpeedKmh: Math.round(averageSpeedKmh * 10) / 10,
			movingTimeMinutes: Math.round(movingTimeMinutes),
			stoppedTimeMinutes: Math.round(stoppedTimeMinutes),
			maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10,
			locationTimeSpent: Object.fromEntries(locationTimeSpent),
		};
	}

	/**
	 * Advanced stop detection and analysis
	 */
	private detectAndAnalyzeStops(trackingPoints: Tracking[]) {
		const STOP_RADIUS_METERS = 50; // 50 meter radius
		const MIN_STOP_DURATION_MINUTES = 3; // Minimum 3 minutes to be considered a stop
		
		if (trackingPoints.length < 2) {
			return {
				stops: [],
				locations: [],
				averageTimeMinutes: 0,
				averageTimeFormatted: '0m',
			};
		}

		const stops = [];
		const locations = [];
		let currentStop = null;

		for (let i = 0; i < trackingPoints.length; i++) {
			const point = trackingPoints[i];
			
			if (!currentStop) {
				// Start a potential new stop
				currentStop = {
					startIndex: i,
					endIndex: i,
					latitude: point.latitude,
					longitude: point.longitude,
					address: point.address || `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`,
					startTime: new Date(point.createdAt),
					endTime: new Date(point.createdAt),
					points: [point],
				};
				continue;
			}

			// Calculate distance from current stop center
			const distanceFromStopCenter = LocationUtils.calculateDistance(
				currentStop.latitude,
				currentStop.longitude,
				point.latitude,
				point.longitude
			) * 1000; // Convert to meters

			if (distanceFromStopCenter <= STOP_RADIUS_METERS) {
				// Point is within stop radius - extend current stop
				currentStop.endIndex = i;
				currentStop.endTime = new Date(point.createdAt);
				currentStop.points.push(point);
				
				// Update stop center to be more accurate (weighted average)
				const totalPoints = currentStop.points.length;
				currentStop.latitude = (currentStop.latitude * (totalPoints - 1) + point.latitude) / totalPoints;
				currentStop.longitude = (currentStop.longitude * (totalPoints - 1) + point.longitude) / totalPoints;
				
				// Use the most recent address if available
				if (point.address) {
					currentStop.address = point.address;
				}
			} else {
				// Point is outside stop radius - finalize current stop and start new one
				const stopDurationMinutes = (currentStop.endTime.getTime() - currentStop.startTime.getTime()) / (1000 * 60);
				
				if (stopDurationMinutes >= MIN_STOP_DURATION_MINUTES) {
					stops.push({
						latitude: currentStop.latitude,
						longitude: currentStop.longitude,
						address: currentStop.address,
						startTime: currentStop.startTime,
						endTime: currentStop.endTime,
						durationMinutes: Math.round(stopDurationMinutes),
						durationFormatted: LocationUtils.formatDuration(Math.round(stopDurationMinutes)),
						pointsCount: currentStop.points.length,
					});

					// Add to locations list for summary
					locations.push({
						address: currentStop.address,
						latitude: currentStop.latitude,
						longitude: currentStop.longitude,
						timeSpentMinutes: Math.round(stopDurationMinutes),
						timeSpentFormatted: LocationUtils.formatDuration(Math.round(stopDurationMinutes)),
					});
				}

				// Start new potential stop
				currentStop = {
					startIndex: i,
					endIndex: i,
					latitude: point.latitude,
					longitude: point.longitude,
					address: point.address || `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`,
					startTime: new Date(point.createdAt),
					endTime: new Date(point.createdAt),
					points: [point],
				};
			}
		}

		// Handle final stop if it exists
		if (currentStop) {
			const stopDurationMinutes = (currentStop.endTime.getTime() - currentStop.startTime.getTime()) / (1000 * 60);
			
			if (stopDurationMinutes >= MIN_STOP_DURATION_MINUTES) {
				stops.push({
					latitude: currentStop.latitude,
					longitude: currentStop.longitude,
					address: currentStop.address,
					startTime: currentStop.startTime,
					endTime: currentStop.endTime,
					durationMinutes: Math.round(stopDurationMinutes),
					durationFormatted: LocationUtils.formatDuration(Math.round(stopDurationMinutes)),
					pointsCount: currentStop.points.length,
				});

				locations.push({
					address: currentStop.address,
					latitude: currentStop.latitude,
					longitude: currentStop.longitude,
					timeSpentMinutes: Math.round(stopDurationMinutes),
					timeSpentFormatted: LocationUtils.formatDuration(Math.round(stopDurationMinutes)),
				});
			}
		}

		// Calculate average time per location
		const totalTimeMinutes = locations.reduce((sum, loc) => sum + loc.timeSpentMinutes, 0);
		const averageTimeMinutes = locations.length > 0 ? Math.round(totalTimeMinutes / locations.length) : 0;

		return {
			stops,
			locations,
			averageTimeMinutes,
			averageTimeFormatted: LocationUtils.formatDuration(averageTimeMinutes),
		};
	}
}
