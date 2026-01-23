import { Between, Repository, In, MoreThan } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Lead } from './entities/lead.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { AccessLevel } from '../lib/enums/user.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { endOfDay } from 'date-fns';
import { startOfDay, addDays } from 'date-fns';
import { NotificationStatus, NotificationType } from '../lib/enums/notification.enums';
import { LeadStatus, LeadTemperature, LeadLifecycleStage, LeadPriority } from '../lib/enums/lead.enums';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES } from '../lib/constants/constants';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { PaginatedResponse } from 'src/lib/types/paginated-response';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { CommunicationService } from '../communication/communication.service';
import { ConfigService } from '@nestjs/config';
import { LeadStatusHistoryEntry } from './entities/lead.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { LeadScoringService } from './lead-scoring.service';
import { Cron } from '@nestjs/schedule';
import { Interaction } from '../interactions/entities/interaction.entity';
import { AccountStatus } from '../lib/enums/status.enums';
import { Task } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { TaskType, TaskPriority, RepetitionType } from '../lib/enums/task.enums';
import { formatDateSafely } from '../lib/utils/date.utils';
import { parseCSV, ParsedLeadRow } from './utils/csv-parser.util';
import { CreateTaskDto } from '../tasks/dto/create-task.dto';
import { OrganisationHoursService } from '../organisation/services/organisation-hours.service';

@Injectable()
export class LeadsService {
	private readonly logger = new Logger(LeadsService.name);
	private readonly CACHE_TTL: number;
	private readonly CACHE_PREFIX = 'lead:';

	// Define inactive user statuses that should not receive notifications
	private readonly INACTIVE_USER_STATUSES = [
		AccountStatus.INACTIVE,
		AccountStatus.DELETED,
		AccountStatus.BANNED,
		AccountStatus.DECLINED,
	];

	constructor(
		@InjectRepository(Lead)
		private leadsRepository: Repository<Lead>,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		@InjectRepository(Interaction)
		private interactionRepository: Repository<Interaction>,
		@InjectRepository(Task)
		private taskRepository: Repository<Task>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly eventEmitter: EventEmitter2,
		private readonly rewardsService: RewardsService,
		private readonly communicationService: CommunicationService,
		private readonly configService: ConfigService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly leadScoringService: LeadScoringService,
		private readonly tasksService: TasksService,
		private readonly organisationHoursService: OrganisationHoursService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
	}


	/**
	 * Generate cache key for leads
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Generate cache key for user leads
	 */
	private getUserLeadsCacheKey(userClerkUserId: string): string {
		return `${this.CACHE_PREFIX}user:${userClerkUserId}`;
	}

