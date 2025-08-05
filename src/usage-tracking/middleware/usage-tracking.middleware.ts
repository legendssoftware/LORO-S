import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { UsageTrackingService } from '../usage-tracking.service';
import { CreateUsageEventDto } from '../dto/create-usage-event.dto';
import { UsageEventStatus, UsageEventType } from '../entities/usage-event.entity';
import { ConfigService } from '@nestjs/config';
import { UAParser } from 'ua-parser-js';

export interface ExtendedRequest extends Request {
	user?: {
		uid: number;
		organisationId?: number;
		branchId?: number;
		email?: string;
		accessLevel?: string;
	};
	startTime?: number;
	usageData?: Partial<CreateUsageEventDto>;
}

@Injectable()
export class UsageTrackingMiddleware implements NestMiddleware {
	private readonly logger = new Logger(UsageTrackingMiddleware.name);
	private readonly isEnabled: boolean;
	private readonly excludePaths: string[];
	private readonly includeHeaders: string[];

	constructor(
		private readonly usageTrackingService: UsageTrackingService,
		private readonly configService: ConfigService,
	) {
		this.isEnabled = this.configService.get<boolean>('USAGE_TRACKING_ENABLED', true);
		this.excludePaths = this.configService.get<string>('USAGE_TRACKING_EXCLUDE_PATHS', '/health,/metrics')
			.split(',')
			.map(path => path.trim());
		this.includeHeaders = this.configService.get<string>('USAGE_TRACKING_INCLUDE_HEADERS', 'authorization,x-api-key,x-client-version')
			.split(',')
			.map(header => header.trim().toLowerCase());
	}

	use(req: ExtendedRequest, res: Response, next: NextFunction): void {
		if (!this.isEnabled || this.shouldExcludePath(req.path)) {
			return next();
		}

		// Record start time
		req.startTime = Date.now();

		// Extract request metadata
		req.usageData = this.extractRequestMetadata(req);

		// Hook into response to capture response data
		this.hookResponseEnd(req, res);

		next();
	}

	private shouldExcludePath(path: string): boolean {
		return this.excludePaths.some(excludePath => 
			path.startsWith(excludePath) || path.includes(excludePath)
		);
	}

	private extractRequestMetadata(req: ExtendedRequest): Partial<CreateUsageEventDto> {
		const userAgent = req.get('User-Agent') || '';
		const parsedUA = new UAParser(userAgent);
		const forwardedFor = req.get('X-Forwarded-For');
		const realIP = req.get('X-Real-IP');
		const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIP || req.ip || req.connection.remoteAddress;

		// Extract device and browser information
		const browser = parsedUA.getBrowser();
		const os = parsedUA.getOS();
		const device = parsedUA.getDevice();

		// Determine device type
		let deviceType = 'desktop';
		if (device.type) {
			deviceType = device.type; // mobile, tablet, etc.
		} else if (userAgent.includes('Mobile')) {
			deviceType = 'mobile';
		} else if (userAgent.includes('Tablet')) {
			deviceType = 'tablet';
		}

		// Extract relevant headers
		const headers: Record<string, string> = {};
		this.includeHeaders.forEach(headerName => {
			const value = req.get(headerName);
			if (value) {
				headers[headerName] = value;
			}
		});

		// Calculate request size
		const contentLength = req.get('Content-Length');
		const requestSizeBytes = contentLength ? parseInt(contentLength, 10) : undefined;

		return {
			userId: req.user?.uid,
			organisationId: req.user?.organisationId,
			branchId: req.user?.branchId,
			endpoint: `${req.method} ${req.route?.path || req.path}`,
			method: req.method,
			eventType: this.determineEventType(req),
			userAgent,
			ipAddress,
			requestSizeBytes,
			deviceType,
			deviceModel: device.model || undefined,
			browserName: browser.name || undefined,
			browserVersion: browser.version || undefined,
			osName: os.name || undefined,
			osVersion: os.version || undefined,
			clientVersion: req.get('X-Client-Version') || req.get('X-App-Version') || undefined,
			headers,
			metadata: {
				url: req.url,
				query: req.query,
				protocol: req.protocol,
				secure: req.secure,
				hostname: req.hostname,
				referer: req.get('Referer'),
				origin: req.get('Origin'),
			},
		};
	}

	private determineEventType(req: ExtendedRequest): UsageEventType {
		const path = req.path.toLowerCase();
		const method = req.method.toUpperCase();

		// File operations
		if (path.includes('/upload') || path.includes('/file')) {
			return method === 'GET' ? UsageEventType.FILE_DOWNLOAD : UsageEventType.FILE_UPLOAD;
		}

		// Report generation
		if (path.includes('/report') || path.includes('/export')) {
			return UsageEventType.REPORT_GENERATION;
		}

		// Email operations
		if (path.includes('/email') || path.includes('/send')) {
			return UsageEventType.EMAIL_SEND;
		}

		// Notification operations
		if (path.includes('/notification')) {
			return UsageEventType.NOTIFICATION_SEND;
		}

		// Authentication operations
		if (path.includes('/auth') || path.includes('/login') || path.includes('/token')) {
			return UsageEventType.AUTHENTICATION;
		}

		// Default to API request
		return UsageEventType.API_REQUEST;
	}

