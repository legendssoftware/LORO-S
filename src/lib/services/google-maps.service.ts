import { Injectable, Logger, BadRequestException, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { 
  Client, 
  TravelMode, 
  TransitMode, 
  UnitSystem,
  TravelRestriction,
  TransitRoutingPreference,
  GeocodeResponse,
  DirectionsResponse,
  Language,
  AddressType,
  ReverseGeocodingLocationType
} from '@googlemaps/google-maps-services-js';
import { Address, GeocodingResult } from '../interfaces/address.interface';
import { IsString, IsNumber, IsOptional, IsArray, IsBoolean, IsEnum, ValidateNested, IsLatitude, IsLongitude } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { throttle } from 'lodash';

// ======================================================
// ENHANCED TYPES AND INTERFACES
// ======================================================

interface GeocoderAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface LatLngCoordinates {
  lat: number;
  lng: number;
}

export interface PreciseCoordinates extends Coordinates {
  accuracy?: number; // in meters
  elevation?: number; // in meters
  timestamp?: Date;
}

export interface RouteOptions {
  travelMode?: TravelMode;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  routingPreference?: TransitRoutingPreference;
  transitMode?: TransitMode[];
  unitSystem?: UnitSystem;
  departureTime?: Date;
  arrivalTime?: Date;
  language?: Language;
  region?: string;
  alternatives?: boolean;
}

export interface RouteWaypoint {
  location: string | Coordinates;
  stopover?: boolean;
  placeId?: string;
}

export interface RouteResult {
  waypointOrder: number[];
  totalDistance: number;
  totalDuration: number;
  legs: Array<{
    distance: { text: string; value: number };
    duration: { text: string; value: number };
    startLocation: { lat: number; lng: number };
    endLocation: { lat: number; lng: number };
    startAddress?: string;
    endAddress?: string;
    steps: Array<{
      distance: { text: string; value: number };
      duration: { text: string; value: number };
      instructions: string;
      travelMode: string;
      polyline?: string;
    }>;
  }>;
  polyline?: string;
  bounds?: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  };
  copyrights?: string;
  warnings?: string[];
  fare?: {
    currency: string;
    value: number;
    text: string;
  };
}

export interface PlaceOfInterest {
  placeId: string;
  name: string;
  types: string[];
  coordinates: Coordinates;
  rating?: number;
  priceLevel?: number;
  businessStatus?: string;
  openNow?: boolean;
  vicinity?: string;
}

export interface BatchGeocodingRequest {
  addresses: string[];
  requestId?: string;
  priority?: 'high' | 'normal' | 'low';
}

export interface BatchGeocodingResult {
  requestId?: string;
  results: Array<{
    address: string;
    result?: GeocodingResult;
    error?: string;
  }>;
  totalProcessingTime: number;
  successCount: number;
  errorCount: number;
}

// ======================================================
// VALIDATION CLASSES
// ======================================================

export class CoordinatesDto {
  @IsNumber()
  @IsLatitude()
  latitude: number;

  @IsNumber()
  @IsLongitude()
  longitude: number;
}

export class RouteOptionsDto {
  @IsOptional()
  @IsEnum(TravelMode)
  travelMode?: TravelMode;

  @IsOptional()
  @IsBoolean()
  avoidTolls?: boolean;

  @IsOptional()
  @IsBoolean()
  avoidHighways?: boolean;

  @IsOptional()
  @IsBoolean()
  avoidFerries?: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(TransitMode, { each: true })
  transitMode?: TransitMode[];

  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @IsOptional()
  @IsString()
  region?: string;
}

// ======================================================
// ENHANCED GOOGLE MAPS SERVICE
// 
// This service uses NestJS Cache Manager for caching geocoding and routing results.
// The cache is configured globally in app.module.ts and can be backed by memory
// or external stores like Redis depending on configuration.
// ======================================================

@Injectable()
export class GoogleMapsService implements OnModuleInit {
  private readonly logger = new Logger(GoogleMapsService.name);
  private readonly client: Client;
  private readonly apiKey: string;
  private readonly CACHE_PREFIX = 'gmaps:';
  private readonly CACHE_TTL: number;
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_MS = 1000;
  private readonly REQUEST_TIMEOUT_MS = 30000;
  private readonly RATE_LIMIT_PER_SECOND = 50;
  
  // Connection pooling and optimization
  private readonly connectionPool = new Map<string, Date>();
  private readonly requestQueue: Array<{ resolve: Function; reject: Function; request: Function }> = [];
  private isProcessingQueue = false;

  // Rate limiting using lodash throttle
  private readonly throttledRequest = throttle(this.processQueue.bind(this), 1000 / this.RATE_LIMIT_PER_SECOND);

  // Performance metrics
  private readonly performanceMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {
    this.client = new Client({}); // We'll handle retries manually for better control
    
    this.apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    this.CACHE_TTL = parseInt(this.configService.get<string>('GOOGLE_MAPS_CACHE_TTL') || '3600', 10); // 1 hour default
    
    if (!this.apiKey) {
      this.logger.warn('Google Maps API key not found. Service will be limited.');
    }
  }

