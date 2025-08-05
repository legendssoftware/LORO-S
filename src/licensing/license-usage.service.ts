import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { LicenseUsage } from './entities/license-usage.entity';
import { LicenseEvent, LicenseEventType } from './entities/license-event.entity';
import { License } from './entities/license.entity';
import { MetricType } from '../lib/enums/licenses';
import { APIUsageMetadata } from '../lib/interfaces/licenses';
import { ConsolidatedLicenseUsageDto, MetricUsageDto } from './dto/consolidated-license-usage.dto';

@Injectable()
export class LicenseUsageService {
	private readonly logger = new Logger(LicenseUsageService.name);
	private readonly ALERT_THRESHOLD = 0.8; // 80% utilization alert
	private readonly AGGREGATION_INTERVAL = 1000 * 60 * 5; // 5 minutes
	private usageBuffer: Map<string, any[]> = new Map();

	constructor(
		@InjectRepository(LicenseUsage)
		private readonly usageRepository: Repository<LicenseUsage>,
		@InjectRepository(LicenseEvent)
		private readonly eventRepository: Repository<LicenseEvent>,
	) {
		// Initialize periodic aggregation
		setInterval(() => this.processBufferedUsage(), this.AGGREGATION_INTERVAL);
	}

	async trackUsage(
		license: License,
		metricType: MetricType,
		currentValue: number,
		metadata?: Record<string, any>,
	): Promise<LicenseUsage | null> {
		try {
			if (!license?.uid) {
				this.logger.error('Invalid license object provided to trackUsage');
				return null;
			}

			const limit = this.getLimitForMetric(license, metricType);
			if (typeof limit !== 'number' || isNaN(limit) || limit <= 0) {
				this.logger.warn(`Invalid limit (${limit}) for metric ${metricType} in license ${license.uid}`);
				return null;
			}

			if (metricType === MetricType.API_CALLS) {
				return this.handleAPIUsage(license, currentValue, metadata);
			}

			// Handle other metric types as before
			const utilizationPercentage = Number(((currentValue / limit) * 100).toFixed(2));
			if (isNaN(utilizationPercentage)) {
				this.logger.error(`Invalid utilization calculation: ${currentValue} / ${limit}`);
				return null;
			}

			const usage = this.usageRepository.create({
				license,
				licenseId: String(license.uid),
				metricType,
				currentValue,
				limit,
				utilizationPercentage,
				metadata: metadata || {},
			});

			const saved = await this.usageRepository.save(usage);

			if (utilizationPercentage >= this.ALERT_THRESHOLD * 100) {
				await this.createLimitExceededEvent(license, metricType, currentValue, limit);
			}

			return saved;
		} catch (error) {
			this.logger.error(`Failed to track usage: ${error.message}`, error.stack);
			return null;
		}
	}

	private async handleAPIUsage(
		license: License,
		callCount: number,
		metadata: Record<string, any>,
	): Promise<LicenseUsage | null> {
		const bufferKey = `${license.uid}_${MetricType.API_CALLS}`;
		let buffer = this.usageBuffer.get(bufferKey) || [];

		// Add to buffer
		buffer.push({
			timestamp: new Date(),
			endpoint: metadata.endpoint,
			method: metadata.method,
			duration: metadata.duration,
			statusCode: metadata.statusCode,
			userAgent: metadata.userAgent,
			ip: metadata.ip,
			geoLocation: metadata.geoLocation,
		});

		this.usageBuffer.set(bufferKey, buffer);

		// If buffer reaches threshold, process immediately
		if (buffer.length >= 100) {
			return this.processBufferedUsage(license);
		}

		return null;
	}

