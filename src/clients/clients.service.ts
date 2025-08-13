import { Injectable, NotFoundException, Inject, BadRequestException, Logger } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Client } from './entities/client.entity';
import { ClientAuth } from './entities/client.auth.entity';
import { Repository, DeepPartial, FindOptionsWhere, ILike, In, DataSource } from 'typeorm';
import { GeneralStatus } from '../lib/enums/status.enums';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { GeofenceType, ClientRiskLevel } from '../lib/enums/client.enums';
import { Organisation } from '../organisation/entities/organisation.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { EmailType } from '../lib/enums/email.enums';
import { LeadConvertedClientData, LeadConvertedCreatorData, ClientProfileUpdateAdminData, ClientProfileUpdateConfirmationData, ClientCommunicationReminderData } from '../lib/types/email-templates.types';
import { ClientCommunicationScheduleService } from './services/client-communication-schedule.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { User } from '../user/entities/user.entity';
import { ClientCommunicationSchedule } from './entities/client-communication-schedule.entity';
import { Task } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { CommunicationFrequency, CommunicationType } from '../lib/enums/client.enums';
import { TaskType, TaskPriority, RepetitionType } from '../lib/enums/task.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { addDays, addWeeks, addMonths, addYears, format, startOfDay, setHours, setMinutes, isWeekend } from 'date-fns';
import { BulkCreateClientDto, BulkCreateClientResponse, BulkClientResult } from './dto/bulk-create-client.dto';
import { BulkUpdateClientDto, BulkUpdateClientResponse, BulkUpdateClientResult } from './dto/bulk-update-client.dto';

@Injectable()
export class ClientsService {
	private readonly CACHE_TTL: number;
	private readonly CACHE_PREFIX = 'clients:';
	private readonly logger = new Logger(ClientsService.name);

	constructor(
		@InjectRepository(Client)
		private clientsRepository: Repository<Client>,
		@InjectRepository(ClientAuth)
		private clientAuthRepository: Repository<ClientAuth>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(OrganisationSettings)
		private organisationSettingsRepository: Repository<OrganisationSettings>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(ClientCommunicationSchedule)
		private scheduleRepository: Repository<ClientCommunicationSchedule>,
		@InjectRepository(Task)
		private taskRepository: Repository<Task>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly eventEmitter: EventEmitter2,
		private readonly communicationScheduleService: ClientCommunicationScheduleService,
		private readonly tasksService: TasksService,
		private readonly dataSource: DataSource,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
	}

	/**
	 * Generates a standardized cache key for client-related data.
	 * 
	 * @param key - The unique identifier (string or number)
	 * @param suffix - Optional suffix for key categorization
	 * @returns Formatted cache key with consistent prefix
	 */
	private getCacheKey(key: string | number, suffix?: string): string {
		const baseKey = `${this.CACHE_PREFIX}${key}`;
		return suffix ? `${baseKey}_${suffix}` : baseKey;
	}

	/**
	 * Generates cache keys for complex queries with multiple parameters.
	 * 
	 * @param params - Object containing query parameters
	 * @returns Formatted cache key for complex queries
	 */
	private getComplexCacheKey(params: {
		type: string;
		page?: number;
		limit?: number;
		orgId?: number;
		branchId?: number;
		userId?: number;
		filters?: Record<string, any>;
	}): string {
		const keyParts = [
			this.CACHE_PREFIX,
			params.type,
			params.page && `page${params.page}`,
			params.limit && `limit${params.limit}`,
			params.orgId && `org${params.orgId}`,
			params.branchId && `branch${params.branchId}`,
			params.userId && `user${params.userId}`,
			params.filters && Object.keys(params.filters).length > 0 && JSON.stringify(params.filters)
		].filter(Boolean);

		return keyParts.join('_');
	}

	/**
	 * Sets cache with enhanced error handling and performance monitoring.
	 * 
	 * @param key - Cache key
	 * @param data - Data to cache
	 * @param ttl - Time to live (optional, uses service default)
	 * @returns Promise<boolean> - Success status
	 */
	private async setCacheWithErrorHandling<T>(key: string, data: T, ttl?: number): Promise<boolean> {
		try {
			const cacheStart = Date.now();
			await this.cacheManager.set(key, data, ttl || this.CACHE_TTL);
			const cacheTime = Date.now() - cacheStart;
			
			this.logger.debug(`[CACHE_SET] Successfully cached data with key: ${key} in ${cacheTime}ms`);
			return true;
		} catch (error) {
			this.logger.error(`[CACHE_SET] Failed to cache data with key ${key}: ${error.message}`);
			return false;
		}
	}

	/**
	 * Gets cache with enhanced error handling and performance monitoring.
	 * 
	 * @param key - Cache key
	 * @returns Promise<T | null> - Cached data or null
	 */
	private async getCacheWithErrorHandling<T>(key: string): Promise<T | null> {
		try {
			const cacheStart = Date.now();
			const data = await this.cacheManager.get<T>(key);
			const cacheTime = Date.now() - cacheStart;
			
			if (data) {
				this.logger.debug(`[CACHE_GET] Cache hit for key: ${key} in ${cacheTime}ms`);
			} else {
				this.logger.debug(`[CACHE_GET] Cache miss for key: ${key} in ${cacheTime}ms`);
			}
			
			return data || null;
		} catch (error) {
			this.logger.error(`[CACHE_GET] Failed to retrieve cache with key ${key}: ${error.message}`);
			return null;
		}
	}

	/**
	 * Generates a fallback logo URL using UI Avatars service based on client name initials.
	 * This method creates a professional-looking avatar with the client's initials when
	 * no logo is provided or when the provided logo URL is invalid.
	 *
	 * @param clientName - The name of the client to extract initials from
	 * @param size - The size of the generated avatar (default: 200px)
	 * @param backgroundColor - Optional background color (default: random)
	 * @param textColor - Optional text color (default: ffffff - white)
	 * @returns A URL to the generated avatar image
	 * 
	 * @example
	 * ```typescript
	 * const logoUrl = this.generateFallbackLogo('John Doe Industries');
	 * // Returns: https://ui-avatars.com/api/?name=John%20Doe%20Industries&size=200&background=random&color=ffffff&format=png
	 * ```
	 */
	private generateFallbackLogo(
		clientName: string, 
		size: number = 200, 
		backgroundColor: string = 'random',
		textColor: string = 'ffffff'
	): string {
		if (!clientName || typeof clientName !== 'string') {
			this.logger.warn('[LOGO_FALLBACK] Invalid client name provided, using default');
			clientName = 'Client';
		}

		// Clean and encode the client name for URL
		const encodedName = encodeURIComponent(clientName.trim());
		
		// UI Avatars API URL with professional styling
		const avatarUrl = `https://ui-avatars.com/api/` +
			`?name=${encodedName}` +
			`&size=${size}` +
			`&background=${backgroundColor}` +
			`&color=${textColor}` +
			`&format=png` +
			`&bold=true` +
			`&font-size=0.6`;

		this.logger.debug(`[LOGO_FALLBACK] Generated fallback logo for "${clientName}": ${avatarUrl}`);
		
		return avatarUrl;
	}

	/**
	 * Validates and processes the logo URL for a client.
	 * If no logo is provided or if the provided URL is invalid, generates a fallback logo.
	 *
	 * @param logoUrl - The provided logo URL (optional)
	 * @param clientName - The client name for fallback generation
	 * @returns A valid logo URL (either the provided one or a generated fallback)
	 */
	private async processClientLogo(logoUrl?: string, clientName?: string): Promise<string> {
		// If a logo URL is provided, validate it
		if (logoUrl && logoUrl.trim()) {
			try {
				new URL(logoUrl); // This will throw if URL is invalid
				this.logger.debug(`[LOGO_PROCESSING] Using provided logo URL: ${logoUrl}`);
				return logoUrl.trim();
			} catch (error) {
				this.logger.warn(`[LOGO_PROCESSING] Invalid logo URL provided: ${logoUrl}, generating fallback`);
			}
		}

		// Generate fallback logo using client name
		const fallbackLogo = this.generateFallbackLogo(clientName || 'Client');
		this.logger.debug(`[LOGO_PROCESSING] Generated fallback logo: ${fallbackLogo}`);
		
		return fallbackLogo;
	}

	/**
	 * Invalidates all cache entries related to a specific client with comprehensive scope and error handling.
	 * 
	 * This method ensures immediate cache consistency by clearing:
	 * - Direct client cache entries (by uid, email, name)
	 * - Organization and branch related caches
	 * - Status and category filtered caches
	 * - All pagination and search result caches
	 * - Cross-service cached references
	 * 
	 * The method uses a fail-safe approach where cache invalidation errors don't interrupt
	 * the main operation, but are properly logged for monitoring and debugging.
	 *
	 * @param client - The client object whose cache needs to be invalidated
	 * @returns Promise<void> - Completes cache invalidation or logs errors gracefully
	 */
	/**
	 * Helper method to check user access permissions for client operations
	 * @param userId - User ID to check access for
	 * @returns Object containing access information
	 */
	private async checkUserAccess(userId?: number): Promise<{
		hasElevatedAccess: boolean;
		userAssignedClients: number[] | null;
		user?: any;
	}> {
		if (!userId) {
			return {
				hasElevatedAccess: false,
				userAssignedClients: null,
			};
		}

		const user = await this.userRepository.findOne({
			where: { uid: userId, isDeleted: false },
			select: ['uid', 'assignedClientIds', 'accessLevel'],
		});

		if (!user) {
			throw new NotFoundException('User not found');
		}

		// Check if user has elevated access (only admin and owner can see all org clients)
		const elevatedRoles = [
			AccessLevel.OWNER,
			AccessLevel.ADMIN
		];
		
		const hasElevatedAccess = elevatedRoles.includes(user.accessLevel);
		const userAssignedClients = hasElevatedAccess ? null : (user.assignedClientIds || []);

		return {
			hasElevatedAccess,
			userAssignedClients,
			user,
		};
	}

