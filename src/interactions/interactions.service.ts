import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Interaction } from './entities/interaction.entity';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { UpdateInteractionDto } from './dto/update-interaction.dto';
import { Lead } from '../leads/entities/lead.entity';
import { Client } from '../clients/entities/client.entity';
import { PaginatedResponse } from 'src/lib/types/paginated-response';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from 'src/user/entities/user.entity';
import { ConfigService } from '@nestjs/config';
import { Quotation } from '../shop/entities/quotation.entity';

@Injectable()
export class InteractionsService {
	private readonly logger = new Logger(InteractionsService.name);
	private readonly CACHE_TTL: number;
	private readonly CACHE_PREFIX = 'interaction:';

	constructor(
		@InjectRepository(Interaction)
		private interactionRepository: Repository<Interaction>,
		@InjectRepository(Lead)
		private leadRepository: Repository<Lead>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
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
	 * Generate cache key for interactions
	 */
	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	/**
	 * Generate cache key for lead interactions
	 */
	private getLeadInteractionsCacheKey(leadUid: number): string {
		return `${this.CACHE_PREFIX}lead:${leadUid}`;
	}

	/**
	 * Generate cache key for client interactions
	 */
	private getClientInteractionsCacheKey(clientUid: number): string {
		return `${this.CACHE_PREFIX}client:${clientUid}`;
	}

	/**
	 * Generate cache key for quotation interactions
	 */
	private getQuotationInteractionsCacheKey(quotationUid: number): string {
		return `${this.CACHE_PREFIX}quotation:${quotationUid}`;
	}

	/**
	 * Clear interaction-related caches
	 */
	private async clearInteractionCache(interactionId?: number, leadUid?: number, clientUid?: number, quotationUid?: number): Promise<void> {
		try {
			const keys = await this.cacheManager.store.keys();
			const keysToDelete = [];

			// Clear specific interaction cache if provided
			if (interactionId) {
				keysToDelete.push(this.getCacheKey(interactionId));
			}

			// Clear lead-related interaction caches
			if (leadUid) {
				keysToDelete.push(this.getLeadInteractionsCacheKey(leadUid));
			}

			// Clear client-related interaction caches
			if (clientUid) {
				keysToDelete.push(this.getClientInteractionsCacheKey(clientUid));
			}

			// Clear quotation-related interaction caches
			if (quotationUid) {
				keysToDelete.push(this.getQuotationInteractionsCacheKey(quotationUid));
			}

			// Clear all pagination and filtered interaction list caches
			const interactionListCaches = keys.filter(
				(key) =>
					key.startsWith('interactions_page') || // Pagination caches
					key.startsWith('interaction:all') || // All interactions cache
					key.includes('_limit'), // Filtered caches
			);
			keysToDelete.push(...interactionListCaches);

			// Clear all caches
			if (keysToDelete.length > 0) {
				await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));
				this.logger.log(`Cleared ${keysToDelete.length} interaction cache keys`);
			}
		} catch (error) {
			this.logger.error('Failed to clear interaction cache', error.stack);
		}
	}

	/**
	 * Clear related entity caches when interactions are created/updated
	 */
	private async clearRelatedEntityCaches(leadUid?: number, clientUid?: number, quotationUid?: number): Promise<void> {
		try {
			const keys = await this.cacheManager.store.keys();
			const keysToDelete = [];

			// Clear lead-related caches from other services
			if (leadUid) {
				const leadCaches = keys.filter(
					(key) =>
						key.startsWith('lead:') ||
						key.startsWith('leads_page') ||
						key.includes(`lead_${leadUid}`) ||
						key.includes(`leadUid_${leadUid}`)
				);
				keysToDelete.push(...leadCaches);
			}

			// Clear client-related caches
			if (clientUid) {
				const clientCaches = keys.filter(
					(key) =>
						key.startsWith('client:') ||
						key.startsWith('clients_page') ||
						key.includes(`client_${clientUid}`) ||
						key.includes(`clientUid_${clientUid}`)
				);
				keysToDelete.push(...clientCaches);
			}

			// Clear quotation-related caches from shop service
			if (quotationUid) {
				const quotationCaches = keys.filter(
					(key) =>
						key.startsWith('quotation:') ||
						key.startsWith('quotations_page') ||
						key.includes(`quotation_${quotationUid}`) ||
						key.includes(`quotationUid_${quotationUid}`)
				);
				keysToDelete.push(...quotationCaches);
			}

			// Clear task-related caches if client or lead is involved
			if (leadUid || clientUid) {
				const taskCaches = keys.filter(
					(key) =>
						key.startsWith('task:') ||
						key.startsWith('tasks_page') ||
						key.includes('task_')
				);
				keysToDelete.push(...taskCaches);
			}

			// Clear all caches
			if (keysToDelete.length > 0) {
				await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));
				this.logger.log(`Cleared ${keysToDelete.length} related entity cache keys after interaction update`);
			}
		} catch (error) {
			this.logger.error('Failed to clear related entity caches', error.stack);
		}
	}

	async create(
		createInteractionDto: CreateInteractionDto,
		orgId?: string,
		branchId?: number,
		user?: number,
	): Promise<{ message: string; data: Interaction | null }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// Find organisation by Clerk org ID
			const organisation = await this.findOrganisationByClerkId(orgId);
			if (!organisation) {
				throw new BadRequestException(`Organisation not found for ID: ${orgId}`);
			}

			// Check if at least one of leadUid, clientUid, or quotationUid is provided
			if (!createInteractionDto.leadUid && !createInteractionDto.clientUid && !createInteractionDto.quotationUid) {
				throw new BadRequestException('Either leadUid, clientUid, or quotationUid must be provided');
			}

			// Create the interaction entity
			const interaction = new Interaction();
			interaction.message = createInteractionDto.message;
			interaction.attachmentUrl = createInteractionDto.attachmentUrl;
			interaction.type = createInteractionDto.type;
			interaction.createdBy = createInteractionDto.createdBy;

			// Set organization
			interaction.organisation = organisation;

			// Set branch if provided
			if (branchId) {
				const branch = { uid: branchId } as Branch;
				interaction.branch = branch;
			}

			// Set createdBy if provided
			if (user) {
				const createdBy = { uid: user } as User;
				interaction.createdBy = createdBy;
			}

			// Set lead if provided
			if (createInteractionDto.leadUid) {
				const lead = await this.leadRepository.findOne({
					where: { uid: createInteractionDto.leadUid, isDeleted: false },
				});
				if (!lead) {
					throw new NotFoundException(`Lead with ID ${createInteractionDto.leadUid} not found`);
				}
				interaction.lead = lead;
			}

			// Set client if provided
			if (createInteractionDto.clientUid) {
				const client = await this.clientRepository.findOne({
					where: { uid: createInteractionDto.clientUid, isDeleted: false },
				});
				if (!client) {
					throw new NotFoundException(`Client with ID ${createInteractionDto.clientUid} not found`);
				}
				interaction.client = client;
			}

			// Set quotation if provided
			if (createInteractionDto.quotationUid) {
				// Get the Quotation repository dynamically to avoid circular dependency
				const dataSource = this.interactionRepository.manager.connection;
				const quotationRepository = dataSource.getRepository(Quotation);
				
				const quotation = await quotationRepository.findOne({
					where: { uid: createInteractionDto.quotationUid },
				});
				
				if (!quotation) {
					throw new NotFoundException(`Quotation with ID ${createInteractionDto.quotationUid} not found`);
				}
				
				interaction.quotation = quotation;
			}

			const savedInteraction = await this.interactionRepository.save(interaction);

			// Clear caches after successful creation
			await this.clearInteractionCache(
				savedInteraction.uid,
				createInteractionDto.leadUid,
				createInteractionDto.clientUid,
				createInteractionDto.quotationUid
			);

			// Clear related entity caches to ensure data consistency
			await this.clearRelatedEntityCaches(
				createInteractionDto.leadUid,
				createInteractionDto.clientUid,
				createInteractionDto.quotationUid
			);

			const response = {
				message: this.configService.get<string>('SUCCESS_MESSAGE') || 'Interaction created successfully',
				data: savedInteraction,
			};

			return response;
		} catch (error) {
			const response = {
				message: error?.message,
				data: null,
			};

			return response;
		}
	}

	async findAll(
		filters?: {
			search?: string;
			startDate?: Date;
			endDate?: Date;
			leadUid?: number;
			clientUid?: number;
		},
		page: number = 1,
		limit: number = 25,
		orgId?: string,
		branchId?: number,
): Promise<PaginatedResponse<Interaction>> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// Find organisation by Clerk org ID
			const organisation = await this.findOrganisationByClerkId(orgId);
			if (!organisation) {
				throw new BadRequestException(`Organisation not found for ID: ${orgId}`);
			}

			const queryBuilder = this.interactionRepository
				.createQueryBuilder('interaction')
				.leftJoinAndSelect('interaction.createdBy', 'createdBy')
				.leftJoinAndSelect('interaction.lead', 'lead')
				.leftJoinAndSelect('interaction.client', 'client')
				.leftJoinAndSelect('interaction.branch', 'branch')
				.leftJoinAndSelect('interaction.organisation', 'organisation')
				.where('interaction.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('organisation.uid = :orgId', { orgId: organisation.uid });

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			// Apply lead filter if provided
			if (filters?.leadUid) {
				queryBuilder.andWhere('lead.uid = :leadUid', { leadUid: filters.leadUid });
			}

			// Apply client filter if provided
			if (filters?.clientUid) {
				queryBuilder.andWhere('client.uid = :clientUid', { clientUid: filters.clientUid });
			}

			if (filters?.startDate && filters?.endDate) {
				queryBuilder.andWhere('interaction.createdAt BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});
			}

			if (filters?.search) {
				queryBuilder.andWhere(
					'(interaction.message ILIKE :search OR createdBy.name ILIKE :search OR createdBy.surname ILIKE :search)',
					{ search: `%${filters.search}%` },
				);
			}

			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('interaction.createdAt', 'ASC');

			const [interactions, total] = await queryBuilder.getManyAndCount();

			const result = {
				data: interactions,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: this.configService.get<string>('SUCCESS_MESSAGE') || 'Interactions retrieved successfully',
			};

			return result;
		} catch (error) {
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

	async findOne(
		uid: number,
		orgId?: string,
		branchId?: number,
	): Promise<{ interaction: Interaction | null; message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const queryBuilder = this.interactionRepository
				.createQueryBuilder('interaction')
				.leftJoinAndSelect('interaction.createdBy', 'createdBy')
				.leftJoinAndSelect('interaction.lead', 'lead')
				.leftJoinAndSelect('interaction.client', 'client')
				.leftJoinAndSelect('interaction.branch', 'branch')
				.leftJoinAndSelect('interaction.organisation', 'organisation')
				.where('interaction.uid = :uid', { uid })
				.andWhere('interaction.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('organisation.uid = :orgId', { orgId });

			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const interaction = await queryBuilder.getOne();

			if (!interaction) {
				throw new NotFoundException(`Interaction with ID ${uid} not found`);
			}

			const result = {
				interaction,
				message: this.configService.get<string>('SUCCESS_MESSAGE') || 'Interaction retrieved successfully',
			};

			return result;
		} catch (error) {
			return {
				interaction: null,
				message: error?.message,
			};
		}
	}

	async findByLead(leadUid: number, orgId?: string, branchId?: number): Promise<PaginatedResponse<Interaction>> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const queryBuilder = this.interactionRepository
				.createQueryBuilder('interaction')
				.leftJoinAndSelect('interaction.createdBy', 'createdBy')
				.leftJoinAndSelect('interaction.lead', 'lead')
				.leftJoinAndSelect('interaction.client', 'client')
				.leftJoinAndSelect('interaction.organisation', 'organisation')
				.where('interaction.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('lead.uid = :leadUid', { leadUid })
				.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });

			if (branchId) {
				queryBuilder.andWhere('interaction.branch.uid = :branchId', { branchId });
			}

			queryBuilder.orderBy('interaction.createdAt', 'ASC'); // Oldest first for chronological chat view

			const [interactions, total] = await queryBuilder.getManyAndCount();

			const result = {
				data: interactions,
				meta: {
					total,
					page: 1,
					limit: total,
					totalPages: 1,
				},
				message: this.configService.get<string>('SUCCESS_MESSAGE') || 'Interactions retrieved successfully',
			};

			return result;
		} catch (error) {
			return {
				data: [],
				meta: {
					total: 0,
					page: 1,
					limit: 0,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	async findByClient(clientUid: number, orgId?: string, branchId?: number): Promise<PaginatedResponse<Interaction>> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// Find organisation by Clerk org ID
			const organisation = await this.findOrganisationByClerkId(orgId);
			if (!organisation) {
				throw new BadRequestException(`Organisation not found for ID: ${orgId}`);
			}

			if (!clientUid) {
				throw new BadRequestException('Client ID is required');
			}

			const queryBuilder = this.interactionRepository
				.createQueryBuilder('interaction')
				.leftJoinAndSelect('interaction.createdBy', 'createdBy')
				.leftJoinAndSelect('interaction.client', 'client')
				.leftJoinAndSelect('interaction.lead', 'lead')
				.where('interaction.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('client.uid = :clientUid', { clientUid });

			// Add organization filter
			queryBuilder.leftJoinAndSelect('interaction.organisation', 'organisation').andWhere(
				'organisation.uid = :orgId',
				{ orgId: organisation.uid },
			);

			// Add branch filter if provided
			if (branchId) {
				queryBuilder
					.leftJoinAndSelect('interaction.branch', 'branch')
					.andWhere('branch.uid = :branchId', { branchId });
			}

			queryBuilder.orderBy('interaction.createdAt', 'ASC');

			const interactions = await queryBuilder.getMany();

			const result = {
				data: interactions,
				meta: {
					total: interactions.length,
					page: 1,
					limit: interactions.length,
					totalPages: 1,
				},
				message: this.configService.get<string>('SUCCESS_MESSAGE') || 'Client interactions retrieved successfully',
			};

			return result;
		} catch (error) {
			return {
				data: [],
				meta: {
					total: 0,
					page: 1,
					limit: 25,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	async findByQuotation(quotationUid: number, orgId?: string, branchId?: number): Promise<PaginatedResponse<Interaction>> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			// Find organisation by Clerk org ID
			const organisation = await this.findOrganisationByClerkId(orgId);
			if (!organisation) {
				throw new BadRequestException(`Organisation not found for ID: ${orgId}`);
			}

			if (!quotationUid) {
				throw new BadRequestException('Quotation ID is required');
			}

			const queryBuilder = this.interactionRepository
				.createQueryBuilder('interaction')
				.leftJoinAndSelect('interaction.createdBy', 'createdBy')
				.leftJoinAndSelect('interaction.quotation', 'quotation')
				.where('interaction.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('quotation.uid = :quotationUid', { quotationUid });

			// Add organization filter
			queryBuilder.leftJoinAndSelect('interaction.organisation', 'organisation').andWhere(
				'organisation.uid = :orgId',
				{ orgId: organisation.uid },
			);

			// Add branch filter if provided
			if (branchId) {
				queryBuilder
					.leftJoinAndSelect('interaction.branch', 'branch')
					.andWhere('branch.uid = :branchId', { branchId });
			}

			queryBuilder.orderBy('interaction.createdAt', 'ASC');

			const interactions = await queryBuilder.getMany();

			const result = {
				data: interactions,
				meta: {
					total: interactions.length,
					page: 1,
					limit: interactions.length,
					totalPages: 1,
				},
				message: this.configService.get<string>('SUCCESS_MESSAGE') || 'Quotation interactions retrieved successfully',
			};

			return result;
		} catch (error) {
			return {
				data: [],
				meta: {
					total: 0,
					page: 1,
					limit: 25,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	async update(
		uid: number,
		updateInteractionDto: UpdateInteractionDto,
		orgId?: string,
		branchId?: number,
	): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const queryBuilder = this.interactionRepository
				.createQueryBuilder('interaction')
				.leftJoinAndSelect('interaction.organisation', 'organisation')
				.leftJoinAndSelect('interaction.branch', 'branch')
				.leftJoinAndSelect('interaction.lead', 'lead')
				.leftJoinAndSelect('interaction.client', 'client')
				.leftJoinAndSelect('interaction.createdBy', 'createdBy')
				.where('interaction.uid = :uid', { uid })
				.andWhere('interaction.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('organisation.uid = :orgId', { orgId });

			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const interaction = await queryBuilder.getOne();

			if (!interaction) {
				throw new NotFoundException(`Interaction with ID ${uid} not found`);
			}

			// Update the interaction
			const updatedInteraction = { ...interaction, ...updateInteractionDto };
			await this.interactionRepository.save(updatedInteraction);

			// Clear caches after successful update
			await this.clearInteractionCache(
				interaction.uid,
				interaction.lead?.uid,
				interaction.client?.uid,
				interaction.quotation?.uid
			);

			// Clear related entity caches to ensure data consistency
			await this.clearRelatedEntityCaches(
				interaction.lead?.uid,
				interaction.client?.uid,
				interaction.quotation?.uid
			);

			return {
				message: this.configService.get<string>('SUCCESS_MESSAGE') || 'Interaction updated successfully',
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}

	async remove(uid: number, orgId?: string, branchId?: number): Promise<{ message: string }> {
		try {
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			const queryBuilder = this.interactionRepository
				.createQueryBuilder('interaction')
				.leftJoinAndSelect('interaction.organisation', 'organisation')
				.leftJoinAndSelect('interaction.branch', 'branch')
				.leftJoinAndSelect('interaction.lead', 'lead')
				.leftJoinAndSelect('interaction.client', 'client')
				.leftJoinAndSelect('interaction.createdBy', 'createdBy')
				.where('interaction.uid = :uid', { uid })
				.andWhere('interaction.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('organisation.uid = :orgId', { orgId });

			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const interaction = await queryBuilder.getOne();

			if (!interaction) {
				throw new NotFoundException(`Interaction with ID ${uid} not found`);
			}

			// Soft delete by updating isDeleted flag
			interaction.isDeleted = true;
			await this.interactionRepository.save(interaction);

			// Clear caches after successful deletion
			await this.clearInteractionCache(
				interaction.uid,
				interaction.lead?.uid,
				interaction.client?.uid,
				interaction.quotation?.uid
			);

			// Clear related entity caches to ensure data consistency
			await this.clearRelatedEntityCaches(
				interaction.lead?.uid,
				interaction.client?.uid,
				interaction.quotation?.uid
			);

			return {
				message: this.configService.get<string>('SUCCESS_MESSAGE') || 'Interaction deleted successfully',
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}
}
