import {
	Injectable,
	Logger,
	NotFoundException,
	BadRequestException,
	ConflictException,
	Inject,
	ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Between, Not, IsNull, QueryFailedError, In } from 'typeorm';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

import { Device, DeviceRecords } from './entities/iot.entity';
import { DeviceType, DeviceStatus } from '../lib/enums/iot';
import { DevicePerformanceMetrics } from '../lib/interfaces/iot.interface';
import { DeviceReportOptions } from '../lib/types/iot.types';
import { CreateDeviceDto, CreateDeviceRecordDto, DeviceTimeRecordDto } from './dto/create-iot.dto';
import {
	UpdateDeviceDto,
	UpdateDeviceRecordDto,
	UpdateDeviceStatusDto,
	UpdateDeviceAnalyticsDto,
} from './dto/update-iot.dto';
import { IoTReportingService } from './services/iot-reporting.service';
import { OrganisationHoursService } from '../organisation/services/organisation-hours.service';
import { TimezoneUtil } from '../lib/utils/timezone.util';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { User } from '../user/entities/user.entity';
import { AccessLevel } from '../lib/enums/user.enums';
import { NotificationEvent, NotificationPriority, NotificationChannel } from '../lib/types/unified-notification.types';

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

interface DeviceFilters {
	orgId?: number;
	branchId?: number;
	deviceType?: string;
	status?: string;
}

interface RecordFilters {
	deviceId?: number;
	orgId?: number;
	branchId?: number;
	startDate?: Date;
	endDate?: Date;
}

interface AnalyticsFilters {
	orgId?: number;
	branchId?: number;
	startDate?: Date;
	endDate?: Date;
}

@Injectable()
export class IotService {
	private readonly logger = new Logger(IotService.name);
	private readonly CACHE_PREFIX = 'iot:';
	private readonly CACHE_TTL: number;

	constructor(
		@InjectRepository(Device)
		private deviceRepository: Repository<Device>,
		@InjectRepository(DeviceRecords)
		private deviceRecordsRepository: Repository<DeviceRecords>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly eventEmitter: EventEmitter2,
		private readonly configService: ConfigService,
		private readonly dataSource: DataSource,
		private readonly iotReportingService: IoTReportingService,
		private readonly organisationHoursService: OrganisationHoursService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
	) {
		this.CACHE_TTL = parseInt(this.configService.get<string>('CACHE_TTL', '300'));
		this.logger.log('🤖 IoT Service initialized successfully with comprehensive reporting capabilities');
	}

