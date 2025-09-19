import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger, Inject } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { LicenseUsageService } from './license-usage.service';
import { MetricType } from '../lib/enums/licenses';
import { LicensingService } from './licensing.service';
import { Request } from 'express';
import { Token } from '../lib/types/token';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { of } from 'rxjs';

// Custom timeout error class
class LicenseTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LicenseTimeoutError';
	}
}

@Injectable()
export class LicenseUsageInterceptor implements NestInterceptor {
	private readonly logger = new Logger(LicenseUsageInterceptor.name);
	private readonly LICENSE_CACHE_TTL = 300; // 5 minutes cache
	private readonly LICENSE_QUERY_TIMEOUT = 2000; // 2 seconds timeout for license queries
	private readonly licenseCache = new Map<string, { license: any; timestamp: number }>();

	constructor(
		private readonly licenseUsageService: LicenseUsageService,
		private readonly licensingService: LicensingService,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
	) {}

	async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
		const request = context.switchToHttp().getRequest<Request>();
		const user = request['user'] as Token;

		// Skip if no user or no license info
		if (!user?.licenseId) {
			return next.handle();
		}

		const startTime = Date.now();
		const path = request.path;
		const method = request.method;

		try {
			// Get the license object with caching and timeout
			const license = await this.getLicenseWithCache(user.licenseId);

			if (!license) {
				// Log warning only once per minute per license to avoid spam
				const logKey = `license_warning_${user.licenseId}`;
				const lastLog = await this.cacheManager.get(logKey);
				
				if (!lastLog) {
					this.logger.warn(`⚠️ No valid license found for user ${user.uid} (license ID: ${user.licenseId})`);
					await this.cacheManager.set(logKey, new Date().toISOString(), 60); // Cache warning for 1 minute
				}
				
				return next.handle();
			}

			const endpoint = request.originalUrl || request.path || 'unknown';
			const response = context.switchToHttp().getResponse();
			const statusCode = response.statusCode || 200;
			const userAgent = request.headers['user-agent'] || 'unknown';

			return next.handle().pipe(
				tap(async () => {
					try {
						// Track API call usage asynchronously to avoid blocking the response
						setImmediate(async () => {
							try {
								await this.licenseUsageService.trackUsage(license, MetricType.API_CALLS, 1, {
									endpoint,
									method,
									statusCode,
									userAgent,
									ip: request.ip,
									duration: Date.now() - startTime,
									timestamp: new Date().toISOString(),
									userId: user.uid,
								});

								// Track storage usage for file uploads
								if (request.file || request.files) {
									const totalSize = this.calculateUploadSize(request.file || request.files);
									if (totalSize > 0) {
										await this.licenseUsageService.trackUsage(license, MetricType.STORAGE, totalSize, {
											path,
											method,
											fileCount: Array.isArray(request.files) ? request.files.length : 1,
											timestamp: new Date().toISOString(),
											userId: user.uid,
										});
									}
								}
							} catch (usageError) {
								// Only log usage tracking errors once per minute to avoid spam
								const errorKey = `usage_error_${user.licenseId}`;
								const lastErrorLog = await this.cacheManager.get(errorKey);
								
								if (!lastErrorLog) {
									this.logger.error(`❌ Failed to track license usage for license ${user.licenseId}: ${usageError.message}`);
									await this.cacheManager.set(errorKey, new Date().toISOString(), 60);
								}
							}
						});
					} catch (error) {
						// Silent fail for usage tracking - don't affect the main request
					}
				}),
				catchError((error) => {
					// Handle any errors in the main request flow
					this.logger.error(`❌ Error in license interceptor request flow: ${error.message}`);
					return of(error);
				})
			);
		} catch (error) {
			// Handle license lookup errors
			if (error.code === 'ETIMEDOUT' || error instanceof LicenseTimeoutError) {
				this.logger.warn(`⏱️ License lookup timeout for user ${user.uid} (license ${user.licenseId}) - proceeding without tracking`);
			} else {
				// Only log other errors once per minute per license
				const errorKey = `interceptor_error_${user.licenseId}`;
				const lastErrorLog = await this.cacheManager.get(errorKey);
				
				if (!lastErrorLog) {
					this.logger.error(`❌ Error in license interceptor for license ${user.licenseId}: ${error.message}`);
					await this.cacheManager.set(errorKey, new Date().toISOString(), 60);
				}
			}

			// Continue with the request even if license lookup fails
			return next.handle();
		}
	}

	/**
	 * Get license with local caching and timeout handling
	 */
	private async getLicenseWithCache(licenseId: string): Promise<any> {
		const cacheKey = `license_${licenseId}`;
		const now = Date.now();

		// Check local cache first
		const cached = this.licenseCache.get(cacheKey);
		if (cached && (now - cached.timestamp) < this.LICENSE_CACHE_TTL * 1000) {
			return cached.license;
		}

		// Check Redis cache
		try {
			const redisCached = await this.cacheManager.get(cacheKey);
			if (redisCached) {
				this.licenseCache.set(cacheKey, { license: redisCached, timestamp: now });
				return redisCached;
			}
		} catch (redisError) {
			// Redis cache failure shouldn't block the request
		}

		// Fetch from database with timeout
		try {
			const licensePromise = this.licensingService.findOne(licenseId);
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new LicenseTimeoutError('License query timeout')), this.LICENSE_QUERY_TIMEOUT);
			});

			const license = await Promise.race([licensePromise, timeoutPromise]);

			if (license) {
				// Cache the result locally and in Redis
				this.licenseCache.set(cacheKey, { license, timestamp: now });
				await this.cacheManager.set(cacheKey, license, this.LICENSE_CACHE_TTL);
			}

			return license;
		} catch (error) {
			if (error instanceof LicenseTimeoutError || error.code === 'ETIMEDOUT') {
				throw new LicenseTimeoutError('License lookup timeout');
			}
			throw error;
		}
	}

	private calculateUploadSize(files: any): number {
		if (!files) return 0;

		try {
			if (Array.isArray(files)) {
				return files.reduce((total, file) => {
					return total + (file?.size || 0);
				}, 0);
			}
			return files?.size || 0;
		} catch (error) {
			this.logger.error(`Error calculating upload size: ${error.message}`);
			return 0;
		}
	}
}