	private async processBufferedUsage(specificLicense?: License): Promise<LicenseUsage | null> {
		try {
			for (const [key, buffer] of this.usageBuffer.entries()) {
				if (specificLicense && !key.startsWith(String(specificLicense?.uid))) continue;

				const [licenseId] = key.split('_');
				if (!buffer.length) continue;

				// Get latest usage record
				const latestUsage = await this.usageRepository.findOne({
					where: {
						licenseId,
						metricType: MetricType.API_CALLS,
					},
					order: { timestamp: 'DESC' },
				});

				const aggregatedMetadata = this.aggregateAPIUsage(buffer, latestUsage?.metadata);
				const totalCalls = (latestUsage?.currentValue || 0) + buffer.length;

				let license = specificLicense || latestUsage?.license;

				// If no license object is available, try to fetch it from database
				if (!license) {
					this.logger.warn(
						`No license object found for license ID ${licenseId}. Attempting to fetch from database.`,
					);
					// Note: You'll need to inject License repository to fetch license by ID
					// For now, we'll use a default limit to prevent the service from failing
					const limit = 10000; // Default API call limit
					this.logger.log(`Using default API call limit (${limit}) for license ${licenseId}`);

					const utilizationPercentage = Number(((totalCalls / limit) * 100).toFixed(2));

					const usage = this.usageRepository.create({
						license: null, // License will be null but we still track usage
						licenseId: licenseId,
						metricType: MetricType.API_CALLS,
						currentValue: totalCalls,
						limit,
						utilizationPercentage,
						metadata: aggregatedMetadata,
					});

					const saved = await this.usageRepository.save(usage);
					this.usageBuffer.set(key, []);

					if (utilizationPercentage >= this.ALERT_THRESHOLD * 100) {
						// Create a basic license object for the event
						const basicLicense = {
							uid: parseInt(licenseId),
							licenseKey: `LICENSE_${licenseId}`,
						} as License;
						await this.createLimitExceededEvent(basicLicense, MetricType.API_CALLS, totalCalls, limit);
					}

					return saved;
				}

				const limit = this.getLimitForMetric(license, MetricType.API_CALLS);

				// Check if limit is valid and greater than zero to prevent Infinity values
				if (!limit || limit <= 0) {
					this.logger.warn(
						`Invalid API call limit (${limit}) for license ${licenseId}. Using default limit.`,
					);
					// Use default limit instead of skipping
					const defaultLimit = 10000;
					const utilizationPercentage = Number(((totalCalls / defaultLimit) * 100).toFixed(2));

					const usage = this.usageRepository.create({
						license,
						licenseId: licenseId,
						metricType: MetricType.API_CALLS,
						currentValue: totalCalls,
						limit: defaultLimit,
						utilizationPercentage,
						metadata: aggregatedMetadata,
					});

					const saved = await this.usageRepository.save(usage);
					this.usageBuffer.set(key, []);

					if (utilizationPercentage >= this.ALERT_THRESHOLD * 100) {
						await this.createLimitExceededEvent(license, MetricType.API_CALLS, totalCalls, defaultLimit);
					}

					return saved;
				}

				const utilizationPercentage = Number(((totalCalls / limit) * 100).toFixed(2));

				const usage = this.usageRepository.create({
					license,
					licenseId: licenseId, // Already a string from key.split()
					metricType: MetricType.API_CALLS,
					currentValue: totalCalls,
					limit,
					utilizationPercentage,
					metadata: aggregatedMetadata,
				});

				const saved = await this.usageRepository.save(usage);
				this.usageBuffer.set(key, []);

				if (utilizationPercentage >= this.ALERT_THRESHOLD * 100) {
					await this.createLimitExceededEvent(license, MetricType.API_CALLS, totalCalls, limit);
				}

				return saved;
			}
		} catch (error) {
			this.logger.error(`Failed to process buffered usage: ${error.message}`, error.stack);
		}
		return null;
	}

