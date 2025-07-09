import { Injectable, NotFoundException, Inject, BadRequestException, Logger } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Client } from './entities/client.entity';
import { ClientAuth } from './entities/client.auth.entity';
import { Repository, DeepPartial, FindOptionsWhere, ILike, In } from 'typeorm';
import { GeneralStatus } from '../lib/enums/status.enums';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { GeofenceType, ClientRiskLevel, ClientStatus } from '../lib/enums/client.enums';
import { Organisation } from '../organisation/entities/organisation.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { EmailType } from '../lib/enums/email.enums';
import { LeadConvertedClientData, LeadConvertedCreatorData, ClientProfileUpdateAdminData, ClientProfileUpdateConfirmationData } from '../lib/types/email-templates.types';
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
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
	}

	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Invalidates all cache entries related to a specific client.
	 * This ensures that any changes to a client are immediately reflected in API responses.
	 *
	 * @param client - The client object whose cache needs to be invalidated
	 */
	private async invalidateClientCache(client: Client) {
		try {
			// Get all cache keys
			const keys = await this.cacheManager.store.keys();

			// Keys to clear
			const keysToDelete = [];

			// Add client-specific keys
			keysToDelete.push(
				this.getCacheKey(client.uid),
				this.getCacheKey(client.email),
				this.getCacheKey(client.name),
				`${this.CACHE_PREFIX}all`,
				`${this.CACHE_PREFIX}stats`,
			);

			// Add organization and branch specific keys
			if (client.organisation?.uid) {
				keysToDelete.push(`${this.CACHE_PREFIX}org_${client.organisation.uid}`);
			}
			if (client.branch?.uid) {
				keysToDelete.push(`${this.CACHE_PREFIX}branch_${client.branch.uid}`);
			}

			// Add status specific keys
			if (client.status) {
				keysToDelete.push(`${this.CACHE_PREFIX}status_${client.status}`);
			}

			// Add category specific keys
			if (client.category) {
				keysToDelete.push(`${this.CACHE_PREFIX}category_${client.category}`);
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

			// Clear all caches
			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));

			// Emit event for other services that might be caching client data
			this.eventEmitter.emit('clients.cache.invalidate', {
				clientId: client.uid,
				keys: keysToDelete,
			});
		} catch (error) {
			console.error('Error invalidating client cache:', error);
		}
	}

	/**
	 * Retrieves the organization settings for a given organization ID.
	 * Used to get default values for client-related settings like geofence radius.
	 *
	 * @param orgId - The organization ID to get settings for
	 * @returns The organization settings object or null if not found
	 */
	private async getOrganisationSettings(orgId: number): Promise<OrganisationSettings | null> {
		if (!orgId) return null;

		try {
			return await this.organisationSettingsRepository.findOne({
				where: { organisationUid: orgId },
			});
		} catch (error) {
			console.error('Error fetching organisation settings:', error);
			return null;
		}
	}

	async create(createClientDto: CreateClientDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_CREATE] Starting client creation for: ${createClientDto.email} ${orgId ? `in org: ${orgId}` : ''} ${branchId ? `in branch: ${branchId}` : ''}`);

		try {
			this.logger.debug(`[CLIENT_CREATE] Checking for existing client with email: ${createClientDto.email}`);
			// First, check for existing client with the same email
			const existingClient = await this.clientsRepository.findOne({
				where: {
					email: createClientDto.email,
					isDeleted: false,
					...(orgId && { organisation: { uid: orgId } }),
				},
			});

			if (existingClient) {
				this.logger.warn(`[CLIENT_CREATE] Client with email ${createClientDto.email} already exists`);
				throw new BadRequestException('A client with this email already exists');
			}

			// First, validate the orgId and branchId if provided
			if (orgId) {
				const organisation = await this.organisationRepository.findOne({ where: { uid: orgId } });
				if (!organisation) {
					throw new BadRequestException(`Organisation with ID ${orgId} not found`);
				}
			}

			// Transform the DTO data to match the entity structure
			// This helps ensure TypeORM gets the correct data structure
			const clientData = {
				...createClientDto,
				// Only transform status if it exists in the DTO
				...(createClientDto['status'] && { status: createClientDto['status'] as GeneralStatus }),
				// Handle address separately to ensure it matches the entity structure
				address: createClientDto.address
					? {
							...createClientDto.address,
					  }
					: undefined,
				// Handle social profiles separately if needed
				socialProfiles: createClientDto.socialProfiles
					? {
							...createClientDto.socialProfiles,
					  }
					: undefined,
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
			const cacheKey = `${
				this.CACHE_PREFIX
			}page${page}_limit${limit}_org${orgId}_branch${branchId}_user${userId}_${JSON.stringify(filters)}`;
			const cachedClients = await this.cacheManager.get<PaginatedResponse<Client>>(cacheKey);

			if (cachedClients) {
				const executionTime = Date.now() - startTime;
				this.logger.debug(`[CLIENT_FIND_ALL] Cache hit - returned ${cachedClients.data.length} clients in ${executionTime}ms`);
				return cachedClients;
			}

		// Get user's assigned clients if user is provided
		let userAssignedClients: number[] | null = null;
		let hasElevatedAccess = false;
		if (userId) {
			this.logger.debug(`[CLIENT_FIND_ALL] Fetching assigned clients for user ${userId}`);
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				select: ['uid', 'assignedClientIds', 'accessLevel'],
			});

			if (user) {
				// Check if user has elevated access (admin, owner, developer, manager, support)
				const elevatedRoles = [
					AccessLevel.OWNER,
					AccessLevel.ADMIN,
					AccessLevel.DEVELOPER,
					AccessLevel.MANAGER,
					AccessLevel.SUPPORT,
					AccessLevel.SUPERVISOR
				];
				
				hasElevatedAccess = elevatedRoles.includes(user.accessLevel);
				
				if (hasElevatedAccess) {
					this.logger.debug(`[CLIENT_FIND_ALL] User ${userId} has elevated access (${user.accessLevel}), returning all clients in organization`);
					userAssignedClients = null; // Don't filter by assigned clients
				} else {
					userAssignedClients = user.assignedClientIds || [];
					this.logger.debug(`[CLIENT_FIND_ALL] User ${userId} has access to ${userAssignedClients.length} assigned clients`);
					
					// If user has no assigned clients and is not elevated, return empty result
					if (userAssignedClients.length === 0) {
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
			} else {
				this.logger.warn(`[CLIENT_FIND_ALL] User ${userId} not found`);
				throw new NotFoundException('User not found');
			}
		}

		// Create find options with relationships
		const where: FindOptionsWhere<Client> = { isDeleted: false };

		// Filter by organization - always apply this filter
		if (orgId) {
			where.organisation = { uid: orgId };
		}

		// Filter by branch - only apply for non-elevated users or when no userId is provided
		// Elevated users can see clients across all branches in their organization
		if (branchId && (!userId || !hasElevatedAccess)) {
			this.logger.debug(`[CLIENT_FIND_ALL] Applying branch filter: ${branchId} (elevated access: ${hasElevatedAccess})`);
			where.branch = { uid: branchId };
		} else if (hasElevatedAccess) {
			this.logger.debug(`[CLIENT_FIND_ALL] Skipping branch filter for elevated user - can see all branches in organization`);
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

			await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);

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

	async findOne(ref: number, orgId?: number, branchId?: number): Promise<{ message: string; client: Client | null }> {
		try {
			const cacheKey = `${this.getCacheKey(ref)}_org${orgId}_branch${branchId}`;
			const cachedClient = await this.cacheManager.get<Client>(cacheKey);

			if (cachedClient) {
				return {
					client: cachedClient,
					message: process.env.SUCCESS_MESSAGE,
				};
			}

			// Create where conditions
			const where: FindOptionsWhere<Client> = {
				uid: ref,
				isDeleted: false,
			};

			// Filter by organization and branch
			if (orgId) {
				where.organisation = { uid: orgId };
			}

			if (branchId) {
				where.branch = { uid: branchId };
			}

			//also fetch tasks and leads

			const client = await this.clientsRepository.findOne({
				where,
				relations: ['branch', 'organisation', 'assignedSalesRep', 'quotations', 'checkIns'],
			});

			if (!client) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			await this.cacheManager.set(cacheKey, client, this.CACHE_TTL);

			return {
				client,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				message: error?.message,
				client: null,
			};
		}
	}

	/**
	 * Updates a client with the provided data.
	 * If the client status is changed to CONVERTED, sends notification emails to both the client and
	 * the assigned sales representative.
	 *
	 * @param ref - The unique identifier of the client to update
	 * @param updateClientDto - The data to update the client with
	 * @param orgId - Optional organization ID to filter clients by organization
	 * @param branchId - Optional branch ID to filter clients by branch
	 * @returns A response object with a success/error message
	 */
	async update(
		ref: number,
		updateClientDto: UpdateClientDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string }> {
		try {
			// Find the existing client with current org/branch context
			const existingClient = await this.findOne(ref, orgId, branchId);

			if (!existingClient.client) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Check if status is being updated to "converted"
			const isBeingConverted =
				updateClientDto.status === GeneralStatus.CONVERTED &&
				existingClient.client.status !== GeneralStatus.CONVERTED;

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
				socialProfiles: updateClientDto.socialProfiles
					? {
							...updateClientDto.socialProfiles,
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

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}

	async remove(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			const existingClient = await this.findOne(ref, orgId, branchId);
			if (!existingClient.client) {
				throw new NotFoundException(process.env.DELETE_ERROR_MESSAGE);
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
			await this.clientsRepository.update(whereConditions, { isDeleted: true });

			// Invalidate cache after deletion
			await this.invalidateClientCache(existingClient.client);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}
	async restore(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		try {
			// Find the deleted client specifically
			const where: FindOptionsWhere<Client> = {
				uid: ref,
				isDeleted: true,
			};

			// Filter by organization and branch
			if (orgId) {
				where.organisation = { uid: orgId };
			}

			if (branchId) {
				where.branch = { uid: branchId };
			}

			const existingClient = await this.clientsRepository.findOne({
				where,
				relations: ['branch', 'organisation'],
			});

			if (!existingClient) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Use the same where conditions for the update
			await this.clientsRepository.update(where, {
				isDeleted: false,
				status: GeneralStatus.ACTIVE,
			});

			// Invalidate cache after restoration
			await this.invalidateClientCache(existingClient);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
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

							// Get user's assigned clients if user is provided
		let userAssignedClients: number[] | null = null;
		let hasElevatedAccess = false;
		if (userId) {
			this.logger.debug(`[CLIENT_SEARCH] Fetching assigned clients for user ${userId}`);
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				select: ['uid', 'assignedClientIds', 'accessLevel'],
			});

			if (user) {
				// Check if user has elevated access (admin, owner, developer, manager, support)
				const elevatedRoles = [
					AccessLevel.OWNER,
					AccessLevel.ADMIN,
					AccessLevel.DEVELOPER,
					AccessLevel.MANAGER,
					AccessLevel.SUPPORT,
					AccessLevel.SUPERVISOR
				];
				
				hasElevatedAccess = elevatedRoles.includes(user.accessLevel);
				
				if (hasElevatedAccess) {
					this.logger.debug(`[CLIENT_SEARCH] User ${userId} has elevated access (${user.accessLevel}), searching all clients in organization`);
					userAssignedClients = null; // Don't filter by assigned clients
				} else {
					userAssignedClients = user.assignedClientIds || [];
					this.logger.debug(`[CLIENT_SEARCH] User ${userId} has access to ${userAssignedClients.length} assigned clients`);
					
					// If user has no assigned clients and is not elevated, return empty result
					if (userAssignedClients.length === 0) {
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
			} else {
				this.logger.warn(`[CLIENT_SEARCH] User ${userId} not found`);
				throw new NotFoundException('User not found');
			}
		}

		// Build where conditions for search
		const where: FindOptionsWhere<Client> = { isDeleted: false };

		// Filter by organization - always apply this filter
		if (orgId) {
			where.organisation = { uid: orgId };
		}

		// Filter by branch - only apply for non-elevated users or when no userId is provided
		// Elevated users can search clients across all branches in their organization
		if (branchId && (!userId || !hasElevatedAccess)) {
			this.logger.debug(`[CLIENT_SEARCH] Applying branch filter: ${branchId} (elevated access: ${hasElevatedAccess})`);
			where.branch = { uid: branchId };
		} else if (hasElevatedAccess) {
			this.logger.debug(`[CLIENT_SEARCH] Skipping branch filter for elevated user - can search all branches in organization`);
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

	async findNearbyClients(
		latitude: number,
		longitude: number,
		radius: number = 5,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; clients: Array<Client & { distance: number }> }> {
		try {
			if (isNaN(latitude) || isNaN(longitude) || isNaN(radius)) {
				throw new BadRequestException('Invalid coordinates or radius');
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

			// Get all clients
			const clients = await this.clientsRepository.find({
				where: whereConditions,
				relations: ['organisation', 'branch'],
			});

			// Filter clients with valid coordinates and calculate distances
			const nearbyClients = clients
				.map((client) => {
					if (!client.latitude || !client.longitude) return null;

					const distance = this.calculateDistance(latitude, longitude, client.latitude, client.longitude);

					return { ...client, distance };
				})
				.filter((client) => client !== null && client.distance <= radius)
				.sort((a, b) => a.distance - b.distance);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				clients: nearbyClients,
			};
		} catch (error) {
			throw new BadRequestException(error?.message || 'Error finding nearby clients');
		}
	}

	async getClientCheckIns(
		clientId: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; checkIns: CheckIn[] }> {
		try {
			// Find the client first to confirm it exists and belongs to the right org/branch
			const clientResult = await this.findOne(clientId, orgId, branchId);
			if (!clientResult.client) {
				throw new NotFoundException('Client not found');
			}

			// Get check-ins for this client
			const client = await this.clientsRepository.findOne({
				where: { uid: clientId },
				relations: ['checkIns', 'checkIns.owner'],
			});

			if (!client || !client.checkIns) {
				return {
					message: process.env.SUCCESS_MESSAGE || 'Success',
					checkIns: [],
				};
			}

			// Sort check-ins by date, most recent first
			const sortedCheckIns = client.checkIns.sort(
				(a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime(),
			);

			return {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				checkIns: sortedCheckIns,
			};
		} catch (error) {
			throw new BadRequestException(error?.message || 'Error fetching client check-ins');
		}
	}

	/**
	 * Cron job that runs daily at 2:00 AM to generate communication tasks 3 months ahead
	 * for all active client communication schedules with assigned users.
	 */
	@Cron(CronExpression.EVERY_DAY_AT_6AM) // Daily at 6:00 AM
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
	 * Updates a client's profile through the client portal.
	 * This method is specifically for clients updating their own profile information.
	 * It includes permission validation and email notifications.
	 *
	 * @param clientAuthId - The ClientAuth.uid from the JWT token
	 * @param updateClientDto - The data to update the client with
	 * @param organisationRef - The organization reference from JWT token
	 * @returns A response object with success/error message and updated data
	 */
	async updateClientProfile(
		clientAuthId: number,
		updateClientDto: UpdateClientDto,
		organisationRef?: number,
	): Promise<{ message: string; data?: any }> {
		const startTime = Date.now();
		this.logger.log(`[CLIENT_PROFILE_UPDATE] Starting profile update for clientAuthId: ${clientAuthId} in org: ${organisationRef}`);

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

			// Create a sanitized update object with only allowed fields
			const allowedUpdateData: Partial<UpdateClientDto> = {};
			const updatedFields: string[] = [];
			
			// List of fields clients are allowed to update
			const allowedFields = [
				'contactPerson', 'phone', 'alternativePhone', 'website', 'description',
				'address', 'category', 'preferredContactMethod', 'tags', 'industry',
				'companySize', 'preferredLanguage', 'socialProfiles', 'customFields', 'communicationSchedules', 'email', 'name'
			];

			for (const [key, value] of Object.entries(updateClientDto)) {
				if (allowedFields.includes(key) && value !== undefined) {
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

			// 7. Send email notifications
			await this.sendClientProfileUpdateNotifications(updatedClient, updatedFields, clientAuth.email);

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