	/**
	 * Cache Management
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	private async invalidateDeviceCache(device: Device) {
		try {
			this.logger.debug(`🧹 Invalidating cache for device: ${device.deviceID} (org: ${device.orgID}, branch: ${device.branchID})`);

			// Get all cache keys from store (like user service pattern)
			const keys = await this.cacheManager.store.keys();

			// Keys to clear
			const keysToDelete = [];

			// Add device-specific keys
			keysToDelete.push(
				this.getCacheKey(`device:${device.id}`),
				this.getCacheKey(`device:deviceId:${device.deviceID}`),
				this.getCacheKey(`device:${device.id}:${device.orgID}:`),
				this.getCacheKey(`device:${device.id}:${device.orgID}:${device.branchID}`),
				this.getCacheKey(`device:deviceId:${device.deviceID}:${device.orgID}:`),
				this.getCacheKey(`device:deviceId:${device.deviceID}:${device.orgID}:${device.branchID}`),
				this.getCacheKey(`analytics:device:${device.id}`),
				this.getCacheKey(`business_hours:${device.orgID}:*`),
			);

			// Add organization and branch specific keys
			keysToDelete.push(
				this.getCacheKey(`devices:org:${device.orgID}`),
				this.getCacheKey(`devices:branch:${device.branchID}`),
				this.getCacheKey('devices:all'),
				this.getCacheKey(`analytics:summary:*`),
			);

			// Clear all pagination, filtered device list caches, and record caches
			const deviceListCaches = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}devices:`) ||
					key.startsWith(`${this.CACHE_PREFIX}records:`) ||
					key.startsWith(`${this.CACHE_PREFIX}analytics:`) ||
					key.includes('_limit') ||
					key.includes('_filter') ||
					key.includes('page') ||
					key.includes(device.orgID.toString()) ||
					key.includes(device.deviceID),
			);
			keysToDelete.push(...deviceListCaches);

			// Remove duplicates and clear all caches
			const uniqueKeys = [...new Set(keysToDelete)];
			await Promise.all(uniqueKeys.map((key) => this.cacheManager.del(key)));

			this.logger.debug(`🗑️ Cache invalidated for device ${device.deviceID}. Cleared ${uniqueKeys.length} cache keys`);

			// Emit event for other services that might be caching device data
			this.eventEmitter.emit('iot.devices.cache.invalidate', {
				deviceId: device.id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				keys: uniqueKeys,
			});
		} catch (error) {
			this.logger.error(`❌ Error invalidating device cache for device ${device.deviceID}:`, error.message);
		}
	}

	private async invalidateRecordCache(record: DeviceRecords) {
		try {
			const device = await this.deviceRepository.findOne({
				where: { id: record.deviceId },
				select: ['id', 'orgID', 'branchID', 'deviceID'],
			});

			if (!device) {
				this.logger.warn(`⚠️ Device not found for record ${record.id}, cannot invalidate cache`);
				return;
			}

			this.logger.debug(`🧹 Invalidating record cache for device ${device.deviceID} (org: ${device.orgID}, branch: ${device.branchID})`);

			// Get all cache keys from store (like user service pattern)
			const keys = await this.cacheManager.store.keys();

			// Keys to clear
			const keysToDelete = [];

			// Add record-specific keys
			keysToDelete.push(
				this.getCacheKey(`record:${record.id}`),
				this.getCacheKey(`records:device:${device.id}`),
				this.getCacheKey(`analytics:device:${device.id}`),
			);

			// Add device-specific keys (since records affect device data)
			keysToDelete.push(
				this.getCacheKey(`device:${device.id}`),
				this.getCacheKey(`device:deviceId:${device.deviceID}`),
				this.getCacheKey(`device:${device.id}:${device.orgID}:`),
				this.getCacheKey(`device:${device.id}:${device.orgID}:${device.branchID}`),
				this.getCacheKey(`device:deviceId:${device.deviceID}:${device.orgID}:`),
				this.getCacheKey(`device:deviceId:${device.deviceID}:${device.orgID}:${device.branchID}`),
			);

			// Add organization and branch specific keys
			keysToDelete.push(
				this.getCacheKey(`devices:org:${device.orgID}`),
				this.getCacheKey(`devices:branch:${device.branchID}`),
				this.getCacheKey('devices:all'),
				this.getCacheKey(`analytics:summary:*`),
			);

			// Clear all pagination, filtered device/record list caches
			const relatedCaches = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}devices:`) ||
					key.startsWith(`${this.CACHE_PREFIX}records:`) ||
					key.startsWith(`${this.CACHE_PREFIX}analytics:`) ||
					key.includes('_limit') ||
					key.includes('_filter') ||
					key.includes('page') ||
					key.includes(device.orgID.toString()) ||
					key.includes(device.deviceID) ||
					key.includes(record.id.toString()),
			);
			keysToDelete.push(...relatedCaches);

			// Remove duplicates and clear all caches
			const uniqueKeys = [...new Set(keysToDelete)];
			await Promise.all(uniqueKeys.map((key) => this.cacheManager.del(key)));

			this.logger.debug(`🗑️ Record cache invalidated for device ${device.deviceID}. Cleared ${uniqueKeys.length} cache keys`);

			// Emit event for other services that might be caching record data
			this.eventEmitter.emit('iot.records.cache.invalidate', {
				recordId: record.id,
				deviceId: device.id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				keys: uniqueKeys,
			});
		} catch (error) {
			this.logger.error(`❌ Error invalidating record cache for record ${record.id}:`, error.message);
		}
	}

	/**
	 * Invalidate all IoT-related caches (for use in system-wide cache clearing)
	 * Following the comprehensive pattern from user service
	 */
	async invalidateAllIoTCaches(): Promise<void> {
		try {
			this.logger.log(`🧹 Starting comprehensive IoT cache invalidation`);

			// Get all cache keys from store
			const keys = await this.cacheManager.store.keys();

			// Filter all IoT-related cache keys
			const iotCacheKeys = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}`) ||
					key.includes('iot') ||
					key.includes('device') ||
					key.includes('record') ||
					key.includes('analytics') ||
					key.includes('business_hours'),
			);

			// Clear all IoT caches in parallel
			await Promise.all(iotCacheKeys.map((key) => this.cacheManager.del(key)));

			this.logger.log(`🗑️ Comprehensive IoT cache invalidation completed. Cleared ${iotCacheKeys.length} cache keys`);

			// Emit event for system-wide cache invalidation
			this.eventEmitter.emit('iot.cache.invalidate.all', {
				clearedKeys: iotCacheKeys.length,
				timestamp: new Date(),
			});
		} catch (error) {
			this.logger.error(`❌ Error during comprehensive IoT cache invalidation:`, error.message);
		}
	}

	/**
	 * Format device location name into user-friendly format
	 */
	private formatLocationName(deviceLocation: string): string {
		try {
			// Clean up device location name
			let cleanLocation = deviceLocation || 'Unknown Location';
			
			// Remove common technical prefixes/suffixes
			cleanLocation = cleanLocation
				.replace(/^(device_|sensor_|door_|iot_)/i, '')
				.replace(/(_device|_sensor|_door|_iot)$/i, '')
				.replace(/[_-]/g, ' ')
				.trim();

			// Convert to title case
			const titleCase = cleanLocation
				.split(' ')
				.map(word => {
					// Handle common abbreviations
					const upperWords = ['ID', 'RFID', 'NFC', 'QR', 'GPS', 'IoT', 'AI', 'API', 'UI', 'UX'];
					if (upperWords.includes(word.toUpperCase())) {
						return word.toUpperCase();
					}
					return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
				})
				.join(' ');

			// Handle common location patterns
			if (titleCase.toLowerCase().includes('main') && titleCase.toLowerCase().includes('entrance')) {
				return 'Main Entrance';
			}
			if (titleCase.toLowerCase().includes('front') && titleCase.toLowerCase().includes('door')) {
				return 'Front Door';
			}
			if (titleCase.toLowerCase().includes('back') && titleCase.toLowerCase().includes('door')) {
				return 'Back Door';
			}
			if (titleCase.toLowerCase().includes('emergency') && titleCase.toLowerCase().includes('exit')) {
				return 'Emergency Exit';
			}

			return titleCase || 'Device Location';
		} catch (error) {
			this.logger.warn(`Failed to format location name: ${error.message}`);
			return deviceLocation || 'Unknown Location';
		}
	}

	/**
	 * Get business hours information for an organization with caching for performance
	 */
	private async getBusinessHoursInfo(orgId: number, date: Date): Promise<{
		isWorkingDay: boolean;
		startTime: string | null;
		endTime: string | null;
	}> {
		try {
			// Create cache key based on org and date (since business hours can change daily)
			const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
			const cacheKey = this.getCacheKey(`business_hours:${orgId}:${dateKey}`);
			
			// Check cache first
			const cached = await this.cacheManager.get(cacheKey);
			if (cached) {
				this.logger.debug(`📦 Using cached business hours for org ${orgId} on ${dateKey}`);
				return cached as any;
			}

			// Get organization hours using the organisation service
			const orgHours = await this.organisationHoursService.findDefault(orgId.toString());
			
			let result: any;
			
			if (!orgHours) {
				// Default to standard business hours if no config found
				result = {
					isWorkingDay: true,
					startTime: '09:00',
					endTime: '17:00',
				};
			} else {
			// Check if it's a working day based on weekly schedule
			const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
			const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
			const currentDay = dayNames[dayOfWeek] as keyof typeof orgHours.weeklySchedule;
			
			const isWorkingDay = orgHours.weeklySchedule[currentDay];

				result = {
				isWorkingDay,
				startTime: isWorkingDay ? orgHours.openTime : null,
				endTime: isWorkingDay ? orgHours.closeTime : null,
			};
			}

			// Cache for 1 hour (3600 seconds) since business hours don't change frequently
			await this.cacheManager.set(cacheKey, result, 3600);
			this.logger.debug(`💾 Cached business hours for org ${orgId} on ${dateKey}`);
			
			return result;
		} catch (error) {
			this.logger.warn(`Error getting business hours for org ${orgId}: ${error.message}`);
			// Default to standard business hours on error
			return {
				isWorkingDay: true,
				startTime: '09:00',
				endTime: '17:00',
			};
		}
	}

	/**
	 * Helper method to determine if an event occurred after business hours
	 */
	private isAfterBusinessHours(eventDate: Date, businessHoursInfo: any): boolean {
		try {
			if (!businessHoursInfo || !businessHoursInfo.startTime || !businessHoursInfo.endTime) {
				return false; // If no business hours defined, assume always during business hours
			}

			const eventHour = eventDate.getHours();
			const eventMinute = eventDate.getMinutes();
			const eventTimeInMinutes = eventHour * 60 + eventMinute;

			// Parse start time
			const [startHour, startMinute] = businessHoursInfo.startTime.split(':').map(Number);
			const startTimeInMinutes = startHour * 60 + startMinute;

			// Parse end time
			const [endHour, endMinute] = businessHoursInfo.endTime.split(':').map(Number);
			const endTimeInMinutes = endHour * 60 + endMinute;

			// Check if event time is outside business hours
			return eventTimeInMinutes < startTimeInMinutes || eventTimeInMinutes > endTimeInMinutes;
		} catch (error) {
			this.logger.warn(`Error checking business hours: ${error.message}`);
			return false; // Default to business hours if error
		}
	}

	/**
	 * Device Management with Enterprise-grade validation and business logic
	 */
	async createDevice(createDeviceDto: CreateDeviceDto): Promise<{ message: string; device?: Partial<Device> }> {
		const startTime = Date.now();
		this.logger.log(
			`🤖 Creating device with ID: ${createDeviceDto.deviceID} for org: ${createDeviceDto.orgID}, branch: ${createDeviceDto.branchID}`,
		);

		// Start transaction for data consistency
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// 1. Comprehensive validation
			await this.validateDeviceCreation(createDeviceDto, queryRunner);

			// 2. Check for existing device conflicts
			await this.checkDeviceConflicts(createDeviceDto, queryRunner);

			// 3. Validate network connectivity (if enabled)
			if (this.configService.get<boolean>('IOT_VALIDATE_CONNECTIVITY', false)) {
				await this.validateDeviceConnectivity(createDeviceDto);
			}

			// 4. Initialize comprehensive analytics
			const defaultAnalytics = this.initializeDeviceAnalytics();

			// 5. Create device with enriched data
			const deviceData = {
				...createDeviceDto,
				deviceType: createDeviceDto.deviceType || DeviceType.DOOR_SENSOR,
				currentStatus: createDeviceDto.currentStatus || DeviceStatus.ONLINE,
				analytics: createDeviceDto.analytics || defaultAnalytics,
				createdAt: new Date(),
				updatedAt: new Date(),
				isDeleted: false,
			};

			const device = queryRunner.manager.create(Device, deviceData);
			const savedDevice = await queryRunner.manager.save(device);

			// 6. Create initial audit log
			await this.createDeviceAuditLog(queryRunner, savedDevice, 'DEVICE_CREATED', 'Initial device registration');

			// 7. Initialize device monitoring
			await this.initializeDeviceMonitoring(savedDevice);

			// 8. Cache device data
			await this.cacheDeviceData(savedDevice);

			// 9. Commit transaction
			await queryRunner.commitTransaction();

			// 10. Post-creation activities (outside transaction)
			await this.performPostCreationActivities(savedDevice, startTime);

			this.logger.log(`✅ Device created successfully with ID: ${savedDevice.id} in ${Date.now() - startTime}ms`);

			return {
				message: this.configService.get<string>('SUCCESS_MESSAGE', 'Device created successfully'),
				device: {
					id: savedDevice.id,
					deviceID: savedDevice.deviceID,
					deviceType: savedDevice.deviceType,
					currentStatus: savedDevice.currentStatus,
					devicLocation: savedDevice.devicLocation,
					analytics: savedDevice.analytics,
				},
			};
		} catch (error) {
			// Rollback transaction on error
			await queryRunner.rollbackTransaction();

			this.logger.error(`❌ Failed to create device: ${error.message}`, {
				deviceID: createDeviceDto.deviceID,
				orgID: createDeviceDto.orgID,
				branchID: createDeviceDto.branchID,
				duration: Date.now() - startTime,
				stack: error.stack,
			});

			// Handle specific error types
			if (
				error instanceof ConflictException ||
				error instanceof BadRequestException ||
				error instanceof ForbiddenException
			) {
				throw error;
			}

			// Database constraint violations
			if (error instanceof QueryFailedError) {
				if (error.message.includes('duplicate') || error.message.includes('unique')) {
					throw new ConflictException(`Device with ID '${createDeviceDto.deviceID}' already exists`);
				}
			}

			throw new BadRequestException('Failed to create device due to validation errors');
		} finally {
			await queryRunner.release();
		}
	}

	/**
	 * Comprehensive device creation validation
	 */
	private async validateDeviceCreation(createDeviceDto: CreateDeviceDto, queryRunner: any): Promise<void> {
		const errors: string[] = [];

		// Validate device ID format
		if (!createDeviceDto.deviceID || createDeviceDto.deviceID.trim().length === 0) {
			errors.push('Device ID is required and cannot be empty');
		} else if (createDeviceDto.deviceID.length > 100) {
			errors.push('Device ID must be 100 characters or less');
		} else if (!/^[a-zA-Z0-9_-]+$/.test(createDeviceDto.deviceID)) {
			errors.push('Device ID can only contain alphanumeric characters, underscores, and hyphens');
		}

		// Validate organization and branch existence
		if (!createDeviceDto.orgID || createDeviceDto.orgID <= 0) {
			errors.push('Valid organization ID is required');
		}

		if (!createDeviceDto.branchID || createDeviceDto.branchID <= 0) {
			errors.push('Valid branch ID is required');
		}

		// Validate IP address format
		if (!this.isValidIPAddress(createDeviceDto.deviceIP)) {
			errors.push('Invalid IP address format');
		}

		// Validate port range
		if (createDeviceDto.devicePort < 1 || createDeviceDto.devicePort > 65535) {
			errors.push('Port must be between 1 and 65535');
		}

		// Validate device location
		if (!createDeviceDto.devicLocation || createDeviceDto.devicLocation.trim().length === 0) {
			errors.push('Device location is required');
		} else if (createDeviceDto.devicLocation.length > 255) {
			errors.push('Device location must be 255 characters or less');
		}

		// Validate device tag
		if (!createDeviceDto.deviceTag || createDeviceDto.deviceTag.trim().length === 0) {
			errors.push('Device tag is required');
		} else if (createDeviceDto.deviceTag.length > 100) {
			errors.push('Device tag must be 100 characters or less');
		}

		if (errors.length > 0) {
			throw new BadRequestException({
				message: 'Device validation failed',
				errors,
				details: 'Please correct the validation errors and try again',
			});
		}
	}

	/**
	 * Check for device conflicts and business rules
	 */
	private async checkDeviceConflicts(createDeviceDto: CreateDeviceDto, queryRunner: any): Promise<void> {
		// Check for duplicate device ID
		const existingDevice = await queryRunner.manager.findOne(Device, {
			where: { deviceID: createDeviceDto.deviceID, isDeleted: false },
			select: ['id', 'deviceID', 'devicLocation', 'orgID', 'branchID'],
		});

		if (existingDevice) {
			throw new ConflictException({
				message: `Device with ID '${createDeviceDto.deviceID}' already exists`,
				conflictingDevice: {
					id: existingDevice.id,
					deviceID: existingDevice.deviceID,
					location: existingDevice.devicLocation,
					orgID: existingDevice.orgID,
					branchID: existingDevice.branchID,
				},
				resolution: 'Use a different device ID or update the existing device',
			});
		}

		// Check for IP:Port conflicts within the organization
		const ipPortConflict = await queryRunner.manager.findOne(Device, {
			where: {
				deviceIP: createDeviceDto.deviceIP,
				devicePort: createDeviceDto.devicePort,
				orgID: createDeviceDto.orgID,
				isDeleted: false,
			},
			select: ['id', 'deviceID', 'deviceIP', 'devicePort'],
		});

		if (ipPortConflict) {
			throw new ConflictException({
				message: `Another device is already using IP ${createDeviceDto.deviceIP}:${createDeviceDto.devicePort}`,
				conflictingDevice: {
					id: ipPortConflict.id,
					deviceID: ipPortConflict.deviceID,
					conflictingAddress: `${ipPortConflict.deviceIP}:${ipPortConflict.devicePort}`,
				},
				resolution: 'Use a different IP address or port number',
			});
		}

		// Check organization device limits (if configured)
		const deviceLimit = this.configService.get<number>('MAX_DEVICES_PER_ORG', 1000);
		const deviceCount = await queryRunner.manager.count(Device, {
			where: { orgID: createDeviceDto.orgID, isDeleted: false },
		});

		if (deviceCount >= deviceLimit) {
			throw new ForbiddenException({
				message: `Organization has reached the maximum device limit of ${deviceLimit}`,
				currentCount: deviceCount,
				limit: deviceLimit,
				resolution: 'Remove unused devices or upgrade your plan for higher limits',
			});
		}
	}

	/**
	 * Validate device network connectivity
	 */
	private async validateDeviceConnectivity(createDeviceDto: CreateDeviceDto): Promise<void> {
		try {
			this.logger.debug(
				`🔍 Validating connectivity for ${createDeviceDto.deviceIP}:${createDeviceDto.devicePort}`,
			);

			// Here you would implement actual network connectivity validation
			// For now, we'll simulate it
			const isReachable = await this.pingDevice(createDeviceDto.deviceIP, createDeviceDto.devicePort);

			if (!isReachable) {
				this.logger.warn(
					`⚠️ Device at ${createDeviceDto.deviceIP}:${createDeviceDto.devicePort} is not reachable`,
				);
				// Note: We don't throw an error here as devices might be configured before being powered on
			}
		} catch (error) {
			this.logger.warn(
				`⚠️ Connectivity validation failed for ${createDeviceDto.deviceIP}:${createDeviceDto.devicePort}: ${error.message}`,
			);
		}
	}

	/**
	 * Initialize comprehensive device analytics
	 */
	private initializeDeviceAnalytics() {
		const now = new Date();
		return {
			openCount: 0,
			closeCount: 0,
			totalCount: 0,
			lastOpenAt: now,
			lastCloseAt: now,
			onTimeCount: 0,
			lateCount: 0,
			daysAbsent: 0,
			avgDailyEvents: 0,
			maxDailyEvents: 0,
			lastMaintenanceDate: now,
			totalUptime: 0,
			lastEventAt: now,
			errorCount: 0,
			successfulEvents: 0,
			weeklyPattern: {
				monday: 0,
				tuesday: 0,
				wednesday: 0,
				thursday: 0,
				friday: 0,
				saturday: 0,
				sunday: 0,
			},
			monthlyStats: {
				eventsThisMonth: 0,
				peakUsageHour: 9, // Default to 9 AM
				averageResponseTime: 0,
			},
		};
	}

	/**
	 * Create device audit log entry
	 */
	private async createDeviceAuditLog(
		queryRunner: any,
		device: Device,
		action: string,
		description: string,
	): Promise<void> {
		try {
			// Here you would create an audit log entry
			// For now, we'll just log it
			this.logger.log(`📋 Audit Log: ${action} - Device ${device.deviceID} - ${description}`);

			// You could create a separate audit table:
			// await queryRunner.manager.save(DeviceAuditLog, {
			//   deviceId: device.id,
			//   action,
			//   description,
			//   timestamp: new Date(),
			//   metadata: { orgID: device.orgID, branchID: device.branchID }
			// });
		} catch (error) {
			this.logger.warn(`⚠️ Failed to create audit log: ${error.message}`);
		}
	}

	/**
	 * Initialize device monitoring
	 */
	private async initializeDeviceMonitoring(device: Device): Promise<void> {
		try {
			// Set up device monitoring schedules, health checks, etc.
			this.logger.log(`📡 Initializing monitoring for device ${device.deviceID}`);

			// You could integrate with monitoring services here
			// await this.monitoringService.addDevice(device);
		} catch (error) {
			this.logger.warn(`⚠️ Failed to initialize monitoring for device ${device.deviceID}: ${error.message}`);
		}
	}

	/**
	 * Cache device data for fast access
	 */
	private async cacheDeviceData(device: Device): Promise<void> {
		try {
			const cacheKey = this.getCacheKey(`device:${device.id}`);
			const deviceIdKey = this.getCacheKey(`device:deviceId:${device.deviceID}`);

			await Promise.all([
				this.cacheManager.set(cacheKey, device, this.CACHE_TTL),
				this.cacheManager.set(deviceIdKey, device, this.CACHE_TTL),
			]);

			this.logger.debug(`💾 Cached device data for ${device.deviceID}`);
		} catch (error) {
			this.logger.warn(`⚠️ Failed to cache device data: ${error.message}`);
		}
	}

	/**
	 * Perform post-creation activities
	 */
	private async performPostCreationActivities(device: Device, startTime: number): Promise<void> {
		try {
			// Emit device created event for real-time notifications
			this.eventEmitter.emit('device.created', {
				deviceId: device.id,
				deviceID: device.deviceID,
				deviceType: device.deviceType,
				orgId: device.orgID,
				branchId: device.branchID,
				location: device.devicLocation,
				status: device.currentStatus,
				createdAt: device.createdAt,
				metadata: {
					processingTime: Date.now() - startTime,
					analyticsInitialized: true,
					monitoringEnabled: true,
				},
			});

			// Send notification to administrators
			this.eventEmitter.emit('device.notification', {
				type: 'DEVICE_REGISTERED',
				deviceId: device.id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				message: `New IoT device '${device.deviceID}' has been registered at ${device.devicLocation}`,
				priority: 'info',
			});

			// Update organization device statistics
			this.eventEmitter.emit('organization.stats.update', {
				orgId: device.orgID,
				branchId: device.branchID,
				metric: 'device_count',
				change: 1,
			});

			this.logger.debug(`🎉 Post-creation activities completed for device ${device.deviceID}`);
		} catch (error) {
			this.logger.warn(`⚠️ Post-creation activities failed: ${error.message}`);
		}
	}

	/**
	 * Utility: Validate IP address format
	 */
	private isValidIPAddress(ip: string): boolean {
		const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
		const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
		return ipv4Regex.test(ip) || ipv6Regex.test(ip);
	}

	/**
	 * Utility: Ping device for connectivity check
	 */
	private async pingDevice(ip: string, port: number): Promise<boolean> {
		// In a real implementation, you would use a network library to ping the device
		// For now, we'll simulate it
		return new Promise((resolve) => {
			setTimeout(() => {
				// Simulate 90% success rate
				resolve(Math.random() > 0.1);
			}, 100);
		});
	}

	async findAllDevices(
		filters: DeviceFilters = {},
		page: number = 1,
		limit: number = 10,
	): Promise<PaginatedResponse<Device>> {
		const startTime = Date.now();
		const requestId = `findAllDevices_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		this.logger.log(
			`🔌 [${requestId}] Starting IoT devices fetch with filters: ${JSON.stringify(
				filters,
			)}, page: ${page}, limit: ${limit}`,
		);

		try {
			// Input validation
			if (page < 1) {
				this.logger.warn(`🔌 [${requestId}] Invalid page number: ${page}, defaulting to 1`);
				page = 1;
			}
			if (limit < 1 || limit > 100) {
				this.logger.warn(`🔌 [${requestId}] Invalid limit: ${limit}, defaulting to 10`);
				limit = 10;
			}

			const cacheKey = this.getCacheKey(`devices:${JSON.stringify({ filters, page, limit })}`);
			this.logger.debug(`🔌 [${requestId}] Checking cache with key: ${cacheKey}`);

			const cached = await this.cacheManager.get<PaginatedResponse<Device>>(cacheKey);

			if (cached) {
				const cacheHitTime = Date.now() - startTime;
				this.logger.log(`🔌 [${requestId}] ✅ Cache hit! Returning cached devices data in ${cacheHitTime}ms`);
				this.logger.debug(
					`🔌 [${requestId}] Cache data summary: ${cached.data?.length || 0} devices, total: ${
						cached.total
					}, pages: ${cached.totalPages}`,
				);
				return cached;
			}

			this.logger.debug(`🔌 [${requestId}] Cache miss. Building database query...`);

			const queryBuilder = this.deviceRepository
				.createQueryBuilder('device')
				.leftJoinAndSelect('device.records', 'records')
				.where('device.isDeleted = :isDeleted', { isDeleted: false })
				.orderBy('device.createdAt', 'DESC')
				.addOrderBy('records.createdAt', 'DESC');

			this.logger.debug(`🔌 [${requestId}] Base query created with relations`);

			// Apply filters with detailed logging
			let appliedFilters = 0;

			if (filters.orgId) {
				queryBuilder.andWhere('device.orgID = :orgId', { orgId: filters.orgId });
				this.logger.debug(`🔌 [${requestId}] Applied orgId filter: ${filters.orgId}`);
				appliedFilters++;
			}

			if (filters.branchId) {
				queryBuilder.andWhere('device.branchID = :branchId', { branchId: filters.branchId });
				this.logger.debug(`🔌 [${requestId}] Applied branchId filter: ${filters.branchId}`);
				appliedFilters++;
			}

			if (filters.deviceType) {
				queryBuilder.andWhere('device.deviceType = :deviceType', { deviceType: filters.deviceType });
				this.logger.debug(`🔌 [${requestId}] Applied deviceType filter: ${filters.deviceType}`);
				appliedFilters++;
			}

			if (filters.status) {
				queryBuilder.andWhere('device.currentStatus = :status', { status: filters.status });
				this.logger.debug(`🔌 [${requestId}] Applied status filter: ${filters.status}`);
				appliedFilters++;
			}

			this.logger.log(`🔌 [${requestId}] Applied ${appliedFilters} filters to query`);

			// Get total count
			const countStartTime = Date.now();
			const total = await queryBuilder.getCount();
			const countTime = Date.now() - countStartTime;
			this.logger.debug(`🔌 [${requestId}] Count query completed: ${total} devices found in ${countTime}ms`);

			// Apply pagination
			const offset = (page - 1) * limit;
			queryBuilder.skip(offset).take(limit);
			this.logger.debug(`🔌 [${requestId}] Applied pagination: offset=${offset}, limit=${limit}`);

			// Execute main query
			const queryStartTime = Date.now();
			const devices = await queryBuilder.getMany();
			const queryTime = Date.now() - queryStartTime;
			this.logger.debug(
				`🔌 [${requestId}] Main query completed: ${devices.length} devices fetched in ${queryTime}ms`,
			);

			// Limit records to latest 5 for each device
			const processedDevices = devices.map(device => ({
				...device,
				records: device.records 
					? device.records
						.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
						.slice(0, 5)
					: []
			}));

			// Log device details for debugging
			if (processedDevices.length > 0) {
				this.logger.debug(
					`🔌 [${requestId}] Sample device data: ID=${processedDevices[0].id}, deviceID=${processedDevices[0].deviceID}, type=${processedDevices[0].deviceType}, status=${processedDevices[0].currentStatus}, records=${processedDevices[0].records.length}`,
				);
			}

			const result: PaginatedResponse<Device> = {
				data: processedDevices,
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			};

			// Cache the result
			const cacheStartTime = Date.now();
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			const cacheTime = Date.now() - cacheStartTime;
			this.logger.debug(`🔌 [${requestId}] Result cached in ${cacheTime}ms with TTL: ${this.CACHE_TTL}ms`);

			const totalTime = Date.now() - startTime;
			this.logger.log(
				`🔌 [${requestId}] ✅ Successfully fetched ${processedDevices.length} devices (${total} total) in ${totalTime}ms`,
			);

			return result;
		} catch (error) {
			const errorTime = Date.now() - startTime;
			this.logger.error(`🔌 [${requestId}] ❌ Failed to fetch devices after ${errorTime}ms: ${error.message}`, {
				filters,
				page,
				limit,
				stack: error.stack,
				requestId,
			});
			throw new BadRequestException(`Failed to fetch devices: ${error.message}`);
		}
	}

