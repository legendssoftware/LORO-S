import { Injectable, NotFoundException, Logger, Inject, BadRequestException } from '@nestjs/common';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Claim } from './entities/claim.entity';
import { IsNull, Repository, DeepPartial, Not, Between } from 'typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { endOfDay } from 'date-fns';
import { startOfDay } from 'date-fns';
import { ClaimCategory, ClaimStatus } from '../lib/enums/finance.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { NotificationStatus, NotificationType } from '../lib/enums/notification.enums';
import { EmailType } from '../lib/enums/email.enums';
import { ConfigService } from '@nestjs/config';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { XP_VALUES } from '../lib/constants/constants';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { User } from '../user/entities/user.entity';
import { ApprovalsService } from '../approvals/approvals.service';
import {
	ApprovalType,
	ApprovalPriority,
	ApprovalFlow,
	NotificationFrequency,
	ApprovalAction,
	ApprovalStatus,
} from '../lib/enums/approval.enums';
import { ClaimEmailData, ClaimStatusUpdateEmailData } from '../lib/types/email-templates.types';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class ClaimsService {
	private readonly logger = new Logger(ClaimsService.name);
	private readonly currencyLocale: string;
	private readonly currencyCode: string;
	private readonly currencySymbol: string;
	private readonly CACHE_PREFIX = 'claims:';
	private readonly CACHE_TTL: number;

	constructor(
		@InjectRepository(Claim)
		private claimsRepository: Repository<Claim>,
		private rewardsService: RewardsService,
		private eventEmitter: EventEmitter2,
		private readonly configService: ConfigService,
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private readonly approvalsService: ApprovalsService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
	) {
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default
		this.currencyLocale = this.configService.get<string>('CURRENCY_LOCALE', 'en-US');
		this.currencyCode = this.configService.get<string>('CURRENCY_CODE', 'USD');
		this.currencySymbol = this.configService.get<string>('CURRENCY_SYMBOL', '$');

		this.logger.log('ClaimsService initialized with cache TTL: ' + this.CACHE_TTL + 'ms');
		this.logger.debug(`ClaimsService initialized with currency: ${this.currencyCode} (${this.currencySymbol})`);
		this.logger.debug(`Currency locale: ${this.currencyLocale}`);
		this.logger.debug(`Rewards Service: ${!!this.rewardsService}`);
		this.logger.debug(`Event Emitter: ${!!this.eventEmitter}`);
		this.logger.debug(`Approvals Service: ${!!this.approvalsService}`);
		this.logger.debug(`Unified Notification Service: ${!!this.unifiedNotificationService}`);
		this.logger.debug(`Cache Manager: ${!!this.cacheManager}`);
	}

	// Helper method to invalidate claims cache
	private invalidateClaimsCache(claim: Claim) {
		// Emit events for cache invalidation
		this.eventEmitter.emit('claims.cache.invalidate', {
			keys: [
				'claims.all',
				`claims.single.${claim.uid}`,
				`claims.user.${claim.owner?.uid}`,
				'claims.stats',
				'claims.report',
			],
		});
	}

	private formatCurrency(amount: number): string {
		return new Intl.NumberFormat(this.currencyLocale, {
			style: 'currency',
			currency: this.currencyCode,
		})
			.format(amount)
			.replace(this.currencyCode, this.currencySymbol);
	}

	private calculateStats(claims: Claim[]): {
		total: number;
		pending: number;
		approved: number;
		declined: number;
		paid: number;
	} {
		return {
			total: claims?.length || 0,
			pending: claims?.filter((claim) => claim?.status === ClaimStatus.PENDING)?.length || 0,
			approved: claims?.filter((claim) => claim?.status === ClaimStatus.APPROVED)?.length || 0,
			declined: claims?.filter((claim) => claim?.status === ClaimStatus.DECLINED)?.length || 0,
			paid: claims?.filter((claim) => claim?.status === ClaimStatus.PAID)?.length || 0,
		};
	}

	async create(createClaimDto: CreateClaimDto, orgId?: number, branchId?: number): Promise<{ message: string }> {
		this.logger.log(`Creating claim for user: ${createClaimDto.owner}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			// Validate input data
			this.logger.debug('Validating claim creation data');
			if (!createClaimDto.owner) {
				throw new BadRequestException('User ID is required for claim creation');
			}

			if (!createClaimDto.amount || createClaimDto.amount <= 0) {
				throw new BadRequestException('Valid claim amount is required');
			}

			// Get user with organization and branch info
			this.logger.debug(`Fetching user details for claim creation: ${createClaimDto.owner}`);
			const user = await this.userRepository.findOne({
				where: { uid: createClaimDto.owner },
				relations: ['organisation', 'branch'],
			});

			if (!user) {
				this.logger.warn(`User not found for claim creation: ${createClaimDto.owner}`);
				throw new NotFoundException('User not found');
			}

			// Enhanced organization filtering - CRITICAL: Only allow claims for user's organization
			if (orgId && user.organisation && user.organisation.uid !== orgId) {
				this.logger.warn(`User ${user.uid} attempting to create claim for different organization ${orgId}`);
				throw new BadRequestException('Cannot create claim for different organization');
			}

			// Use the passed orgId and branchId if present, otherwise use user's
			const organisation = orgId ? { uid: orgId } : user.organisation;
			const branch = branchId ? { uid: branchId } : user.branch;

			// Enhanced data mapping with proper validation
			const claimData = {
				...createClaimDto,
				amount: createClaimDto.amount.toString(),
				organisation: organisation,
				branch: branch,
			} as DeepPartial<Claim>;

			this.logger.debug(
				`Creating claim with data: ${JSON.stringify({
					...claimData,
					owner: createClaimDto.owner,
					organisation: orgId || user.organisation?.uid,
					branch: branchId || user.branch?.uid,
					amount: createClaimDto.amount,
				})}`,
			);

			const claim = await this.claimsRepository.save(claimData);

			if (!claim) {
				this.logger.error('Failed to create claim - database returned null');
				throw new NotFoundException(process.env.CREATE_ERROR_MESSAGE || 'Failed to create claim');
			}

			this.logger.debug(`Claim created successfully with ID: ${claim.uid}`);

			// Initialize approval workflow for the claim
			try {
				this.logger.log(`🔄 [ClaimsService] Initializing approval workflow for claim ${claim.uid}`);
				await this.initializeClaimApprovalWorkflow(claim, user);
				this.logger.debug(`Approval workflow initialized successfully for claim: ${claim.uid}`);
			} catch (approvalError) {
				this.logger.error(
					`Failed to initialize approval workflow for claim: ${claim.uid}`,
					approvalError.stack,
				);
				// Don't fail claim creation if approval workflow fails
			}

			// Invalidate cache after creation
			this.invalidateClaimsCache(claim);
			this.logger.debug('Claims cache invalidated after claim creation');

			// Enhanced response mapping
			const response = {
				message: process.env.SUCCESS_MESSAGE || 'Claim created successfully',
			};

			// Send email notification for claim creation
			try {
				if (user.email) {
					const emailData: ClaimEmailData = {
						name: user.name || user.email,
						claimId: claim.uid,
						amount: this.formatCurrency(Number(claim.amount) || 0),
						category: claim.category || 'General',
						status: claim.status || ClaimStatus.PENDING,
						comments: claim.comments || '',
						submittedDate: claim.createdAt.toISOString().split('T')[0],
						submittedBy: {
							name: user.name || user.email,
							email: user.email,
						},
						branch: user.branch
							? {
									name: user.branch.name,
							  }
							: undefined,
						organization: {
							name: user.organisation?.name || 'Organization',
						},
						dashboardLink: `${process.env.APP_URL || 'https://loro.co.za'}/claims`,
					};

					// Send email to the user who created the claim
					this.eventEmitter.emit('send.email', EmailType.CLAIM_CREATED, [user.email], emailData);

					// Send admin notification email
					this.eventEmitter.emit('send.email', EmailType.CLAIM_CREATED_ADMIN, [], emailData);

					// Send push notification to the user who created the claim
					try {
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.CLAIM_CREATED,
							[user.uid],
							{
								userName: user.name || user.email,
								claimCategory: claim.category || 'General',
								claimAmount: this.formatCurrency(Number(claim.amount) || 0),
								claimId: claim.uid,
								status: claim.status || ClaimStatus.PENDING,
							},
							{
								priority: NotificationPriority.NORMAL,
							},
						);
						console.log(`✅ Claim creation email & push notification sent to user: ${user.email}`);
					} catch (notificationError) {
						console.error('Failed to send claim creation push notification:', notificationError.message);
					}
				}
			} catch (emailError) {
				console.error('Error sending claim creation email:', emailError);
			}

			// Send internal notification for admins/managers
			const notification = {
				type: NotificationType.USER,
				title: 'New Claim',
				message: `A new claim has been created by ${user.name || user.email}`,
				status: NotificationStatus.UNREAD,
				owner: claim?.owner,
			};

			const recipients = [AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.SUPERVISOR];

			this.eventEmitter.emit('send.notification', notification, recipients);

			// Award XP for creating a claim with enhanced error handling
			try {
				this.logger.debug(`Awarding XP for claim creation to user: ${createClaimDto.owner}`);
				await this.rewardsService.awardXP(
					{
						owner: createClaimDto.owner,
						amount: XP_VALUES.CLAIM,
						action: XP_VALUES_TYPES.CLAIM,
						source: {
							id: String(createClaimDto.owner),
							type: XP_VALUES_TYPES.CLAIM,
							details: 'Claim reward',
						},
					},
					orgId,
					branchId,
				);
				this.logger.debug(`XP awarded successfully for claim creation to user: ${createClaimDto.owner}`);
			} catch (xpError) {
				this.logger.error(
					`Failed to award XP for claim creation to user: ${createClaimDto.owner}`,
					xpError.stack,
				);
				// Don't fail claim creation if XP award fails
			}

			this.logger.log(`Claim created successfully for user: ${createClaimDto.owner}`);
			return response;
		} catch (error) {
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async findAll(
		filters?: {
			status?: ClaimStatus;
			clientId?: number;
			startDate?: Date;
			endDate?: Date;
			search?: string;
			assigneeId?: number;
		},
		page: number = 1,
		limit: number = 25,
		orgId?: number,
		branchId?: number,
	): Promise<PaginatedResponse<Claim>> {
		this.logger.log(`🔍 [ClaimsService] Finding claims with filters:`, {
			filters,
			page,
			limit,
			orgId,
			branchId
		});

		try {
			const queryBuilder = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.owner', 'owner')
				.leftJoinAndSelect('claim.branch', 'branch')
				.leftJoinAndSelect('claim.organisation', 'organisation')
				.where('claim.isDeleted = :isDeleted', { isDeleted: false });

			if (filters?.status) {
				queryBuilder.andWhere('claim.status = :status', { status: filters.status });
			}

			if (filters?.startDate && filters?.endDate) {
				queryBuilder.andWhere('claim.createdAt BETWEEN :startDate AND :endDate', {
					startDate: filters.startDate,
					endDate: filters.endDate,
				});
			}

			if (filters?.search) {
				queryBuilder.andWhere(
					'(owner.name ILIKE :search OR owner.surname ILIKE :search OR claim.amount ILIKE :search OR claim.category ILIKE :search)',
					{ search: `%${filters.search}%` },
				);
			}

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			// Add pagination
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('claim.createdAt', 'DESC');

			const [claims, total] = await queryBuilder.getManyAndCount();

			if (!claims) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const formattedClaims = claims?.map((claim) => ({
				...claim,
				amount: this.formatCurrency(Number(claim?.amount) || 0),
			}));

			this.logger.log(`✅ [ClaimsService] Successfully retrieved ${total} claims for page ${page}`);
			return {
				data: formattedClaims,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error retrieving claims:`, error.message);
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
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; claim: Claim | null; stats: any }> {
		this.logger.log(`🔍 [ClaimsService] Finding claim with ID: ${ref}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			const queryBuilder = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.owner', 'owner')
				.leftJoinAndSelect('claim.organisation', 'organisation')
				.leftJoinAndSelect('claim.branch', 'branch')
				.where('claim.uid = :ref', { ref })
				.andWhere('claim.isDeleted = :isDeleted', { isDeleted: false });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const claim = await queryBuilder.getOne();

			if (!claim) {
				throw new NotFoundException(process.env.SEARCH_ERROR_MESSAGE);
			}

			const allClaimsQuery = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.organisation', 'organisation');

			// Add organization filter if provided
			if (orgId) {
				allClaimsQuery.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId && claim.branch) {
				allClaimsQuery
					.leftJoinAndSelect('claim.branch', 'branch')
					.andWhere('branch.uid = :branchId', { branchId });
			}

			const allClaims = await allClaimsQuery.getMany();
			const stats = this.calculateStats(allClaims);

			const formattedClaim = {
				...claim,
				amount: this.formatCurrency(Number(claim?.amount) || 0),
			};

			this.logger.log(`✅ [ClaimsService] Successfully retrieved claim ${ref} with ${stats.total} total claims in organization`);
			return {
				message: process.env.SUCCESS_MESSAGE,
				claim: formattedClaim,
				stats,
			};
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error finding claim ${ref}:`, error.message);
			return {
				message: error?.message,
				claim: null,
				stats: null,
			};
		}
	}

	public async claimsByUser(
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{
		message: string;
		claims: Claim[];
		stats: {
			total: number;
			pending: number;
			approved: number;
			declined: number;
			paid: number;
		};
	}> {
		this.logger.log(`🔍 [ClaimsService] Finding claims for user ${ref}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			const queryBuilder = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.owner', 'owner')
				.leftJoinAndSelect('claim.organisation', 'organisation')
				.leftJoinAndSelect('claim.branch', 'branch')
				.where('owner.uid = :ref', { ref })
				.andWhere('claim.isDeleted = :isDeleted', { isDeleted: false });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const claims = await queryBuilder.getMany();

			if (!claims) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			const formattedClaims = claims?.map((claim) => ({
				...claim,
				amount: this.formatCurrency(Number(claim?.amount) || 0),
			}));

			const stats = this.calculateStats(claims);

			this.logger.log(`✅ [ClaimsService] Successfully retrieved ${formattedClaims.length} claims for user ${ref}`);
			return {
				message: process.env.SUCCESS_MESSAGE,
				claims: formattedClaims,
				stats,
			};
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error retrieving claims for user ${ref}:`, error?.message);
			return {
				message: `could not get claims by user - ${error?.message}`,
				claims: null,
				stats: null,
			};
		}
	}

	async getClaimsForDate(date: Date): Promise<{
		message: string;
		claims: {
			pending: Claim[];
			approved: Claim[];
			declined: Claim[];
			paid: Claim[];
			totalValue: string;
		};
	}> {
		this.logger.log(`📅 [ClaimsService] Getting claims for date: ${date.toISOString().split('T')[0]}`);

		try {
			const claims = await this.claimsRepository.find({
				where: { createdAt: Between(startOfDay(date), endOfDay(date)) },
			});

			if (!claims) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Group claims by status
			const groupedClaims = {
				pending: claims.filter((claim) => claim.status === ClaimStatus.PENDING),
				approved: claims.filter((claim) => claim.status === ClaimStatus.APPROVED),
				declined: claims.filter((claim) => claim.status === ClaimStatus.DECLINED),
				paid: claims.filter((claim) => claim.status === ClaimStatus.PAID),
			};

			this.logger.log(`✅ [ClaimsService] Successfully retrieved ${claims.length} claims for date ${date.toISOString().split('T')[0]}`);
			return {
				message: process.env.SUCCESS_MESSAGE,
				claims: {
					...groupedClaims,
					totalValue: this.formatCurrency(
						claims?.reduce((sum, claim) => sum + (Number(claim?.amount) || 0), 0),
					),
				},
			};
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error retrieving claims for date ${date.toISOString().split('T')[0]}:`, error?.message);
			return {
				message: error?.message,
				claims: null,
			};
		}
	}

	async update(
		ref: number,
		updateClaimDto: UpdateClaimDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string }> {
		this.logger.log(`🔄 [ClaimsService] Updating claim ${ref} with status: ${updateClaimDto.status}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			// First verify the claim belongs to the org/branch
			const claimResult = await this.findOne(ref, orgId, branchId);

			if (!claimResult || !claimResult.claim) {
				throw new NotFoundException('Claim not found in your organization');
			}

			const claim = claimResult.claim;

			// Convert DTO fields to match entity field types
			const updateData = {
				comments: updateClaimDto.comment,
				status: updateClaimDto.status,
				category: updateClaimDto.category,
				documentUrl: updateClaimDto.documentUrl,
			} as DeepPartial<Claim>;

			// Handle amount conversion from number to string
			if (updateClaimDto.amount !== undefined) {
				updateData.amount = updateClaimDto.amount.toString();
			}

			const result = await this.claimsRepository.update({ uid: ref }, updateData);

			if (!result) {
				throw new NotFoundException(process.env.UPDATE_ERROR_MESSAGE);
			}

			// Invalidate cache after update
			this.invalidateClaimsCache(claim);

			// Get the updated claim with all relations
			const updatedClaim = await this.claimsRepository.findOne({
				where: { uid: ref },
				relations: ['owner', 'owner.organisation', 'owner.branch', 'organisation', 'branch'],
			});

			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			// Send appropriate email notification based on status change
			try {
				if (updatedClaim && updatedClaim.owner?.email) {
					const baseEmailData: ClaimStatusUpdateEmailData = {
						name: updatedClaim.owner.name || updatedClaim.owner.email,
						claimId: updatedClaim.uid,
						amount: this.formatCurrency(Number(updatedClaim.amount) || 0),
						category: updatedClaim.category || 'General',
						status: updatedClaim.status,
						comments: updatedClaim.comments || '',
						submittedDate: updatedClaim.createdAt.toISOString().split('T')[0],
						submittedBy: {
							name: updatedClaim.owner.name || updatedClaim.owner.email,
							email: updatedClaim.owner.email,
						},
						branch: updatedClaim.branch
							? {
									name: updatedClaim.branch.name,
							  }
							: undefined,
						organization: {
							name: updatedClaim.organisation?.name || 'Organization',
						},
						dashboardLink: `${process.env.APP_URL || 'https://loro.co.za'}/claims`,
						previousStatus: claim.status, // Original status before update
						processedAt: new Date().toISOString(),
					};

					// Add rejection reason or approval notes if available
					if (updateClaimDto.status === ClaimStatus.DECLINED && updateClaimDto.comment) {
						baseEmailData.rejectionReason = updateClaimDto.comment;
					} else if (updateClaimDto.status === ClaimStatus.APPROVED && updateClaimDto.comment) {
						baseEmailData.approvalNotes = updateClaimDto.comment;
					}

					let emailType: EmailType = EmailType.CLAIM_STATUS_UPDATE;

					// Determine specific email type based on new status
					switch (updateClaimDto.status) {
						case ClaimStatus.APPROVED:
							emailType = EmailType.CLAIM_APPROVED;
							break;
						case ClaimStatus.DECLINED:
							emailType = EmailType.CLAIM_REJECTED;
							break;
						case ClaimStatus.PAID:
							emailType = EmailType.CLAIM_PAID;
							break;
						default:
							emailType = EmailType.CLAIM_STATUS_UPDATE;
							break;
					}

					// Send email to the claim owner
					this.eventEmitter.emit('send.email', emailType, [updatedClaim.owner.email], baseEmailData);
				}
			} catch (emailError) {
				console.error('Error sending claim status update email:', emailError);
			}

			// Send internal notification for status changes
			const notification = {
				type: NotificationType.USER,
				title: 'Claim Updated',
				message: `Claim #${updatedClaim?.uid} status changed to ${updateClaimDto.status || 'updated'}`,
				status: NotificationStatus.UNREAD,
				owner: claim.owner,
			};

			const recipients = [AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.SUPERVISOR];

			this.eventEmitter.emit('send.notification', notification, recipients);

			await this.rewardsService.awardXP(
				{
					owner: claim.owner.uid,
					amount: XP_VALUES.CLAIM,
					action: XP_VALUES_TYPES.CLAIM,
					source: {
						id: String(claim.owner.uid),
						type: XP_VALUES_TYPES.CLAIM,
						details: 'Claim reward',
					},
				},
				orgId,
				branchId,
			);

			this.logger.log(`✅ [ClaimsService] Successfully updated claim ${ref} to status: ${updateClaimDto.status}`);
			return response;
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error updating claim ${ref}:`, error?.message);
			const response = {
				message: error?.message || 'Failed to update claim',
			};

			return response;
		}
	}

	async remove(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		this.logger.log(`🗑️ [ClaimsService] Removing claim ${ref}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			// First verify the claim belongs to the org/branch
			const claimResult = await this.findOne(ref, orgId, branchId);

			if (!claimResult || !claimResult.claim) {
				throw new NotFoundException('Claim not found in your organization');
			}

			const claim = claimResult.claim;

			await this.claimsRepository.update({ uid: ref }, { isDeleted: true });

			// Invalidate cache after deletion
			this.invalidateClaimsCache(claim);

			this.logger.log(`✅ [ClaimsService] Successfully removed claim ${ref}`);
			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error removing claim ${ref}:`, error?.message);
			const response = {
				message: error?.message,
			};

			return response;
		}
	}

	async restore(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		this.logger.log(`♻️ [ClaimsService] Restoring claim ${ref}, orgId: ${orgId}, branchId: ${branchId}`);

		try {
			// First find the claim with isDeleted=true
			const queryBuilder = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.owner', 'owner')
				.leftJoinAndSelect('claim.organisation', 'organisation')
				.leftJoinAndSelect('claim.branch', 'branch')
				.where('claim.uid = :ref', { ref })
				.andWhere('claim.isDeleted = :isDeleted', { isDeleted: true });

			// Add organization filter if provided
			if (orgId) {
				queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
			}

			// Add branch filter if provided
			if (branchId) {
				queryBuilder.andWhere('branch.uid = :branchId', { branchId });
			}

			const claim = await queryBuilder.getOne();

			if (!claim) {
				throw new NotFoundException('Claim not found in your organization or is not deleted');
			}

			const result = await this.claimsRepository.update({ uid: ref }, { isDeleted: false });

			if (!result) {
				throw new NotFoundException(process.env.RESTORE_ERROR_MESSAGE);
			}

			// Invalidate cache
			this.invalidateClaimsCache(claim);

			this.logger.log(`✅ [ClaimsService] Successfully restored claim ${ref}`);
			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			return response;
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error restoring claim ${ref}:`, error?.message);
			return { message: error?.message };
		}
	}

	async getTotalClaimsStats(): Promise<{
		totalClaims: number;
		totalValue: string;
		byCategory: Record<ClaimCategory, number>;
	}> {
		this.logger.log(`📊 [ClaimsService] Getting total claims statistics`);

		try {
			const claims = await this.claimsRepository.find({
				where: {
					deletedAt: IsNull(),
					status: Not(ClaimStatus.DELETED),
				},
			});

			const byCategory: Record<ClaimCategory, number> = {
				[ClaimCategory.GENERAL]: 0,
				[ClaimCategory.PROMOTION]: 0,
				[ClaimCategory.EVENT]: 0,
				[ClaimCategory.ANNOUNCEMENT]: 0,
				[ClaimCategory.OTHER]: 0,
				[ClaimCategory.HOTEL]: 0,
				[ClaimCategory.TRAVEL]: 0,
				[ClaimCategory.TRANSPORT]: 0,
				[ClaimCategory.OTHER_EXPENSES]: 0,
				[ClaimCategory.ACCOMMODATION]: 0,
				[ClaimCategory.MEALS]: 0,
				[ClaimCategory.TRANSPORTATION]: 0,
				[ClaimCategory.ENTERTAINMENT]: 0,
			};

			claims.forEach((claim) => {
				if (claim?.category) byCategory[claim?.category]++;
			});

			this.logger.log(`✅ [ClaimsService] Successfully retrieved statistics for ${claims.length} total claims`);
			return {
				totalClaims: claims.length,
				totalValue: this.formatCurrency(claims.reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0)),
				byCategory,
			};
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error retrieving total claims statistics:`, error?.message);
			return {
				totalClaims: 0,
				totalValue: this.formatCurrency(0),
				byCategory: {
					[ClaimCategory.GENERAL]: 0,
					[ClaimCategory.PROMOTION]: 0,
					[ClaimCategory.EVENT]: 0,
					[ClaimCategory.ANNOUNCEMENT]: 0,
					[ClaimCategory.OTHER]: 0,
					[ClaimCategory.HOTEL]: 0,
					[ClaimCategory.TRAVEL]: 0,
					[ClaimCategory.TRANSPORT]: 0,
					[ClaimCategory.OTHER_EXPENSES]: 0,
					[ClaimCategory.ACCOMMODATION]: 0,
					[ClaimCategory.MEALS]: 0,
					[ClaimCategory.TRANSPORTATION]: 0,
					[ClaimCategory.ENTERTAINMENT]: 0,
				},
			};
		}
	}

	async getClaimsReport(filter: any) {
		this.logger.log(`📊 [ClaimsService] Generating claims report with filters:`, filter);

		try {
			const claims = await this.claimsRepository.find({
				where: {
					...filter,
					isDeleted: false,
					deletedAt: IsNull(),
					status: Not(ClaimStatus.DELETED),
				},
				relations: ['owner', 'branch'],
			});

			if (!claims) {
				throw new NotFoundException('No claims found for the specified period');
			}

			const groupedClaims = {
				paid: claims.filter((claim) => claim?.status === ClaimStatus.PAID),
				pending: claims.filter((claim) => claim?.status === ClaimStatus.PENDING),
				approved: claims.filter((claim) => claim?.status === ClaimStatus.APPROVED),
				declined: claims.filter((claim) => claim?.status === ClaimStatus.DECLINED),
			};

			const totalValue = claims.reduce((sum, claim) => sum + Number(claim?.amount), 0);
			const totalClaims = claims.length;
			const approvedClaims = groupedClaims.approved.length;
			const avgProcessingTime = this.calculateAverageProcessingTime(claims);
			const categoryBreakdown = this.analyzeCategoryBreakdown(claims);
			const topClaimants = this.analyzeTopClaimants(claims);

			this.logger.log(`✅ [ClaimsService] Successfully generated report for ${totalClaims} claims`);
			return {
				...groupedClaims,
				total: totalClaims,
				totalValue,
				metrics: {
					totalClaims,
					averageClaimValue: totalValue / totalClaims || 0,
					approvalRate: `${((approvedClaims / totalClaims) * 100).toFixed(1)}%`,
					averageProcessingTime: `${avgProcessingTime} days`,
					categoryBreakdown,
					topClaimants,
					claimValueDistribution: this.analyzeClaimValueDistribution(claims),
					monthlyTrends: this.analyzeMonthlyTrends(claims),
					branchPerformance: this.analyzeBranchPerformance(claims),
				},
			};
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error generating claims report:`, error?.message);
			return null;
		}
	}

	private calculateAverageProcessingTime(claims: Claim[]): number {
		const processedClaims = claims.filter(
			(claim) =>
				claim?.status === ClaimStatus.PAID ||
				claim?.status === ClaimStatus.APPROVED ||
				claim?.status === ClaimStatus.DECLINED,
		);

		if (processedClaims.length === 0) return 0;

		const totalProcessingTime = processedClaims.reduce((sum, claim) => {
			const processingTime = claim.updatedAt.getTime() - claim?.createdAt?.getTime();
			return sum + processingTime;
		}, 0);

		// Convert from milliseconds to days
		return Number((totalProcessingTime / (processedClaims.length * 24 * 60 * 60 * 1000)).toFixed(1));
	}

	private analyzeCategoryBreakdown(claims: Claim[]): Array<{
		category: ClaimCategory;
		count: number;
		totalValue: string;
		averageValue: string;
	}> {
		const categoryStats = new Map<
			ClaimCategory,
			{
				count: number;
				totalValue: number;
			}
		>();

		claims.forEach((claim) => {
			if (!categoryStats.has(claim.category)) {
				categoryStats.set(claim.category, {
					count: 0,
					totalValue: 0,
				});
			}

			const stats = categoryStats.get(claim.category);
			stats.count++;
			stats.totalValue += Number(claim.amount);
		});

		return Array.from(categoryStats.entries())
			.map(([category, stats]) => ({
				category,
				count: stats.count,
				totalValue: this.formatCurrency(stats.totalValue),
				averageValue: this.formatCurrency(stats.totalValue / stats.count),
			}))
			.sort((a, b) => b.count - a.count);
	}

	private analyzeTopClaimants(claims: Claim[]): Array<{
		userId: number;
		userName: string;
		totalClaims: number;
		totalValue: string;
		approvalRate: string;
	}> {
		const claimantStats = new Map<
			number,
			{
				name: string;
				claims: number;
				totalValue: number;
				approved: number;
			}
		>();

		claims.forEach((claim) => {
			const userId = claim.owner?.uid;
			const userName = claim.owner?.username;

			if (userId && userName) {
				if (!claimantStats.has(userId)) {
					claimantStats.set(userId, {
						name: userName,
						claims: 0,
						totalValue: 0,
						approved: 0,
					});
				}

				const stats = claimantStats.get(userId);
				stats.claims++;
				stats.totalValue += Number(claim.amount);
				if (claim.status === ClaimStatus.APPROVED || claim.status === ClaimStatus.PAID) {
					stats.approved++;
				}
			}
		});

		return Array.from(claimantStats.entries())
			.map(([userId, stats]) => ({
				userId,
				userName: stats.name,
				totalClaims: stats.claims,
				totalValue: this.formatCurrency(stats.totalValue),
				approvalRate: `${((stats.approved / stats.claims) * 100).toFixed(1)}%`,
			}))
			.sort((a, b) => b.totalClaims - a.totalClaims)
			.slice(0, 10);
	}

	private analyzeClaimValueDistribution(claims: Claim[]): Record<string, number> {
		const ranges = {
			'Under 1000': 0,
			'1000-5000': 0,
			'5000-10000': 0,
			'10000-50000': 0,
			'Over 50000': 0,
		};

		claims.forEach((claim) => {
			const amount = Number(claim.amount);
			if (amount < 1000) ranges['Under 1000']++;
			else if (amount < 5000) ranges['1000-5000']++;
			else if (amount < 10000) ranges['5000-10000']++;
			else if (amount < 50000) ranges['10000-50000']++;
			else ranges['Over 50000']++;
		});

		return ranges;
	}

	private analyzeMonthlyTrends(claims: Claim[]): Array<{
		month: string;
		totalClaims: number;
		totalValue: string;
		approvalRate: string;
	}> {
		const monthlyStats = new Map<
			string,
			{
				claims: number;
				totalValue: number;
				approved: number;
			}
		>();

		claims.forEach((claim) => {
			const month = claim.createdAt.toISOString().slice(0, 7); // YYYY-MM format

			if (!monthlyStats.has(month)) {
				monthlyStats.set(month, {
					claims: 0,
					totalValue: 0,
					approved: 0,
				});
			}

			const stats = monthlyStats.get(month);
			stats.claims++;
			stats.totalValue += Number(claim.amount);
			if (claim.status === ClaimStatus.APPROVED || claim.status === ClaimStatus.PAID) {
				stats.approved++;
			}
		});

		return Array.from(monthlyStats.entries())
			.map(([month, stats]) => ({
				month,
				totalClaims: stats.claims,
				totalValue: this.formatCurrency(stats.totalValue),
				approvalRate: `${((stats.approved / stats.claims) * 100).toFixed(1)}%`,
			}))
			.sort((a, b) => a.month.localeCompare(b.month));
	}

	private analyzeBranchPerformance(claims: Claim[]): Array<{
		branchId: number;
		branchName: string;
		totalClaims: number;
		totalValue: string;
		averageProcessingTime: string;
		approvalRate: string;
	}> {
		const branchStats = new Map<
			number,
			{
				name: string;
				claims: number;
				totalValue: number;
				approved: number;
				totalProcessingTime: number;
				processedClaims: number;
			}
		>();

		claims.forEach((claim) => {
			const branchId = claim.branch?.uid;
			const branchName = claim.branch?.name;

			if (branchId && branchName) {
				if (!branchStats.has(branchId)) {
					branchStats.set(branchId, {
						name: branchName,
						claims: 0,
						totalValue: 0,
						approved: 0,
						totalProcessingTime: 0,
						processedClaims: 0,
					});
				}

				const stats = branchStats.get(branchId);
				stats.claims++;
				stats.totalValue += Number(claim.amount);

				if (claim.status === ClaimStatus.APPROVED || claim.status === ClaimStatus.PAID) {
					stats.approved++;
				}

				if (claim.status !== ClaimStatus.PENDING) {
					stats.processedClaims++;
					stats.totalProcessingTime += claim.updatedAt.getTime() - claim.createdAt.getTime();
				}
			}
		});

		return Array.from(branchStats.entries())
			.map(([branchId, stats]) => ({
				branchId,
				branchName: stats.name,
				totalClaims: stats.claims,
				totalValue: this.formatCurrency(stats.totalValue),
				averageProcessingTime: `${(stats.processedClaims > 0
					? stats.totalProcessingTime / (stats.processedClaims * 24 * 60 * 60 * 1000)
					: 0
				).toFixed(1)} days`,
				approvalRate: `${((stats.approved / stats.claims) * 100).toFixed(1)}%`,
			}))
			.sort((a, b) => b.totalClaims - a.totalClaims);
	}

	/**
	 * Initialize approval workflow for claim requests
	 * Creates an approval request that integrates with the approval system
	 */
	private async initializeClaimApprovalWorkflow(claim: Claim, requester: User): Promise<void> {
		try {
			this.logger.log(`🔄 [ClaimsService] Initializing approval workflow for claim ${claim.uid}`);

			// Determine approval priority based on claim amount and category
			let priority = ApprovalPriority.MEDIUM;
			const amount = parseFloat(claim.amount) || 0;

			if (amount > 50000) {
				// High value claims
				priority = ApprovalPriority.HIGH;
			} else if (amount > 100000) {
				// Very high value claims
				priority = ApprovalPriority.CRITICAL;
			} else if (amount < 1000) {
				// Small claims
				priority = ApprovalPriority.LOW;
			}

			// Special priority for certain categories
			if (claim.category === ClaimCategory.ANNOUNCEMENT) {
				priority = ApprovalPriority.HIGH;
			}

			// Calculate approval deadline based on amount and priority
			const deadline = this.calculateClaimApprovalDeadline(amount, priority);

			// Create approval request
			const approvalDto = {
				title: `${claim.category || 'General'} Claim - ${this.formatCurrency(amount)}`,
				description: `${requester.name || requester.email} has submitted a ${
					claim.category || 'general'
				} claim for ${this.formatCurrency(amount)}. ${claim.comments ? 'Details: ' + claim.comments : ''}`,
				type: ApprovalType.EXPENSE_CLAIM,
				priority: priority,
				flowType: ApprovalFlow.SEQUENTIAL, // Sequential approval for claims
				entityId: claim.uid,
				entityType: 'claim',
				amount: amount,
				currency: this.currencyCode,
				deadline: deadline.toISOString(),
				requiresSignature: amount > 10000, // Require signature for high-value claims
				isUrgent: priority === ApprovalPriority.CRITICAL || priority === ApprovalPriority.HIGH,
				notificationFrequency: NotificationFrequency.IMMEDIATE,
				emailNotificationsEnabled: true,
				pushNotificationsEnabled: true,
				organisationRef: requester.organisationRef,
				branchUid: requester.branch?.uid,
				requesterUid: requester.uid, // Add the missing requesterUid field
				metadata: {
					claimId: claim.uid,
					claimCategory: claim.category,
					claimAmount: amount,
					currency: this.currencyCode,
					documentUrl: claim.documentUrl,
					requesterName: requester.name,
					requesterEmail: requester.email,
					branchName: claim.branch?.name,
					submittedAt: claim.createdAt,
				},
				customFields: {
					tags: ['expense-claim', claim.category?.toLowerCase() || 'general'],
				},
			};

			// Create the approval using the approvals service
			const approval = await this.approvalsService.create(approvalDto, {
				user: requester,
				organisationRef: requester.organisationRef,
				branchUid: requester.branch?.uid,
			} as any);

			this.logger.log(
				`✅ [ClaimsService] Approval workflow initialized: approval ${approval.uid} for claim ${claim.uid}`,
			);
		} catch (error) {
			this.logger.error(
				`❌ [ClaimsService] Error initializing approval workflow for claim ${claim.uid}:`,
				error.message,
			);
			// Don't throw error - claim creation should succeed even if approval workflow fails
			// This ensures backwards compatibility and system resilience
		}
	}

	/**
	 * Calculate appropriate deadline for claim approval based on amount and priority
	 */
	private calculateClaimApprovalDeadline(amount: number, priority: ApprovalPriority): Date {
		const now = new Date();

		if (priority === ApprovalPriority.CRITICAL) {
			// Critical claims - 4 hours
			return new Date(now.getTime() + 4 * 60 * 60 * 1000);
		} else if (priority === ApprovalPriority.HIGH || amount > 50000) {
			// High priority or high value - 1 business day
			const deadline = new Date(now);
			deadline.setDate(deadline.getDate() + 1);
			deadline.setHours(17, 0, 0, 0); // 5 PM next day
			return deadline;
		} else if (priority === ApprovalPriority.MEDIUM) {
			// Medium priority - 3 business days
			const deadline = new Date(now);
			deadline.setDate(deadline.getDate() + 3);
			deadline.setHours(17, 0, 0, 0); // 5 PM in 3 days
			return deadline;
		} else {
			// Low priority - 5 business days
			const deadline = new Date(now);
			deadline.setDate(deadline.getDate() + 5);
			deadline.setHours(17, 0, 0, 0); // 5 PM in 5 days
			return deadline;
		}
	}

	/**
	 * Event listener for approval workflow actions
	 * Updates claim status based on approval decisions
	 */
	@OnEvent('approval.action.performed')
	async handleApprovalAction(payload: any): Promise<void> {
		try {
			this.logger.log(
				`🔄 [ClaimsService] Handling approval action: ${payload.action} for approval ${payload.approvalId}`,
			);

			// Check if this approval is for a claim request
			if (payload.type !== ApprovalType.EXPENSE_CLAIM) {
				return; // Not a claim request, ignore
			}

			// Get the user who performed the action for approval lookup
			const actionUser = await this.userRepository.findOne({
				where: { uid: payload.actionBy },
			});

			if (!actionUser) {
				this.logger.error(
					`❌ [ClaimsService] Action user ${payload.actionBy} not found for approval ${payload.approvalId}`,
				);
				return;
			}

			// Find the approval to get the entity information
			const approval = await this.approvalsService.findOne(payload.approvalId, actionUser as any);
			if (!approval || approval.entityType !== 'claim') {
				this.logger.log(`⚠️ [ClaimsService] Approval ${payload.approvalId} is not for a claim request`);
				return;
			}

			// Find the corresponding claim request
			const claim = await this.claimsRepository.findOne({
				where: { uid: approval.entityId },
				relations: ['owner', 'organisation', 'branch'],
			});

			if (!claim) {
				this.logger.error(
					`❌ [ClaimsService] Claim request ${approval.entityId} not found for approval ${payload.approvalId}`,
				);
				return;
			}

			const previousStatus = claim.status;
			let newStatus: ClaimStatus;
			let updateFields: Partial<Claim> = {};

			// Handle different approval actions
			switch (payload.action) {
				case ApprovalAction.APPROVE:
					newStatus = ClaimStatus.APPROVED;
					updateFields = {
						status: newStatus,
						verifiedAt: new Date(),
						verifiedBy: actionUser,
						comments: payload.comments || claim.comments,
					};
					this.logger.log(`✅ [ClaimsService] Claim ${claim.uid} approved by user ${actionUser.uid}`);
					break;

				case ApprovalAction.REJECT:
					newStatus = ClaimStatus.DECLINED;
					updateFields = {
						status: newStatus,
						comments: payload.reason || payload.comments || 'Claim rejected',
					};
					this.logger.log(
						`❌ [ClaimsService] Claim ${claim.uid} rejected by user ${actionUser.uid}: ${payload.reason}`,
					);
					break;

				case ApprovalAction.REQUEST_INFO:
					newStatus = ClaimStatus.PENDING; // Keep as pending but add comments
					updateFields = {
						comments: `Additional information requested: ${payload.comments || payload.reason || ''}`,
					};
					this.logger.log(
						`📝 [ClaimsService] Additional info requested for claim ${claim.uid} by user ${actionUser.uid}`,
					);
					break;

				default:
					this.logger.log(
						`⚠️ [ClaimsService] Unhandled approval action: ${payload.action} for claim ${claim.uid}`,
					);
					return;
			}

			// Update the claim
			await this.claimsRepository.update(claim.uid, updateFields);

			// Invalidate cache
			this.invalidateClaimsCache(claim);

			// Log the status change
			this.logger.log(`🔄 [ClaimsService] Claim ${claim.uid} status updated: ${previousStatus} → ${newStatus}`);

			// Send notification email to claim owner if status changed
			if (previousStatus !== newStatus && claim.owner?.email) {
				const emailData: ClaimStatusUpdateEmailData = {
					name: claim.owner.name || claim.owner.email,
					claimId: claim.uid,
					amount: this.formatCurrency(Number(claim.amount) || 0),
					category: claim.category || 'General',
					status: newStatus,
					comments: updateFields.comments || '',
					submittedDate: claim.createdAt.toISOString().split('T')[0],
					submittedBy: {
						name: claim.owner.name || claim.owner.email,
						email: claim.owner.email,
					},
					branch: claim.branch
						? {
								name: claim.branch.name,
						  }
						: undefined,
					organization: {
						name: claim.organisation?.name || 'Organization',
					},
					dashboardLink: `${process.env.APP_URL || 'https://loro.co.za'}/claims`,
					previousStatus: previousStatus,
					processedAt: new Date().toISOString(),
					approvalNotes: payload.comments,
					rejectionReason: payload.reason,
				};

				// Determine email type based on new status
				let emailType: EmailType;
				switch (newStatus) {
					case ClaimStatus.APPROVED:
						emailType = EmailType.CLAIM_APPROVED;
						break;
					case ClaimStatus.DECLINED:
						emailType = EmailType.CLAIM_REJECTED;
						break;
					default:
						emailType = EmailType.CLAIM_STATUS_UPDATE;
						break;
				}

				// Send email notification
				this.eventEmitter.emit('send.email', emailType, [claim.owner.email], emailData);

				// Send push notification for claim status update
				try {
					let notificationEvent: NotificationEvent;
					switch (newStatus) {
						case ClaimStatus.APPROVED:
							notificationEvent = NotificationEvent.CLAIM_APPROVED;
							break;
						case ClaimStatus.DECLINED:
							notificationEvent = NotificationEvent.CLAIM_REJECTED;
							break;
						default:
							notificationEvent = NotificationEvent.CLAIM_STATUS_CHANGED;
							break;
					}

					await this.unifiedNotificationService.sendTemplatedNotification(
						notificationEvent,
						[claim.owner.uid],
						{
							userName: claim.owner.name || claim.owner.email,
							claimCategory: claim.category || 'General',
							claimAmount: this.formatCurrency(Number(claim.amount) || 0),
							claimId: claim.uid,
							newStatus: newStatus,
							previousStatus: previousStatus,
							rejectionReason: payload.reason,
						},
						{
							priority: NotificationPriority.HIGH,
						},
					);
					console.log(`✅ Claim status update email & push notification sent to user: ${claim.owner.email}`);
				} catch (notificationError) {
					console.error('Failed to send claim status update push notification:', notificationError.message);
				}
			}

			this.logger.log(`✅ [ClaimsService] Successfully handled approval action for claim ${claim.uid}`);
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error handling approval action:`, error.message);
		}
	}
}