	private determineStatus(statusCode: number): UsageEventStatus {
		if (statusCode >= 200 && statusCode < 300) {
			return UsageEventStatus.SUCCESS;
		} else if (statusCode === 401) {
			return UsageEventStatus.UNAUTHORIZED;
		} else if (statusCode === 403) {
			return UsageEventStatus.FORBIDDEN;
		} else if (statusCode === 404) {
			return UsageEventStatus.NOT_FOUND;
		} else if (statusCode === 408) {
			return UsageEventStatus.TIMEOUT;
		} else if (statusCode >= 500) {
			return UsageEventStatus.SERVER_ERROR;
		} else {
			return UsageEventStatus.FAILED;
		}
	}

	private hookResponseEnd(req: ExtendedRequest, res: Response): void {
		const originalEnd = res.end;
		const originalWrite = res.write;
		let responseSize = 0;

		// Track response size
		res.write = function(chunk: any, ...args: any[]): boolean {
			if (chunk) {
				responseSize += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk.toString());
			}
			return originalWrite.apply(this, [chunk, ...args]);
		};

		res.end = (chunk?: any, ...args: any[]): Response => {
			if (chunk) {
				responseSize += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk.toString());
			}

			// Calculate duration
			const durationMs = req.startTime ? Date.now() - req.startTime : 0;

			// Create usage event
			const usageEvent: CreateUsageEventDto = {
				...req.usageData!,
				endpoint: req.usageData!.endpoint || `${req.method} ${req.path}`, // Ensure endpoint is always provided
				method: req.usageData!.method || req.method, // Ensure method is always provided
				eventType: req.usageData!.eventType || this.determineEventType(req), // Ensure eventType is always provided
				status: this.determineStatus(res.statusCode),
				httpStatusCode: res.statusCode,
				durationMs,
				responseSizeBytes: responseSize,
			};

			// Record usage event asynchronously
			this.recordUsageEventAsync(usageEvent, req);

			return originalEnd.apply(res, [chunk, ...args]);
		};
	}

	private async recordUsageEventAsync(usageEvent: CreateUsageEventDto, req: ExtendedRequest): Promise<void> {
		try {
			// Add geographic information if available (you might want to integrate with a GeoIP service)
			await this.enrichWithGeographicData(usageEvent, req);

			// Add license feature information based on endpoint
			this.addLicenseFeatureData(usageEvent, req);

			// Record the usage event
			await this.usageTrackingService.recordUsageEvent(usageEvent);

			this.logger.debug(`[USAGE_MIDDLEWARE] Recorded usage event for ${usageEvent.endpoint} - ${usageEvent.status} (${usageEvent.durationMs}ms)`);
		} catch (error) {
			this.logger.error(`[USAGE_MIDDLEWARE] Failed to record usage event: ${error.message}`, error.stack);
			// Don't throw error to avoid affecting the main request flow
		}
	}

	private async enrichWithGeographicData(usageEvent: CreateUsageEventDto, req: ExtendedRequest): Promise<void> {
		// You can integrate with services like MaxMind GeoIP, ipapi.co, or similar
		// For now, we'll add a placeholder implementation
		if (usageEvent.ipAddress && !this.isPrivateIP(usageEvent.ipAddress)) {
			try {
				// Example integration with a GeoIP service
				// const geoData = await this.geoIpService.lookup(usageEvent.ipAddress);
				// usageEvent.country = geoData.country;
				// usageEvent.region = geoData.region;
				// usageEvent.city = geoData.city;

				// Placeholder - you can implement actual GeoIP lookup
				usageEvent.country = 'Unknown';
			} catch (error) {
				this.logger.warn(`[USAGE_MIDDLEWARE] Failed to get geographic data for IP ${usageEvent.ipAddress}: ${error.message}`);
			}
		}
	}

	private isPrivateIP(ip: string): boolean {
		// Check if IP is private/local
		const privateRanges = [
			/^127\./, // localhost
			/^192\.168\./, // private class C
			/^10\./, // private class A
			/^172\.(1[6-9]|2\d|3[01])\./, // private class B
			/^::1$/, // IPv6 localhost
			/^fc00:/, // IPv6 private
		];

		return privateRanges.some(range => range.test(ip));
	}

	private addLicenseFeatureData(usageEvent: CreateUsageEventDto, req: ExtendedRequest): void {
		const path = req.path.toLowerCase();

		// Map endpoints to license features
		const featureMap: Record<string, { feature: string; quota: number }> = {
			'/leads': { feature: 'leads_management', quota: 1 },
			'/clients': { feature: 'client_management', quota: 1 },
			'/tasks': { feature: 'task_management', quota: 1 },
			'/reports': { feature: 'reporting', quota: 5 },
			'/analytics': { feature: 'analytics', quota: 10 },
			'/email': { feature: 'email_communications', quota: 1 },
			'/notifications': { feature: 'notifications', quota: 1 },
			'/storage': { feature: 'file_storage', quota: 1 },
			'/api': { feature: 'api_access', quota: 1 },
		};

		// Find matching feature
		const matchedFeature = Object.entries(featureMap).find(([endpoint]) => 
			path.includes(endpoint)
		);

		if (matchedFeature) {
			const [, { feature, quota }] = matchedFeature;
			usageEvent.licenseFeature = feature;
			usageEvent.licenseQuotaConsumed = quota;
		}
	}
}