	async findOneDevice(id: number, orgId?: number, branchId?: number): Promise<{ device: Device | null; message: string }> {
		try {
			this.logger.log(`🔍 [findOneDevice] Starting device lookup - ID: ${id}, orgId: ${orgId}, branchId: ${branchId}`);
			
			const cacheKey = this.getCacheKey(`device:${id}:${orgId}:${branchId}`);
			const cached = await this.cacheManager.get<Device>(cacheKey);

			if (cached) {
				this.logger.debug(`📦 [findOneDevice] Returning cached device data for ID: ${id}`);
				return { device: cached, message: 'Device found successfully' };
			}

			// Build where clause with org/branch filtering
			const whereClause: any = { id, isDeleted: false };
			
			if (orgId) {
				whereClause.orgID = orgId;
				this.logger.debug(`🏢 [findOneDevice] Filtering by organization: ${orgId}`);
			}
			
			if (branchId) {
				whereClause.branchID = branchId;
				this.logger.debug(`🏪 [findOneDevice] Filtering by branch: ${branchId}`);
			}

			const device = await this.deviceRepository.findOne({
				where: whereClause,
				relations: ['records'],
				order: { records: { createdAt: 'DESC' } },
			});

			if (!device) {
				this.logger.warn(`❌ [findOneDevice] Device not found or access denied - ID: ${id}, orgId: ${orgId}, branchId: ${branchId}`);
				return { device: null, message: 'Device not found or access denied' };
			}

			this.logger.log(`✅ [findOneDevice] Device found - ID: ${device.id}, deviceID: ${device.deviceID}, org: ${device.orgID}, branch: ${device.branchID}`);

			// Limit records to latest 5
			const processedDevice = {
				...device,
				records: device.records 
					? device.records
						.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
						.slice(0, 5)
					: []
			};

			await this.cacheManager.set(cacheKey, processedDevice, this.CACHE_TTL);
			return { device: processedDevice, message: 'Device found successfully' };
		} catch (error) {
			this.logger.error(`❌ [findOneDevice] Failed to find device with ID ${id}: ${error.message}`, error.stack);
			throw new BadRequestException('Failed to find device');
		}
	}

	async findDeviceByDeviceId(deviceId: string, orgId?: number, branchId?: number): Promise<{ device: Device | null; message: string }> {
		try {
			this.logger.log(`🔍 [findDeviceByDeviceId] Starting device lookup - deviceID: ${deviceId}, orgId: ${orgId}, branchId: ${branchId}`);
			
			const cacheKey = this.getCacheKey(`device:deviceId:${deviceId}:${orgId}:${branchId}`);
			const cached = await this.cacheManager.get<Device>(cacheKey);

			if (cached) {
				this.logger.debug(`📦 [findDeviceByDeviceId] Returning cached device data for deviceID: ${deviceId}`);
				return { device: cached, message: 'Device found successfully' };
			}

			// Build where clause with org/branch filtering
			const whereClause: any = { deviceID: deviceId, isDeleted: false };
			
			if (orgId) {
				whereClause.orgID = orgId;
				this.logger.debug(`🏢 [findDeviceByDeviceId] Filtering by organization: ${orgId}`);
			}
			
			if (branchId) {
				whereClause.branchID = branchId;
				this.logger.debug(`🏪 [findDeviceByDeviceId] Filtering by branch: ${branchId}`);
			}

			const device = await this.deviceRepository.findOne({
				where: whereClause,
				relations: ['records'],
				order: { records: { createdAt: 'DESC' } },
			});

			if (!device) {
				this.logger.warn(`❌ [findDeviceByDeviceId] Device not found or access denied - deviceID: ${deviceId}, orgId: ${orgId}, branchId: ${branchId}`);
				return { device: null, message: 'Device not found or access denied' };
			}

			this.logger.log(`✅ [findDeviceByDeviceId] Device found - ID: ${device.id}, deviceID: ${device.deviceID}, org: ${device.orgID}, branch: ${device.branchID}`);

			// Limit records to latest 5
			const processedDevice = {
				...device,
				records: device.records 
					? device.records
						.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
						.slice(0, 5)
					: []
			};

			await this.cacheManager.set(cacheKey, processedDevice, this.CACHE_TTL);
			return { device: processedDevice, message: 'Device found successfully' };
		} catch (error) {
			this.logger.error(`❌ [findDeviceByDeviceId] Failed to find device with deviceID ${deviceId}: ${error.message}`, error.stack);
			throw new BadRequestException('Failed to find device');
		}
	}

	async updateDevice(id: number, updateDeviceDto: UpdateDeviceDto): Promise<{ message: string }> {
		try {
			this.logger.log(`Updating device with ID: ${id}`);

			const device = await this.deviceRepository.findOne({
				where: { id, isDeleted: false },
			});

			if (!device) {
				throw new NotFoundException('Device not found');
			}

			// Check if updating deviceID and it conflicts with existing device
			if (updateDeviceDto.deviceID && updateDeviceDto.deviceID !== device.deviceID) {
				const existingDevice = await this.deviceRepository.findOne({
					where: { deviceID: updateDeviceDto.deviceID, isDeleted: false, id: Not(id) },
				});

				if (existingDevice) {
					throw new ConflictException(`Device with ID '${updateDeviceDto.deviceID}' already exists`);
				}
			}

			await this.deviceRepository.update(id, {
				...updateDeviceDto,
				updatedAt: new Date(),
			});

			await this.invalidateDeviceCache(device);

			// Emit device updated event
			this.eventEmitter.emit('device.updated', {
				deviceId: id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				changes: updateDeviceDto,
			});

			this.logger.log(`Device updated successfully with ID: ${id}`);
			return { message: 'Device updated successfully' };
		} catch (error) {
			this.logger.error(`Failed to update device with ID ${id}: ${error.message}`, error.stack);
			if (error instanceof NotFoundException || error instanceof ConflictException) {
				throw error;
			}
			throw new BadRequestException('Failed to update device');
		}
	}

	async updateDeviceStatus(id: number, statusDto: UpdateDeviceStatusDto): Promise<{ message: string }> {
		try {
			this.logger.log(`Updating device status for ID: ${id} to ${statusDto.currentStatus}`);

			const device = await this.deviceRepository.findOne({
				where: { id, isDeleted: false },
			});

			if (!device) {
				throw new NotFoundException('Device not found');
			}

			const previousStatus = device.currentStatus;

			await this.deviceRepository.update(id, {
				currentStatus: statusDto.currentStatus,
				updatedAt: new Date(),
			});

			await this.invalidateDeviceCache(device);

			// Emit device status changed event
			this.eventEmitter.emit('device.status.changed', {
				deviceId: id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				previousStatus,
				newStatus: statusDto.currentStatus,
				reason: statusDto.reason,
			});

			this.logger.log(`Device status updated successfully for ID: ${id}`);
			return { message: 'Device status updated successfully' };
		} catch (error) {
			this.logger.error(`Failed to update device status for ID ${id}: ${error.message}`, error.stack);
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException('Failed to update device status');
		}
	}

	async updateDeviceAnalytics(id: number, analyticsDto: UpdateDeviceAnalyticsDto): Promise<{ message: string }> {
		try {
			this.logger.log(`Updating device analytics for ID: ${id}`);

			const device = await this.deviceRepository.findOne({
				where: { id, isDeleted: false },
			});

			if (!device) {
				throw new NotFoundException('Device not found');
			}

			// Merge existing analytics with new data
			const updatedAnalytics = {
				...device.analytics,
				...analyticsDto.analytics,
			};

			await this.deviceRepository.update(id, {
				analytics: updatedAnalytics,
				updatedAt: new Date(),
			});

			await this.invalidateDeviceCache(device);

			this.logger.log(`Device analytics updated successfully for ID: ${id}`);
			return { message: 'Device analytics updated successfully' };
		} catch (error) {
			this.logger.error(`Failed to update device analytics for ID ${id}: ${error.message}`, error.stack);
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException('Failed to update device analytics');
		}
	}

	async removeDevice(id: number): Promise<{ message: string }> {
		try {
			this.logger.log(`Soft deleting device with ID: ${id}`);

			const device = await this.deviceRepository.findOne({
				where: { id, isDeleted: false },
			});

			if (!device) {
				throw new NotFoundException('Device not found');
			}

			await this.deviceRepository.update(id, {
				isDeleted: true,
				updatedAt: new Date(),
			});

			await this.invalidateDeviceCache(device);

			// Emit device deleted event
			this.eventEmitter.emit('device.deleted', {
				deviceId: id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
			});

			this.logger.log(`Device soft deleted successfully with ID: ${id}`);
			return { message: 'Device deleted successfully' };
		} catch (error) {
			this.logger.error(`Failed to delete device with ID ${id}: ${error.message}`, error.stack);
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException('Failed to delete device');
		}
	}

