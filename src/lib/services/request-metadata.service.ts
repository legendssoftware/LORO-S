import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UAParser } from 'ua-parser-js';

export interface RequestMetadata {
	ipAddress: string;
	userAgent: string;
	deviceType: string;
	deviceModel?: string;
	browserName: string;
	browserVersion?: string;
	osName: string;
	osVersion?: string;
	country?: string;
	region?: string;
	city?: string;
	timezone?: string;
	isp?: string;
	organization?: string;
	isVPN?: boolean;
	isTor?: boolean;
	isProxy?: boolean;
	threatLevel?: 'low' | 'medium' | 'high';
	headers: Record<string, string>;
	clientVersion?: string;
	platform?: string;
	security: {
		isPrivateIP: boolean;
		isKnownBot: boolean;
		suspiciousActivity: boolean;
		riskScore: number;
	};
}

@Injectable()
export class RequestMetadataService {
	private readonly logger = new Logger(RequestMetadataService.name);
	private readonly includeHeaders: string[];
	private readonly isGeoEnabled: boolean;

	constructor(private readonly configService: ConfigService) {
		this.includeHeaders = this.configService
			.get<string>('REQUEST_METADATA_HEADERS', 'authorization,x-api-key,x-client-version,x-app-version,accept-language,referer,origin')
			.split(',')
			.map(header => header.trim().toLowerCase());
		
		this.isGeoEnabled = this.configService.get<boolean>('GEOLOCATION_ENABLED', false);
	}