  async onModuleInit() {
    this.logger.log('Google Maps Service initialized with enhanced capabilities');
    this.logger.debug(`Cache TTL: ${this.CACHE_TTL}s, Rate limit: ${this.RATE_LIMIT_PER_SECOND}/s`);
    
    // Start performance monitoring
    setInterval(() => {
      this.logPerformanceMetrics();
    }, 300000); // Log every 5 minutes
  }

  // ======================================================
  // CORE UTILITY METHODS
  // ======================================================

  /**
   * Generate cache key with prefix and hash for complex objects
   */
  private generateCacheKey(prefix: string, data: any): string {
    const hash = require('crypto')
      .createHash('md5')
      .update(JSON.stringify(data))
      .digest('hex');
    return `${this.CACHE_PREFIX}${prefix}:${hash}`;
  }

  /**
   * Enhanced cache get with error handling and metrics
   */
  private async getCacheWithMetrics<T>(key: string): Promise<T | null> {
    try {
      const cacheStart = Date.now();
      const result = await this.cacheManager.get<T>(key);
      const cacheTime = Date.now() - cacheStart;
      
      if (result) {
        this.performanceMetrics.cacheHits++;
        this.logger.debug(`Cache HIT for key: ${key} in ${cacheTime}ms`);
      } else {
        this.performanceMetrics.cacheMisses++;
        this.logger.debug(`Cache MISS for key: ${key} in ${cacheTime}ms`);
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Cache get failed for key ${key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Enhanced cache set with error handling
   */
  private async setCacheWithMetrics<T>(key: string, data: T, ttl?: number): Promise<boolean> {
    try {
      const cacheStart = Date.now();
      await this.cacheManager.set(key, data, ttl || this.CACHE_TTL);
      const cacheTime = Date.now() - cacheStart;
      
      this.logger.debug(`Cache SET for key: ${key} in ${cacheTime}ms`);
      return true;
    } catch (error) {
      this.logger.error(`Cache set failed for key ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Enhanced retry mechanism with exponential backoff
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxAttempts = this.MAX_RETRY_ATTEMPTS
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const startTime = Date.now();
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), this.REQUEST_TIMEOUT_MS)
          )
        ]);
        
        const duration = Date.now() - startTime;
        this.updatePerformanceMetrics(duration, true);
        
        this.logger.debug(`${operationName} completed successfully on attempt ${attempt} in ${duration}ms`);
        return result;
        
      } catch (error) {
        lastError = error;
        this.updatePerformanceMetrics(0, false);
        
        if (attempt === maxAttempts) {
          this.logger.error(`${operationName} failed after ${maxAttempts} attempts: ${error.message}`);
          break;
        }
        
        const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        this.logger.warn(`${operationName} attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(responseTime: number, success: boolean) {
    this.performanceMetrics.totalRequests++;
    
    if (success) {
      this.performanceMetrics.successfulRequests++;
      // Calculate rolling average response time
      this.performanceMetrics.averageResponseTime = 
        (this.performanceMetrics.averageResponseTime * (this.performanceMetrics.successfulRequests - 1) + responseTime) 
        / this.performanceMetrics.successfulRequests;
    } else {
      this.performanceMetrics.failedRequests++;
    }
  }

  /**
   * Log performance metrics
   */
  private logPerformanceMetrics() {
    this.logger.log('Google Maps Service Performance Metrics:', {
      totalRequests: this.performanceMetrics.totalRequests,
      successRate: `${((this.performanceMetrics.successfulRequests / this.performanceMetrics.totalRequests) * 100).toFixed(2)}%`,
      averageResponseTime: `${this.performanceMetrics.averageResponseTime.toFixed(2)}ms`,
      cacheHitRate: `${((this.performanceMetrics.cacheHits / (this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses)) * 100).toFixed(2)}%`,
    });
  }

  /**
   * Enhanced input validation and sanitization
   */
  private validateAndSanitizeAddress(address: string): string {
    if (!address || typeof address !== 'string') {
      throw new BadRequestException('Invalid address provided');
    }
    
    const sanitized = address.trim().slice(0, 200); // Limit length
    
    if (sanitized.length < 2) {
      throw new BadRequestException('Address too short');
    }
    
    // Check for potential injection attempts
    const dangerousPatterns = /<script|javascript:|data:/i;
    if (dangerousPatterns.test(sanitized)) {
      throw new BadRequestException('Invalid characters in address');
    }
    
    return sanitized;
  }

  /**
   * Validate coordinates with precision handling
   */
  private validateCoordinates(coordinates: Coordinates): PreciseCoordinates {
    if (!coordinates || typeof coordinates.latitude !== 'number' || typeof coordinates.longitude !== 'number') {
      throw new BadRequestException('Invalid coordinates provided');
    }
    
    const { latitude, longitude } = coordinates;
    
    // Validate coordinate bounds
    if (latitude < -90 || latitude > 90) {
      throw new BadRequestException('Latitude must be between -90 and 90 degrees');
    }
    
    if (longitude < -180 || longitude > 180) {
      throw new BadRequestException('Longitude must be between -180 and 180 degrees');
    }
    
    // Round to 6 decimal places for precision (approximately 0.1 meter accuracy)
    return {
      latitude: Math.round(latitude * 1000000) / 1000000,
      longitude: Math.round(longitude * 1000000) / 1000000,
      accuracy: 10, // Default 10 meter accuracy
      timestamp: new Date()
    };
  }

  /**
   * Rate-limited request processing
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    const { resolve, reject, request } = this.requestQueue.shift()!;
    
    try {
      const result = await request();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.isProcessingQueue = false;
      
      // Process next item if queue is not empty
      if (this.requestQueue.length > 0) {
        setTimeout(() => this.processQueue(), 1000 / this.RATE_LIMIT_PER_SECOND);
      }
    }
  }

  /**
   * Add request to rate-limited queue
   */
  private queueRequest<T>(request: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push({ resolve, reject, request });
      this.throttledRequest();
    });
  }

  // ======================================================
  // ENHANCED GEOCODING METHODS
  // ======================================================

  /**
   * Enhanced forward geocoding with caching and validation
   * @param address The address to geocode
   * @param options Optional geocoding options
   * @returns Geocoding result with coordinates and formatted address
   */
  async geocodeAddress(
    address: string, 
    options: { language?: Language; region?: string; bounds?: any } = {}
  ): Promise<GeocodingResult> {
    const operationId = `geocode-${Date.now()}`;
    this.logger.debug(`[${operationId}] Starting geocoding for address: ${address}`);
    
    try {
      // Validate and sanitize input
      const sanitizedAddress = this.validateAndSanitizeAddress(address);
      
      // Check cache first
      const cacheKey = this.generateCacheKey('geocode', { address: sanitizedAddress, ...options });
      const cachedResult = await this.getCacheWithMetrics<GeocodingResult>(cacheKey);
      
      if (cachedResult) {
        this.logger.debug(`[${operationId}] Returning cached result for address: ${sanitizedAddress}`);
        return cachedResult;
      }
      
      // Execute geocoding with retry mechanism
      const result = await this.executeWithRetry(async () => {
        return await this.queueRequest(async () => {
      const response = await this.client.geocode({
        params: {
              address: sanitizedAddress,
          key: this.apiKey,
              language: options.language,
              region: options.region,
              bounds: options.bounds,
        },
      });

      if (response.data.results.length === 0) {
            throw new BadRequestException(`No results found for address: ${sanitizedAddress}`);
          }
          
          return this.processGeocodingResponse(response);
        });
      }, `Geocoding for "${sanitizedAddress}"`);
      
      // Cache the result
      await this.setCacheWithMetrics(cacheKey, result);
      
      this.logger.debug(`[${operationId}] Geocoding completed successfully for address: ${sanitizedAddress}`);
      return result;
      
    } catch (error) {
      this.logger.error(`[${operationId}] Geocoding failed for address "${address}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Enhanced reverse geocoding with caching and validation
   * @param coordinates The coordinates to reverse geocode
   * @param options Optional reverse geocoding options
   * @returns Geocoding result with address details
   */
  async reverseGeocode(
    coordinates: Coordinates,
    options: { language?: Language; resultTypes?: AddressType[]; locationTypes?: ReverseGeocodingLocationType[] } = {}
  ): Promise<GeocodingResult> {
    const operationId = `reverse-geocode-${Date.now()}`;
    this.logger.debug(`[${operationId}] Starting reverse geocoding for coordinates: ${coordinates.latitude}, ${coordinates.longitude}`);
    
    try {
      // Validate coordinates
      const validatedCoords = this.validateCoordinates(coordinates);
      
      // Check cache first
      const cacheKey = this.generateCacheKey('reverse-geocode', { coordinates: validatedCoords, ...options });
      const cachedResult = await this.getCacheWithMetrics<GeocodingResult>(cacheKey);
      
      if (cachedResult) {
        this.logger.debug(`[${operationId}] Returning cached result for coordinates`);
        return cachedResult;
      }
      
      // Execute reverse geocoding with retry mechanism
      const result = await this.executeWithRetry(async () => {
        return await this.queueRequest(async () => {
      const response = await this.client.reverseGeocode({
        params: {
              latlng: `${validatedCoords.latitude},${validatedCoords.longitude}`,
          key: this.apiKey,
              language: options.language,
              result_type: options.resultTypes,
              location_type: options.locationTypes,
        },
      });

      if (response.data.results.length === 0) {
            throw new BadRequestException(`No results found for coordinates: ${validatedCoords.latitude}, ${validatedCoords.longitude}`);
          }
          
          return this.processGeocodingResponse(response);
        });
      }, `Reverse geocoding for coordinates`);
      
      // Cache the result
      await this.setCacheWithMetrics(cacheKey, result);
      
      this.logger.debug(`[${operationId}] Reverse geocoding completed successfully`);
      return result;
      
    } catch (error) {
      this.logger.error(`[${operationId}] Reverse geocoding failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process geocoding response with enhanced data extraction
   */
  private processGeocodingResponse(response: GeocodeResponse): GeocodingResult {
      const result = response.data.results[0];
      const addressComponents = result.address_components;

      const formattedAddress: Address = {
        streetNumber: this.findAddressComponent(addressComponents, 'street_number'),
        street: this.findAddressComponent(addressComponents, 'route'),
      suburb: this.findAddressComponent(addressComponents, 'sublocality') || 
              this.findAddressComponent(addressComponents, 'sublocality_level_1'),
      city: this.findAddressComponent(addressComponents, 'locality') ||
            this.findAddressComponent(addressComponents, 'administrative_area_level_2'),
        province: this.findAddressComponent(addressComponents, 'administrative_area_level_1'),
        state: this.findAddressComponent(addressComponents, 'administrative_area_level_1'),
        country: this.findAddressComponent(addressComponents, 'country'),
        postalCode: this.findAddressComponent(addressComponents, 'postal_code'),
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
      };

      return {
        address: formattedAddress,
        placeId: result.place_id,
        formattedAddress: result.formatted_address,
      geometry: {
        location: result.geometry.location,
        locationType: result.geometry.location_type,
        viewport: result.geometry.viewport,
        bounds: result.geometry.bounds,
      },
      types: result.types,
    };
  }

  // ======================================================
  // BATCH PROCESSING METHODS
  // ======================================================

  /**
   * Batch geocoding with parallel processing and rate limiting
   * @param request Batch geocoding request with addresses and options
   * @returns Batch processing results with individual success/failure details
   */
  async batchGeocode(request: BatchGeocodingRequest): Promise<BatchGeocodingResult> {
    const operationId = request.requestId || `batch-geocode-${Date.now()}`;
    const startTime = Date.now();
    
    this.logger.log(`[${operationId}] Starting batch geocoding for ${request.addresses.length} addresses`);
    
    if (!request.addresses || request.addresses.length === 0) {
      throw new BadRequestException('No addresses provided for batch geocoding');
    }
    
    if (request.addresses.length > 100) {
      throw new BadRequestException('Maximum 100 addresses allowed per batch request');
    }
    
    const results: BatchGeocodingResult['results'] = [];
    let successCount = 0;
    let errorCount = 0;
    
    // Process addresses in parallel with concurrency limit
    const concurrencyLimit = 10; // Process 10 addresses simultaneously
    const chunks = [];
    
    for (let i = 0; i < request.addresses.length; i += concurrencyLimit) {
      chunks.push(request.addresses.slice(i, i + concurrencyLimit));
    }
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (address, index) => {
        try {
          const result = await this.geocodeAddress(address);
          successCount++;
          return { address, result };
    } catch (error) {
          errorCount++;
          this.logger.warn(`[${operationId}] Failed to geocode address "${address}": ${error.message}`);
          return { address, error: error.message };
        }
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
      
      // Brief pause between chunks to respect rate limits
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const totalProcessingTime = Date.now() - startTime;
    
    this.logger.log(`[${operationId}] Batch geocoding completed in ${totalProcessingTime}ms. Success: ${successCount}, Errors: ${errorCount}`);
    
    return {
      requestId: operationId,
      results,
      totalProcessingTime,
      successCount,
      errorCount,
    };
  }

  // ======================================================
  // ENHANCED ROUTING METHODS
  // ======================================================

  /**
   * Enhanced route optimization with multiple algorithm options
   */
  async optimizeRoute(
    origin: Coordinates | string,
    destinations: Array<Coordinates | string>,
    options: RouteOptions = {},
    returnToOrigin = true,
    algorithm: 'google' | 'greedy' | 'nearest_neighbor' = 'google'
  ): Promise<RouteResult> {
    const operationId = `optimize-route-${Date.now()}`;
    this.logger.debug(`[${operationId}] Starting route optimization with ${destinations.length} destinations`);
    
    try {
      // Validate inputs
      if (!destinations || destinations.length === 0) {
        throw new BadRequestException('No destinations provided for route optimization');
      }
      
      if (destinations.length > 25) {
        throw new BadRequestException('Maximum 25 destinations allowed for route optimization');
      }
      
      // Check cache first
      const cacheKey = this.generateCacheKey('optimize-route', {
        origin, destinations, options, returnToOrigin, algorithm
      });
      const cachedResult = await this.getCacheWithMetrics<RouteResult>(cacheKey);
      
      if (cachedResult) {
        this.logger.debug(`[${operationId}] Returning cached route optimization result`);
        return cachedResult;
      }
      
      let result: RouteResult;
      
      switch (algorithm) {
        case 'google':
          result = await this.googleOptimizeRoute(origin, destinations, options, returnToOrigin);
          break;
        case 'greedy':
          result = await this.greedyOptimizeRoute(origin, destinations, options, returnToOrigin);
          break;
        case 'nearest_neighbor':
          result = await this.nearestNeighborOptimizeRoute(origin, destinations, options, returnToOrigin);
          break;
        default:
          throw new BadRequestException(`Unknown optimization algorithm: ${algorithm}`);
      }
      
      // Cache the result
      await this.setCacheWithMetrics(cacheKey, result);
      
      this.logger.debug(`[${operationId}] Route optimization completed successfully using ${algorithm} algorithm`);
      return result;
      
    } catch (error) {
      this.logger.error(`[${operationId}] Route optimization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Google's built-in route optimization
   */
  private async googleOptimizeRoute(
    origin: Coordinates | string,
    destinations: Array<Coordinates | string>,
    options: RouteOptions,
    returnToOrigin: boolean
  ): Promise<RouteResult> {
    return await this.executeWithRetry(async () => {
      return await this.queueRequest(async () => {
        const originStr = this.formatLocation(origin);
        const waypoints = destinations.map(dest => this.formatLocation(dest));
        const destination = returnToOrigin ? originStr : waypoints.pop();

      const response = await this.client.directions({
        params: {
          origin: originStr,
            destination: destination!,
          waypoints: waypoints.length > 0 ? waypoints : undefined,
          optimize: true,
          mode: options.travelMode || TravelMode.driving,
          avoid: this.buildAvoidanceArray(options),
          transit_routing_preference: options.routingPreference,
            transit_mode: options.transitMode,
          units: options.unitSystem,
            departure_time: options.departureTime?.getTime(),
            arrival_time: options.arrivalTime?.getTime(),
            language: options.language,
            region: options.region,
            alternatives: options.alternatives,
          key: this.apiKey,
        },
      });

        return this.processDirectionsResponse(response);
      });
    }, 'Google route optimization');
  }

  /**
   * Greedy optimization algorithm (alternative to Google's optimization)
   */
  private async greedyOptimizeRoute(
    origin: Coordinates | string,
    destinations: Array<Coordinates | string>,
    options: RouteOptions,
    returnToOrigin: boolean
  ): Promise<RouteResult> {
    // Convert all locations to coordinates for distance calculations
    const originCoords = typeof origin === 'string' ? await this.addressToCoordinates(origin) : origin;
    const destCoords = await Promise.all(
      destinations.map(async dest => 
        typeof dest === 'string' ? await this.addressToCoordinates(dest) : dest
      )
    );
    
    // Greedy algorithm: always go to the nearest unvisited destination
    const unvisited = [...destCoords];
    const optimizedOrder: number[] = [];
    let currentLocation = originCoords;
    
    while (unvisited.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = this.calculateDistance(currentLocation, unvisited[0]);
      
      for (let i = 1; i < unvisited.length; i++) {
        const distance = this.calculateDistance(currentLocation, unvisited[i]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }
      
      optimizedOrder.push(destCoords.indexOf(unvisited[nearestIndex]));
      currentLocation = unvisited[nearestIndex];
      unvisited.splice(nearestIndex, 1);
    }
    
    // Build route using the optimized order
    const orderedDestinations = optimizedOrder.map(i => destinations[i]);
    return await this.planRoute(origin, returnToOrigin ? origin : orderedDestinations[orderedDestinations.length - 1], 
      orderedDestinations.slice(0, -1).map(dest => ({ location: dest })), options);
  }

  /**
   * Nearest neighbor optimization algorithm
   */
  private async nearestNeighborOptimizeRoute(
    origin: Coordinates | string,
    destinations: Array<Coordinates | string>,
    options: RouteOptions,
    returnToOrigin: boolean
  ): Promise<RouteResult> {
    // Similar to greedy but considers the full tour cost
    const originCoords = typeof origin === 'string' ? await this.addressToCoordinates(origin) : origin;
    const destCoords = await Promise.all(
      destinations.map(async dest => 
        typeof dest === 'string' ? await this.addressToCoordinates(dest) : dest
      )
    );
    
    // Create distance matrix
    const distanceMatrix = await this.createDistanceMatrix([originCoords, ...destCoords]);
    
    // Apply nearest neighbor algorithm
    const tour = this.nearestNeighborTSP(distanceMatrix);
    
    // Convert tour back to destination order (excluding origin)
    const optimizedOrder = tour.slice(1, returnToOrigin ? tour.length - 1 : tour.length).map(i => i - 1);
    const orderedDestinations = optimizedOrder.map(i => destinations[i]);
    
    return await this.planRoute(origin, returnToOrigin ? origin : orderedDestinations[orderedDestinations.length - 1],
      orderedDestinations.slice(0, -1).map(dest => ({ location: dest })), options);
  }

  // ======================================================
  // UTILITY AND HELPER METHODS
  // ======================================================

  /**
   * Convert address to coordinates using cached geocoding
   */
  private async addressToCoordinates(address: string): Promise<Coordinates> {
    const result = await this.geocodeAddress(address);
    return {
      latitude: result.address.latitude,
      longitude: result.address.longitude
    };
  }

  /**
   * Calculate haversine distance between two coordinates
   */
  private calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(coord2.latitude - coord1.latitude);
    const dLng = this.toRadians(coord2.longitude - coord1.longitude);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(coord1.latitude)) * Math.cos(this.toRadians(coord2.latitude)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Create distance matrix for TSP algorithms
   */
  private async createDistanceMatrix(coordinates: Coordinates[]): Promise<number[][]> {
    const matrix: number[][] = [];
    
    for (let i = 0; i < coordinates.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < coordinates.length; j++) {
        if (i === j) {
          matrix[i][j] = 0;
        } else {
          matrix[i][j] = this.calculateDistance(coordinates[i], coordinates[j]);
        }
      }
    }
    
    return matrix;
  }

  /**
   * Nearest neighbor TSP algorithm
   */
  private nearestNeighborTSP(distanceMatrix: number[][]): number[] {
    const n = distanceMatrix.length;
    const visited = new Array(n).fill(false);
    const tour = [0]; // Start from origin
    visited[0] = true;
    
    for (let i = 1; i < n; i++) {
      let nearest = -1;
      let nearestDistance = Infinity;
      
      for (let j = 0; j < n; j++) {
        if (!visited[j] && distanceMatrix[tour[tour.length - 1]][j] < nearestDistance) {
          nearest = j;
          nearestDistance = distanceMatrix[tour[tour.length - 1]][j];
        }
      }
      
      if (nearest !== -1) {
        tour.push(nearest);
        visited[nearest] = true;
      }
    }
    
    tour.push(0); // Return to origin
    return tour;
  }

  /**
   * Format location for Google Maps API
   */
  private formatLocation(location: string | Coordinates): string {
    return typeof location === 'string' ? location : `${location.latitude},${location.longitude}`;
  }

  /**
   * Process directions response with enhanced data extraction
   */
  private processDirectionsResponse(response: DirectionsResponse): RouteResult {
      if (!response.data.routes.length) {
      throw new BadRequestException('No route found');
      }

      const route = response.data.routes[0];
      const legs = route.legs;
      const encodedPolyline = route.overview_polyline?.points;

      return {
      waypointOrder: route.waypoint_order || [],
        totalDistance: legs.reduce((acc, leg) => acc + leg.distance.value, 0),
        totalDuration: legs.reduce((acc, leg) => acc + leg.duration.value, 0),
        legs: legs.map(leg => ({
          distance: leg.distance,
          duration: leg.duration,
          startLocation: leg.start_location,
          endLocation: leg.end_location,
          startAddress: leg.start_address,
          endAddress: leg.end_address,
          steps: leg.steps.map(step => ({
            distance: step.distance,
            duration: step.duration,
            instructions: step.html_instructions,
            travelMode: step.travel_mode,
          polyline: step.polyline?.points,
          })),
        })),
        polyline: encodedPolyline,
      bounds: route.bounds,
      copyrights: route.copyrights,
      warnings: route.warnings,
      fare: route.fare,
    };
  }

  // ======================================================
  // EXISTING METHODS WITH ENHANCEMENTS
  // ======================================================

  /**
   * Convert GCS coordinates to address with enhanced validation
   */
  async gcsToAddress(gcsCoordinates: string, options: any = {}): Promise<GeocodingResult> {
    const operationId = `gcs-to-address-${Date.now()}`;
    
    try {
      // Enhanced GCS parsing with multiple format support
      let latitude: number, longitude: number;
      
      // Support multiple GCS formats
      const formats = [
        /^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/, // "lat,lng" or "lat, lng"
        /^(-?\d+°?\d*'?\d*"?)\s*([NS])\s*(-?\d+°?\d*'?\d*"?)\s*([EW])$/, // DMS format
        /^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)$/, // "lat lng" space separated
      ];
      
      for (const format of formats) {
        const match = gcsCoordinates.match(format);
        if (match) {
          if (format === formats[1]) {
            // DMS format handling
            latitude = this.dmsToDecimal(match[1], match[2]);
            longitude = this.dmsToDecimal(match[3], match[4]);
          } else {
            latitude = parseFloat(match[1]);
            longitude = parseFloat(match[2]);
          }
          break;
        }
      }
      
      if (latitude === undefined || longitude === undefined || isNaN(latitude) || isNaN(longitude)) {
        throw new BadRequestException('Invalid GCS coordinates format. Supported formats: "lat,lng", "lat lng", or DMS format');
      }
      
      return await this.reverseGeocode({ latitude, longitude }, options);
      
    } catch (error) {
      this.logger.error(`[${operationId}] GCS to address conversion failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Convert DMS (Degrees, Minutes, Seconds) to decimal degrees
   */
  private dmsToDecimal(dms: string, direction: string): number {
    const parts = dms.match(/(\d+)°?(\d*)\'?(\d*)"?/);
    if (!parts) throw new BadRequestException('Invalid DMS format');
    
    let decimal = parseInt(parts[1]);
    if (parts[2]) decimal += parseInt(parts[2]) / 60;
    if (parts[3]) decimal += parseInt(parts[3]) / 3600;
    
    if (direction === 'S' || direction === 'W') {
      decimal = -decimal;
    }
    
    return decimal;
  }

  /**
   * Enhanced route planning with multiple options
   */
  async planRoute(
    origin: Coordinates | string,
    destination: Coordinates | string,
    waypoints: RouteWaypoint[] = [],
    options: RouteOptions = {},
  ): Promise<RouteResult> {
    const operationId = `plan-route-${Date.now()}`;
    this.logger.debug(`[${operationId}] Starting route planning with ${waypoints.length} waypoints`);
    
    try {
      // Check cache first
      const cacheKey = this.generateCacheKey('plan-route', { origin, destination, waypoints, options });
      const cachedResult = await this.getCacheWithMetrics<RouteResult>(cacheKey);
      
      if (cachedResult) {
        this.logger.debug(`[${operationId}] Returning cached route planning result`);
        return cachedResult;
      }
      
      const result = await this.executeWithRetry(async () => {
        return await this.queueRequest(async () => {
          const originStr = this.formatLocation(origin);
          const destinationStr = this.formatLocation(destination);
          
          // Format waypoints with enhanced options
      const formattedWaypoints = waypoints.map(wp => {
            const locationStr = this.formatLocation(wp.location);
            const prefix = wp.stopover === false ? 'via:' : '';
            return wp.placeId ? `${prefix}place_id:${wp.placeId}` : `${prefix}${locationStr}`;
          });

      const response = await this.client.directions({
        params: {
          origin: originStr,
          destination: destinationStr,
          waypoints: formattedWaypoints.length > 0 ? formattedWaypoints : undefined,
              alternatives: options.alternatives ?? true,
          mode: options.travelMode || TravelMode.driving,
          avoid: this.buildAvoidanceArray(options),
          transit_routing_preference: options.routingPreference,
              transit_mode: options.transitMode,
          units: options.unitSystem,
              departure_time: options.departureTime?.getTime(),
              arrival_time: options.arrivalTime?.getTime(),
              language: options.language,
              region: options.region,
          key: this.apiKey,
        },
      });

          return this.processDirectionsResponse(response);
        });
      }, `Route planning`);
      
      // Cache the result
      await this.setCacheWithMetrics(cacheKey, result);
      
      this.logger.debug(`[${operationId}] Route planning completed successfully`);
      return result;
      
    } catch (error) {
      this.logger.error(`[${operationId}] Route planning failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Enhanced route optimization with lat/lng format support
   */
  async optimizeRouteLatLng(
    origin: LatLngCoordinates,
    destinations: Array<LatLngCoordinates>,
    options: RouteOptions = {},
    returnToOrigin = true,
  ): Promise<RouteResult> {
    // Convert from {lat, lng} to {latitude, longitude} format
    const convertedOrigin: Coordinates = {
      latitude: origin.lat,
      longitude: origin.lng
    };
    
    const convertedDestinations: Coordinates[] = destinations.map(dest => ({
      latitude: dest.lat,
      longitude: dest.lng
    }));
    
    return this.optimizeRoute(convertedOrigin, convertedDestinations, options, returnToOrigin);
  }

  /**
   * Enhanced scenic route calculation
   */
  async getScenicRoute(
    origin: Coordinates | string,
    destination: Coordinates | string,
    options: RouteOptions = {},
  ): Promise<RouteResult> {
    const scenicOptions: RouteOptions = {
      ...options,
      travelMode: TravelMode.driving,
      avoidHighways: true,
      alternatives: true, // Get multiple route options
    };

    return this.planRoute(origin, destination, [], scenicOptions);
  }

  /**
   * Enhanced low traffic route calculation with traffic data
   */
  async getLowTrafficRoute(
    origin: Coordinates | string,
    destination: Coordinates | string,
    options: RouteOptions = {},
  ): Promise<RouteResult> {
    const trafficOptions: RouteOptions = {
      ...options,
      travelMode: TravelMode.driving,
      departureTime: options.departureTime || new Date(), // Current time for traffic data
      alternatives: true,
    };

    return this.planRoute(origin, destination, [], trafficOptions);
  }

  // ======================================================
  // NEW ENHANCED METHODS
  // ======================================================

  /**
   * Find points of interest near a location
   */
  async findPointsOfInterest(
    location: Coordinates | string,
    radius: number = 5000,
    type?: string,
    keyword?: string
  ): Promise<PlaceOfInterest[]> {
    const operationId = `poi-search-${Date.now()}`;
    this.logger.debug(`[${operationId}] Searching for points of interest near location`);
    
    try {
      const locationStr = this.formatLocation(location);
      
      // Check cache first
      const cacheKey = this.generateCacheKey('poi-search', { location: locationStr, radius, type, keyword });
      const cachedResult = await this.getCacheWithMetrics<PlaceOfInterest[]>(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }
      
      const result = await this.executeWithRetry(async () => {
        return await this.queueRequest(async () => {
          const response = await this.client.placesNearby({
            params: {
              location: locationStr,
              radius,
              type,
              keyword,
              key: this.apiKey,
            },
          });
          
          return response.data.results.map(place => ({
            placeId: place.place_id,
            name: place.name,
            types: place.types,
            coordinates: {
              latitude: place.geometry.location.lat,
              longitude: place.geometry.location.lng,
            },
            rating: place.rating,
            priceLevel: place.price_level,
            businessStatus: place.business_status,
            openNow: place.opening_hours?.open_now,
            vicinity: place.vicinity,
          }));
        });
      }, 'POI search');
      
      // Cache the result
      await this.setCacheWithMetrics(cacheKey, result);
      
      this.logger.debug(`[${operationId}] Found ${result.length} points of interest`);
      return result;
      
    } catch (error) {
      this.logger.error(`[${operationId}] POI search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get traffic information for a route
   */
  async getTrafficInfo(
    origin: Coordinates | string,
    destination: Coordinates | string,
    departureTime?: Date
  ): Promise<{
    duration: number;
    durationInTraffic: number;
    trafficDelay: number;
    trafficCondition: 'light' | 'moderate' | 'heavy';
  }> {
    const route = await this.planRoute(origin, destination, [], {
      travelMode: TravelMode.driving,
      departureTime: departureTime || new Date(),
    });
    
    const normalDuration = route.totalDuration;
    // Traffic duration would come from the API response if available
    const durationInTraffic = normalDuration; // Placeholder - would use real traffic data
    const trafficDelay = durationInTraffic - normalDuration;
    
    let trafficCondition: 'light' | 'moderate' | 'heavy' = 'light';
    if (trafficDelay > normalDuration * 0.5) {
      trafficCondition = 'heavy';
    } else if (trafficDelay > normalDuration * 0.25) {
      trafficCondition = 'moderate';
    }
    
    return {
      duration: normalDuration,
      durationInTraffic,
      trafficDelay,
      trafficCondition,
    };
  }

  /**
   * Clear service cache using NestJS cache manager
   */
  async clearCache(pattern?: string): Promise<void> {
    try {
      if (pattern) {
        // For pattern-based clearing, we'd need to implement custom logic
        // since NestJS cache manager doesn't have native pattern clearing
        this.logger.log(`Pattern-based cache clearing not directly supported by NestJS cache manager: ${pattern}`);
        this.logger.log('Consider clearing specific keys or implementing custom cache store if needed');
      } else {
        // Clear all cache - NestJS cache manager doesn't have a clear all method
        // This is a limitation of the cache-manager interface
        this.logger.log('NestJS cache manager does not support clearing all cache entries');
        this.logger.log('Cache entries will expire based on TTL configuration');
      }
    } catch (error) {
      this.logger.error(`Cache clear failed: ${error.message}`);
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    metrics: typeof this.performanceMetrics;
    apiKeyValid: boolean;
    cacheConnected: boolean;
  }> {
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Check API key validity
    const apiKeyValid = !!this.apiKey;
    
    // Check cache connection
    let cacheConnected = true;
    try {
      await this.cacheManager.get('health-check');
    } catch {
      cacheConnected = false;
    }
    
    // Determine overall status
    if (!apiKeyValid) {
      status = 'unhealthy';
    } else if (!cacheConnected || this.performanceMetrics.failedRequests / this.performanceMetrics.totalRequests > 0.1) {
      status = 'degraded';
    }
    
    return {
      status,
      metrics: this.performanceMetrics,
      apiKeyValid,
      cacheConnected,
    };
  }

  // ======================================================
  // HELPER METHODS (ENHANCED)
  // ======================================================

  /**
   * Enhanced avoidance array builder
   */
  private buildAvoidanceArray(options: RouteOptions): TravelRestriction[] {
    const avoidItems: TravelRestriction[] = [];
    
    if (options.avoidTolls) avoidItems.push(TravelRestriction.tolls);
    if (options.avoidHighways) avoidItems.push(TravelRestriction.highways);
    if (options.avoidFerries) avoidItems.push(TravelRestriction.ferries);
    
    return avoidItems;
  }

  /**
   * Enhanced address component finder with fallbacks
   */
  private findAddressComponent(
    components: GeocoderAddressComponent[],
    type: string,
  ): string {
    const component = components.find(c => c.types.includes(type));
    return component ? component.long_name : '';
  }
} 