	/**
	 * Device Records Management - The core logic for open/close time tracking
	 */
	async createOrUpdateRecord(
		recordDto: CreateDeviceRecordDto,
	): Promise<{ message: string; record?: Partial<DeviceRecords> }> {
		try {
			this.logger.log(`Creating/updating record for device ID: ${recordDto.deviceId}`);

			const device = await this.deviceRepository.findOne({
				where: { id: recordDto.deviceId, isDeleted: false },
			});

			if (!device) {
				throw new NotFoundException('Device not found');
			}

			// Determine organization timezone
			const orgRef = String(device.orgID);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgTimezone =
				(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || TimezoneUtil.AFRICA_JOHANNESBURG;

			// Convert incoming epoch seconds to organization-local Date values
			const openDateOrg =
				typeof recordDto.openTime === 'number' && recordDto.openTime > 0
					? TimezoneUtil.toOrganizationTime(new Date(recordDto.openTime * 1000), orgTimezone)
					: null;
			const closeDateOrg =
				typeof recordDto.closeTime === 'number' && recordDto.closeTime > 0
					? TimezoneUtil.toOrganizationTime(new Date(recordDto.closeTime * 1000), orgTimezone)
					: null;

			// Find latest record for today (if any)
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			let existingRecord = await this.deviceRecordsRepository.findOne({
				where: {
					deviceId: device.id,
					createdAt: Between(today, tomorrow),
				},
				order: { createdAt: 'DESC' },
			});

			let record: DeviceRecords;

			if (existingRecord) {
				const hasOpen = !!existingRecord.openTime;
				const hasClose = !!existingRecord.closeTime;

				if (hasOpen && hasClose) {
					// Latest record complete → create a new record
					record = this.deviceRecordsRepository.create({
						openTime: openDateOrg,
						closeTime: closeDateOrg,
						deviceId: device.id,
					});
					record = await this.deviceRecordsRepository.save(record);
					this.logger.log(`Created new record (latest complete) for device ID: ${recordDto.deviceId}`);
				} else {
					// Update only missing parts on the latest record
					if (!hasOpen && openDateOrg) {
						existingRecord.openTime = openDateOrg;
					}
					if (!hasClose && closeDateOrg) {
						// Only set close if we have an open or explicitly provided
						existingRecord.closeTime = closeDateOrg;
					}
					existingRecord.updatedAt = new Date();
					record = await this.deviceRecordsRepository.save(existingRecord);
					this.logger.log(`Updated incomplete record for device ID: ${recordDto.deviceId}`);
				}
			} else {
				// No record today → create new
				record = this.deviceRecordsRepository.create({
					openTime: openDateOrg,
					closeTime: closeDateOrg,
					deviceId: device.id,
				});
				record = await this.deviceRecordsRepository.save(record);
				this.logger.log(`Created new record (first of day) for device ID: ${recordDto.deviceId}`);
			}

			// Update device analytics
			await this.updateDeviceAnalyticsFromRecord(device, record, recordDto);

			await this.invalidateRecordCache(record);

			return {
				message: existingRecord ? 'Record updated successfully' : 'Record created successfully',
				record: {
					id: record.id,
					openTime: record.openTime,
					closeTime: record.closeTime,
					createdAt: record.createdAt,
				},
			};
		} catch (error) {
			this.logger.error(`Failed to create/update record: ${error.message}`, error.stack);
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException('Failed to create/update record');
		}
	}

	/**
	 * 🚀 CORE INTELLIGENCE: Advanced Time Event Processing System
	 *
	 * This is the heart of the IoT time tracking system that processes device events
	 * with sophisticated business logic for attendance management
	 */
	async recordTimeEvent(
		timeEventDto: DeviceTimeRecordDto,
	): Promise<{ message: string; record?: Partial<DeviceRecords>; eventProcessing?: any }> {
		const startTime = Date.now();
		const eventId = `${timeEventDto.deviceID}-${timeEventDto.eventType}-${timeEventDto.timestamp}`;

		this.logger.log(
			`⏰ Processing ${timeEventDto.eventType} event for device: ${timeEventDto.deviceID} at timestamp: ${timeEventDto.timestamp}`,
		);

		// Comprehensive validation first
		await this.validateTimeEvent(timeEventDto);

		// Start transaction for atomic operations
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// 1. Device validation and retrieval
			const device = await this.getAndValidateDevice(timeEventDto.deviceID, queryRunner);

			// 2. Business hours validation and analysis
			const businessHoursAnalysis = await this.validateBusinessHours(timeEventDto, device);

			// 3. Smart daily record management
			const recordResult = await this.smartRecordManagement(timeEventDto, device, queryRunner);

			// 4. Advanced analytics update (includes business hours analysis)
			await this.updateAdvancedAnalytics(
				device,
				timeEventDto,
				recordResult.action,
				queryRunner,
				businessHoursAnalysis,
			);

			// 5. Real-time notifications
			await this.processRealTimeNotifications(device, timeEventDto, recordResult);

			// 6. Commit transaction
			await queryRunner.commitTransaction();

			// 6. Post-processing activities
			await this.performPostEventActivities(device, timeEventDto, recordResult, startTime);

			const processingTime = Date.now() - startTime;

			// Create comprehensive success message with business context
			const attendanceContext =
				businessHoursAnalysis.attendanceStatus === 'ON_TIME'
					? 'On-time arrival detected'
					: businessHoursAnalysis.attendanceStatus === 'LATE'
					? 'Late arrival detected'
					: businessHoursAnalysis.attendanceStatus === 'EARLY'
					? 'Early arrival detected'
					: 'Outside business hours detected';

			this.logger.log(
				`✅ Time event processed successfully in ${processingTime}ms for device: ${timeEventDto.deviceID} - ${attendanceContext}`,
			);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			await queryRunner.rollbackTransaction();

			this.logger.error(`❌ Failed to process time event: ${error.message}`, {
				deviceID: timeEventDto.deviceID,
				eventType: timeEventDto.eventType,
				timestamp: timeEventDto.timestamp,
				eventId,
				duration: Date.now() - startTime,
				stack: error.stack,
			});

			if (
				error instanceof NotFoundException ||
				error instanceof BadRequestException ||
				error instanceof ConflictException
			) {
				throw error;
			}

			throw new BadRequestException('Failed to process time event due to system error');
		} finally {
			await queryRunner.release();
		}
	}

	/**
	 * Comprehensive time event validation
	 */
	private async validateTimeEvent(timeEventDto: DeviceTimeRecordDto): Promise<void> {
		const errors: string[] = [];
		const now = Math.floor(Date.now() / 1000);

		// Validate device ID
		if (!timeEventDto.deviceID || timeEventDto.deviceID.trim().length === 0) {
			errors.push('Device ID is required and cannot be empty');
		}

		// Validate event type
		if (!timeEventDto.eventType || !['open', 'close'].includes(timeEventDto.eventType)) {
			errors.push('Event type must be either "open" or "close"');
		}

		// Validate timestamp
		if (!timeEventDto.timestamp || isNaN(timeEventDto.timestamp)) {
			errors.push('Valid timestamp is required');
		} else {
			// Check if timestamp is not in the future (allow 5 minute buffer for clock differences)
			const futureBuffer = 300; // 5 minutes
			if (timeEventDto.timestamp > now + futureBuffer) {
				errors.push('Timestamp cannot be in the future');
			}

			// Check if timestamp is not too old (1 year)
			const oldestAllowed = now - 365 * 24 * 60 * 60; // 1 year ago
			if (timeEventDto.timestamp < oldestAllowed) {
				errors.push('Timestamp cannot be older than 1 year');
			}

			// Check for reasonable timestamp (after year 2000)
			if (timeEventDto.timestamp < 946684800) {
				// 2000-01-01 00:00:00 UTC
				errors.push('Timestamp must be a valid Unix timestamp after year 2000');
			}
		}

		if (errors.length > 0) {
			throw new BadRequestException({
				message: 'Time event validation failed',
				errors,
				eventData: {
					deviceID: timeEventDto.deviceID,
					eventType: timeEventDto.eventType,
					timestamp: timeEventDto.timestamp,
					timestampDate: new Date(timeEventDto.timestamp * 1000).toISOString(),
				},
				hints: {
					timestampFormat: 'Use Unix timestamp in seconds (not milliseconds)',
					eventTypes: 'Valid event types: "open", "close"',
					deviceID: 'Ensure device ID matches a registered device',
				},
			});
		}
	}

	/**
	 * Business hours validation and attendance analysis
	 */
	private async validateBusinessHours(timeEventDto: DeviceTimeRecordDto, device: Device): Promise<any> {
		try {
			this.logger.debug(`🕒 Validating business hours for device: ${timeEventDto.deviceID}`);

			// Get organization identifier from device as-is (no prefixes)
			const orgRef = String(device.orgID);

			// Get organization hours configuration
			let organizationHoursArr;

			try {
				organizationHoursArr = await this.organisationHoursService.findAll(orgRef);
			} catch (error) {
				this.logger.warn(
					`⚠️ No business hours configuration found for organization ${orgRef}, using default validation`,
				);
				// Return basic analysis without business hours validation
				return {
					organizationHours: {
						openTime: '07:00',
						closeTime: '17:00',
						timezone: 'Africa/Johannesburg',
						isHoliday: false,
						configured: false,
					},
					eventAnalysis: {
						eventType: timeEventDto.eventType,
						eventTime: new Date(timeEventDto.timestamp * 1000).toLocaleTimeString('en-ZA', {
							hour12: false,
							hour: '2-digit',
							minute: '2-digit',
						}),
						isWithinBusinessHours: true, // Default to true when no config
						attendanceStatus: 'ON_TIME',
						minutesFromSchedule: 0,
						workingDay: true,
					},
				};
			}

			// Defensive: Use first config if available, else fallback
			const organizationHours =
				Array.isArray(organizationHoursArr) && organizationHoursArr.length > 0 ? organizationHoursArr[0] : null;
			if (!organizationHours) {
				this.logger.warn(`⚠️ No business hours found for organization ${orgRef}, using default validation`);
				return {
					organizationHours: {
						openTime: '07:00',
						closeTime: '17:00',
						timezone: 'Africa/Johannesburg',
						isHoliday: false,
						configured: false,
					},
					eventAnalysis: {
						eventType: timeEventDto.eventType,
						eventTime: new Date(timeEventDto.timestamp * 1000).toLocaleTimeString('en-ZA', {
							hour12: false,
							hour: '2-digit',
							minute: '2-digit',
						}),
						isWithinBusinessHours: true, // Default to true when no config
						attendanceStatus: 'ON_TIME',
						minutesFromSchedule: 0,
						workingDay: true,
					},
				};
			}

			// Convert timestamp to organization timezone
			const eventDateUTC = new Date(timeEventDto.timestamp * 1000);
			const timezone = organizationHours.timezone || TimezoneUtil.AFRICA_JOHANNESBURG;
			const eventDate = TimezoneUtil.toOrganizationTime(eventDateUTC, timezone);
			const eventTimeString = eventDate.toLocaleTimeString('en-ZA', {
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
			});
			const dayOfWeek = eventDate.toLocaleDateString('en-ZA', {
				weekday: 'long',
			}) as keyof typeof organizationHours.weeklySchedule;

			// Determine business hours for the event day
			let dayOpenTime = organizationHours.openTime;
			let dayCloseTime = organizationHours.closeTime;
			let isWorkingDay = true;

			// Check if organization has detailed schedule
			if (organizationHours.schedule && organizationHours.schedule[dayOfWeek]) {
				const daySchedule = organizationHours.schedule[dayOfWeek];
				if (daySchedule.closed) {
					isWorkingDay = false;
				} else {
					dayOpenTime = daySchedule.start;
					dayCloseTime = daySchedule.end;
				}
			} else if (organizationHours.weeklySchedule && organizationHours.weeklySchedule[dayOfWeek] === false) {
				isWorkingDay = false;
			}

			// Check for holiday mode
			const isHoliday =
				organizationHours.holidayMode &&
				organizationHours.holidayUntil &&
				eventDate <= organizationHours.holidayUntil;

			if (isHoliday) {
				isWorkingDay = false;
			}

			// Check for special hours
			// Build date string in org timezone (YYYY-MM-DD)
			const yyyy = String(eventDate.getFullYear());
			const mm = String(eventDate.getMonth() + 1).padStart(2, '0');
			const dd = String(eventDate.getDate()).padStart(2, '0');
			const dateString = `${yyyy}-${mm}-${dd}`;
			const specialHours = organizationHours.specialHours?.find((sh) => sh.date === dateString);
			if (specialHours) {
				if (specialHours.openTime === '00:00' && specialHours.closeTime === '00:00') {
					isWorkingDay = false;
				} else {
					dayOpenTime = specialHours.openTime;
					dayCloseTime = specialHours.closeTime;
				}
			}

			// Calculate attendance status
			let attendanceStatus = 'ON_TIME';
			let minutesFromSchedule = 0;
			let isWithinBusinessHours = true;

			if (isWorkingDay && timeEventDto.eventType === 'open') {
				// Parse times for comparison in org timezone
				const openDate = TimezoneUtil.parseTimeInOrganization(dayOpenTime, eventDate, timezone);
				const closeDate = TimezoneUtil.parseTimeInOrganization(dayCloseTime, eventDate, timezone);
				const openTimeMinutes = TimezoneUtil.getMinutesSinceMidnight(openDate, timezone);
				const closeTimeMinutes = TimezoneUtil.getMinutesSinceMidnight(closeDate, timezone);
				const eventTimeMinutes = TimezoneUtil.getMinutesSinceMidnight(eventDate, timezone);

				minutesFromSchedule = eventTimeMinutes - openTimeMinutes;

				if (minutesFromSchedule > 15) {
					// More than 15 minutes late
					attendanceStatus = 'LATE';
				} else if (minutesFromSchedule < -30) {
					// More than 30 minutes early
					attendanceStatus = 'EARLY';
				} else {
					attendanceStatus = 'ON_TIME';
				}

				// Check if within business hours (with reasonable buffer)
				isWithinBusinessHours =
					eventTimeMinutes >= openTimeMinutes - 60 && // 1 hour before open
					eventTimeMinutes <= closeTimeMinutes + 60; // 1 hour after close
			} else if (!isWorkingDay) {
				attendanceStatus = 'OUTSIDE_HOURS';
				isWithinBusinessHours = false;
			}

			const analysis = {
				organizationHours: {
					openTime: dayOpenTime,
					closeTime: dayCloseTime,
					timezone,
					isHoliday,
					configured: true,
				},
				eventAnalysis: {
					eventType: timeEventDto.eventType,
					eventTime: eventTimeString,
					isWithinBusinessHours,
					attendanceStatus,
					minutesFromSchedule,
					workingDay: isWorkingDay,
				},
			};

			return analysis;
		} catch (error) {
			this.logger.error(`❌ Failed to validate business hours: ${error.message}`, {
				deviceID: timeEventDto.deviceID,
				orgID: device.orgID,
				error: error.message,
			});

			// Return safe default analysis on error
			return {
				organizationHours: {
					openTime: '07:00',
					closeTime: '17:00',
					timezone: 'Africa/Johannesburg',
					isHoliday: false,
					configured: false,
				},
				eventAnalysis: {
					eventType: timeEventDto.eventType,
					eventTime: new Date(timeEventDto.timestamp * 1000).toLocaleTimeString('en-ZA', {
						hour12: false,
						hour: '2-digit',
						minute: '2-digit',
					}),
					isWithinBusinessHours: true,
					attendanceStatus: 'ON_TIME',
					minutesFromSchedule: 0,
					workingDay: true,
				},
			};
		}
	}