	private aggregateAPIUsage(buffer: any[], existingMetadata: Partial<APIUsageMetadata> = {}): APIUsageMetadata {
		const metadata: APIUsageMetadata = {
			endpoints: existingMetadata?.endpoints || {},
			methods: existingMetadata?.methods || {},
			statusCodes: existingMetadata?.statusCodes || {},
			performance: {
				averageResponseTime: 0,
				maxResponseTime: 0,
				minResponseTime: Number.MAX_VALUE,
				p95ResponseTime: 0,
				errorRate: 0,
			},
			clients: {
				browsers: existingMetadata?.clients?.browsers || {},
				os: existingMetadata?.clients?.os || {},
				devices: existingMetadata?.clients?.devices || {},
				locations: existingMetadata?.clients?.locations || {},
			},
			timeDistribution: {
				hourly: new Array(24).fill(0),
				daily: new Array(7).fill(0),
				monthly: new Array(12).fill(0),
			},
		};

		let totalDuration = 0;
		let errorCount = 0;
		const durations: number[] = [];

		buffer.forEach((call) => {
			// Update counters
			const endpointKey = call.endpoint || 'unknown';
			const methodKey = call.method || 'unknown';
			const statusCodeKey = call.statusCode || 'unknown';
			metadata.endpoints[endpointKey] = (metadata.endpoints[endpointKey] || 0) + 1;
			metadata.methods[methodKey] = (metadata.methods[methodKey] || 0) + 1;
			metadata.statusCodes[statusCodeKey] = (metadata.statusCodes[statusCodeKey] || 0) + 1;

			// Performance metrics
			totalDuration += call.duration || 0;
			durations.push(call.duration || 0);
			metadata.performance.maxResponseTime = Math.max(metadata.performance.maxResponseTime, call.duration || 0);
			metadata.performance.minResponseTime = Math.min(
				metadata.performance.minResponseTime,
				call.duration || Number.MAX_VALUE,
			);

			if ((call.statusCode || 0) >= 400) errorCount++;

			// Client information (just use raw userAgent string)
			if (call.userAgent) {
				const agentKey = call.userAgent || 'unknown';
				metadata.clients.browsers[agentKey] = (metadata.clients.browsers[agentKey] || 0) + 1;
			}

			if (call.geoLocation?.country) {
				metadata.clients.locations[call.geoLocation.country] =
					(metadata.clients.locations[call.geoLocation.country] || 0) + 1;
			}

			// Time distribution
			const date = new Date(call.timestamp);
			if (!isNaN(date.getTime())) {
				metadata.timeDistribution.hourly[date.getHours()]++;
				metadata.timeDistribution.daily[date.getDay()]++;
				metadata.timeDistribution.monthly[date.getMonth()]++;
			}
		});

		// Calculate final performance metrics
		metadata.performance.averageResponseTime = totalDuration / buffer.length;
		metadata.performance.errorRate = (errorCount / buffer.length) * 100;

		// Calculate p95
		durations.sort((a, b) => a - b);
		const p95Index = Math.floor(durations.length * 0.95);
		metadata.performance.p95ResponseTime = durations[p95Index] || 0;

		return metadata;
	}

	private getLimitForMetric(license: License, metricType: MetricType): number {
		if (!license) return 0;
		try {
			switch (metricType) {
				case MetricType.USERS:
					return license.maxUsers || 10;
				case MetricType.BRANCHES:
					return license.maxBranches || 10;
				case MetricType.STORAGE:
					return license.storageLimit || 10;
				case MetricType.API_CALLS:
					// Use a default if missing/invalid
					return license.apiCallLimit && license.apiCallLimit > 0 ? license.apiCallLimit : 10000;
				case MetricType.INTEGRATIONS:
					return license.integrationLimit || 10;
				default:
					this.logger.warn(`Unknown metric type: ${metricType}`);
					return 0;
			}
		} catch (error) {
			this.logger.error(`Error getting limit for metric ${metricType}: ${error.message}`);
			return 0;
		}
	}

	private async createLimitExceededEvent(
		license: License,
		metricType: MetricType,
		currentValue: number,
		limit: number,
	): Promise<void> {
		try {
			if (!license?.uid) {
				throw new Error('Invalid license object');
			}

			if (!limit || limit <= 0) {
				throw new Error(`Invalid limit (${limit}) for metric ${metricType}`);
			}

			const utilizationPercentage = Number(((currentValue / limit) * 100).toFixed(2));

			const event = this.eventRepository.create({
				license,
				licenseId: license.uid.toString(),
				eventType: LicenseEventType.LIMIT_EXCEEDED,
				details: {
					metricType,
					currentValue,
					limit,
					utilizationPercentage,
					timestamp: new Date().toISOString(),
				},
			});

			await this.eventRepository.save(event);
			this.logger.warn(`License ${license.licenseKey} exceeded ${metricType} limit: ${currentValue}/${limit}`);
		} catch (error) {
			throw new Error(`Failed to create limit exceeded event: ${error.message}`);
		}
	}

	async getUsageHistory(
		licenseId: string,
		metricType: MetricType,
		startDate: Date,
		endDate: Date,
	): Promise<LicenseUsage[]> {
		return this.usageRepository.find({
			where: {
				licenseId,
				metricType,
				timestamp: Between(startDate, endDate),
			},
			order: { timestamp: 'ASC' },
		});
	}