	/**
	 * Clear lead-related caches
	 */
	private async clearLeadCache(leadId?: number, userClerkUserId?: string): Promise<void> {
		try {
			const keys = await this.cacheManager.store.keys();
			const keysToDelete = [];

			// Clear specific lead cache if provided
			if (leadId) {
				keysToDelete.push(this.getCacheKey(leadId));
			}

			// Clear user-related lead caches
			if (userClerkUserId) {
				keysToDelete.push(this.getUserLeadsCacheKey(userClerkUserId));
			}

			// Clear all pagination and filtered lead list caches
			const leadListCaches = keys.filter(
				(key) =>
					key.startsWith('leads_page') || // Pagination caches
					key.startsWith('lead:all') || // All leads cache
					key.startsWith('leads:list:') || // List caches
					key.startsWith('leads:stats:') || // Stats caches
					key.includes('_limit'), // Filtered caches
			);
			keysToDelete.push(...leadListCaches);

			// Clear all caches
			if (keysToDelete.length > 0) {
				await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));
				this.logger.log(`Cleared ${keysToDelete.length} lead cache keys`);
			}
		} catch (error) {
			this.logger.error('Failed to clear lead cache', error.stack);
		}
	}

	/**
	 * Create a new lead with early-return pattern for optimal client response time
	 * 
	 * FLOW:
	 * 1. Validate and save lead record to database
	 * 2. Populate relations for immediate response
	 * 3. Return success response to client immediately
	 * 4. Process non-critical operations asynchronously (XP, notifications, scoring, etc.)
	 * 
	 * This pattern ensures the client receives confirmation as soon as the core operation completes,
	 * while background processes (XP awards, notifications, integrations) run without blocking the response.
	 */
	async create(
		createLeadDto: CreateLeadDto,
		orgId?: string,
		branchId?: number,
		currentUserClerkId?: string,
	): Promise<{ message: string; data: Lead | null }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			// Create the lead entity
			const lead = this.leadsRepository.create(createLeadDto as unknown as Lead);

			// Set organization
			lead.organisation = organisation;
			lead.organisationUid = organisation.uid; // Explicitly set the foreign key

			// Set branch if provided
			if (branchId) {
				const branch = { uid: branchId } as Branch;
				lead.branch = branch;
				lead.branchUid = branchId; // Explicitly set the foreign key
			}

			// Set owner and ownerClerkUserId explicitly
			if (createLeadDto.owner?.uid) {
				const ownerUser = await this.userRepository.findOne({
					where: { uid: createLeadDto.owner.uid },
					select: ['uid', 'clerkUserId'],
				});
				if (ownerUser?.clerkUserId) {
					lead.owner = { clerkUserId: ownerUser.clerkUserId } as User;
					lead.ownerClerkUserId = ownerUser.clerkUserId; // Explicitly set the foreign key
				}
			} else if (currentUserClerkId) {
				// Fallback to current user's clerkUserId if owner not provided in DTO
				// Find user by clerkUserId to get the uid for the owner relation
				const currentUser = await this.userRepository.findOne({
					where: { clerkUserId: currentUserClerkId },
					select: ['uid', 'clerkUserId'],
				});
				if (currentUser) {
					lead.owner = { clerkUserId: currentUserClerkId } as User;
					lead.ownerClerkUserId = currentUserClerkId; // Explicitly set the foreign key
				}
			}

			// Handle assignees if provided
			if (createLeadDto.assignees?.length) {
				const assigneeUids = createLeadDto.assignees.map((a) => a.uid);
				const assigneeUsers = await this.userRepository.find({
					where: { uid: In(assigneeUids) },
					select: ['uid', 'clerkUserId'],
				});
				lead.assignees = assigneeUsers
					.filter((u) => u.clerkUserId)
					.map((user) => ({ clerkUserId: user.clerkUserId }));
			} else {
				lead.assignees = [];
			}

			// Set intelligent defaults for new leads
			await this.setIntelligentDefaults(lead);

			// ============================================================
			// CRITICAL PATH: Save lead to database (must complete before response)
			// ============================================================
			const savedLead = await this.leadsRepository.save(lead);

			if (!savedLead) {
				throw new InternalServerErrorException({
					statusCode: 500,
					message: 'Failed to create lead in the database',
					error: 'Internal Server Error',
					action: 'Please try again later or contact support if the problem persists',
					cause: 'Database save operation returned null or undefined',
				});
			}

			// Ensure ownerClerkUserId is set after save (TypeORM should handle this, but verify)
			if (!savedLead.ownerClerkUserId) {
				let clerkUserIdToSet: string | undefined;
				
				if (createLeadDto.owner?.uid) {
					const ownerUser = await this.userRepository.findOne({
						where: { uid: createLeadDto.owner.uid },
						select: ['uid', 'clerkUserId'],
					});
					clerkUserIdToSet = ownerUser?.clerkUserId;
				} else if (currentUserClerkId) {
					// Fallback to current user's clerkUserId
					clerkUserIdToSet = currentUserClerkId;
				}
				
				if (clerkUserIdToSet) {
					this.logger.warn(`⚠️ [LeadsService] ownerClerkUserId not set after save for lead ${savedLead.uid}, updating manually`);
					await this.leadsRepository.update(savedLead.uid, { ownerClerkUserId: clerkUserIdToSet });
					savedLead.ownerClerkUserId = clerkUserIdToSet;
				}
			}

			// Populate the lead with full relation data for response
			const populatedLead = await this.populateLeadRelations(savedLead);

			// Clear caches after successful lead creation
			await this.clearLeadCache(savedLead.uid, savedLead.ownerClerkUserId);

			// ============================================================
			// EARLY RETURN: Respond to client immediately after successful save
			// ============================================================
			const response = {
				message: process.env.SUCCESS_MESSAGE,
				data: populatedLead,
			};

			// ============================================================
			// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
			// These operations run after the response is sent, without blocking the client
			// ============================================================
			setImmediate(async () => {
				try {
					// EVENT-DRIVEN AUTOMATION: Post-creation actions
					await this.handleLeadCreatedEvents(populatedLead);
				} catch (backgroundError) {
					this.logger.error(
						`Background processing failed for lead ${savedLead.uid}: ${backgroundError.message}`,
						backgroundError.stack
					);
				}
			});

			return response;
		} catch (error) {
			this.logger.error(`Error creating lead:`, {
				message: error instanceof Error ? error.message : 'Unknown error',
				stack: error instanceof Error ? error.stack : undefined,
				errorName: error instanceof Error ? error.name : typeof error,
			});
			
			// If it's already a NestJS HTTP exception, re-throw as-is
			if (error instanceof BadRequestException || 
			    error instanceof NotFoundException || 
			    error instanceof ForbiddenException ||
			    error instanceof InternalServerErrorException) {
				throw error;
			}
			
			// For unexpected errors, wrap with InternalServerErrorException
			throw new InternalServerErrorException({
				statusCode: 500,
				message: 'An unexpected error occurred while creating the lead',
				error: 'Internal Server Error',
				action: 'Please try again later or contact support if the problem persists',
				cause: error instanceof Error ? error.message : 'Unknown database or system error',
			});
		}
	}

	/**
	 * Import leads from CSV file with round-robin assignment to sales reps
	 */
	async importLeadsFromCSV(
		file: Express.Multer.File,
		followUpInterval: RepetitionType,
		followUpDuration: number,
		orgId?: string,
		branchId?: number,
		assignedUserIds?: number[],
	): Promise<{
		success: boolean;
		imported: number;
		failed: number;
		errors: Array<{ row: number; error: string }>;
		assignments: Array<{ leadId: number; userId: number; userName: string }>;
	}> {
		const startTime = Date.now();
		this.logger.log(`📥 Starting CSV import for org: ${orgId}, branch: ${branchId}`);

		const result = {
			success: false,
			imported: 0,
			failed: 0,
			errors: [] as Array<{ row: number; error: string }>,
			assignments: [] as Array<{ leadId: number; userId: number; userName: string }>,
		};

		try {
			if (!orgId) {
				throw new BadRequestException({
					statusCode: 400,
					message: 'Organization ID is required to import leads',
					error: 'Bad Request',
					action: 'Please ensure you are authenticated and your organization is properly configured',
					cause: 'Organization ID was not provided in the request context',
				});
			}

			// Find organisation by Clerk org ID for setting relations
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			// Parse CSV
			const { leads, errors: parseErrors } = parseCSV(file.buffer);
			result.errors.push(...parseErrors);

			if (leads.length === 0) {
				return {
					...result,
					success: false,
					errors: result.errors.length > 0 ? result.errors : [{ row: 0, error: 'No valid leads found in CSV' }],
				};
			}

			// Get active sales reps for the organization/branch
			const whereClause: any = {
				organisation: { uid: organisation.uid },
				...(branchId && { branch: { uid: branchId } }),
				status: AccountStatus.ACTIVE,
				isDeleted: false,
			};

			if (assignedUserIds && assignedUserIds.length > 0) {
				whereClause.uid = In(assignedUserIds);
			}

			const salesReps = await this.userRepository.find({
				where: whereClause,
				select: ['uid', 'name', 'surname', 'email'],
			});

			if (salesReps.length === 0) {
				const errorMessage = assignedUserIds && assignedUserIds.length > 0
					? 'No active sales reps found for the selected users. Please ensure the selected users are active sales reps.'
					: 'No active sales reps found in the organization. Please add sales reps before importing leads.';
				return {
					...result,
					success: false,
					errors: [{ row: 0, error: errorMessage }],
				};
			}

			// Round-robin assignment
			const assignments = new Map<number, ParsedLeadRow[]>();
			salesReps.forEach((rep) => assignments.set(rep.uid, []));

			leads.forEach((lead, index) => {
				const repIndex = index % salesReps.length;
				const repId = salesReps[repIndex].uid;
				assignments.get(repId)!.push(lead);
			});

			// Process each lead
			for (let i = 0; i < leads.length; i++) {
				const leadData = leads[i];
				const repIndex = i % salesReps.length;
				const assignedRep = salesReps[repIndex];

				try {
					// Create lead DTO with all parsed fields
					const createLeadDto: CreateLeadDto = {
						// Basic fields
						name: leadData.name,
						email: leadData.email,
						phone: leadData.phone,
						companyName: leadData.companyName,
						notes: leadData.notes,
						image: leadData.image,
						attachments: leadData.attachments,
						latitude: leadData.latitude,
						longitude: leadData.longitude,
						category: leadData.category,
						status: leadData.status || LeadStatus.PENDING,

						// Enhanced qualification fields
						intent: leadData.intent,
						userQualityRating: leadData.userQualityRating,
						temperature: leadData.temperature,
						source: leadData.source,
						priority: leadData.priority,
						lifecycleStage: leadData.lifecycleStage,

						// Company/demographic information
						jobTitle: leadData.jobTitle,
						decisionMakerRole: leadData.decisionMakerRole,
						industry: leadData.industry,
						businessSize: leadData.businessSize,
						budgetRange: leadData.budgetRange,
						purchaseTimeline: leadData.purchaseTimeline,

						// Communication preferences
						preferredCommunication: leadData.preferredCommunication,
						timezone: leadData.timezone,
						bestContactTime: leadData.bestContactTime,

						// Business context
						painPoints: leadData.painPoints,
						estimatedValue: leadData.estimatedValue,
						competitorInfo: leadData.competitorInfo,
						referralSource: leadData.referralSource,

						// Campaign and source tracking
						campaignName: leadData.campaignName,
						landingPage: leadData.landingPage,
						utmSource: leadData.utmSource,
						utmMedium: leadData.utmMedium,
						utmCampaign: leadData.utmCampaign,
						utmTerm: leadData.utmTerm,
						utmContent: leadData.utmContent,

						// Custom fields
						customFields: leadData.customFields,

						// Assignment fields (set by system)
						owner: { uid: assignedRep.uid },
						branch: { uid: branchId },
						assignees: [{ uid: assignedRep.uid }],
					};

					// Create lead
					const createResult = await this.create(createLeadDto, orgId, branchId);
					
					if (!createResult.data) {
						result.failed++;
						result.errors.push({
							row: i + 2,
							error: `Failed to create lead: ${createResult.message}`,
						});
						continue;
					}

					const createdLead = createResult.data;
					result.imported++;
					result.assignments.push({
						leadId: createdLead.uid,
						userId: assignedRep.uid,
						userName: `${assignedRep.name || ''} ${assignedRep.surname || ''}`.trim() || assignedRep.email,
					});

					// Create recurring follow-up task
					try {
						const leadTemperature = createdLead.temperature || LeadTemperature.COLD;
						const leadPriority = createdLead.priority ?? LeadPriority.MEDIUM;
						const nextFollowUpDate = createdLead.nextFollowUpDate || await this.calculateNextFollowUpDate(
							leadTemperature,
							leadPriority,
							orgId, // Pass orgId for org hours check
						);

					const taskDto: CreateTaskDto = {
						title: `Follow up on lead: ${createdLead.name || `Lead #${createdLead.uid}`}`,
						description: `Follow up with ${createdLead.name || 'lead'} from ${createdLead.companyName || 'company'}. ${createdLead.notes ? `\n\nNotes: ${createdLead.notes}` : ''}`,
						taskType: TaskType.FOLLOW_UP,
						priority: TaskPriority.MEDIUM,
						deadline: nextFollowUpDate,
						repetitionType: followUpInterval,
						repetitionDeadline: addDays(new Date(), followUpDuration),
						assignees: [{ uid: assignedRep.uid }],
						creators: [{ uid: assignedRep.uid }],
						client: [],
					};

						await this.tasksService.create(taskDto, organisation.uid, branchId);
					} catch (taskError: any) {
						this.logger.warn(`Failed to create follow-up task for lead ${createdLead.uid}: ${taskError.message}`);
					}
				} catch (error: any) {
					result.failed++;
					result.errors.push({
						row: i + 2,
						error: error.message || 'Failed to process lead',
					});
				}
			}

			result.success = result.imported > 0;
			const duration = Date.now() - startTime;
			this.logger.log(`✅ CSV import completed: ${result.imported} imported, ${result.failed} failed (${duration}ms)`);

			return result;
		} catch (error: any) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ CSV import failed: ${error.message} (${duration}ms)`, error.stack);
			return {
				...result,
				success: false,
				errors: [{ row: 0, error: error.message || 'CSV import failed' }],
			};
		}
	}

	async findAll(
		filters?: {
			status?: LeadStatus;
			search?: string;
			startDate?: Date;
			endDate?: Date;
			temperature?: LeadTemperature;
			minScore?: number;
			maxScore?: number;
		},
		page: number = 1,
		limit: number = 25,
		orgId?: string,
		branchId?: number,
		userId?: number,
		userAccessLevel?: string,
	): Promise<PaginatedResponse<Lead>> {
		const startTime = Date.now();
		const operationId = `FIND_ALL_LEADS_${Date.now()}`;
		
		try {
			if (!orgId) {
				this.logger.error(`[${operationId}] ❌ Organization ID is missing!`, {
					orgId,
					branchId,
					userId,
					userAccessLevel,
				});
				throw new BadRequestException({
					statusCode: 400,
					message: 'Organization ID is required to retrieve leads',
					error: 'Bad Request',
					action: 'Please ensure you are authenticated and your organization is properly configured',
					cause: 'Organization ID was not provided in the request context',
				});
			}

			this.logger.log(`[${operationId}] ✅ Organization ID validated: ${orgId}`);

			// Determine if user has elevated access (can see all leads)
			// Only ADMIN and OWNER can view all leads
			const hasElevatedAccess = [
				AccessLevel.ADMIN,
				AccessLevel.OWNER,
			].includes(userAccessLevel as AccessLevel);

			this.logger.debug(`🏗️ [LeadsService] Building query with filters for org: ${orgId}, branch: ${branchId || 'all'}, elevated: ${hasElevatedAccess}`);

			const queryBuilder = this.leadsRepository
				.createQueryBuilder('lead')
				.leftJoinAndSelect('lead.owner', 'owner')
				.leftJoinAndSelect('lead.branch', 'branch')
				.leftJoinAndSelect('lead.organisation', 'organisation')
				.where('lead.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			// Access control: Regular users can only see their own leads or leads they're assigned to
			if (!hasElevatedAccess && userId) {
				// User can see leads where they are the owner OR where they are in the assignees array
				queryBuilder.andWhere(
					'(lead.ownerClerkUserId = :userId OR CAST(lead.assignees AS jsonb) @> CAST(:userIdJson AS jsonb))',
					{ 
						userId,
						userIdJson: JSON.stringify([{ clerkUserId: userId }])
					}
				);
			}

			if (filters?.status) {
				queryBuilder.andWhere('lead.status = :status', { status: filters.status });
			}

			if (filters?.temperature) {
				queryBuilder.andWhere('lead.temperature = :temperature', { temperature: filters.temperature });
			}

			if (filters?.minScore !== undefined) {
				queryBuilder.andWhere('lead.leadScore >= :minScore', { minScore: filters.minScore });
			}

			if (filters?.maxScore !== undefined) {
				queryBuilder.andWhere('lead.leadScore <= :maxScore', { maxScore: filters.maxScore });
			}

			if (filters?.startDate && filters?.endDate) {
				queryBuilder.andWhere('lead.createdAt BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});
			}

			if (filters?.search) {
				queryBuilder.andWhere(
					'(lead.name ILIKE :search OR lead.email ILIKE :search OR lead.phone ILIKE :search OR lead.companyName ILIKE :search OR owner.name ILIKE :search OR owner.surname ILIKE :search)',
					{ search: `%${filters.search}%` },
				);
			}

			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('lead.leadScore', 'DESC') // Order by lead score (highest priority first)
				.addOrderBy('lead.createdAt', 'DESC');

			this.logger.debug(`💾 [LeadsService] Executing query for leads with pagination: offset=${(page - 1) * limit}, limit=${limit}`);
			const [leads, total] = await queryBuilder.getManyAndCount();

			// Return empty array instead of throwing error when no leads found
			// This is a valid state, not an error condition
			if (!leads || leads.length === 0) {
				this.logger.log(`[${operationId}] ℹ️ No leads found for the given criteria - returning empty result`);
				return {
					data: [],
					meta: {
						total: 0,
						page,
						limit,
						totalPages: 0,
					},
					message: process.env.SUCCESS_MESSAGE || 'Success',
				};
			}

			this.logger.debug(`🔗 [LeadsService] Populating relations for ${leads.length} leads`);
			// Populate leads with full assignee details
			const populatedLeads = await Promise.all(leads.map((lead) => this.populateLeadRelations(lead)));

			this.logger.debug(`📊 [LeadsService] Calculating stats for ${leads.length} leads`);
			const stats = this.calculateStats(leads);

			const duration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Successfully retrieved ${total} leads (${leads.length} on page ${page}) in ${duration}ms`);
			this.logger.log(`[${operationId}] ========== LeadsService.findAll() Completed Successfully ==========`);

			return {
				data: populatedLeads,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error retrieving leads after ${duration}ms:`, {
				message: error instanceof Error ? error.message : 'Unknown error',
				stack: error instanceof Error ? error.stack : undefined,
				errorName: error instanceof Error ? error.name : typeof error,
				orgId,
				branchId,
				userId,
				userAccessLevel,
				page,
				limit,
			});
			this.logger.error(`[${operationId}] ========== LeadsService.findAll() Failed ==========`);
			
			// If it's already a NestJS HTTP exception, re-throw as-is
			if (error instanceof BadRequestException || 
			    error instanceof NotFoundException || 
			    error instanceof ForbiddenException) {
				throw error;
			}
			
			// For unexpected errors, wrap with InternalServerErrorException
			throw new InternalServerErrorException({
				statusCode: 500,
				message: 'An unexpected error occurred while retrieving leads',
				error: 'Internal Server Error',
				action: 'Please try again later or contact support if the problem persists',
				cause: error instanceof Error ? error.message : 'Unknown database or system error',
			});
		}
	}

	async findOne(
		ref: number,
		orgId?: string,
		branchId?: number,
		userId?: number,
		userAccessLevel?: string,
	): Promise<{ lead: Lead | null; message: string; stats: any }> {
		const startTime = Date.now();
		this.logger.log(`🔍 [LeadsService] Finding lead with ID: ${ref}, orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}, role: ${userAccessLevel}`);

		try {
			if (!orgId) {
				this.logger.warn(`❌ [LeadsService] Organization ID is required for lead retrieval`);
				throw new BadRequestException({
					statusCode: 400,
					message: 'Organization ID is required to retrieve lead details',
					error: 'Bad Request',
					action: 'Please ensure you are authenticated and your organization is properly configured',
					cause: 'Organization ID was not provided in the request context',
				});
			}

			this.logger.debug(`🏗️ [LeadsService] Building query for lead ${ref} in org: ${orgId}, branch: ${branchId || 'all'}`);

			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: organisation.uid },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			this.logger.debug(`💾 [LeadsService] Executing database query for lead ${ref}`);
			const lead = await this.leadsRepository.findOne({
				where: whereClause,
				relations: ['owner', 'organisation', 'branch', 'interactions'],
			});

			if (!lead) {
				this.logger.warn(`⚠️ [LeadsService] Lead ${ref} not found in organization ${orgId}`);
				return {
					lead: null,
					message: process.env.NOT_FOUND_MESSAGE,
					stats: null,
				};
			}

			// Access control: Regular users can only view leads they own or are assigned to
			// ADMIN and OWNER can view all leads
			const hasElevatedAccess = [
				AccessLevel.ADMIN,
				AccessLevel.OWNER,
			].includes(userAccessLevel as AccessLevel);

			if (!hasElevatedAccess && userId) {
				// Get user's clerkUserId for comparison
				const user = await this.userRepository.findOne({
					where: { uid: userId },
					select: ['uid', 'clerkUserId'],
				});

				if (!user?.clerkUserId) {
					this.logger.warn(`⚠️ [LeadsService] User ${userId} not found or missing clerkUserId`);
					throw new NotFoundException({
						statusCode: 404,
						message: 'Lead not found or access denied',
						error: 'Not Found',
						action: 'Please verify the lead reference and ensure you have permission to access this lead',
						cause: 'User not found in database or missing clerkUserId',
					});
				}

				// Check ownership - compare ownerClerkUserId with user's clerkUserId
				const isOwner = lead.ownerClerkUserId === user.clerkUserId || lead.owner?.uid === userId;
				
				// Check if user is assigned - assignees are stored as { clerkUserId: string }[]
				let isAssigned = false;
				if (lead.assignees && Array.isArray(lead.assignees) && lead.assignees.length > 0) {
					isAssigned = lead.assignees.some((assignee: any) => {
						// Handle both { clerkUserId: string } format and populated User objects
						if (typeof assignee === 'object' && assignee !== null) {
							if ('clerkUserId' in assignee) {
								return assignee.clerkUserId === user.clerkUserId;
							}
							if ('uid' in assignee) {
								return assignee.uid === userId;
							}
						}
						return assignee === userId || assignee === user.clerkUserId;
					});
				}
				
				if (!isOwner && !isAssigned) {
					this.logger.warn(
						`⚠️ [LeadsService] User ${userId} (clerkUserId: ${user.clerkUserId}) attempted to access lead ${ref} without permission. ` +
						`Lead ownerClerkUserId: ${lead.ownerClerkUserId}, owner.uid: ${lead.owner?.uid}, assignees: ${JSON.stringify(lead.assignees)}`
					);
					throw new NotFoundException({
						statusCode: 404,
						message: 'Lead not found or access denied',
						error: 'Not Found',
						action: 'You can only access leads that you own or are assigned to. Contact an administrator if you need access',
						cause: 'User does not have permission to view this lead',
					});
				}
			}

			this.logger.debug(`🔗 [LeadsService] Populating relations for lead ${ref}`);
			// Populate the lead with full assignee details
			const populatedLead = await this.populateLeadRelations(lead);

			// Update activity data when lead is viewed
			this.logger.debug(`📊 [LeadsService] Updating activity data for lead ${ref}`);
			await this.leadScoringService.updateActivityData(ref);

			this.logger.debug(`📈 [LeadsService] Calculating organization stats for lead ${ref}`);
			const allLeads = await this.leadsRepository.find({
				where: {
					isDeleted: false,
					organisation: { uid: organisation.uid },
				},
			});
			const stats = this.calculateStats(allLeads);

			const response = {
				lead: populatedLead,
				message: process.env.SUCCESS_MESSAGE,
				stats,
			};

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [LeadsService] Successfully retrieved lead ${ref} in ${duration}ms`);

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [LeadsService] Error finding lead ${ref} after ${duration}ms:`, {
				message: error instanceof Error ? error.message : 'Unknown error',
				stack: error instanceof Error ? error.stack : undefined,
				errorName: error instanceof Error ? error.name : typeof error,
				ref,
				orgId,
				branchId,
				userId,
			});
			
			// If it's already a NestJS HTTP exception, re-throw as-is
			if (error instanceof BadRequestException || 
			    error instanceof NotFoundException || 
			    error instanceof ForbiddenException) {
				throw error;
			}
			
			// For unexpected errors, wrap with InternalServerErrorException
			throw new InternalServerErrorException({
				statusCode: 500,
				message: 'An unexpected error occurred while retrieving lead details',
				error: 'Internal Server Error',
				action: 'Please try again later or contact support if the problem persists',
				cause: error instanceof Error ? error.message : 'Unknown database or system error',
			});
		}
	}

	public async leadsByUser(
		ref: number,
		orgId?: string,
		branchId?: number,
		requestingUserId?: number,
		userAccessLevel?: string,
	): Promise<{ message: string; leads: Lead[]; stats: any }> {
		const startTime = Date.now();
		this.logger.log(`🔍 [LeadsService] Getting leads for user: ${ref}, orgId: ${orgId}, branchId: ${branchId}, requestingUserId: ${requestingUserId}, role: ${userAccessLevel}`);

		try {
			if (!orgId) {
				this.logger.warn(`❌ [LeadsService] Organization ID is required for user leads retrieval`);
				throw new BadRequestException({
					statusCode: 400,
					message: 'Organization ID is required to retrieve user leads',
					error: 'Bad Request',
					action: 'Please ensure you are authenticated and your organization is properly configured',
					cause: 'Organization ID was not provided in the request context',
				});
			}

			// Access control: Users can only view their own leads unless they are ADMIN or OWNER
			const hasElevatedAccess = [
				AccessLevel.ADMIN,
				AccessLevel.OWNER,
			].includes(userAccessLevel as AccessLevel);

			// Ensure both values are numbers for comparison (defensive programming)
			const refUserId = Number(ref);
			const requestingUserIdNum = Number(requestingUserId);

			if (!hasElevatedAccess && requestingUserIdNum && refUserId !== requestingUserIdNum) {
				this.logger.warn(`⚠️ [LeadsService] User ${requestingUserIdNum} attempted to access leads for user ${refUserId} without permission`);
				throw new ForbiddenException({
					statusCode: 403,
					message: 'You can only view your own leads',
					error: 'Forbidden',
					action: 'You do not have permission to view leads for other users. Only administrators and owners can view all leads',
					cause: 'User attempted to access leads belonging to another user without elevated permissions',
				});
			}

			this.logger.debug(`🏗️ [LeadsService] Building query for user ${refUserId} leads in org: ${orgId}, branch: ${branchId || 'all'}`);

			// Build query to get leads owned by user OR assigned to user
			const queryBuilder = this.leadsRepository
				.createQueryBuilder('lead')
				.leftJoinAndSelect('lead.owner', 'owner')
				.leftJoinAndSelect('lead.branch', 'branch')
				.leftJoinAndSelect('lead.organisation', 'organisation')
				.where('lead.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
				.andWhere('(lead.ownerClerkUserId = :userId OR CAST(lead.assignees AS jsonb) @> CAST(:userIdJson AS jsonb))', {
					userId: refUserId,
					userIdJson: JSON.stringify([{ clerkUserId: refUserId }])
				});

			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			queryBuilder.orderBy('lead.leadScore', 'DESC').addOrderBy('lead.updatedAt', 'DESC');

			this.logger.debug(`💾 [LeadsService] Executing database query for user ${refUserId} leads`);
			const leads = await queryBuilder.getMany();

		// Handle empty results gracefully - return empty array instead of throwing error
		if (!leads || leads.length === 0) {
			this.logger.warn(`⚠️ [LeadsService] No leads found for user ${refUserId} in organization ${orgId}`);
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [LeadsService] Successfully retrieved 0 leads for user ${refUserId} in ${duration}ms`);
			
			return {
				message: 'No leads found for this user',
				leads: [],
				stats: {
					total: 0,
					new: 0,
					contacted: 0,
					qualified: 0,
					negotiation: 0,
					won: 0,
					lost: 0,
					avgLeadScore: 0,
				},
			};
		}

		this.logger.debug(`🔗 [LeadsService] Populating relations for ${leads.length} user leads`);
		// Populate all leads with full assignee details
		const populatedLeads = await Promise.all(leads.map((lead) => this.populateLeadRelations(lead)));

		this.logger.debug(`📊 [LeadsService] Calculating stats for ${leads.length} user leads`);
		const stats = this.calculateStats(leads);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				leads: populatedLeads,
				stats,
			};

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [LeadsService] Successfully retrieved ${leads.length} leads for user ${refUserId} in ${duration}ms`);

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			const refUserId = Number(ref);
			this.logger.error(`❌ [LeadsService] Error getting leads for user ${refUserId} after ${duration}ms: ${error.message}`, error.stack);
			const response = {
				message: `could not get leads by user - ${error?.message}`,
				leads: null,
				stats: null,
			};

			return response;
		}
	}

	/**
	 * Update a lead with early-return pattern for optimal client response time
	 * 
	 * FLOW:
	 * 1. Validate and fetch existing lead
	 * 2. Build update data with status history tracking
	 * 3. Apply intelligent updates and save to database
	 * 4. Return success response to client immediately
	 * 5. Process non-critical operations asynchronously (XP, notifications, scoring, etc.)
	 * 
	 * This pattern ensures the client receives confirmation as soon as the database update completes,
	 * while background processes (lead scoring, notifications, CRM sync) run without blocking the response.
	 */
	async update(
		ref: number,
		updateLeadDto: UpdateLeadDto,
		orgId?: string,
		branchId?: number,
		userId?: number, // Optionally pass userId performing the update
	): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`🔄 [LeadsService] Updating lead: ${ref}, orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}, updateData:`, {
			hasStatus: !!updateLeadDto.status,
			hasAssignees: !!updateLeadDto.assignees,
			hasTemperature: !!updateLeadDto.temperature,
			hasPriority: !!updateLeadDto.priority,
			assigneeCount: updateLeadDto.assignees?.length || 0
		});

		try {
			if (!orgId) {
				this.logger.warn(`❌ [LeadsService] Organization ID is required for lead update`);
				throw new BadRequestException({
					statusCode: 400,
					message: 'Organization ID is required to update a lead',
					error: 'Bad Request',
					action: 'Please ensure you are authenticated and your organization is properly configured',
					cause: 'Organization ID was not provided in the request context',
				});
			}

			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			this.logger.debug(`🔍 [LeadsService] Finding lead ${ref} for update in org: ${orgId}, branch: ${branchId || 'all'}`);
			const lead = await this.leadsRepository.findOne({
				where: { uid: ref, organisation: { uid: organisation.uid }, branch: { uid: branchId } },
				relations: ['owner', 'organisation', 'branch', 'interactions'],
			});

			if (!lead) {
				this.logger.warn(`⚠️ [LeadsService] Lead ${ref} not found for update in organization ${orgId}`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const oldStatus = lead.status;
			const oldTemperature = lead.temperature;
			const oldPriority = lead.priority;

			this.logger.debug(`📝 [LeadsService] Lead ${ref} current state: status=${oldStatus}, temperature=${oldTemperature}, priority=${oldPriority}`);

			// Ensure changeHistory is treated as an array of LeadStatusHistoryEntry
			const changeHistoryArray: LeadStatusHistoryEntry[] = Array.isArray(lead.changeHistory)
				? lead.changeHistory
				: [];
			const dataToSave: Partial<Lead> = {};

			// Build the data to save, excluding reason/description from UpdateLeadDto that are specific to status change
			this.logger.debug(`🏗️ [LeadsService] Building update data for lead ${ref}`);
			for (const key in updateLeadDto) {
				if (key !== 'statusChangeReason' && key !== 'statusChangeDescription' && key !== 'nextStep') {
					dataToSave[key] = updateLeadDto[key];
				}
			}

			// If status is being updated, add a history entry
			if (updateLeadDto.status && updateLeadDto.status !== oldStatus) {
				this.logger.debug(`📊 [LeadsService] Status change detected: ${oldStatus} → ${updateLeadDto.status}`);
				const newHistoryEntry: LeadStatusHistoryEntry = {
					timestamp: new Date(),
					oldStatus: oldStatus,
					newStatus: updateLeadDto.status,
					reason: updateLeadDto.statusChangeReason,
					description: updateLeadDto.statusChangeDescription,
					nextStep: updateLeadDto.nextStep,
					userId: userId, // User who made the change
				};

				changeHistoryArray.push(newHistoryEntry);
				dataToSave.changeHistory = changeHistoryArray;
			}

			// Handle assignees update specifically
			if (updateLeadDto.assignees) {
				const assigneeUids = updateLeadDto.assignees.map((a) => a.uid);
				const assigneeUsers = await this.userRepository.find({
					where: { uid: In(assigneeUids) },
					select: ['uid', 'clerkUserId'],
				});
				dataToSave.assignees = assigneeUsers
					.filter((u) => u.clerkUserId)
					.map((user) => ({ clerkUserId: user.clerkUserId }));
				this.logger.debug(`👥 [LeadsService] Updating assignees: ${dataToSave.assignees.length} assignees`);
			} else if (updateLeadDto.hasOwnProperty('assignees')) {
				// If assignees key exists but is empty/null, clear it
				dataToSave.assignees = [];
				this.logger.debug(`👥 [LeadsService] Clearing all assignees`);
			}

			// Apply intelligent updates based on data changes
			this.logger.debug(`🧠 [LeadsService] Applying intelligent updates for lead ${ref}`);
			await this.applyIntelligentUpdates(lead, dataToSave);

			// ============================================================
			// CRITICAL PATH: Update lead in database (must complete before response)
			// ============================================================
			this.logger.debug(`💾 [LeadsService] Updating lead ${ref} in database`);
			await this.leadsRepository.update(ref, dataToSave);

			// Clear caches after successful lead update (fast operation, safe to await)
			this.logger.debug(`🧹 [LeadsService] Clearing lead caches after update`);
			await this.clearLeadCache(ref, lead.ownerClerkUserId);

			// ============================================================
			// EARLY RETURN: Respond to client immediately after successful update
			// ============================================================
			const duration = Date.now() - startTime;
			this.logger.log(`✅ [LeadsService] Successfully updated lead ${ref} in ${duration}ms - returning response to client`);

			const response = { message: process.env.SUCCESS_MESSAGE };

			// ============================================================
			// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
			// These operations run after the response is sent, without blocking the client
			// ============================================================
			setImmediate(async () => {
				try {
					this.logger.debug(`🔄 [LeadsService] Starting post-response processing for lead update: ${ref}`);
					
					// Fetch updated lead with relations for post-processing
					const updatedLead = await this.leadsRepository.findOne({
						where: { uid: ref },
						relations: ['owner', 'organisation', 'branch', 'interactions'],
					});

					if (updatedLead) {
						// EVENT-DRIVEN AUTOMATION: Post-update actions
						// These include: lead scoring recalculation, status-specific events, 
						// assignment notifications, temperature updates, CRM sync, etc.
						await this.handleLeadUpdatedEvents(updatedLead, {
							statusChanged: oldStatus !== updateLeadDto.status,
							temperatureChanged: oldTemperature !== updateLeadDto.temperature,
							priorityChanged: oldPriority !== updateLeadDto.priority,
							assigneesChanged: !!updateLeadDto.assignees,
						});
						
						this.logger.debug(`✅ [LeadsService] Post-response processing completed for lead: ${ref}`);
					} else {
						this.logger.warn(`⚠️ [LeadsService] Could not fetch updated lead ${ref} for post-processing`);
					}
				} catch (backgroundError) {
					// Log errors but don't affect user experience since response already sent
					this.logger.error(
						`❌ [LeadsService] Background processing failed for lead ${ref}: ${backgroundError.message}`,
						backgroundError.stack
					);
				}
			});

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [LeadsService] Error updating lead ${ref} after ${duration}ms: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * Check for lead target achievements and send notifications
	 */
	async checkLeadTargetAchievements(userId: number, orgId?: string, branchId?: number): Promise<void> {
		try {
			this.logger.debug(`Checking lead target achievements for user: ${userId}`);

			if (!orgId) {
				this.logger.debug(`No orgId provided for lead target achievements check`);
				return;
			}

			// Resolve orgId string to numeric uid if needed
			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			// Get user with target information
			const user = await this.userRepository.findOne({
				where: { uid: userId, isDeleted: false },
				relations: ['userTarget', 'organisation', 'branch'],
			});

			if (!user || !user.userTarget) {
				this.logger.debug(`No user target found for user: ${userId}`);
				return;
			}

			const { userTarget } = user;

			if (!userTarget.periodStartDate || !userTarget.periodEndDate) {
				this.logger.warn(`User ${userId} has incomplete target period dates`);
				return;
			}

			// Count leads created by user in the target period
			const whereClause: any = {
				owner: { uid: userId },
				isDeleted: false,
				createdAt: Between(userTarget.periodStartDate, userTarget.periodEndDate),
				organisation: { uid: organisation.uid },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const currentLeadCount = await this.leadsRepository.count({ where: whereClause });
			const targetLeadCount = userTarget.targetNewLeads;

			if (!targetLeadCount || targetLeadCount <= 0) {
				this.logger.debug(`No lead target set for user: ${userId}`);
				return;
			}

			const achievementPercentage = (currentLeadCount / targetLeadCount) * 100;

			// Check if target is achieved (100% or more)
			if (achievementPercentage >= 100) {
				await this.sendLeadTargetAchievementNotifications(user, {
					currentValue: currentLeadCount,
					targetValue: targetLeadCount,
					achievementPercentage: Math.round(achievementPercentage),
				});
			}

			this.logger.debug(`Lead target check completed for user: ${userId}, achievement: ${achievementPercentage.toFixed(1)}%`);
		} catch (error) {
			this.logger.error(`Error checking lead target achievements for user ${userId}: ${error.message}`);
		}
	}

	/**
	 * Send lead target achievement notifications to user and admins
	 */
	private async sendLeadTargetAchievementNotifications(
		user: User,
		achievementData: {
			currentValue: number;
			targetValue: number;
			achievementPercentage: number;
		},
	): Promise<void> {
		try {
			this.logger.log(`Sending lead target achievement notifications for user: ${user.uid}`);

			const userTarget = user.userTarget;
			const achievementEmailData = {
				achievementPercentage: achievementData.achievementPercentage,
				currentValue: achievementData.currentValue,
				targetValue: achievementData.targetValue,
				achievementDate: new Date().toLocaleDateString(),
				periodStartDate: formatDateSafely(userTarget.periodStartDate),
				periodEndDate: formatDateSafely(userTarget.periodEndDate),
				motivationalMessage: this.generateLeadMotivationalMessage(achievementData),
			};

			// Push notification already sent by USER_TARGET_ACHIEVEMENT event above
			this.logger.log('Lead target achievement push notification already sent');

			// Send notification to organization admins
			await this.sendLeadTargetAdminNotifications(user, achievementData);

			this.logger.log(`Lead target achievement notifications sent for user: ${user.uid}`);
		} catch (error) {
			this.logger.error(`Error sending lead target achievement notifications for user ${user.uid}: ${error.message}`);
		}
	}

	/**
	 * Send lead target achievement notifications to organization admins
	 */
	private async sendLeadTargetAdminNotifications(
		user: User,
		achievementData: {
			currentValue: number;
			targetValue: number;
			achievementPercentage: number;
		},
	): Promise<void> {
		try {
			// Get organization admins
			const admins = await this.getOrganizationAdmins(user.organisation?.uid ? String(user.organisation.uid) : undefined);

			if (admins.length === 0) {
				this.logger.warn(`No admins found for organization: ${user.organisation?.uid}`);
				return;
			}

			// Send detailed push notifications to admins
			const adminIds = admins.map(admin => admin.uid);
			
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.USER_TARGET_ACHIEVEMENT,
				adminIds,
				{
					userName: `${user.name} ${user.surname}`.trim(),
					userEmail: user.email,
					organizationName: user.organisation?.name || 'Organization',
					branchName: user.branch?.name || 'N/A',
					targetType: 'New Leads',
					currentValue: achievementData.currentValue,
					targetValue: achievementData.targetValue,
					achievementPercentage: achievementData.achievementPercentage,
					periodStartDate: formatDateSafely(user.userTarget?.periodStartDate),
					periodEndDate: formatDateSafely(user.userTarget?.periodEndDate),
					recognitionMessage: this.generateLeadRecognitionMessage(user, achievementData),
					achievementDetails: {
						userId: user.uid,
						userName: `${user.name} ${user.surname}`.trim(),
						targetType: 'New Leads',
						currentValue: achievementData.currentValue,
						targetValue: achievementData.targetValue,
						achievementPercentage: achievementData.achievementPercentage,
						periodStartDate: formatDateSafely(user.userTarget?.periodStartDate),
						periodEndDate: formatDateSafely(user.userTarget?.periodEndDate),
						organizationName: user.organisation?.name || 'Organization',
						branchName: user.branch?.name || 'N/A',
					},
				},
				{
					priority: NotificationPriority.NORMAL,
					customData: {
						screen: '/sales/leads',
						action: 'view_leads',
						userId: user.uid,
						achievementType: 'lead_target',
						achievementPercentage: achievementData.achievementPercentage,
					},
				},
			);

			this.logger.log(`Lead target achievement admin notifications sent to ${adminIds.length} admins for user: ${user.uid}`);
		} catch (error) {
			this.logger.error(`Error sending lead admin notifications for user ${user.uid}: ${error.message}`);
		}
	}

	/**
	 * Get organization admins for notifications
	 */
	private async getOrganizationAdmins(orgId?: string): Promise<User[]> {
		if (!orgId) {
			return [];
		}

		try {
			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			const admins = await this.userRepository.find({
				where: {
					organisation: { uid: organisation.uid },
					accessLevel: In([AccessLevel.ADMIN, AccessLevel.OWNER]),
					isDeleted: false,
					status: In([AccountStatus.ACTIVE]),
				},
				select: ['uid', 'name', 'surname', 'email', 'accessLevel'],
			});

			return admins;
		} catch (error) {
			this.logger.error(`Error fetching organization admins for org ${orgId}: ${error.message}`);
			return [];
		}
	}

	/**
	 * Generate motivational message for lead target achievement
	 */
	private generateLeadMotivationalMessage(achievementData: any): string {
		const messages = [
			'Outstanding lead generation! Your prospecting efforts are paying off!',
			'Excellent work on reaching your lead targets! Keep building that pipeline!',
			'Fantastic lead achievement! Your dedication to finding new opportunities shows!',
			'Well done on your lead generation success! You\'re driving business growth!',
			'Impressive lead results! Your networking and outreach efforts are exceptional!',
		];

		const randomIndex = Math.floor(Math.random() * messages.length);
		return messages[randomIndex];
	}

	/**
	 * Generate recognition message for admins about lead achievements
	 */
	private generateLeadRecognitionMessage(user: User, achievementData: any): string {
		const userName = `${user.name} ${user.surname}`.trim();
		
		return `${userName} has achieved their lead generation target by securing ${achievementData.currentValue} new leads (${achievementData.achievementPercentage}% of target). Their consistent prospecting efforts are contributing significantly to our sales pipeline.`;
	}

	async remove(ref: number, orgId?: string, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`🗑️ [LeadsService] Removing lead: ${ref}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			if (!orgId) {
				this.logger.warn(`❌ [LeadsService] Organization ID is required for lead removal`);
				throw new BadRequestException({
					statusCode: 400,
					message: 'Organization ID is required to delete a lead',
					error: 'Bad Request',
					action: 'Please ensure you are authenticated and your organization is properly configured',
					cause: 'Organization ID was not provided in the request context',
				});
			}

			// Resolve orgId string to numeric uid if needed
			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			this.logger.debug(`🔍 [LeadsService] Finding lead ${ref} for removal in org: ${orgId}, branch: ${branchId || 'all'}`);

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: organisation.uid },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const lead = await this.leadsRepository.findOne({
				where: whereClause,
			});

			if (!lead) {
				this.logger.warn(`⚠️ [LeadsService] Lead ${ref} not found for removal in organization ${orgId}`);
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			this.logger.debug(`🗑️ [LeadsService] Soft deleting lead ${ref}`);
			// Use soft delete by updating isDeleted flag
			await this.leadsRepository.update(ref, { isDeleted: true });

			// Clear caches after successful lead deletion
			this.logger.debug(`🧹 [LeadsService] Clearing lead caches after removal`);
			await this.clearLeadCache(lead.uid, lead.ownerClerkUserId);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [LeadsService] Successfully removed lead ${ref} in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [LeadsService] Error removing lead ${ref} after ${duration}ms: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	async restore(ref: number, orgId?: string, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`♻️ [LeadsService] Restoring lead: ${ref}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			if (!orgId) {
				this.logger.warn(`❌ [LeadsService] Organization ID is required for lead restoration`);
				throw new BadRequestException({
					statusCode: 400,
					message: 'Organization ID is required to restore a lead',
					error: 'Bad Request',
					action: 'Please ensure you are authenticated and your organization is properly configured',
					cause: 'Organization ID was not provided in the request context',
				});
			}

			// Resolve orgId string to numeric uid if needed
			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			this.logger.debug(`🔍 [LeadsService] Finding deleted lead ${ref} for restoration in org: ${orgId}, branch: ${branchId || 'all'}`);

			const whereClause: any = {
				uid: ref,
				isDeleted: true,
				organisation: { uid: organisation.uid },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const lead = await this.leadsRepository.findOne({
				where: whereClause,
			});

			if (!lead) {
				this.logger.warn(`⚠️ [LeadsService] Lead ${ref} not found for restoration in organization ${orgId}`);
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			this.logger.debug(`♻️ [LeadsService] Restoring lead ${ref} by setting isDeleted to false`);
			// Restore by setting isDeleted to false
			await this.leadsRepository.update(ref, { isDeleted: false });

			// Recalculate score for restored lead
			this.logger.debug(`📊 [LeadsService] Recalculating score for restored lead ${ref}`);
			await this.leadScoringService.calculateLeadScore(ref);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [LeadsService] Successfully restored lead ${ref} in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [LeadsService] Error restoring lead ${ref} after ${duration}ms: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	async reactivate(ref: number, orgId?: string, branchId?: number, userId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`🔄 [LeadsService] Reactivating lead: ${ref}, orgId: ${orgId}, branchId: ${branchId}, userId: ${userId}`);

		try {
			if (!orgId) {
				this.logger.warn(`❌ [LeadsService] Organization ID is required for lead reactivation`);
				throw new BadRequestException({
					statusCode: 400,
					message: 'Organization ID is required to reactivate a lead',
					error: 'Bad Request',
					action: 'Please ensure you are authenticated and your organization is properly configured',
					cause: 'Organization ID was not provided in the request context',
				});
			}

			// Resolve orgId string to numeric uid if needed
			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			this.logger.debug(`🔍 [LeadsService] Finding lead ${ref} for reactivation in org: ${orgId}, branch: ${branchId || 'all'}`);

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: organisation.uid },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const lead = await this.leadsRepository.findOne({
				where: whereClause,
				relations: ['owner', 'organisation', 'branch'],
			});

			if (!lead) {
				this.logger.warn(`⚠️ [LeadsService] Lead ${ref} not found for reactivation in organization ${orgId}`);
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			// Check if lead can be reactivated (only declined or cancelled leads)
			if (lead.status !== LeadStatus.DECLINED && lead.status !== LeadStatus.CANCELLED) {
				this.logger.warn(`⚠️ [LeadsService] Lead ${ref} cannot be reactivated - current status: ${lead.status}`);
				return {
					message: 'Only declined or cancelled leads can be reactivated',
				};
			}

			const oldStatus = lead.status;
			const newStatus = LeadStatus.PENDING;

			this.logger.debug(`📊 [LeadsService] Lead ${ref} reactivation: ${oldStatus} → ${newStatus}`);

			// Ensure changeHistory is treated as an array of LeadStatusHistoryEntry
			const changeHistoryArray: LeadStatusHistoryEntry[] = Array.isArray(lead.changeHistory)
				? lead.changeHistory
				: [];

			// Add reactivation entry to history
			const newHistoryEntry: LeadStatusHistoryEntry = {
				timestamp: new Date(),
				oldStatus: oldStatus,
				newStatus: newStatus,
				reason: 'Lead reactivated',
				description: 'Lead status changed from ' + oldStatus + ' to ' + newStatus + ' via reactivation',
				nextStep: 'Review and follow up with lead',
				userId: userId,
			};

			changeHistoryArray.push(newHistoryEntry);

			this.logger.debug(`📝 [LeadsService] Adding reactivation history entry for lead ${ref}`);

			// Calculate next follow-up date based on org hours
			const orgRef = lead.organisation?.clerkOrgId || lead.organisation?.ref || orgId;
			const nextFollowUpDate = await this.calculateNextFollowUpDate(
				LeadTemperature.COLD,
				LeadPriority.MEDIUM,
				orgRef,
			);

			// Update lead status and add history
			await this.leadsRepository.update(ref, {
				status: newStatus,
				changeHistory: changeHistoryArray,
				temperature: LeadTemperature.COLD, // Reset temperature to cold for reactivated leads
				priority: LeadPriority.MEDIUM, // Reset priority to medium
				nextFollowUpDate, // Set proper follow-up date
			});

			// Recalculate lead score
			this.logger.debug(`📊 [LeadsService] Recalculating score for reactivated lead ${ref}`);
			await this.leadScoringService.calculateLeadScore(ref);
			await this.leadScoringService.updateActivityData(ref);

			// Send notification about reactivation
			this.logger.debug(`📢 [LeadsService] Sending reactivation notifications for lead ${ref}`);
			const updatedLead = await this.leadsRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'assignees'],
			});

			if (updatedLead) {
				const userIds = [
					updatedLead.owner?.uid,
					...(updatedLead.assignees?.map((a: any) => a.uid) || []),
				].filter(Boolean);

				// Filter out inactive users before sending notifications
				const activeUserIds = await this.filterActiveUsers(userIds);

				if (activeUserIds.length > 0) {
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.LEAD_UPDATED,
					activeUserIds,
					{
						leadId: updatedLead.uid,
						leadName: updatedLead.name || `Lead #${updatedLead.uid}`,
						status: newStatus,
					},
					{
						priority: NotificationPriority.MEDIUM,
						customData: {
							screen: '/sales/leads',
							action: 'view_lead',
						},
					},
				);
				}
			}

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [LeadsService] Successfully reactivated lead ${ref} from ${oldStatus} to ${newStatus} by user ${userId} in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [LeadsService] Error reactivating lead ${ref} after ${duration}ms: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	/**
	 * AUTOMATED LEAD SCORING: Update lead scores daily at 5am
	 */
	@Cron('0 0 5 * * *') // Daily at 5am
	async hourlyLeadScoring(): Promise<void> {
		this.logger.log('Starting hourly lead scoring...');

		try {
			// Process lead scoring in batches to prevent memory issues
			const batchSize = 50;
			let offset = 0;
			let processedCount = 0;

			while (true) {
				const leads = await this.leadsRepository.find({
					where: {
						isDeleted: false,
						status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
					},
					take: batchSize,
					skip: offset,
					select: ['uid'], // Only select the ID to minimize memory usage
				});

				if (leads.length === 0) {
					break; // No more leads to process
				}

				// Process each lead individually with error handling
				const results = await Promise.allSettled(
					leads.map(async (lead) => {
						try {
							return await this.leadScoringService.calculateLeadScore(lead.uid);
						} catch (error) {
							this.logger.error(`Failed to score lead ${lead.uid}: ${error.message}`);
							return null;
						}
					}),
				);

				// Count successful operations
				const successful = results.filter(
					(result) => result.status === 'fulfilled' && result.value !== null,
				).length;
				processedCount += successful;

				offset += batchSize;
			}

			this.logger.log(`Hourly lead scoring completed: ${processedCount} leads processed`);
		} catch (error) {
			this.logger.error(`Hourly lead scoring failed: ${error.message}`, error.stack);
		}
	}

	/**
	 * AUTOMATED FOLLOW-UPS: Check for overdue follow-ups daily at 5am
	 */
	@Cron('0 0 5 * * *') // Daily at 5am
	async checkOverdueFollowUps(): Promise<void> {
		this.logger.log('Checking for overdue follow-ups...');

		try {
			const now = new Date();
			const overdueLeads = await this.leadsRepository.find({
				where: {
					isDeleted: false,
					nextFollowUpDate: Between(new Date('2020-01-01'), now), // Overdue
					status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
				},
				relations: ['owner'], // Removed 'assignees' since it's not a proper relation
			});

			this.logger.log(`Found ${overdueLeads.length} overdue leads to process`);

			for (const lead of overdueLeads) {
				try {
					// Notify assigned users about overdue follow-up
					const userIds = [lead.owner?.uid, ...(lead.assignees?.map((a: any) => a.uid) || [])].filter(
						Boolean,
					);

					// Filter out inactive users before sending notifications
					const activeUserIds = await this.filterActiveUsers(userIds);

					if (activeUserIds.length > 0) {
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.LEAD_FOLLOW_UP_OVERDUE,
						activeUserIds,
						{
							leadId: lead.uid,
							leadName: lead.name || `Lead #${lead.uid}`,
							daysOverdue: Math.floor(
								(now.getTime() - lead.nextFollowUpDate!.getTime()) / (24 * 60 * 60 * 1000),
							),
						},
						{
							priority: NotificationPriority.HIGH,
							customData: {
								screen: '/sales/leads',
								action: 'view_lead',
							},
						},
					);
					}

					// Update priority if significantly overdue
					const daysOverdue = Math.floor(
						(now.getTime() - lead.nextFollowUpDate!.getTime()) / (24 * 60 * 60 * 1000),
					);
					if (daysOverdue > 7 && lead.priority !== LeadPriority.CRITICAL) {
						await this.leadsRepository.update(lead.uid, {
							priority: LeadPriority.HIGH,
							daysSinceLastResponse: daysOverdue,
						});
					}
				} catch (error) {
					this.logger.error(`Failed to process overdue follow-up for lead ${lead.uid}: ${error.message}`);
				}
			}

			this.logger.log(`Processed ${overdueLeads.length} overdue follow-ups`);
		} catch (error) {
			this.logger.error(`Follow-up check failed: ${error.message}`, error.stack);
		}
	}

	/**
	 * AUTOMATED TASK CREATION: Create tasks for idle leads (2+ days) daily at 5am
	 */
	@Cron('0 0 5 * * *') // Daily at 5am
	async createTasksForIdleLeads(): Promise<void> {
		this.logger.log('Creating tasks for idle leads...');

		try {
			const twoDaysAgo = new Date();
			twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

			// Find leads that haven't been contacted for 2+ days
			const idleLeads = await this.leadsRepository.find({
				where: {
					isDeleted: false,
					status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
					lastContactDate: Between(new Date('2020-01-01'), twoDaysAgo), // Last contacted 2+ days ago
				},
				relations: ['owner', 'organisation', 'branch'],
			});

			this.logger.log(`Found ${idleLeads.length} idle leads to create tasks for`);

			for (const lead of idleLeads) {
				try {
					// Check if a task already exists for this lead in the last 24 hours
					const existingTask = await this.taskRepository.findOne({
						where: {
							title: `Follow up on idle lead: ${lead.name || `Lead #${lead.uid}`}`,
							creator: { uid: lead.owner?.uid },
							createdAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)), // Last 24 hours
						},
					});

					if (existingTask) {
						this.logger.debug(`Task already exists for lead ${lead.uid}, skipping`);
						continue;
					}

					// Create deadline for next business day at appropriate time
					const taskDeadline = this.calculateNextBusinessDayDeadline();

					// Create the task
					const taskData = {
						title: `Follow up on idle lead: ${lead.name || `Lead #${lead.uid}`}`,
						description: `This lead has been idle for ${Math.floor(
							(new Date().getTime() - lead.lastContactDate.getTime()) / (24 * 60 * 60 * 1000),
						)} days. Please follow up immediately.\n\nLead Details:\n- Name: ${lead.name || 'N/A'}\n- Company: ${
							lead.companyName || 'N/A'
						}\n- Email: ${lead.email || 'N/A'}\n- Phone: ${lead.phone || 'N/A'}\n- Status: ${
							lead.status
						}\n- Temperature: ${lead.temperature}\n- Notes: ${lead.notes || 'No notes available'}`,
						taskType: TaskType.FOLLOW_UP,
						priority: TaskPriority.HIGH,
						deadline: taskDeadline,
						creators: [{ uid: lead.owner?.uid }],
						assignees: [{ uid: lead.owner?.uid }],
						clients: [], // No specific client assignment
					};

					const result = await this.tasksService.create(
						taskData,
						lead.organisation?.uid || undefined,
						lead.branch?.uid,
					);

					if (result.message === process.env.SUCCESS_MESSAGE) {
						this.logger.log(`Created task for idle lead ${lead.uid} assigned to user ${lead.owner?.uid}`);
					} else {
						this.logger.error(`Failed to create task for idle lead ${lead.uid}: ${result.message}`);
					}
				} catch (error) {
					this.logger.error(`Failed to create task for idle lead ${lead.uid}: ${error.message}`);
				}
			}

			this.logger.log(`Completed creating tasks for ${idleLeads.length} idle leads`);
		} catch (error) {
			this.logger.error(`Idle lead task creation failed: ${error.message}`, error.stack);
		}
	}

	/**
	 * Validate lead data before sending email to ensure all required fields are present
	 */
	private validateLeadDataForEmail(lead: Lead): boolean {
		// Check if lead has minimum required data
		const hasBasicInfo = lead.uid && (lead.name || lead.companyName || lead.email || lead.phone);
		const hasValidStatus = lead.status && Object.values(LeadStatus).includes(lead.status);
		const hasValidTemperature = lead.temperature && Object.values(LeadTemperature).includes(lead.temperature);
		const hasValidCreatedDate = lead.createdAt && !isNaN(lead.createdAt.getTime());

		const isValid = hasBasicInfo && hasValidStatus && hasValidTemperature && hasValidCreatedDate;

		if (!isValid) {
			this.logger.warn(`Lead ${lead.uid} failed validation: basicInfo=${hasBasicInfo}, status=${hasValidStatus}, temperature=${hasValidTemperature}, createdDate=${hasValidCreatedDate}`);
		}

		return isValid;
	}

	/**
	 * Prepare and validate lead data for email template
	 */
	private prepareLeadDataForEmail(lead: Lead, dashboardUrl: string): any {
		// Validate the lead first
		if (!this.validateLeadDataForEmail(lead)) {
			this.logger.error(`Lead ${lead.uid} has invalid data, skipping from email`);
			return null;
		}

		// Ensure dashboard URL is valid
		const validDashboardUrl = dashboardUrl || this.configService.get<string>('CLIENT_URL') || 'https://app.example.com';
		
		if (!validDashboardUrl || validDashboardUrl === 'undefined') {
			this.logger.error(`Invalid dashboard URL: ${validDashboardUrl}`);
		}

		const now = new Date();
		const daysSinceCreated = Math.floor((now.getTime() - lead.createdAt.getTime()) / (24 * 60 * 60 * 1000));
		
		let daysSinceLastContact: string | number = 'Never contacted';
		if (lead.lastContactDate) {
			const contactDays = Math.floor((now.getTime() - lead.lastContactDate.getTime()) / (24 * 60 * 60 * 1000));
			daysSinceLastContact = contactDays > 0 ? contactDays : 0;
		}

		const leadData = {
			id: lead.uid,
			name: lead.name || `Lead #${lead.uid}`,
			companyName: lead.companyName || 'N/A',
			email: lead.email || 'N/A',
			phone: lead.phone || 'N/A',
			status: lead.status,
			temperature: lead.temperature,
			daysSinceCreated: Math.max(0, daysSinceCreated),
			daysSinceLastContact: daysSinceLastContact,
			estimatedValue: Number(lead.estimatedValue) || 0,
			priority: lead.priority || 'MEDIUM',
			notes: lead.notes || 'No notes available',
			leadUrl: `${validDashboardUrl}/leads/${lead.uid}`,
		};

		// Final validation of prepared data
		if (!leadData.id || (!leadData.name && !leadData.companyName)) {
			this.logger.error(`Prepared lead data is still invalid for lead ${lead.uid}:`, leadData);
			return null;
		}

		return leadData;
	}

	/**
	 * Verify email data completeness before sending
	 */
	private verifyEmailData(emailData: any, userEmail: string): boolean {
		// Check required fields
		const hasUserName = emailData.name && emailData.name.trim() !== '';
		const hasMonth = emailData.month && emailData.month.trim() !== '';
		const hasValidLeads = emailData.unattendedLeads && Array.isArray(emailData.unattendedLeads) && emailData.unattendedLeads.length > 0;
		const hasTotalCount = typeof emailData.totalCount === 'number' && emailData.totalCount > 0;
		const hasValidDashboardUrl = emailData.dashboardUrl && emailData.dashboardUrl !== 'undefined' && emailData.dashboardUrl.startsWith('http');

		// Validate each lead in the array
		let validLeadsCount = 0;
		if (hasValidLeads) {
			for (const lead of emailData.unattendedLeads) {
				if (lead.id && (lead.name || lead.companyName) && lead.leadUrl && lead.leadUrl !== 'undefined/leads/' + lead.id) {
					validLeadsCount++;
				}
			}
		}

		const hasValidLeadData = validLeadsCount === emailData.unattendedLeads?.length;

		const isValid = hasUserName && hasMonth && hasValidLeads && hasTotalCount && hasValidDashboardUrl && hasValidLeadData;

		if (!isValid) {
			this.logger.error(`Email data validation failed for ${userEmail}:`, {
				hasUserName,
				hasMonth,
				hasValidLeads,
				hasTotalCount,
				hasValidDashboardUrl,
				hasValidLeadData,
				validLeadsCount,
				totalLeads: emailData.unattendedLeads?.length || 0,
				dashboardUrl: emailData.dashboardUrl,
			});
		}

		return isValid;
	}

	/**
	 * MONTHLY UNATTENDED LEADS PUSH NOTIFICATION: Send monthly report daily at 5am
	 */
	@Cron('0 0 5 * * *') // Daily at 5am
	async sendMonthlyUnattendedLeadsNotification(): Promise<void> {
		this.logger.log('Sending monthly unattended leads push notification...');

		try {
			const now = new Date();
			const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
			const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

			// Get all active users
			const activeUsers = await this.userRepository.find({
				where: {
					status: In([AccountStatus.ACTIVE, AccountStatus.PENDING]),
					isDeleted: false,
				},
				select: ['uid', 'name', 'surname', 'username'],
			});

			this.logger.log(`Found ${activeUsers.length} active users to process`);

			let notificationsSent = 0;
			let notificationsSkipped = 0;

			for (const user of activeUsers) {
				try {
					// Find unattended leads for this user this month
					const unattendedLeads = await this.leadsRepository.find({
						where: {
							owner: { uid: user.uid },
							isDeleted: false,
							status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
							createdAt: Between(startOfMonth, endOfMonth),
							lastContactDate: null, // Never contacted
						},
						relations: ['owner', 'organisation', 'branch'],
					});

					// Also include leads that haven't been contacted for more than 7 days
					const stalledLeads = await this.leadsRepository.find({
						where: {
							owner: { uid: user.uid },
							isDeleted: false,
							status: In([LeadStatus.PENDING, LeadStatus.REVIEW]),
							createdAt: Between(startOfMonth, endOfMonth),
							lastContactDate: Between(new Date('2020-01-01'), new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // 7+ days ago
						},
						relations: ['owner', 'organisation', 'branch'],
					});

					const allUnattendedLeads = [...unattendedLeads, ...stalledLeads];

					if (allUnattendedLeads.length === 0) {
						this.logger.debug(`No unattended leads found for user ${user.uid} this month`);
						continue;
					}

					// Calculate totals
					const totalEstimatedValue = allUnattendedLeads.reduce((sum, lead) => sum + (Number(lead.estimatedValue) || 0), 0);
					const userName = user.name || user.surname || user.username || 'Team Member';

					// Send detailed push notification to user
					await this.unifiedNotificationService.sendTemplatedNotification(
						NotificationEvent.LEADS_STALE_SUMMARY,
						[user.uid],
						{
							userName: userName,
							month: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
							unattendedCount: allUnattendedLeads.length,
							totalEstimatedValue: totalEstimatedValue.toLocaleString('en-ZA', {
								style: 'currency',
								currency: 'ZAR',
							}),
							topLeads: allUnattendedLeads.slice(0, 5).map(lead => ({
								id: lead.uid,
								name: lead.name || `Lead #${lead.uid}`,
								company: lead.companyName || 'N/A',
								value: Number(lead.estimatedValue) || 0,
								status: lead.status,
								temperature: lead.temperature,
								daysSinceCreated: Math.floor((now.getTime() - lead.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
							})),
							leadDetails: allUnattendedLeads.map(lead => ({
								id: lead.uid,
								name: lead.name || `Lead #${lead.uid}`,
								company: lead.companyName || 'N/A',
								email: lead.email || 'N/A',
								phone: lead.phone || 'N/A',
								status: lead.status,
								temperature: lead.temperature,
								priority: lead.priority,
								estimatedValue: Number(lead.estimatedValue) || 0,
								daysSinceCreated: Math.floor((now.getTime() - lead.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
								lastContactDate: lead.lastContactDate ? Math.floor((now.getTime() - lead.lastContactDate.getTime()) / (24 * 60 * 60 * 1000)) : 'Never',
							})),
						},
						{
							priority: NotificationPriority.HIGH,
							customData: {
								screen: '/sales/leads',
								action: 'view_leads',
								leadsCount: allUnattendedLeads.length,
								totalValue: totalEstimatedValue,
							},
						},
					);

					this.logger.log(`✅ Sent monthly unattended leads push notification to ${user.uid} (${allUnattendedLeads.length} leads, R${totalEstimatedValue} total value)`);
					notificationsSent++;

				} catch (error) {
					this.logger.error(`Failed to send monthly notification to user ${user.uid}: ${error.message}`);
					notificationsSkipped++;
				}
			}

			this.logger.log(`Completed monthly unattended leads notification process: ${notificationsSent} notifications sent, ${notificationsSkipped} skipped`);
		} catch (error) {
			this.logger.error(`Monthly unattended leads notification failed: ${error.message}`, error.stack);
		}
	}

	private calculateStats(leads: Lead[]): {
		total: number;
		pending: number;
		approved: number;
		inReview: number;
		declined: number;
	} {
		return {
			total: leads?.length || 0,
			pending: leads?.filter((lead) => lead?.status === LeadStatus.PENDING)?.length || 0,
			approved: leads?.filter((lead) => lead?.status === LeadStatus.APPROVED)?.length || 0,
			inReview: leads?.filter((lead) => lead?.status === LeadStatus.REVIEW)?.length || 0,
			declined: leads?.filter((lead) => lead?.status === LeadStatus.DECLINED)?.length || 0,
		};
	}

	async getLeadsForDate(date: Date): Promise<{
		message: string;
		leads: {
			pending: Lead[];
			approved: Lead[];
			review: Lead[];
			declined: Lead[];
			total: number;
		};
	}> {
		this.logger.log(`Getting leads for date: ${date.toISOString()}`);
		try {
			const leads = await this.leadsRepository.find({
				where: { createdAt: Between(startOfDay(date), endOfDay(date)) },
			});

			if (!leads) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Group leads by status
			const groupedLeads = {
				pending: leads.filter((lead) => lead.status === LeadStatus.PENDING),
				approved: leads.filter((lead) => lead.status === LeadStatus.APPROVED),
				review: leads.filter((lead) => lead.status === LeadStatus.REVIEW),
				declined: leads.filter((lead) => lead.status === LeadStatus.DECLINED),
				total: leads?.length,
			};

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				leads: groupedLeads,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				leads: null,
			};

			return response;
		}
	}

	async getLeadsReport(filter: any) {
		try {
			const leads = await this.leadsRepository.find({
				where: {
					...filter,
					isDeleted: false,
				},
				relations: ['owner', 'branch', 'client'],
			});

			if (!leads) {
				throw new NotFoundException('No leads found for the specified period');
			}

			const groupedLeads = {
				review: leads.filter((lead) => lead.status === LeadStatus.REVIEW),
				pending: leads.filter((lead) => lead.status === LeadStatus.PENDING),
				approved: leads.filter((lead) => lead.status === LeadStatus.APPROVED),
				declined: leads.filter((lead) => lead.status === LeadStatus.DECLINED),
			};

			const totalLeads = leads.length;
			const approvedLeads = groupedLeads.approved.length;
			const avgResponseTime = this.calculateAverageResponseTime(leads);
			const sources = this.analyzeLeadSources(leads);
			const sourceEffectiveness = this.analyzeSourceEffectiveness(leads);
			const geographicDistribution = this.analyzeGeographicDistribution(leads);
			const leadQualityBySource = this.analyzeLeadQualityBySource(leads);
			const conversionTrends = this.analyzeConversionTrends(leads);
			const responseTimeDistribution = this.analyzeResponseTimeDistribution(leads);

			return {
				...groupedLeads,
				total: totalLeads,
				metrics: {
					conversionRate: `${((approvedLeads / totalLeads) * 100).toFixed(1)}%`,
					averageResponseTime: `${avgResponseTime} hours`,
					topSources: sources,
					qualityScore: this.calculateQualityScore(leads),
					sourceEffectiveness,
					geographicDistribution,
					leadQualityBySource,
					conversionTrends,
					responseTimeDistribution,
				},
			};
		} catch (error) {
			return null;
		}
	}

	private calculateAverageResponseTime(leads: Lead[]): number {
		const respondedLeads = leads.filter(
			(lead) => lead.status === LeadStatus.APPROVED || lead.status === LeadStatus.DECLINED,
		);

		if (respondedLeads.length === 0) return 0;

		const totalResponseTime = respondedLeads.reduce((sum, lead) => {
			const responseTime = lead.updatedAt.getTime() - lead.createdAt.getTime();
			return sum + responseTime;
		}, 0);

		// Convert from milliseconds to hours
		return Number((totalResponseTime / (respondedLeads.length * 60 * 60 * 1000)).toFixed(1));
	}

	private analyzeLeadSources(leads: Lead[]): Array<{ source: string; count: number }> {
		const sourceCounts = leads.reduce((acc, lead) => {
			const source = lead.client?.category || 'Direct';
			acc[source] = (acc[source] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		return Object.entries(sourceCounts)
			.map(([source, count]) => ({ source, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5); // Return top 5 sources
	}

	private calculateQualityScore(leads: Lead[]): number {
		if (leads.length === 0) return 0;

		const approvedLeads = leads.filter((lead) => lead.status === LeadStatus.APPROVED).length;
		const responseTimeScore = this.calculateAverageResponseTime(leads) < 24 ? 1 : 0.5;
		const conversionRate = approvedLeads / leads.length;

		// Calculate score out of 100
		const score = (conversionRate * 0.6 + responseTimeScore * 0.4) * 100;
		return Number(score.toFixed(1));
	}

	private analyzeSourceEffectiveness(leads: Lead[]): Array<{
		source: string;
		totalLeads: number;
		convertedLeads: number;
		conversionRate: string;
		averageResponseTime: string;
		qualityScore: number;
	}> {
		const sourceStats = new Map<
			string,
			{
				total: number;
				converted: number;
				totalResponseTime: number;
				respondedLeads: number;
				qualityScores: number[];
			}
		>();

		leads.forEach((lead) => {
			const source = lead.client?.category || 'Direct';

			if (!sourceStats.has(source)) {
				sourceStats.set(source, {
					total: 0,
					converted: 0,
					totalResponseTime: 0,
					respondedLeads: 0,
					qualityScores: [],
				});
			}

			const stats = sourceStats.get(source);
			stats.total++;

			if (lead.status === LeadStatus.APPROVED) {
				stats.converted++;
			}

			if (lead.status !== LeadStatus.PENDING) {
				stats.respondedLeads++;
				stats.totalResponseTime += lead.updatedAt.getTime() - lead.createdAt.getTime();
			}

			stats.qualityScores.push(this.calculateIndividualLeadQualityScore(lead));
		});

		return Array.from(sourceStats.entries())
			.map(([source, stats]) => ({
				source,
				totalLeads: stats.total,
				convertedLeads: stats.converted,
				conversionRate: `${((stats.converted / stats.total) * 100).toFixed(1)}%`,
				averageResponseTime: `${(stats.respondedLeads > 0
					? stats.totalResponseTime / (stats.respondedLeads * 60 * 60 * 1000)
					: 0
				).toFixed(1)} hours`,
				qualityScore: Number(
					(stats.qualityScores.reduce((sum, score) => sum + score, 0) / stats.total).toFixed(1),
				),
			}))
			.sort((a, b) => b.convertedLeads - a.convertedLeads);
	}

	private analyzeGeographicDistribution(leads: Lead[]): Record<
		string,
		{
			total: number;
			converted: number;
			conversionRate: string;
		}
	> {
		const geoStats = new Map<
			string,
			{
				total: number;
				converted: number;
			}
		>();

		leads.forEach((lead) => {
			const region = lead?.client?.address?.city || 'Unknown';

			if (!geoStats.has(region)) {
				geoStats.set(region, {
					total: 0,
					converted: 0,
				});
			}

			const stats = geoStats.get(region);
			stats.total++;
			if (lead.status === LeadStatus.APPROVED) {
				stats.converted++;
			}
		});

		return Object.fromEntries(
			Array.from(geoStats.entries()).map(([region, stats]) => [
				region,
				{
					total: stats.total,
					converted: stats.converted,
					conversionRate: `${((stats.converted / stats.total) * 100).toFixed(1)}%`,
				},
			]),
		);
	}

	private analyzeLeadQualityBySource(leads: Lead[]): Array<{
		source: string;
		averageQualityScore: number;
		leadDistribution: {
			high: number;
			medium: number;
			low: number;
		};
	}> {
		const sourceQuality = new Map<
			string,
			{
				scores: number[];
				distribution: {
					high: number;
					medium: number;
					low: number;
				};
			}
		>();

		leads.forEach((lead) => {
			const source = lead.client?.category || 'Direct';
			const qualityScore = this.calculateIndividualLeadQualityScore(lead);

			if (!sourceQuality.has(source)) {
				sourceQuality.set(source, {
					scores: [],
					distribution: {
						high: 0,
						medium: 0,
						low: 0,
					},
				});
			}

			const stats = sourceQuality.get(source);
			stats.scores.push(qualityScore);

			if (qualityScore >= 80) stats.distribution.high++;
			else if (qualityScore >= 50) stats.distribution.medium++;
			else stats.distribution.low++;
		});

		return Array.from(sourceQuality.entries())
			.map(([source, stats]) => ({
				source,
				averageQualityScore: Number(
					(stats.scores.reduce((sum, score) => sum + score, 0) / stats.scores.length).toFixed(1),
				),
				leadDistribution: stats.distribution,
			}))
			.sort((a, b) => b.averageQualityScore - a.averageQualityScore);
	}

	private analyzeConversionTrends(leads: Lead[]): Array<{
		date: string;
		totalLeads: number;
		convertedLeads: number;
		conversionRate: string;
	}> {
		const dailyStats = new Map<
			string,
			{
				total: number;
				converted: number;
			}
		>();

		leads.forEach((lead) => {
			const date = lead.createdAt.toISOString().split('T')[0];

			if (!dailyStats.has(date)) {
				dailyStats.set(date, {
					total: 0,
					converted: 0,
				});
			}

			const stats = dailyStats.get(date);
			stats.total++;
			if (lead.status === LeadStatus.APPROVED) {
				stats.converted++;
			}
		});

		return Array.from(dailyStats.entries())
			.map(([date, stats]) => ({
				date,
				totalLeads: stats.total,
				convertedLeads: stats.converted,
				conversionRate: `${((stats.converted / stats.total) * 100).toFixed(1)}%`,
			}))
			.sort((a, b) => a.date.localeCompare(b.date));
	}

	private analyzeResponseTimeDistribution(leads: Lead[]): Record<string, number> {
		const distribution = {
			'Under 1 hour': 0,
			'1-4 hours': 0,
			'4-12 hours': 0,
			'12-24 hours': 0,
			'Over 24 hours': 0,
		};

		leads.forEach((lead) => {
			if (lead.status === LeadStatus.PENDING) return;

			const responseTime = (lead.updatedAt.getTime() - lead.createdAt.getTime()) / (60 * 60 * 1000); // hours

			if (responseTime < 1) distribution['Under 1 hour']++;
			else if (responseTime < 4) distribution['1-4 hours']++;
			else if (responseTime < 12) distribution['4-12 hours']++;
			else if (responseTime < 24) distribution['12-24 hours']++;
			else distribution['Over 24 hours']++;
		});

		return distribution;
	}

	private calculateIndividualLeadQualityScore(lead: Lead): number {
		let score = 0;

		// Response time score (40%)
		if (lead.status !== LeadStatus.PENDING) {
			const responseTime = (lead.updatedAt.getTime() - lead.createdAt.getTime()) / (60 * 60 * 1000);
			if (responseTime < 1) score += 40;
			else if (responseTime < 4) score += 30;
			else if (responseTime < 12) score += 20;
			else if (responseTime < 24) score += 10;
		}

		// Status score (30%)
		if (lead.status === LeadStatus.APPROVED) score += 30;
		else if (lead.status === LeadStatus.REVIEW) score += 15;

		// Data completeness score (30%)
		if (lead.client) {
			if (lead.client.email) score += 10;
			if (lead.client.phone) score += 10;
			if (lead.client.address) score += 10;
		}

		return score;
	}

	/**
	 * Populates the assignees field of a lead with the full user objects
	 */
	private async populateLeadRelations(lead: Lead): Promise<Lead> {
		if (lead.assignees?.length > 0) {
			// Extract clerkUserId from assignees array
			const assigneeClerkUserIds = lead.assignees
				.map((a) => {
					if (typeof a === 'object' && a !== null && 'clerkUserId' in a) {
						return a.clerkUserId;
					}
					return null;
				})
				.filter((id): id is string => id !== null);
			
			if (assigneeClerkUserIds.length > 0) {
				const assigneeProfiles = await this.userRepository.find({
					where: { clerkUserId: In(assigneeClerkUserIds) },
					select: ['uid', 'username', 'name', 'surname', 'email', 'phone', 'photoURL', 'accessLevel', 'status'],
				});
				lead.assignees = assigneeProfiles;
			}
		}

		// Populate change history with user details
		await this.populateLeadChangeHistory(lead);

		return lead;
	}

	/**
	 * Populates the user details in the changeHistory array of a lead
	 */
	private async populateLeadChangeHistory(lead: Lead): Promise<Lead> {
		if (lead.changeHistory?.length > 0) {
			// Extract all userIds from change history
			const userIds = lead.changeHistory
				.filter((entry) => entry.userId)
				.map((entry) => (typeof entry.userId === 'string' ? parseInt(entry.userId) : entry.userId));

			if (userIds.length > 0) {
				// Find all user details in one query
				const users = await this.userRepository.find({
					where: { uid: In(userIds) },
					select: [
						'uid',
						'username',
						'name',
						'surname',
						'email',
						'phone',
						'photoURL',
						'accessLevel',
						'status',
					],
				});

				// Create a map for quick lookup
				const userMap = new Map(users.map((user) => [user.uid.toString(), user]));

				// Update the changeHistory entries with user details
				lead.changeHistory = lead.changeHistory.map((entry) => ({
					...entry,
					user: entry.userId ? userMap.get(entry.userId.toString()) || null : null,
				}));
			}
		}
		return lead;
	}

	/**
	 * Set intelligent defaults for new leads
	 */
	private async setIntelligentDefaults(lead: Lead): Promise<void> {
		// Set default temperature based on source
		if (!lead.temperature) {
			switch (lead.source) {
				case 'REFERRAL':
					lead.temperature = LeadTemperature.WARM;
					break;
				case 'WEBSITE':
				case 'ORGANIC_SEARCH':
					lead.temperature = LeadTemperature.COLD;
					break;
				case 'COLD_CALL':
				case 'EMAIL_CAMPAIGN':
					lead.temperature = LeadTemperature.COLD;
					break;
				default:
					lead.temperature = LeadTemperature.COLD;
			}
		}

		// Set default priority based on budget range
		if (!lead.priority && lead.budgetRange) {
			if (['OVER_1M', 'R500K_1M', 'R250K_500K'].includes(lead.budgetRange)) {
				lead.priority = LeadPriority.HIGH;
			} else if (['R100K_250K', 'R50K_100K'].includes(lead.budgetRange)) {
				lead.priority = LeadPriority.MEDIUM;
			}
		}

		// Set initial next follow-up date based on temperature and priority
		if (!lead.nextFollowUpDate) {
			const orgRef = lead.organisation?.clerkOrgId || lead.organisation?.ref;
			lead.nextFollowUpDate = await this.calculateNextFollowUpDate(lead.temperature, lead.priority, orgRef);
		}

		// Initialize scoring data
		lead.leadScore = 0;
		lead.totalInteractions = 0;
		lead.averageResponseTime = 0;
		lead.daysSinceLastResponse = 0;
	}

	/**
	 * Apply intelligent updates based on data changes
	 */
	private async applyIntelligentUpdates(lead: Lead, updates: Partial<Lead>): Promise<void> {
		// Update temperature if intent changed
		if (updates.intent && updates.intent !== lead.intent) {
			switch (updates.intent) {
				case 'PURCHASE':
					updates.temperature = LeadTemperature.HOT;
					updates.priority = LeadPriority.HIGH;
					break;
				case 'CONVERSION':
					updates.temperature = LeadTemperature.HOT;
					break;
				case 'LOST':
					updates.temperature = LeadTemperature.FROZEN;
					updates.priority = LeadPriority.LOW;
					break;
			}
		}

		// Auto-set next follow-up date based on temperature and priority
		if (updates.temperature && updates.temperature !== lead.temperature) {
			const orgRef = lead.organisation?.clerkOrgId || lead.organisation?.ref;
			updates.nextFollowUpDate = await this.calculateNextFollowUpDate(
				updates.temperature,
				updates.priority || lead.priority,
				orgRef,
			);
		}

		// Update lifecycle stage based on status
		if (updates.status && updates.status !== lead.status) {
			switch (updates.status) {
				case LeadStatus.APPROVED:
					updates.lifecycleStage = LeadLifecycleStage.SALES_QUALIFIED_LEAD;
					break;
				case LeadStatus.CONVERTED:
					updates.lifecycleStage = LeadLifecycleStage.CUSTOMER;
					break;
			}
		}
	}

	/**
	 * Handle events triggered after lead creation
	 */
	private async handleLeadCreatedEvents(lead: Lead): Promise<void> {
		try {
			// 1. Calculate initial lead score
			await this.leadScoringService.calculateLeadScore(lead.uid);
			await this.leadScoringService.updateActivityData(lead.uid);

			// 2. Send assignment notifications
			if (lead.assignees && lead.assignees.length > 0) {
				await this.sendAssignmentNotifications(lead, 'assigned');
			}

			// 3. Award XP to creator
			if (lead.owner?.uid) {
				await this.rewardsService.awardXP({
					owner: lead.owner.uid,
					amount: XP_VALUES.LEAD,
					action: XP_VALUES_TYPES.LEAD,
					source: {
						id: lead.uid.toString(),
						type: XP_VALUES_TYPES.LEAD,
						details: 'Lead created',
					},
				}, lead.organisation?.clerkOrgId || lead.organisation?.ref, lead.branch?.uid);
			}

			// 4. Send system notification
			const notification = {
				type: NotificationType.USER,
				title: 'New Lead Created',
				message: `Lead "${lead.name || `#${lead.uid}`}" has been created`,
				status: NotificationStatus.UNREAD,
				owner: lead.owner,
			};

			const recipients = [AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.SUPERVISOR];

			this.eventEmitter.emit('send.notification', notification, recipients);

			// 5. Check for lead target achievements
			if (lead.owner?.uid) {
				await this.checkLeadTargetAchievements(
					lead.owner.uid,
					lead.organisation?.uid ? String(lead.organisation.uid) : undefined,
					lead.branch?.uid
				);
			}
		} catch (error) {
			this.logger.error(
				`Failed to handle lead creation events for lead ${lead.uid}: ${error.message}`,
				error.stack,
			);
		}
	}

	/**
	 * Handle events triggered after lead updates
	 */
	private async handleLeadUpdatedEvents(
		lead: Lead,
		changes: {
			statusChanged: boolean;
			temperatureChanged: boolean;
			priorityChanged: boolean;
			assigneesChanged: boolean;
		},
	): Promise<void> {
		try {
			// 1. Recalculate lead score if significant changes
			if (changes.statusChanged || changes.temperatureChanged || changes.priorityChanged) {
				await this.leadScoringService.calculateLeadScore(lead.uid);
				await this.leadScoringService.updateActivityData(lead.uid);
			}

			// 2. Handle status-specific events
			if (changes.statusChanged) {
				await this.handleStatusChangeEvents(lead);
			}

			// 3. Handle assignment changes
			if (changes.assigneesChanged) {
				await this.sendAssignmentNotifications(lead, 'updated');
			}

			// 4. Update temperature based on new score if needed
			if (changes.statusChanged || changes.priorityChanged) {
				await this.updateTemperatureBasedOnScore(lead.uid);
			}

			this.logger.log(`Lead update events completed for lead ${lead.uid}`);
		} catch (error) {
			this.logger.error(
				`Failed to handle lead update events for lead ${lead.uid}: ${error.message}`,
				error.stack,
			);
		}
	}

	/**
	 * Handle status change specific events
	 */
	private async handleStatusChangeEvents(lead: Lead): Promise<void> {
		if (lead.status === LeadStatus.CONVERTED) {
			// Send conversion notifications
			const allUserIds = [
				lead.owner?.uid,
				...(lead.assignees?.map((assignee: any) => assignee.uid) || []),
			].filter(Boolean);

			if (allUserIds.length > 0) {
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.LEAD_CONVERTED,
					allUserIds,
					{
						leadId: lead.uid,
						leadName: lead.name || `#${lead.uid}`,
						convertedBy: 'System',
					},
					{
						priority: NotificationPriority.HIGH,
						customData: {
							screen: '/sales/leads',
							action: 'view_lead',
						},
					},
				);
			}

			// Award bonus XP for conversion
			if (lead.owner?.uid) {
				await this.rewardsService.awardXP({
					owner: lead.owner.uid,
					amount: XP_VALUES.LEAD * 3, // Triple XP for conversion
					action: 'LEAD_CONVERSION',
					source: {
						id: lead.uid.toString(),
						type: 'lead_conversion',
						details: 'Lead converted to customer',
					},
				}, lead.organisation?.clerkOrgId || lead.organisation?.ref, lead.branch?.uid);
			}
		}
	}

	/**
	 * Send assignment notifications
	 */
	/**
	 * Check if a user is active and should receive notifications
	 */
	private isUserActive(user: User): boolean {
		return !this.INACTIVE_USER_STATUSES.includes(user.status as AccountStatus);
	}

	/**
	 * Filter active users from a list of users
	 */
	private async filterActiveUsers(userIds: number[]): Promise<number[]> {
		if (userIds.length === 0) return [];

		const users = await this.userRepository.find({
			where: { uid: In(userIds) },
			select: ['uid', 'status'],
		});

		const activeUserIds = users
			.filter(user => this.isUserActive(user))
			.map(user => user.uid);

		const filteredCount = userIds.length - activeUserIds.length;
		if (filteredCount > 0) {
			this.logger.debug(`🚫 Filtered out ${filteredCount} inactive users from lead notifications`);
		}

		return activeUserIds;
	}

	private async sendAssignmentNotifications(lead: Lead, action: 'assigned' | 'updated'): Promise<void> {
		const populatedLead = await this.populateLeadRelations(lead);

		if (populatedLead.assignees && populatedLead.assignees.length > 0) {
			const assigneeIds = populatedLead.assignees.map((assignee: User) => assignee.uid);
			
			// Filter out inactive users before sending notifications
			const activeAssigneeIds = await this.filterActiveUsers(assigneeIds);
			
			if (activeAssigneeIds.length === 0) {
				this.logger.debug(`No active assignees found for lead ${populatedLead.uid}, skipping notifications`);
				return;
			}

			const creatorName = populatedLead.owner?.name || populatedLead.owner?.username || 'System';

			try {
				await this.unifiedNotificationService.sendTemplatedNotification(
					action === 'assigned' ? NotificationEvent.LEAD_ASSIGNED : NotificationEvent.LEAD_UPDATED,
					activeAssigneeIds,
					{
						leadId: populatedLead.uid,
						leadName: populatedLead.name,
						assignedBy: creatorName,
						leadDetails: populatedLead.notes,
						leadCreatorName: creatorName,
						leadLink: `${this.configService.get<string>('DASHBOARD_URL')}/leads/${populatedLead.uid}`,
					},
					{
						priority: NotificationPriority.HIGH,
						customData: {
							screen: '/sales/leads',
							action: 'view_lead',
						},
					},
				);
			} catch (error) {
				this.logger.error(`Failed to send assignment notifications: ${error.message}`);
			}
		}
	}

	/**
	 * Update temperature based on lead score
	 */
	private async updateTemperatureBasedOnScore(leadId: number): Promise<void> {
		const lead = await this.leadsRepository.findOne({ where: { uid: leadId } });
		if (!lead) return;

		let newTemperature = lead.temperature;

		// Auto-adjust temperature based on score
		if (lead.leadScore >= 80) {
			newTemperature = LeadTemperature.HOT;
		} else if (lead.leadScore >= 60) {
			newTemperature = LeadTemperature.WARM;
		} else if (lead.leadScore >= 30) {
			newTemperature = LeadTemperature.COLD;
		} else {
			newTemperature = LeadTemperature.FROZEN;
		}

		// Only update if temperature actually changed
		if (newTemperature !== lead.temperature) {
			await this.leadsRepository.update(leadId, { temperature: newTemperature });
			this.logger.log(
				`Updated temperature for lead ${leadId} from ${lead.temperature} to ${newTemperature} based on score ${lead.leadScore}`,
			);
		}
	}

	/**
	 * Get follow-up days based on temperature
	 */
	private getFollowUpDaysForTemperature(temperature: LeadTemperature): number {
		switch (temperature) {
			case LeadTemperature.HOT:
				return 1; // Daily follow-up
			case LeadTemperature.WARM:
				return 3; // Every 3 days
			case LeadTemperature.COLD:
				return 7; // Weekly
			case LeadTemperature.FROZEN:
				return 30; // Monthly
			default:
				return 7;
		}
	}

	/**
	 * Calculate next follow-up date based on temperature, priority, and business days
	 * Ensures proper timing and avoids weekends and non-working days based on org hours
	 * The next follow-up date must be the next day if it's not a Sunday or if it's a work day based on the org hours
	 */
	private async calculateNextFollowUpDate(
		temperature: LeadTemperature,
		priority?: LeadPriority,
		orgRef?: string,
	): Promise<Date> {
		const now = new Date();
		
		// Start with next day (tomorrow)
		const nextDay = new Date(now);
		nextDay.setDate(nextDay.getDate() + 1);
		
		// Get the next working day based on org hours (or fallback to business day)
		const nextWorkingDay = await this.getNextWorkingDayBasedOnOrgHours(nextDay, orgRef);

		// Set appropriate follow-up time based on temperature and priority
		const followUpTime = this.calculateFollowUpTime(temperature, priority);
		nextWorkingDay.setHours(followUpTime.hours, followUpTime.minutes, 0, 0);

		this.logger.debug(
			`Next follow-up calculated: ${nextWorkingDay.toISOString()} ` +
			`(Temperature: ${temperature}, Priority: ${priority || 'MEDIUM'}, OrgRef: ${orgRef || 'none'})`
		);

		return nextWorkingDay;
	}

	/**
	 * Get the next working day based on organization hours
	 * If org hours are available, checks weeklySchedule to determine working days
	 * Falls back to Monday-Friday if no org hours are configured
	 */
	private async getNextWorkingDayBasedOnOrgHours(date: Date, orgRef?: string): Promise<Date> {
		const result = new Date(date);
		const dayOfWeek = result.getDay();

		// If it's Sunday (0), move to Monday
		if (dayOfWeek === 0) {
			result.setDate(result.getDate() + 1);
		}

		// If orgRef is provided, check organization hours
		if (orgRef) {
			try {
				const orgHours = await this.organisationHoursService.findDefault(orgRef);
				
				if (orgHours && orgHours.weeklySchedule) {
					// Check up to 7 days ahead to find the next working day
					for (let i = 0; i < 7; i++) {
						const checkDate = new Date(result);
						checkDate.setDate(result.getDate() + i);
						const checkDayOfWeek = checkDate.getDay();
						
						// Map day of week to schedule key
						const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
						const dayName = dayNames[checkDayOfWeek] as keyof typeof orgHours.weeklySchedule;
						
						// If this day is a working day according to org hours, use it
						if (orgHours.weeklySchedule[dayName]) {
							result.setDate(result.getDate() + i);
							return result;
						}
					}
					// If no working day found in 7 days, fall back to next Monday
					result.setDate(result.getDate() + (8 - dayOfWeek));
					return result;
				}
			} catch (error) {
				this.logger.warn(`Failed to get org hours for ${orgRef}: ${error.message}`);
			}
		}

		// Fallback: Ensure we land on a business day (Monday-Friday)
		if (dayOfWeek === 6) { // Saturday
			result.setDate(result.getDate() + 2); // Move to Monday
		}

		return result;
	}

	/**
	 * Get the next business day (Monday-Friday) - kept for backward compatibility
	 */
	private getNextBusinessDay(date: Date): Date {
		const result = new Date(date);
		const dayOfWeek = result.getDay();

		// If it's Saturday (6) or Sunday (0), move to Monday
		if (dayOfWeek === 6) { // Saturday
			result.setDate(result.getDate() + 2); // Move to Monday
		} else if (dayOfWeek === 0) { // Sunday
			result.setDate(result.getDate() + 1); // Move to Monday
		}

		return result;
	}

	/**
	 * Calculate appropriate follow-up time based on temperature and priority
	 */
	private calculateFollowUpTime(temperature: LeadTemperature, priority?: LeadPriority): { hours: number; minutes: number } {
		const now = new Date();
		const currentHour = now.getHours();

		// High priority leads get earlier follow-up times
		if (priority === LeadPriority.HIGH || priority === LeadPriority.CRITICAL) {
			if (temperature === LeadTemperature.HOT) {
				return { hours: 8, minutes: 0 }; // 8:00 AM - urgent hot leads
			} else {
				return { hours: 9, minutes: 0 }; // 9:00 AM - high priority
			}
		}

		// Temperature-based timing
		switch (temperature) {
			case LeadTemperature.HOT:
				return { hours: 9, minutes: 30 }; // 9:30 AM - hot leads get morning attention

			case LeadTemperature.WARM:
				// For warm leads, schedule based on current time to spread workload
				if (currentHour < 10) {
					return { hours: 10, minutes: 0 }; // 10:00 AM
				} else if (currentHour < 14) {
					return { hours: 14, minutes: 0 }; // 2:00 PM
				} else {
					return { hours: 10, minutes: 0 }; // Next day 10:00 AM
				}

			case LeadTemperature.COLD:
				return { hours: 11, minutes: 0 }; // 11:00 AM - cold leads mid-morning

			case LeadTemperature.FROZEN:
				return { hours: 15, minutes: 0 }; // 3:00 PM - frozen leads afternoon

			default:
				return { hours: 10, minutes: 0 }; // Default 10:00 AM
		}
	}

	/**
	 * Calculate deadline for tasks on next business day
	 */
	private calculateNextBusinessDayDeadline(): Date {
		const now = new Date();
		const currentHour = now.getHours();
		
		// Determine the target date
		let targetDate = new Date(now);
		
		// If it's already past 10 AM, set for next day
		if (currentHour >= 10) {
			targetDate.setDate(targetDate.getDate() + 1);
		}
		
		// Ensure we land on a business day
		const nextBusinessDay = this.getNextBusinessDay(targetDate);
		
		// Set deadline for 10 AM on the business day
		nextBusinessDay.setHours(10, 0, 0, 0);
		
		return nextBusinessDay;
	}

	/**
	 * Generate intelligent email using enhanced AI system with rich lead data
	 */
	async generateIntelligentEmail(
		leadId: number,
		templateType: string,
		customMessage?: string,
		tone?: any,
		orgId?: string,
		branchId?: number,
	): Promise<{
		success: boolean;
		email?: {
			subject: string;
			body: string;
			followUpReminder?: string;
			personalizationScore?: number;
			keyPersonalizationElements?: string[];
			alternativeSubjectLines?: string[];
			responseStrategy?: string;
		};
		message: string;
	}> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// Resolve orgId string to numeric uid if needed
			// Find organisation by Clerk org ID
			const organisation = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId },
					{ ref: orgId }
				],
				select: ['uid'],
			});

			if (!organisation) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}

			// Get the lead with all related data
			const lead = await this.leadsRepository.findOne({
				where: {
					uid: leadId,
					isDeleted: false,
					organisation: { uid: organisation.uid },
					...(branchId && { branch: { uid: branchId } }),
				},
				relations: ['owner', 'organisation', 'branch', 'interactions'],
			});

			if (!lead) {
				return {
					success: false,
					message: 'Lead not found',
				};
			}

			// Transform lead data to enhanced format for AI
			const enhancedLeadData = {
				uid: lead.uid,
				name: lead.name,
				email: lead.email,
				phone: lead.phone,
				companyName: lead.companyName,
				jobTitle: lead.jobTitle,

				// Lead qualification and scoring
				status: lead.status,
				intent: lead.intent,
				temperature: lead.temperature,
				priority: lead.priority,
				leadScore: lead.leadScore,
				userQualityRating: lead.userQualityRating,
				lifecycleStage: lead.lifecycleStage,

				// Business context
				industry: lead.industry,
				businessSize: lead.businessSize,
				decisionMakerRole: lead.decisionMakerRole,
				budgetRange: lead.budgetRange,
				purchaseTimeline: lead.purchaseTimeline,
				estimatedValue: lead.estimatedValue,

				// Communication and behavior
				source: lead.source,
				preferredCommunication: lead.preferredCommunication,
				timezone: lead.timezone,
				bestContactTime: lead.bestContactTime,
				averageResponseTime: lead.averageResponseTime,
				totalInteractions: lead.totalInteractions,
				daysSinceLastResponse: lead.daysSinceLastResponse,
				lastContactDate: lead.lastContactDate?.toISOString(),
				nextFollowUpDate: lead.nextFollowUpDate?.toISOString(),

				// Business intelligence
				painPoints: lead.painPoints ? JSON.parse(lead.painPoints) : [],
				competitorInfo: lead.competitorInfo,
				referralSource: lead.referralSource,
				campaignName: lead.campaignName,
				utmSource: lead.utmSource,
				utmMedium: lead.utmMedium,
				utmCampaign: lead.utmCampaign,

				// Activity and engagement data
				scoringData: lead.scoringData,
				activityData: lead.activityData,

				// Additional context
				notes: lead.notes,
				assignee: lead.owner?.name,
				customFields: lead.customFields,
			};

			// Set intelligent tone defaults if not provided
			const intelligentTone = tone || {
				baseTone: this.selectOptimalTone(enhancedLeadData),
				intensity: this.selectToneIntensity(enhancedLeadData),
				regionalAdaptation: 'south_african',
				industrySpecific: true,
			};

			// Prepare the AI request
			const aiRequest = {
				recipientName: lead.name || 'Valued Contact',
				recipientEmail: lead.email || '',
				leadData: enhancedLeadData,
				templateType: templateType as any,
				tone: intelligentTone,
				customMessage: customMessage,
				industryInsights: this.generateIndustryInsights(lead.industry),
				competitiveContext: lead.competitorInfo ? [`Currently evaluating: ${lead.competitorInfo}`] : [],
				urgencyFactors: this.generateUrgencyFactors(enhancedLeadData),
				businessContext: {
					marketConditions: this.generateMarketConditions(lead.industry),
					seasonalFactors: this.generateSeasonalFactors(),
				},
			};

			// Call the enhanced AI email generation API
			const response = await fetch(`${process.env.DASHBOARD_URL}/api/ai/email`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(aiRequest),
			});

			if (!response.ok) {
				throw new Error(`AI service responded with status: ${response.status}`);
			}

			const emailData = await response.json();

			return {
				success: true,
				email: {
					subject: emailData.subject,
					body: emailData.body,
					followUpReminder: emailData.followUpReminder,
					personalizationScore: emailData.personalizationScore,
					keyPersonalizationElements: emailData.keyPersonalizationElements,
					alternativeSubjectLines: emailData.alternativeSubjectLines,
					responseStrategy: emailData.responseStrategy,
				},
				message: 'Email generated successfully',
			};
		} catch (error) {
			this.logger.error(`Error generating intelligent email for lead ${leadId}: ${error.message}`, error.stack);
			return {
				success: false,
				message: `Failed to generate email: ${error.message}`,
			};
		}
	}

	/**
	 * Select optimal tone based on lead intelligence
	 */
	private selectOptimalTone(leadData: any): string {
		// High-score or hot leads get more confident approach
		if (leadData.temperature === 'HOT' || (leadData.leadScore && leadData.leadScore > 80)) {
			return leadData.decisionMakerRole === 'CEO' || leadData.decisionMakerRole === 'OWNER'
				? 'authoritative'
				: 'results-driven';
		}

		// Technical decision makers prefer consultative approach
		if (leadData.decisionMakerRole === 'CTO' || leadData.industry === 'TECHNOLOGY') {
			return 'consultative';
		}

		// Financial decision makers prefer data-driven approach
		if (leadData.decisionMakerRole === 'CFO' || leadData.industry === 'FINANCE') {
			return 'results-driven';
		}

		// Educational approach for early-stage leads
		if (leadData.temperature === 'COLD' || leadData.lifecycleStage === 'LEAD') {
			return 'educational';
		}

		return 'collaborative';
	}

	/**
	 * Select tone intensity based on lead characteristics
	 */
	private selectToneIntensity(leadData: any): string {
		if (leadData.temperature === 'HOT' && leadData.priority === 'HIGH') {
			return 'strong';
		} else if (leadData.temperature === 'WARM' || leadData.priority === 'MEDIUM') {
			return 'moderate';
		}
		return 'subtle';
	}

	/**
	 * Generate industry-specific insights
	 */
	private generateIndustryInsights(industry?: string): string[] {
		const insights: Record<string, string[]> = {
			TECHNOLOGY: [
				'Digital transformation acceleration in SA market',
				'Cybersecurity and data protection priorities',
				'Cloud adoption and skills shortage challenges',
			],
			HEALTHCARE: [
				'Healthcare digitization trends',
				'Telemedicine and patient data security',
				'Cost optimization and efficiency improvements',
			],
			FINANCE: [
				'Fintech disruption and digital banking',
				'Regulatory compliance (POPIA, Basel III)',
				'Customer experience transformation',
			],
			RETAIL: [
				'Omnichannel retail evolution',
				'Supply chain optimization',
				'Customer data analytics and personalization',
			],
			MANUFACTURING: [
				'Industry 4.0 and smart manufacturing',
				'Supply chain resilience',
				'Sustainability and carbon reduction',
			],
			MINING: [
				'Safety technology and compliance',
				'Operational efficiency optimization',
				'Environmental impact management',
			],
		};

		return (
			insights[industry as string] || [
				'Digital transformation opportunities',
				'Operational efficiency improvements',
				'Competitive advantage enhancement',
			]
		);
	}

	/**
	 * Generate urgency factors based on lead data
	 */
	private generateUrgencyFactors(leadData: any): string[] {
		const factors: string[] = [];

		if (leadData.temperature === 'HOT') {
			factors.push('High-interest lead requiring immediate attention');
		}

		if (leadData.purchaseTimeline === 'IMMEDIATE') {
			factors.push('Immediate purchase timeline');
		} else if (leadData.purchaseTimeline === 'SHORT_TERM') {
			factors.push('Short-term purchase timeline (1-4 weeks)');
		}

		if (leadData.daysSinceLastResponse && leadData.daysSinceLastResponse > 7) {
			factors.push('Extended period since last contact');
		}

		if (leadData.competitorInfo) {
			factors.push('Actively considering competitive solutions');
		}

		if (leadData.budgetRange && ['OVER_1M', 'R500K_1M'].includes(leadData.budgetRange)) {
			factors.push('High-value opportunity');
		}

		return factors;
	}

	/**
	 * Generate market conditions based on industry
	 */
	private generateMarketConditions(industry?: string): string[] {
		const conditions: Record<string, string[]> = {
			RETAIL: ['Consumer spending pressure', 'Supply chain challenges'],
			MANUFACTURING: ['Raw material cost inflation', 'Skills shortage'],
			TECHNOLOGY: ['Digital acceleration', 'Cybersecurity concerns'],
			FINANCE: ['Regulatory changes', 'Digital disruption'],
			HEALTHCARE: ['Healthcare transformation', 'Cost pressures'],
			MINING: ['Commodity price volatility', 'Environmental regulations'],
		};

		return conditions[industry as string] || ['Economic uncertainty', 'Digital transformation pressure'];
	}

	/**
	 * Generate seasonal factors
	 */
	private generateSeasonalFactors(): string[] {
		const currentMonth = new Date().getMonth();
		if (currentMonth >= 10 || currentMonth <= 1) {
			return ['Year-end budget considerations', 'Holiday season planning'];
		} else if (currentMonth >= 2 && currentMonth <= 4) {
			return ['New year implementation planning', 'Q1 priority setting'];
		}
		return ['Mid-year review and planning', 'Summer business cycles'];
	}

	/**
	 * Update lead status with enhanced automatic temperature adjustment
	 * Enhanced with status validation and velocity-based scoring
	 */
	async updateLeadStatus(
		id: number,
		status: LeadStatus,
		reason?: string,
		description?: string,
		nextStep?: string,
	): Promise<Lead> {
		const result = await this.findOne(id);
		if (!result.lead) {
			throw new NotFoundException(`Lead with ID ${id} not found`);
		}

		const lead = result.lead;

		// Store previous values for comparison
		const previousStatus = lead.status;
		const previousTemperature = lead.temperature;

		// Update the lead status
		lead.status = status;
		lead.updatedAt = new Date();

		// Enhanced status-aware temperature adjustment with velocity intelligence
		await this.updateTemperatureBasedOnStatus(lead, previousStatus);

		// Recalculate scores with new status and temperature
		await this.leadScoringService.calculateLeadScore(id);
		await this.leadScoringService.updateActivityData(id);

		// Update audit trail - removing non-existent properties
		// Note: Lead entity doesn't have reason, description, nextStep properties
		// These would need to be tracked in a separate audit/history table

		const savedLead = await this.leadsRepository.save(lead);

		// Log significant changes
		if (previousStatus !== status || previousTemperature !== lead.temperature) {
			this.logger.log(
				`Lead ${id} status updated: ${previousStatus} → ${status}, ` +
					`temperature: ${previousTemperature} → ${lead.temperature}, ` +
					`score: ${lead.leadScore || 0}`,
			);
		}

		return savedLead;
	}

	/**
	 * Enhanced temperature adjustment based on status and velocity intelligence
	 */
	private async updateTemperatureBasedOnStatus(lead: Lead, previousStatus?: LeadStatus): Promise<void> {
		const currentScore = lead.leadScore || 0;
		const now = new Date();
		const statusChangeTime =
			previousStatus && previousStatus !== lead.status
				? (now.getTime() - new Date(lead.updatedAt).getTime()) / (1000 * 60 * 60) // Hours since last update
				: 0;

		// Status-based temperature rules with velocity intelligence
		switch (lead.status) {
			case LeadStatus.APPROVED:
				// APPROVED leads cannot be COLD or FROZEN
				if (lead.temperature === LeadTemperature.COLD || lead.temperature === LeadTemperature.FROZEN) {
					// Determine new temperature based on score and velocity
					if (currentScore >= 70 || statusChangeTime <= 24) {
						// High score or fast progression
						lead.temperature = LeadTemperature.HOT;
					} else {
						lead.temperature = LeadTemperature.WARM;
					}
				}
				// If already HOT/WARM, maintain or upgrade based on velocity
				else if (statusChangeTime <= 6) {
					// Very fast approval (within 6 hours)
					lead.temperature = LeadTemperature.HOT;
				}
				break;

			case LeadStatus.CONVERTED:
				// CONVERTED leads must be HOT (they completed the journey)
				lead.temperature = LeadTemperature.HOT;
				break;

			case LeadStatus.REVIEW:
				// REVIEW status with scoring-based temperature
				if (currentScore >= 80) {
					lead.temperature = LeadTemperature.HOT;
				} else if (currentScore >= 60) {
					lead.temperature = LeadTemperature.WARM;
				} else if (currentScore >= 40) {
					lead.temperature = LeadTemperature.COLD;
				} else {
					lead.temperature = LeadTemperature.FROZEN;
				}
				break;

			case LeadStatus.PENDING:
				// PENDING leads get temperature based on score and velocity
				if (statusChangeTime > 0) {
					// Status just changed
					if (statusChangeTime <= 2) {
						// Very recent activity
						lead.temperature =
							lead.temperature && lead.temperature > LeadTemperature.COLD
								? lead.temperature
								: LeadTemperature.WARM;
					} else if (statusChangeTime > 168) {
						// Over a week old
						lead.temperature = LeadTemperature.COLD;
					}
				}
				// Adjust based on score if no recent status change
				if (currentScore >= 75) {
					lead.temperature = LeadTemperature.HOT;
				} else if (currentScore >= 50) {
					lead.temperature = LeadTemperature.WARM;
				} else if (currentScore >= 25) {
					lead.temperature = LeadTemperature.COLD;
				} else {
					lead.temperature = LeadTemperature.FROZEN;
				}
				break;

			case LeadStatus.DECLINED:
			case LeadStatus.CANCELLED:
				// Declined/cancelled leads cool down over time but may have potential
				if (currentScore >= 60) {
					lead.temperature = LeadTemperature.COLD; // Still has potential
				} else {
					lead.temperature = LeadTemperature.FROZEN;
				}
				break;

			default:
				// For any other status, use score-based assignment
				if (currentScore >= 75) {
					lead.temperature = LeadTemperature.HOT;
				} else if (currentScore >= 50) {
					lead.temperature = LeadTemperature.WARM;
				} else if (currentScore >= 25) {
					lead.temperature = LeadTemperature.COLD;
				} else {
					lead.temperature = LeadTemperature.FROZEN;
				}
				break;
		}

		// Additional velocity-based adjustments
		await this.applyVelocityBasedTemperatureAdjustments(lead, statusChangeTime);
	}

	/**
	 * Apply velocity-based temperature adjustments
	 */
	private async applyVelocityBasedTemperatureAdjustments(lead: Lead, statusChangeTime: number): Promise<void> {
		// Get recent interactions for velocity analysis
		const recentInteractions = await this.interactionRepository.find({
			where: {
				lead: { uid: lead.uid },
				createdAt: MoreThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // Last 7 days
			},
			order: { createdAt: 'DESC' },
		});

		const interactionVelocity = recentInteractions.length;

		// Very fast progression (status change within hours) = HOT boost
		if (statusChangeTime > 0 && statusChangeTime <= 6 && lead.temperature !== LeadTemperature.HOT) {
			if (lead.status === LeadStatus.APPROVED || lead.status === LeadStatus.REVIEW) {
				lead.temperature = LeadTemperature.HOT;
			}
		}

		// High interaction velocity = temperature boost
		if (interactionVelocity >= 5 && lead.temperature === LeadTemperature.COLD) {
			lead.temperature = LeadTemperature.WARM;
		} else if (interactionVelocity >= 8 && lead.temperature === LeadTemperature.WARM) {
			lead.temperature = LeadTemperature.HOT;
		}

		// Very slow progression (status unchanged for too long) = cooling down
		const daysSinceUpdate = Math.floor(
			(new Date().getTime() - new Date(lead.updatedAt).getTime()) / (24 * 60 * 60 * 1000),
		);

		if (daysSinceUpdate > 14 && lead.temperature === LeadTemperature.HOT) {
			lead.temperature = LeadTemperature.WARM;
		} else if (daysSinceUpdate > 30 && lead.temperature === LeadTemperature.WARM) {
			lead.temperature = LeadTemperature.COLD;
		} else if (daysSinceUpdate > 60 && lead.temperature === LeadTemperature.COLD) {
			lead.temperature = LeadTemperature.FROZEN;
		}
	}

	/**
	 * Enhanced bulk temperature update with velocity-aware logic
	 */
	async updateLeadTemperatures(): Promise<void> {
		this.logger.log('Starting enhanced bulk temperature update...');

		const leads = await this.leadsRepository.find({
			where: { isDeleted: false },
			relations: ['interactions'],
		});

		let updated = 0;
		for (const lead of leads) {
			try {
				const originalTemperature = lead.temperature;

				// Recalculate score first
				await this.leadScoringService.calculateLeadScore(lead.uid);

				// Update temperature based on current status and score
				await this.updateTemperatureBasedOnStatus(lead);

				if (originalTemperature !== lead.temperature) {
					await this.leadsRepository.save(lead);
					updated++;

					this.logger.debug(
						`Lead ${lead.uid} temperature updated: ${originalTemperature} → ${lead.temperature} ` +
							`(Status: ${lead.status}, Score: ${lead.leadScore || 0})`,
					);
				}
			} catch (error) {
				this.logger.error(`Failed to update temperature for lead ${lead.uid}: ${error.message}`);
			}
		}

		this.logger.log(`Completed bulk temperature update. Updated ${updated}/${leads.length} leads.`);
	}

	/**
	 * Enhanced automatic lead processing with velocity intelligence
	 */
	async processLeadAutomatically(leadId: number): Promise<Lead> {
		const lead = await this.findOne(leadId);
		if (!lead.lead) {
			throw new NotFoundException(`Lead with ID ${leadId} not found`);
		}

		// Calculate current scores and activity data
		await this.leadScoringService.calculateLeadScore(leadId);
		await this.leadScoringService.updateActivityData(leadId);

		// Refresh lead data with updated scores
		const updatedLead = await this.findOne(leadId);
		const currentScore = updatedLead.lead?.leadScore || 0;

		// Enhanced status progression logic with velocity awareness
		let shouldUpdateStatus = false;
		let newStatus = updatedLead.lead.status;
		let autoReason = '';

		// Get velocity metrics
		const daysSinceCreation = Math.floor(
			(new Date().getTime() - new Date(updatedLead.lead.createdAt).getTime()) / (24 * 60 * 60 * 1000),
		);
		const daysSinceUpdate = Math.floor(
			(new Date().getTime() - new Date(updatedLead.lead.updatedAt).getTime()) / (24 * 60 * 60 * 1000),
		);

		switch (updatedLead.lead.status) {
			case LeadStatus.PENDING:
				// High-scoring leads with good velocity should move to REVIEW
				if (currentScore >= 70 && daysSinceCreation <= 3) {
					newStatus = LeadStatus.REVIEW;
					autoReason = `High score (${currentScore}) with fast initial response`;
					shouldUpdateStatus = true;
				} else if (currentScore >= 80) {
					newStatus = LeadStatus.REVIEW;
					autoReason = `Exceptional score (${currentScore}) warrants review`;
					shouldUpdateStatus = true;
				}
				break;

			case LeadStatus.REVIEW:
				// Very high-scoring leads in review should be auto-approved if velocity is good
				if (currentScore >= 85 && daysSinceUpdate <= 2) {
					newStatus = LeadStatus.APPROVED;
					autoReason = `Exceptional score (${currentScore}) with fast progression`;
					shouldUpdateStatus = true;
				} else if (currentScore < 40 && daysSinceUpdate >= 7) {
					// Low-scoring leads stagnating in review should be declined
					newStatus = LeadStatus.DECLINED;
					autoReason = `Low score (${currentScore}) with slow progression`;
					shouldUpdateStatus = true;
				}
				break;

			case LeadStatus.APPROVED:
				// Approved leads with declining performance should be flagged for review
				if (currentScore < 30 && daysSinceUpdate >= 14) {
					newStatus = LeadStatus.REVIEW;
					autoReason = `Score degradation (${currentScore}) requires re-evaluation`;
					shouldUpdateStatus = true;
				}
				break;
		}

		// Apply status update if needed
		if (shouldUpdateStatus) {
			await this.updateLeadStatus(
				leadId,
				newStatus,
				autoReason,
				`Automated processing based on score ${currentScore} and velocity analysis`,
				this.getAutomatedNextStep(newStatus, currentScore),
			);

			this.logger.log(`Lead ${leadId} auto-processed: ${updatedLead.lead.status} → ${newStatus}. ${autoReason}`);
		} else {
			// Even if status doesn't change, update temperature based on current score
			await this.updateTemperatureBasedOnStatus(updatedLead.lead);
			await this.leadsRepository.save(updatedLead.lead);
		}

		return updatedLead.lead;
	}

	/**
	 * Get automated next step based on new status and score
	 */
	private getAutomatedNextStep(status: LeadStatus, score: number): string {
		switch (status) {
			case LeadStatus.REVIEW:
				return score >= 80
					? 'Priority review - consider for immediate approval'
					: 'Standard review process - validate lead quality';
			case LeadStatus.APPROVED:
				return score >= 85
					? 'Immediate outreach - high-priority prospect'
					: 'Schedule follow-up within 48 hours';
			case LeadStatus.DECLINED:
				return 'Lead declined due to low engagement - consider for nurture campaign';
			default:
				return 'Continue monitoring lead progress';
		}
	}

	/**
	 * Enhanced batch processing with velocity intelligence
	 */
	async batchProcessLeads(): Promise<void> {
		this.logger.log('Starting enhanced batch lead processing...');

		const leads = await this.leadsRepository.find({
			where: {
				isDeleted: false,
				status: In([LeadStatus.PENDING, LeadStatus.REVIEW, LeadStatus.APPROVED]),
			},
			order: { leadScore: 'DESC' }, // Process highest-scoring leads first
		});

		let processed = 0;
		for (const lead of leads) {
			try {
				await this.processLeadAutomatically(lead.uid);
				processed++;

				if (processed % 50 === 0) {
					this.logger.log(`Processed ${processed}/${leads.length} leads`);
				}
			} catch (error) {
				this.logger.error(`Failed to process lead ${lead.uid}: ${error.message}`);
			}
		}

		this.logger.log(`Completed batch processing. Processed ${processed}/${leads.length} leads.`);
	}
}