	/**
	 * Get and validate device with comprehensive checks
	 */
	private async getAndValidateDevice(deviceID: string, queryRunner: any): Promise<Device> {
		// Try cache first for performance
		const cacheKey = this.getCacheKey(`device:deviceId:${deviceID}`);
		let device = await this.cacheManager.get<Device>(cacheKey);

		if (!device) {
			// Fetch from database with full details
			device = await queryRunner.manager.findOne(Device, {
				where: { deviceID, isDeleted: false },
				relations: ['records'],
			});

			if (device) {
				// Cache for future requests
				await this.cacheManager.set(cacheKey, device, this.CACHE_TTL);
			}
		}

		if (!device) {
			throw new NotFoundException({
				message: `Device with ID '${deviceID}' not found`,
				deviceID,
				suggestions: [
					'Verify the device ID is correct and exists',
					'Check if the device has been registered in the system',
					'Ensure the device has not been deactivated',
					'Confirm the device belongs to your organization',
				],
			});
		}

		// Auto-update device status if offline
		if (device.currentStatus === DeviceStatus.OFFLINE) {
			this.logger.log(`📡 Device ${deviceID} coming online - updating status`);

			await queryRunner.manager.update(Device, device.id, {
				currentStatus: DeviceStatus.ONLINE,
				updatedAt: new Date(),
			});

			device.currentStatus = DeviceStatus.ONLINE;
			await this.cacheManager.set(cacheKey, device, this.CACHE_TTL);
		}

		return device;
	}