	/**
	 * Extract comprehensive metadata from an HTTP request
	 */
	async extractRequestMetadata(req: Request): Promise<RequestMetadata> {
		const startTime = Date.now();
		this.logger.debug('[EXTRACT_METADATA] Extracting request metadata');

		try {
			// Basic extraction
			const ipAddress = this.extractIpAddress(req);
			const userAgent = req.get('User-Agent') || '';
			const parsedUA = new UAParser(userAgent);

			// Device information
			const browser = parsedUA.getBrowser();
			const os = parsedUA.getOS();
			const device = parsedUA.getDevice();

			// Device type determination
			const deviceType = this.determineDeviceType(device, userAgent);

			// Extract relevant headers
			const headers = this.extractHeaders(req);

			// Geographic information
			const geoData = await this.extractGeographicData(ipAddress, req);

			// Security analysis
			const security = this.analyzeSecurityRisk(req, ipAddress, userAgent);

			// Client version information
			const clientVersion = req.get('X-Client-Version') || req.get('X-App-Version') || undefined;
			const platform = req.get('X-Platform') || this.determinePlatform(os.name, device.type);

			const executionTime = Date.now() - startTime;
			this.logger.debug(`[EXTRACT_METADATA] Metadata extracted successfully in ${executionTime}ms`);

			return {
				ipAddress,
				userAgent,
				deviceType,
				deviceModel: device.model || undefined,
				browserName: browser.name || 'Unknown',
				browserVersion: browser.version || undefined,
				osName: os.name || 'Unknown',
				osVersion: os.version || undefined,
				country: geoData.country,
				region: geoData.region,
				city: geoData.city,
				timezone: geoData.timezone,
				isp: geoData.isp,
				organization: geoData.organization,
				isVPN: geoData.isVPN,
				isTor: geoData.isTor,
				isProxy: geoData.isProxy,
				threatLevel: geoData.threatLevel,
				headers,
				clientVersion,
				platform,
				security,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[EXTRACT_METADATA] Failed to extract metadata after ${executionTime}ms. Error: ${error.message}`, error.stack);
			
			// Return minimal metadata on error
			return this.getMinimalMetadata(req);
		}
	}

	/**
	 * Extract IP address with comprehensive fallback logic
	 */
	private extractIpAddress(req: Request): string {
		// Check various headers in order of reliability
		const headers = [
			'cf-connecting-ip', // Cloudflare
			'x-forwarded-for', // Standard proxy header
			'x-real-ip', // Nginx
			'x-client-ip', // Apache
			'x-forwarded', // Less common
			'forwarded-for', // RFC 7239
			'forwarded', // RFC 7239
		];

		for (const header of headers) {
			const value = req.get(header);
			if (value) {
				// Handle comma-separated IPs (take the first one)
				const ip = value.split(',')[0].trim();
				if (this.isValidIP(ip)) {
					return ip;
				}
			}
		}

		// Fallback to connection IP
		const connectionIP = req.connection?.remoteAddress || 
						   req.socket?.remoteAddress || 
						   (req.connection as any)?.socket?.remoteAddress ||
						   req.ip;

		return connectionIP || 'Unknown';
	}

	/**
	 * Determine device type with enhanced logic
	 */
	private determineDeviceType(device: any, userAgent: string): string {
		if (device.type) {
			return device.type.charAt(0).toUpperCase() + device.type.slice(1);
		}

		const ua = userAgent.toLowerCase();
		
		// Mobile devices
		if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || 
			ua.includes('windows phone') || ua.includes('blackberry')) {
			return 'Mobile';
		}
		
		// Tablets
		if (ua.includes('tablet') || ua.includes('ipad') || ua.includes('kindle') ||
			(ua.includes('android') && !ua.includes('mobile'))) {
			return 'Tablet';
		}
		
		// Smart TVs
		if (ua.includes('tv') || ua.includes('roku') || ua.includes('chromecast')) {
			return 'TV';
		}
		
		// Game consoles
		if (ua.includes('playstation') || ua.includes('xbox') || ua.includes('nintendo')) {
			return 'Console';
		}
		
		// Wearables
		if (ua.includes('watch') || ua.includes('wearable')) {
			return 'Wearable';
		}

		return 'Desktop';
	}

	/**
	 * Extract relevant headers
	 */
	private extractHeaders(req: Request): Record<string, string> {
		const headers: Record<string, string> = {};
		
		this.includeHeaders.forEach(headerName => {
			const value = req.get(headerName);
			if (value) {
				// Sanitize sensitive headers
				if (headerName === 'authorization') {
					headers[headerName] = value.startsWith('Bearer ') ? 'Bearer [REDACTED]' : '[REDACTED]';
				} else {
					headers[headerName] = value;
				}
			}
		});

		return headers;
	}

	/**
	 * Extract geographic data from IP and headers
	 */
	private async extractGeographicData(ipAddress: string, req: Request): Promise<any> {
		try {
			// Check Cloudflare headers first (if using Cloudflare)
			const cfCountry = req.get('CF-IPCountry');
			const cfRegion = req.get('CF-Region');
			const cfCity = req.get('CF-IPCity');
			const cfTimezone = req.get('CF-Timezone');

			if (cfCountry) {
				return {
					country: cfCountry,
					region: cfRegion,
					city: cfCity,
					timezone: cfTimezone,
					isVPN: false,
					isTor: false,
					isProxy: false,
					threatLevel: 'low',
				};
			}

			// Skip GeoIP lookup for private IPs
			if (this.isPrivateIP(ipAddress) || !this.isGeoEnabled) {
				return {
					country: undefined,
					region: undefined,
					city: undefined,
					timezone: undefined,
					isVPN: false,
					isTor: false,
					isProxy: false,
					threatLevel: 'low',
				};
			}

			// TODO: Integrate with a GeoIP service like MaxMind, ipapi, or similar
			// For now, return placeholder data
			return {
				country: undefined,
				region: undefined,
				city: undefined,
				timezone: undefined,
				isp: undefined,
				organization: undefined,
				isVPN: false,
				isTor: false,
				isProxy: false,
				threatLevel: 'low',
			};
		} catch (error) {
			this.logger.warn(`[EXTRACT_GEO] Failed to extract geographic data: ${error.message}`);
			return {
				country: undefined,
				region: undefined,
				city: undefined,
				timezone: undefined,
				isVPN: false,
				isTor: false,
				isProxy: false,
				threatLevel: 'low',
			};
		}
	}

	/**
	 * Analyze security risks based on request characteristics
	 */
	private analyzeSecurityRisk(req: Request, ipAddress: string, userAgent: string): RequestMetadata['security'] {
		let riskScore = 0;
		let suspiciousActivity = false;

		const isPrivateIP = this.isPrivateIP(ipAddress);
		const isKnownBot = this.detectBot(userAgent);

		// Risk factors
		if (!userAgent || userAgent.length < 10) {
			riskScore += 30; // Missing or very short user agent
			suspiciousActivity = true;
		}

		if (isKnownBot) {
			riskScore += 20; // Automated bot
		}

		// Check for common attack patterns in user agent
		const suspiciousPatterns = [
			'sqlmap', 'nikto', 'nmap', 'masscan', 'nessus',
			'<script', 'javascript:', 'eval(', 'union select',
			'../../../', '../../../../'
		];

		if (suspiciousPatterns.some(pattern => userAgent.toLowerCase().includes(pattern))) {
			riskScore += 50;
			suspiciousActivity = true;
		}

		// Check for missing common headers
		if (!req.get('Accept') || !req.get('Accept-Language')) {
			riskScore += 10;
		}

		// Rate limiting headers (if implemented)
		const rateLimitRemaining = req.get('X-RateLimit-Remaining');
		if (rateLimitRemaining && parseInt(rateLimitRemaining) < 5) {
			riskScore += 20;
			suspiciousActivity = true;
		}

		return {
			isPrivateIP,
			isKnownBot,
			suspiciousActivity,
			riskScore: Math.min(riskScore, 100), // Cap at 100
		};
	}

	/**
	 * Determine platform based on OS and device type
	 */
	private determinePlatform(osName?: string, deviceType?: string): string {
		if (!osName) return 'unknown';

		const os = osName.toLowerCase();
		
		if (os.includes('android')) return 'android';
		if (os.includes('ios') || os.includes('iphone') || os.includes('ipad')) return 'ios';
		if (os.includes('windows')) return 'windows';
		if (os.includes('mac')) return 'macos';
		if (os.includes('linux')) return 'linux';
		
		return 'unknown';
	}

	/**
	 * Check if IP address is valid
	 */
	private isValidIP(ip: string): boolean {
		const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
		const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
		
		return ipv4Regex.test(ip) || ipv6Regex.test(ip);
	}

	/**
	 * Check if IP address is private/local
	 */
	private isPrivateIP(ip: string): boolean {
		const privateRanges = [
			/^127\./, // localhost
			/^192\.168\./, // private class C
			/^10\./, // private class A
			/^172\.(1[6-9]|2\d|3[01])\./, // private class B
			/^::1$/, // IPv6 localhost
			/^fc00:/, // IPv6 private
			/^fe80:/, // IPv6 link-local
		];

		return privateRanges.some(range => range.test(ip));
	}

	/**
	 * Detect if user agent belongs to a known bot
	 */
	private detectBot(userAgent: string): boolean {
		const botPatterns = [
			'bot', 'crawler', 'spider', 'scraper', 'crawl', 'probe',
			'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
			'yandexbot', 'facebookexternalhit', 'twitterbot', 'linkedinbot',
			'whatsapp', 'telegram', 'slack', 'discord', 'curl', 'wget',
			'python-requests', 'java/', 'okhttp', 'apache-httpclient'
		];

		const ua = userAgent.toLowerCase();
		return botPatterns.some(pattern => ua.includes(pattern));
	}

	/**
	 * Get minimal metadata when full extraction fails
	 */
	private getMinimalMetadata(req: Request): RequestMetadata {
		return {
			ipAddress: this.extractIpAddress(req),
			userAgent: req.get('User-Agent') || 'Unknown',
			deviceType: 'Unknown',
			browserName: 'Unknown',
			osName: 'Unknown',
			headers: {},
			security: {
				isPrivateIP: false,
				isKnownBot: false,
				suspiciousActivity: false,
				riskScore: 0,
			},
		};
	}
}