import { Injectable, NotFoundException, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { CreateTrackingDto } from './dto/create-tracking.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Tracking } from './entities/tracking.entity';
import { DeepPartial, Repository, IsNull, Between, MoreThanOrEqual, Raw } from 'typeorm';
import { LocationUtils } from '../lib/utils/location.utils';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns';
import axios from 'axios';
import { User } from '../user/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { 
	EnhancedTrackingResult, 
} from './interfaces/enhanced-tracking.interface';
import { ReportsService } from '../reports/reports.service';
import { GoogleMapsService, TrackingPoint } from '../lib/services/google-maps.service';

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
		@Inject(forwardRef(() => ReportsService))
		private reportsService: ReportsService,
		private googleMapsService: GoogleMapsService,
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
	 * Check if coordinates represent a virtual/fake location
	 * Virtual locations contain '122' in either latitude or longitude
	 * @param latitude - Latitude coordinate
	 * @param longitude - Longitude coordinate
	 * @returns True if location is virtual/fake
	 */
	private isVirtualLocation(latitude: number, longitude: number): boolean {
		const latStr = Math.abs(latitude).toString();
		const lngStr = Math.abs(longitude).toString();
		
		// Check if either coordinate contains '122'
		const hasVirtualMarker = latStr.includes('122') || lngStr.includes('122');
		
		if (hasVirtualMarker) {
			this.logger.debug(`Virtual location detected: lat=${latitude}, lng=${longitude}`);
		}
		
		return hasVirtualMarker;
	}

	/**
	 * Check if GPS accuracy is acceptable for processing
	 * @param accuracy - GPS accuracy in meters
	 * @returns True if accuracy is acceptable (≤ 20 meters)
	 */
	private isAcceptableAccuracy(accuracy?: number): boolean {
		// If no accuracy provided, consider it potentially inaccurate
		if (accuracy === undefined || accuracy === null) {
			return false;
		}
		
		const ACCURACY_THRESHOLD_METERS = 20;
		const isAcceptable = accuracy <= ACCURACY_THRESHOLD_METERS;
		
		if (!isAcceptable) {
			this.logger.debug(`Low accuracy GPS point detected: ${accuracy}m (threshold: ${ACCURACY_THRESHOLD_METERS}m)`);
		}
		
		return isAcceptable;
	}

	/**
	 * Get TypeORM where conditions to exclude virtual locations
	 * @returns Object with latitude and longitude conditions to exclude virtual locations
	 */
	private getVirtualLocationFilters(): any {
		return {
			latitude: Raw(alias => `CAST(ABS(${alias}) AS TEXT) NOT LIKE '%122%'`),
			longitude: Raw(alias => `CAST(ABS(${alias}) AS TEXT) NOT LIKE '%122%'`),
		};
	}

	/**
	 * Filter out virtual locations from tracking points array
	 * @param trackingPoints - Array of tracking points
	 * @returns Filtered array without virtual locations
	 */
	private filterVirtualLocations(trackingPoints: Tracking[]): Tracking[] {
		return trackingPoints.filter(point => 
			point.latitude && 
			point.longitude && 
			!this.isVirtualLocation(point.latitude, point.longitude)
		);
	}

	/**
	 * Filter out tracking points with poor GPS accuracy
	 * @param trackingPoints - Array of tracking points
	 * @returns Object with filtered points and accuracy info
	 */
	private filterByAccuracy(trackingPoints: Tracking[]): {
		filteredPoints: Tracking[];
		originalCount: number;
		filteredCount: number;
		inaccurateCount: number;
		accuracyInfo: {
			hasAccuracy: number;
			noAccuracy: number;
			aboveThreshold: number;
		};
	} {
		const originalCount = trackingPoints.length;
		let hasAccuracy = 0;
		let noAccuracy = 0;
		let aboveThreshold = 0;

		const filteredPoints = trackingPoints.filter(point => {
			if (point.accuracy === undefined || point.accuracy === null) {
				noAccuracy++;
				return false; // Skip points with no accuracy data
			}

			hasAccuracy++;
			
			if (!this.isAcceptableAccuracy(point.accuracy)) {
				aboveThreshold++;
				return false; // Skip points with poor accuracy
			}

			return true; // Keep points with good accuracy
		});

		const filteredCount = filteredPoints.length;
		const inaccurateCount = originalCount - filteredCount;

		this.logger.debug(`Accuracy filtering: ${originalCount} -> ${filteredCount} points. ` +
			`Removed: ${inaccurateCount} (${noAccuracy} no accuracy, ${aboveThreshold} low accuracy)`);

		return {
			filteredPoints,
			originalCount,
			filteredCount,
			inaccurateCount,
			accuracyInfo: {
				hasAccuracy,
				noAccuracy,
				aboveThreshold,
			},
		};
	}

	/**
	 * Generate cache key with prefix
	 * @param key - Cache key suffix
	 * @returns Full cache key
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Check if user has exceeded the rate limit for tracking points
	 * Limits users to 2 tracking points per minute
	 * Uses atomic increment pattern to prevent race conditions
	 * @param userId - User ID to check
	 * @returns Object with isAllowed flag and remaining points
	 */
	private async checkRateLimit(userId: number): Promise<{ isAllowed: boolean; remaining: number; resetAt: Date }> {
		const RATE_LIMIT_KEY = `rate_limit:${userId}`;
		const MAX_POINTS_PER_MINUTE = 2;
		const WINDOW_MS = 60 * 1000; // 1 minute in milliseconds

		try {
			const cached = await this.cacheManager.get<{ count: number; resetAt: number }>(RATE_LIMIT_KEY);
			const now = Date.now();

			if (!cached) {
				// First request in the window - use atomic set
				await this.cacheManager.set(RATE_LIMIT_KEY, { count: 1, resetAt: now + WINDOW_MS }, WINDOW_MS);
				return {
					isAllowed: true,
					remaining: MAX_POINTS_PER_MINUTE - 1,
					resetAt: new Date(now + WINDOW_MS),
				};
			}

			// Check if window has expired
			if (now >= cached.resetAt) {
				// Window expired, start new window
				await this.cacheManager.set(RATE_LIMIT_KEY, { count: 1, resetAt: now + WINDOW_MS }, WINDOW_MS);
				return {
					isAllowed: true,
					remaining: MAX_POINTS_PER_MINUTE - 1,
					resetAt: new Date(now + WINDOW_MS),
				};
			}

			// Check if limit exceeded BEFORE incrementing (to prevent going over limit)
			if (cached.count >= MAX_POINTS_PER_MINUTE) {
				const remaining = 0;
				const resetAt = new Date(cached.resetAt);
				// Use debug level instead of warn to reduce log noise for expected rate limiting
				this.logger.debug(`Rate limit exceeded for user ${userId}. Limit: ${MAX_POINTS_PER_MINUTE} points per minute. Reset at: ${resetAt.toISOString()}`);
				return {
					isAllowed: false,
					remaining,
					resetAt,
				};
			}

			// Increment count atomically
			const newCount = cached.count + 1;
			const ttl = cached.resetAt - now;
			await this.cacheManager.set(RATE_LIMIT_KEY, { count: newCount, resetAt: cached.resetAt }, ttl);

			return {
				isAllowed: true,
				remaining: MAX_POINTS_PER_MINUTE - newCount,
				resetAt: new Date(cached.resetAt),
			};
		} catch (error) {
			this.logger.error(`Error checking rate limit for user ${userId}: ${error.message}`);
			// On error, allow the request but log it
			return {
				isAllowed: true,
				remaining: MAX_POINTS_PER_MINUTE - 1,
				resetAt: new Date(Date.now() + WINDOW_MS),
			};
		}
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
			}
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
			if (!createTrackingDto.owner) {
				throw new BadRequestException('User ID is required for tracking');
			}

			// Extract coordinates from the DTO - handle both formats
			let latitude = createTrackingDto.latitude;
			let longitude = createTrackingDto.longitude;

			// If the data comes in the new format with coords object (from mobile app)
			if ((!latitude || !longitude) && createTrackingDto['coords']) {
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

			// Skip virtual locations (coordinates containing '122' indicate virtual/test locations)
			if (this.isVirtualLocation(latitude, longitude)) {
				this.logger.debug(`Skipping virtual location with coordinates: ${latitude}, ${longitude} for user: ${createTrackingDto.owner}`);
				return {
					message: 'Virtual location skipped - not recorded',
					data: null,
					warnings: [{ type: 'VIRTUAL_LOCATION', message: `Virtual location with coordinates ${latitude}, ${longitude} was skipped` }],
				};
			}

			// Check GPS accuracy before processing
			if (!this.isAcceptableAccuracy(createTrackingDto.accuracy)) {
				const accuracyValue = createTrackingDto.accuracy || 'unknown';
				this.logger.debug(`Skipping low accuracy GPS point: ${accuracyValue}m for user: ${createTrackingDto.owner} at ${latitude}, ${longitude}`);
				return {
					message: 'Low accuracy GPS point skipped - not recorded',
					data: null,
					warnings: [{ 
						type: 'LOW_ACCURACY_GPS', 
						message: `GPS point with accuracy ${accuracyValue}m was skipped (threshold: 20m)`,
						accuracy: createTrackingDto.accuracy,
						coordinates: `${latitude}, ${longitude}`
					}],
				};
			}

			// Skip geocoding during creation for performance - will be done during retrieval
			const address = null;
			const geocodingError = null;

			// Extract owner ID before creating tracking data
			const ownerId = createTrackingDto.owner;
			if (!ownerId) {
				throw new BadRequestException('Owner ID is required for tracking');
			}

			// Check rate limit: maximum 2 points per minute per user
			const rateLimitCheck = await this.checkRateLimit(ownerId);
			if (!rateLimitCheck.isAllowed) {
				// Handle rate limit gracefully - return early with informative message instead of throwing exception
				// This prevents error logs for expected rate limiting behavior
				const executionTime = Date.now() - startTime;
				this.logger.debug(
					`Rate limit exceeded for user ${ownerId}. Tracking point skipped. Reset at: ${rateLimitCheck.resetAt.toISOString()} (processed in ${executionTime}ms)`
				);
				return {
					message: `Rate limit exceeded. Maximum 2 tracking points per minute allowed. This point was skipped. Please wait until ${rateLimitCheck.resetAt.toISOString()} before sending more points.`,
					data: null,
					warnings: [{
						type: 'RATE_LIMIT_EXCEEDED',
						message: `Rate limit exceeded. Maximum ${rateLimitCheck.remaining === 0 ? '2' : rateLimitCheck.remaining} tracking points per minute allowed.`,
						resetAt: rateLimitCheck.resetAt.toISOString(),
						remaining: rateLimitCheck.remaining,
					}],
				};
			}

			// Validate user exists and has access
			const userExists = await this.userRepository.findOne({
				where: { uid: ownerId },
				relations: ['organisation', 'branch'],
			});

			if (!userExists) {
				throw new BadRequestException(`User with ID ${ownerId} not found`);
			}

			// Create a new object without the owner property
			const { owner, ...trackingDataWithoutOwner } = createTrackingDto;

			// Convert timestamp to integer if provided (PostgreSQL bigint doesn't accept decimals)
			if (trackingDataWithoutOwner.timestamp !== undefined && trackingDataWithoutOwner.timestamp !== null) {
				trackingDataWithoutOwner.timestamp = Math.floor(trackingDataWithoutOwner.timestamp);
			}

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
			}

			if (orgId) {
				trackingData.organisation = { uid: Number(orgId) } as any;
			}

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

		// Build optimized query conditions with selective fields
		const whereConditions: any = {
			owner: { uid: userId },
			timestamp: Between(dateRange.start, dateRange.end),
			// Exclude virtual locations containing '122' in coordinates
			...this.getVirtualLocationFilters(),
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

		this.logger.debug('Querying tracking points from database with optimized fields');
		const trackingPoints = await this.trackingRepository.find({
			where: whereConditions,
			select: [
				'uid', 'latitude', 'longitude', 'timestamp', 'createdAt', 
				'address', 'addressDecodingError', 'accuracy', 'speed', 
				'heading', 'altitude', 'rawLocation'
			],
			relations: ['owner'],
			order: { timestamp: 'ASC' },
		});

			this.logger.debug(`Found ${trackingPoints.length} tracking points for user: ${userId}`);

			// Try to geocode tracking points that don't have addresses
			// This will now stop after 3 consecutive failures
			await this.geocodeTrackingPoints(trackingPoints);

			// Check if geocoding failed and provide fallback data
			const pointsWithoutAddress = trackingPoints.filter(point => !point.address && point.latitude && point.longitude);
			const geocodingFailed = pointsWithoutAddress.length > 0;

			if (geocodingFailed) {
				this.logger.warn(`Geocoding failed for ${pointsWithoutAddress.length} tracking points in timeframe query. Using fallback location data.`);
				
				// Provide fallback addresses using coordinates
				pointsWithoutAddress.forEach(point => {
					if (!point.address) {
						point.address = `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
					}
				});
			}

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
					geocodingStatus: {
						successful: trackingPoints.filter(p => p.address && !p.addressDecodingError).length,
						failed: pointsWithoutAddress.length,
						usedFallback: geocodingFailed,
					},
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
	 * Round coordinates to 4 decimal places (≈11m accuracy) for caching and deduplication
	 * @param latitude - Latitude coordinate
	 * @param longitude - Longitude coordinate
	 * @returns Rounded coordinates
	 */
	private roundCoordinates(latitude: number, longitude: number): { lat: number; lng: number } {
		return {
			lat: Math.round(latitude * 10000) / 10000,
			lng: Math.round(longitude * 10000) / 10000,
		};
	}

	/**
	 * Group nearby coordinates together to reduce geocoding API calls
	 * Groups points within 50-100m radius (approximately 0.0005-0.001 degrees)
	 * @param points - Array of tracking points to group
	 * @param radiusDegrees - Radius in degrees (default 0.0008 ≈ 89m)
	 * @returns Array of coordinate groups with representative points
	 */
	private groupNearbyCoordinates(
		points: Tracking[],
		radiusDegrees: number = 0.0008
	): Array<{ representative: Tracking; members: Tracking[] }> {
		if (points.length === 0) {
			return [];
		}

		const groups: Array<{ representative: Tracking; members: Tracking[] }> = [];
		const processed = new Set<number>();

		for (let i = 0; i < points.length; i++) {
			if (processed.has(i)) continue;

			const currentPoint = points[i];
			const members: Tracking[] = [currentPoint];
			processed.add(i);

			// Find all points within radius
			for (let j = i + 1; j < points.length; j++) {
				if (processed.has(j)) continue;

				const otherPoint = points[j];
				const distance = LocationUtils.calculateDistance(
					currentPoint.latitude,
					currentPoint.longitude,
					otherPoint.latitude,
					otherPoint.longitude
				);

				// Convert km to degrees (rough approximation: 1 degree ≈ 111 km)
				const distanceDegrees = distance / 111;

				if (distanceDegrees <= radiusDegrees) {
					members.push(otherPoint);
					processed.add(j);
				}
			}

			// Use the first point as representative (or could use center point)
			groups.push({
				representative: currentPoint,
				members,
			});
		}

		this.logger.debug(`Grouped ${points.length} points into ${groups.length} coordinate groups`);
		return groups;
	}

	/**
	 * Geocode tracking points that don't have addresses
	 * Now uses coordinate grouping and deduplication to reduce API calls
	 * @param trackingPoints - Array of tracking points to geocode
	 * @returns Updated tracking points with addresses
	 */
	private async geocodeTrackingPoints(trackingPoints: Tracking[]): Promise<Tracking[]> {
		if (!trackingPoints || trackingPoints.length === 0) {
			return trackingPoints;
		}

		// Filter points that need geocoding and apply lazy geocoding strategy
		// Only geocode points that are > 5 minutes apart or significant stops
		const pointsToGeocode = trackingPoints.filter((point, index) => {
			if (point.address || !point.latitude || !point.longitude) {
				return false;
			}

			// Skip points that are too close together (< 10m apart)
			if (index > 0) {
				const prevPoint = trackingPoints[index - 1];
				const distance = LocationUtils.calculateDistance(
					prevPoint.latitude,
					prevPoint.longitude,
					point.latitude,
					point.longitude
				);

				// Skip if < 10m apart (≈ 0.00009 degrees)
				if (distance < 0.01) {
					return false;
				}

				// Only geocode if > 5 minutes apart
				const timeDiff = new Date(point.createdAt).getTime() - new Date(prevPoint.createdAt).getTime();
				const timeDiffMinutes = timeDiff / (1000 * 60);
				if (timeDiffMinutes < 5) {
					return false;
				}
			}

			return true;
		});

		if (pointsToGeocode.length === 0) {
			this.logger.debug('No tracking points need geocoding after filtering');
			return trackingPoints;
		}

		this.logger.debug(`Geocoding ${pointsToGeocode.length} tracking points (filtered from ${trackingPoints.length} total)`);

		// Group nearby coordinates to reduce API calls
		const coordinateGroups = this.groupNearbyCoordinates(pointsToGeocode, 0.0008); // ~89m radius
		this.logger.debug(`Grouped into ${coordinateGroups.length} groups for geocoding`);

		// Process groups in batches
		const BATCH_SIZE = 5;
		const BATCH_DELAY = 1000; // 1 second delay between batches
		const MAX_CONSECUTIVE_FAILURES = 3;
		let consecutiveFailures = 0;
		let totalProcessed = 0;
		let totalSuccessful = 0;
		let totalFailed = 0;

		for (let i = 0; i < coordinateGroups.length; i += BATCH_SIZE) {
			if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
				this.logger.warn(`Stopping geocoding after ${consecutiveFailures} consecutive failures. Skipping remaining ${coordinateGroups.length - totalProcessed} groups.`);
				break;
			}

			const batch = coordinateGroups.slice(i, i + BATCH_SIZE);
			let batchFailures = 0;

			const geocodingPromises = batch.map(async (group) => {
				// Geocode only the representative point
				const { address, error } = await this.getAddressFromCoordinates(
					group.representative.latitude,
					group.representative.longitude
				);

				if (address) {
					// Apply address to all members of the group
					for (const member of group.members) {
						member.address = address;
						member.addressDecodingError = null;

						// Update in database
						try {
							await this.trackingRepository.update(member.uid, {
								address,
								addressDecodingError: null,
							});
						} catch (updateError) {
							this.logger.warn(`Failed to update address for tracking point ${member.uid}: ${updateError.message}`);
						}
					}

					totalSuccessful += group.members.length;
					consecutiveFailures = 0;
				} else if (error) {
					// Apply error to all members
					for (const member of group.members) {
						member.addressDecodingError = error;
					}
					this.logger.warn(`Geocoding failed for group representative ${group.representative.uid}: ${error}`);
					batchFailures++;
					totalFailed += group.members.length;
					consecutiveFailures++;
				}

				totalProcessed++;
				return group;
			});

			await Promise.allSettled(geocodingPromises);

			if (batchFailures === batch.length) {
				consecutiveFailures += batchFailures;
			}

			if (i + BATCH_SIZE < coordinateGroups.length && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
				await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
			}
		}

		if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
			this.logger.warn(`Geocoding stopped early due to ${consecutiveFailures} consecutive failures. Processed: ${totalProcessed}/${coordinateGroups.length} groups, Successful: ${totalSuccessful} points, Failed: ${totalFailed} points`);
		} else {
			this.logger.debug(`Completed geocoding: ${totalProcessed} groups processed, ${totalSuccessful} points geocoded successfully, ${totalFailed} failed`);
		}

		return trackingPoints;
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
		// Use rounded coordinates for caching (4 decimal places ≈ 11m accuracy)
		const rounded = this.roundCoordinates(latitude, longitude);
		const cacheKey = this.getCacheKey(`geocode_${rounded.lat}_${rounded.lng}`);

		// Check cache first with extended TTL (24 hours for addresses)
		const cachedAddress = await this.cacheManager.get<string>(cacheKey);
		if (cachedAddress) {
			this.logger.debug(`Cache hit for coordinates ${rounded.lat}, ${rounded.lng}`);
			return { address: cachedAddress };
		}

		const MAX_RETRIES = 3;
		const RETRY_DELAY = 1000; // 1 second
		const CACHE_TTL_24H = 86400000; // 24 hours in milliseconds

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
					const address = response.data.results[0].formatted_address;
					
					// Cache the result for 24 hours
					await this.cacheManager.set(cacheKey, address, CACHE_TTL_24H);
					
					return { address };
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
					// Exclude virtual locations containing '122' in coordinates
					...this.getVirtualLocationFilters(),
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

			// Try to geocode tracking points that don't have addresses
			// This will now stop after 3 consecutive failures
			await this.geocodeTrackingPoints(trackingPoints);

		// Provide fallback addresses for points without addresses
			const pointsWithoutAddress = trackingPoints.filter(point => !point.address && point.latitude && point.longitude);
		if (pointsWithoutAddress.length > 0) {
				this.logger.warn(`Geocoding failed for ${pointsWithoutAddress.length} tracking points. Using fallback location data.`);
				pointsWithoutAddress.forEach(point => {
					if (!point.address) {
						point.address = `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
					}
				});
			}

		// Use unified enhanced tracking data calculation
		const enhancedData = await this.calculateEnhancedTrackingData(trackingPoints, userId, date);

			return {
				message: process.env.SUCCESS_MESSAGE,
			data: enhancedData.comprehensiveData,
			};
		} catch (error) {
			this.logger.error(`Error in getDailyTracking for user ${userId}: ${error.message}`, error.stack);
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

			// Geocode if address is missing
			if (tracking && !tracking.address && tracking.latitude && tracking.longitude) {
				await this.geocodeTrackingPoints([tracking]);
			}

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
				where: { 
					owner: { uid: ref },
					// Exclude virtual locations containing '122' in coordinates
					...this.getVirtualLocationFilters(),
				},
			});

			if (!tracking) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Geocode tracking points that don't have addresses
			await this.geocodeTrackingPoints(tracking);

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
			// Convert timestamp to integer if provided (PostgreSQL bigint doesn't accept decimals)
			const updateData = { ...updateTrackingDto };
			if (updateData.timestamp !== undefined && updateData.timestamp !== null) {
				updateData.timestamp = Math.floor(updateData.timestamp);
			}

			await this.trackingRepository.update(ref, updateData as unknown as DeepPartial<Tracking>);

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
					// Exclude virtual locations containing '122' in coordinates
					...this.getVirtualLocationFilters(),
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
	 * Now includes accuracy filtering to ensure reliable calculations
	 */
	private async generateTripAnalysis(trackingPoints: Tracking[]) {
		// Filter points by accuracy first for reliable distance calculations
		const accuracyFilter = this.filterByAccuracy(trackingPoints);
		const accuratePoints = accuracyFilter.filteredPoints;
		
		// Calculate distance using enhanced method from GoogleMapsService
		let totalDistanceKm = 0;
		let distanceCalculationMethod = 'fallback';
		
		if (accuratePoints.length >= 2) {
			try {
				// Convert Tracking points to TrackingPoint format for GoogleMapsService
				const trackingPointsForCalculation: TrackingPoint[] = accuratePoints.map(point => ({
					latitude: point.latitude,
					longitude: point.longitude,
					createdAt: point.createdAt,
					accuracy: point.accuracy
				}));

				// Use enhanced distance calculation
				const distanceResult = await this.googleMapsService.calculateEnhancedDistance(trackingPointsForCalculation);
				totalDistanceKm = distanceResult.totalDistance;
				distanceCalculationMethod = distanceResult.method;
				
				this.logger.debug(`Enhanced distance calculation: ${totalDistanceKm}km using ${distanceCalculationMethod} method (baseline: ${distanceResult.baselineDistance}km)`);
				
			} catch (error) {
				this.logger.warn(`Enhanced distance calculation failed: ${error.message}. Falling back to traditional method.`);
				// Fallback to original calculation
				totalDistanceKm = LocationUtils.calculateTotalDistance(accuratePoints);
				distanceCalculationMethod = 'traditional-fallback';
			}
		} else {
			// Fallback for insufficient data
			totalDistanceKm = LocationUtils.calculateTotalDistance(accuratePoints);
		}
		
		const formattedDistance = LocationUtils.formatDistance(totalDistanceKm);
		
		// Log accuracy filtering results
		if (accuracyFilter.inaccurateCount > 0) {
			this.logger.debug(`Trip analysis: Filtered ${accuracyFilter.inaccurateCount}/${accuracyFilter.originalCount} points due to poor accuracy`);
		}
		
		if (accuratePoints.length < 2) {
			return {
				totalDistanceKm: 0,
				formattedDistance: '0 km',
				totalTimeMinutes: 0,
				averageSpeedKmh: 0,
				movingTimeMinutes: 0,
				stoppedTimeMinutes: 0,
				maxSpeedKmh: 0,
				locationTimeSpent: {},
				accuracyInfo: accuracyFilter.accuracyInfo,
				pointsUsed: accuratePoints.length,
				pointsFiltered: accuracyFilter.inaccurateCount,
				distanceCalculationMethod: 'insufficient-data',
			};
		}

		// Calculate time metrics using original points to preserve time span
		const startTime = new Date(trackingPoints[0].createdAt).getTime();
		const endTime = new Date(trackingPoints[trackingPoints.length - 1].createdAt).getTime();
		const totalTimeMinutes = (endTime - startTime) / (1000 * 60);

		// Calculate speeds and movement analysis with realistic bounds using accurate points only
		let movingTimeMinutes = 0;
		let maxSpeedKmh = 0;
		const locationTimeSpent = new Map<string, number>();
		
		// Constants for realistic speed calculations
		const MIN_TIME_INTERVAL_SECONDS = 5; // Minimum 5 seconds between points for speed calculation
		const MAX_REASONABLE_SPEED_KMH = 200; // Maximum reasonable speed for ground vehicles
		const MIN_DISTANCE_METERS = 5; // Minimum distance to consider as actual movement (GPS accuracy)

		// Use accurate points for distance and speed calculations
		for (let i = 1; i < accuratePoints.length; i++) {
			const prevPoint = accuratePoints[i - 1];
			const currentPoint = accuratePoints[i];
			
			const timeIntervalMs = new Date(currentPoint.createdAt).getTime() - new Date(prevPoint.createdAt).getTime();
			const timeIntervalMinutes = timeIntervalMs / (1000 * 60);
			const timeIntervalHours = timeIntervalMinutes / 60;
			const timeIntervalSeconds = timeIntervalMs / 1000;

			// Calculate distance between points
			const segmentDistance = LocationUtils.calculateDistance(
				prevPoint.latitude,
				prevPoint.longitude,
				currentPoint.latitude,
				currentPoint.longitude
			);
			const segmentDistanceMeters = segmentDistance * 1000;

			// Only calculate speed if we have sufficient time interval and distance
			let speedKmh = 0;
			if (timeIntervalSeconds >= MIN_TIME_INTERVAL_SECONDS && segmentDistanceMeters >= MIN_DISTANCE_METERS) {
				speedKmh = timeIntervalHours > 0 ? segmentDistance / timeIntervalHours : 0;
				
				// Cap speed at reasonable maximum to prevent GPS-induced crazy speeds
				speedKmh = Math.min(speedKmh, MAX_REASONABLE_SPEED_KMH);
			}
			
			// Track max speed (only if it's a valid calculation)
			if (speedKmh > 0 && speedKmh <= MAX_REASONABLE_SPEED_KMH && speedKmh > maxSpeedKmh) {
				maxSpeedKmh = speedKmh;
			}

			// Determine if this segment represents movement (speed > 2 km/h threshold and minimum distance)
			const isMoving = speedKmh > 2 && segmentDistanceMeters >= MIN_DISTANCE_METERS;
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
		let averageSpeedKmh = movingTimeMinutes > 0 ? (totalDistanceKm / (movingTimeMinutes / 60)) : 0;
		
		// Cap average speed at reasonable maximum
		averageSpeedKmh = Math.min(averageSpeedKmh, MAX_REASONABLE_SPEED_KMH);

		return {
			totalDistanceKm,
			formattedDistance,
			totalTimeMinutes: Math.round(totalTimeMinutes),
			averageSpeedKmh: Math.round(averageSpeedKmh * 10) / 10,
			movingTimeMinutes: Math.round(movingTimeMinutes),
			stoppedTimeMinutes: Math.round(stoppedTimeMinutes),
			maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10,
			locationTimeSpent: Object.fromEntries(locationTimeSpent),
			accuracyInfo: accuracyFilter.accuracyInfo,
			pointsUsed: accuratePoints.length,
			pointsFiltered: accuracyFilter.inaccurateCount,
			distanceCalculationMethod,
		};
	}

	/**
	 * Bulk geocode existing tracking points that don't have addresses
	 * @param userId - Optional user ID to filter points
	 * @param limit - Maximum number of points to process (default 100)
	 * @returns Summary of geocoding results
	 */
	async bulkGeocodeTrackingPoints(userId?: number, limit: number = 100): Promise<{
		message: string;
		processed: number;
		successful: number;
		failed: number;
		skipped: number;
	}> {
		const startTime = Date.now();
		this.logger.log(`Starting bulk geocoding operation${userId ? ` for user: ${userId}` : ''}`);

		try {
			// Build query conditions
			const whereConditions: any = {
				address: IsNull(),
				deletedAt: IsNull(),
				latitude: MoreThanOrEqual(-90),
				longitude: MoreThanOrEqual(-180),
				// Exclude virtual locations containing '122' in coordinates
				...this.getVirtualLocationFilters(),
			};

			if (userId) {
				whereConditions.owner = { uid: userId };
			}

			// Get tracking points without addresses
			const trackingPoints = await this.trackingRepository.find({
				where: whereConditions,
				take: limit,
				order: { createdAt: 'DESC' },
			});

			if (trackingPoints.length === 0) {
				return {
					message: 'No tracking points found that need geocoding',
					processed: 0,
					successful: 0,
					failed: 0,
					skipped: 0,
				};
			}

			this.logger.log(`Found ${trackingPoints.length} tracking points to geocode`);

			const originalLength = trackingPoints.length;
			let successful = 0;
			let failed = 0;

			// Use our existing geocoding method
			await this.geocodeTrackingPoints(trackingPoints);

			// Count results
			for (const point of trackingPoints) {
				if (point.address) {
					successful++;
				} else if (point.addressDecodingError) {
					failed++;
				}
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`Bulk geocoding completed in ${executionTime}ms: ${successful} successful, ${failed} failed`);

			return {
				message: `Bulk geocoding completed successfully`,
				processed: originalLength,
				successful,
				failed,
				skipped: 0,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Bulk geocoding failed after ${executionTime}ms: ${error.message}`, error.stack);

			return {
				message: `Bulk geocoding failed: ${error.message}`,
				processed: 0,
				successful: 0,
				failed: 0,
				skipped: 0,
			};
		}
	}

	/**
	 * Unified method to calculate enhanced tracking data that both endpoints use
	 * @param trackingPoints - Array of tracking points to analyze
	 * @param userId - User ID for caching purposes
	 * @param date - Date for caching purposes
	 * @returns Enhanced tracking data with comprehensive analytics
	 */
	private async calculateEnhancedTrackingData(
		trackingPoints: Tracking[], 
		userId?: number, 
		date?: Date
	): Promise<EnhancedTrackingResult> {
		const cacheKey = userId && date ? 
			this.getCacheKey(`enhanced_tracking_${userId}_${date.toISOString().split('T')[0]}`) : 
			null;
		
		// Try to get from cache first
		if (cacheKey) {
			const cached = await this.cacheManager.get(cacheKey);
			if (cached) {
				this.logger.debug(`Retrieved enhanced tracking data from cache for user: ${userId}`);
				return cached as any;
			}
		}

		// Calculate enhanced analytics
		const tripAnalysis = await this.generateTripAnalysis(trackingPoints);
		const stopAnalysis = this.detectAndAnalyzeStops(trackingPoints);

		// Check for geocoding status
		const pointsWithoutAddress = trackingPoints.filter(point => !point.address && point.latitude && point.longitude);
		const geocodingFailed = pointsWithoutAddress.length > 0;

		const comprehensiveData = {
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
			geocodingStatus: {
				successful: trackingPoints.filter(p => p.address && !p.addressDecodingError).length,
				failed: pointsWithoutAddress.length,
				usedFallback: geocodingFailed,
			},
			// Additional enhanced metrics
			movementEfficiency: {
				efficiencyRating: this.calculateEfficiencyRating(tripAnalysis, stopAnalysis),
				travelOptimization: this.analyzeTravelOptimization(stopAnalysis.stops),
				productivityScore: this.calculateProductivityScore(stopAnalysis.stops),
			},
			locationProductivity: {
				totalLocations: stopAnalysis.stops.length,
				averageTimePerStop: stopAnalysis.averageTimeMinutes,
				productiveStops: stopAnalysis.stops.filter(stop => stop.durationMinutes >= 15).length,
				keyLocations: stopAnalysis.stops.slice(0, 5).map(stop => ({
					...stop,
					productivity: this.assessLocationProductivity(stop)
				})),
			},
			travelInsights: {
				totalTravelDistance: tripAnalysis.totalDistanceKm,
				travelEfficiency: this.calculateTravelEfficiency(tripAnalysis),
				routeOptimization: this.analyzeRouteOptimization(stopAnalysis.stops),
				movementPatterns: this.analyzeMovementPatterns(trackingPoints),
			},
		};

		const result = {
			tripAnalysis,
			stopAnalysis,
			comprehensiveData,
		};

		// Cache the result for 1 hour
		if (cacheKey) {
			await this.cacheManager.set(cacheKey, result, 3600000);
			this.logger.debug(`Cached enhanced tracking data for user: ${userId}`);
		}

		return result;
	}

	/**
	 * Calculate efficiency rating based on movement patterns
	 */
	private calculateEfficiencyRating(tripAnalysis: any, stopAnalysis: any): 'High' | 'Medium' | 'Low' {
		let score = 0;
		
		// Factor 1: Speed efficiency (0-30 points)
		if (tripAnalysis.averageSpeedKmh > 15 && tripAnalysis.averageSpeedKmh < 60) {
			score += 30;
		} else if (tripAnalysis.averageSpeedKmh > 10) {
			score += 20;
		} else {
			score += 10;
		}
		
		// Factor 2: Stop efficiency (0-30 points)
		const avgStopDuration = stopAnalysis.averageTimeMinutes;
		if (avgStopDuration > 15 && avgStopDuration < 120) {
			score += 30;
		} else if (avgStopDuration > 10) {
			score += 20;
		} else {
			score += 10;
		}
		
		// Factor 3: Distance vs time efficiency (0-40 points)
		const distanceTimeRatio = tripAnalysis.totalDistanceKm / (tripAnalysis.totalTimeMinutes / 60);
		if (distanceTimeRatio > 5) {
			score += 40;
		} else if (distanceTimeRatio > 2) {
			score += 30;
		} else if (distanceTimeRatio > 1) {
			score += 20;
		} else {
			score += 10;
		}
		
		// Return rating
		if (score >= 80) return 'High';
		if (score >= 60) return 'Medium';
		return 'Low';
	}

	/**
	 * Analyze travel optimization opportunities
	 */
	private analyzeTravelOptimization(stops: any[]): any {
		if (stops.length < 2) return { score: 'N/A', suggestions: [] };
		
		const suggestions = [];
		let totalDistance = 0;
		
		// Calculate total travel distance between stops
		for (let i = 1; i < stops.length; i++) {
			const distance = LocationUtils.calculateDistance(
				stops[i-1].latitude, stops[i-1].longitude,
				stops[i].latitude, stops[i].longitude
			);
			totalDistance += distance;
		}
		
		// Analyze for optimization opportunities
		if (totalDistance > 50) {
			suggestions.push('Consider route optimization to reduce travel distance');
		}
		
		if (stops.some(stop => stop.durationMinutes < 10)) {
			suggestions.push('Some stops were very short - consider consolidating tasks');
		}
		
		return {
			totalTravelDistance: totalDistance,
			optimizationScore: totalDistance < 30 ? 'High' : totalDistance < 60 ? 'Medium' : 'Low',
			suggestions,
		};
	}

	/**
	 * Calculate productivity score based on stops
	 */
	private calculateProductivityScore(stops: any[]): number {
		if (stops.length === 0) return 0;
		
		const productiveStops = stops.filter(stop => stop.durationMinutes >= 15).length;
		return Math.round((productiveStops / stops.length) * 100);
	}

	/**
	 * Assess individual location productivity
	 */
	private assessLocationProductivity(stop: any): string {
		if (stop.durationMinutes >= 60) return 'High';
		if (stop.durationMinutes >= 30) return 'Medium';
		if (stop.durationMinutes >= 15) return 'Low';
		return 'Minimal';
	}

	/**
	 * Calculate travel efficiency metrics
	 */
	private calculateTravelEfficiency(tripAnalysis: any): any {
		const efficiency = {
			score: 'Medium',
			metrics: {
				avgSpeed: tripAnalysis.averageSpeedKmh,
				maxSpeed: tripAnalysis.maxSpeedKmh,
				movingRatio: tripAnalysis.movingTimeMinutes / tripAnalysis.totalTimeMinutes,
			}
		};
		
		// Calculate efficiency score
		let score = 0;
		if (efficiency.metrics.avgSpeed > 20) score += 30;
		else if (efficiency.metrics.avgSpeed > 10) score += 20;
		else score += 10;
		
		if (efficiency.metrics.movingRatio > 0.4) score += 30;
		else if (efficiency.metrics.movingRatio > 0.2) score += 20;
		else score += 10;
		
		if (efficiency.metrics.maxSpeed < 80 && efficiency.metrics.maxSpeed > 30) score += 40;
		else score += 20;
		
		efficiency.score = score >= 80 ? 'High' : score >= 60 ? 'Medium' : 'Low';
		
		return efficiency;
	}

	/**
	 * Analyze route optimization opportunities
	 */
	private analyzeRouteOptimization(stops: any[]): any {
		if (stops.length < 3) {
			return {
				canOptimize: false,
				potentialSavings: 0,
				recommendation: 'Need at least 3 stops to analyze route optimization'
			};
		}
		
		// Calculate current route distance
		let currentDistance = 0;
		for (let i = 1; i < stops.length; i++) {
			currentDistance += LocationUtils.calculateDistance(
				stops[i-1].latitude, stops[i-1].longitude,
				stops[i].latitude, stops[i].longitude
			);
		}
		
		// Simple optimization: check if reversing route would be shorter
		let reverseDistance = 0;
		const reversedStops = [...stops].reverse();
		for (let i = 1; i < reversedStops.length; i++) {
			reverseDistance += LocationUtils.calculateDistance(
				reversedStops[i-1].latitude, reversedStops[i-1].longitude,
				reversedStops[i].latitude, reversedStops[i].longitude
			);
		}
		
		const savings = Math.max(0, currentDistance - reverseDistance);
		
		return {
			canOptimize: savings > 2, // 2km savings threshold
			currentRouteDistance: Math.round(currentDistance * 100) / 100,
			optimizedRouteDistance: Math.round(reverseDistance * 100) / 100,
			potentialSavings: Math.round(savings * 100) / 100,
			recommendation: savings > 2 ? 
				`Route could be optimized to save ${savings.toFixed(1)}km` : 
				'Current route appears well optimized'
		};
	}

	/**
	 * Analyze movement patterns throughout the day
	 */
	private analyzeMovementPatterns(trackingPoints: Tracking[]): any {
		if (trackingPoints.length < 10) {
			return { pattern: 'Insufficient data', analysis: 'Need more tracking points for pattern analysis' };
		}
		
		// Analyze movement by time of day
		const hourlyMovement = new Map<number, { distance: number, points: number }>();
		
		for (let i = 1; i < trackingPoints.length; i++) {
			const hour = new Date(trackingPoints[i].createdAt).getHours();
			const distance = LocationUtils.calculateDistance(
				trackingPoints[i-1].latitude, trackingPoints[i-1].longitude,
				trackingPoints[i].latitude, trackingPoints[i].longitude
			);
			
			const current = hourlyMovement.get(hour) || { distance: 0, points: 0 };
			hourlyMovement.set(hour, {
				distance: current.distance + distance,
				points: current.points + 1
			});
		}
		
		// Find peak movement hours
		const peakHour = Array.from(hourlyMovement.entries())
			.sort(([,a], [,b]) => b.distance - a.distance)[0];
		
		return {
			pattern: peakHour ? `Most active during ${peakHour[0]}:00 hour` : 'Even distribution',
			peakMovementHour: peakHour ? peakHour[0] : null,
			peakMovementDistance: peakHour ? Math.round(peakHour[1].distance * 100) / 100 : 0,
			analysis: `Movement distributed across ${hourlyMovement.size} different hours`,
			hourlyBreakdown: Array.from(hourlyMovement.entries())
				.map(([hour, data]) => ({
					hour,
					distance: Math.round(data.distance * 100) / 100,
					points: data.points
				}))
				.sort((a, b) => b.distance - a.distance)
				.slice(0, 5) // Top 5 hours
		};
	}

	/**
	 * Advanced stop detection and analysis
	 * Now includes accuracy filtering for reliable stop detection
	 */
	private detectAndAnalyzeStops(trackingPoints: Tracking[]) {
		const STOP_RADIUS_METERS = 50; // 50 meter radius
		const MIN_STOP_DURATION_MINUTES = 3; // Minimum 3 minutes to be considered a stop
		
		// Filter points by accuracy for reliable stop detection
		const accuracyFilter = this.filterByAccuracy(trackingPoints);
		const accuratePoints = accuracyFilter.filteredPoints;
		
		// Log accuracy filtering for stop detection
		if (accuracyFilter.inaccurateCount > 0) {
			this.logger.debug(`Stop detection: Filtered ${accuracyFilter.inaccurateCount}/${accuracyFilter.originalCount} points due to poor accuracy`);
		}
		
		if (accuratePoints.length < 2) {
			return {
				stops: [],
				locations: [],
				averageTimeMinutes: 0,
				averageTimeFormatted: '0m',
				accuracyInfo: accuracyFilter.accuracyInfo,
				pointsUsed: accuratePoints.length,
				pointsFiltered: accuracyFilter.inaccurateCount,
			};
		}

		const stops = [];
		const locations = [];
		let currentStop = null;

		for (let i = 0; i < accuratePoints.length; i++) {
			const point = accuratePoints[i];
			
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
			accuracyInfo: accuracyFilter.accuracyInfo,
			pointsUsed: accuratePoints.length,
			pointsFiltered: accuracyFilter.inaccurateCount,
		};
	}

	/**
	 * Recalculate tracking analytics for a user on a specific date
	 * This method fetches all tracking points, filters out virtual locations,
	 * and recalculates all metrics with accurate data
	 * @param userId - User ID to recalculate data for
	 * @param date - Date to recalculate (defaults to today)
	 * @returns Recalculated tracking data with updated analytics
	 */
	async recalculateUserTrackingForDay(userId: number, date: Date = new Date()): Promise<{
		message: string;
		data: any;
		recalculationInfo: {
			originalPointsCount: number;
			filteredPointsCount: number;
			virtualPointsRemoved: number;
			recalculatedAt: string;
		};
	}> {
		const startTime = Date.now();
		this.logger.log(`Recalculating tracking data for user: ${userId} on date: ${date.toISOString().split('T')[0]}`);

		try {
			// Validate user exists
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				relations: ['organisation', 'branch'],
			});

			if (!user) {
				throw new NotFoundException(`User with ID ${userId} not found`);
			}

			// Fetch ALL tracking points for the day (including virtual ones initially)
			// This allows us to see what was filtered out
			this.logger.debug('Fetching all tracking points for the day (including virtual locations)');
			const allTrackingPoints = await this.trackingRepository.find({
				where: {
					owner: { uid: userId },
					createdAt: Between(startOfDay(date), endOfDay(date)),
					deletedAt: IsNull(),
				},
				order: {
					createdAt: 'ASC',
				},
			});

			const originalCount = allTrackingPoints.length;
			this.logger.debug(`Found ${originalCount} total tracking points before filtering`);

			if (originalCount === 0) {
				return {
					message: 'No tracking data found for the specified date',
					data: null,
					recalculationInfo: {
						originalPointsCount: 0,
						filteredPointsCount: 0,
						virtualPointsRemoved: 0,
						recalculatedAt: new Date().toISOString(),
					},
				};
			}

			// Filter out virtual locations
			const filteredTrackingPoints = this.filterVirtualLocations(allTrackingPoints);
			const filteredCount = filteredTrackingPoints.length;
			const virtualPointsRemoved = originalCount - filteredCount;

			this.logger.debug(`Filtered out ${virtualPointsRemoved} virtual locations, ${filteredCount} valid points remaining`);

			if (filteredCount === 0) {
				return {
					message: 'All tracking points for this date were virtual locations and have been filtered out',
					data: null,
					recalculationInfo: {
						originalPointsCount: originalCount,
						filteredPointsCount: 0,
						virtualPointsRemoved,
						recalculatedAt: new Date().toISOString(),
					},
				};
			}

			// Clear cache for this user to ensure fresh data
			await this.clearTrackingCache(undefined, userId);

			// Try to geocode tracking points that don't have addresses
			await this.geocodeTrackingPoints(filteredTrackingPoints);

			// Provide fallback addresses for points without addresses
			const pointsWithoutAddress = filteredTrackingPoints.filter(point => !point.address && point.latitude && point.longitude);
			if (pointsWithoutAddress.length > 0) {
				this.logger.warn(`Geocoding failed for ${pointsWithoutAddress.length} tracking points during recalculation. Using fallback location data.`);
				pointsWithoutAddress.forEach(point => {
					if (!point.address) {
						point.address = `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
					}
				});
			}

			// Use unified enhanced tracking data calculation
			const enhancedData = await this.calculateEnhancedTrackingData(filteredTrackingPoints, userId, date);

			const recalculatedData = {
				user: {
					uid: user.uid,
					name: user.name,
					surname: user.surname,
					email: user.email,
					branch: user.branch?.name,
					organisation: user.organisation?.name,
				},
				date: date.toISOString().split('T')[0],
				...enhancedData.comprehensiveData,
			};

			const executionTime = Date.now() - startTime;
			this.logger.log(`Successfully recalculated tracking data for user: ${userId} in ${executionTime}ms`);

			// Update existing reports with the new GPS data
			try {
				if (this.reportsService) {
					this.logger.log(`🔄 Starting report updates with recalculated GPS data for user ${userId}`);
					
					const reportUpdateResult = await this.reportsService.updateReportsWithRecalculatedGpsData(
						userId,
						date,
						{
							...enhancedData.comprehensiveData,
							recalculationInfo: {
								originalPointsCount: originalCount,
								filteredPointsCount: filteredCount,
								virtualPointsRemoved,
								recalculatedAt: new Date().toISOString(),
							}
						}
					);
					
					// Enhanced logging with emojis and details
					this.logger.log(`🎉 REPORT UPDATE RESULTS:`);
					this.logger.log(`📊 Total reports found: ${reportUpdateResult.totalFound}`);
					this.logger.log(`✅ Successfully updated: ${reportUpdateResult.updated}`);
					this.logger.log(`❌ Failed to update: ${reportUpdateResult.totalFound - reportUpdateResult.updated}`);
					this.logger.log(`📍 GPS data details: Distance=${enhancedData.comprehensiveData.tripSummary?.totalDistanceKm}km, Stops=${enhancedData.comprehensiveData.tripSummary?.numberOfStops}, Points=${filteredCount}`);
					
					if (reportUpdateResult.updated > 0) {
						this.logger.log(`✨ Successfully synchronized GPS data across ${reportUpdateResult.updated} reports for user ${userId}`);
					} else {
						this.logger.warn(`⚠️  No reports were updated - check if reports exist for user ${userId} on ${date.toISOString().split('T')[0]}`);
					}
				} else {
					this.logger.warn('⚠️  ReportsService not available - GPS recalculation completed but reports not updated');
				}
			} catch (error) {
				this.logger.error(`💥 CRITICAL: Failed to update reports with recalculated GPS data for user ${userId}:`, error.message);
				this.logger.error(`Error details:`, error.stack);
				// Don't fail the entire recalculation if report update fails
			}

			return {
				message: 'Tracking data recalculated successfully with virtual locations filtered out',
				data: recalculatedData,
				recalculationInfo: {
					originalPointsCount: originalCount,
					filteredPointsCount: filteredCount,
					virtualPointsRemoved,
					recalculatedAt: new Date().toISOString(),
				},
			};

		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`Failed to recalculate tracking data for user: ${userId} after ${executionTime}ms. Error: ${error.message}`,
				error.stack
			);

			return {
				message: error?.message || 'Failed to recalculate tracking data',
				data: null,
				recalculationInfo: {
					originalPointsCount: 0,
					filteredPointsCount: 0,
					virtualPointsRemoved: 0,
					recalculatedAt: new Date().toISOString(),
				},
			};
		}
	}
}
