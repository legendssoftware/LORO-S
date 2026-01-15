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
import { Repository, DataSource, Between, Not, IsNull, QueryFailedError, In, MoreThanOrEqual } from 'typeorm';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Device, DeviceRecords, DeviceLogs } from './entities/iot.entity';
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
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { format } from 'date-fns';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { User } from '../user/entities/user.entity';
import { AccessLevel } from '../lib/enums/user.enums';
import { NotificationEvent, NotificationPriority, NotificationChannel } from '../lib/types/unified-notification.types';
import { Branch } from '../branch/entities/branch.entity';
import { Attendance } from '../attendance/entities/attendance.entity';
import { ErpDataService } from '../erp/services/erp-data.service';

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

interface DoorUserComparison {
	userId: number;
	userName: string;
	userSurname: string;
	doorOpenTime: string | null; // ISO string format
	userClockInTime: string | null; // ISO string format
	timeDifferenceMinutes: number | null; // positive = door opened after user clocked in, negative = door opened before
	isEarly: boolean; // door opened before user clocked in (morning)
	isLate: boolean; // door opened after user clocked in (morning)
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
		@InjectRepository(DeviceLogs)
		private deviceLogsRepository: Repository<DeviceLogs>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Branch)
		private branchRepository: Repository<Branch>,
		@InjectRepository(Attendance)
		private attendanceRepository: Repository<Attendance>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly eventEmitter: EventEmitter2,
		private readonly configService: ConfigService,
		private readonly dataSource: DataSource,
		private readonly iotReportingService: IoTReportingService,
		private readonly organisationHoursService: OrganisationHoursService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly erpDataService: ErpDataService,
	) {
		this.CACHE_TTL = parseInt(this.configService.get<string>('CACHE_TTL', '300'));
		this.logger.log('🤖 IoT Service initialized');
	}

	/**
	 * Cache Management
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Normalize branch name using ErpDataService to match ERP format
	 * Tries to extract store code from branch.ref or branch.name
	 */
	private async normalizeBranchName(branch: Branch | null | undefined, countryCode: string = 'SA'): Promise<string | null> {
		if (!branch) return null;

		// Try to extract store code from branch.ref (if it looks like a store code: 3 digits)
		let storeCode: string | null = null;
		if (branch.ref && /^\d{3}$/.test(branch.ref.trim())) {
			storeCode = branch.ref.trim();
		} else if (branch.name) {
			// Try to extract store code from branch name (e.g., "001 - Branch Name" or "Branch 001")
			const storeCodeMatch = branch.name.match(/\b(\d{3})\b/);
			if (storeCodeMatch) {
				storeCode = storeCodeMatch[1];
			}
		}

		// If we found a store code, normalize using ErpDataService
		if (storeCode) {
			try {
				const normalizedName = await this.erpDataService.getBranchNameFromDatabase(storeCode, countryCode);
				return normalizedName;
			} catch (error) {
				this.logger.warn(`Failed to normalize branch name for store code ${storeCode}: ${error.message}`);
				// Fallback to original branch name
				return branch.name;
			}
		}

		// Fallback to original branch name if no store code found
		return branch.name;
	}

	private async invalidateDeviceCache(device: Device) {
		try {
			const keys = await this.cacheManager.store.keys();
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
			);

			// Add organization and branch specific keys
			keysToDelete.push(
				this.getCacheKey(`devices:org:${device.orgID}`),
				this.getCacheKey(`devices:branch:${device.branchID}`),
				this.getCacheKey('devices:all'),
			);

			// Clear ALL device list caches that match the orgId
			const orgIdStr = device.orgID.toString();
			const branchIdStr = device.branchID?.toString() || '';
			
			const deviceListCaches = keys.filter(
				(key) => {
					if (key.startsWith(`${this.CACHE_PREFIX}devices:`)) {
						return key.includes(`"orgId":${orgIdStr}`) || 
						       key.includes(`"orgId":"${orgIdStr}"`) ||
						       key.includes(`orgId:${orgIdStr}`) ||
						       key.includes(orgIdStr);
					}
					return false;
				}
			);
			keysToDelete.push(...deviceListCaches);

			// Clear all record and analytics caches for this organization
			const relatedCaches = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}records:`) ||
					key.startsWith(`${this.CACHE_PREFIX}analytics:`) ||
					key.startsWith(`${this.CACHE_PREFIX}record:today:`) ||
					key.startsWith(`${this.CACHE_PREFIX}record:latest:`) ||
					key.startsWith(`${this.CACHE_PREFIX}record:open:`) ||
					key.startsWith(`${this.CACHE_PREFIX}record:recent:`) ||
					key.includes(device.deviceID) ||
					(key.includes(orgIdStr) && (key.includes('device') || key.includes('record')))
			);
			keysToDelete.push(...relatedCaches);
			
			// Also invalidate record caches for this device
			await this.invalidateRecordCaches(device.id);

			const uniqueKeys = [...new Set(keysToDelete)];
			await Promise.all(uniqueKeys.map((key) => this.cacheManager.del(key)));

			// Emit event for other services that might be caching device data
			this.eventEmitter.emit('iot.devices.cache.invalidate', {
				deviceId: device.id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				keys: uniqueKeys,
			});
		} catch (error) {
			this.logger.error(`Error invalidating device cache: ${error.message}`);
		}
	}

	private async invalidateRecordCache(record: DeviceRecords) {
		try {
			const device = await this.deviceRepository.findOne({
				where: { id: record.deviceId },
				select: ['id', 'orgID', 'branchID', 'deviceID'],
			});

			if (!device) {
				return;
			}

			// Get date key for today's record caches
			const recordDate = record.createdAt instanceof Date 
				? record.createdAt 
				: new Date(record.createdAt);
			const dateKey = recordDate.toISOString().split('T')[0];

			// Invalidate record-related caches
			await this.invalidateRecordCaches(device.id, dateKey);

			const keys = await this.cacheManager.store.keys();
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

			const uniqueKeys = [...new Set(keysToDelete)];
			await Promise.all(uniqueKeys.map((key) => this.cacheManager.del(key)));

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
			this.logger.error(`Error invalidating record cache: ${error.message}`);
		}
	}

	/**
	 * Invalidate all IoT-related caches (for use in system-wide cache clearing)
	 * Following the comprehensive pattern from user service
	 */
	async invalidateAllIoTCaches(): Promise<void> {
		try {
			const keys = await this.cacheManager.store.keys();

			const iotCacheKeys = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}`) ||
					key.includes('iot') ||
					key.includes('device') ||
					key.includes('record') ||
					key.includes('analytics') ||
					key.includes('business_hours'),
			);

			await Promise.all(iotCacheKeys.map((key) => this.cacheManager.del(key)));

			this.eventEmitter.emit('iot.cache.invalidate.all', {
				clearedKeys: iotCacheKeys.length,
				timestamp: new Date(),
			});
		} catch (error) {
			this.logger.error(`Error during comprehensive IoT cache invalidation: ${error.message}`);
		}
	}

	/**
	 * Get today's records for a device from cache or DB
	 * @param deviceId - Device ID
	 * @param today - Start of today's date
	 * @param tomorrow - Start of tomorrow's date
	 * @param queryRunner - Optional query runner for transaction context
	 * @returns Array of today's records
	 */
	private async getTodayRecords(
		deviceId: number,
		today: Date,
		tomorrow: Date,
		queryRunner?: any,
	): Promise<DeviceRecords[]> {
		// Create cache key with date to ensure daily cache invalidation
		const dateKey = today.toISOString().split('T')[0]; // YYYY-MM-DD
		const cacheKey = this.getCacheKey(`records:today:${deviceId}:${dateKey}`);
		
		// Try cache first
		const cachedRecords = await this.cacheManager.get<DeviceRecords[]>(cacheKey);
		if (cachedRecords) {
			this.logger.debug(`💾 Cache hit for today's records: device ${deviceId}, date ${dateKey}`);
			return cachedRecords;
		}

		// Cache miss - fetch from DB
		const repository = queryRunner?.manager?.getRepository(DeviceRecords) || this.deviceRecordsRepository;
		const todayRecords = await repository.find({
			where: {
				deviceId: deviceId,
				createdAt: Between(today, tomorrow),
			},
			order: { createdAt: 'DESC' },
		});

		// Cache for future requests (cache until end of day + buffer)
		const now = new Date();
		const endOfDay = new Date(today);
		endOfDay.setHours(23, 59, 59, 999);
		const ttlMs = Math.max(endOfDay.getTime() - now.getTime() + 60000, 60000); // At least 1 minute
		const ttlSeconds = Math.ceil(ttlMs / 1000);
		
		await this.cacheManager.set(cacheKey, todayRecords, ttlSeconds);
		this.logger.debug(`💾 Cached today's records: device ${deviceId}, date ${dateKey}, count: ${todayRecords.length}`);
		
		return todayRecords;
	}

	/**
	 * Get latest record for a device from cache or DB
	 * @param deviceId - Device ID
	 * @param today - Start of today's date
	 * @param tomorrow - Start of tomorrow's date
	 * @param queryRunner - Optional query runner for transaction context
	 * @returns Latest record or null
	 */
	private async getLatestRecord(
		deviceId: number,
		today: Date,
		tomorrow: Date,
		queryRunner?: any,
	): Promise<DeviceRecords | null> {
		// Create cache key with date
		const dateKey = today.toISOString().split('T')[0];
		const cacheKey = this.getCacheKey(`record:latest:${deviceId}:${dateKey}`);
		
		// Try cache first
		const cachedRecord = await this.cacheManager.get<DeviceRecords>(cacheKey);
		if (cachedRecord !== undefined && cachedRecord !== null) {
			this.logger.debug(`💾 Cache hit for latest record: device ${deviceId}, date ${dateKey}`);
			return cachedRecord;
		}

		// Cache miss - fetch from DB
		const repository = queryRunner?.manager?.getRepository(DeviceRecords) || this.deviceRecordsRepository;
		const latestRecord = await repository.findOne({
			where: {
				deviceId: deviceId,
				createdAt: Between(today, tomorrow),
			},
			order: { createdAt: 'DESC' },
		});

		// Cache the result (even if null) until end of day
		const now = new Date();
		const endOfDay = new Date(today);
		endOfDay.setHours(23, 59, 59, 999);
		const ttlMs = Math.max(endOfDay.getTime() - now.getTime() + 60000, 60000);
		const ttlSeconds = Math.ceil(ttlMs / 1000);
		
		await this.cacheManager.set(cacheKey, latestRecord, ttlSeconds);
		this.logger.debug(`💾 Cached latest record: device ${deviceId}, date ${dateKey}, recordId: ${latestRecord?.id || 'null'}`);
		
		return latestRecord;
	}

	/**
	 * Get open record without close from cache or DB
	 * @param deviceId - Device ID
	 * @param queryRunner - Optional query runner for transaction context
	 * @returns Open record without close or null
	 */
	private async getOpenRecordWithoutClose(
		deviceId: number,
		queryRunner?: any,
	): Promise<DeviceRecords | null> {
		const cacheKey = this.getCacheKey(`record:open:no-close:${deviceId}`);
		
		// Try cache first
		const cachedRecord = await this.cacheManager.get<DeviceRecords>(cacheKey);
		if (cachedRecord !== undefined) {
			this.logger.debug(`💾 Cache hit for open record without close: device ${deviceId}`);
			// Verify it's still valid (not closed)
			if (cachedRecord && !cachedRecord.closeTime) {
				return cachedRecord;
			}
			// If cached record has close time, it's stale - remove from cache
			await this.cacheManager.del(cacheKey);
		}

		// Cache miss or stale - fetch from DB
		const repository = queryRunner?.manager?.getRepository(DeviceRecords) || this.deviceRecordsRepository;
		const openRecord = await repository.findOne({
			where: {
				deviceId: deviceId,
				openTime: Not(IsNull()),
				closeTime: IsNull(),
			},
			order: { updatedAt: 'DESC' },
		});

		// Cache for 5 minutes (short TTL since this changes frequently)
		await this.cacheManager.set(cacheKey, openRecord, 300);
		this.logger.debug(`💾 Cached open record without close: device ${deviceId}, recordId: ${openRecord?.id || 'null'}`);
		
		return openRecord;
	}

	/**
	 * Get recent events for debouncing from cache or DB
	 * @param deviceId - Device ID
	 * @param eventType - Event type ('open' or 'close')
	 * @param debounceThreshold - Threshold date for recent events
	 * @param queryRunner - Optional query runner for transaction context
	 * @returns Recent event or null
	 */
	private async getRecentEvent(
		deviceId: number,
		eventType: 'open' | 'close',
		debounceThreshold: Date,
		queryRunner?: any,
	): Promise<DeviceRecords | null> {
		// Cache key includes threshold timestamp (rounded to minute) for better cache hits
		const thresholdKey = Math.floor(debounceThreshold.getTime() / 60000); // Round to minute
		const cacheKey = this.getCacheKey(`record:recent:${deviceId}:${eventType}:${thresholdKey}`);
		
		// Try cache first
		const cachedRecord = await this.cacheManager.get<DeviceRecords>(cacheKey);
		if (cachedRecord !== undefined) {
			this.logger.debug(`💾 Cache hit for recent ${eventType} event: device ${deviceId}`);
			return cachedRecord;
		}

		// Cache miss - fetch from DB
		const repository = queryRunner?.manager?.getRepository(DeviceRecords) || this.deviceRecordsRepository;
		const whereCondition: any = {
			deviceId: deviceId,
			updatedAt: MoreThanOrEqual(debounceThreshold),
		};
		
		if (eventType === 'open') {
			whereCondition.openTime = Not(IsNull());
		} else {
			whereCondition.closeTime = Not(IsNull());
		}

		const recentRecords = await repository.find({
			where: whereCondition,
			order: { updatedAt: 'DESC' },
			take: 1,
		});

		const recentEvent = recentRecords.length > 0 ? recentRecords[0] : null;

		// Cache for 5 minutes (short TTL for debouncing checks)
		await this.cacheManager.set(cacheKey, recentEvent, 300);
		this.logger.debug(`💾 Cached recent ${eventType} event: device ${deviceId}, recordId: ${recentEvent?.id || 'null'}`);
		
		return recentEvent;
	}

	/**
	 * Invalidate record-related caches for a device
	 * @param deviceId - Device ID
	 * @param dateKey - Optional date key (YYYY-MM-DD), if not provided, invalidates all dates
	 */
	private async invalidateRecordCaches(deviceId: number, dateKey?: string): Promise<void> {
		try {
			const keys = await this.cacheManager.store.keys();
			const keysToDelete: string[] = [];

			if (dateKey) {
				// Invalidate specific date caches
				keysToDelete.push(
					this.getCacheKey(`records:today:${deviceId}:${dateKey}`),
					this.getCacheKey(`record:latest:${deviceId}:${dateKey}`),
				);
			} else {
				// Invalidate all date caches for this device
				const deviceRecordCaches = keys.filter(
					(key) =>
						key.startsWith(this.getCacheKey(`records:today:${deviceId}:`)) ||
						key.startsWith(this.getCacheKey(`record:latest:${deviceId}:`)),
				);
				keysToDelete.push(...deviceRecordCaches);
			}

			// Always invalidate open record cache (since it changes frequently)
			keysToDelete.push(
				this.getCacheKey(`record:open:no-close:${deviceId}`),
			);

			// Invalidate recent event caches
			const recentEventCaches = keys.filter(
				(key) => key.startsWith(this.getCacheKey(`record:recent:${deviceId}:`)),
			);
			keysToDelete.push(...recentEventCaches);

			const uniqueKeys = [...new Set(keysToDelete)];
			await Promise.all(uniqueKeys.map((key) => this.cacheManager.del(key)));
			
			this.logger.debug(`💾 Invalidated ${uniqueKeys.length} record caches for device ${deviceId}`);
		} catch (error) {
			this.logger.error(`Error invalidating record caches: ${error.message}`);
		}
	}

	/**
	 * Save device log with key information
	 * This method saves logs for both successful and failed operations
	 * IMPORTANT: Only saves logs when device exists to avoid foreign key constraint violations
	 */
	private async saveDeviceLog(
		device: Device | null,
		timeEventDto: DeviceTimeRecordDto,
		queryTimeMs: number,
		networkInfo?: {
			ipAddress?: string;
			port?: number;
			headers?: Record<string, string>;
			userAgent?: string;
			referer?: string;
		},
		errorInfo?: {
			success: boolean;
			errorType?: string;
			errorMessage?: string;
			errorDetails?: any;
		},
	): Promise<void> {
		try {
			// Skip saving log if device is null to avoid foreign key constraint violation
			if (!device || !device.id) {
				this.logger.debug(`Skipping device log save: device is null or has no ID`);
				return;
			}

			const deviceId = device.id;
			const deviceID = device.deviceID || timeEventDto.deviceID || 'Unknown';
			const orgID = device.orgID || 0;
			const branchID = device.branchID || null;
			const devicePort = device.devicePort || null;

			// Ensure timestamp is always provided - use timeEventDto.timestamp or fallback to current time
			const eventTimestamp = timeEventDto.timestamp && timeEventDto.timestamp > 0
				? new Date(timeEventDto.timestamp * 1000)
				: new Date();

			const deviceLog = this.deviceLogsRepository.create({
				deviceId,
				deviceID,
				orgID,
				branchID,
				eventType: timeEventDto.eventType,
				ipAddress: timeEventDto.ipAddress || networkInfo?.ipAddress || 'Unknown',
				userAgent: networkInfo?.userAgent || 'Unknown',
				networkInfo: {
					ipAddress: timeEventDto.ipAddress || networkInfo?.ipAddress,
					port: devicePort,
					headers: networkInfo?.headers,
					userAgent: networkInfo?.userAgent,
					referer: networkInfo?.referer,
				},
				queryTimeMs,
				timestamp: eventTimestamp,
				metadata: {
					...(timeEventDto.metadata || {}),
					success: errorInfo?.success ?? true,
					errorType: errorInfo?.errorType,
					errorMessage: errorInfo?.errorMessage,
					errorDetails: errorInfo?.errorDetails,
				},
			});

			await this.deviceLogsRepository.save(deviceLog);
		} catch (error) {
			this.logger.warn(`Failed to save device log: ${error.message}`);
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

			// eventDate is already converted using toZonedTime
			// which returns a UTC Date representing org local time, so use getUTCHours/getUTCMinutes
			const eventHour = eventDate.getUTCHours();
			const eventMinute = eventDate.getUTCMinutes();
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
		
		// Log incoming data for debugging
		this.logger.log(
			`🤖 Creating device with ID: ${createDeviceDto.deviceID} for org: ${createDeviceDto.orgID}, branch: ${createDeviceDto.branchID}`,
		);
		this.logger.debug(
			`📥 Incoming device data: ${JSON.stringify({
				deviceID: createDeviceDto.deviceID,
				deviceType: createDeviceDto.deviceType,
				currentStatus: createDeviceDto.currentStatus,
				deviceIP: createDeviceDto.deviceIP,
				devicePort: createDeviceDto.devicePort,
			})}`,
		);

		// Transform enum values if needed (fallback if ValidationPipe transform doesn't work)
		let transformedDeviceType = createDeviceDto.deviceType;
		if (typeof transformedDeviceType === 'string') {
			const upperValue = transformedDeviceType.toUpperCase();
			if (upperValue in DeviceType) {
				transformedDeviceType = DeviceType[upperValue as keyof typeof DeviceType];
				this.logger.debug(
					`🔄 Transformed deviceType from "${createDeviceDto.deviceType}" to "${transformedDeviceType}"`,
				);
			}
		}

		let transformedStatus = createDeviceDto.currentStatus;
		if (typeof transformedStatus === 'string') {
			const upperValue = transformedStatus.toUpperCase();
			if (upperValue in DeviceStatus) {
				transformedStatus = DeviceStatus[upperValue as keyof typeof DeviceStatus];
				this.logger.debug(
					`🔄 Transformed currentStatus from "${createDeviceDto.currentStatus}" to "${transformedStatus}"`,
				);
			}
		}

		// Start transaction for data consistency
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// 1. Comprehensive validation
			await this.validateDeviceCreation(createDeviceDto, queryRunner);

			// 2. Fetch and validate branch exists and belongs to organization
			const branch = await queryRunner.manager.findOne(Branch, {
				where: {
					uid: createDeviceDto.branchID,
					isDeleted: false,
					organisation: { uid: createDeviceDto.orgID },
				},
				relations: ['organisation'],
			});

			if (!branch) {
				throw new NotFoundException(
					`Branch with ID ${createDeviceDto.branchID} not found or does not belong to organization ${createDeviceDto.orgID}`,
				);
			}

			// Ensure branchID and branchUid are both populated with the branch's uid
			const branchUid = branch.uid;

			// 3. Check for existing device conflicts
			await this.checkDeviceConflicts(createDeviceDto, queryRunner);

			// 4. Validate network connectivity (if enabled)
			if (this.configService.get<boolean>('IOT_VALIDATE_CONNECTIVITY', false)) {
				await this.validateDeviceConnectivity(createDeviceDto);
			}

			// 5. Initialize comprehensive analytics
			const defaultAnalytics = this.initializeDeviceAnalytics();

			// 6. Create device with enriched data - ensure both branchID and branchUid are set
			const deviceData = {
				...createDeviceDto,
				branchID: branchUid, // Ensure branchID is set to branch's uid
				branchUid: branchUid, // Set branchUid to branch's uid
				deviceType: transformedDeviceType || DeviceType.DOOR_SENSOR,
				currentStatus: transformedStatus || DeviceStatus.ONLINE,
				analytics: createDeviceDto.analytics || defaultAnalytics,
				createdAt: new Date(),
				updatedAt: new Date(),
				isDeleted: false,
			};

			// Log the final device data before saving
			this.logger.debug(
				`💾 Final device data to save: ${JSON.stringify({
					deviceID: deviceData.deviceID,
					deviceType: deviceData.deviceType,
					currentStatus: deviceData.currentStatus,
					branchID: deviceData.branchID,
					branchUid: deviceData.branchUid,
				})}`,
			);

			const device = queryRunner.manager.create(Device, deviceData);
			const savedDevice = await queryRunner.manager.save(device);

			// 7. Create initial audit log
			await this.createDeviceAuditLog(queryRunner, savedDevice, 'DEVICE_CREATED', 'Initial device registration');

			// 8. Initialize device monitoring
			await this.initializeDeviceMonitoring(savedDevice);

			// 9. Cache device data
			await this.cacheDeviceData(savedDevice);

			// 10. Commit transaction
			await queryRunner.commitTransaction();

			// 11. Invalidate device list caches AFTER transaction commit
			await this.invalidateDeviceCache(savedDevice);

			// 12. Post-creation activities (outside transaction)
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
			
			// Enhanced error logging
			const errorDetails = {
				deviceID: createDeviceDto.deviceID,
				orgID: createDeviceDto.orgID,
				branchID: createDeviceDto.branchID,
				deviceType: createDeviceDto.deviceType,
				transformedDeviceType: transformedDeviceType,
				currentStatus: createDeviceDto.currentStatus,
				transformedStatus: transformedStatus,
				duration: Date.now() - startTime,
				errorMessage: error instanceof Error ? error.message : String(error),
				errorName: error instanceof Error ? error.name : 'UnknownError',
				stack: error instanceof Error ? error.stack : undefined,
			};
			
			this.logger.error(`❌ Failed to create device: ${errorDetails.errorMessage}`);
			this.logger.error(`📋 Error details: ${JSON.stringify(errorDetails, null, 2)}`);

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

	/**
	 * Format time as ISO string where UTC hours = local hours
	 * This ensures mobile app can read UTC hours/minutes as if they were local time
	 */
	private formatTimeAsLocalISO(date: Date | null): string | null {
		if (!date) return null;
		// Get local time components from the zoned date
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');
		const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
		// Create ISO string where UTC = local time
		return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}Z`;
	}

	/**
	 * Get door-user comparisons for a device
	 * Compares door open times with user clock-in times for users who manage this door
	 */
	private async getDoorUserComparisons(device: Device): Promise<DoorUserComparison[]> {
		try {
			// Find users who have this device in their managedDoors
			const users = await this.userRepository.find({
				where: {
					organisationRef: device.orgID.toString(),
					isDeleted: false,
				},
				select: ['uid', 'name', 'surname', 'managedDoors'],
			});

			// Filter users who manage this device
			const managingUsers = users.filter(
				user => user.managedDoors && Array.isArray(user.managedDoors) && user.managedDoors.includes(device.id)
			);

			if (managingUsers.length === 0) {
				return [];
			}

			// Get organization hours and timezone
			const orgRef = String(device.orgID);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;
			const orgTimezone = orgHours?.timezone || 'Africa/Johannesburg';
			
			// Get today's date in organization timezone
			const today = new Date();
			const todayOrg = toZonedTime(today, orgTimezone);
			
			// Create date range using organization hours (start at 00:00, end at 23:59:59.999 in org timezone)
			const startOfDay = new Date(todayOrg);
			startOfDay.setUTCHours(0, 0, 0, 0);
			const endOfDay = new Date(todayOrg);
			endOfDay.setUTCHours(23, 59, 59, 999);

			// Ensure device records are fully loaded
			let deviceRecords = device.records;
			if (!deviceRecords || deviceRecords.length === 0) {
				const deviceWithRecords = await this.deviceRepository.findOne({
					where: { id: device.id },
					relations: ['records'],
				});
				deviceRecords = deviceWithRecords?.records || [];
			}

			// Get today's attendance records for managing users with organization filter
			const userIds = managingUsers.map(u => u.uid);
			const todayAttendance = await this.attendanceRepository.find({
				where: {
					owner: { uid: In(userIds) },
					organisation: { uid: device.orgID },
					checkIn: Between(startOfDay, endOfDay),
				},
				relations: ['owner', 'owner.branch', 'owner.organisation'],
				order: { checkIn: 'ASC' },
			});

			// Get today's door open time (earliest open record)
			const todayRecords = deviceRecords.filter(r => {
				if (!r.openTime) return false;
				const recordDate = typeof r.openTime === 'string' ? new Date(r.openTime) : (r.openTime as unknown as Date);
				const recordDateOrg = toZonedTime(recordDate, orgTimezone);
				const recordDateKey = recordDateOrg.toISOString().split('T')[0];
				const todayKey = todayOrg.toISOString().split('T')[0];
				return recordDateKey === todayKey;
			});

			// Sort records by openTime to get the earliest (first) open time of the day
			const sortedTodayRecords = todayRecords.sort((a, b) => {
				const aTime = typeof a.openTime === 'string' ? new Date(a.openTime) : (a.openTime as unknown as Date);
				const bTime = typeof b.openTime === 'string' ? new Date(b.openTime) : (b.openTime as unknown as Date);
				return aTime.getTime() - bTime.getTime(); // Sort ascending (earliest first)
			});

			// Door open time: use raw time for display, but convert for comparison
			const doorOpenTimeRaw = sortedTodayRecords.length > 0 && sortedTodayRecords[0].openTime
				? (typeof sortedTodayRecords[0].openTime === 'string' 
					? new Date(sortedTodayRecords[0].openTime) 
					: (sortedTodayRecords[0].openTime as unknown as Date))
				: null;

			// Create comparisons for each managing user
			const comparisons: DoorUserComparison[] = managingUsers.map(user => {
				const userAttendance = todayAttendance.find(a => a.owner?.uid === user.uid);
				const userClockInTime = userAttendance?.checkIn || null;

				// Convert both times to organization timezone for accurate comparison
				const doorOpenTimeOrg = doorOpenTimeRaw ? toZonedTime(doorOpenTimeRaw, orgTimezone) : null;
				const clockInOrg = userClockInTime ? toZonedTime(userClockInTime, orgTimezone) : null;

				let timeDifferenceMinutes: number | null = null;
				let isEarly = false;
				let isLate = false;

				if (doorOpenTimeOrg && clockInOrg) {
					// Calculate difference in minutes (doorOpenTime - userClockInTime)
					// Both times are now in org timezone for accurate comparison
					timeDifferenceMinutes = Math.round((doorOpenTimeOrg.getTime() - clockInOrg.getTime()) / (1000 * 60));
					
					// Morning logic: negative = door opened before user clocked in (good/early)
					// positive = door opened after user clocked in (bad/late)
					isEarly = timeDifferenceMinutes < 0; // Door opened before user clocked in
					isLate = timeDifferenceMinutes > 0; // Door opened after user clocked in
				}

				// Format times for API response
				// Door open time: use raw time (as-is) for display - don't convert
				// User clock-in time: format converted organization timezone time
				const doorOpenTimeStr = doorOpenTimeRaw ? doorOpenTimeRaw.toISOString() : null;
				const userClockInTimeStr = this.formatTimeAsLocalISO(clockInOrg);

				return {
					userId: user.uid,
					userName: user.name,
					userSurname: user.surname,
					doorOpenTime: doorOpenTimeStr,
					userClockInTime: userClockInTimeStr,
					timeDifferenceMinutes,
					isEarly,
					isLate,
				};
			});

			return comparisons;
		} catch (error) {
			this.logger.error(`Failed to get door-user comparisons for device ${device.deviceID}: ${error.message}`, error.stack);
			return [];
		}
	}

	/**
	 * Safely extract time string from organization hours
	 * Handles Date objects, strings, schedule property, and null/undefined values
	 */
	private extractTimeString(
		orgHours: any,
		timeType: 'open' | 'close',
		dayOfWeek?: number, // 0 = Sunday, 1 = Monday, etc.
		defaultTime: string = '09:00'
	): string {
		try {
			// First, try to get from schedule if day-specific times are available
			if (dayOfWeek !== undefined && orgHours?.schedule) {
				const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
				const dayName = dayNames[dayOfWeek];
				const daySchedule = orgHours.schedule[dayName];
				
				if (daySchedule && !daySchedule.closed) {
					const timeValue = timeType === 'open' ? daySchedule.start : daySchedule.end;
					if (timeValue && typeof timeValue === 'string' && /^\d{1,2}:\d{2}$/.test(timeValue)) {
						return timeValue;
					}
				}
			}

			// Try to get from default openTime/closeTime property
			const timeProperty = timeType === 'open' ? 'openTime' : 'closeTime';
			const timeValue = orgHours?.[timeProperty];

			// Handle Date objects - convert to HH:mm format
			if (timeValue instanceof Date) {
				return format(timeValue, 'HH:mm');
			}

			// Handle string values - validate format
			if (typeof timeValue === 'string') {
				// Check if it's already in HH:mm format
				if (/^\d{1,2}:\d{2}$/.test(timeValue)) {
					return timeValue;
				}
				// Try to parse as ISO date string and extract time
				try {
					const dateObj = new Date(timeValue);
					if (!isNaN(dateObj.getTime())) {
						return format(dateObj, 'HH:mm');
					}
				} catch (e) {
					// Not a valid date string, continue to default
				}
			}

			// Fallback to default time
			this.logger.warn(
				`Could not extract ${timeType} time from org hours, using default: ${defaultTime}. ` +
				`Time value type: ${typeof timeValue}, value: ${timeValue}`
			);
			return defaultTime;
		} catch (error) {
			this.logger.error(`Error extracting ${timeType} time: ${error.message}`);
			return defaultTime;
		}
	}

	/**
	 * Get today's organization hours (checking special hours, schedule, or default)
	 */
	private getTodayOrgHours(orgHours: any): { openMinutes: number | null; closeMinutes: number | null } {
		if (!orgHours) {
			return { openMinutes: null, closeMinutes: null };
		}

		const today = new Date();
		const todayKey = today.toISOString().split('T')[0]; // YYYY-MM-DD
		const dayOfWeek = today.getDay();

		// Check special hours first
		if (orgHours.specialHours) {
			const specialHour = orgHours.specialHours.find((sh: any) => sh.date === todayKey);
			if (specialHour) {
				const openTime = specialHour.openTime || '09:00';
				const closeTime = specialHour.closeTime || '17:00';
				const [openH, openM] = openTime.split(':').map(Number);
				const [closeH, closeM] = closeTime.split(':').map(Number);
				return {
					openMinutes: openH * 60 + openM,
					closeMinutes: closeH * 60 + closeM,
				};
			}
		}

		// Check day-specific schedule
		if (orgHours.schedule) {
			const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
			const dayName = dayNames[dayOfWeek];
			const daySchedule = orgHours.schedule[dayName];

			if (daySchedule && !daySchedule.closed) {
				const openTime = daySchedule.start || '09:00';
				const closeTime = daySchedule.end || '17:00';
				const [openH, openM] = openTime.split(':').map(Number);
				const [closeH, closeM] = closeTime.split(':').map(Number);
				return {
					openMinutes: openH * 60 + openM,
					closeMinutes: closeH * 60 + closeM,
				};
			}
		}

		// Fall back to default open/close times
		const openTime = this.extractTimeString(orgHours, 'open', dayOfWeek, '09:00');
		const closeTime = this.extractTimeString(orgHours, 'close', dayOfWeek, '17:00');
		const [openH, openM] = openTime.split(':').map(Number);
		const [closeH, closeM] = closeTime.split(':').map(Number);
		return {
			openMinutes: openH * 60 + openM,
			closeMinutes: closeH * 60 + closeM,
		};
	}

	/**
	 * Calculate device performance metrics
	 */
	private async calculateDevicePerformance(device: Device): Promise<{
		opensOnTime: boolean;
		closesOnTime: boolean | null;
		score: number | '-';
		note: string;
		latestOpenTime: string | null;
		latestCloseTime: string | null;
		opensEmoji: '✅' | '❌' | '-';
		closesEmoji: '✅' | '❌' | '-';
	}> {
		try {
			// Get organization hours
			const orgRef = String(device.orgID);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgHours = Array.isArray(orgHoursArr) && orgHoursArr.length > 0 ? orgHoursArr[0] : null;
			const orgTimezone = orgHours?.timezone || 'Africa/Johannesburg';

			// Get today's date range in organization timezone
			const today = new Date();
			const todayOrg = toZonedTime(today, orgTimezone);
			const todayKey = todayOrg.toISOString().split('T')[0];

			// Get today's records
			const todayRecords = device.records?.filter(r => {
				if (!r.openTime) return false;
				const recordDate = typeof r.openTime === 'string' ? new Date(r.openTime) : (r.openTime as unknown as Date);
				const recordDateOrg = toZonedTime(recordDate, orgTimezone);
				const recordDateKey = recordDateOrg.toISOString().split('T')[0];
				return recordDateKey === todayKey;
			}) || [];

			// Get latest open and close times
			const sortedRecords = todayRecords.sort((a, b) => {
				const aTime = typeof a.openTime === 'string' ? new Date(a.openTime) : (a.openTime as unknown as Date);
				const bTime = typeof b.openTime === 'string' ? new Date(b.openTime) : (b.openTime as unknown as Date);
				return bTime.getTime() - aTime.getTime();
			});

			const latestOpenRecord = sortedRecords.find(r => r.openTime);
			const latestCloseRecord = sortedRecords.find(r => r.closeTime && r.openTime);

			// Door open time: use as-is from database (already in correct format, NOT converted)
			const latestOpenTime = latestOpenRecord?.openTime
				? (typeof latestOpenRecord.openTime === 'string'
					? latestOpenRecord.openTime
					: (latestOpenRecord.openTime as unknown as Date).toISOString())
				: null;

			// Only include close time if it's from today
			let latestCloseTime: string | null = null;
			if (latestCloseRecord?.closeTime) {
				const closeDate = typeof latestCloseRecord.closeTime === 'string'
					? new Date(latestCloseRecord.closeTime)
					: (latestCloseRecord.closeTime as unknown as Date);
				const closeDateOrg = toZonedTime(closeDate, orgTimezone);
				const closeDateKey = closeDateOrg.toISOString().split('T')[0];
				if (closeDateKey === todayKey) {
					// Door close time: use as-is from database (already in correct format, NOT converted)
					latestCloseTime = typeof latestCloseRecord.closeTime === 'string'
						? latestCloseRecord.closeTime
						: (latestCloseRecord.closeTime as unknown as Date).toISOString();
				}
			}

			// If no data, return placeholder
			if (!latestOpenTime && !latestCloseTime) {
				return {
					opensOnTime: false,
					closesOnTime: null,
					score: '-',
					note: 'No data yet',
					latestOpenTime: null,
					latestCloseTime: null,
					opensEmoji: '-',
					closesEmoji: '-',
				};
			}

			// Get organization hours for today
			const { openMinutes: targetOpenMinutes, closeMinutes: targetCloseMinutes } = this.getTodayOrgHours(orgHours);

			if (targetOpenMinutes === null || targetCloseMinutes === null) {
				return {
					opensOnTime: false,
					closesOnTime: null,
					score: '-',
					note: 'No organization hours configured',
					latestOpenTime,
					latestCloseTime,
					opensEmoji: '-',
					closesEmoji: '-',
				};
			}

			// Calculate opensOnTime
			let opensOnTime = false;
			let opensEmoji: '✅' | '❌' | '-' = '-';
			if (latestOpenTime) {
				const openDate = new Date(latestOpenTime);
				const openDateOrg = toZonedTime(openDate, orgTimezone);
				const openMinutes = openDateOrg.getUTCHours() * 60 + openDateOrg.getUTCMinutes();
				opensOnTime = openMinutes <= targetOpenMinutes; // Early or on-time is OK
				opensEmoji = opensOnTime ? '✅' : '❌';
			}

			// Calculate closesOnTime
			let closesOnTime: boolean | null = null;
			let closesEmoji: '✅' | '❌' | '-' = '-';
			if (latestCloseTime) {
				const closeDate = new Date(latestCloseTime);
				const closeDateOrg = toZonedTime(closeDate, orgTimezone);
				const closeMinutes = closeDateOrg.getUTCHours() * 60 + closeDateOrg.getUTCMinutes();
				closesOnTime = closeMinutes >= targetCloseMinutes; // On-time or late is OK
				closesEmoji = closesOnTime ? '✅' : '❌';
			} else if (!opensOnTime) {
				// If opened late and hasn't closed by 8pm, mark as closes late
				const now = new Date();
				const nowOrg = toZonedTime(now, orgTimezone);
				const currentMinutes = nowOrg.getUTCHours() * 60 + nowOrg.getUTCMinutes();
				const eightPMMinutes = 20 * 60; // 8pm = 20:00
				if (currentMinutes >= eightPMMinutes) {
					closesOnTime = false;
					closesEmoji = '❌';
				}
			}

			// Calculate score
			let score: number | '-' = 1;
			if (opensOnTime && closesOnTime === true) {
				score = 5;
			} else if (opensOnTime && closesOnTime === null) {
				score = 4;
			} else if (opensOnTime && closesOnTime === false) {
				score = 3;
			} else if (!opensOnTime && closesOnTime === true) {
				score = 3;
			} else if (!opensOnTime && closesOnTime === null) {
				score = 2;
			} else if (!opensOnTime && closesOnTime === false) {
				score = 1;
			}

			// Generate note
			let note = '';
			if (score === 5) {
				note = 'Opens and closes on time';
			} else if (score === 4) {
				note = 'Opens on time';
			} else if (score === 3) {
				if (!opensOnTime && closesOnTime === true) {
					note = 'Opens late';
				} else if (opensOnTime && closesOnTime === false) {
					note = 'Closes early';
				} else {
					note = 'Average performance';
				}
			} else if (score === 2) {
				note = 'Opens late';
			} else {
				if (!opensOnTime && closesOnTime === false) {
					note = 'Opens late and closes early';
				} else if (!opensOnTime) {
					note = 'Opens late';
				} else if (closesOnTime === false) {
					note = 'Closes early';
				} else {
					note = 'Poor performance';
				}
			}

			return {
				opensOnTime,
				closesOnTime,
				score,
				note,
				latestOpenTime,
				latestCloseTime,
				opensEmoji,
				closesEmoji,
			};
		} catch (error) {
			this.logger.error(`Failed to calculate device performance: ${error.message}`);
			return {
				opensOnTime: false,
				closesOnTime: null,
				score: '-',
				note: 'Error calculating performance',
				latestOpenTime: null,
				latestCloseTime: null,
				opensEmoji: '-',
				closesEmoji: '-',
			};
		}
	}


	async findAllDevices(
		filters: DeviceFilters = {},
		page: number = 1,
		limit: number = 10,
	): Promise<PaginatedResponse<Device>> {
		const startTime = Date.now();

		try {
			// Input validation
			if (page < 1) page = 1;
			if (limit < 1 || limit > 100) limit = 10;

			const cacheKey = this.getCacheKey(`devices:${JSON.stringify({ filters, page, limit })}`);
			const cached = await this.cacheManager.get<PaginatedResponse<Device>>(cacheKey);

			if (cached) {
				this.logger.log(`Cache hit: ${cached.data?.length || 0} devices`);
				return cached;
			}

		const queryBuilder = this.deviceRepository
			.createQueryBuilder('device')
			.leftJoinAndSelect('device.records', 'records')
			.leftJoinAndSelect('device.branch', 'branch')
			.leftJoinAndSelect('device.organisation', 'organisation')
			.where('device.isDeleted = :isDeleted', { isDeleted: false })
			.orderBy('device.createdAt', 'DESC');

			// Apply filters
			if (filters.orgId) {
				queryBuilder.andWhere('device.orgID = :orgId', { orgId: filters.orgId });
			}
			if (filters.branchId) {
				queryBuilder.andWhere('device.branchID = :branchId', { branchId: filters.branchId });
			}
			if (filters.deviceType) {
				queryBuilder.andWhere('device.deviceType = :deviceType', { deviceType: filters.deviceType });
			}
			if (filters.status) {
				queryBuilder.andWhere('device.currentStatus = :status', { status: filters.status });
			}

			// Get total count
			const countQueryBuilder = this.deviceRepository
				.createQueryBuilder('device')
				.where('device.isDeleted = :isDeleted', { isDeleted: false });
			
			if (filters.orgId) countQueryBuilder.andWhere('device.orgID = :orgId', { orgId: filters.orgId });
			if (filters.branchId) countQueryBuilder.andWhere('device.branchID = :branchId', { branchId: filters.branchId });
			if (filters.deviceType) countQueryBuilder.andWhere('device.deviceType = :deviceType', { deviceType: filters.deviceType });
			if (filters.status) countQueryBuilder.andWhere('device.currentStatus = :status', { status: filters.status });
			
			const total = await countQueryBuilder.getCount();

			// Apply pagination
			const offset = (page - 1) * limit;
			queryBuilder.skip(offset).take(limit);

			// Execute main query
			const devices = await queryBuilder.getMany();

		// Limit records to latest 30 for each device and enrich with performance data
		const processedDevices = await Promise.all(devices.map(async (device) => {
			const sortedRecords = device.records
				? device.records
						.sort((a, b) => {
							const aTime = a.openTime || a.closeTime || a.createdAt;
							const bTime = b.openTime || b.closeTime || b.createdAt;
							return new Date(bTime).getTime() - new Date(aTime).getTime();
						})
						.slice(0, 30)
				: [];

			// Calculate performance metrics (uses device.records directly)
			const performance = await this.calculateDevicePerformance(device);
			
			// Create device object with all records for door-user comparisons
			// getDoorUserComparisons needs all records to find today's records
			const deviceWithAllRecords = {
				...device,
				records: device.records || [], // Use all records, not limited ones
			};
			
			// Get door-user comparisons (needs all records to find today's records)
			const doorUserComparisons = await this.getDoorUserComparisons(deviceWithAllRecords);

			// Normalize branch name using ErpDataService
			const countryCode = device.branch?.country || 'SA';
			const normalizedBranchName = await this.normalizeBranchName(device.branch, countryCode);
			const normalizedBranch = device.branch ? {
				...device.branch,
				name: normalizedBranchName || device.branch.name,
			} : device.branch;

			return {
				...device,
				branch: normalizedBranch,
				records: sortedRecords, // Return limited records for response
				opensOnTime: performance.opensOnTime,
				closesOnTime: performance.closesOnTime,
				score: performance.score,
				note: performance.note,
				latestOpenTime: performance.latestOpenTime,
				latestCloseTime: performance.latestCloseTime,
				opensEmoji: performance.opensEmoji,
				closesEmoji: performance.closesEmoji,
				doorUserComparisons,
			};
		}));

			const result: PaginatedResponse<Device> = {
				data: processedDevices,
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			this.logger.log(`Fetched ${processedDevices.length} devices (${total} total) in ${Date.now() - startTime}ms`);

			return result;
		} catch (error) {
			this.logger.error(`Failed to fetch devices: ${error.message}`);
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

			// Limit records to latest 10 for response
			const sortedRecords = device.records 
				? device.records
					.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
					.slice(0, 10)
				: [];

			// Calculate performance metrics (uses device.records directly)
			const performance = await this.calculateDevicePerformance(device);
			
			// Create device object with all records for door-user comparisons
			const deviceWithAllRecords = {
				...device,
				records: device.records || [], // Use all records, not limited ones
			};
			
			// Get door-user comparisons (needs all records to find today's records)
			const doorUserComparisons = await this.getDoorUserComparisons(deviceWithAllRecords);

			// Normalize branch name using ErpDataService
			const countryCode = device.branch?.country || 'SA';
			const normalizedBranchName = await this.normalizeBranchName(device.branch, countryCode);
			const normalizedBranch = device.branch ? {
				...device.branch,
				name: normalizedBranchName || device.branch.name,
			} : device.branch;

			const processedDevice = {
				...device,
				branch: normalizedBranch,
				records: sortedRecords, // Return limited records for response
				opensOnTime: performance.opensOnTime,
				closesOnTime: performance.closesOnTime,
				score: performance.score,
				note: performance.note,
				latestOpenTime: performance.latestOpenTime,
				latestCloseTime: performance.latestCloseTime,
				opensEmoji: performance.opensEmoji,
				closesEmoji: performance.closesEmoji,
				doorUserComparisons,
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

			// Limit records to latest 10
			const processedDevice = {
				...device,
				records: device.records 
					? device.records
						.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
						.slice(0, 10)
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
	 * Check for duplicate records within a time window (prevents duplicates within same day)
	 * @param deviceId - Device ID to check
	 * @param openTime - Open time to check (if provided)
	 * @param closeTime - Close time to check (if provided)
	 * @param today - Start of today's date
	 * @param tomorrow - Start of tomorrow's date
	 * @param queryRunner - Optional query runner for transaction context
	 * @param timeWindowMinutes - Time window in minutes to consider duplicates (default: 2 minutes)
	 * @returns Existing duplicate record if found, null otherwise
	 */
	private async checkForDuplicateRecord(
		deviceId: number,
		openTime: Date | null,
		closeTime: Date | null,
		today: Date,
		tomorrow: Date,
		queryRunner?: any,
		timeWindowMinutes: number = 2,
	): Promise<DeviceRecords | null> {
		// Use cached today's records instead of querying DB
		const todayRecords = await this.getTodayRecords(deviceId, today, tomorrow, queryRunner);

		if (todayRecords.length === 0) {
			return null;
		}

		// Check each record for duplicates based on time proximity
		for (const record of todayRecords) {
			const recordOpenTime = record.openTime
				? typeof record.openTime === 'string'
					? new Date(record.openTime)
					: (record.openTime as unknown as Date)
				: null;
			const recordCloseTime = record.closeTime
				? typeof record.closeTime === 'string'
					? new Date(record.closeTime)
					: (record.closeTime as unknown as Date)
				: null;

			// Check open time duplicates
			if (openTime && recordOpenTime) {
				const timeDiffMs = Math.abs(openTime.getTime() - recordOpenTime.getTime());
				const timeDiffMinutes = timeDiffMs / (1000 * 60);
				
				if (timeDiffMinutes <= timeWindowMinutes) {
					this.logger.warn(
						`⚠️ Duplicate open time detected: Existing record ID ${record.id} has openTime ${recordOpenTime.toISOString()} ` +
						`within ${timeDiffMinutes.toFixed(2)} minutes of new openTime ${openTime.toISOString()} for device ${deviceId}`,
					);
					return record;
				}
			}

			// Check close time duplicates
			if (closeTime && recordCloseTime) {
				const timeDiffMs = Math.abs(closeTime.getTime() - recordCloseTime.getTime());
				const timeDiffMinutes = timeDiffMs / (1000 * 60);
				
				if (timeDiffMinutes <= timeWindowMinutes) {
					this.logger.warn(
						`⚠️ Duplicate close time detected: Existing record ID ${record.id} has closeTime ${recordCloseTime.toISOString()} ` +
						`within ${timeDiffMinutes.toFixed(2)} minutes of new closeTime ${closeTime.toISOString()} for device ${deviceId}`,
					);
					return record;
				}
			}

			// Check if both open and close times match (complete duplicate)
			if (openTime && closeTime && recordOpenTime && recordCloseTime) {
				const openDiffMs = Math.abs(openTime.getTime() - recordOpenTime.getTime());
				const closeDiffMs = Math.abs(closeTime.getTime() - recordCloseTime.getTime());
				const openDiffMinutes = openDiffMs / (1000 * 60);
				const closeDiffMinutes = closeDiffMs / (1000 * 60);
				
				if (openDiffMinutes <= timeWindowMinutes && closeDiffMinutes <= timeWindowMinutes) {
					this.logger.warn(
						`⚠️ Complete duplicate record detected: Existing record ID ${record.id} matches both open and close times ` +
						`within ${timeWindowMinutes} minutes for device ${deviceId}`,
					);
					return record;
				}
			}
		}

		return null;
	}

	/**
	 * Device Records Management - The core logic for open/close time tracking
	 */
	async createOrUpdateRecord(
		recordDto: CreateDeviceRecordDto,
	): Promise<{ message: string; record?: Partial<DeviceRecords> }> {
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			this.logger.log(`Creating/updating record for device ID: ${recordDto.deviceId}`);

			const device = await queryRunner.manager.findOne(Device, {
				where: { id: recordDto.deviceId, isDeleted: false },
			});

			if (!device) {
				await queryRunner.rollbackTransaction();
				throw new NotFoundException('Device not found');
			}

			// Determine organization timezone
			const orgRef = String(device.orgID);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgTimezone =
				(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || 'Africa/Johannesburg';

			// Convert incoming epoch seconds to organization-local Date values
			const openDateOrg =
				typeof recordDto.openTime === 'number' && recordDto.openTime > 0
					? toZonedTime(new Date(recordDto.openTime * 1000), orgTimezone)
					: null;
			const closeDateOrg =
				typeof recordDto.closeTime === 'number' && recordDto.closeTime > 0
					? toZonedTime(new Date(recordDto.closeTime * 1000), orgTimezone)
					: null;

			// Find latest record for today (if any)
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			// Check for duplicate records before proceeding
			const duplicateRecord = await this.checkForDuplicateRecord(
				device.id,
				openDateOrg,
				closeDateOrg,
				today,
				tomorrow,
				queryRunner,
				2, // 2 minute window for duplicates
			);

			if (duplicateRecord) {
				await queryRunner.rollbackTransaction();
				this.logger.log(
					`⏭️ Skipping duplicate record creation: Record ID ${duplicateRecord.id} already exists with similar timestamps for device ${recordDto.deviceId}`,
				);
				return {
					message: `Duplicate record detected: A similar record (ID: ${duplicateRecord.id}) already exists for today`,
					record: {
						id: duplicateRecord.id,
						openTime: duplicateRecord.openTime,
						closeTime: duplicateRecord.closeTime,
						createdAt: duplicateRecord.createdAt,
					},
				};
			}

			// Use cache to get latest record
			let existingRecord = await this.getLatestRecord(device.id, today, tomorrow, queryRunner);

			let record: DeviceRecords;

			if (existingRecord) {
				const hasOpen = !!existingRecord.openTime;
				const hasClose = !!existingRecord.closeTime;

				if (hasOpen && hasClose) {
					// Latest record complete → create a new record
					// But first check if the new record has both open and close times that are too close
					if (openDateOrg && closeDateOrg) {
						const timeDifferenceMs = closeDateOrg.getTime() - openDateOrg.getTime();
						const timeDifferenceMinutes = timeDifferenceMs / (1000 * 60);
						
						if (timeDifferenceMinutes < 5) {
							this.logger.warn(
								`⚠️ Discarding new record: Open and close times too close (${timeDifferenceMinutes.toFixed(2)} minutes) - ` +
								`Device ID: ${recordDto.deviceId}. Open: ${openDateOrg.toISOString()}, Close: ${closeDateOrg.toISOString()}`,
							);
							return {
								message: `Record discarded: open and close times are too close (${timeDifferenceMinutes.toFixed(2)} minutes apart)`,
								record: undefined,
							};
						}
					}
					
					record = queryRunner.manager.create(DeviceRecords, {
						openTime: openDateOrg,
						closeTime: closeDateOrg,
						deviceId: device.id,
					});
					record = await queryRunner.manager.save(record);
					this.logger.log(`Created new record (latest complete) for device ID: ${recordDto.deviceId}`);
				} else {
					// Update only missing parts on the latest record
					if (!hasOpen && openDateOrg) {
						existingRecord.openTime = openDateOrg;
					}
					if (!hasClose && closeDateOrg) {
						// Check if setting close time would make the record invalid (too close times)
						if (existingRecord.openTime && closeDateOrg) {
							const openTime = typeof existingRecord.openTime === 'string'
								? new Date(existingRecord.openTime)
								: (existingRecord.openTime as unknown as Date);
							const timeDifferenceMs = closeDateOrg.getTime() - openTime.getTime();
							const timeDifferenceMinutes = timeDifferenceMs / (1000 * 60);
							
							// If open and close are within 5 minutes, delete the record instead of updating
							if (timeDifferenceMinutes < 5) {
								this.logger.warn(
									`⚠️ Discarding record: Open and close times too close (${timeDifferenceMinutes.toFixed(2)} minutes) - ` +
									`Device ID: ${recordDto.deviceId}, Record ID: ${existingRecord.id}. ` +
									`Open: ${openTime.toISOString()}, Close: ${closeDateOrg.toISOString()}`,
								);
								
								// Delete the record entirely
								await queryRunner.manager.remove(existingRecord);
								
								// Invalidate caches after deletion
								const dateKey = today.toISOString().split('T')[0];
								await this.invalidateRecordCaches(device.id, dateKey);
								
								this.logger.log(
									`🗑️ Deleted record (ID: ${existingRecord.id}) due to open/close within 5 minutes - Device ID: ${recordDto.deviceId}`,
								);
								
								await queryRunner.rollbackTransaction();
								return {
									message: `Record discarded: open and close times are too close (${timeDifferenceMinutes.toFixed(2)} minutes apart)`,
									record: undefined,
								};
							}
						}
						// Only set close if we have an open or explicitly provided
						existingRecord.closeTime = closeDateOrg;
					}
					existingRecord.updatedAt = new Date();
					record = await queryRunner.manager.save(existingRecord);
					
					// Invalidate caches after update
					const dateKey = today.toISOString().split('T')[0];
					await this.invalidateRecordCaches(device.id, dateKey);
					
					this.logger.log(`Updated incomplete record for device ID: ${recordDto.deviceId}`);
				}
			} else {
				// No record today → create new
				// Check if both open and close times are provided and too close
				if (openDateOrg && closeDateOrg) {
					const timeDifferenceMs = closeDateOrg.getTime() - openDateOrg.getTime();
					const timeDifferenceMinutes = timeDifferenceMs / (1000 * 60);
					
					if (timeDifferenceMinutes < 5) {
						this.logger.warn(
							`⚠️ Discarding new record: Open and close times too close (${timeDifferenceMinutes.toFixed(2)} minutes) - ` +
							`Device ID: ${recordDto.deviceId}. Open: ${openDateOrg.toISOString()}, Close: ${closeDateOrg.toISOString()}`,
						);
						await queryRunner.rollbackTransaction();
						return {
							message: `Record discarded: open and close times are too close (${timeDifferenceMinutes.toFixed(2)} minutes apart)`,
							record: undefined,
						};
					}
				}
				
				record = queryRunner.manager.create(DeviceRecords, {
					openTime: openDateOrg,
					closeTime: closeDateOrg,
					deviceId: device.id,
				});
				record = await queryRunner.manager.save(record);
				
				// Invalidate caches after creation
				const dateKey = today.toISOString().split('T')[0];
				await this.invalidateRecordCaches(device.id, dateKey);
				
				this.logger.log(`Created new record (first of day) for device ID: ${recordDto.deviceId}`);
			}

			// Commit transaction before updating analytics and cache
			await queryRunner.commitTransaction();

			// Update device analytics only if record was successfully created/updated
			if (record) {
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
			} else {
				// Record was discarded - return success message without record
				return {
					message: 'Record discarded: open and close times are too close',
					record: undefined,
				};
			}
		} catch (error) {
			await queryRunner.rollbackTransaction();
			this.logger.error(`Failed to create/update record: ${error.message}`, error.stack);
			if (error instanceof NotFoundException) {
				throw error;
			}
			throw new BadRequestException('Failed to create/update record');
		} finally {
			await queryRunner.release();
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
		networkInfo?: {
			ipAddress?: string;
			port?: number;
			headers?: Record<string, string>;
			userAgent?: string;
			referer?: string;
		},
	): Promise<{ message: string; record?: Partial<DeviceRecords>; eventProcessing?: any }> {
		const startTime = Date.now();
		let device: Device | null = null;
		let queryRunner: any = null;

		this.logger.log(`Processing ${timeEventDto.eventType} event for device: ${timeEventDto.deviceID}`);

		// Comprehensive validation first
		try {
			await this.validateTimeEvent(timeEventDto);
		} catch (validationError) {
			const queryTimeMs = Date.now() - startTime;
			this.logger.warn(`Time event validation failed: ${validationError.message}`);
			
			// Don't save log when device is null to avoid foreign key constraint violation
			// Re-throw the exception so NestJS can return proper HTTP status code (400)
			throw validationError;
		}

		// Start transaction for atomic operations
		queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			// 1. Device validation and retrieval (with auto-registration)
			device = await this.getAndValidateDevice(timeEventDto.deviceID, queryRunner, {
				timeEventDto,
				networkInfo,
			});

			// 2. Business hours validation and analysis
			const businessHoursAnalysis = await this.validateBusinessHours(timeEventDto, device);

			// 3. Smart daily record management
			const recordResult = await this.smartRecordManagement(timeEventDto, device, queryRunner);

			// Calculate query time
			const queryTimeMs = Date.now() - startTime;

			// If record was deleted or debounced, skip analytics and notifications
			if (
				(recordResult.action === 'deleted' && recordResult.reason === 'open_close_too_close') ||
				(recordResult.action === 'debounced' && recordResult.reason === 'duplicate_within_5min')
			) {
				// Still save log even if record was debounced/deleted
				await this.saveDeviceLog(device, timeEventDto, queryTimeMs, networkInfo, {
					success: true,
					errorType: recordResult.action === 'deleted' ? 'RECORD_DELETED' : 'RECORD_DEBOUNCED',
					errorMessage: recordResult.reason,
				});
				await this.invalidateDeviceCache(device);
			} else {
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

				// Save device log for successful operation
				await this.saveDeviceLog(device, timeEventDto, queryTimeMs, networkInfo, {
					success: true,
				});
			}

			// 6. Commit transaction
			await queryRunner.commitTransaction();

			// 7. Post-processing activities (skip if record was deleted)
			if (recordResult.action !== 'deleted' || recordResult.reason !== 'open_close_too_close') {
				await this.performPostEventActivities(device, timeEventDto, recordResult, startTime);
			}

			const processingTime = Date.now() - startTime;

			// Create comprehensive success message
			if (recordResult.action === 'deleted' && recordResult.reason === 'open_close_too_close') {
				return {
					message: 'Time event processed successfully - record discarded due to open/close times being too close',
				};
			}

			this.logger.log(`Time event processed successfully in ${processingTime}ms for device: ${timeEventDto.deviceID}`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Time event processed successfully',
			};
		} catch (error) {
			await queryRunner.rollbackTransaction();
			const queryTimeMs = Date.now() - startTime;

			// Handle NotFoundException for device not found
			if (error instanceof NotFoundException) {
				this.logger.warn(`Device not found: ${error.message}`);
				
				// Try to get device info for logging (might fail, but we'll handle it)
				try {
					const deviceForLog = await this.deviceRepository.findOne({
						where: { deviceID: timeEventDto.deviceID, isDeleted: false },
						select: ['id', 'deviceID', 'orgID', 'branchID', 'devicePort'],
					});
					device = deviceForLog;
				} catch (lookupError) {
					// Device doesn't exist, use null
					device = null;
				}
				
				// Save log for device not found error (only if device exists)
				if (device) {
					await this.saveDeviceLog(
						device,
						timeEventDto,
						queryTimeMs,
						networkInfo,
						{
							success: false,
							errorType: 'DEVICE_NOT_FOUND',
							errorMessage: error.message,
							errorDetails: error instanceof NotFoundException ? error.getResponse() : undefined,
						}
					);
				}
				
				// Re-throw the exception so NestJS can return proper HTTP status code (404)
				throw error;
			}

			// Handle BadRequestException for validation errors
			if (error instanceof BadRequestException) {
				this.logger.warn(`Bad request: ${error.message}`);
				
				// Save log for bad request error (only if device exists)
				if (device) {
					await this.saveDeviceLog(
						device,
						timeEventDto,
						queryTimeMs,
						networkInfo,
						{
							success: false,
							errorType: 'BAD_REQUEST',
							errorMessage: error.message,
							errorDetails: error.getResponse(),
						}
					);
				}
				
				// Re-throw the exception so NestJS can return proper HTTP status code (400)
				throw error;
			}

			// Handle ConflictException for business rule violations
			if (error instanceof ConflictException) {
				this.logger.warn(`Conflict detected: ${error.message}`);
				
				// Save log for conflict error (only if device exists)
				if (device) {
					await this.saveDeviceLog(
						device,
						timeEventDto,
						queryTimeMs,
						networkInfo,
						{
							success: false,
							errorType: 'CONFLICT',
							errorMessage: error.message,
							errorDetails: error.getResponse(),
						}
					);
				}
				
				// Re-throw the exception so NestJS can return proper HTTP status code (409)
				throw error;
			}

			// Log unexpected errors
			this.logger.error(`Failed to process time event: ${error.message}`);
			
			// Save log for unexpected error (only if device exists)
			if (device) {
				await this.saveDeviceLog(
					device,
					timeEventDto,
					queryTimeMs,
					networkInfo,
					{
						success: false,
						errorType: 'UNEXPECTED_ERROR',
						errorMessage: error.message,
						errorDetails: {
							name: error.name,
							stack: error.stack,
						},
					}
				);
			}

			// Re-throw unexpected errors so NestJS can return proper HTTP status code (500)
			throw error;
		} finally {
			if (queryRunner) {
				await queryRunner.release();
			}
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
			const timezone = organizationHours.timezone || 'Africa/Johannesburg';
			const eventDate = toZonedTime(eventDateUTC, timezone);
			const eventTimeString = eventDate.toLocaleTimeString('en-ZA', {
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
			});
			const dayOfWeek = eventDate.toLocaleDateString('en-ZA', {
				weekday: 'long',
			}) as keyof typeof organizationHours.weeklySchedule;

			// Helper function to convert time value to HH:mm string
			const normalizeTimeString = (timeValue: any, defaultTime: string = '07:00'): string => {
				if (!timeValue) return defaultTime;
				
				// Handle Date objects - convert to HH:mm format
				if (timeValue instanceof Date) {
					return format(timeValue, 'HH:mm');
				}
				
				// Handle string values
				if (typeof timeValue === 'string') {
					// Check if it's already in HH:mm format
					if (/^\d{1,2}:\d{2}$/.test(timeValue)) {
						return timeValue;
					}
					// Try to parse as ISO date string and extract time
					try {
						const dateObj = new Date(timeValue);
						if (!isNaN(dateObj.getTime())) {
							return format(dateObj, 'HH:mm');
						}
					} catch (e) {
						// Not a valid date string, continue to default
					}
				}
				
				return defaultTime;
			};

			// Determine business hours for the event day
			let dayOpenTime = normalizeTimeString(organizationHours.openTime, '07:00');
			let dayCloseTime = normalizeTimeString(organizationHours.closeTime, '16:30');
			let isWorkingDay = true;

			// Check if organization has detailed schedule
			if (organizationHours.schedule && organizationHours.schedule[dayOfWeek]) {
				const daySchedule = organizationHours.schedule[dayOfWeek];
				if (daySchedule.closed) {
					isWorkingDay = false;
				} else {
					dayOpenTime = normalizeTimeString(daySchedule.start, dayOpenTime);
					dayCloseTime = normalizeTimeString(daySchedule.end, dayCloseTime);
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
					dayOpenTime = normalizeTimeString(specialHours.openTime, dayOpenTime);
					dayCloseTime = normalizeTimeString(specialHours.closeTime, dayCloseTime);
				}
			}

			// Calculate attendance status
			let attendanceStatus = 'ON_TIME';
			let minutesFromSchedule = 0;
			let isWithinBusinessHours = true;

			if (isWorkingDay && timeEventDto.eventType === 'open') {
				// Parse times for comparison in org timezone
				// Parse time strings (HH:mm) and combine with eventDate in org timezone
				const parseTimeInOrg = (timeString: string, baseDate: Date, tz: string): Date => {
					// Ensure timeString is a valid HH:mm string
					if (!timeString || typeof timeString !== 'string' || !/^\d{1,2}:\d{2}$/.test(timeString)) {
						this.logger.warn(`⚠️ Invalid timeString provided to parseTimeInOrg: ${timeString}, using default 07:00`);
						timeString = '07:00';
					}

					const [hours, minutes] = timeString.split(':').map(Number);
					const zonedBase = toZonedTime(baseDate, tz);
					zonedBase.setHours(hours, minutes, 0, 0);
					return zonedBase;
				};
				const getMinutesSinceMidnight = (date: Date): number => {
					return date.getHours() * 60 + date.getMinutes();
				};
				const openDate = parseTimeInOrg(dayOpenTime, eventDate, timezone);
				const closeDate = parseTimeInOrg(dayCloseTime, eventDate, timezone);
				const openTimeMinutes = getMinutesSinceMidnight(openDate);
				const closeTimeMinutes = getMinutesSinceMidnight(closeDate);
				const eventTimeMinutes = getMinutesSinceMidnight(eventDate);

				minutesFromSchedule = eventTimeMinutes - openTimeMinutes;

				// 5-minute tolerance
				const TOLERANCE_MINUTES = 5;
				if (minutesFromSchedule > TOLERANCE_MINUTES) {
					// More than 5 minutes late
					attendanceStatus = 'LATE';
				} else if (minutesFromSchedule < -TOLERANCE_MINUTES) {
					// More than 5 minutes early
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
	 * Auto-register a new device when it sends its first time event
	 * Devices are assigned to org 2, branch 2 by default
	 */
	private async autoRegisterDevice(
		timeEventDto: DeviceTimeRecordDto,
		networkInfo: { ipAddress?: string; userAgent?: string } | undefined,
		queryRunner: any,
	): Promise<Device> {
		this.logger.log(`🆕 [autoRegisterDevice] Auto-registering device: ${timeEventDto.deviceID}`);

		// Default org and branch for auto-registered devices
		const DEFAULT_ORG_ID = 2;
		const DEFAULT_BRANCH_ID = 2;

		// Verify branch exists
		const branch = await queryRunner.manager.findOne(Branch, {
			where: { uid: DEFAULT_BRANCH_ID, isDeleted: false },
		});

		if (!branch) {
			throw new BadRequestException({
				message: `Cannot auto-register: Default branch ${DEFAULT_BRANCH_ID} not found`,
				deviceID: timeEventDto.deviceID,
			});
		}

		// Build device data from request
		const deviceData = {
			deviceID: timeEventDto.deviceID,
			deviceType: DeviceType.DOOR_SENSOR,
			currentStatus: DeviceStatus.ONLINE,
			deviceIP: timeEventDto.ipAddress || networkInfo?.ipAddress || '0.0.0.0',
			devicePort: 8080,
			devicLocation: timeEventDto.location || 'Auto-registered',
			deviceTag: timeEventDto.deviceID,
			orgID: DEFAULT_ORG_ID,
			branchID: DEFAULT_BRANCH_ID,
			branchUid: DEFAULT_BRANCH_ID,
			analytics: this.initializeDeviceAnalytics(),
			createdAt: new Date(),
			updatedAt: new Date(),
			isDeleted: false,
		};

		const device = queryRunner.manager.create(Device, deviceData);
		const savedDevice = await queryRunner.manager.save(device);

		// Cache the new device
		await this.cacheManager.set(
			this.getCacheKey(`device:deviceId:${timeEventDto.deviceID}`),
			savedDevice,
			this.CACHE_TTL,
		);

		this.logger.log(
			`✅ [autoRegisterDevice] Device registered: ID=${savedDevice.id}, deviceID=${timeEventDto.deviceID}`,
		);

		this.eventEmitter.emit('device.auto_registered', {
			deviceId: savedDevice.id,
			deviceID: savedDevice.deviceID,
			orgId: DEFAULT_ORG_ID,
			branchId: DEFAULT_BRANCH_ID,
			timestamp: new Date(),
		});

		return savedDevice;
	}

	/**
	 * Get and validate device - auto-registers if device doesn't exist
	 */
	private async getAndValidateDevice(
		deviceID: string,
		queryRunner: any,
		autoRegContext?: { timeEventDto: DeviceTimeRecordDto; networkInfo?: { ipAddress?: string; userAgent?: string } },
	): Promise<Device> {
		const cacheKey = this.getCacheKey(`device:deviceId:${deviceID}`);
		let device = await this.cacheManager.get<Device>(cacheKey);

		if (!device) {
			device = await queryRunner.manager.findOne(Device, {
				where: { deviceID, isDeleted: false },
				relations: ['records'],
			});

			if (device) {
				await this.cacheManager.set(cacheKey, device, this.CACHE_TTL);
			}
		}

		// Device not found - auto-register if context provided
		if (!device) {
			if (autoRegContext?.timeEventDto) {
				device = await this.autoRegisterDevice(
					autoRegContext.timeEventDto,
					autoRegContext.networkInfo,
					queryRunner,
				);
			} else {
				throw new NotFoundException({
					message: `Device with ID '${deviceID}' not found`,
					deviceID,
				});
			}
		}

		// Update status if offline
		if (device.currentStatus === DeviceStatus.OFFLINE) {
			this.logger.log(`📡 Device ${deviceID} coming online`);
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
			(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || 'Africa/Johannesburg';

		// Convert incoming epoch seconds to organization-local Date
		const eventDateOrg = toZonedTime(new Date(timeEventDto.timestamp * 1000), orgTimezone);
		const today = new Date(eventDateOrg);
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		// DEBOUNCING: Check for recent events of the same type within 5 minutes
		const DEBOUNCE_MINUTES = 5;
		const debounceThreshold = new Date(eventDateOrg.getTime() - DEBOUNCE_MINUTES * 60 * 1000);
		
		// Check for recent events of the same type using cache
		const recentSameTypeEvent = await this.getRecentEvent(
			device.id,
			timeEventDto.eventType,
			debounceThreshold,
			queryRunner,
		);

		if (recentSameTypeEvent) {
			const recentTime = timeEventDto.eventType === 'open'
				? (typeof recentSameTypeEvent.openTime === 'string'
					? new Date(recentSameTypeEvent.openTime)
					: (recentSameTypeEvent.openTime as unknown as Date))
				: (typeof recentSameTypeEvent.closeTime === 'string'
					? new Date(recentSameTypeEvent.closeTime)
					: (recentSameTypeEvent.closeTime as unknown as Date));
			
			const timeDifferenceMs = eventDateOrg.getTime() - recentTime.getTime();
			const timeDifferenceMinutes = Math.abs(timeDifferenceMs / (1000 * 60));
			
			if (timeDifferenceMinutes < DEBOUNCE_MINUTES) {
				this.logger.log(
					`⏭️ Debouncing ${timeEventDto.eventType} event: Ignoring duplicate event within ${timeDifferenceMinutes.toFixed(2)} minutes - ` +
					`Device: ${device.deviceID}, Last event: ${recentTime.toISOString()}, Current: ${eventDateOrg.toISOString()}`,
				);
				
				return { record: null, action: 'debounced', existingRecord: true, reason: 'duplicate_within_5min' };
			}
		}

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
				// Check if open and close times are too close (less than 5 minutes apart)
				const openTime = typeof openRecordWithoutClose.openTime === 'string'
					? new Date(openRecordWithoutClose.openTime)
					: (openRecordWithoutClose.openTime as unknown as Date);
				const closeTime = eventDateOrg;
				
				const timeDifferenceMs = closeTime.getTime() - openTime.getTime();
				const timeDifferenceMinutes = timeDifferenceMs / (1000 * 60);
				
				// If open and close are within 5 minutes, delete the record instead of updating
				if (timeDifferenceMinutes < 5) {
					this.logger.warn(
						`⚠️ Discarding record: Open and close times too close (${timeDifferenceMinutes.toFixed(2)} minutes) - ` +
						`Device: ${device.deviceID}, Record ID: ${openRecordWithoutClose.id}. ` +
						`Open: ${openTime.toISOString()}, Close: ${closeTime.toISOString()}`,
					);
					
					// Delete the record entirely
					await queryRunner.manager.remove(openRecordWithoutClose);
					
					// Invalidate caches after deletion
					const dateKey = today.toISOString().split('T')[0];
					await this.invalidateRecordCaches(device.id, dateKey);
					
					this.logger.log(
						`🗑️ Deleted record (ID: ${openRecordWithoutClose.id}) due to open/close within 5 minutes - Device: ${device.deviceID}`,
					);
					
					return { record: null, action: 'deleted', existingRecord: true, reason: 'open_close_too_close' };
				}
				
				// Found an open record without close - update it with the close time
				openRecordWithoutClose.closeTime = eventDateOrg;
				openRecordWithoutClose.updatedAt = new Date();
				const record = await queryRunner.manager.save(openRecordWithoutClose);
				
				// Invalidate caches after update
				const dateKey = today.toISOString().split('T')[0];
				await this.invalidateRecordCaches(device.id, dateKey);
				
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

		// Check for duplicate records before proceeding (only for open events at this point)
		if (timeEventDto.eventType === 'open') {
			const duplicateRecord = await this.checkForDuplicateRecord(
				device.id,
				eventDateOrg,
				null, // No close time for open events
				today,
				tomorrow,
				queryRunner,
				2, // 2 minute window for duplicates
			);

			if (duplicateRecord) {
				this.logger.log(
					`⏭️ Skipping duplicate open event: Record ID ${duplicateRecord.id} already exists with similar openTime ` +
					`for device ${device.deviceID}`,
				);
				return { 
					record: duplicateRecord, 
					action: 'skipped', 
					existingRecord: true,
					reason: 'duplicate_open_time',
				};
			}
		}

		// Find the latest record for today (if any) using cache
		let existingRecord = await this.getLatestRecord(device.id, today, tomorrow, queryRunner);

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
				
				// Invalidate caches after creation
				const dateKey = today.toISOString().split('T')[0];
				await this.invalidateRecordCaches(device.id, dateKey);
				
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
						// But first check if this would be a duplicate
						const existingOpenTime = typeof existingRecord.openTime === 'string'
							? new Date(existingRecord.openTime)
							: (existingRecord.openTime as unknown as Date);
						const timeDiffMs = Math.abs(eventDateOrg.getTime() - existingOpenTime.getTime());
						const timeDiffMinutes = timeDiffMs / (1000 * 60);
						
						if (timeDiffMinutes <= 2) {
							this.logger.log(
								`⏭️ Skipping duplicate open event: Existing record ID ${existingRecord.id} has openTime ` +
								`within ${timeDiffMinutes.toFixed(2)} minutes for device ${device.deviceID}`,
							);
							return { 
								record: existingRecord, 
								action: 'skipped', 
								existingRecord: true,
								reason: 'duplicate_open_time',
							};
						}
						
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
						
						// Invalidate caches after creation
						const dateKey = today.toISOString().split('T')[0];
						await this.invalidateRecordCaches(device.id, dateKey);
						
						this.logger.log(`📝 Created new record (conflicting open) - Device: ${device.deviceID}`);
						return { record, action, existingRecord: !!existingRecord };
					}
				}

				existingRecord.updatedAt = new Date();
				record = await queryRunner.manager.save(existingRecord);
				
				// Invalidate caches after update
				const dateKey = today.toISOString().split('T')[0];
				await this.invalidateRecordCaches(device.id, dateKey);
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
			
			// Invalidate caches after creation
			const dateKey = today.toISOString().split('T')[0];
			await this.invalidateRecordCaches(device.id, dateKey);
			
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
				(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || 'Africa/Johannesburg';
			analytics.lastOpenAt = toZonedTime(
				new Date(timeEventDto.timestamp * 1000),
				orgTimezone,
			);
		} else {
			analytics.closeCount++;
			const orgRef = String(device.orgID);
			const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
			const orgTimezone =
				(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || 'Africa/Johannesburg';
			analytics.lastCloseAt = toZonedTime(
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
			'Africa/Johannesburg';
		const eventDate = toZonedTime(new Date(timeEventDto.timestamp * 1000), orgTimezoneForStats);
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
				'Africa/Johannesburg';
			extendedAnalytics.lastBusinessHoursCheck = {
				timestamp: toZonedTime(
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
	 * Only sends notifications for first open and final close of the day (after debouncing)
	 */
	private async processRealTimeNotifications(
		device: Device,
		timeEventDto: DeviceTimeRecordDto,
		recordResult: any,
	): Promise<void> {
		// Skip notifications if record was debounced or deleted
		if (recordResult.action === 'debounced' || recordResult.action === 'deleted') {
			this.logger.log(
				`⏭️ Skipping notifications for ${recordResult.action} event - Device: ${device.deviceID}`,
			);
			return;
		}

		const orgRef = String(device.orgID);
		const orgHoursArr = await this.organisationHoursService.findAll(orgRef).catch(() => []);
		const orgTimezone =
			(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || 'Africa/Johannesburg';
		const eventDate = toZonedTime(new Date(timeEventDto.timestamp * 1000), orgTimezone);
		
		// Get start and end of today in organization timezone
		const todayStart = new Date(eventDate);
		todayStart.setHours(0, 0, 0, 0);
		const todayEnd = new Date(eventDate);
		todayEnd.setHours(23, 59, 59, 999);

		// Check if this is the first open or final close of the day
		let isFirstOpen = false;
		let isFinalClose = false;

		if (timeEventDto.eventType === 'open') {
			// Check if this is the earliest open event today
			const todayOpenRecords = await this.deviceRecordsRepository.find({
				where: {
					deviceId: device.id,
					openTime: Between(todayStart, todayEnd),
				},
				order: { openTime: 'ASC' },
			});

			if (todayOpenRecords.length > 0) {
				const earliestOpen = todayOpenRecords[0];
				const currentOpenTime = eventDate;
				const earliestOpenTime = typeof earliestOpen.openTime === 'string'
					? new Date(earliestOpen.openTime)
					: (earliestOpen.openTime as unknown as Date);
				
				// Check if current event is the earliest (within 1 minute tolerance for timing)
				const timeDiff = Math.abs(currentOpenTime.getTime() - earliestOpenTime.getTime());
				isFirstOpen = timeDiff < 60000; // Within 1 minute
			} else {
				isFirstOpen = true; // This is the first open record today
			}
		} else {
			// Check if this is the latest close event today
			const todayCloseRecords = await this.deviceRecordsRepository.find({
				where: {
					deviceId: device.id,
					closeTime: Between(todayStart, todayEnd),
				},
				order: { closeTime: 'DESC' },
			});

			if (todayCloseRecords.length > 0) {
				const latestClose = todayCloseRecords[0];
				const currentCloseTime = eventDate;
				const latestCloseTime = typeof latestClose.closeTime === 'string'
					? new Date(latestClose.closeTime)
					: (latestClose.closeTime as unknown as Date);
				
				// Check if current event is the latest (within 1 minute tolerance for timing)
				const timeDiff = Math.abs(currentCloseTime.getTime() - latestCloseTime.getTime());
				isFinalClose = timeDiff < 60000; // Within 1 minute
			} else {
				isFinalClose = true; // This is the first close record today
			}
		}

		// Only send notifications for first open or final close
		if ((timeEventDto.eventType === 'open' && !isFirstOpen) || 
			(timeEventDto.eventType === 'close' && !isFinalClose)) {
			this.logger.log(
				`⏭️ Skipping notification: Not first open/final close - Device: ${device.deviceID}, ` +
				`Event: ${timeEventDto.eventType}, IsFirstOpen: ${isFirstOpen}, IsFinalClose: ${isFinalClose}`,
			);
			return;
		}

		// Send notification to admin users for first open/final close events only
		try {
			await this.sendDeviceNotificationToAdmins(device, timeEventDto, eventDate, isFirstOpen, isFinalClose);
		} catch (error) {
			this.logger.warn(`⚠️ Failed to send admin notifications: ${error.message}`);
		}

			// eventDate is already converted using toZonedTime
		// which returns a UTC Date representing org local time, so use getUTCHours/getUTCMinutes
		const hour = eventDate.getUTCHours();

		// Late arrival notifications (only for first open)
		if (timeEventDto.eventType === 'open' && isFirstOpen && hour > 10) {
			this.eventEmitter.emit('attendance.alert', {
				type: 'LATE_ARRIVAL',
				deviceId: device.id,
				deviceID: device.deviceID,
				orgId: device.orgID,
				branchId: device.branchID,
				timestamp: eventDate,
				severity: 'warning',
				message: `Late arrival detected at ${device.devicLocation} at ${hour}:${eventDate.getUTCMinutes()}`,
			});
		}

		// Weekend work notifications (only for first open)
		const dayOfWeek = eventDate.getDay();
		if ((dayOfWeek === 0 || dayOfWeek === 6) && timeEventDto.eventType === 'open' && isFirstOpen) {
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
		isFirstOpen: boolean = true,
		isFinalClose: boolean = true,
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

			// Format time for display
			// eventDate is already converted using toZonedTime
			// which returns a UTC Date representing org local time, so use getUTCHours/getUTCMinutes
			const hours = eventDate.getUTCHours();
			const minutes = eventDate.getUTCMinutes();
			const period = hours >= 12 ? 'pm' : 'am';
			const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
			const formattedTime = `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`;

			// Calculate timing context (early/late/on-time) for first open
			let timingContext = '';
			let timingStatus: 'ON_TIME' | 'LATE' | 'EARLY' | null = null;
			if (timeEventDto.eventType === 'open' && isFirstOpen && businessHoursInfo.startTime) {
				try {
					const [targetHour, targetMinute] = businessHoursInfo.startTime.split(':').map(Number);
					const targetMinutes = targetHour * 60 + targetMinute;
					const eventMinutes = hours * 60 + minutes;
					const diffMinutes = eventMinutes - targetMinutes;

					if (diffMinutes < -5) {
						timingContext = ` (${Math.abs(diffMinutes)} mins early)`;
						timingStatus = 'EARLY';
					} else if (diffMinutes > 5) {
						timingContext = ` (${diffMinutes} mins late)`;
						timingStatus = 'LATE';
					} else {
						timingContext = ' (on time)';
						timingStatus = 'ON_TIME';
					}
				} catch (error) {
					// Ignore timing calculation errors
				}
			}

			if (timeEventDto.eventType === 'open') {
				if (isAfterHours) {
					notificationEvent = NotificationEvent.IOT_DEVICE_AFTER_HOURS_ACCESS;
					priority = NotificationPriority.HIGH;
					enhancedMessage = `🌙 ${locationName} opened at ${formattedTime}${timingContext} (After Hours)`;
				} else {
					notificationEvent = NotificationEvent.IOT_DEVICE_OPENED;
					priority = NotificationPriority.NORMAL;
					enhancedMessage = `🚪 ${locationName} opened at ${formattedTime}${timingContext}`;
				}
			} else if (timeEventDto.eventType === 'close') {
				notificationEvent = NotificationEvent.IOT_DEVICE_CLOSED;
				priority = NotificationPriority.LOW;
				enhancedMessage = `🔒 ${locationName} closed at ${formattedTime}`;
			} else {
				notificationEvent = NotificationEvent.IOT_DEVICE_OPENED; // Default fallback
				priority = NotificationPriority.NORMAL;
				enhancedMessage = `🔔 ${locationName} ${timeEventDto.eventType}ed at ${formattedTime}`;
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
					},
					{
						priority: priority,
						customData: {
							deviceId: device.id,
							deviceType: device.deviceType,
							screen: '/home/iot',
							action: 'view_device',
							notificationEvent: notificationEvent,
							isSecurityAlert: isAfterHours,
							timingStatus: timingStatus, // ON_TIME, LATE, or EARLY for door open events
						},
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
			(Array.isArray(orgHoursArr) && orgHoursArr[0]?.timezone) || 'Africa/Johannesburg';
		const eventDate = toZonedTime(new Date(timeEventDto.timestamp * 1000), orgTimezone);
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

			// Parse close time (e.g., "17:30") - safely extract time string
			const closeTimeString = this.extractTimeString(orgHours, 'close', undefined, '17:00');
			const closeTimeParts = closeTimeString.split(':');
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
		try {
			if (!id || id <= 0) {
				return { analytics: null, message: 'Invalid device ID' };
			}

			const cacheKey = this.getCacheKey(`analytics:device:${id}`);
			const cached = await this.cacheManager.get(cacheKey);

			if (cached) {
				return { analytics: cached, message: 'Analytics retrieved successfully' };
			}

			const device = await this.deviceRepository.findOne({
				where: { id, isDeleted: false },
				relations: ['records'],
			});

			if (!device) {
				return { analytics: null, message: 'Device not found' };
			}

			// Calculate additional analytics
			const totalRecords = device.records.length;
			const recentRecords = device.records.slice(0, 30);

			const analytics = {
				...device.analytics,
				totalRecords,
				recentActivity: recentRecords.map((record) => ({
					id: record.id,
					openTime: record.openTime,
					closeTime: record.closeTime,
					date: record.createdAt,
				})),
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

			await this.cacheManager.set(cacheKey, analytics, this.CACHE_TTL);

			return { analytics, message: 'Analytics retrieved successfully' };
		} catch (error) {
			this.logger.error(`Failed to get device analytics: ${error.message}`);
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
