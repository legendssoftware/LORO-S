/**
 * JournalService - Comprehensive Journal Management Service
 *
 * This service handles all journal-related operations including:
 * - Journal CRUD operations with organization and branch scoping
 * - Inspection journal creation and management
 * - Journal scoring and validation
 * - End-of-shift logging and reporting
 * - Advanced caching and performance optimization
 * - Journal metrics and analytics calculation
 *
 * Features:
 * - Multi-tenant support with organization and branch isolation
 * - Redis caching for improved performance
 * - Event-driven architecture for real-time updates
 * - Comprehensive logging and error handling
 * - Role-based access control (RBAC) integration
 * - Inspection templates and scoring system
 * - Email notification integration
 *
 * @author Loro Development Team
 * @version 1.0.0
 * @since 1.0.0
 */

import { Injectable, NotFoundException, Logger, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Journal } from './entities/journal.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { NotificationType, NotificationStatus } from '../lib/enums/notification.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { JournalStatus, JournalType, InspectionRating, InspectionFormData, InspectionCategory, InspectionItem } from '../lib/enums/journal.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { endOfDay, startOfDay } from 'date-fns';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES, XP_VALUES_TYPES } from '../lib/constants/constants';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JournalService {
	private readonly logger = new Logger(JournalService.name);
	private readonly CACHE_PREFIX = 'journals:';
	private readonly CACHE_TTL: number;
	private readonly activeCalculations = new Map<number, Promise<void>>();

	constructor(
		@InjectRepository(Journal)
		private journalRepository: Repository<Journal>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		private readonly eventEmitter: EventEmitter2,
		private readonly rewardsService: RewardsService,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		private readonly dataSource: DataSource,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
		this.logger.log('JournalService initialized with cache TTL: ' + this.CACHE_TTL + 'ms');
	}

	/**
	 * Find organisation by Clerk org ID (string) or ref
	 * Returns the organisation entity with its uid for database operations
	 */
	private async findOrganisationByClerkId(orgId?: string): Promise<Organisation | null> {
		if (!orgId) {
			return null;
		}

		const organisation = await this.organisationRepository.findOne({
			where: [
				{ clerkOrgId: orgId },
				{ ref: orgId }
			],
			select: ['uid', 'clerkOrgId', 'ref'],
		});

		return organisation;
	}

	/**
	 * Generate cache key with consistent prefix
	 * @param key - The key identifier (uid, clientRef, etc.)
	 * @returns Formatted cache key with prefix
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Get cache key for journal lists with filters
	 * @param filters - Filter parameters
	 * @param page - Page number
	 * @param limit - Limit per page
	 * @param orgId - Organization ID
	 * @param branchId - Branch ID
	 * @returns Formatted cache key for filtered lists
	 */
	private getListCacheKey(filters: any, page: number, limit: number, orgId?: string, branchId?: number): string {
		const filterString = JSON.stringify(filters || {});
		return `${this.CACHE_PREFIX}list:${orgId || 'all'}:${branchId || 'all'}:${page}:${limit}:${Buffer.from(filterString).toString('base64')}`;
	}

	/**
	 * Invalidate journal-related cache entries
	 * @param journal - Journal entity to invalidate cache for
	 */
	private async invalidateJournalCache(journal: Journal): Promise<void> {
		try {
			const cacheKeys = [
				this.getCacheKey(journal.uid),
				this.getCacheKey(`client:${journal.clientRef}`),
				`${this.CACHE_PREFIX}list:*`,
				`${this.CACHE_PREFIX}user:${journal.owner?.uid}:*`,
				`${this.CACHE_PREFIX}inspection:*`,
			];

			for (const key of cacheKeys) {
				if (key.includes('*')) {
					// For wildcard patterns, we need to get and delete matching keys
					continue; // Skip wildcard for now, implement if cache store supports pattern deletion
				}
				await this.cacheManager.del(key);
			}

		} catch (error) {
			this.logger.warn(`Failed to invalidate cache for journal ${journal.uid}: ${error.message}`);
		}
	}

	/**
	 * Calculate basic statistics for journals
	 * @param journals - Array of journal entities
	 * @returns Statistics object
	 */
	private calculateStats(journals: Journal[]): {
		total: number;
		byStatus: Record<string, number>;
		byType: Record<string, number>;
		averageScore?: number;
	} {
		const stats: {
			total: number;
			byStatus: Record<string, number>;
			byType: Record<string, number>;
			averageScore?: number;
		} = {
			total: journals?.length || 0,
			byStatus: {} as Record<string, number>,
			byType: {} as Record<string, number>,
		};

		if (!journals?.length) return stats;

		// Count by status
		journals.forEach(journal => {
			stats.byStatus[journal.status] = (stats.byStatus[journal.status] || 0) + 1;
			stats.byType[journal.type] = (stats.byType[journal.type] || 0) + 1;
		});

		// Calculate average score for inspections
		const inspections = journals.filter(j => j.type === JournalType.INSPECTION && j.percentage);
		if (inspections.length > 0) {
			stats.averageScore = inspections.reduce((sum, j) => sum + (j.percentage || 0), 0) / inspections.length;
		}

		return stats;
	}

	/**
	 * Create a new journal entry with comprehensive logging and caching
	 * @param createJournalDto - Data for creating the journal
	 * @param orgId - Organization ID for scoping
	 * @param branchId - Branch ID for scoping
	 * @returns Success message or error
	 */
	async create(createJournalDto: CreateJournalDto, orgId?: string, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(
			`Creating journal entry for ${createJournalDto.owner?.uid ? `user: ${createJournalDto.owner.uid}` : 'unknown user'} ${
				orgId ? `in org: ${orgId}` : ''
			} ${branchId ? `in branch: ${branchId}` : ''} with type: ${createJournalDto.type || 'GENERAL'}`
		);

		try {
			// Validate required fields
			if (!createJournalDto.owner?.uid) {
				this.logger.error('Journal creation failed: Missing owner information');
				throw new BadRequestException('Owner information is required');
			}

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (!organisation) {
					this.logger.error(`Organization not found for Clerk ID: ${orgId}`);
					throw new BadRequestException(`Organisation not found for ID: ${orgId}`);
				}
				organisationUid = organisation.uid;
			}

			// Add organization and branch information
			const journalData = {
				...createJournalDto,
				organisation: organisationUid ? { uid: organisationUid } : undefined,
				branch: branchId ? { uid: branchId } : undefined,
			};

			// Use transaction for data consistency
			const journal = await this.dataSource.transaction(async manager => {
				const savedJournal = await manager.save(Journal, journalData);
				
				if (!savedJournal) {
					this.logger.error('Failed to save journal - repository returned null');
					throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
				}

				return savedJournal;
			});

			const executionTime = Date.now() - startTime;
			this.logger.log(`Journal created successfully with ID: ${journal.uid} in ${executionTime}ms`);

			// Invalidate relevant cache entries
			await this.invalidateJournalCache(journal);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			// Send notification
			const notification = {
				type: NotificationType.USER,
				title: 'Journal Entry Created',
				message: `A new journal entry has been created by ${createJournalDto.owner || 'user'}`,
				status: NotificationStatus.UNREAD,
				owner: journal?.owner,
			};

			const recipients = [
				AccessLevel.ADMIN,
				AccessLevel.MANAGER,
				AccessLevel.OWNER,
				AccessLevel.SUPERVISOR,
				AccessLevel.USER,
			];

			this.eventEmitter.emit('send.notification', notification, recipients);

			// Award XP for journal creation
			try {
				await this.rewardsService.awardXP({
					owner: createJournalDto.owner.uid,
					amount: XP_VALUES.CREATE_JOURNAL || 10,
					action: 'JOURNAL_CREATION',
					source: {
						id: journal.uid.toString(),
						type: 'journal',
						details: `Journal entry created: ${journal.title || 'Untitled'}`,
					},
				}, orgId, branchId);
				this.logger.log(`XP awarded for journal creation to user: ${createJournalDto.owner.uid}`);
			} catch (xpError) {
				this.logger.warn(`Failed to award XP for journal creation: ${xpError.message}`);
			}

			return response;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Error creating journal after ${executionTime}ms: ${error.message}`, error.stack);
			
			return {
				message: error?.message || 'Failed to create journal entry',
			};
		}
	}

	/**
	 * Find all journals with filters, pagination, and caching
	 * Includes comprehensive logging and performance monitoring
	 * @param filters - Optional filters for journal search
	 * @param page - Page number for pagination
	 * @param limit - Number of items per page
	 * @param orgId - Organization ID for scoping
	 * @param branchId - Branch ID for scoping
	 * @returns Paginated response with journals
	 */
	async findAll(
		filters?: {
			status?: JournalStatus;
			authorId?: number;
			startDate?: Date;
			endDate?: Date;
			search?: string;
			categoryId?: number;
			type?: JournalType;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
		orgId?: string,
		branchId?: number,
	): Promise<PaginatedResponse<Journal>> {
		const startTime = Date.now();
		this.logger.log(
			`Finding journals with filters: ${JSON.stringify(filters)} ${orgId ? `in org: ${orgId}` : ''} ${
				branchId ? `in branch: ${branchId}` : ''
			} - Page: ${page}, Limit: ${limit}`
		);

		try {
			// Check cache first
			const cacheKey = this.getListCacheKey(filters, page, limit, orgId, branchId);
			const cachedResult = await this.cacheManager.get<PaginatedResponse<Journal>>(cacheKey);
			
			if (cachedResult) {
				const executionTime = Date.now() - startTime;
				this.logger.log(`Journals retrieved from cache in ${executionTime}ms - Found: ${cachedResult.meta.total} journals`);
				return cachedResult;
			}

			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.branch', 'branch')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.where('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			// Apply filters
			if (filters?.status) {
				queryBuilder.andWhere('journal.status = :status', { status: filters.status });
			}

			if (filters?.type) {
				queryBuilder.andWhere('journal.type = :type', { type: filters.type });
			}

			if (filters?.authorId) {
				queryBuilder.andWhere('owner.uid = :authorId', { authorId: filters.authorId });
			}

			if (filters?.startDate && filters?.endDate) {
				queryBuilder.andWhere('journal.createdAt BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});
			}

			if (filters?.search) {
				queryBuilder.andWhere(
					'(journal.clientRef ILIKE :search OR journal.comments ILIKE :search OR journal.title ILIKE :search OR owner.name ILIKE :search)',
					{ search: `%${filters.search}%` },
				);
			}

			// Add pagination and ordering
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('journal.createdAt', 'DESC')
				.addOrderBy('journal.uid', 'DESC');

			const [journals, total] = await queryBuilder.getManyAndCount();

			const executionTime = Date.now() - startTime;
			this.logger.log(`Database query completed in ${executionTime}ms - Found: ${total} journals`);

			if (!journals || journals.length === 0) {
				// No journals found
			}

			const result: PaginatedResponse<Journal> = {
				data: journals || [],
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};

			// Cache the result
			try {
				await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);
			} catch (cacheError) {
				this.logger.warn(`Failed to cache journals list: ${cacheError.message}`);
			}

			return result;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Error finding journals after ${executionTime}ms: ${error.message}`, error.stack);
			
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message || 'Failed to retrieve journals',
			};
		}
	}

	/**
	 * Find a single journal by ID with optional organization and branch scoping
	 * Includes caching for improved performance and comprehensive logging
	 * @param ref - Journal ID to search for
	 * @param orgId - Optional organization ID for scoping
	 * @param branchId - Optional branch ID for scoping
	 * @returns Journal data with stats or null with message
	 */
	async findOne(
		ref: number,
		orgId?: string,
		branchId?: number,
	): Promise<{ message: string; journal: Journal | null; stats: any }> {
		const startTime = Date.now();
		this.logger.log(
			`Finding journal: ${ref} ${orgId ? `in org: ${orgId}` : ''} ${
				branchId ? `in branch: ${branchId}` : ''
			}`
		);

		try {
			const cacheKey = this.getCacheKey(ref);
			this.logger.debug(`Checking cache for journal: ${ref}`);
			const cachedJournal = await this.cacheManager.get<Journal>(cacheKey);

			if (cachedJournal) {
				// If org/branch filters are provided, verify cached journal belongs to them
				if (orgId && cachedJournal.organisation?.uid !== orgId) {
					this.logger.warn(`Journal ${ref} found in cache but doesn't belong to org ${orgId}`);
					return {
						message: process.env.NOT_FOUND_MESSAGE,
						journal: null,
						stats: null,
					};
				}
				if (branchId && cachedJournal.branch?.uid !== branchId) {
					this.logger.warn(`Journal ${ref} found in cache but doesn't belong to branch ${branchId}`);
					return {
						message: process.env.NOT_FOUND_MESSAGE,
						journal: null,
						stats: null,
					};
				}

				const executionTime = Date.now() - startTime;
				this.logger.log(`Journal ${ref} retrieved from cache in ${executionTime}ms`);

				// Find organisation by Clerk org ID if provided (for stats)
				let statsOrganisationUid: number | undefined;
				if (orgId) {
					const organisation = await this.findOrganisationByClerkId(orgId);
					if (organisation) {
						statsOrganisationUid = organisation.uid;
					}
				}

				// Get stats (this could also be cached separately if needed)
				const statsKey = `${this.CACHE_PREFIX}stats:${statsOrganisationUid || orgId || 'all'}:${branchId || 'all'}`;
				let stats = await this.cacheManager.get(statsKey);
				
				if (!stats) {
					const statsQueryBuilder = this.journalRepository
						.createQueryBuilder('journal')
						.leftJoinAndSelect('journal.organisation', 'organisation')
						.leftJoinAndSelect('journal.branch', 'branch')
						.where('journal.isDeleted = :isDeleted', { isDeleted: false });

					if (statsOrganisationUid) {
						statsQueryBuilder.andWhere('organisation.uid = :orgId', { orgId: statsOrganisationUid });
					}
					if (branchId) {
						statsQueryBuilder.andWhere('branch.uid = :branchId', { branchId });
					}

					const allJournals = await statsQueryBuilder.getMany();
					stats = this.calculateStats(allJournals);
					
					// Cache stats for shorter time
					await this.cacheManager.set(statsKey, stats, Math.floor(this.CACHE_TTL / 2));
				}

				return {
					journal: cachedJournal,
					message: process.env.SUCCESS_MESSAGE,
					stats,
				};
			}

			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('journal.uid = :ref', { ref })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const journal = await queryBuilder.getOne();
			const executionTime = Date.now() - startTime;

			if (!journal) {
				this.logger.warn(`Journal ${ref} not found after ${executionTime}ms`);
				return {
					message: process.env.NOT_FOUND_MESSAGE,
					journal: null,
					stats: null,
				};
			}

			this.logger.log(`Journal ${ref} found in database in ${executionTime}ms`);

			// Cache the journal
			try {
				await this.cacheManager.set(cacheKey, journal, this.CACHE_TTL);
				this.logger.debug(`Journal ${ref} cached with key: ${cacheKey}`);
			} catch (cacheError) {
				this.logger.warn(`Failed to cache journal ${ref}: ${cacheError.message}`);
			}

			// Get stats with organization/branch filtering
			const statsKey = `${this.CACHE_PREFIX}stats:${orgId || 'all'}:${branchId || 'all'}`;
			let stats = await this.cacheManager.get(statsKey);
			
			if (!stats) {
				const statsQueryBuilder = this.journalRepository
					.createQueryBuilder('journal')
					.leftJoinAndSelect('journal.organisation', 'organisation')
					.leftJoinAndSelect('journal.branch', 'branch')
					.where('journal.isDeleted = :isDeleted', { isDeleted: false });

				if (organisationUid) {
					statsQueryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
				}
				if (branchId) {
					statsQueryBuilder.andWhere('branch.uid = :branchId', { branchId });
				}

				const allJournals = await statsQueryBuilder.getMany();
				stats = this.calculateStats(allJournals);
				
				// Cache stats for shorter time
				await this.cacheManager.set(statsKey, stats, Math.floor(this.CACHE_TTL / 2));
			}

			return {
				journal,
				message: process.env.SUCCESS_MESSAGE,
				stats,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Error finding journal ${ref} after ${executionTime}ms: ${error.message}`, error.stack);
			
			return {
				message: error?.message || 'Failed to retrieve journal',
				journal: null,
				stats: null,
			};
		}
	}

	public async journalsByUser(
		ref: number,
		orgId?: string,
		branchId?: number,
	): Promise<{ message: string; journals: Journal[]; stats: { total: number } }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('owner.uid = :ref', { ref })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const journals = await queryBuilder.getMany();

			if (!journals) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const stats = this.calculateStats(journals);

			return {
				message: process.env.SUCCESS_MESSAGE,
				journals,
				stats,
			};
		} catch (error) {
			return {
				message: `could not get journals by user - ${error?.message}`,
				journals: null,
				stats: null,
			};
		}
	}

	async getJournalsForDate(
		date: Date,
		orgId?: string,
		branchId?: number,
	): Promise<{ message: string; journals: Journal[] }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('journal.createdAt BETWEEN :startOfDay AND :endOfDay', {
					startOfDay: startOfDay(date),
					endOfDay: endOfDay(date),
				});

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const journals = await queryBuilder.getMany();

			if (!journals) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				journals,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				journals: null,
			};

			return response;
		}
	}

	/**
	 * Update a journal entry with comprehensive validation and caching
	 * Includes comprehensive logging, cache invalidation, and performance monitoring
	 * @param ref - Journal ID to update
	 * @param updateJournalDto - Data for updating the journal
	 * @param orgId - Organization ID for scoping
	 * @param branchId - Branch ID for scoping
	 * @returns Success message or error
	 */
	async update(ref: number, updateJournalDto: UpdateJournalDto, orgId?: string, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(
			`Updating journal: ${ref} ${orgId ? `in org: ${orgId}` : ''} ${
				branchId ? `in branch: ${branchId}` : ''
			} with fields: ${Object.keys(updateJournalDto).join(', ')}`
		);
		this.logger.debug(`Update journal DTO: ${JSON.stringify(updateJournalDto, null, 2)}`);

		try {
			// First verify the journal exists and belongs to the org/branch
			const journalResult = await this.findOne(ref, orgId, branchId);

			if (!journalResult || !journalResult.journal) {
				this.logger.warn(`Journal ${ref} not found for update - orgId: ${orgId}, branchId: ${branchId}`);
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const originalJournal = journalResult.journal;
			this.logger.debug(`Found journal to update: ${originalJournal.uid} - Title: "${originalJournal.title || 'Untitled'}"`);

			// Validate update data
			if (Object.keys(updateJournalDto).length === 0) {
				this.logger.warn(`No fields provided for journal ${ref} update`);
				throw new BadRequestException('No fields provided for update');
			}

			// Use transaction for data consistency
			const updateResult = await this.dataSource.transaction(async manager => {
				const result = await manager.update(Journal, ref, updateJournalDto);
				
				if (result.affected === 0) {
					this.logger.warn(`No rows affected when updating journal ${ref}`);
					throw new NotFoundException('Journal not found or no changes made');
				}

				return result;
			});

			const executionTime = Date.now() - startTime;
			this.logger.log(`Journal ${ref} updated successfully in ${executionTime}ms - Affected rows: ${updateResult.affected}`);

			// Invalidate relevant cache entries
			await this.invalidateJournalCache(originalJournal);

			// Send notification about the update
			const notification = {
				type: NotificationType.USER,
				title: 'Journal Entry Updated',
				message: `Journal entry "${originalJournal.title || 'Untitled'}" has been updated`,
				status: NotificationStatus.UNREAD,
				owner: originalJournal?.owner,
			};

			const recipients = [
				AccessLevel.ADMIN,
				AccessLevel.MANAGER,
				AccessLevel.OWNER,
				AccessLevel.SUPERVISOR,
				AccessLevel.USER,
			];

			this.eventEmitter.emit('send.notification', notification, recipients);

			// Award XP for journal update (smaller amount than creation)
			try {
				const ownerUid = updateJournalDto.owner?.uid || originalJournal.owner?.uid;
				if (ownerUid) {
					await this.rewardsService.awardXP({
						owner: ownerUid,
						amount: Math.floor(XP_VALUES.JOURNAL / 2) || 5, // Half XP for updates
						action: 'JOURNAL_UPDATE',
						source: {
							id: ref.toString(),
							type: 'journal',
							details: `Journal entry updated: ${originalJournal.title || 'Untitled'}`,
						},
					}, orgId, branchId);
					this.logger.log(`XP awarded for journal update to user: ${ownerUid}`);
				}
			} catch (xpError) {
				this.logger.warn(`Failed to award XP for journal update: ${xpError.message}`);
			}

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Error updating journal ${ref} after ${executionTime}ms: ${error.message}`, error.stack);
			
			return {
				message: error?.message || 'Failed to update journal entry',
			};
		}
	}

	/**
	 * Soft delete a journal entry with comprehensive validation and caching
	 * Includes comprehensive logging, cache invalidation, and audit trail
	 * @param ref - Journal ID to delete
	 * @param orgId - Organization ID for scoping
	 * @param branchId - Branch ID for scoping
	 * @returns Success message or error
	 */
	async remove(ref: number, orgId?: string, branchId?: number): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(
			`Removing journal: ${ref} ${orgId ? `in org: ${orgId}` : ''} ${
				branchId ? `in branch: ${branchId}` : ''
			}`
		);

		try {
			// First verify the journal exists and belongs to the org/branch
			const journalResult = await this.findOne(ref, orgId, branchId);

			if (!journalResult || !journalResult.journal) {
				this.logger.warn(`Journal ${ref} not found for deletion - orgId: ${orgId}, branchId: ${branchId}`);
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const journal = journalResult.journal;
			this.logger.debug(`Found journal to delete: ${journal.uid} - Title: "${journal.title || 'Untitled'}"`);

			// Use transaction for data consistency
			const deleteResult = await this.dataSource.transaction(async manager => {
				const result = await manager.update(Journal, ref, { 
					isDeleted: true
				});
				
				if (result.affected === 0) {
					this.logger.warn(`No rows affected when deleting journal ${ref}`);
					throw new NotFoundException('Journal not found or already deleted');
				}

				return result;
			});

			const executionTime = Date.now() - startTime;
			this.logger.log(`Journal ${ref} soft deleted successfully in ${executionTime}ms - Affected rows: ${deleteResult.affected}`);

			// Invalidate relevant cache entries
			await this.invalidateJournalCache(journal);

			// Send notification about the deletion
			const notification = {
				type: NotificationType.USER,
				title: 'Journal Entry Deleted',
				message: `Journal entry "${journal.title || 'Untitled'}" has been deleted`,
				status: NotificationStatus.UNREAD,
				owner: journal?.owner,
			};

			const recipients = [
				AccessLevel.ADMIN,
				AccessLevel.MANAGER,
				AccessLevel.OWNER,
				AccessLevel.SUPERVISOR,
			];

			this.eventEmitter.emit('send.notification', notification, recipients);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`Error deleting journal ${ref} after ${executionTime}ms: ${error.message}`, error.stack);
			
			return {
				message: error?.message || 'Failed to delete journal entry',
			};
		}
	}

	async restore(ref: number, orgId?: string, branchId?: number): Promise<{ message: string }> {
		try {
			// Find the deleted journal specifically
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('journal.uid = :ref', { ref })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: true });

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const journal = await queryBuilder.getOne();

			if (!journal) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			await this.journalRepository.update(ref, { isDeleted: false });

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async count(orgId?: string, branchId?: number): Promise<{ total: number }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch');

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const total = await queryBuilder.getCount();

			return {
				total,
			};
		} catch (error) {
			return {
				total: 0,
			};
		}
	}

	async getJournalsReport(filter: any, orgId?: string, branchId?: number) {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.branch', 'branch')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.where('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Add filter conditions from the filter object
			if (filter) {
				Object.keys(filter).forEach((key) => {
					if (filter[key] !== undefined && filter[key] !== null) {
						queryBuilder.andWhere(`journal.${key} = :${key}`, { [key]: filter[key] });
					}
				});
			}

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			queryBuilder.orderBy('journal.timestamp', 'DESC');

			const journals = await queryBuilder.getMany();

			if (!journals) {
				throw new NotFoundException('No journals found for the specified period');
			}

			const totalEntries = journals.length;
			const categories = this.analyzeJournalCategories(journals);
			const entriesPerDay = this.calculateEntriesPerDay(journals);
			const completionRate = this.calculateCompletionRate(journals);

			return {
				entries: journals,
				metrics: {
					totalEntries,
					averageEntriesPerDay: entriesPerDay,
					topCategories: categories,
					completionRate: `${completionRate}%`,
				},
			};
		} catch (error) {
			return null;
		}
	}

	private analyzeJournalCategories(journals: Journal[]): Array<{ category: string; count: number }> {
		const categoryCounts = journals.reduce((acc, journal) => {
			// Extract category from comments or clientRef if available
			const category = this.extractCategory(journal);
			acc[category] = (acc[category] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		return Object.entries(categoryCounts)
			.map(([category, count]) => ({ category, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5); // Return top 5 categories
	}

	private extractCategory(journal: Journal): string {
		// Try to extract category from comments
		const comments = journal.comments.toLowerCase();
		if (comments.includes('meeting')) return 'Meeting';
		if (comments.includes('call')) return 'Call';
		if (comments.includes('report')) return 'Report';
		if (comments.includes('follow')) return 'Follow-up';
		return 'Other';
	}

	private calculateEntriesPerDay(journals: Journal[]): number {
		if (journals.length === 0) return 0;

		const dates = journals.map((j) => j.timestamp.toISOString().split('T')[0]);
		const uniqueDates = new Set(dates).size;
		return Number((journals.length / uniqueDates).toFixed(1));
	}

	private calculateCompletionRate(journals: Journal[]): number {
		if (journals.length === 0) return 0;

		const completedEntries = journals.filter(
			(journal) => journal.fileURL && journal.comments && journal.comments.length > 10,
		).length;

		return Number(((completedEntries / journals.length) * 100).toFixed(1));
	}

	// ======================================================
	// INSPECTION-SPECIFIC FUNCTIONALITY
	// ======================================================

	async createInspection(createJournalDto: CreateJournalDto, orgId?: string, branchId?: number): Promise<{ message: string; data?: any }> {
		this.logger.log(`Creating inspection journal for orgId: ${orgId}, branchId: ${branchId}`);
		this.logger.debug(`Create inspection DTO: ${JSON.stringify(createJournalDto)}`);

		try {
			// Resolve Clerk org ID to numeric uid
			let resolvedOrgUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (!organisation) {
					throw new BadRequestException(`Organisation not found for ID: ${orgId}`);
				}
				resolvedOrgUid = organisation.uid;
			}

			// Set type to INSPECTION
			const inspectionData = {
				...createJournalDto,
				type: JournalType.INSPECTION,
				organisation: resolvedOrgUid ? { uid: resolvedOrgUid } : undefined,
				branch: branchId ? { uid: branchId } : undefined,
			};

			// Calculate scores if inspection data is provided
			if (inspectionData.inspectionData) {
				const scoreCalculation = this.calculateInspectionScore(inspectionData.inspectionData);
				inspectionData.totalScore = scoreCalculation.totalScore;
				inspectionData.maxScore = scoreCalculation.maxScore;
				inspectionData.percentage = scoreCalculation.percentage;
				inspectionData.overallRating = scoreCalculation.overallRating;
			}

			this.logger.debug(`Inspection data to save: ${JSON.stringify(inspectionData)}`);

			const journal = await this.journalRepository.save(inspectionData);

			if (!journal) {
				this.logger.error('Failed to save inspection journal - repository returned null');
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			this.logger.log(`Inspection journal created successfully with ID: ${journal.uid}`);

			const response = {
				message: process.env.SUCCESS_MESSAGE,
				data: {
					uid: journal.uid,
					totalScore: journal.totalScore,
					percentage: journal.percentage,
					overallRating: journal.overallRating
				}
			};

			// Send notification
			const notification = {
				type: NotificationType.USER,
				title: 'Inspection Completed',
				message: `An inspection has been completed with ${journal.percentage?.toFixed(1)}% score`,
				status: NotificationStatus.UNREAD,
				owner: journal?.owner,
			};

			const recipients = [
				AccessLevel.ADMIN,
				AccessLevel.MANAGER,
				AccessLevel.OWNER,
				AccessLevel.SUPERVISOR,
			];

			this.eventEmitter.emit('send.notification', notification, recipients);

			// Award XP based on inspection score
			try {
				const xpAmount = this.calculateInspectionXP(journal.percentage || 0);
				await this.rewardsService.awardXP({
					owner: createJournalDto.owner.uid,
					amount: xpAmount,
					action: 'INSPECTION',
					source: {
						id: createJournalDto.owner.uid.toString(),
						type: 'inspection',
						details: `Inspection completed with ${journal.percentage?.toFixed(1)}% score`,
					},
				}, orgId, branchId);
				this.logger.log(`XP awarded for inspection: ${createJournalDto.owner.uid} - ${xpAmount}XP`);
			} catch (xpError) {
				this.logger.warn(`Failed to award XP for inspection: ${xpError.message}`);
			}

			return response;
		} catch (error) {
			this.logger.error(`Error creating inspection journal: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	async getAllInspections(orgId?: string, branchId?: number): Promise<{ message: string; data: Journal[] }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.branch', 'branch')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.where('journal.type = :type', { type: JournalType.INSPECTION })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			queryBuilder.orderBy('journal.createdAt', 'DESC');

			const inspections = await queryBuilder.getMany();

			if (!inspections) {
				throw new NotFoundException('No inspections found');
			}

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: inspections,
			};
		} catch (error) {
			return {
				message: error?.message,
				data: [],
			};
		}
	}

	async getInspectionDetail(ref: number, orgId?: string, branchId?: number): Promise<{ message: string; data: Journal | null }> {
		try {
			const queryBuilder = this.journalRepository
				.createQueryBuilder('journal')
				.leftJoinAndSelect('journal.owner', 'owner')
				.leftJoinAndSelect('journal.organisation', 'organisation')
				.leftJoinAndSelect('journal.branch', 'branch')
				.where('journal.uid = :ref', { ref })
				.andWhere('journal.type = :type', { type: JournalType.INSPECTION })
				.andWhere('journal.isDeleted = :isDeleted', { isDeleted: false });

			// Find organisation by Clerk org ID if provided
			let organisationUid: number | undefined;
			if (orgId) {
				const organisation = await this.findOrganisationByClerkId(orgId);
				if (organisation) {
					organisationUid = organisation.uid;
				}
			}

			// Add organization filter if provided
			if (organisationUid) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId: organisationUid });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const inspection = await queryBuilder.getOne();

			if (!inspection) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
					data: null,
				};
			}

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: inspection,
			};
		} catch (error) {
			return {
				message: error?.message,
				data: null,
			};
		}
	}

	async getInspectionTemplates(orgId?: string, branchId?: number): Promise<{ message: string; data: any[] }> {
		try {
			// Return predefined inspection templates based on the images
			const templates = [
				{
					id: 'store_comprehensive',
					name: 'Comprehensive Store Inspection',
					description: 'Complete store inspection covering all operational areas',
					categories: [
						{
							id: 'fresh_produce',
							name: 'Fresh Produce, Meat & Bakery',
							weight: 20,
							items: [
								{ id: 'fruits_vegetables', name: 'Fruits & vegetables freshness', required: true },
								{ id: 'meat_hygiene', name: 'Meat & fish hygiene standards', required: true },
								{ id: 'bakery_freshness', name: 'Bakery freshness & labeling', required: true },
								{ id: 'temp_compliance', name: 'Refrigerated product temp compliance', required: true },
								{ id: 'storage_rotation', name: 'Storage/rotation practices', required: true }
							]
						},
						{
							id: 'cold_storage',
							name: 'Cold Storage & Freezers',
							weight: 15,
							items: [
								{ id: 'temperature_control', name: 'Temperature control', required: true },
								{ id: 'temp_logs', name: 'Temperature logs maintained', required: true },
								{ id: 'freezer_cleanliness', name: 'Freezers clean, no ice/leakage', required: true },
								{ id: 'items_sealed', name: 'Items sealed & labeled', required: true }
							]
						},
						{
							id: 'health_safety',
							name: 'Health & Safety',
							weight: 25,
							items: [
								{ id: 'fire_extinguishers', name: 'Fire extinguishers serviced & accessible', required: true },
								{ id: 'emergency_exits', name: 'Emergency exits clear & marked', required: true },
								{ id: 'first_aid', name: 'First aid kit stocked', required: true },
								{ id: 'electrical_safety', name: 'Electrical & structural safety', required: true },
								{ id: 'pest_control', name: 'Pest control records', required: true }
							]
						},
						{
							id: 'customer_service',
							name: 'Customer Service',
							weight: 15,
							items: [
								{ id: 'staff_availability', name: 'Staff availability & presence', required: true },
								{ id: 'staff_attitude', name: 'Staff attitude & training', required: true },
								{ id: 'queue_management', name: 'Queue management', required: true },
								{ id: 'feedback_handling', name: 'Feedback/complaints handling', required: false },
								{ id: 'pa_system', name: 'PA system functionality', required: false }
							]
						},
						{
							id: 'cashier_checkout',
							name: 'Cashier & Checkout Area',
							weight: 15,
							items: [
								{ id: 'pos_system', name: 'POS system functionality', required: true },
								{ id: 'transaction_efficiency', name: 'Transaction efficiency', required: true },
								{ id: 'queue_barriers', name: 'Queue barriers & order', required: true },
								{ id: 'bag_availability', name: 'Bag availability', required: true },
								{ id: 'till_cleanliness', name: 'Till area cleanliness', required: true }
							]
						},
						{
							id: 'warehouse',
							name: 'Back of House (Warehouse/Storage)',
							weight: 10,
							items: [
								{ id: 'stock_organization', name: 'Stock organization & labeling', required: true },
								{ id: 'temp_sensitive_storage', name: 'Temperature-sensitive storage', required: true },
								{ id: 'security_measures', name: 'Security measures', required: true }
							]
						},
						{
							id: 'compliance',
							name: 'Compliance & Documentation',
							weight: 20,
							items: [
								{ id: 'business_licenses', name: 'Business licenses & certificates', required: true },
								{ id: 'staff_training', name: 'Staff hygiene training records', required: true },
								{ id: 'cleaning_logs', name: 'Cleaning/temperature logs', required: true },
								{ id: 'promo_approvals', name: 'Promo & discount approvals', required: false }
							]
						}
					]
				}
			];

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: templates,
			};
		} catch (error) {
			return {
				message: error?.message,
				data: [],
			};
		}
	}

	async recalculateScore(ref: number, orgId?: string, branchId?: number): Promise<{ message: string; data?: any }> {
		try {
			const inspectionResult = await this.getInspectionDetail(ref, orgId, branchId);
			
			if (!inspectionResult.data) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const inspection = inspectionResult.data;

			if (!inspection.inspectionData) {
				throw new BadRequestException('No inspection data found to recalculate');
			}

			// Recalculate scores
			const scoreCalculation = this.calculateInspectionScore(inspection.inspectionData);

			// Update the inspection record
			await this.journalRepository.update(ref, {
				totalScore: scoreCalculation.totalScore,
				maxScore: scoreCalculation.maxScore,
				percentage: scoreCalculation.percentage,
				overallRating: scoreCalculation.overallRating
			});

			this.logger.log(`Recalculated scores for inspection ${ref}: ${scoreCalculation.percentage}%`);

			return {
				message: process.env.SUCCESS_MESSAGE,
				data: {
					totalScore: scoreCalculation.totalScore,
					maxScore: scoreCalculation.maxScore,
					percentage: scoreCalculation.percentage,
					overallRating: scoreCalculation.overallRating
				}
			};
		} catch (error) {
			this.logger.error(`Error recalculating scores for inspection ${ref}: ${error.message}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	// ======================================================
	// INSPECTION HELPER METHODS
	// ======================================================

	private calculateInspectionScore(inspectionData: InspectionFormData): {
		totalScore: number;
		maxScore: number;
		percentage: number;
		overallRating: InspectionRating;
	} {
		let totalScore = 0;
		let maxScore = 0;
		let weightedScore = 0;
		let totalWeight = 0;

		// Calculate scores for each category
		for (const category of inspectionData.categories) {
			let categoryScore = 0;
			let categoryMaxScore = 0;

			for (const item of category.items) {
				if (item.score !== undefined) {
					categoryScore += item.score;
				}
				categoryMaxScore += 5; // Assuming 1-5 scale
			}

			// Apply category weight if provided
			const weight = category.weight || 1;
			weightedScore += (categoryScore / categoryMaxScore) * weight;
			totalWeight += weight;

			totalScore += categoryScore;
			maxScore += categoryMaxScore;
		}

		// Calculate final percentage (prefer weighted if weights are provided)
		const percentage = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : (totalScore / maxScore) * 100;

		// Determine overall rating
		let overallRating: InspectionRating;
		if (percentage >= 95) {
			overallRating = InspectionRating.EXCELLENT;
		} else if (percentage >= 85) {
			overallRating = InspectionRating.GOOD;
		} else if (percentage >= 70) {
			overallRating = InspectionRating.AVERAGE;
		} else if (percentage >= 50) {
			overallRating = InspectionRating.POOR;
		} else {
			overallRating = InspectionRating.CRITICAL;
		}

		return {
			totalScore,
			maxScore,
			percentage: Number(percentage.toFixed(2)),
			overallRating
		};
	}

	private calculateInspectionXP(percentage: number): number {
		// Award XP based on inspection performance
		if (percentage >= 95) return 50; // Excellent
		if (percentage >= 85) return 30; // Good
		if (percentage >= 70) return 20; // Average
		if (percentage >= 50) return 10; // Poor
		return 5; // Critical (participation award)
	}
}