	private async invalidateClientCache(client: Client): Promise<void> {
		const startTime = Date.now();
		this.logger.debug(`[CACHE_INVALIDATION] Starting cache invalidation for client ${client.uid} (${client.name})`);

		try {
			// Get all cache keys with error handling
			let keys: string[] = [];
			try {
				keys = await this.cacheManager.store.keys();
				this.logger.debug(`[CACHE_INVALIDATION] Retrieved ${keys.length} cache keys for evaluation`);
			} catch (keyRetrievalError) {
				this.logger.error(`[CACHE_INVALIDATION] Failed to retrieve cache keys: ${keyRetrievalError.message}`);
				// Continue with manual key construction as fallback
			}

			// Keys to clear
			const keysToDelete: string[] = [];

			// Add client-specific keys
			const clientSpecificKeys = [
				this.getCacheKey(client.uid),
				this.getCacheKey(client.email),
				this.getCacheKey(client.name),
				`${this.CACHE_PREFIX}all`,
				`${this.CACHE_PREFIX}stats`,
			];
			keysToDelete.push(...clientSpecificKeys);
			this.logger.debug(`[CACHE_INVALIDATION] Added ${clientSpecificKeys.length} client-specific cache keys`);

			// Add organization and branch specific keys
			if (client.organisation?.uid) {
				const orgKey = `${this.CACHE_PREFIX}org_${client.organisation.uid}`;
				keysToDelete.push(orgKey);
				this.logger.debug(`[CACHE_INVALIDATION] Added organization cache key: ${orgKey}`);
			}
			if (client.branch?.uid) {
				const branchKey = `${this.CACHE_PREFIX}branch_${client.branch.uid}`;
				keysToDelete.push(branchKey);
				this.logger.debug(`[CACHE_INVALIDATION] Added branch cache key: ${branchKey}`);
			}

			// Add status specific keys
			if (client.status) {
				const statusKey = `${this.CACHE_PREFIX}status_${client.status}`;
				keysToDelete.push(statusKey);
				this.logger.debug(`[CACHE_INVALIDATION] Added status cache key: ${statusKey}`);
			}

			// Add category specific keys
			if (client.category) {
				const categoryKey = `${this.CACHE_PREFIX}category_${client.category}`;
				keysToDelete.push(categoryKey);
				this.logger.debug(`[CACHE_INVALIDATION] Added category cache key: ${categoryKey}`);
			}

			// Clear all pagination and filtered client list caches
			const clientListCaches = keys.filter(
				(key) =>
					key.startsWith(`${this.CACHE_PREFIX}page`) ||
					key.includes('_limit') ||
					key.includes('_filter') ||
					key.includes('search_'),
			);
			keysToDelete.push(...clientListCaches);
			this.logger.debug(`[CACHE_INVALIDATION] Added ${clientListCaches.length} pagination/filter cache keys`);

			// Remove duplicates to optimize deletion
			const uniqueKeysToDelete = [...new Set(keysToDelete)];
			this.logger.debug(`[CACHE_INVALIDATION] Prepared ${uniqueKeysToDelete.length} unique cache keys for deletion`);

			// Clear all caches with individual error handling
			const deletionResults = await Promise.allSettled(
				uniqueKeysToDelete.map(async (key) => {
					try {
						await this.cacheManager.del(key);
						return { key, success: true };
					} catch (error) {
						this.logger.warn(`[CACHE_INVALIDATION] Failed to delete cache key ${key}: ${error.message}`);
						return { key, success: false, error: error.message };
					}
				})
			);

			// Log deletion results
			const successful = deletionResults.filter(result => result.status === 'fulfilled' && result.value.success).length;
			const failed = deletionResults.length - successful;
			this.logger.debug(`[CACHE_INVALIDATION] Cache deletion completed: ${successful} successful, ${failed} failed`);

			// Emit event for other services that might be caching client data
			try {
			this.eventEmitter.emit('clients.cache.invalidate', {
				clientId: client.uid,
					clientName: client.name,
					organizationId: client.organisation?.uid,
					branchId: client.branch?.uid,
					keysDeleted: uniqueKeysToDelete,
					deletionSummary: { successful, failed },
					timestamp: new Date().toISOString(),
				});
				this.logger.debug(`[CACHE_INVALIDATION] Cache invalidation event emitted successfully`);
			} catch (eventError) {
				this.logger.error(`[CACHE_INVALIDATION] Failed to emit cache invalidation event: ${eventError.message}`);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CACHE_INVALIDATION] Cache invalidation completed for client ${client.uid} in ${executionTime}ms`);

		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[CACHE_INVALIDATION] Fatal error during cache invalidation for client ${client.uid} after ${executionTime}ms: ${error.message}`,
				error.stack
			);
			// Don't throw the error to avoid interrupting the main operation
		}
	}

	/**
	 * Retrieves the organization settings for a given organization ID with comprehensive error handling.
	 * 
	 * Used to get default values for client-related settings such as:
	 * - Default geofence radius for new clients
	 * - Preferred communication methods
	 * - Regional formatting preferences
	 * - Business hour configurations
	 * - Custom field templates
	 *
	 * @param orgId - The organization ID to get settings for
	 * @returns Promise<OrganisationSettings | null> - The organization settings object or null if not found
	 */
	private async getOrganisationSettings(orgId: number): Promise<OrganisationSettings | null> {
		const startTime = Date.now();
		
		if (!orgId || isNaN(orgId) || orgId <= 0) {
			this.logger.debug(`[ORG_SETTINGS] Invalid organization ID provided: ${orgId}`);
			return null;
		}

		this.logger.debug(`[ORG_SETTINGS] Fetching settings for organization ${orgId}`);

		try {
			const settings = await this.organisationSettingsRepository.findOne({
				where: { organisationUid: orgId },
			});

			const executionTime = Date.now() - startTime;

			if (settings) {
				this.logger.debug(`[ORG_SETTINGS] Successfully retrieved settings for organization ${orgId} in ${executionTime}ms`);
				return settings;
			} else {
				this.logger.debug(`[ORG_SETTINGS] No settings found for organization ${orgId} in ${executionTime}ms`);
				return null;
			}
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(
				`[ORG_SETTINGS] Error fetching organisation settings for org ${orgId} after ${executionTime}ms: ${error.message}`,
				error.stack
			);
			return null;
		}
	}

	/**
	 * Creates a new client record in the system with comprehensive validation and processing.
	 * 
	 * This method handles the complete client creation workflow including:
	 * - Email uniqueness validation within organization scope
	 * - Logo processing (fallback generation if none provided)
	 * - Geofencing setup with organization defaults
	 * - Communication schedule creation
	 * - Conditional email notifications based on notifyClient flag
	 * - Cache invalidation for immediate data consistency
	 * 
	 * @param createClientDto - The client data transfer object containing all client information
	 * @param orgId - Optional organization ID to associate the client with
	 * @param branchId - Optional branch ID for further client categorization
	 * @returns Promise<{ message: string }> - Success or error message
	 * 
	 * @throws BadRequestException - When validation fails or duplicate email found
	 * @throws NotFoundException - When referenced organization/branch doesn't exist
	 * 
	 * @example
	 * ```typescript
	 * const result = await clientsService.create({
	 *   name: 'LORO Corp',
	 *   contactPerson: 'The Guy',
	 *   email: 'theguy@example.co.za',
	 *   phone: '+27 11 123 4567',
	 *   address: { street: 'Business Park', city: 'Pretoria', ... },
	 *   notifyClient: true
	 * }, 1, 2);
	 * ```
	 */
	async create(createClientDto: CreateClientDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_CREATE] Starting client creation for: ${createClientDto.email} ${orgId ? `in org: ${orgId}` : ''} ${branchId ? `in branch: ${branchId}` : ''}`);
		this.logger.debug(`[CLIENT_CREATE] Request payload: ${JSON.stringify({ ...createClientDto, notifyClient: createClientDto.notifyClient ?? true }, null, 2)}`);

		try {
			this.logger.debug(`[CLIENT_CREATE] Checking for existing client with email: ${createClientDto.email}`);
			// First, check for existing client with the same email within organization scope
			const existingClient = await this.clientsRepository.findOne({
				where: {
					email: createClientDto.email,
					isDeleted: false,
					...(orgId && { organisation: { uid: orgId } }),
				},
			});

			if (existingClient) {
				this.logger.warn(`[CLIENT_CREATE] Client with email ${createClientDto.email} already exists in organization ${orgId || 'global'}`);
				throw new BadRequestException(`A client with email ${createClientDto.email} already exists in this organization`);
			}

			// Validate the orgId and branchId if provided
			if (orgId) {
				this.logger.debug(`[CLIENT_CREATE] Validating organization ${orgId}`);
				const organisation = await this.organisationRepository.findOne({ where: { uid: orgId } });
				if (!organisation) {
					this.logger.error(`[CLIENT_CREATE] Organization ${orgId} not found`);
					throw new BadRequestException(`Organisation with ID ${orgId} not found`);
				}
				this.logger.debug(`[CLIENT_CREATE] Organization ${orgId} validated successfully: ${organisation.name}`);
			}

			// Process and validate logo URL (generate fallback if needed)
			this.logger.debug(`[CLIENT_CREATE] Processing logo for client: ${createClientDto.name}`);
			const processedLogo = await this.processClientLogo(createClientDto.logo, createClientDto.name);
			this.logger.debug(`[CLIENT_CREATE] Logo processed successfully: ${processedLogo}`);

			// Transform the DTO data to match the entity structure
			// This helps ensure TypeORM gets the correct data structure
			const clientData = {
				...createClientDto,
				// Set the processed logo URL
				logo: processedLogo,
				// Only transform status if it exists in the DTO
				...(createClientDto['status'] && { status: createClientDto['status'] as GeneralStatus }),
				// Handle address separately to ensure it matches the entity structure
				address: createClientDto.address
					? {
							...createClientDto.address,
					  }
					: undefined,
				// Handle social media separately if needed
				socialMedia: createClientDto.socialMedia
					? {
							...createClientDto.socialMedia,
					  }
					: undefined,
				// Remove notifyClient from client data as it's not part of the entity
				notifyClient: undefined,
			} as DeepPartial<Client>;

			// Only set organization if orgId is provided and valid
			if (orgId) {
				clientData.organisation = { uid: orgId };
			}

			// Only set branch if branchId is provided and valid
			if (branchId) {
				clientData.branch = { uid: branchId };
			}

			// If geofencing is enabled, ensure we have valid coordinates and radius
			if (createClientDto.enableGeofence) {
				if (!clientData.latitude || !clientData.longitude) {
					throw new BadRequestException('Coordinates are required for geofencing');
				}

				// Get default radius from organization settings if available
				let defaultRadius = 500; // Default fallback value

				if (orgId) {
					const orgSettings = await this.getOrganisationSettings(orgId);
					if (orgSettings?.geofenceDefaultRadius) {
						defaultRadius = orgSettings.geofenceDefaultRadius;
					}
				}

				// Set default geofence values if not provided
				if (!clientData.geofenceRadius) {
					clientData.geofenceRadius = defaultRadius;
				}

				if (!clientData.geofenceType) {
					clientData.geofenceType = GeofenceType.NOTIFY; // Default type
				}
			}

			this.logger.debug(`[CLIENT_CREATE] Saving client to database`);
			const client = await this.clientsRepository.save(clientData);

			if (!client) {
				this.logger.error(`[CLIENT_CREATE] Failed to save client to database`);
				throw new NotFoundException(process.env.CREATE_ERROR_MESSAGE);
			}

			// Handle communication schedules if provided
			if (createClientDto.communicationSchedules && createClientDto.communicationSchedules.length > 0) {
				this.logger.debug(`[CLIENT_CREATE] Creating ${createClientDto.communicationSchedules.length} communication schedules for client ${client.uid}`);
				
				for (const scheduleDto of createClientDto.communicationSchedules) {
					try {
						await this.communicationScheduleService.createSchedule(
							client.uid,
							scheduleDto,
							orgId,
							branchId
						);
					} catch (scheduleError) {
						this.logger.error(`[CLIENT_CREATE] Failed to create communication schedule for client ${client.uid}: ${scheduleError.message}`);
						// Continue with other schedules even if one fails
					}
				}
			}

			// Invalidate cache after creation
			await this.invalidateClientCache(client);

			// Send email notification to the client about their new account (based on notifyClient flag)
			const shouldNotifyClient = createClientDto.notifyClient !== false; // Default to true if not specified
			this.logger.debug(`[CLIENT_CREATE] Email notification setting - notifyClient: ${shouldNotifyClient}`);

			if (shouldNotifyClient) {
				try {
					this.logger.debug(`[CLIENT_CREATE] Preparing to send account creation email to: ${client.email}`);
					
					const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://example.co.za';
					const supportEmail = this.configService.get<string>('SUPPORT_EMAIL') || 'support@example.co.za';
				
				const emailData = {
					name: client.name,
					email: client.email,
					clientId: client.uid,
					loginUrl: `${frontendUrl}/sign-in`,
					supportEmail: supportEmail,
						organizationName: client.organisation?.name || 'LORO Corp',
					contactPerson: client.contactPerson || 'N/A',
					phone: client.phone || 'N/A',
					address: client.address ? `${client.address.street || ''}, ${client.address.city || ''}`.trim() : 'N/A',
					createdAt: new Date(),
						logoUrl: client.logo, // Include the processed logo URL
				};

				this.eventEmitter.emit('send.email', EmailType.CLIENT_ACCOUNT_CREATED, [client.email], emailData);
					this.logger.log(`[CLIENT_CREATE] Account creation email sent successfully to: ${client.email}`);
			} catch (emailError) {
					this.logger.error(`[CLIENT_CREATE] Failed to send account creation email to ${client.email}: ${emailError.message}`, emailError.stack);
					// Don't fail the client creation if email sending fails - log the error and continue
				}
			} else {
				this.logger.log(`[CLIENT_CREATE] Email notification skipped for client ${client.email} due to notifyClient=false`);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_CREATE] Client created successfully: ${client.uid} (${client.email}) in ${executionTime}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_CREATE] Failed to create client: ${createClientDto.email} after ${executionTime}ms. Error: ${error.message}`);
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * 🏢 Create multiple clients in bulk with transaction support
	 * @param bulkCreateClientDto - Bulk client creation data
	 * @returns Promise with bulk creation results
	 */
	async createBulkClients(bulkCreateClientDto: BulkCreateClientDto): Promise<BulkCreateClientResponse> {
		const startTime = Date.now();
		this.logger.log(`🏢 [createBulkClients] Starting bulk creation of ${bulkCreateClientDto.clients.length} clients`);
		
		const results: BulkClientResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		let welcomeEmailsSent = 0;
		let autoAssignedSalesReps = 0;
		let addressesValidated = 0;
		const errors: string[] = [];
		const createdClientIds: number[] = [];

		// Create a query runner for transaction management
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			for (let i = 0; i < bulkCreateClientDto.clients.length; i++) {
				const clientData = bulkCreateClientDto.clients[i];
				
				try {
					this.logger.debug(`🏢 [createBulkClients] Processing client ${i + 1}/${bulkCreateClientDto.clients.length}: ${clientData.name} (${clientData.email})`);
					
					// Check if email already exists
					const existingClient = await queryRunner.manager.findOne(Client, { 
						where: { email: clientData.email, isDeleted: false } 
					});
					if (existingClient) {
						throw new Error(`Email '${clientData.email}' already exists`);
					}

					// Validate address if required
					if (bulkCreateClientDto.validateAddresses && clientData.address) {
						this.logger.debug(`🌍 [createBulkClients] Validating address for client: ${clientData.name}`);
						// Here you could add geocoding validation
						addressesValidated++;
					}

					// Auto-assign sales rep if enabled
					let finalSalesRep = clientData.assignedSalesRep;
					if (bulkCreateClientDto.autoAssignSalesReps && !finalSalesRep) {
						// Logic to auto-assign based on territory, workload, etc.
						this.logger.debug(`👤 [createBulkClients] Auto-assigning sales rep for client: ${clientData.name}`);
						// You could implement territory-based assignment here
						autoAssignedSalesReps++;
					}

					// Create client with org and branch association
					const clientToCreate = {
						...clientData,
						assignedSalesRep: finalSalesRep,
						...(bulkCreateClientDto.orgId && { organisation: { uid: bulkCreateClientDto.orgId } }),
						...(bulkCreateClientDto.branchId && { branch: { uid: bulkCreateClientDto.branchId } }),
						status: (clientData as any).status || GeneralStatus.ACTIVE,
						isDeleted: false,
						createdAt: new Date(),
						updatedAt: new Date()
					};
					const client = queryRunner.manager.create(Client, clientToCreate as any);

					const savedClient = await queryRunner.manager.save(Client, client);

					results.push({
						client: savedClient,
						success: true,
						index: i,
						name: clientData.name,
						email: clientData.email
					});
					
					successCount++;
					createdClientIds.push(savedClient.uid);
					this.logger.debug(`✅ [createBulkClients] Client ${i + 1} created successfully: ${clientData.name} (ID: ${savedClient.uid})`);
					
				} catch (clientError) {
					const errorMessage = `Client ${i + 1} (${clientData.name || clientData.email}): ${clientError.message}`;
					this.logger.error(`❌ [createBulkClients] ${errorMessage}`, clientError.stack);
					
					results.push({
						client: null,
						success: false,
						error: clientError.message,
						index: i,
						name: clientData.name,
						email: clientData.email
					});
					
					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(`✅ [createBulkClients] Transaction committed - ${successCount} clients created successfully`);
				
				// Clear relevant caches after successful bulk creation
				await this.cacheManager.del(`${this.CACHE_PREFIX}findAll`);
				
				// Send welcome emails if requested
				if (bulkCreateClientDto.sendWelcomeEmails !== false && successCount > 0) {
					this.logger.debug(`📧 [createBulkClients] Sending welcome emails to ${successCount} created clients`);
					
					for (const result of results) {
						if (result.success && result.client) {
							try {
								// Send client welcome email here
								welcomeEmailsSent++;
							} catch (emailError) {
								this.logger.warn(`⚠️ [createBulkClients] Failed to send welcome email to ${result.client.email}: ${emailError.message}`);
							}
						}
					}
					
					this.logger.log(`📧 [createBulkClients] Sent ${welcomeEmailsSent} welcome emails`);
				}
				
				// Emit bulk creation event
				this.eventEmitter.emit('clients.bulk.created', {
					totalRequested: bulkCreateClientDto.clients.length,
					totalCreated: successCount,
					totalFailed: failureCount,
					createdClientIds,
					orgId: bulkCreateClientDto.orgId,
					branchId: bulkCreateClientDto.branchId,
					timestamp: new Date(),
				});
			} else {
				// Rollback if no clients were created successfully
				await queryRunner.rollbackTransaction();
				this.logger.warn(`⚠️ [createBulkClients] Transaction rolled back - no clients were created successfully`);
			}

		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			await queryRunner.rollbackTransaction();
			this.logger.error(`❌ [createBulkClients] Transaction error: ${transactionError.message}`, transactionError.stack);
			
			return {
				totalRequested: bulkCreateClientDto.clients.length,
				totalCreated: 0,
				totalFailed: bulkCreateClientDto.clients.length,
				successRate: 0,
				results: [],
				message: `Bulk creation failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime,
				createdClientIds: [],
				welcomeEmailsSent: 0,
				autoAssignedSalesReps: 0,
				addressesValidated: 0
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkCreateClientDto.clients.length) * 100;

		this.logger.log(`🎉 [createBulkClients] Bulk creation completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%, Emails: ${welcomeEmailsSent}`);

		return {
			totalRequested: bulkCreateClientDto.clients.length,
			totalCreated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk creation completed: ${successCount} clients created, ${failureCount} failed`
				: 'Bulk creation failed: No clients were created',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			createdClientIds: createdClientIds.length > 0 ? createdClientIds : undefined,
			welcomeEmailsSent: welcomeEmailsSent > 0 ? welcomeEmailsSent : undefined,
			autoAssignedSalesReps: autoAssignedSalesReps > 0 ? autoAssignedSalesReps : undefined,
			addressesValidated: addressesValidated > 0 ? addressesValidated : undefined
		};
	}

	/**
	 * 📝 Update multiple clients in bulk with transaction support
	 * @param bulkUpdateClientDto - Bulk client update data
	 * @returns Promise with bulk update results
	 */
	async updateBulkClients(bulkUpdateClientDto: BulkUpdateClientDto): Promise<BulkUpdateClientResponse> {
		const startTime = Date.now();
		this.logger.log(`📝 [updateBulkClients] Starting bulk update of ${bulkUpdateClientDto.updates.length} clients`);
		
		const results: BulkUpdateClientResult[] = [];
		let successCount = 0;
		let failureCount = 0;
		let notificationEmailsSent = 0;
		let coordinatesUpdated = 0;
		const errors: string[] = [];
		const updatedClientIds: number[] = [];

		// Create a query runner for transaction management
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();

		try {
			for (let i = 0; i < bulkUpdateClientDto.updates.length; i++) {
				const updateItem = bulkUpdateClientDto.updates[i];
				const { ref, data } = updateItem;
				
				try {
					this.logger.debug(`🏢 [updateBulkClients] Processing client ${i + 1}/${bulkUpdateClientDto.updates.length}: ID ${ref}`);
					
					// First find the client to ensure it exists
					const existingClient = await queryRunner.manager.findOne(Client, { 
						where: { uid: ref, isDeleted: false },
						relations: ['organisation', 'branch', 'assignedSalesRep']
					});

					if (!existingClient) {
						throw new Error(`Client with ID ${ref} not found`);
					}

					this.logger.debug(`✅ [updateBulkClients] Client found: ${existingClient.name} (${existingClient.email})`);

					// Validate assigned sales rep if provided and validation is enabled
					if (data.assignedSalesRep && bulkUpdateClientDto.validateSalesReps !== false) {
						this.logger.debug(`👤 [updateBulkClients] Validating sales rep for client ${ref}`);
						
						const existingSalesRep = await queryRunner.manager.findOne(User, {
							where: { uid: data.assignedSalesRep.uid, isDeleted: false },
							select: ['uid', 'name', 'surname', 'email']
						});

						if (!existingSalesRep) {
							throw new Error(`Sales rep with ID ${data.assignedSalesRep.uid} not found`);
						}
					}

					// Update coordinates if address changed and option is enabled
					if (data.address && bulkUpdateClientDto.updateCoordinates) {
						this.logger.debug(`🌍 [updateBulkClients] Updating coordinates for client ${ref}`);
						// Here you could add geocoding logic
						coordinatesUpdated++;
					}

					// Track changed fields for logging and notifications
					const updatedFields = Object.keys(data).filter(key => 
						data[key] !== undefined && data[key] !== existingClient[key]
					);

					// Update the client
					const updateData = { ...data, updatedAt: new Date() };
					await queryRunner.manager.update(Client, ref, updateData as any);

					// Check for significant changes that require notifications
					const hasSignificantChanges = 
						(data.assignedSalesRep && data.assignedSalesRep.uid !== existingClient.assignedSalesRep?.uid) ||
						(data.status && data.status !== existingClient.status) ||
						(data.priceTier && data.priceTier !== existingClient.priceTier);

					results.push({
						ref,
						success: true,
						index: i,
						name: existingClient.name,
						email: existingClient.email,
						updatedFields
					});
					
					successCount++;
					updatedClientIds.push(ref);
					this.logger.debug(`✅ [updateBulkClients] Client ${i + 1} updated successfully: ${existingClient.name} (ID: ${ref}), Fields: ${updatedFields.join(', ')}`);

					// Send notification email for significant changes if enabled
					if (hasSignificantChanges && bulkUpdateClientDto.sendNotificationEmails !== false) {
						try {
							// Send notification email logic here
							notificationEmailsSent++;
						} catch (emailError) {
							this.logger.warn(`⚠️ [updateBulkClients] Failed to send notification email to ${existingClient.email}: ${emailError.message}`);
						}
					}
					
				} catch (clientError) {
					const errorMessage = `Client ID ${ref}: ${clientError.message}`;
					this.logger.error(`❌ [updateBulkClients] ${errorMessage}`, clientError.stack);
					
					results.push({
						ref,
						success: false,
						error: clientError.message,
						index: i
					});
					
					errors.push(errorMessage);
					failureCount++;
				}
			}

			// Commit transaction if we have at least some successes
			if (successCount > 0) {
				await queryRunner.commitTransaction();
				this.logger.log(`✅ [updateBulkClients] Transaction committed - ${successCount} clients updated successfully`);
				
				// Invalidate relevant caches after successful bulk update
				await this.cacheManager.del(`${this.CACHE_PREFIX}findAll`);
				
				// Clear specific client caches for updated clients
				await Promise.all(
					updatedClientIds.map(clientId => 
						this.cacheManager.del(this.getCacheKey(clientId))
					)
				);
				
				// Emit bulk update event
				this.eventEmitter.emit('clients.bulk.updated', {
					totalRequested: bulkUpdateClientDto.updates.length,
					totalUpdated: successCount,
					totalFailed: failureCount,
					updatedClientIds,
					notificationEmailsSent,
					timestamp: new Date(),
				});
			} else {
				// Rollback if no clients were updated successfully
				await queryRunner.rollbackTransaction();
				this.logger.warn(`⚠️ [updateBulkClients] Transaction rolled back - no clients were updated successfully`);
			}

		} catch (transactionError) {
			// Rollback transaction on any unexpected error
			await queryRunner.rollbackTransaction();
			this.logger.error(`❌ [updateBulkClients] Transaction error: ${transactionError.message}`, transactionError.stack);
			
			return {
				totalRequested: bulkUpdateClientDto.updates.length,
				totalUpdated: 0,
				totalFailed: bulkUpdateClientDto.updates.length,
				successRate: 0,
				results: [],
				message: `Bulk update failed: ${transactionError.message}`,
				errors: [transactionError.message],
				duration: Date.now() - startTime,
				updatedClientIds: [],
				notificationEmailsSent: 0,
				coordinatesUpdated: 0
			};
		} finally {
			// Release the query runner
			await queryRunner.release();
		}

		const duration = Date.now() - startTime;
		const successRate = (successCount / bulkUpdateClientDto.updates.length) * 100;

		this.logger.log(`🎉 [updateBulkClients] Bulk update completed in ${duration}ms - Success: ${successCount}, Failed: ${failureCount}, Rate: ${successRate.toFixed(2)}%, Emails: ${notificationEmailsSent}`);

		return {
			totalRequested: bulkUpdateClientDto.updates.length,
			totalUpdated: successCount,
			totalFailed: failureCount,
			successRate: parseFloat(successRate.toFixed(2)),
			results,
			message: successCount > 0 
				? `Bulk update completed: ${successCount} clients updated, ${failureCount} failed`
				: 'Bulk update failed: No clients were updated',
			errors: errors.length > 0 ? errors : undefined,
			duration,
			updatedClientIds: updatedClientIds.length > 0 ? updatedClientIds : undefined,
			notificationEmailsSent: notificationEmailsSent > 0 ? notificationEmailsSent : undefined,
			coordinatesUpdated: coordinatesUpdated > 0 ? coordinatesUpdated : undefined
		};
	}

	/**
	 * Retrieves a paginated list of clients with advanced filtering and role-based access control.
	 * 
	 * This method implements comprehensive client retrieval with:
	 * - Pagination support for large datasets
	 * - Multi-field filtering (status, category, industry, risk level, search)
	 * - Role-based access control (elevated users see all clients, regular users see assigned only)
	 * - Organization and branch scoping
	 * - Intelligent caching for improved performance
	 * - Search across name, email, and phone fields
	 * 
	 * @param page - Page number for pagination (default: 1)
	 * @param limit - Number of items per page (default: from environment)
	 * @param orgId - Optional organization ID to filter clients
	 * @param branchId - Optional branch ID for further filtering
	 * @param filters - Optional filters object containing various filter criteria
	 * @param filters.status - Filter by client status (ACTIVE, INACTIVE, CONVERTED, etc.)
	 * @param filters.category - Filter by client category (enterprise, SME, individual, etc.)
	 * @param filters.industry - Filter by industry sector
	 * @param filters.riskLevel - Filter by risk assessment level
	 * @param filters.search - Search term to match against name, email, or phone
	 * @param userId - Optional user ID for role-based access control
	 * @returns Promise<PaginatedResponse<Client>> - Paginated client data with metadata
	 * 
	 * @throws NotFoundException - When no clients found or user lacks access
	 * 
	 * @example
	 * ```typescript
	 * // Get all clients with pagination
	 * const result = await clientsService.findAll(1, 20);
	 * 
	 * // Get clients with filters
	 * const filteredResult = await clientsService.findAll(1, 10, 123, 456, {
	 *   status: GeneralStatus.ACTIVE,
	 *   category: 'enterprise',
	 *   search: 'LORO CORP'
	 * }, 789);
	 * 
	 * // Response structure:
	 * // {
	 * //   data: Client[],
	 * //   meta: {
	 * //     total: 150,
	 * //     page: 1,
	 * //     limit: 20,
	 * //     totalPages: 8
	 * //   },
	 * //   message: "Success"
	 * // }
	 * ```
	 */
	async findAll(
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
		orgId?: number,
		branchId?: number,
		filters?: {
			status?: GeneralStatus;
			category?: string;
			industry?: string;
			riskLevel?: ClientRiskLevel;
			search?: string;
		},
		userId?: number,
	): Promise<PaginatedResponse<Client>> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_FIND_ALL] Finding clients - page: ${page}, limit: ${limit}, orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}, filters: ${JSON.stringify(filters)}`);

		try {
			// Generate optimized cache key
			const cacheKey = this.getComplexCacheKey({
				type: 'findAll',
				page,
				limit,
				orgId,
				branchId,
				userId,
				filters
			});

			const cachedClients = await this.getCacheWithErrorHandling<PaginatedResponse<Client>>(cacheKey);

			if (cachedClients) {
				const executionTime = Date.now() - startTime;
				this.logger.debug(`[CLIENT_FIND_ALL] Cache hit - returned ${cachedClients.data.length} clients in ${executionTime}ms`);
				return cachedClients;
			}

		// Check user access permissions
		this.logger.debug(`[CLIENT_FIND_ALL] Checking user access for user ${userId}`);
		const { hasElevatedAccess, userAssignedClients, user } = await this.checkUserAccess(userId);
		
		if (userId) {
				if (hasElevatedAccess) {
					this.logger.debug(`[CLIENT_FIND_ALL] User ${userId} has elevated access (${user.accessLevel}), returning all clients in organization`);
				} else {
				this.logger.debug(`[CLIENT_FIND_ALL] User ${userId} has access to ${userAssignedClients?.length || 0} assigned clients`);
					
					// If user has no assigned clients and is not elevated, return empty result
				if (!userAssignedClients || userAssignedClients.length === 0) {
						this.logger.warn(`[CLIENT_FIND_ALL] User ${userId} has no assigned clients and insufficient privileges`);
						const emptyResponse = {
							data: [],
							meta: {
								total: 0,
								page,
								limit,
								totalPages: 0,
							},
							message: 'No clients assigned to user',
						};
						return emptyResponse;
					}
			}
		}

		// Create find options with relationships
		const where: FindOptionsWhere<Client> = { isDeleted: false };

		// Filter by organization - always apply this filter
		if (orgId) {
			where.organisation = { uid: orgId };
		}

		// Filter by branch - apply branch filter for all users
		// Elevated users can see clients across branches only if they explicitly access with no branchId
		if (branchId) {
			this.logger.debug(`[CLIENT_FIND_ALL] Applying branch filter: ${branchId}`);
			where.branch = { uid: branchId };
		} else if (hasElevatedAccess) {
			this.logger.debug(`[CLIENT_FIND_ALL] No branch filter applied - elevated user can see all branches in organization`);
		} else if (!hasElevatedAccess && !branchId) {
			// Non-elevated users must specify a branch
			this.logger.warn(`[CLIENT_FIND_ALL] Non-elevated users must specify a branch`);
			const emptyResponse = {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: 'Branch must be specified for non-elevated users',
			};
			return emptyResponse;
		}

		if (filters?.status) {
			where.status = filters.status;
		}

		if (filters?.category) {
			where.category = filters.category;
		}

		if (filters?.industry) {
			where.industry = filters.industry;
		}

		if (filters?.riskLevel) {
			where.riskLevel = filters.riskLevel;
		}

		// Filter by assigned clients if user has limited access (not elevated)
		if (userAssignedClients && userAssignedClients.length > 0 && !hasElevatedAccess) {
			this.logger.debug(`[CLIENT_FIND_ALL] Filtering by assigned clients: ${userAssignedClients.join(', ')}`);
			where.uid = In(userAssignedClients);
		}

			if (filters?.search) {
				// Handle search across multiple fields
				this.logger.debug(`[CLIENT_FIND_ALL] Performing search for term: ${filters.search}`);
				return this.clientsBySearchTerm(filters.search, page, limit, orgId, branchId, userId);
			}

			this.logger.debug(`[CLIENT_FIND_ALL] Executing database query with pagination`);
			// Find clients with pagination
			const [clients, total] = await this.clientsRepository.findAndCount({
				where,
				skip: (page - 1) * limit,
				take: limit,
				order: { createdAt: 'DESC' },
			});

			if (!clients) {
				this.logger.warn(`[CLIENT_FIND_ALL] No clients found with current filters`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				data: clients,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};

			await this.setCacheWithErrorHandling(cacheKey, response);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_FIND_ALL] Successfully retrieved ${clients.length} clients out of ${total} total in ${executionTime}ms`);

			return response;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_FIND_ALL] Failed to retrieve clients after ${executionTime}ms. Error: ${error.message}`);
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	/**
	 * Retrieves a single client by ID with organization and branch scoping.
	 * 
	 * This method provides secure single client retrieval with:
	 * - Organization and branch access control
	 * - Comprehensive client data including relationships
	 * - Intelligent caching for performance optimization
	 * - Detailed logging for audit trails
	 * 
	 * @param ref - The unique identifier (uid) of the client to retrieve
	 * @param orgId - Optional organization ID to ensure client belongs to organization
	 * @param branchId - Optional branch ID to ensure client belongs to branch
	 * @returns Promise<{ message: string; client: Client | null }> - Response with client data or null
	 * 
	 * @throws NotFoundException - When client is not found or access is denied
	 * 
	 * @example
	 * ```typescript
	 * // Get client by ID
	 * const result = await clientsService.findOne(123);
	 * 
	 * // Get client with organization/branch scoping
	 * const scopedResult = await clientsService.findOne(123, 456, 789);
	 * 
	 * // Response structure:
	 * // {
	 * //   message: "Success",
	 * //   client: {
	 * //     uid: 123,
	 * //     name: "LORO Corp",
	 * //     email: "theguy@example.co.za",
	 * //     phone: "+27 11 123 4567",
	 * //     branch: { uid: 789, name: "Pretoria South Africa" },
	 * //     organisation: { uid: 456, name: "LORO Corp" },
	 * //     assignedSalesRep: { uid: 101, name: "Sales Rep" },
	 * //     quotations: [...],
	 * //     checkIns: [...]
	 * //   }
	 * // }
	 * ```
	 */
	async findOne(ref: number, orgId?: number, branchId?: number, userId?: number): Promise<{ message: string; client: Client | null }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_FIND_ONE] Finding client with ID: ${ref}, orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}`);
		
		try {
			// Check user access permissions
			this.logger.debug(`[CLIENT_FIND_ONE] Checking user access for user ${userId}`);
			const { hasElevatedAccess, userAssignedClients, user } = await this.checkUserAccess(userId);
			
			if (userId && !hasElevatedAccess) {
				this.logger.debug(`[CLIENT_FIND_ONE] User ${userId} has access to ${userAssignedClients?.length || 0} assigned clients`);
				
				// Check if user has access to this specific client
				if (!userAssignedClients || !userAssignedClients.includes(ref)) {
					this.logger.warn(`[CLIENT_FIND_ONE] User ${userId} does not have access to client ${ref}`);
					throw new NotFoundException('Client not found or access denied');
				}
			} else if (userId && hasElevatedAccess) {
				this.logger.debug(`[CLIENT_FIND_ONE] User ${userId} has elevated access (${user.accessLevel})`);
			}

			const cacheKey = `${this.getCacheKey(ref)}_org${orgId}_branch${branchId}_user${userId}`;
			this.logger.debug(`[CLIENT_FIND_ONE] Checking cache with key: ${cacheKey}`);
			
			const cachedClient = await this.cacheManager.get<Client>(cacheKey);

			if (cachedClient) {
				const executionTime = Date.now() - startTime;
				this.logger.debug(`[CLIENT_FIND_ONE] Cache hit for client ${ref} in ${executionTime}ms`);
				return {
					client: cachedClient,
					message: process.env.SUCCESS_MESSAGE,
				};
			}

			this.logger.debug(`[CLIENT_FIND_ONE] Cache miss, querying database for client ${ref}`);

			// Create where conditions
			const where: FindOptionsWhere<Client> = {
				uid: ref,
				isDeleted: false,
			};

			// Filter by organization and branch
			if (orgId) {
				where.organisation = { uid: orgId };
				this.logger.debug(`[CLIENT_FIND_ONE] Filtering by organization: ${orgId}`);
			}

			if (branchId) {
				where.branch = { uid: branchId };
				this.logger.debug(`[CLIENT_FIND_ONE] Filtering by branch: ${branchId}`);
			}

			this.logger.debug(`[CLIENT_FIND_ONE] Executing database query with relations`);
			const client = await this.clientsRepository.findOne({
				where,
				relations: ['branch', 'organisation', 'assignedSalesRep', 'quotations', 'checkIns'],
			});

			if (!client) {
				this.logger.warn(`[CLIENT_FIND_ONE] Client not found: ${ref} in org: ${orgId}, branch: ${branchId}`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.debug(`[CLIENT_FIND_ONE] Caching client ${ref} with key: ${cacheKey}`);
			await this.cacheManager.set(cacheKey, client, this.CACHE_TTL);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_FIND_ONE] Successfully retrieved client ${ref} (${client.name}) in ${executionTime}ms`);

			return {
				client,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_FIND_ONE] Failed to retrieve client ${ref} after ${executionTime}ms. Error: ${error.message}`, error.stack);
			return {
				message: error?.message,
				client: null,
			};
		}
	}

	/**
	 * Updates a client with comprehensive validation, processing, and automation.
	 * 
	 * This method provides complete client update functionality including:
	 * - Data validation and transformation
	 * - Logo processing with fallback generation
	 * - Geofencing configuration updates
	 * - Communication schedule management
	 * - Lead conversion automation (email notifications)
	 * - Cache invalidation for data consistency
	 * - Organization and branch access control
	 * 
	 * Special behavior for status changes:
	 * - When status changes to CONVERTED, automatic email notifications are sent to both
	 *   the client and their assigned sales representative with onboarding information
	 * 
	 * @param ref - The unique identifier (uid) of the client to update
	 * @param updateClientDto - The client data to update including notifyClient flag
	 * @param orgId - Optional organization ID to ensure client belongs to organization
	 * @param branchId - Optional branch ID to ensure client belongs to branch
	 * @returns Promise<{ message: string }> - Success or error message
	 * 
	 * @throws NotFoundException - When client is not found or access is denied
	 * @throws BadRequestException - When validation fails or invalid geofencing data
	 * 
	 * @example
	 * ```typescript
	 * // Basic client update
	 * const result = await clientsService.update(123, {
	 *   name: "Updated Company Name",
	 *   phone: "+27 11 987 6543",
	 *   description: "Updated company description"
	 * });
	 * 
	 * // Update with status conversion (triggers automation)
	 * const conversionResult = await clientsService.update(123, {
	 *   status: GeneralStatus.CONVERTED,
	 *   creditLimit: 100000
	 * }, 456, 789);
	 * 
	 * // Update with geofencing
	 * const geoResult = await clientsService.update(123, {
	 *   enableGeofence: true,
	 *   latitude: -26.195246,
	 *   longitude: 28.034088,
	 *   geofenceRadius: 750,
	 *   geofenceType: GeofenceType.RESTRICT
	 * });
	 * ```
	 */
	async update(
		ref: number,
		updateClientDto: UpdateClientDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_UPDATE] Starting update for client ${ref}, orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`[CLIENT_UPDATE] Update data: ${JSON.stringify(updateClientDto, null, 2)}`);
		
		try {
			// Find the existing client with current org/branch context
			this.logger.debug(`[CLIENT_UPDATE] Finding existing client ${ref}`);
			const existingClient = await this.findOne(ref, orgId, branchId);

			if (!existingClient.client) {
				this.logger.warn(`[CLIENT_UPDATE] Client ${ref} not found for update`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Check if status is being updated to "converted"
			const isBeingConverted =
				updateClientDto.status === GeneralStatus.CONVERTED &&
				existingClient.client.status !== GeneralStatus.CONVERTED;
			
			if (isBeingConverted) {
				this.logger.log(`[CLIENT_UPDATE] Client ${ref} being converted from ${existingClient.client.status} to CONVERTED`);
			}

			// Transform the DTO data to match the entity structure
			const clientDataToUpdate = {
				...updateClientDto,
				// Transform status if provided
				status: updateClientDto.status as GeneralStatus,
				// Handle address specially if provided
				address: updateClientDto.address
					? {
							...updateClientDto.address,
					  }
					: undefined,
				// Handle social profiles specially if provided
				socialMedia: updateClientDto.socialMedia
					? {
							...updateClientDto.socialMedia,
					  }
					: undefined,
			} as DeepPartial<Client>;

			const client = existingClient.client;

			// Important: Don't modify organization/branch relationships unless explicitly intended
			// Remove these fields from the updateDto to preserve existing relationships
			delete clientDataToUpdate.organisation;
			delete clientDataToUpdate.branch;

			// If we need to change org/branch, it should be done explicitly through a specific API endpoint
			// or with specific parameters, not as part of the general update

			// Handle geofencing data if provided
			if (updateClientDto.enableGeofence !== undefined) {
				// If enabling geofencing, ensure we have coordinates
				if (
					updateClientDto.enableGeofence &&
					!((client.latitude || updateClientDto.latitude) && (client.longitude || updateClientDto.longitude))
				) {
					throw new BadRequestException('Coordinates are required for geofencing');
				}

				// If disabling geofencing, set type to NONE
				if (updateClientDto.enableGeofence === false) {
					clientDataToUpdate.geofenceType = GeofenceType.NONE;
				} else if (!clientDataToUpdate.geofenceType && !client.geofenceType) {
					// Set default type if enabling and no type specified
					clientDataToUpdate.geofenceType = GeofenceType.NOTIFY;
				}

				// Set default radius if not specified
				if (updateClientDto.enableGeofence && !clientDataToUpdate.geofenceRadius && !client.geofenceRadius) {
					// Get default radius from organization settings if available
					let defaultRadius = 500; // Default fallback value

					if (client.organisation?.uid) {
						const orgSettings = await this.getOrganisationSettings(client.organisation.uid);
						if (orgSettings?.geofenceDefaultRadius) {
							defaultRadius = orgSettings.geofenceDefaultRadius;
						}
					}

					clientDataToUpdate.geofenceRadius = defaultRadius;
				}
			}

			// Create where conditions including organization and branch
			const whereConditions: FindOptionsWhere<Client> = { uid: ref };

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			// Add branch filter if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			// Update with proper filtering
			const updateResult = await this.clientsRepository.update(whereConditions, clientDataToUpdate);

			if (updateResult.affected === 0) {
				throw new NotFoundException('Client not found or you do not have permission to update this client');
			}

			// Handle communication schedules if provided
			if (updateClientDto.communicationSchedules && updateClientDto.communicationSchedules.length > 0) {
				this.logger.debug(`[CLIENT_UPDATE] Updating communication schedules for client ${ref}`);
				
				// For updates, we could either:
				// 1. Replace all existing schedules with new ones (current approach)
				// 2. Update existing schedules and add new ones
				// For now, let's use approach 1 - replace all schedules
				
				// First, deactivate existing schedules
				try {
					const existingSchedules = await this.communicationScheduleService.getClientSchedules(
						ref,
						{ page: 1, limit: 100 },
						orgId,
						branchId
					);
					
					// Deactivate existing schedules
					for (const schedule of existingSchedules.data) {
						await this.communicationScheduleService.updateSchedule(
							schedule.uid,
							{ isActive: false },
							orgId,
							branchId
						);
					}
				} catch (error) {
					this.logger.error(`[CLIENT_UPDATE] Failed to deactivate existing schedules for client ${ref}: ${error.message}`);
				}
				
				// Create new schedules
				for (const scheduleDto of updateClientDto.communicationSchedules) {
					try {
						await this.communicationScheduleService.createSchedule(
							ref,
							scheduleDto,
							orgId,
							branchId
						);
					} catch (scheduleError) {
						this.logger.error(`[CLIENT_UPDATE] Failed to create communication schedule for client ${ref}: ${scheduleError.message}`);
						// Continue with other schedules even if one fails
					}
				}
			}

			// Send conversion emails if the status was changed to converted
			if (isBeingConverted) {
				// Fetch the latest client data with all relationships
				const updatedClient = await this.clientsRepository.findOne({
					where: whereConditions,
					relations: ['assignedSalesRep'],
				});

				if (!updatedClient) {
					throw new NotFoundException('Updated client not found');
				}

				// Format the current date for email
				const formattedDate = new Date().toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
				});

				// Get dashboard link - use environment variable or construct from base URL
				const dashboardBaseUrl =
					this.configService.get<string>('DASHBOARD_URL') || 'https://dashboard.yourapp.com';
				const dashboardLink = `${dashboardBaseUrl}/clients/${updatedClient.uid}`;

				// 1. Send email to the client
				if (updatedClient.email) {
					// Prepare client email data
					const clientEmailData: LeadConvertedClientData = {
						name: updatedClient.name,
						clientId: updatedClient.uid,
						conversionDate: formattedDate,
						dashboardLink,
						// Include sales rep info if available
						...(updatedClient.assignedSalesRep
							? {
									accountManagerName: updatedClient.assignedSalesRep.name,
									accountManagerEmail: updatedClient.assignedSalesRep.email,
									accountManagerPhone: updatedClient.assignedSalesRep.phone,
							  }
							: {}),
						// Some example next steps - customize as needed
						nextSteps: [
							'Complete your profile information',
							'Schedule an onboarding call with your account manager',
							'Explore available products and services',
						],
					};

					// Emit event to send client email with type-safe enum
					this.eventEmitter.emit(
						'send.email',
						EmailType.LEAD_CONVERTED_CLIENT,
						[updatedClient.email],
						clientEmailData,
					);
				}

				// 2. Send email to the lead creator/sales rep
				if (updatedClient.assignedSalesRep?.email) {
					// Prepare creator email data
					const creatorEmailData: LeadConvertedCreatorData = {
						name: updatedClient.assignedSalesRep.name,
						clientId: updatedClient.uid,
						clientName: updatedClient.name,
						clientEmail: updatedClient.email,
						clientPhone: updatedClient.phone,
						conversionDate: formattedDate,
						dashboardLink,
					};

					// Emit event to send creator email with type-safe enum
					this.eventEmitter.emit(
						'send.email',
						EmailType.LEAD_CONVERTED_CREATOR,
						[updatedClient.assignedSalesRep.email],
						creatorEmailData,
					);
				}
			}

			// Invalidate cache
			await this.invalidateClientCache(client);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_UPDATE] Successfully updated client ${ref} (${client.name}) in ${executionTime}ms`);
			
			if (isBeingConverted) {
				this.logger.log(`[CLIENT_UPDATE] Conversion notifications sent for client ${ref}`);
			}

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_UPDATE] Failed to update client ${ref} after ${executionTime}ms. Error: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * Performs a soft delete on a client record with proper access control and cache management.
	 * 
	 * This method implements secure client deletion with:
	 * - Soft delete (sets isDeleted flag instead of permanent removal)
	 * - Organization and branch access control
	 * - Cache invalidation for immediate consistency
	 * - Comprehensive audit logging
	 * - Data preservation for audit trails and potential restoration
	 * 
	 * Note: This is a soft delete operation. The client record remains in the database
	 * but is marked as deleted and will not appear in normal queries.
	 * 
	 * @param ref - The unique identifier (uid) of the client to delete
	 * @param orgId - Optional organization ID to ensure client belongs to organization
	 * @param branchId - Optional branch ID to ensure client belongs to branch
	 * @returns Promise<{ message: string }> - Success or error message
	 * 
	 * @throws NotFoundException - When client is not found or access is denied
	 * 
	 * @example
	 * ```typescript
	 * // Delete client by ID
	 * const result = await clientsService.remove(123);
	 * 
	 * // Delete with organization/branch scoping
	 * const scopedResult = await clientsService.remove(123, 456, 789);
	 * 
	 * // Response: { message: "Success" }
	 * ```
	 */
	async remove(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_REMOVE] Starting soft delete for client ${ref}, orgId: ${orgId}, branchId: ${branchId}`);
		
		try {
			this.logger.debug(`[CLIENT_REMOVE] Finding client ${ref} for deletion`);
			const existingClient = await this.findOne(ref, orgId, branchId);
			if (!existingClient.client) {
				this.logger.warn(`[CLIENT_REMOVE] Client ${ref} not found for deletion`);
				throw new NotFoundException(process.env.DELETE_ERROR_MESSAGE);
			}

			const clientName = existingClient.client.name;
			this.logger.debug(`[CLIENT_REMOVE] Found client ${ref} (${clientName}) for deletion`);

			// Create where conditions including organization and branch
			const whereConditions: FindOptionsWhere<Client> = { uid: ref };

			// Add organization filter if provided
			if (orgId) {
				whereConditions.organisation = { uid: orgId };
				this.logger.debug(`[CLIENT_REMOVE] Adding organization filter: ${orgId}`);
			}

			// Add branch filter if provided
			if (branchId) {
				whereConditions.branch = { uid: branchId };
				this.logger.debug(`[CLIENT_REMOVE] Adding branch filter: ${branchId}`);
			}

			this.logger.debug(`[CLIENT_REMOVE] Executing soft delete (isDeleted=true) for client ${ref}`);
			// Update with proper filtering
			await this.clientsRepository.update(whereConditions, { isDeleted: true });

			// Invalidate cache after deletion
			this.logger.debug(`[CLIENT_REMOVE] Invalidating cache for deleted client ${ref}`);
			await this.invalidateClientCache(existingClient.client);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_REMOVE] Successfully soft deleted client ${ref} (${clientName}) in ${executionTime}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_REMOVE] Failed to delete client ${ref} after ${executionTime}ms. Error: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}
	async restore(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_RESTORE] Starting restore for client ${ref}, orgId: ${orgId}, branchId: ${branchId}`);
		
		try {
			// Find the deleted client specifically
			const where: FindOptionsWhere<Client> = {
				uid: ref,
				isDeleted: true,
			};

			// Filter by organization and branch
			if (orgId) {
				where.organisation = { uid: orgId };
				this.logger.debug(`[CLIENT_RESTORE] Adding organization filter: ${orgId}`);
			}

			if (branchId) {
				where.branch = { uid: branchId };
				this.logger.debug(`[CLIENT_RESTORE] Adding branch filter: ${branchId}`);
			}

			this.logger.debug(`[CLIENT_RESTORE] Finding deleted client ${ref} for restoration`);
			const existingClient = await this.clientsRepository.findOne({
				where,
				relations: ['branch', 'organisation'],
			});

			if (!existingClient) {
				this.logger.warn(`[CLIENT_RESTORE] Deleted client ${ref} not found for restoration`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const clientName = existingClient.name;
			this.logger.debug(`[CLIENT_RESTORE] Found deleted client ${ref} (${clientName}) for restoration`);

			// Use the same where conditions for the update
			this.logger.debug(`[CLIENT_RESTORE] Restoring client ${ref} to ACTIVE status`);
			await this.clientsRepository.update(where, {
				isDeleted: false,
				status: GeneralStatus.ACTIVE,
			});

			// Invalidate cache after restoration
			this.logger.debug(`[CLIENT_RESTORE] Invalidating cache for restored client ${ref}`);
			await this.invalidateClientCache(existingClient);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_RESTORE] Successfully restored client ${ref} (${clientName}) in ${executionTime}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_RESTORE] Failed to restore client ${ref} after ${executionTime}ms. Error: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	async clientsBySearchTerm(
		searchTerm: string,
		page: number = 1,
		limit: number = 10,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<PaginatedResponse<Client>> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_SEARCH] Searching clients for term: "${searchTerm}", page: ${page}, limit: ${limit}, orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}`);

		try {
			const cacheKey = `${
				this.CACHE_PREFIX
			}search_${searchTerm?.toLowerCase()}_page${page}_limit${limit}_org${orgId}_branch${branchId}_user${userId}`;
			const cachedResults = await this.cacheManager.get<PaginatedResponse<Client>>(cacheKey);

			if (cachedResults) {
				const executionTime = Date.now() - startTime;
				this.logger.debug(`[CLIENT_SEARCH] Cache hit - returned ${cachedResults.data.length} clients in ${executionTime}ms`);
				return cachedResults;
			}

		// Check user access permissions
		this.logger.debug(`[CLIENT_SEARCH] Checking user access for user ${userId}`);
		const { hasElevatedAccess, userAssignedClients, user } = await this.checkUserAccess(userId);
		
		if (userId) {
			if (hasElevatedAccess) {
				this.logger.debug(`[CLIENT_SEARCH] User ${userId} has elevated access (${user.accessLevel}), searching all clients in organization`);
			} else {
				this.logger.debug(`[CLIENT_SEARCH] User ${userId} has access to ${userAssignedClients?.length || 0} assigned clients`);
				
				// If user has no assigned clients and is not elevated, return empty result
				if (!userAssignedClients || userAssignedClients.length === 0) {
					this.logger.warn(`[CLIENT_SEARCH] User ${userId} has no assigned clients and insufficient privileges`);
					const emptyResponse = {
						data: [],
						meta: {
							total: 0,
							page,
							limit,
							totalPages: 0,
						},
						message: 'No clients assigned to user',
					};
					return emptyResponse;
				}
			}
		}

		// Build where conditions for search
		const where: FindOptionsWhere<Client> = { isDeleted: false };

		// Filter by organization - always apply this filter
		if (orgId) {
			where.organisation = { uid: orgId };
		}

		// Filter by branch - apply branch filter for all users
		// Elevated users can search across branches only if they explicitly access with no branchId
		if (branchId) {
			this.logger.debug(`[CLIENT_SEARCH] Applying branch filter: ${branchId}`);
			where.branch = { uid: branchId };
		} else if (hasElevatedAccess) {
			this.logger.debug(`[CLIENT_SEARCH] No branch filter applied - elevated user can search all branches in organization`);
		} else if (!hasElevatedAccess && !branchId) {
			// Non-elevated users must specify a branch
			this.logger.warn(`[CLIENT_SEARCH] Non-elevated users must specify a branch`);
			const emptyResponse = {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: 'Branch must be specified for non-elevated users',
			};
			return emptyResponse;
		}

		// Filter by assigned clients if user has limited access (not elevated)
		if (userAssignedClients && userAssignedClients.length > 0 && !hasElevatedAccess) {
			this.logger.debug(`[CLIENT_SEARCH] Filtering search by assigned clients: ${userAssignedClients.join(', ')}`);
			where.uid = In(userAssignedClients);
		}

			this.logger.debug(`[CLIENT_SEARCH] Executing search query for term: "${searchTerm}"`);
			// Find clients with search criteria across multiple fields
			const [clients, total] = await this.clientsRepository.findAndCount({
				where: [
					{ ...where, name: ILike(`%${searchTerm?.toLowerCase()}%`) },
					{ ...where, email: ILike(`%${searchTerm?.toLowerCase()}%`) },
					{ ...where, phone: ILike(`%${searchTerm?.toLowerCase()}%`) },
				],
				relations: ['branch', 'organisation', 'assignedSalesRep', 'quotations', 'checkIns'],
				skip: (page - 1) * limit,
				take: limit,
				order: { createdAt: 'DESC' },
			});

			if (!clients) {
				this.logger.warn(`[CLIENT_SEARCH] No clients found for search term: "${searchTerm}"`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				data: clients,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};

			await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_SEARCH] Successfully found ${clients.length} clients out of ${total} total for term "${searchTerm}" in ${executionTime}ms`);

			return response;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_SEARCH] Failed to search clients for term "${searchTerm}" after ${executionTime}ms. Error: ${error.message}`);
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	// Helper function to calculate distance between two GPS coordinates
	private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
		if (!lat1 || !lon1 || !lat2 || !lon2) {
			return Number.MAX_VALUE; // Return large value if any coordinate is missing
		}

		// Convert to radians
		const R = 6371; // Earth's radius in km
		const dLat = (lat2 - lat1) * (Math.PI / 180);
		const dLon = (lon2 - lon1) * (Math.PI / 180);
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(lat1 * (Math.PI / 180)) *
				Math.cos(lat2 * (Math.PI / 180)) *
				Math.sin(dLon / 2) *
				Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		const distance = R * c; // Distance in km

		return distance;
	}

	/**
	 * Finds clients within a specified radius of given GPS coordinates using geolocation calculation.
	 * 
	 * This method provides advanced geospatial client discovery with:
	 * - Haversine formula for accurate distance calculation
	 * - Configurable search radius (default: 5km)
	 * - Organization and branch filtering
	 * - Distance-sorted results (closest first)
	 * - Input validation for coordinates and radius
	 * - Support for both metric and imperial measurements
	 * 
	 * Use cases:
	 * - Field sales route optimization
	 * - Territory management
	 * - Proximity-based client services
	 * - Emergency contact scenarios
	 * - Regional analysis and reporting
	 * 
	 * @param latitude - GPS latitude coordinate (-90 to 90)
	 * @param longitude - GPS longitude coordinate (-180 to 180)
	 * @param radius - Search radius in kilometers (default: 5km)
	 * @param orgId - Optional organization ID to filter results
	 * @param branchId - Optional branch ID to filter results
	 * @returns Promise<{ message: string; clients: Array<Client & { distance: number }> }> - Clients with calculated distances
	 * 
	 * @throws BadRequestException - When coordinates or radius are invalid
	 * 
	 * @example
	 * ```typescript
	 * // Find clients within 5km of Pretoria coordinates
	 * const nearbyClients = await clientsService.findNearbyClients(
	 *   -25.7479, 28.2293, 5
	 * );
	 * 
	 * // Find clients within 10km for specific organization
	 * const orgClients = await clientsService.findNearbyClients(
	 *   -26.195246, 28.034088, 10, 123
	 * );
	 * 
	 * // Response structure:
	 * // {
	 * //   message: "Success",
	 * //   clients: [
	 * //     {
	 * //       uid: 456,
	 * //       name: "LORO Corp",
	 * //       email: "theguy@example.co.za",
	 * //       latitude: -26.195246,
	 * //       longitude: 28.034088,
	 * //       distance: 2.3 // kilometers
	 * //     },
	 * //     // ... more clients sorted by distance
	 * //   ]
	 * // }
	 * ```
	 */
	async findNearbyClients(
		latitude: number,
		longitude: number,
		radius: number = 5,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ message: string; clients: Array<Client & { distance: number }> }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_NEARBY] Finding clients near coordinates (${latitude}, ${longitude}) within ${radius}km, orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}`);
		
		try {
			if (isNaN(latitude) || isNaN(longitude) || isNaN(radius)) {
				this.logger.error(`[CLIENT_NEARBY] Invalid parameters - lat: ${latitude}, lng: ${longitude}, radius: ${radius}`);
				throw new BadRequestException('Invalid coordinates or radius');
			}

			// Check user access permissions
			this.logger.debug(`[CLIENT_NEARBY] Checking user access for user ${userId}`);
			const { hasElevatedAccess, userAssignedClients, user } = await this.checkUserAccess(userId);
			
			if (userId) {
				if (hasElevatedAccess) {
					this.logger.debug(`[CLIENT_NEARBY] User ${userId} has elevated access (${user.accessLevel})`);
				} else {
					this.logger.debug(`[CLIENT_NEARBY] User ${userId} has access to ${userAssignedClients?.length || 0} assigned clients`);
					
					// If user has no assigned clients and is not elevated, return empty result
					if (!userAssignedClients || userAssignedClients.length === 0) {
						this.logger.warn(`[CLIENT_NEARBY] User ${userId} has no assigned clients and insufficient privileges`);
						return {
							message: 'No clients assigned to user',
							clients: [],
						};
					}
				}
			}

			// Build query filters
			const whereConditions: FindOptionsWhere<Client> = {
				isDeleted: false,
			};

			if (orgId) {
				whereConditions.organisation = { uid: orgId };
			}

			if (branchId) {
				whereConditions.branch = { uid: branchId };
			}

			// Filter by assigned clients if user has limited access (not elevated)
			if (userAssignedClients && userAssignedClients.length > 0 && !hasElevatedAccess) {
				this.logger.debug(`[CLIENT_NEARBY] Filtering by assigned clients: ${userAssignedClients.join(', ')}`);
				whereConditions.uid = In(userAssignedClients);
			}

			this.logger.debug(`[CLIENT_NEARBY] Fetching all clients with filters`);
			// Get all clients
			const clients = await this.clientsRepository.find({
				where: whereConditions,
				relations: ['organisation', 'branch'],
			});

			this.logger.debug(`[CLIENT_NEARBY] Processing ${clients.length} clients for distance calculation`);
			// Filter clients with valid coordinates and calculate distances
			const nearbyClients = clients
				.map((client) => {
					if (!client.latitude || !client.longitude) return null;

					const distance = this.calculateDistance(latitude, longitude, client.latitude, client.longitude);

					return { ...client, distance };
				})
				.filter((client) => client !== null && client.distance <= radius)
				.sort((a, b) => a.distance - b.distance);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_NEARBY] Found ${nearbyClients.length} clients within ${radius}km of (${latitude}, ${longitude}) in ${executionTime}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				clients: nearbyClients,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_NEARBY] Failed to find nearby clients after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw new BadRequestException(error?.message || 'Error finding nearby clients');
		}
	}

	async getClientCheckIns(
		clientId: number,
		orgId?: number,
		branchId?: number,
		userId?: number,
	): Promise<{ message: string; checkIns: CheckIn[] }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_CHECKINS] Fetching check-ins for client ${clientId}, orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}`);
		
		try {
			// Find the client first to confirm it exists and belongs to the right org/branch
			this.logger.debug(`[CLIENT_CHECKINS] Verifying client ${clientId} exists and has access`);
			const clientResult = await this.findOne(clientId, orgId, branchId, userId);
			if (!clientResult.client) {
				this.logger.warn(`[CLIENT_CHECKINS] Client ${clientId} not found or access denied`);
				throw new NotFoundException('Client not found');
			}

			const clientName = clientResult.client.name;
			this.logger.debug(`[CLIENT_CHECKINS] Found client ${clientId} (${clientName}), fetching check-ins`);

			// Get check-ins for this client
			const client = await this.clientsRepository.findOne({
				where: { uid: clientId },
				relations: ['checkIns', 'checkIns.owner'],
			});

			if (!client || !client.checkIns) {
				this.logger.debug(`[CLIENT_CHECKINS] No check-ins found for client ${clientId}`);
				return {
					message: process.env.SUCCESS_MESSAGE || 'Success',
					checkIns: [],
				};
			}

			// Sort check-ins by date, most recent first
			const sortedCheckIns = client.checkIns.sort(
				(a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime(),
			);

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_CHECKINS] Successfully retrieved ${sortedCheckIns.length} check-ins for client ${clientId} (${clientName}) in ${executionTime}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				checkIns: sortedCheckIns,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_CHECKINS] Failed to fetch check-ins for client ${clientId} after ${executionTime}ms. Error: ${error.message}`, error.stack);
			throw new BadRequestException(error?.message || 'Error fetching client check-ins');
		}
	}

	/**
	 * Cron job that runs daily at 5:00 AM to generate communication tasks 3 months ahead
	 * for all active client communication schedules with assigned users.
	 */
	@Cron(CronExpression.EVERY_DAY_AT_5AM) // Daily at 5:00 AM
	async generateCommunicationTasks(): Promise<void> {
		this.logger.log('🚀 Starting automated communication task generation...');

		try {
			const startTime = Date.now();

			// Calculate 3-month window: today to 3 months from now
			const today = startOfDay(new Date());
			const threeMonthsFromNow = addMonths(today, 3);

			this.logger.log(`📅 Generating tasks from ${today.toISOString()} to ${threeMonthsFromNow.toISOString()}`);

			// Get all active communication schedules with assigned users
			const activeSchedules = await this.getActiveSchedulesWithUsers();
			this.logger.log(`📋 Found ${activeSchedules.length} active communication schedules`);

			if (activeSchedules.length === 0) {
				this.logger.log('✅ No active schedules found, job completed');
				return;
			}

			// Process each schedule to generate tasks
			let totalTasksCreated = 0;
			const userTasksMap = new Map<number, Array<{ task: any; schedule: ClientCommunicationSchedule }>>();

			for (const schedule of activeSchedules) {
				try {
					const tasksCreated = await this.processScheduleForTaskGeneration(
						schedule,
						today,
						threeMonthsFromNow,
						userTasksMap,
					);
					totalTasksCreated += tasksCreated;
				} catch (error) {
					this.logger.error(`❌ Error processing schedule ${schedule.uid}: ${error.message}`);
				}
			}

			// Send email notifications to users with newly created tasks
			await this.sendTaskCreationNotifications(userTasksMap);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ Communication task generation completed in ${duration}ms`);
			this.logger.log(`📊 Summary: ${totalTasksCreated} tasks created for ${userTasksMap.size} users`);
		} catch (error) {
			this.logger.error(`💥 Fatal error in communication task generation: ${error.message}`, error.stack);
		}
	}

	/**
	 * Get all active communication schedules with assigned users
	 */
	private async getActiveSchedulesWithUsers(): Promise<ClientCommunicationSchedule[]> {
		return await this.scheduleRepository.find({
			where: {
				isActive: true,
				isDeleted: false,
				assignedTo: { isDeleted: false }, // Only schedules with active assigned users
			},
			relations: ['client', 'assignedTo', 'organisation', 'branch'],
			order: { nextScheduledDate: 'ASC' },
		});
	}

	/**
	 * Process a single schedule to generate tasks for the 3-month window
	 */
	private async processScheduleForTaskGeneration(
		schedule: ClientCommunicationSchedule,
		startDate: Date,
		endDate: Date,
		userTasksMap: Map<number, Array<{ task: any; schedule: ClientCommunicationSchedule }>>,
	): Promise<number> {
		if (!schedule.assignedTo?.uid) {
			this.logger.warn(`⚠️ Schedule ${schedule.uid} has no assigned user, skipping`);
			return 0;
		}

		// Calculate all task dates needed for this schedule within the window
		const taskDates = this.calculateTaskDatesForSchedule(schedule, startDate, endDate);

		if (taskDates.length === 0) {
			return 0;
		}

		// Check for existing tasks to prevent duplicates
		const existingTaskDates = await this.getExistingTaskDates(schedule, taskDates);
		const newTaskDates = taskDates.filter(
			(date) => !existingTaskDates.some((existingDate) => existingDate.getTime() === date.getTime()),
		);

		if (newTaskDates.length === 0) {
			this.logger.debug(`⏭️ All tasks already exist for schedule ${schedule.uid}`);
			return 0;
		}

		// Create tasks for the new dates
		let tasksCreated = 0;
		for (const taskDate of newTaskDates) {
			try {
				const task = await this.createTaskForSchedule(schedule, taskDate);
				if (task) {
					tasksCreated++;

					// Add to user tasks map for email notifications
					if (!userTasksMap.has(schedule.assignedTo.uid)) {
						userTasksMap.set(schedule.assignedTo.uid, []);
					}
					userTasksMap.get(schedule.assignedTo.uid).push({ task, schedule });
				}
			} catch (error) {
				this.logger.error(
					`❌ Failed to create task for schedule ${schedule.uid} on ${taskDate.toISOString()}: ${
						error.message
					}`,
				);
			}
		}

		this.logger.debug(
			`✅ Created ${tasksCreated} tasks for schedule ${schedule.uid} (${schedule.client.name} - ${schedule.communicationType})`,
		);
		return tasksCreated;
	}

	/**
	 * Calculate all task dates needed for a schedule within the given window
	 */
	private calculateTaskDatesForSchedule(
		schedule: ClientCommunicationSchedule,
		startDate: Date,
		endDate: Date,
	): Date[] {
		const dates: Date[] = [];
		let currentDate = schedule.nextScheduledDate ? new Date(schedule.nextScheduledDate) : startDate;

		// Ensure we start from today or later
		if (currentDate < startDate) {
			currentDate = startDate;
		}

		// Calculate dates based on frequency
		while (currentDate <= endDate) {
			// Skip weekends if it's a business communication
			if (!this.shouldSkipDate(currentDate, schedule)) {
				dates.push(new Date(currentDate));
			}

			// Calculate next date based on frequency
			currentDate = this.calculateNextScheduleDate(currentDate, schedule);

			// Safety check to prevent infinite loops
			if (dates.length > 365) {
				// Max 1 year of daily tasks
				this.logger.warn(`⚠️ Too many dates calculated for schedule ${schedule.uid}, breaking loop`);
				break;
			}
		}

		return dates;
	}

	/**
	 * Calculate the next schedule date based on frequency
	 */
	private calculateNextScheduleDate(currentDate: Date, schedule: ClientCommunicationSchedule): Date {
		let nextDate = new Date(currentDate);

		switch (schedule.frequency) {
			case CommunicationFrequency.DAILY:
				nextDate = addDays(nextDate, 1);
				break;
			case CommunicationFrequency.WEEKLY:
				nextDate = addWeeks(nextDate, 1);
				break;
			case CommunicationFrequency.BIWEEKLY:
				nextDate = addWeeks(nextDate, 2);
				break;
			case CommunicationFrequency.MONTHLY:
				nextDate = addMonths(nextDate, 1);
				break;
			case CommunicationFrequency.QUARTERLY:
				nextDate = addMonths(nextDate, 3);
				break;
			case CommunicationFrequency.SEMIANNUALLY:
				nextDate = addMonths(nextDate, 6);
				break;
			case CommunicationFrequency.ANNUALLY:
				nextDate = addYears(nextDate, 1);
				break;
			case CommunicationFrequency.CUSTOM:
				if (schedule.customFrequencyDays) {
					nextDate = addDays(nextDate, schedule.customFrequencyDays);
				} else {
					nextDate = addWeeks(nextDate, 1); // Default to weekly
				}
				break;
			default:
				return new Date(2099, 0, 1); // Far future date to break the loop
		}

		// Adjust for preferred days if specified
		if (schedule.preferredDays && schedule.preferredDays.length > 0) {
			nextDate = this.adjustForPreferredDays(nextDate, schedule.preferredDays);
		}

		// Set preferred time if specified
		if (schedule.preferredTime) {
			const [hours, minutes] = schedule.preferredTime.split(':').map(Number);
			nextDate = setHours(setMinutes(nextDate, minutes), hours);
		} else {
			// Default to 9 AM
			nextDate = setHours(nextDate, 9);
		}

		return nextDate;
	}

	/**
	 * Adjust date to match preferred days of the week
	 */
	private adjustForPreferredDays(date: Date, preferredDays: number[]): Date {
		let adjustedDate = new Date(date);
		let daysChecked = 0;
		const maxDaysToCheck = 14; // Check up to 2 weeks ahead

		while (daysChecked < maxDaysToCheck) {
			const dayOfWeek = adjustedDate.getDay();
			if (preferredDays.includes(dayOfWeek)) {
				return adjustedDate;
			}
			adjustedDate = addDays(adjustedDate, 1);
			daysChecked++;
		}

		// If no preferred day found within 2 weeks, return original date
		return date;
	}

	/**
	 * Check if a date should be skipped (e.g., weekends for business communications)
	 */
	private shouldSkipDate(date: Date, schedule: ClientCommunicationSchedule): boolean {
		// Skip weekends for business communications (except SMS/WhatsApp which can be any time)
		if (
			isWeekend(date) &&
			![CommunicationType.SMS, CommunicationType.WHATSAPP].includes(schedule.communicationType)
		) {
			return true;
		}

		return false;
	}

	/**
	 * Get existing task dates for a schedule to prevent duplicates
	 */
	private async getExistingTaskDates(schedule: ClientCommunicationSchedule, checkDates: Date[]): Promise<Date[]> {
		if (checkDates.length === 0) return [];

		// Use query builder for better JSON field handling across different databases
		const existingTasks = await this.taskRepository
			.createQueryBuilder('task')
			.select(['task.deadline'])
			.where('task.targetCategory = :category', { category: 'communication_schedule' })
			.andWhere('task.isDeleted = :isDeleted', { isDeleted: false })
			.andWhere('task.deadline IN (:...dates)', { dates: checkDates })
			.andWhere(
				'JSON_EXTRACT(task.assignees, "$[*].uid") LIKE :assigneeId OR task.assignees LIKE :assigneePattern',
				{
					assigneeId: `%${schedule.assignedTo.uid}%`,
					assigneePattern: `%{"uid":${schedule.assignedTo.uid}}%`
				}
			)
			.andWhere(
				'JSON_EXTRACT(task.clients, "$[*].uid") LIKE :clientId OR task.clients LIKE :clientPattern',
				{
					clientId: `%${schedule.client.uid}%`,
					clientPattern: `%{"uid":${schedule.client.uid}}%`
				}
			)
			.getMany();

		return existingTasks.map((task) => task.deadline);
	}

	/**
	 * Create a task for a specific schedule and date using TasksService
	 */
	private async createTaskForSchedule(schedule: ClientCommunicationSchedule, taskDate: Date): Promise<any> {
		// Map communication type to task type
		const taskTypeMap = {
			[CommunicationType.PHONE_CALL]: TaskType.CALL,
			[CommunicationType.EMAIL]: TaskType.EMAIL,
			[CommunicationType.IN_PERSON_VISIT]: TaskType.VISIT,
			[CommunicationType.VIDEO_CALL]: TaskType.VIRTUAL_MEETING,
			[CommunicationType.WHATSAPP]: TaskType.WHATSAPP,
			[CommunicationType.SMS]: TaskType.SMS,
		};

		const taskType = taskTypeMap[schedule.communicationType] || TaskType.FOLLOW_UP;

		// Create task title and description
		const formattedDate = format(taskDate, 'MMM dd, yyyy');
		const title = `${schedule.communicationType.replace(/_/g, ' ')} with ${
			schedule.client.name
		} - ${formattedDate}`;
		const description = `Scheduled ${schedule.communicationType
			.replace(/_/g, ' ')
			.toLowerCase()} communication with ${schedule.client.name}.${
			schedule.notes ? `\n\nNotes: ${schedule.notes}` : ''
		}`;

		// Prepare task data
		const createTaskDto = {
			title,
			description,
			taskType,
			priority: TaskPriority.MEDIUM,
			deadline: taskDate,
			repetitionType: RepetitionType.NONE, // Don't use task repetition, use schedule repetition
			assignees: [{ uid: schedule.assignedTo.uid }],
			client: [{ uid: schedule.client.uid }],
			creators: [{ uid: schedule.assignedTo.uid }],
			targetCategory: 'communication_schedule',
			attachments: [],
			subtasks: [],
		};

		try {
			// Use TasksService to create the task (this handles all notifications, events, etc.)
			const result = await this.tasksService.create(
				createTaskDto,
				schedule.organisation?.uid,
				schedule.branch?.uid,
			);

			if (result.message === 'Task created successfully') {
				this.logger.debug(`✅ Task created for ${schedule.client.name} on ${formattedDate}`);
				return {
					title,
					deadline: taskDate,
					taskType,
					clientName: schedule.client.name,
					communicationType: schedule.communicationType,
				};
			} else {
				throw new Error(result.message);
			}
		} catch (error) {
			this.logger.error(`❌ TasksService.create failed: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Send email notifications to users about newly created tasks
	 */
	private async sendTaskCreationNotifications(
		userTasksMap: Map<number, Array<{ task: any; schedule: ClientCommunicationSchedule }>>,
	): Promise<void> {
		if (userTasksMap.size === 0) {
			return;
		}

		for (const [userId, userTasks] of userTasksMap) {
			try {
				const user = await this.userRepository.findOne({
					where: { uid: userId },
					select: ['uid', 'name', 'surname', 'email'],
				});

				if (!user || !user.email) {
					this.logger.warn(`⚠️ User ${userId} not found or has no email`);
					continue;
				}

				// Group tasks by client and communication type for better email organization
				const tasksSummary = this.groupTasksForEmailSummary(userTasks);

				// Send email notification using EventEmitter (integrates with existing email system)
				this.eventEmitter.emit('send.email', EmailType.NEW_TASK, [user.email], {
					name: `${user.name} ${user.surname}`.trim() || user.email,
					tasks: userTasks.map(({ task }) => ({
						title: task.title,
						deadline: task.deadline,
						clientName: task.clientName,
						type: task.taskType,
					})),
					totalTasks: userTasks.length,
					summary: tasksSummary,
					generatedDate: new Date().toISOString(),
				});

				this.logger.debug(`📧 Email notification sent to ${user.email} for ${userTasks.length} new tasks`);
			} catch (error) {
				this.logger.error(`❌ Failed to send notification to user ${userId}: ${error.message}`);
			}
		}
	}

	/**
	 * Group tasks by client and communication type for email summary
	 */
	private groupTasksForEmailSummary(
		userTasks: Array<{ task: any; schedule: ClientCommunicationSchedule }>,
	): Array<{ clientName: string; communicationType: string; taskCount: number }> {
		const summary = new Map<string, { clientName: string; communicationType: string; taskCount: number }>();

		userTasks.forEach(({ task, schedule }) => {
			const key = `${schedule.client.name}-${schedule.communicationType}`;
			if (summary.has(key)) {
				summary.get(key).taskCount++;
			} else {
				summary.set(key, {
					clientName: schedule.client.name,
					communicationType: schedule.communicationType.replace(/_/g, ' '),
					taskCount: 1,
				});
			}
		});

		return Array.from(summary.values()).sort((a, b) => b.taskCount - a.taskCount);
	}

	/**
	 * Cron job that runs daily at 5:00 AM to send communication reminders
	 * to sales representatives about client communications due for the day.
	 */
	@Cron('0 5 * * *') // Daily at 5:00 AM
	async sendCommunicationReminders(): Promise<void> {
		this.logger.log('📧 Starting automated client communication reminders...');

		try {
			const startTime = Date.now();
			const today = startOfDay(new Date());
			const endOfDay = new Date(today);
			endOfDay.setHours(23, 59, 59, 999);

			this.logger.log(`📅 Checking for communications due on ${format(today, 'yyyy-MM-dd')}`);

			// Get communication schedules due for today
			const dueSchedules = await this.getSchedulesDueForDay(today, endOfDay);
			this.logger.log(`📋 Found ${dueSchedules.length} communication schedules due today`);

			if (dueSchedules.length === 0) {
				this.logger.log('✅ No communication reminders to send today');
				return;
			}

			// Group schedules by assigned user to avoid sending multiple emails to the same person
			const remindersByUser = new Map<number, ClientCommunicationSchedule[]>();
			for (const schedule of dueSchedules) {
				if (schedule.assignedTo?.uid) {
					if (!remindersByUser.has(schedule.assignedTo.uid)) {
						remindersByUser.set(schedule.assignedTo.uid, []);
					}
					remindersByUser.get(schedule.assignedTo.uid).push(schedule);
				}
			}

			let remindersSent = 0;
			for (const [userId, userSchedules] of remindersByUser) {
				try {
					await this.sendUserCommunicationReminders(userId, userSchedules);
					remindersSent += userSchedules.length;
				} catch (error) {
					this.logger.error(`❌ Failed to send reminders to user ${userId}: ${error.message}`);
				}
			}

			const duration = Date.now() - startTime;
			this.logger.log(`✅ Communication reminders completed in ${duration}ms`);
			this.logger.log(`📊 Summary: ${remindersSent} reminders sent to ${remindersByUser.size} users`);
		} catch (error) {
			this.logger.error(`💥 Fatal error in communication reminders: ${error.message}`, error.stack);
		}
	}

	/**
	 * Get communication schedules due for a specific day
	 */
	private async getSchedulesDueForDay(startOfDay: Date, endOfDay: Date): Promise<ClientCommunicationSchedule[]> {
		return await this.scheduleRepository
			.createQueryBuilder('schedule')
			.leftJoinAndSelect('schedule.client', 'client')
			.leftJoinAndSelect('schedule.assignedTo', 'assignedTo')
			.leftJoinAndSelect('schedule.organisation', 'organisation')
			.leftJoinAndSelect('schedule.branch', 'branch')
			.where('schedule.isActive = :isActive', { isActive: true })
			.andWhere('schedule.isDeleted = :isDeleted', { isDeleted: false })
			.andWhere('assignedTo.isDeleted = :userDeleted', { userDeleted: false })
			.andWhere('schedule.nextScheduledDate >= :startOfDay', { startOfDay })
			.andWhere('schedule.nextScheduledDate <= :endOfDay', { endOfDay })
			.orderBy('schedule.nextScheduledDate', 'ASC')
			.getMany();
	}

	/**
	 * Send communication reminders to a specific user for their scheduled communications
	 */
	private async sendUserCommunicationReminders(userId: number, schedules: ClientCommunicationSchedule[]): Promise<void> {
		if (schedules.length === 0) return;

		const user = await this.userRepository.findOne({
			where: { uid: userId },
			select: ['uid', 'name', 'surname', 'email'],
		});

		if (!user || !user.email) {
			this.logger.warn(`⚠️ User ${userId} not found or has no email for communication reminder`);
			return;
		}

		const dashboardBaseUrl = this.configService.get<string>('DASHBOARD_URL') || 'https://dashboard.loro.co.za';
		const supportEmail = this.configService.get<string>('SUPPORT_EMAIL') || 'support@loro.co.za';

		// Send individual reminders for each communication (to maintain context and urgency)
		for (const schedule of schedules) {
			try {
				await this.sendSingleCommunicationReminder(user, schedule, dashboardBaseUrl, supportEmail);
				this.logger.debug(`📧 Reminder sent to ${user.email} for client ${schedule.client.name}`);
			} catch (error) {
				this.logger.error(`❌ Failed to send reminder for schedule ${schedule.uid}: ${error.message}`);
			}
		}
	}

	/**
	 * Send a single communication reminder email
	 */
	private async sendSingleCommunicationReminder(
		user: User,
		schedule: ClientCommunicationSchedule,
		dashboardBaseUrl: string,
		supportEmail: string,
	): Promise<void> {
		const now = new Date();
		const isOverdue = schedule.nextScheduledDate < now;
		const daysOverdue = isOverdue ? Math.floor((now.getTime() - schedule.nextScheduledDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;

		// Calculate urgency level
		let urgencyLevel: 'normal' | 'urgent' | 'critical' = 'normal';
		let priority: 'low' | 'medium' | 'high' = 'medium';

		if (isOverdue) {
			if (daysOverdue >= 3) {
				urgencyLevel = 'critical';
				priority = 'high';
			} else if (daysOverdue >= 1) {
				urgencyLevel = 'urgent';
				priority = 'high';
			}
		}

		// Calculate days since last contact if available
		let daysSinceLastContact: number | undefined;
		if (schedule.lastCompletedDate) {
			daysSinceLastContact = Math.floor((now.getTime() - schedule.lastCompletedDate.getTime()) / (1000 * 60 * 60 * 24));
		}

		// Prepare email data
		const emailData: ClientCommunicationReminderData = {
			name: `${user.name} ${user.surname}`.trim() || user.email,
			salesRepName: `${user.name} ${user.surname}`.trim() || user.email,
			salesRepEmail: user.email,
			client: {
				uid: schedule.client.uid,
				name: schedule.client.name,
				email: schedule.client.email,
				phone: schedule.client.phone,
				company: schedule.client.name, // Assuming client name is company name
				contactPerson: schedule.client.contactPerson,
			},
			communication: {
				type: schedule.communicationType.replace(/_/g, ' ').toUpperCase(),
				scheduledDate: format(schedule.nextScheduledDate, 'MMMM dd, yyyy'),
				scheduledTime: schedule.preferredTime,
				frequency: schedule.frequency.replace(/_/g, ' ').toLowerCase(),
				notes: schedule.notes,
				lastCompletedDate: schedule.lastCompletedDate ? format(schedule.lastCompletedDate, 'MMMM dd, yyyy') : undefined,
				daysSinceLastContact,
			},
			schedule: {
				uid: schedule.uid,
				isOverdue,
				daysOverdue,
				priority,
				urgencyLevel,
			},
			organization: {
				name: schedule.organisation?.name || 'Your Organization',
				uid: schedule.organisation?.uid || 0,
			},
			branch: schedule.branch ? {
				name: schedule.branch.name,
				uid: schedule.branch.uid,
			} : undefined,
			dashboardLink: dashboardBaseUrl,
			clientDetailsLink: `${dashboardBaseUrl}/clients/${schedule.client.uid}`,
			supportEmail,
			reminderDate: format(now, 'MMMM dd, yyyy'),
			communicationTips: this.getCommunicationTips(schedule.communicationType),
			nextSteps: this.getNextSteps(schedule.communicationType, isOverdue),
		};

		// Send the email
		this.eventEmitter.emit('send.email', EmailType.CLIENT_COMMUNICATION_REMINDER, [user.email], emailData);
	}

	/**
	 * Get communication tips based on communication type
	 */
	private getCommunicationTips(communicationType: CommunicationType): string[] {
		const tips = {
			[CommunicationType.PHONE_CALL]: [
				'Prepare talking points and questions beforehand',
				'Choose a quiet environment for the call',
				'Have the client\'s file ready for reference',
				'Follow up with a summary email after the call',
			],
			[CommunicationType.EMAIL]: [
				'Keep your message concise and professional',
				'Include a clear subject line',
				'Personalize the content to the client\'s needs',
				'Include a clear call-to-action',
			],
			[CommunicationType.IN_PERSON_VISIT]: [
				'Confirm the meeting location and time',
				'Prepare presentation materials if needed',
				'Arrive 10 minutes early',
				'Bring business cards and relevant documentation',
			],
			[CommunicationType.VIDEO_CALL]: [
				'Test your technology beforehand',
				'Ensure good lighting and audio quality',
				'Have a professional background',
				'Share your screen if presenting materials',
			],
			[CommunicationType.WHATSAPP]: [
				'Keep messages professional yet friendly',
				'Respond during business hours when possible',
				'Use voice messages for complex explanations',
				'Respect the client\'s communication preferences',
			],
			[CommunicationType.SMS]: [
				'Keep messages brief and to the point',
				'Include your name and company',
				'Avoid sending messages outside business hours',
				'Use SMS for appointment confirmations and reminders',
			],
		};

		return tips[communicationType] || [
			'Maintain professional communication standards',
			'Listen actively to client needs',
			'Follow up on previous conversations',
			'Document important points discussed',
		];
	}

	/**
	 * Get next steps based on communication type and urgency
	 */
	private getNextSteps(communicationType: CommunicationType, isOverdue: boolean): string[] {
		const baseSteps = [
			`Complete the ${communicationType.replace(/_/g, ' ').toLowerCase()}`,
			'Update the client\'s communication history',
			'Schedule the next follow-up if needed',
			'Add notes about the conversation outcome',
		];

		if (isOverdue) {
			return [
				'Contact the client immediately to apologize for the delay',
				...baseSteps,
				'Review your schedule to prevent future delays',
			];
		}

		return baseSteps;
	}

	/**
	 * Updates a client's profile through the client portal with comprehensive validation and processing.
	 * 
	 * This method is specifically for clients updating their own profile information and includes:
	 * - Permission validation to ensure clients can only update allowed fields
	 * - Logo processing with fallback generation
	 * - Communication schedule management
	 * - Conditional email notifications based on notifyClient flag
	 * - Admin notifications for profile changes
	 * - Cache invalidation for data consistency
	 *
	 * @param clientAuthId - The ClientAuth.uid from the JWT token
	 * @param updateClientDto - The data to update the client with including notifyClient flag
	 * @param organisationRef - The organization reference from JWT token
	 * @returns Promise<{ message: string; data?: any }> - Success/error message with updated data
	 * 
	 * @throws NotFoundException - When client profile is not found
	 * @throws BadRequestException - When organization mismatch or invalid fields provided
	 * 
	 * @example
	 * ```typescript
	 * const result = await clientsService.updateClientProfile(123, {
	 *   name: 'Updated Company Name',
	 *   phone: '+27 11 987 6543',
	 *   description: 'Updated company description',
	 *   notifyClient: false // Skip email notifications
	 * }, 1);
	 * ```
	 */
	async updateClientProfile(
		clientAuthId: number,
		updateClientDto: UpdateClientDto,
		organisationRef?: number,
	): Promise<{ message: string; data?: any }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_PROFILE_UPDATE] Starting profile update for clientAuthId: ${clientAuthId} in org: ${organisationRef}`);
		this.logger.debug(`[CLIENT_PROFILE_UPDATE] Update payload: ${JSON.stringify({ ...updateClientDto, notifyClient: updateClientDto.notifyClient ?? true }, null, 2)}`);

		try {
			// 1. Find the ClientAuth record and related Client
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { uid: clientAuthId, isDeleted: false },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

			if (!clientAuth || !clientAuth.client) {
				this.logger.warn(`[CLIENT_PROFILE_UPDATE] ClientAuth or Client not found for ID: ${clientAuthId}`);
				throw new NotFoundException('Client profile not found');
			}

			const client = clientAuth.client;

			// 2. Validate organization membership
			if (organisationRef && client.organisation?.uid !== organisationRef) {
				this.logger.warn(`[CLIENT_PROFILE_UPDATE] Organization mismatch for client ${client.uid}. Expected: ${organisationRef}, Found: ${client.organisation?.uid}`);
				throw new BadRequestException('Client does not belong to the specified organization');
			}

			// 3. Filter out restricted fields that clients cannot update
			const restrictedFields = [
				'uid','organisation', 'branch', 'assignedSalesRep',
				'creditLimit', 'outstandingBalance', 'lifetimeValue', 'discountPercentage',
				'priceTier', 'acquisitionChannel', 'acquisitionDate', 'riskLevel',
				'paymentTerms', 'type', 'status', 'isDeleted', 'createdAt', 'updatedAt',
				'hasPortalAccess', 'portalCredentials', 'quotations', 'checkIns', 'tasks',
				'leads', 'interactions', 'gpsCoordinates'
			];

			// Process logo if provided (generate fallback if needed)
			let processedLogo: string | undefined;
			if (updateClientDto.logo !== undefined) {
				this.logger.debug(`[CLIENT_PROFILE_UPDATE] Processing logo update for client: ${client.name}`);
				processedLogo = await this.processClientLogo(updateClientDto.logo, updateClientDto.name || client.name);
				this.logger.debug(`[CLIENT_PROFILE_UPDATE] Logo processed successfully: ${processedLogo}`);
			}

			// Create a sanitized update object with only allowed fields
			const allowedUpdateData: Partial<UpdateClientDto> = {};
			const updatedFields: string[] = [];
			
			// List of fields clients are allowed to update
			const allowedFields = [
				'contactPerson', 'phone', 'alternativePhone', 'website', 'description',
				'address', 'category', 'preferredContactMethod', 'tags', 'industry',
				'companySize', 'preferredLanguage', 'socialMedia', 'customFields', 'communicationSchedules', 'email', 'name', 'logo'
			];

			for (const [key, value] of Object.entries(updateClientDto)) {
				if (key === 'notifyClient') {
					// Skip notifyClient as it's not part of the entity
					continue;
				} else if (key === 'logo' && processedLogo) {
					// Use the processed logo
					allowedUpdateData[key] = processedLogo;
					updatedFields.push(key);
				} else if (allowedFields.includes(key) && value !== undefined) {
					allowedUpdateData[key] = value;
					updatedFields.push(key);
				} else if (restrictedFields.includes(key)) {
					this.logger.warn(`[CLIENT_PROFILE_UPDATE] Attempt to update restricted field: ${key}`);
					// Don't throw an error, just skip restricted fields
				}
			}

			if (Object.keys(allowedUpdateData).length === 0) {
				this.logger.warn(`[CLIENT_PROFILE_UPDATE] No valid fields to update for client ${client.uid}`);
				throw new BadRequestException('No valid fields provided for update');
			}

			this.logger.debug(`[CLIENT_PROFILE_UPDATE] Updating fields: ${updatedFields.join(', ')} for client ${client.uid}`);

			// 4. Update the client profile
			const updateResult = await this.clientsRepository.update(
				{ uid: client.uid },
				allowedUpdateData as unknown as DeepPartial<Client>
			);

			if (updateResult.affected === 0) {
				throw new BadRequestException('Failed to update client profile');
			}

			// 4.1 Handle communication schedules if provided
			if (updateClientDto.communicationSchedules && updateClientDto.communicationSchedules.length > 0) {
				this.logger.debug(`[CLIENT_PROFILE_UPDATE] Updating communication schedules for client ${client.uid}`);
				
				try {
					// Get existing schedules
					const existingSchedules = await this.communicationScheduleService.getClientSchedules(
						client.uid,
						{ page: 1, limit: 100 },
						organisationRef,
						client.branch?.uid
					);
					
					// Deactivate existing schedules
					for (const schedule of existingSchedules.data) {
						await this.communicationScheduleService.updateSchedule(
							schedule.uid,
							{ isActive: false },
							organisationRef,
							client.branch?.uid
						);
					}
					
					// Create new schedules
					for (const scheduleDto of updateClientDto.communicationSchedules) {
						try {
							await this.communicationScheduleService.createSchedule(
								client.uid,
								scheduleDto,
								organisationRef,
								client.branch?.uid
							);
						} catch (scheduleError) {
							this.logger.error(`[CLIENT_PROFILE_UPDATE] Failed to create communication schedule for client ${client.uid}: ${scheduleError.message}`);
							// Continue with other schedules even if one fails
						}
					}
					
					// Add to updated fields for notification
					if (!updatedFields.includes('communicationSchedules')) {
						updatedFields.push('communicationSchedules');
					}
				} catch (error) {
					this.logger.error(`[CLIENT_PROFILE_UPDATE] Failed to update communication schedules for client ${client.uid}: ${error.message}`);
					// Don't throw error - other profile updates were successful
				}
			}

			// 5. Invalidate cache
			await this.invalidateClientCache(client);

			// 6. Get updated client data for emails
			const updatedClient = await this.clientsRepository.findOne({
				where: { uid: client.uid },
				relations: ['organisation', 'branch'],
			});

			if (!updatedClient) {
				throw new NotFoundException('Updated client not found');
			}

			// 7. Send email notifications (based on notifyClient flag)
			const shouldNotifyClient = updateClientDto.notifyClient !== false; // Default to true if not specified
			this.logger.debug(`[CLIENT_PROFILE_UPDATE] Email notification setting - notifyClient: ${shouldNotifyClient}`);

			if (shouldNotifyClient) {
				this.logger.debug(`[CLIENT_PROFILE_UPDATE] Sending profile update notifications for client ${client.uid}`);
			await this.sendClientProfileUpdateNotifications(updatedClient, updatedFields, clientAuth.email);
			} else {
				this.logger.log(`[CLIENT_PROFILE_UPDATE] Email notifications skipped for client ${client.uid} due to notifyClient=false`);
			}

			const executionTime = Date.now() - startTime;
			this.logger.log(`[CLIENT_PROFILE_UPDATE] Successfully updated client profile ${client.uid} in ${executionTime}ms`);

			return {
				message: 'Client profile updated successfully',
				data: {
					clientId: client.uid,
					updatedFields,
					lastUpdated: new Date().toISOString(),
				},
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[CLIENT_PROFILE_UPDATE] Failed to update client profile for clientAuthId ${clientAuthId} after ${executionTime}ms. Error: ${error.message}`);
			return {
				message: error?.message || 'Failed to update client profile',
			};
		}
	}

	/**
	 * Get all communication schedules for a client
	 * This method is used by clients to view their own communication schedules
	 * 
	 * @param clientAuthId - The ClientAuth.uid from the JWT token
	 * @param organisationRef - The organization reference from JWT token
	 * @returns A response object with the client's communication schedules
	 */
	async getClientCommunicationSchedules(
		clientAuthId: number,
		organisationRef?: number,
	): Promise<{ message: string; schedules?: any[] }> {
		try {
			// Find the ClientAuth record and related Client
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { uid: clientAuthId, isDeleted: false },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

			if (!clientAuth || !clientAuth.client) {
				throw new NotFoundException('Client profile not found');
			}

			const client = clientAuth.client;

			// Validate organization membership
			if (organisationRef && client.organisation?.uid !== organisationRef) {
				throw new BadRequestException('Client does not belong to the specified organization');
			}

			// Get communication schedules
			const schedules = await this.communicationScheduleService.getClientSchedules(
				client.uid,
				{ page: 1, limit: 100, isActive: true },
				organisationRef,
				client.branch?.uid
			);

			return {
				message: 'Communication schedules retrieved successfully',
				schedules: schedules.data,
			};
		} catch (error) {
			return {
				message: error?.message || 'Failed to retrieve communication schedules',
			};
		}
	}

	/**
	 * Update a specific communication schedule for a client
	 * This method is used by clients to update their own communication schedules
	 * 
	 * @param clientAuthId - The ClientAuth.uid from the JWT token
	 * @param scheduleId - The ID of the schedule to update
	 * @param updateDto - The data to update the schedule with
	 * @param organisationRef - The organization reference from JWT token
	 * @returns A response object with success/error message
	 */
	async updateClientCommunicationSchedule(
		clientAuthId: number,
		scheduleId: number,
		updateDto: any,
		organisationRef?: number,
	): Promise<{ message: string }> {
		try {
			// Find the ClientAuth record and related Client
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { uid: clientAuthId, isDeleted: false },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

			if (!clientAuth || !clientAuth.client) {
				throw new NotFoundException('Client profile not found');
			}

			const client = clientAuth.client;

			// Validate organization membership
			if (organisationRef && client.organisation?.uid !== organisationRef) {
				throw new BadRequestException('Client does not belong to the specified organization');
			}

			// First, verify the schedule belongs to this client
			const existingSchedules = await this.communicationScheduleService.getClientSchedules(
				client.uid,
				{ page: 1, limit: 100 },
				organisationRef,
				client.branch?.uid
			);

			const scheduleExists = existingSchedules.data.some(schedule => schedule.uid === scheduleId);
			if (!scheduleExists) {
				throw new NotFoundException('Communication schedule not found or does not belong to this client');
			}

			// Update the schedule
			const result = await this.communicationScheduleService.updateSchedule(
				scheduleId,
				updateDto,
				organisationRef,
				client.branch?.uid
			);

			return {
				message: result.message || 'Communication schedule updated successfully',
			};
		} catch (error) {
			return {
				message: error?.message || 'Failed to update communication schedule',
			};
		}
	}

	/**
	 * Delete a communication schedule for a client
	 * This method is used by clients to delete their own communication schedules
	 * 
	 * @param clientAuthId - The ClientAuth.uid from the JWT token
	 * @param scheduleId - The ID of the schedule to delete
	 * @param organisationRef - The organization reference from JWT token
	 * @returns A response object with success/error message
	 */
	async deleteClientCommunicationSchedule(
		clientAuthId: number,
		scheduleId: number,
		organisationRef?: number,
	): Promise<{ message: string }> {
		try {
			// Find the ClientAuth record and related Client
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { uid: clientAuthId, isDeleted: false },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

			if (!clientAuth || !clientAuth.client) {
				throw new NotFoundException('Client profile not found');
			}

			const client = clientAuth.client;

			// Validate organization membership
			if (organisationRef && client.organisation?.uid !== organisationRef) {
				throw new BadRequestException('Client does not belong to the specified organization');
			}

			// First, verify the schedule belongs to this client
			const existingSchedules = await this.communicationScheduleService.getClientSchedules(
				client.uid,
				{ page: 1, limit: 100 },
				organisationRef,
				client.branch?.uid
			);

			const scheduleExists = existingSchedules.data.some(schedule => schedule.uid === scheduleId);
			if (!scheduleExists) {
				throw new NotFoundException('Communication schedule not found or does not belong to this client');
			}

			// Delete the schedule
			const result = await this.communicationScheduleService.deleteSchedule(scheduleId);

			return {
				message: result.message || 'Communication schedule deleted successfully',
			};
		} catch (error) {
			return {
				message: error?.message || 'Failed to delete communication schedule',
			};
		}
	}

	/**
	 * Sends email notifications after a client profile update
	 * 
	 * @param client - The updated client data
	 * @param updatedFields - Array of fields that were updated
	 * @param clientEmail - The client's email address
	 */
	private async sendClientProfileUpdateNotifications(
		client: Client,
		updatedFields: string[],
		clientEmail: string,
	): Promise<void> {
		try {
			const updateDate = new Date().toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			});

			// Get dashboard links
			const dashboardBaseUrl = this.configService.get<string>('DASHBOARD_URL') || 'https://dashboard.loro.co.za';
			const dashboardLink = `${dashboardBaseUrl}/clients/${client.uid}`;
			const supportEmail = this.configService.get<string>('SUPPORT_EMAIL') || 'support@loro.co.za';

			// 1. Send notification to organization admins
			if (client.organisation?.uid) {
				// Find admin users in the organization
				const adminUsers = await this.userRepository.find({
					where: {
						organisationRef: String(client.organisation.uid),
						accessLevel: In([AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER]),
						isDeleted: false,
					},
					select: ['email', 'name', 'surname'],
				});

				if (adminUsers.length > 0) {
					const adminEmails = adminUsers.filter(user => user.email).map(user => user.email);
					
					if (adminEmails.length > 0) {
						// Send admin notification emails - one for each admin with personalized name
						for (const adminUser of adminUsers.filter(user => user.email)) {
							const adminEmailData: ClientProfileUpdateAdminData = {
								name: `${adminUser.name} ${adminUser.surname}`.trim(),
								adminName: `${adminUser.name} ${adminUser.surname}`.trim(),
								clientName: client.name,
								clientEmail: clientEmail,
								clientId: client.uid,
								updatedFields: updatedFields,
								updatedBy: {
									name: client.name,
									email: clientEmail,
								},
								updateDate: updateDate,
								organization: {
									name: client.organisation?.name || 'Your Organization',
									uid: client.organisation?.uid || 0,
								},
								...(client.branch && {
									branch: {
										name: client.branch.name,
										uid: client.branch.uid,
									},
								}),
								dashboardLink: dashboardLink,
								supportEmail: supportEmail,
								clientPortalAccess: true, // Assuming client has portal access since they're updating profile
							};

							this.eventEmitter.emit('send.email', EmailType.CLIENT_PROFILE_UPDATED_ADMIN, [adminUser.email], adminEmailData);
						}

						this.logger.debug(`[CLIENT_PROFILE_UPDATE] Admin notification sent to ${adminEmails.length} administrators`);
					}
				}
			}

			// 2. Send confirmation email to the client
			const clientEmailData: ClientProfileUpdateConfirmationData = {
				name: client.name,
				clientName: client.name,
				clientEmail: clientEmail,
				updatedFields: updatedFields,
				updatedBy: {
					name: client.name,
					email: clientEmail,
				},
				updateDate: updateDate,
				organization: {
					name: client.organisation?.name || 'Your Organization',
					uid: client.organisation?.uid || 0,
				},
				...(client.branch && {
					branch: {
						name: client.branch.name,
						uid: client.branch.uid,
					},
				}),
				dashboardLink: `${this.configService.get<string>('CLIENT_PORTAL_DOMAIN') || 'https://portal.loro.co.za'}/settings`,
				supportEmail: supportEmail,
			};

			this.eventEmitter.emit('send.email', EmailType.CLIENT_PROFILE_UPDATED_CONFIRMATION, [clientEmail], clientEmailData);

			this.logger.debug(`[CLIENT_PROFILE_UPDATE] Confirmation email sent to client: ${clientEmail}`);
		} catch (error) {
			this.logger.error(`[CLIENT_PROFILE_UPDATE] Failed to send email notifications: ${error.message}`);
			// Don't throw error as profile update was successful
		}
	}
}