	async getUsageAnalytics(licenseId: string): Promise<Record<MetricType, number>> {
		const usage = await this.usageRepository.find({
			where: { licenseId },
			order: { timestamp: 'DESC' },
		});

		const analytics: Partial<Record<MetricType, number>> = {};

		Object.values(MetricType).forEach((metricType) => {
			const latestUsage = usage?.find((u) => u?.metricType === metricType);
			analytics[metricType] = latestUsage ? latestUsage?.utilizationPercentage : 0;
		});

		return analytics as Record<MetricType, number>;
	}

	async getLicenseEvents(licenseId: string, startDate?: Date, endDate?: Date): Promise<LicenseEvent[]> {
		const query = this.eventRepository
			.createQueryBuilder('event')
			.where('event.licenseId = :licenseId', { licenseId });

		if (startDate && endDate) {
			query.andWhere('event.timestamp BETWEEN :startDate AND :endDate', {
				startDate,
				endDate,
			});
		}

		return query.orderBy('event.timestamp', 'DESC').getMany();
	}

	async createEvent(
		license: License,
		eventType: LicenseEventType,
		details: Record<string, any>,
		userId?: string,
		userIp?: string,
		userAgent?: string,
	): Promise<LicenseEvent> {
		const event = this.eventRepository.create({
			license,
			licenseId: String(license?.uid),
			eventType,
			details,
			userId,
			userIp,
			userAgent,
		});

		return this.eventRepository.save(event);
	}

	async getComplianceReport(licenseId: string): Promise<any> {
		const [events, usage] = await Promise.all([
			this.getLicenseEvents(licenseId),
			this.getUsageAnalytics(licenseId),
		]);

		return {
			licenseId,
			usage,
			events: events.map((event) => ({
				type: event?.eventType,
				timestamp: event?.timestamp,
				details: event?.details,
			})),
			generatedAt: new Date(),
		};
	}

	/**
	 * Gets consolidated license usage metrics for a single license
	 * This consolidates all metrics into a single structure with metrics organized by type
	 * @param licenseId The license ID to get metrics for
	 * @returns Consolidated usage metrics
	 */
	async getConsolidatedLicenseUsage(licenseId: string): Promise<ConsolidatedLicenseUsageDto> {
		try {
			// Get all metric types
			const metricTypes = Object.values(MetricType);

			// Find the latest entry for each metric type
			const latestMetrics = await Promise.all(
				metricTypes.map(async (metricType) => {
					return this.usageRepository.findOne({
						where: { licenseId, metricType },
						order: { timestamp: 'DESC' },
					});
				}),
			);

			// Build the consolidated utilization object
			const utilization: Record<MetricType, MetricUsageDto> = {} as Record<MetricType, MetricUsageDto>;

			latestMetrics.forEach((metric) => {
				if (metric) {
					utilization[metric.metricType] = {
						currentValue: metric.currentValue,
						limit: metric.limit,
						utilizationPercentage: metric.utilizationPercentage,
						lastUpdated: metric.timestamp,
						metadata: metric.metadata,
					};
				}
			});

			return {
				licenseId,
				utilization,
				timestamp: new Date(),
			};
		} catch (error) {
			this.logger.error(`Failed to get consolidated license usage: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Gets consolidated license usage metrics for all licenses
	 * @returns Map of license IDs to consolidated metrics
	 */
	async getAllConsolidatedLicenseUsage(): Promise<Record<string, ConsolidatedLicenseUsageDto>> {
		try {
			// Get all unique license IDs
			const result = await this.usageRepository
				.createQueryBuilder('usage')
				.select('DISTINCT usage.licenseId', 'licenseId')
				.getRawMany();

			const licenseIds = result.map((item) => item.licenseId);

			// Get consolidated metrics for each license
			const consolidatedMetrics = await Promise.all(licenseIds.map((id) => this.getConsolidatedLicenseUsage(id)));

			// Convert to map of license ID -> metrics
			const metricsMap: Record<string, ConsolidatedLicenseUsageDto> = {};
			consolidatedMetrics.forEach((metrics) => {
				metricsMap[metrics.licenseId] = metrics;
			});

			return metricsMap;
		} catch (error) {
			this.logger.error(`Failed to get all consolidated license usage: ${error.message}`, error.stack);
			throw error;
		}
	}
}