	/**
	 * Smart daily record management with advanced logic and proper close event validation
	 */
	private async smartRecordManagement(
		timeEventDto: DeviceTimeRecordDto,
		device: Device,
		queryRunner: any,
	): Promise<any> {
		// Determine organization timezone
		const orgRef = String(device.orgID);
		const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
		const orgTimezone =
			(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || TimezoneUtil.AFRICA_JOHANNESBURG;

		// Convert incoming epoch seconds to organization-local Date
		const eventDateOrg = TimezoneUtil.toOrganizationTime(new Date(timeEventDto.timestamp * 1000), orgTimezone);
		const today = new Date(eventDateOrg);
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		// For close events, first check for any existing open record without a close
		if (timeEventDto.eventType === 'close') {
			// Look for the most recent record with an open time but no close time (ordered by updatedAt)
			const openRecordWithoutClose = await queryRunner.manager.findOne(DeviceRecords, {
				where: {
					deviceId: device.id,
					openTime: Not(IsNull()),
					closeTime: IsNull(),
				},
				order: { updatedAt: 'DESC' },
			});

			if (openRecordWithoutClose) {
				// Found an open record without close - update it with the close time
				openRecordWithoutClose.closeTime = eventDateOrg;
				openRecordWithoutClose.updatedAt = new Date();
				const record = await queryRunner.manager.save(openRecordWithoutClose);
				
				this.logger.log(
					`📝 ✅ Updated existing open record (ID: ${openRecordWithoutClose.id}) with close time - Device: ${device.deviceID}`,
				);
				
				return { record, action: 'updated', existingRecord: true };
			} else {
				// No open record found - this is the bug scenario
				this.logger.warn(
					`⚠️ Close event received without corresponding open event - Device: ${device.deviceID}. Rejecting close event.`,
				);
				
				throw new BadRequestException({
					message: 'Close event cannot be processed without a corresponding open event',
					deviceID: device.deviceID,
					eventType: timeEventDto.eventType,
					timestamp: timeEventDto.timestamp,
					hint: 'Ensure an open event is recorded before attempting to record a close event',
				});
			}
		}

		// Find the latest record for today (if any)
		let existingRecord = await queryRunner.manager.findOne(DeviceRecords, {
			where: {
				deviceId: device.id,
				createdAt: Between(today, tomorrow),
			},
			order: { createdAt: 'DESC' },
		});

		let record: DeviceRecords;
		let action: string;

		if (existingRecord) {
			const hasOpen = !!existingRecord.openTime;
			const hasClose = !!existingRecord.closeTime;

			if (hasOpen && hasClose) {
				// Latest is complete → create new record for this event (only open events reach here)
				action = 'created';
				const recordData = {
					openTime: eventDateOrg, // Only open events reach this point now
					closeTime: null,
					deviceId: device.id,
					createdAt: new Date(),
					updatedAt: new Date(),
				};
				record = queryRunner.manager.create(DeviceRecords, recordData);
				record = await queryRunner.manager.save(record);
				this.logger.log(
					`📝 Created new record (latest complete) with ${timeEventDto.eventType} - Device: ${device.deviceID}`,
				);
			} else {
				// Update missing side or create new if conflicting
				action = 'updated';
				if (timeEventDto.eventType === 'open') {
					if (!hasOpen) {
						existingRecord.openTime = eventDateOrg;
						this.logger.log(`📝 Set open time on incomplete record - Device: ${device.deviceID}`);
					} else {
						// Already has open without close → start a new record
						action = 'created';
						const recordData = {
							openTime: eventDateOrg,
							closeTime: null,
							deviceId: device.id,
							createdAt: new Date(),
							updatedAt: new Date(),
						};
						record = queryRunner.manager.create(DeviceRecords, recordData);
						record = await queryRunner.manager.save(record);
						this.logger.log(`📝 Created new record (conflicting open) - Device: ${device.deviceID}`);
						return { record, action, existingRecord: !!existingRecord };
					}
				}

				existingRecord.updatedAt = new Date();
				record = await queryRunner.manager.save(existingRecord);
			}
		} else {
			// No record for today → create new with the incoming event (only for open events now)
			action = 'created';
			const recordData = {
				openTime: eventDateOrg, // Only open events reach this point now
				closeTime: null, // Close events are handled above
				deviceId: device.id,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			record = queryRunner.manager.create(DeviceRecords, recordData);
			record = await queryRunner.manager.save(record);
			this.logger.log(
				`📝 Created first record of day with ${timeEventDto.eventType} - Device: ${device.deviceID}`,
			);
		}

		return { record, action, existingRecord: !!existingRecord };
	}

	/**
	 * Advanced analytics update with comprehensive metrics
	 */
	private async updateAdvancedAnalytics(
		device: Device,
		timeEventDto: DeviceTimeRecordDto,
		recordAction: string,
		queryRunner: any,
		businessHoursAnalysis?: any,
	): Promise<void> {
		const analytics = { ...device.analytics };
		const now = new Date();

		// Update basic counters
		if (timeEventDto.eventType === 'open') {
			analytics.openCount++;
			// Use organization-local Date for lastOpenAt
			const orgRef = String(device.orgID);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgTimezone =
				(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || TimezoneUtil.AFRICA_JOHANNESBURG;
			analytics.lastOpenAt = TimezoneUtil.toOrganizationTime(
				new Date(timeEventDto.timestamp * 1000),
				orgTimezone,
			);
		} else {
			analytics.closeCount++;
			const orgRef = String(device.orgID);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgTimezone =
				(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || TimezoneUtil.AFRICA_JOHANNESBURG;
			analytics.lastCloseAt = TimezoneUtil.toOrganizationTime(
				new Date(timeEventDto.timestamp * 1000),
				orgTimezone,
			);
		}

		// Update total count
		analytics.totalCount = analytics.openCount + analytics.closeCount;

		// Update additional analytics properties (if they exist in the extended analytics)
		const extendedAnalytics = analytics as any;
		extendedAnalytics.lastEventAt = new Date(timeEventDto.timestamp * 1000);
		extendedAnalytics.successfulEvents = (extendedAnalytics.successfulEvents || 0) + 1;

		// Calculate daily patterns (if weeklyPattern exists)
		const orgRefForStats = String(device.orgID);
		const orgHoursArrForStats = await this.organisationHoursService.findAll(orgRefForStats).catch(() => []);
		const orgTimezoneForStats =
			(Array.isArray(orgHoursArrForStats) && orgHoursArrForStats[0]?.timezone) ||
			TimezoneUtil.AFRICA_JOHANNESBURG;
		const eventDate = TimezoneUtil.toOrganizationTime(new Date(timeEventDto.timestamp * 1000), orgTimezoneForStats);
		const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
			eventDate.getDay()
		];
		if (extendedAnalytics.weeklyPattern) {
			extendedAnalytics.weeklyPattern[dayName] = (extendedAnalytics.weeklyPattern[dayName] || 0) + 1;
		}

		// Update monthly stats (if monthlyStats exists)
		if (extendedAnalytics.monthlyStats) {
			extendedAnalytics.monthlyStats.eventsThisMonth = (extendedAnalytics.monthlyStats.eventsThisMonth || 0) + 1;
		}

		// Update attendance analytics based on business hours analysis
		if (businessHoursAnalysis) {
			const { eventAnalysis } = businessHoursAnalysis;

			// Track attendance metrics
			if (timeEventDto.eventType === 'open') {
				if (eventAnalysis.attendanceStatus === 'ON_TIME') {
					analytics.onTimeCount = (analytics.onTimeCount || 0) + 1;
				} else if (eventAnalysis.attendanceStatus === 'LATE') {
					analytics.lateCount = (analytics.lateCount || 0) + 1;
				}

				// Track early arrivals
				if (eventAnalysis.attendanceStatus === 'EARLY') {
					extendedAnalytics.earlyCount = (extendedAnalytics.earlyCount || 0) + 1;
				}

				// Track outside hours events
				if (eventAnalysis.attendanceStatus === 'OUTSIDE_HOURS') {
					extendedAnalytics.outsideHoursCount = (extendedAnalytics.outsideHoursCount || 0) + 1;
				}

				// Update punctuality rate
				const totalArrivals = (analytics.onTimeCount || 0) + (analytics.lateCount || 0);
				if (totalArrivals > 0) {
					extendedAnalytics.punctualityRate =
						Math.round(((analytics.onTimeCount || 0) / totalArrivals) * 100 * 100) / 100;
				}
			}

			// Track working vs non-working day events
			if (eventAnalysis.workingDay) {
				extendedAnalytics.workingDayEvents = (extendedAnalytics.workingDayEvents || 0) + 1;
			} else {
				extendedAnalytics.nonWorkingDayEvents = (extendedAnalytics.nonWorkingDayEvents || 0) + 1;
			}

			// Update last business hours check
			const orgRefForCheck = String(device.orgID);
			const orgHoursArrForCheck = await this.organisationHoursService.findAll(orgRefForCheck).catch(() => []);
			const orgTimezoneForCheck =
				(Array.isArray(orgHoursArrForCheck) && orgHoursArrForCheck[0]?.timezone) ||
				TimezoneUtil.AFRICA_JOHANNESBURG;
			extendedAnalytics.lastBusinessHoursCheck = {
				timestamp: TimezoneUtil.toOrganizationTime(
					new Date(timeEventDto.timestamp * 1000),
					orgTimezoneForCheck,
				),
				attendanceStatus: eventAnalysis.attendanceStatus,
				isWithinBusinessHours: eventAnalysis.isWithinBusinessHours,
				minutesFromSchedule: eventAnalysis.minutesFromSchedule,
			};
		}

		// Update device analytics
		await queryRunner.manager.update(Device, device.id, {
			analytics,
			updatedAt: now,
		});

		this.logger.debug(`📊 Updated analytics for device ${device.deviceID}: Total events: ${analytics.totalCount}`);
	}

	/**
	 * Process real-time notifications based on business rules
	 */
	private async processRealTimeNotifications(
		device: Device,
		timeEventDto: DeviceTimeRecordDto,
		recordResult: any,
	): Promise<void> {
		const orgRef = String(device.orgID);
		const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
		const orgTimezone =
			(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || TimezoneUtil.AFRICA_JOHANNESBURG;
		const eventDate = TimezoneUtil.toOrganizationTime(new Date(timeEventDto.timestamp * 1000), orgTimezone);
		const hour = eventDate.getHours();

		// Send notification to admin users for all device open/close events
		try {
			await this.sendDeviceNotificationToAdmins(device, timeEventDto, eventDate);
		} catch (error) {
			this.logger.warn(`⚠️ Failed to send admin notifications: ${error.message}`);
		}

		// Late arrival notifications
		if (timeEventDto.eventType === 'open' && hour > 10) {
			this.eventEmitter.emit('attendance.alert', {
				type: 'LATE_ARRIVAL',
				deviceId: device.id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				timestamp: eventDate,
				severity: 'warning',
				message: `Late arrival detected at ${device.devicLocation} at ${hour}:${eventDate.getMinutes()}`,
			});
		}

		// Weekend work notifications
		const dayOfWeek = eventDate.getDay();
		if ((dayOfWeek === 0 || dayOfWeek === 6) && timeEventDto.eventType === 'open') {
			this.eventEmitter.emit('attendance.alert', {
				type: 'WEEKEND_WORK',
				deviceId: device.id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				timestamp: eventDate,
				severity: 'info',
				message: `Weekend work detected at ${device.devicLocation}`,
			});
		}
	}

	/**
	 * Send device open/close notifications to admin, owner, manager and technician users in the organization
	 * Using the same pattern as attendance service with sendTemplatedNotification
	 */
	private async sendDeviceNotificationToAdmins(
		device: Device,
		timeEventDto: DeviceTimeRecordDto,
		eventDate: Date,
	): Promise<void> {
		try {
			this.logger.log(`📢 [sendDeviceNotification] Sending device ${timeEventDto.eventType} notification for org ${device.orgID}`);

			// Find all relevant users (admin, owner, manager, technician) in the organization
			const relevantUsers = await this.userRepository.find({
				where: {
					organisationRef: device.orgID.toString(),
					accessLevel: In([AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER, AccessLevel.TECHNICIAN]),
					isDeleted: false,
				},
				select: ['uid', 'name', 'email', 'expoPushToken', 'organisationRef', 'accessLevel'],
			});

			if (relevantUsers.length === 0) {
				this.logger.warn(`⚠️ [sendDeviceNotification] No relevant users found for organization ${device.orgID}`);
				return;
			}

			this.logger.log(`👥 [sendDeviceNotification] Found ${relevantUsers.length} users to notify (${relevantUsers.map(u => u.accessLevel).join(', ')}) for org ${device.orgID}`);

			// Prepare notification data
			const eventAction = timeEventDto.eventType === 'open' ? 'opened' : 'closed';
			const eventIcon = timeEventDto.eventType === 'open' ? '🚪📖' : '🚪🔒';
			const timeString = eventDate.toLocaleTimeString('en-ZA', {
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
			});

			// Create user-friendly location name from device location
			const locationName = this.formatLocationName(device.devicLocation);

			// Extract user IDs for sendTemplatedNotification
			const userIds = relevantUsers.map(user => user.uid);

			// Determine appropriate notification event based on event type and business hours
			let notificationEvent: NotificationEvent;
			let priority: NotificationPriority;
			let enhancedMessage: string;

			// Check if this is after business hours
			const businessHoursInfo = await this.getBusinessHoursInfo(device.orgID, eventDate);
			const isAfterHours = !businessHoursInfo.isWorkingDay || this.isAfterBusinessHours(eventDate, businessHoursInfo);

			if (timeEventDto.eventType === 'open') {
				if (isAfterHours) {
					notificationEvent = NotificationEvent.IOT_DEVICE_AFTER_HOURS_ACCESS;
					priority = NotificationPriority.HIGH;
					enhancedMessage = `🌙 ${locationName} Just Opened a few seconds ago (After Hours)`;
				} else {
					notificationEvent = NotificationEvent.IOT_DEVICE_OPENED;
					priority = NotificationPriority.NORMAL;
					enhancedMessage = `🚪 ${locationName} Just Opened a few seconds ago`;
				}
			} else if (timeEventDto.eventType === 'close') {
				notificationEvent = NotificationEvent.IOT_DEVICE_CLOSED;
				priority = NotificationPriority.LOW;
				enhancedMessage = `🔒 ${locationName} Just Closed a few seconds ago`;
			} else {
				notificationEvent = NotificationEvent.IOT_DEVICE_OPENED; // Default fallback
				priority = NotificationPriority.NORMAL;
				enhancedMessage = `🔔 ${locationName} Just ${timeEventDto.eventType}ed a few seconds ago`;
			}

			// Send enhanced push notifications using the attendance service pattern
			try {
				await this.unifiedNotificationService.sendTemplatedNotification(
					notificationEvent,
					userIds,
					{
						message: enhancedMessage,
						deviceID: device.deviceID,
						deviceName: device.deviceTag || device.deviceID,
						location: device.devicLocation,
						deviceLocation: device.devicLocation,
						eventType: timeEventDto.eventType,
						eventAction,
						eventTime: timeString,
						organisationId: device.orgID,
						branchId: device.branchID,
						timestamp: eventDate.toISOString(),
						ipAddress: timeEventDto.ipAddress || 'unknown',
						accessMethod: 'IoT Sensor',
						isAfterHours: isAfterHours,
						businessHoursInfo: businessHoursInfo?.startTime && businessHoursInfo?.endTime 
							? `${businessHoursInfo.startTime} - ${businessHoursInfo.endTime}` 
							: 'Not defined',
						metadata: {
							deviceId: device.id,
							deviceType: device.deviceType,
							screen: '/iot/devices',
							action: 'view_device',
							notificationEvent: notificationEvent,
							isSecurityAlert: isAfterHours,
						},
					},
					{
						priority: priority,
					},
				);

				this.logger.log(
					`✅ [sendDeviceNotification] Enhanced device ${eventAction} notifications sent to ${relevantUsers.length} users`,
				);

			} catch (notificationError) {
				this.logger.warn(
					`⚠️ [sendDeviceNotification] Failed to send push notifications: ${notificationError.message}`,
					{
						deviceID: device.deviceID,
						eventType: timeEventDto.eventType,
						userCount: relevantUsers.length,
					},
				);
				// Still continue execution - don't fail the entire process
			}

		} catch (error) {
			this.logger.error(`❌ [sendDeviceNotification] Failed to send device notifications: ${error.message}`, {
				deviceID: device.deviceID,
				orgID: device.orgID,
				eventType: timeEventDto.eventType,
				stack: error.stack,
			});
		}
	}

	/**
	 * Post-event activities and cleanup
	 */
	private async performPostEventActivities(
		device: Device,
		timeEventDto: DeviceTimeRecordDto,
		recordResult: any,
		startTime: number,
	): Promise<void> {
		// Emit comprehensive time event for dashboard updates
		const orgRef = String(device.orgID);
		const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
		const orgTimezone =
			(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || TimezoneUtil.AFRICA_JOHANNESBURG;
		const eventDate = TimezoneUtil.toOrganizationTime(new Date(timeEventDto.timestamp * 1000), orgTimezone);
		this.eventEmitter.emit('device.time.event', {
			deviceId: device.id,
			deviceID: device.deviceID,
			orgId: device.orgID,
			branchId: device.branchID,
			eventType: timeEventDto.eventType,
			timestamp: eventDate,
			recordId: recordResult.record.id,
			action: recordResult.action,
			processingTime: Date.now() - startTime,
		});

		// Check if this is a close event and schedule daily logs email if it's the last device to close
		if (timeEventDto.eventType === 'close') {
			this.scheduleDailyDeviceLogsEmail(device.orgID, eventDate).catch(error => {
				this.logger.warn(`⚠️ Failed to schedule daily device logs email: ${error.message}`);
			});
		}

		// Invalidate all relevant caches - this is critical for real-time updates in mobile app
		// Using comprehensive cache invalidation pattern like user service
		await Promise.all([
			this.invalidateDeviceCache(device),
			this.invalidateRecordCache(recordResult.record),
		]);
		
		this.logger.debug(`💾 Cache invalidation completed for device ${device.deviceID} after time event processing`);
		
		// Emit comprehensive cache invalidation event for real-time updates
		this.eventEmitter.emit('iot.time.event.cache.cleared', {
			deviceId: device.id,
			deviceID: device.deviceID,
			orgId: device.orgID,
			branchId: device.branchID,
			eventType: timeEventDto.eventType,
			timestamp: new Date(),
			recordId: recordResult.record.id,
		});
	}

	/**
	 * Schedule daily device logs email to be sent after the last close event of the day
	 * Includes duplicate prevention to avoid multiple emails for the same day
	 */
	private async scheduleDailyDeviceLogsEmail(orgId: number, eventDate: Date): Promise<void> {
		try {
			// Check if we've already scheduled/sent daily logs for this org and date
			const dateKey = eventDate.toISOString().split('T')[0]; // YYYY-MM-DD format
			const lockKey = this.getCacheKey(`daily_logs_sent:${orgId}:${dateKey}`);
			
			const alreadySent = await this.cacheManager.get(lockKey);
			if (alreadySent) {
				this.logger.debug(`📅 [scheduleDailyDeviceLogsEmail] Daily logs already scheduled/sent for org ${orgId} on ${dateKey}`);
				return;
			}

			// Set lock to prevent duplicate scheduling (expires after 24 hours)
			await this.cacheManager.set(lockKey, true, 86400); // 24 hours
			
			this.logger.log(`📅 [scheduleDailyDeviceLogsEmail] Scheduling daily logs for org ${orgId} on ${dateKey}`);
			
			// Get organization hours to determine close time
			const orgRef = String(orgId);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;
			
			if (!orgHours) {
				this.logger.warn(`⚠️ [scheduleDailyDeviceLogsEmail] No organization hours found for org ${orgId}`);
				// Still send the email with default timing
				await this.sendDailyDeviceLogsEmail(orgId, eventDate);
				return;
			}

			// Parse close time (e.g., "17:30")
			const closeTimeParts = (orgHours.closeTime || "17:00").split(':');
			const closeHour = parseInt(closeTimeParts[0], 10);
			const closeMinute = parseInt(closeTimeParts[1] || '0', 10);
			
			// Create close time for today
			const todayCloseTime = new Date(eventDate);
			todayCloseTime.setHours(closeHour, closeMinute, 0, 0);
			
			// Schedule email 30 minutes after organization close time
			const emailTime = new Date(todayCloseTime.getTime() + (30 * 60 * 1000));
			const now = new Date();
			
			if (emailTime > now) {
				const delay = emailTime.getTime() - now.getTime();
				this.logger.log(`📧 [scheduleDailyDeviceLogsEmail] Scheduling daily logs email for org ${orgId} in ${Math.round(delay / 60000)} minutes`);
				
				setTimeout(async () => {
					await this.sendDailyDeviceLogsEmail(orgId, eventDate);
				}, delay);
			} else {
				// If we're already past the email time, send it now
				this.logger.log(`📧 [scheduleDailyDeviceLogsEmail] Sending daily logs email now for org ${orgId}`);
				await this.sendDailyDeviceLogsEmail(orgId, eventDate);
			}
		} catch (error) {
			this.logger.error(`❌ [scheduleDailyDeviceLogsEmail] Failed to schedule daily logs email: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send daily device logs email to admin, owner, manager, and technician users
	 */
	private async sendDailyDeviceLogsEmail(orgId: number, date: Date): Promise<void> {
		try {
			this.logger.log(`📧 [sendDailyDeviceLogsEmail] Sending daily device logs for org ${orgId} on ${date.toDateString()}`);

			// Get all devices for the organization
			const devices = await this.deviceRepository.find({
				where: { orgID: orgId, isDeleted: false },
				relations: ['records'],
				order: { deviceID: 'ASC' },
			});

			if (devices.length === 0) {
				this.logger.warn(`⚠️ [sendDailyDeviceLogsEmail] No devices found for org ${orgId}`);
				return;
			}

			// Filter records for today
			const today = new Date(date);
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const deviceLogs = devices.map(device => {
				const todayRecords = device.records?.filter(record => {
					const recordDate = new Date(record.createdAt);
					return recordDate >= today && recordDate < tomorrow;
				}) || [];

				return {
					deviceID: device.deviceID,
					deviceType: device.deviceType,
					location: device.devicLocation,
					status: device.currentStatus,
					records: todayRecords.map(record => {
						// Calculate total hours from open and close times
						let totalHours = 0;
						if (record.openTime && record.closeTime) {
							try {
								const openDate = new Date(record.openTime);
								const closeDate = new Date(record.closeTime);
								if (!isNaN(openDate.getTime()) && !isNaN(closeDate.getTime())) {
									const diffMs = closeDate.getTime() - openDate.getTime();
									totalHours = Math.max(0, diffMs / (1000 * 60 * 60)); // Convert to hours
								}
							} catch (error) {
								this.logger.warn(`Failed to calculate hours for record ${record.id}: ${error.message}`);
							}
						}
						
						return {
							openTime: record.openTime ? this.formatTimeForEmail(record.openTime) : null,
							closeTime: record.closeTime ? this.formatTimeForEmail(record.closeTime) : null,
							totalHours,
							createdAt: record.createdAt,
						};
					}),
				};
			});

			// Get relevant users for notification
			const relevantUsers = await this.userRepository.find({
				where: {
					organisationRef: orgId.toString(),
					accessLevel: In([AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER, AccessLevel.TECHNICIAN]),
					isDeleted: false,
				},
				select: ['uid', 'name', 'email', 'accessLevel'],
			});

			if (relevantUsers.length === 0) {
				this.logger.warn(`⚠️ [sendDailyDeviceLogsEmail] No relevant users found for org ${orgId}`);
				return;
			}

			// Prepare email data
			const totalDevices = devices.length;
			const activeDevices = deviceLogs.filter(log => log.records.length > 0).length;
			const totalEvents = deviceLogs.reduce((sum, log) => sum + log.records.length, 0);

			// Batch send emails to all users at once for better performance
			const summary = {
					date: date.toDateString(),
					totalDevices,
					activeDevices,
					totalEvents,
					orgId,
			};

			await this.sendBatchedDeviceLogsEmail(relevantUsers, deviceLogs, summary);

			this.logger.log(`✅ [sendDailyDeviceLogsEmail] Daily device logs sent to ${relevantUsers.length} users for org ${orgId}`);

		} catch (error) {
			this.logger.error(`❌ [sendDailyDeviceLogsEmail] Failed to send daily device logs: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send device logs email to multiple users in batch for better performance
	 */
	private async sendBatchedDeviceLogsEmail(
		users: any[], 
		deviceLogs: any[], 
		summary: { date: string; totalDevices: number; activeDevices: number; totalEvents: number; orgId: number }
	): Promise<void> {
		try {
			if (users.length === 0) {
				this.logger.warn(`⚠️ [sendBatchedDeviceLogsEmail] No users to send logs to for org ${summary.orgId}`);
				return;
			}

			// Prepare recipients list for batch sending
			const recipients = users.map(user => ({
				userId: user.uid,
				email: user.email,
				name: user.name,
			}));

			// Generate HTML content once for all users
			const htmlContent = this.generateDeviceLogsEmailHTML(users[0], deviceLogs, summary);

			const emailData = {
				event: NotificationEvent.GENERAL_NOTIFICATION,
				title: `📊 Daily Device Activity Report - ${summary.date}`,
				message: `Daily device activity summary: ${summary.activeDevices}/${summary.totalDevices} devices active, ${summary.totalEvents} total events`,
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				recipients, // Send to all users at once
				data: {
					type: 'DAILY_DEVICE_LOGS',
					orgId: summary.orgId,
					date: summary.date,
					summary,
					htmlContent,
				},
				email: {
					subject: `📊 Daily Device Activity Report - ${summary.date}`,
					templateData: {
						htmlContent,
						date: summary.date,
						summary,
					},
				},
				source: {
					service: 'iot',
					method: 'sendBatchedDeviceLogsEmail',
					entityId: summary.orgId,
					entityType: 'organization',
				},
			};

			// Send to all users in one batch call
			await this.unifiedNotificationService.sendNotification(emailData);
			this.logger.log(`📧 [sendBatchedDeviceLogsEmail] Sent daily logs to ${users.length} users in batch for org ${summary.orgId}`);

		} catch (error) {
			this.logger.error(`❌ [sendBatchedDeviceLogsEmail] Failed to send batch logs: ${error.message}`, error.stack);
			
			// Fallback to individual sending if batch fails
			this.logger.warn(`⚠️ [sendBatchedDeviceLogsEmail] Falling back to individual email sending`);
			for (const user of users) {
				await this.sendDeviceLogsEmailToUser(user, deviceLogs, summary).catch(individualError => {
					this.logger.error(`❌ [sendBatchedDeviceLogsEmail] Failed to send individual log to ${user.email}: ${individualError.message}`);
				});
			}
		}
	}

	/**
	 * Send device logs email to individual user
	 */
	private async sendDeviceLogsEmailToUser(
		user: any, 
		deviceLogs: any[], 
		summary: { date: string; totalDevices: number; activeDevices: number; totalEvents: number; orgId: number }
	): Promise<void> {
		try {
			const recipients = [{
				userId: user.uid,
				email: user.email,
				name: user.name,
			}];

			// Create HTML content for the email
			const htmlContent = this.generateDeviceLogsEmailHTML(user, deviceLogs, summary);

			const emailData = {
				event: NotificationEvent.GENERAL_NOTIFICATION,
				title: `📊 Daily Device Activity Report - ${summary.date}`,
				message: `Daily device activity summary: ${summary.activeDevices}/${summary.totalDevices} devices active, ${summary.totalEvents} total events`,
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				recipients,
				data: {
					type: 'DAILY_DEVICE_LOGS',
					orgId: summary.orgId,
					date: summary.date,
					summary,
					htmlContent, // Include HTML content in data instead
				},
				email: {
					subject: `📊 Daily Device Activity Report - ${summary.date}`,
					templateData: {
						htmlContent,
						date: summary.date,
						summary,
						user,
					},
				},
				source: {
					service: 'iot',
					method: 'sendDailyDeviceLogsEmail',
					entityId: summary.orgId,
					entityType: 'organization',
				},
			};

			await this.unifiedNotificationService.sendNotification(emailData);
			this.logger.log(`📧 [sendDeviceLogsEmailToUser] Sent daily logs to ${user.email} (${user.accessLevel})`);

		} catch (error) {
			this.logger.error(`❌ [sendDeviceLogsEmailToUser] Failed to send logs to ${user.email}: ${error.message}`);
		}
	}

	/**
	 * Generate HTML content for device logs email
	 */
	private generateDeviceLogsEmailHTML(user: any, deviceLogs: any[], summary: any): string {
		const deviceRowsHTML = deviceLogs.map(device => {
			const recordsHTML = device.records.length > 0 
				? device.records.map(record => `
					<li style="margin-bottom: 8px; padding: 8px; background-color: #f8f9fa; border-radius: 4px;">
						<strong>Open:</strong> ${record.openTime || 'N/A'} | 
						<strong>Close:</strong> ${record.closeTime || 'N/A'} | 
						<strong>Hours:</strong> ${record.totalHours?.toFixed(1) || '0.0'}h
					</li>
				`).join('')
				: '<li style="color: #6c757d; font-style: italic;">No activity recorded</li>';

			const statusColor = device.status === 'online' ? '#28a745' : 
							   device.status === 'offline' ? '#dc3545' : 
							   device.status === 'maintenance' ? '#ffc107' : '#6c757d';

			return `
				<div style="margin-bottom: 20px; padding: 15px; border: 1px solid #dee2e6; border-radius: 8px; background-color: #ffffff;">
					<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
						<h4 style="margin: 0; color: #495057;">${device.deviceID}</h4>
						<span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; color: white; background-color: ${statusColor};">
							${device.status.toUpperCase()}
						</span>
					</div>
					<p style="margin: 5px 0; color: #6c757d; font-size: 14px;">
						<strong>Type:</strong> ${device.deviceType} | <strong>Location:</strong> ${device.location}
					</p>
					<div style="margin-top: 10px;">
						<strong>Today's Activity (${device.records.length} events):</strong>
						<ul style="margin: 8px 0; padding-left: 20px;">
							${recordsHTML}
						</ul>
					</div>
				</div>
			`;
		}).join('');

		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<title>Daily Device Activity Report</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
				<div style="text-align: center; margin-bottom: 30px; padding: 20px; background-color: #f8f9fa; border-radius: 8px;">
					<h1 style="color: #495057; margin-bottom: 10px;">📊 Daily Device Activity Report</h1>
					<p style="font-size: 18px; color: #6c757d; margin: 0;">${summary.date}</p>
				</div>

				<div style="margin-bottom: 30px;">
					<h2 style="color: #495057;">Hello ${user.name},</h2>
					<p>Here's your daily summary of IoT device activities for your organization:</p>
				</div>

				<div style="margin-bottom: 30px; padding: 20px; background-color: #e9ecef; border-radius: 8px;">
					<h3 style="margin-top: 0; color: #495057;">📈 Summary</h3>
					<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
						<div style="text-align: center; padding: 15px; background-color: #ffffff; border-radius: 6px;">
							<div style="font-size: 24px; font-weight: bold; color: #007bff;">${summary.totalDevices}</div>
							<div style="font-size: 14px; color: #6c757d;">Total Devices</div>
						</div>
						<div style="text-align: center; padding: 15px; background-color: #ffffff; border-radius: 6px;">
							<div style="font-size: 24px; font-weight: bold; color: #28a745;">${summary.activeDevices}</div>
							<div style="font-size: 14px; color: #6c757d;">Active Today</div>
						</div>
						<div style="text-align: center; padding: 15px; background-color: #ffffff; border-radius: 6px;">
							<div style="font-size: 24px; font-weight: bold; color: #17a2b8;">${summary.totalEvents}</div>
							<div style="font-size: 14px; color: #6c757d;">Total Events</div>
						</div>
					</div>
				</div>

				<div style="margin-bottom: 30px;">
					<h3 style="color: #495057;">🔧 Device Details</h3>
					${deviceRowsHTML}
				</div>

				<div style="margin-top: 40px; padding: 20px; background-color: #f8f9fa; border-radius: 8px; text-align: center;">
					<p style="margin: 0; color: #6c757d; font-size: 14px;">
						This is an automated report generated at ${new Date().toLocaleString('en-ZA')}.<br>
						For questions or support, please contact your system administrator.
					</p>
				</div>
			</body>
			</html>
		`;
	}

	/**
	 * Format time for email display
	 */
	private formatTimeForEmail(timestamp: any): string {
		try {
			if (!timestamp) return 'N/A';
			
			let date: Date;
			if (typeof timestamp === 'string') {
				// Handle ISO string - extract UTC time components directly like in mobile
				if (timestamp.includes('T') && timestamp.includes('Z')) {
					const timeMatch = timestamp.match(/T(\d{2}):(\d{2}):(\d{2})/);
					if (timeMatch) {
						const hours = parseInt(timeMatch[1], 10);
						const minutes = parseInt(timeMatch[2], 10);
						const period = hours >= 12 ? 'PM' : 'AM';
						const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
						const paddedMinutes = minutes.toString().padStart(2, '0');
						return `${displayHours}:${paddedMinutes} ${period}`;
					}
				}
				date = new Date(timestamp);
			} else if (typeof timestamp === 'number') {
				date = timestamp < 1e12 ? new Date(timestamp * 1000) : new Date(timestamp);
			} else {
				date = timestamp as Date;
			}
			
			return date.toLocaleTimeString('en-ZA', {
				hour12: true,
				hour: 'numeric',
				minute: '2-digit',
			});
		} catch (error) {
			return 'N/A';
		}
	}

	private async updateDeviceAnalyticsFromRecord(
		device: Device,
		record: DeviceRecords,
		recordDto: CreateDeviceRecordDto,
	): Promise<void> {
		try {
			const analytics = { ...device.analytics };

			if (record.openTime) {
				analytics.openCount++;
				analytics.lastOpenAt = record.openTime as unknown as Date;
			}

			if (record.closeTime) {
				analytics.closeCount++;
				analytics.lastCloseAt = record.closeTime as unknown as Date;
			}

			analytics.totalCount = analytics.openCount + analytics.closeCount;

			await this.deviceRepository.update(device.id, {
				analytics,
				updatedAt: new Date(),
			});

			this.logger.debug(`Updated analytics for device ID: ${device.id}`);
		} catch (error) {
			this.logger.warn(`Failed to update device analytics: ${error.message}`);
		}
	}

	async findAllRecords(
		filters: RecordFilters = {},
		page: number = 1,
		limit: number = 10,
	): Promise<PaginatedResponse<DeviceRecords>> {
		const startTime = Date.now();
		const requestId = `findAllRecords_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		this.logger.log(
			`📊 [${requestId}] Starting device records fetch with filters: ${JSON.stringify(
				filters,
			)}, page: ${page}, limit: ${limit}`,
		);

		try {
			// Input validation
			if (page < 1) {
				this.logger.warn(`📊 [${requestId}] Invalid page number: ${page}, defaulting to 1`);
				page = 1;
			}
			if (limit < 1 || limit > 1000) {
				this.logger.warn(`📊 [${requestId}] Invalid limit: ${limit}, defaulting to 10`);
				limit = 10;
			}

			const cacheKey = this.getCacheKey(`records:${JSON.stringify({ filters, page, limit })}`);
			this.logger.debug(`📊 [${requestId}] Checking cache with key: ${cacheKey}`);

			const cached = await this.cacheManager.get<PaginatedResponse<DeviceRecords>>(cacheKey);

			if (cached) {
				const cacheHitTime = Date.now() - startTime;
				this.logger.log(`📊 [${requestId}] ✅ Cache hit! Returning cached records data in ${cacheHitTime}ms`);
				this.logger.debug(
					`📊 [${requestId}] Cache data summary: ${cached.data?.length || 0} records, total: ${
						cached.total
					}, pages: ${cached.totalPages}`,
				);
				return cached;
			}

			this.logger.debug(`📊 [${requestId}] Cache miss. Building database query...`);

			const queryBuilder = this.deviceRecordsRepository
				.createQueryBuilder('record')
				.leftJoinAndSelect('record.deviceID', 'device')
				.leftJoinAndSelect('device.organisation', 'organisation')
				.leftJoinAndSelect('device.branch', 'branch')
				.where('device.isDeleted = :isDeleted', { isDeleted: false })
				.orderBy('record.createdAt', 'DESC');

			this.logger.debug(`📊 [${requestId}] Base query created with device relations`);

			// Apply filters with detailed logging
			let appliedFilters = 0;

			if (filters.deviceId) {
				queryBuilder.andWhere('device.id = :deviceId', { deviceId: filters.deviceId });
				this.logger.debug(`📊 [${requestId}] Applied deviceId filter: ${filters.deviceId}`);
				appliedFilters++;
			}

			if (filters.orgId) {
				queryBuilder.andWhere('device.orgID = :orgId', { orgId: filters.orgId });
				this.logger.debug(`📊 [${requestId}] Applied orgId filter: ${filters.orgId}`);
				appliedFilters++;
			}

			if (filters.branchId) {
				queryBuilder.andWhere('device.branchID = :branchId', { branchId: filters.branchId });
				this.logger.debug(`📊 [${requestId}] Applied branchId filter: ${filters.branchId}`);
				appliedFilters++;
			}

			if (filters.startDate && filters.endDate) {
				queryBuilder.andWhere('record.createdAt BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});
				this.logger.debug(
					`📊 [${requestId}] Applied date range filter: ${filters.startDate} to ${filters.endDate}`,
				);
				appliedFilters++;
			}

			this.logger.log(`📊 [${requestId}] Applied ${appliedFilters} filters to query`);

			// Get total count
			const countStartTime = Date.now();
			const total = await queryBuilder.getCount();
			const countTime = Date.now() - countStartTime;
			this.logger.debug(`📊 [${requestId}] Count query completed: ${total} records found in ${countTime}ms`);

			// Apply pagination
			const offset = (page - 1) * limit;
			queryBuilder.skip(offset).take(limit);
			this.logger.debug(`📊 [${requestId}] Applied pagination: offset=${offset}, limit=${limit}`);

			// Execute main query
			const queryStartTime = Date.now();
			const records = await queryBuilder.getMany();
			const queryTime = Date.now() - queryStartTime;
			this.logger.debug(
				`📊 [${requestId}] Main query completed: ${records.length} records fetched in ${queryTime}ms`,
			);

			// Log record details for debugging
			if (records.length > 0) {
				const sampleRecord = records[0];
				this.logger.debug(
					`📊 [${requestId}] Sample record data: ID=${sampleRecord.id}, deviceId=${sampleRecord.deviceId}, openTime=${sampleRecord.openTime}, closeTime=${sampleRecord.closeTime}`,
				);
			} else {
				this.logger.warn(`📊 [${requestId}] No records found matching filters`);
			}

			const result: PaginatedResponse<DeviceRecords> = {
				data: records,
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			};

			// Cache the result
			const cacheStartTime = Date.now();
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			const cacheTime = Date.now() - cacheStartTime;
			this.logger.debug(`📊 [${requestId}] Result cached in ${cacheTime}ms with TTL: ${this.CACHE_TTL}ms`);

			const totalTime = Date.now() - startTime;
			this.logger.log(
				`📊 [${requestId}] ✅ Successfully fetched ${records.length} records (${total} total) in ${totalTime}ms`,
			);

			return result;
		} catch (error) {
			const errorTime = Date.now() - startTime;
			this.logger.error(`📊 [${requestId}] ❌ Failed to fetch records after ${errorTime}ms: ${error.message}`, {
				filters,
				page,
				limit,
				stack: error.stack,
				requestId,
			});
			throw new BadRequestException(`Failed to fetch records: ${error.message}`);
		}
	}

	async findOneRecord(id: number): Promise<{ record: DeviceRecords | null; message: string }> {
		try {
			const cacheKey = this.getCacheKey(`record:${id}`);
			const cached = await this.cacheManager.get<DeviceRecords>(cacheKey);

			if (cached) {
				this.logger.debug(`Returning cached record data for ID: ${id}`);
				return { record: cached, message: 'Record found successfully' };
			}

			const record = await this.deviceRecordsRepository.findOne({
				where: { id },
				relations: ['deviceID'],
			});

			if (!record) {
				return { record: null, message: 'Record not found' };
			}

			await this.cacheManager.set(cacheKey, record, this.CACHE_TTL);
			return { record, message: 'Record found successfully' };
		} catch (error) {
			this.logger.error(`Failed to find record with ID ${id}: ${error.message}`, error.stack);
			throw new BadRequestException('Failed to find record');
		}
	}

	async updateRecord(id: number, updateRecordDto: UpdateDeviceRecordDto): Promise<{ message: string }> {
		try {
			this.logger.log(`Updating record with ID: ${id}`);

			const record = await this.deviceRecordsRepository.findOne({
				where: { id },
				relations: ['deviceID'],
			});

			if (!record) {
				throw new NotFoundException('Record not found');
			}

			await this.deviceRecordsRepository.update(id, {
				...updateRecordDto,
				updatedAt: new Date(),
			});

			await this.invalidateRecordCache(record);

			this.logger.log(`Record updated successfully with ID: ${id}`);
			return { message: 'Record updated successfully' };
		} catch (error) {
			this.logger.error(`Failed to update record with ID ${id}: ${error.message}`, error.stack);
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException('Failed to update record');
		}
	}

	async removeRecord(id: number): Promise<{ message: string }> {
		try {
			this.logger.log(`Deleting record with ID: ${id}`);

			const record = await this.deviceRecordsRepository.findOne({
				where: { id },
				relations: ['deviceID'],
			});

			if (!record) {
				throw new NotFoundException('Record not found');
			}

			await this.deviceRecordsRepository.remove(record);
			await this.invalidateRecordCache(record);

			this.logger.log(`Record deleted successfully with ID: ${id}`);
			return { message: 'Record deleted successfully' };
		} catch (error) {
			this.logger.error(`Failed to delete record with ID ${id}: ${error.message}`, error.stack);
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException('Failed to delete record');
		}
	}

	/**
	 * Analytics and Reporting
	 */
	async getDeviceAnalytics(id: number): Promise<{ analytics: any | null; message: string }> {
		const startTime = Date.now();
		const requestId = `getDeviceAnalytics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		this.logger.log(`📊 [${requestId}] Starting analytics fetch for device ID: ${id}`);

		try {
			// Input validation
			if (!id || id <= 0) {
				this.logger.warn(`📊 [${requestId}] Invalid device ID: ${id}`);
				return { analytics: null, message: 'Invalid device ID' };
			}

			const cacheKey = this.getCacheKey(`analytics:device:${id}`);
			this.logger.debug(`📊 [${requestId}] Checking cache with key: ${cacheKey}`);

			const cached = await this.cacheManager.get(cacheKey);

			if (cached) {
				const cacheHitTime = Date.now() - startTime;
				this.logger.log(
					`📊 [${requestId}] ✅ Cache hit! Returning cached analytics for device ID: ${id} in ${cacheHitTime}ms`,
				);
				return { analytics: cached, message: 'Analytics retrieved successfully' };
			}

			this.logger.debug(`📊 [${requestId}] Cache miss. Fetching device data from database...`);

			const queryStartTime = Date.now();
			const device = await this.deviceRepository.findOne({
				where: { id, isDeleted: false },
				relations: ['records'],
			});
			const queryTime = Date.now() - queryStartTime;

			this.logger.debug(`📊 [${requestId}] Device query completed in ${queryTime}ms`);

			if (!device) {
				this.logger.warn(`📊 [${requestId}] Device not found with ID: ${id}`);
				return { analytics: null, message: 'Device not found' };
			}

			this.logger.debug(
				`📊 [${requestId}] Device found: ${device.deviceID}, type: ${device.deviceType}, status: ${device.currentStatus}`,
			);

			// Calculate additional analytics
			const totalRecords = device.records.length;
			const recentRecords = device.records.slice(0, 30); // Last 30 records

			this.logger.debug(
				`📊 [${requestId}] Processing analytics: ${totalRecords} total records, ${recentRecords.length} recent records`,
			);

			const analyticsStartTime = Date.now();
			const analytics = {
				...device.analytics,
				totalRecords,
				recentActivity: recentRecords.map((record) => ({
					id: record.id,
					openTime: record.openTime,
					closeTime: record.closeTime,
					date: record.createdAt,
				})),
				averageOpenTime: this.calculateAverageOpenTime(recentRecords),
				deviceUptime: this.calculateDeviceUptime(device),
				// Additional calculated metrics
				deviceInfo: {
					id: device.id,
					deviceID: device.deviceID,
					deviceType: device.deviceType,
					currentStatus: device.currentStatus,
					location: device.devicLocation,
					createdAt: device.createdAt,
					orgID: device.orgID,
					branchID: device.branchID,
				},
			};
			const analyticsTime = Date.now() - analyticsStartTime;

			this.logger.debug(
				`📊 [${requestId}] Analytics calculated in ${analyticsTime}ms: uptime=${analytics.deviceUptime}%, avgOpenTime=${analytics.averageOpenTime}h`,
			);

			// Cache the result
			const cacheStartTime = Date.now();
			await this.cacheManager.set(cacheKey, analytics, this.CACHE_TTL);
			const cacheTime = Date.now() - cacheStartTime;

			this.logger.debug(`📊 [${requestId}] Analytics cached in ${cacheTime}ms with TTL: ${this.CACHE_TTL}ms`);

			const totalTime = Date.now() - startTime;
			this.logger.log(
				`📊 [${requestId}] ✅ Successfully retrieved analytics for device ${device.deviceID} in ${totalTime}ms`,
			);

			return { analytics, message: 'Analytics retrieved successfully' };
		} catch (error) {
			const errorTime = Date.now() - startTime;
			this.logger.error(
				`📊 [${requestId}] ❌ Failed to get device analytics for ID ${id} after ${errorTime}ms: ${error.message}`,
				{
					deviceId: id,
					stack: error.stack,
					requestId,
				},
			);
			throw new BadRequestException(`Failed to get device analytics: ${error.message}`);
		}
	}

	async getAnalyticsSummary(filters: AnalyticsFilters): Promise<{ summary: any; message: string }> {
		try {
			const cacheKey = this.getCacheKey(`analytics:summary:${JSON.stringify(filters)}`);
			const cached = await this.cacheManager.get(cacheKey);

			if (cached) {
				this.logger.debug('Returning cached analytics summary');
				return { summary: cached, message: 'Analytics summary retrieved successfully' };
			}

			const queryBuilder = this.deviceRepository
				.createQueryBuilder('device')
				.leftJoinAndSelect('device.records', 'records')
				.where('device.isDeleted = :isDeleted', { isDeleted: false });

			// Apply filters
			if (filters.orgId) {
				queryBuilder.andWhere('device.orgID = :orgId', { orgId: filters.orgId });
			}

			if (filters.branchId) {
				queryBuilder.andWhere('device.branchID = :branchId', { branchId: filters.branchId });
			}

			if (filters.startDate && filters.endDate) {
				queryBuilder.andWhere('records.createdAt BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});
			}

			const devices = await queryBuilder.getMany();

			const summary = {
				totalDevices: devices.length,
				devicesByStatus: this.groupDevicesByStatus(devices),
				devicesByType: this.groupDevicesByType(devices),
				totalRecords: devices.reduce((sum, device) => sum + device.records.length, 0),
				totalOpenEvents: devices.reduce((sum, device) => sum + device.analytics.openCount, 0),
				totalCloseEvents: devices.reduce((sum, device) => sum + device.analytics.closeCount, 0),
				averageActivityPerDevice:
					devices.length > 0
						? devices.reduce((sum, device) => sum + device.analytics.totalCount, 0) / devices.length
						: 0,
			};

			await this.cacheManager.set(cacheKey, summary, this.CACHE_TTL);
			return { summary, message: 'Analytics summary retrieved successfully' };
		} catch (error) {
			this.logger.error(`Failed to get analytics summary: ${error.message}`, error.stack);
			throw new BadRequestException('Failed to get analytics summary');
		}
	}

	private calculateAverageOpenTime(records: DeviceRecords[]): number {
		if (records.length === 0) return 0;

		const validRecords = records.filter((record) => record.openTime && record.closeTime);
		if (validRecords.length === 0) return 0;

		const totalDuration = validRecords.reduce((sum, record) => {
			const openMs = (record.openTime as unknown as Date).getTime();
			const closeMs = (record.closeTime as unknown as Date).getTime();
			return sum + (closeMs - openMs) / 1000; // return seconds to preserve previous semantics
		}, 0);

		return totalDuration / validRecords.length;
	}

	private calculateDeviceUptime(device: Device): number {
		// Simple uptime calculation based on status
		return device.currentStatus === DeviceStatus.ONLINE ? 100 : 0;
	}

	private groupDevicesByStatus(devices: Device[]): Record<string, number> {
		return devices.reduce((acc, device) => {
			acc[device.currentStatus] = (acc[device.currentStatus] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);
	}

	private groupDevicesByType(devices: Device[]): Record<string, number> {
		return devices.reduce((acc, device) => {
			acc[device.deviceType] = (acc[device.deviceType] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);
	}

	/**
	 * IoT Device Reporting Methods (Similar to Attendance Reports)
	 *
	 * These methods generate comprehensive reports for device monitoring,
	 * similar to how attendance reports work for employee tracking.
	 */

	/**
	 * Generate Morning IoT Device Report
	 *
	 * Creates a comprehensive morning report focusing on device startup,
	 * availability, and overnight issues detection.
	 */
	async generateMorningReport(options: DeviceReportOptions) {
		const requestId = `morning_iot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		try {
			this.logger.log(`[${requestId}] 🌅 Starting morning IoT device report generation for org ${options.orgId}`);

			// Validate options with ternary operators for error prevention
			const validatedOptions = {
				...options,
				orgId: options.orgId || null,
				branchIds: options.branchIds?.length ? options.branchIds : undefined,
				includeAnalytics: options.includeAnalytics ?? true,
			};

			if (!validatedOptions.orgId) {
				throw new BadRequestException('Organization ID is required for report generation');
			}

			// Use the IoT reporting service for comprehensive report generation
			const reportResult = await this.iotReportingService.generateMorningReport(validatedOptions);

			// Log success with comprehensive details
			this.logger.log(
				`[${requestId}] ✅ Morning IoT report generated successfully - ` +
					`${reportResult.data?.summary?.totalDevices || 0} devices analyzed, ` +
					`${reportResult.data?.summary?.onlineDevices || 0} online, ` +
					`${reportResult.data?.alerts?.critical?.length || 0} critical alerts`,
			);

			// Send report to admins if configured
			if (reportResult.success && reportResult.data) {
				await this.iotReportingService.sendReportsToAdmins(reportResult.data, 'morning').catch((error) => {
					this.logger.warn(`[${requestId}] Failed to send morning report email: ${error.message}`);
				});
			}

			return reportResult;
		} catch (error) {
			this.logger.error(`[${requestId}] ❌ Failed to generate morning IoT report: ${error.message}`, error.stack);

			return {
				success: false,
				message: 'Failed to generate morning IoT device report',
				error: error.message,
				timestamp: new Date(),
				requestId,
			};
		}
	}

	/**
	 * Generate Evening IoT Device Report
	 *
	 * Creates a comprehensive evening report focusing on daily performance,
	 * usage analytics, and next-day preparation.
	 */
	async generateEveningReport(options: DeviceReportOptions) {
		const requestId = `evening_iot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		try {
			this.logger.log(`[${requestId}] 🌆 Starting evening IoT device report generation for org ${options.orgId}`);

			// Validate options with ternary operators
			const validatedOptions = {
				...options,
				orgId: options.orgId || null,
				branchIds: options.branchIds?.length ? options.branchIds : undefined,
				includeAnalytics: options.includeAnalytics ?? true,
			};

			if (!validatedOptions.orgId) {
				throw new BadRequestException('Organization ID is required for report generation');
			}

			// Use the IoT reporting service
			const reportResult = await this.iotReportingService.generateEveningReport(validatedOptions);

			// Log comprehensive success details
			this.logger.log(
				`[${requestId}] ✅ Evening IoT report generated successfully - ` +
					`${reportResult.data?.summary?.totalDevices || 0} devices analyzed, ` +
					`${reportResult.data?.summary?.totalWorkingHours || 0} total hours, ` +
					`${reportResult.data?.summary?.averageUptime || 0}% avg uptime`,
			);

			// Send report to admins
			if (reportResult.success && reportResult.data) {
				await this.iotReportingService.sendReportsToAdmins(reportResult.data, 'evening').catch((error) => {
					this.logger.warn(`[${requestId}] Failed to send evening report email: ${error.message}`);
				});
			}

			return reportResult;
		} catch (error) {
			this.logger.error(`[${requestId}] ❌ Failed to generate evening IoT report: ${error.message}`, error.stack);

			return {
				success: false,
				message: 'Failed to generate evening IoT device report',
				error: error.message,
				timestamp: new Date(),
				requestId,
			};
		}
	}

	/**
	 * Calculate Device Open/Close Times and Punctuality
	 *
	 * Provides detailed timing analysis for individual devices,
	 * similar to employee punctuality calculations.
	 */
	async calculateDeviceTimings(
		deviceId: number,
		dateRange?: { start: Date; end: Date },
	): Promise<DevicePerformanceMetrics> {
		const requestId = `timing_calc_${deviceId}_${Date.now()}`;

		try {
			this.logger.log(`[${requestId}] ⏱️ Starting device timing calculation for device ${deviceId}`);

			// Validate input with ternary operators
			const validDeviceId = deviceId && deviceId > 0 ? deviceId : null;
			if (!validDeviceId) {
				throw new BadRequestException('Valid device ID is required');
			}

			// Use the IoT reporting service for calculations
			const metrics = await this.iotReportingService.calculateDeviceTimings(validDeviceId, dateRange);

			// Log comprehensive results
			this.logger.log(
				`[${requestId}] ✅ Device timing analysis completed - ` +
					`Device ${deviceId}: ${metrics.efficiencyScore?.toFixed(1) || 'N/A'}% efficiency, ` +
					`${metrics.uptimePercentage?.toFixed(1) || 'N/A'}% uptime, ` +
					`${metrics.openTimePunctuality?.toFixed(1) || 'N/A'}% opening punctuality, ` +
					`Maintenance needed: ${metrics.maintenanceNeeded ? 'Yes' : 'No'}`,
			);

			// Emit event for analytics and notifications
			this.eventEmitter.emit('iot.device.performance_calculated', {
				deviceId,
				metrics,
				requestId,
				timestamp: new Date(),
			});

			return metrics;
		} catch (error) {
			this.logger.error(`[${requestId}] ❌ Failed to calculate device timings: ${error.message}`, error.stack);
			throw error;
		}
	}
}
