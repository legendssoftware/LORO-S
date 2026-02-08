import { Injectable, NotFoundException, Logger, Inject, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Claim } from './entities/claim.entity';
import { IsNull, Repository, DeepPartial, Not, Between, In } from 'typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { endOfDay } from 'date-fns';
import { startOfDay } from 'date-fns';
import { ClaimCategory, ClaimStatus, Currency } from '../lib/enums/finance.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { NotificationStatus, NotificationType } from '../lib/enums/notification.enums';
import { EmailType } from '../lib/enums/email.enums';
import { ConfigService } from '@nestjs/config';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES_TYPES } from '../lib/constants/constants';
import { XP_VALUES } from '../lib/constants/constants';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { ApprovalsService } from '../approvals/approvals.service';
import { CreateApprovalDto } from '../approvals/dto/create-approval.dto';
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
import { DataSource } from 'typeorm';
import { Approval } from '../approvals/entities/approval.entity';

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
		@InjectRepository(Organisation)
		private organisationRepository: Repository<Organisation>,
		@InjectRepository(Approval)
		private approvalRepository: Repository<Approval>,
		private readonly approvalsService: ApprovalsService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		@Inject(CACHE_MANAGER) private cacheManager: Cache,
		private readonly dataSource: DataSource,
	) {
		this.CACHE_TTL = parseInt(process.env.CACHE_TTL || '300000', 10); // 5 minutes default
		this.currencyLocale = this.configService.get<string>('CURRENCY_LOCALE', 'en-ZA');
		this.currencyCode = this.configService.get<string>('CURRENCY_CODE', 'USD');
		this.currencySymbol = this.configService.get<string>('CURRENCY_SYMBOL', '$');
	}

	/**
	 * Get organization admins for notifications by Clerk org ID (string).
	 */
	private async getOrganizationAdmins(orgId?: string): Promise<User[]> {
		if (!orgId) {
			return [];
		}

		try {
			const admins = await this.userRepository
				.createQueryBuilder('user')
				.leftJoin('user.organisation', 'organisation')
				.where('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId })
				.andWhere('user.accessLevel IN (:...levels)', {
					levels: [AccessLevel.ADMIN, AccessLevel.OWNER],
				})
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.select(['user.uid', 'user.name', 'user.surname', 'user.email', 'user.accessLevel'])
				.getMany();

			return admins;
		} catch (error) {
			this.logger.error(`Error fetching organization admins for org ${orgId}: ${error.message}`);
			return [];
		}
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

	/**
	 * Format claim category for display (e.g. 'general' -> 'General', 'other expenses' -> 'Other Expenses').
	 */
	private formatCategoryForDisplay(category?: string): string {
		if (!category) return 'General';
		return category
			.split(/\s+/)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
			.join(' ');
	}

	private formatCurrency(amount: number, currency?: Currency): string {
		// If currency is provided, use it; otherwise fall back to default
		const currencyCode = currency || this.currencyCode;
		
		// Map currency enum to currency code, symbol, and locale
		let currencySymbol: string;
		let locale: string;
		
		if (currency) {
			switch (currency) {
				case Currency.ZAR:
					currencySymbol = 'R';
					locale = 'en-ZA';
					break;
				case Currency.USD:
					currencySymbol = '$';
					locale = 'en-US';
					break;
				case Currency.EUR:
					currencySymbol = '€';
					locale = 'en-EU';
					break;
				case Currency.GBP:
					currencySymbol = '£';
					locale = 'en-GB';
					break;
				case Currency.AUD:
					currencySymbol = 'A$';
					locale = 'en-AU';
					break;
				case Currency.CAD:
					currencySymbol = 'C$';
					locale = 'en-CA';
					break;
				case Currency.CHF:
					currencySymbol = 'CHF';
					locale = 'de-CH';
					break;
				case Currency.JPY:
					currencySymbol = '¥';
					locale = 'ja-JP';
					break;
				case Currency.CNY:
					currencySymbol = '¥';
					locale = 'zh-CN';
					break;
				case Currency.INR:
					currencySymbol = '₹';
					locale = 'en-IN';
					break;
				case Currency.BWP:
					currencySymbol = 'P';
					locale = 'en-BW';
					break;
				case Currency.ZMW:
					currencySymbol = 'ZK';
					locale = 'en-ZM';
					break;
				case Currency.ZWL:
					currencySymbol = 'ZiG';
					locale = 'en-ZW';
					break;
				case Currency.MZN:
					currencySymbol = 'MT';
					locale = 'pt-MZ';
					break;
				case Currency.NGN:
					currencySymbol = '₦';
					locale = 'en-NG';
					break;
				case Currency.KES:
					currencySymbol = 'KSh';
					locale = 'en-KE';
					break;
				case Currency.TZS:
					currencySymbol = 'TSh';
					locale = 'en-TZ';
					break;
				case Currency.UGX:
					currencySymbol = 'USh';
					locale = 'en-UG';
					break;
				case Currency.ETB:
					currencySymbol = 'Br';
					locale = 'am-ET';
					break;
				case Currency.GHS:
					currencySymbol = 'GH₵';
					locale = 'en-GH';
					break;
				default:
					currencySymbol = this.currencySymbol;
					locale = this.currencyLocale;
					break;
			}
		} else {
			currencySymbol = this.currencySymbol;
			locale = this.currencyLocale;
		}
		
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: currencyCode,
		})
			.format(amount)
			.replace(currencyCode, currencySymbol);
	}

	/**
	 * Generate unique claim reference number (CLM-YYYY-NNNNNN)
	 */
	private async generateClaimRef(): Promise<string> {
		const year = new Date().getFullYear();
		const prefix = `CLM-${year}-`;
		
		// Get the last claim ref for this year
		const lastClaim = await this.claimsRepository.findOne({
			where: { claimRef: Not(IsNull()) },
			order: { createdAt: 'DESC' },
		});

		let sequence = 1;
		if (lastClaim?.claimRef?.startsWith(prefix)) {
			const lastSequence = parseInt(lastClaim.claimRef.replace(prefix, '')) || 0;
			sequence = lastSequence + 1;
		}

		return `${prefix}${sequence.toString().padStart(6, '0')}`;
	}

	/**
	 * Generate secure share token for public claim access
	 */
	private generateSecureToken(): string {
		const crypto = require('crypto');
		return crypto.randomBytes(32).toString('hex');
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

	/**
	 * Create a new claim with early-return pattern for optimal client response time
	 * 
	 * FLOW:
	 * 1. Validate input and fetch user details
	 * 2. Save claim record to database
	 * 3. Return success response to client immediately
	 * 4. Process non-critical operations asynchronously (approvals, XP, notifications, etc.)
	 * 
	 * This pattern ensures the client receives confirmation as soon as the core operation completes,
	 * while background processes run without blocking the response.
	 */
	async create(
		createClaimDto: CreateClaimDto,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
	): Promise<{ message: string; claim: Claim }> {
		if (orgId && typeof orgId !== 'string') {
			throw new BadRequestException('Organization ID must be a string (Clerk org ID or ref)');
		}
		if (orgId) {
			const orgExists = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId: orgId, isDeleted: false },
					{ ref: orgId, isDeleted: false },
				],
				select: ['uid', 'clerkOrgId', 'ref'],
			});
			if (!orgExists) {
				throw new BadRequestException(`Organization not found for ID: ${orgId}`);
			}
		}
		if (!clerkUserId || typeof clerkUserId !== 'string' || !clerkUserId.trim()) {
			throw new UnauthorizedException('User authentication required');
		}
		const startTime = Date.now();
		this.logger.log(`🔄 [ClaimsService] Creating claim for clerkUserId: ${clerkUserId}, orgId: ${orgId}, branchId: ${branchId}, amount: ${createClaimDto.amount}`);

		try {
			if (!createClaimDto.amount || createClaimDto.amount <= 0) {
				this.logger.warn(`❌ [ClaimsService] Invalid claim amount: ${createClaimDto.amount}`);
				throw new BadRequestException('Valid claim amount is required');
			}

			// Get user by Clerk ID (owner never from payload)
			const user = await this.userRepository
				.createQueryBuilder('user')
				.leftJoinAndSelect('user.organisation', 'organisation')
				.leftJoinAndSelect('user.branch', 'branch')
				.where('user.clerkUserId = :clerkUserId', { clerkUserId })
				.andWhere('user.isDeleted = :isDeleted', { isDeleted: false })
				.getOne();

			if (!user) {
				this.logger.warn(`⚠️ [ClaimsService] User not found for claim creation: ${clerkUserId}`);
				throw new NotFoundException('User not found');
			}

			// Resolve organisation entity and string ID (Clerk org ID or ref only - never numeric)
			let organisation: Organisation | null = null;
			let organisationUidValue: string | null = null;
			if (orgId) {
				organisation = await this.organisationRepository.findOne({
					where: [
						{ clerkOrgId: orgId, isDeleted: false },
						{ ref: orgId, isDeleted: false },
					],
					select: ['uid', 'clerkOrgId', 'ref'],
				});
				if (!organisation) {
					throw new BadRequestException(`Organization not found for ID: ${orgId}`);
				}
				organisationUidValue = organisation.clerkOrgId ?? organisation.ref ?? null;
				// Only allow claims for user's organization (compare by Clerk org ID / ref string)
				const userBelongsToOrg =
					user.organisation &&
					(user.organisation.clerkOrgId === orgId || user.organisation.ref === orgId);
				if (!userBelongsToOrg) {
					this.logger.warn(`❌ [ClaimsService] User ${user.uid} attempting to create claim for different organization ${orgId}`);
					throw new BadRequestException('Cannot create claim for different organization');
				}
			} else if (user.organisation) {
				organisation = user.organisation;
				organisationUidValue = organisation.clerkOrgId ?? organisation.ref ?? null;
			}

			const branch = branchId ? { uid: Number(branchId) } : (user.branch ? { uid: Number(user.branch.uid) } : null);

			// Generate claim reference number
			const claimRef = await this.generateClaimRef();
			const shareToken = this.generateSecureToken();
			const shareTokenExpiresAt = new Date();
			shareTokenExpiresAt.setDate(shareTokenExpiresAt.getDate() + 30); // 30 days expiry

			// Enhanced data mapping - organisationUid is always string (Clerk org ID or ref)
			const claimData = {
				...createClaimDto,
				amount: createClaimDto.amount.toString(),
				currency: createClaimDto.currency || Currency.ZAR, // Default to ZAR if not provided
				organisation,
				branch,
				owner: user,
				ownerClerkUserId: user.clerkUserId,
				organisationUid: organisationUidValue,
				branchUid: branch ? Number(branch.uid) : null,
				claimRef,
				shareToken,
				shareTokenExpiresAt,
			} as DeepPartial<Claim>;

			// ============================================================
			// TRANSACTIONAL PATH: Save claim only (approval created in setImmediate via full ApprovalsService.create)
			// ============================================================
			let claim: Claim;

			try {
				await this.dataSource.manager.transaction(async (transactionalEntityManager) => {
					claim = await transactionalEntityManager.save(Claim, claimData);

					if (!claim) {
						this.logger.error(`❌ [ClaimsService] Failed to create claim - database returned null`);
						throw new NotFoundException(process.env.CREATE_ERROR_MESSAGE || 'Failed to create claim');
					}
				});

				// Invalidate cache after successful transaction
				this.invalidateClaimsCache(claim);

				// ============================================================
				// EARLY RETURN: Respond to client immediately after successful save
				// ============================================================
				const formattedClaim = {
					...claim,
					amount: this.formatCurrency(Number(claim.amount) || 0, claim.currency),
				};
				const response = {
					message: process.env.SUCCESS_MESSAGE || 'Claim created successfully',
					claim: formattedClaim,
				};

				const duration = Date.now() - startTime;
				this.logger.log(`✅ [ClaimsService] Claim created successfully for clerkUserId: ${clerkUserId} in ${duration}ms - returning response to client`);

				// ============================================================
				// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
				// ============================================================
				setImmediate(async () => {
					try {
						const claimCategory = this.formatCategoryForDisplay(claim.category);
						const claimAmount = this.formatCurrency(Number(claim.amount) || 0, claim.currency);
						const details = claim.comments?.trim() ? claim.comments : 'None';
						const userName = user.name || user.email;

						// Resolve org admins once for both email and push
						let admins: User[] = [];
						try {
							admins = await this.getOrganizationAdmins(orgId);
						} catch (adminError) {
							this.logger.error(`❌ [ClaimsService] Error getting organization admins:`, adminError?.message);
						}

						// 1. Send email notifications
						try {
							if (user.email) {
								const emailData: ClaimEmailData = {
									name: userName,
									claimId: claim.uid,
									amount: claimAmount,
									category: claimCategory,
									status: claim.status || ClaimStatus.PENDING,
									comments: claim.comments || '',
									submittedDate: claim.createdAt.toISOString().split('T')[0],
									submittedBy: {
										name: userName,
										email: user.email,
									},
									branch: user.branch
										? { name: user.branch.name }
										: undefined,
									organization: { name: user.organisation?.name || 'Organization' },
									dashboardLink: `${process.env.APP_URL || 'https://loro.co.za'}/claims/${claim.uid}`,
									claimRef: claim.claimRef || `#${claim.uid}`,
									shareLink: `${process.env.APP_URL || 'https://loro.co.za'}/claims/share/${claim.shareToken}`,
								};

								this.eventEmitter.emit('send.email', EmailType.CLAIM_CREATED, [user.email], emailData);

								if (admins.length > 0) {
									const adminEmails = admins.map((a) => a.email).filter(Boolean);
									if (adminEmails.length > 0) {
										this.eventEmitter.emit('send.email', EmailType.CLAIM_CREATED_ADMIN, adminEmails, emailData);
									}
								}
							}
						} catch (emailError) {
							this.logger.error(`❌ [ClaimsService] Error sending claim creation email:`, emailError?.message);
						}

						// Send push to creator
						try {
							await this.unifiedNotificationService.sendTemplatedNotification(
								NotificationEvent.CLAIM_CREATED,
								[user.uid],
								{
									userName,
									claimCategory,
									claimAmount,
									claimId: claim.uid,
									status: claim.status || ClaimStatus.PENDING,
								},
								{ priority: NotificationPriority.NORMAL },
							);
						} catch (e) {
							this.logger.error(`❌ [ClaimsService] Failed to send claim creation push to user:`, e?.message);
						}

						// Send push to admins (same format as approval description)
						if (admins.length > 0) {
							try {
								const adminUids = admins
									.map((a) => a.uid)
									.filter((id): id is number => typeof id === 'number')
									.filter((id) => id !== user.uid); // avoid duplicate if creator is admin
								if (adminUids.length > 0) {
									await this.unifiedNotificationService.sendTemplatedNotification(
										NotificationEvent.CLAIM_CREATED_ADMIN,
										adminUids,
										{
											userName,
											claimCategory,
											claimAmount,
											claimId: claim.uid,
											id: claim.uid,
											details,
											status: claim.status || ClaimStatus.PENDING,
										},
										{
											priority: NotificationPriority.HIGH,
											customData: {
												screen: '/approvals',
												action: 'view_claim',
												claimId: claim.uid,
											},
										},
									);
								}
							} catch (e) {
								this.logger.error(`❌ [ClaimsService] Failed to send claim_created_admin push to admins:`, e?.message);
							}
						}

						// 2. Create full approval workflow (routing, history, approval notifications) via ApprovalsService.create
						try {
							await this.initializeClaimApprovalWorkflow(claim, user);
						} catch (approvalError) {
							this.logger.error(
								`❌ [ClaimsService] Failed to create approval workflow for claim ${claim.uid}:`,
								approvalError?.message ?? approvalError,
							);
						}

						// 3. Send internal notification for status changes
						const notification = {
							type: NotificationType.USER,
							title: 'New Claim',
							message: `A new claim has been created by ${user.name || user.email}`,
							status: NotificationStatus.UNREAD,
							owner: claim?.owner,
						};

						const recipients = [AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.SUPERVISOR];

						this.eventEmitter.emit('send.notification', notification, recipients);

						// 4. Award XP for creating a claim
						try {
							await this.rewardsService.awardXP(
								{
									owner: user.uid,
									amount: XP_VALUES.CLAIM,
									action: XP_VALUES_TYPES.CLAIM,
									source: {
										id: String(claim.uid),
										type: XP_VALUES_TYPES.CLAIM,
										details: 'Claim created',
									},
								},
								orgId,
								branchId,
							);
						} catch (xpError) {
							this.logger.error(
								`❌ [ClaimsService] Failed to award XP for claim creation to user: ${user.uid}`,
								xpError.stack,
							);
							// Don't fail post-processing if XP award fails
						}
					} catch (backgroundError) {
						// Log errors but don't affect user experience since response already sent
						this.logger.error(
							`❌ [ClaimsService] Background processing failed for claim ${claim.uid}: ${backgroundError.message}`,
							backgroundError.stack
						);
					}
				});

				return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [ClaimsService] Error creating claim after ${duration}ms: ${error.message}`, error.stack);
			// Re-throw with proper error handling
			if (error instanceof NotFoundException || error instanceof BadRequestException) {
				throw error;
			}
			throw new BadRequestException(error.message || 'Failed to create claim');
		}
	} catch (error) {
		const duration = Date.now() - startTime;
		this.logger.error(`❌ [ClaimsService] Error creating claim after ${duration}ms: ${error.message}`, error.stack);
		if (error instanceof NotFoundException || error instanceof BadRequestException) {
			throw error;
		}
		throw new BadRequestException(error.message || 'Failed to create claim');
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
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
		userAccessLevel?: string,
	): Promise<PaginatedResponse<Claim>> {
		const startTime = Date.now();
		this.logger.log(`[ClaimsService] findAll() called: page=${page}, limit=${limit}, orgId=${orgId}, branchId=${branchId}, clerkUserId=${clerkUserId}, accessLevel=${userAccessLevel}, status=${filters?.status}`);
		this.logger.log(`🔍 [ClaimsService] Finding claims with filters: page=${page}, limit=${limit}, orgId=${orgId}, branchId=${branchId}`, {
			status: filters?.status,
			search: filters?.search ? `${filters.search.substring(0, 50)}...` : undefined,
			hasDateRange: !!(filters?.startDate && filters?.endDate),
			assigneeId: filters?.assigneeId,
		});

		try {
			// Validate user context
			if (!clerkUserId && !userAccessLevel) {
				this.logger.warn(`⚠️ [ClaimsService] No user context provided for claims retrieval`);
				throw new UnauthorizedException('User authentication required');
			}

			// Check if user has elevated permissions
			const canViewAll = this.canViewAllClaims(userAccessLevel);

			const queryBuilder = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.owner', 'owner')
				.leftJoinAndSelect('claim.branch', 'branch')
				.leftJoinAndSelect('claim.organisation', 'organisation')
				.where('claim.isDeleted = :isDeleted', { isDeleted: false });

			// Apply RBAC: Regular users can only see their own claims - use ownerClerkUserId
			if (!canViewAll && clerkUserId != null && clerkUserId.trim() !== '') {
				queryBuilder.andWhere('claim.ownerClerkUserId = :clerkUserId', { clerkUserId });
			} else if (!canViewAll && (!clerkUserId || clerkUserId.trim() === '')) {
				// No clerkUserId and not elevated role - deny access
				this.logger.warn(`🚫 [ClaimsService] Access denied: No clerk user ID provided for non-elevated user`);
				throw new ForbiddenException('Insufficient permissions to view claims');
			}

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

			// Organization filter by Clerk org ID / ref (string only)
			if (orgId) {
				queryBuilder.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			// Add pagination
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('claim.createdAt', 'DESC');

			const [claims, total] = await queryBuilder.getManyAndCount();

			if (!claims || claims.length === 0) {
				this.logger.warn(`⚠️ [ClaimsService] No claims found for the given criteria`);
				return {
					data: [],
					meta: {
						total: 0,
						page,
						limit,
						totalPages: 0,
					},
					message: process.env.SUCCESS_MESSAGE || 'No claims found',
				};
			}

			const formattedClaims = claims?.map((claim) => ({
				...claim,
				amount: this.formatCurrency(Number(claim?.amount) || 0, claim?.currency),
			}));

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [ClaimsService] Successfully retrieved ${total} claims (${claims.length} on page ${page}) in ${duration}ms`);

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
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [ClaimsService] Error retrieving claims after ${duration}ms: ${error.message}`, error.stack);
			// Return proper error response
			if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
				throw error;
			}
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message || 'Failed to retrieve claims',
			};
		}
	}

	async findOne(
		ref: number,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
		userAccessLevel?: string,
	): Promise<{ message: string; claim: Claim | null; stats: any }> {
		const startTime = Date.now();
		this.logger.log(`[ClaimsService] findOne() called: ref=${ref}, orgId=${orgId}, branchId=${branchId}, clerkUserId=${clerkUserId}, accessLevel=${userAccessLevel}`);
		this.logger.log(`🔍 [ClaimsService] Finding claim with ID: ${ref}, orgId: ${orgId}, branchId: ${branchId}, clerkUserId: ${clerkUserId}, accessLevel: ${userAccessLevel}`);

		try {
			// Check if user is admin, owner, developer, or technician - they can view any claim
			const canViewAll = ['admin', 'owner', 'developer', 'technician'].includes(userAccessLevel?.toLowerCase() || '');

			const queryBuilder = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.owner', 'owner')
				.leftJoinAndSelect('claim.organisation', 'organisation')
				.leftJoinAndSelect('claim.branch', 'branch')
				.where('claim.uid = :ref', { ref })
				.andWhere('claim.isDeleted = :isDeleted', { isDeleted: false });

			// If user is not admin/owner/developer/technician, only allow viewing their own claims - use ownerClerkUserId
			if (!canViewAll && clerkUserId != null && clerkUserId.trim() !== '') {
				queryBuilder.andWhere('claim.ownerClerkUserId = :clerkUserId', { clerkUserId });
			}

			// Organization filter by Clerk org ID / ref (string only)
			if (orgId) {
				queryBuilder.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			const claim = await queryBuilder.getOne();

			if (!claim) {
				// If user is not admin/owner/developer/technician and claim exists but doesn't belong to them, return unauthorized
				if (!canViewAll && clerkUserId) {
					this.logger.warn(`🚫 [ClaimsService] User ${clerkUserId} attempted to access claim ${ref} that doesn't belong to them`);
					throw new NotFoundException('Claim not found or access denied');
				}
				this.logger.warn(`⚠️ [ClaimsService] Claim ${ref} not found in organization ${orgId}`);
				throw new NotFoundException(process.env.SEARCH_ERROR_MESSAGE);
			}

			const allClaimsQuery = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.organisation', 'organisation');

			// Organization filter by string (Clerk org ID / ref)
			if (orgId) {
				allClaimsQuery.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			const allClaims = await allClaimsQuery.getMany();
			const stats = this.calculateStats(allClaims);

			const formattedClaim = {
				...claim,
				amount: this.formatCurrency(Number(claim?.amount) || 0, claim?.currency),
			};

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [ClaimsService] Successfully retrieved claim ${ref} with ${stats.total} total claims in organization in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
				claim: formattedClaim,
				stats,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [ClaimsService] Error finding claim ${ref} after ${duration}ms: ${error.message}`, error.stack);
			// Return proper error response
			if (error instanceof NotFoundException) {
				throw error;
			}
			return {
				message: error?.message || 'Failed to retrieve claim',
				claim: null,
				stats: null,
			};
		}
	}

	public async claimsByUser(
		clerkUserId: string,
		orgId?: string,
		branchId?: number,
		requestingClerkUserId?: string,
		userAccessLevel?: string,
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
		if (!clerkUserId || typeof clerkUserId !== 'string' || clerkUserId.trim() === '') {
			throw new BadRequestException('User identity (clerk user ID) is required');
		}
		
		if (!orgId) {
			this.logger.warn(`❌ [ClaimsService] Organization ID is required for user claims retrieval`);
			throw new BadRequestException({
				statusCode: 400,
				message: 'Organization ID is required to retrieve user claims',
				error: 'Bad Request',
				action: 'Please ensure you are authenticated and your organization is properly configured',
				cause: 'Organization ID was not provided in the request context',
			});
		}

		const startTime = Date.now();
		this.logger.log(`🔍 [ClaimsService] Finding claims for clerkUserId: ${clerkUserId}, orgId: ${orgId}, branchId: ${branchId || 'all'}, requestingClerkUserId: ${requestingClerkUserId}, accessLevel: ${userAccessLevel}`);

		try {
			// Check if requesting user is admin, owner, developer, or technician - they can view any user's claims
			const canViewAll = ['admin', 'owner', 'developer', 'technician'].includes(userAccessLevel?.toLowerCase() || '');
			
			// If user is not admin/owner/developer/technician, they can only view their own claims
			if (!canViewAll && requestingClerkUserId != null && requestingClerkUserId !== clerkUserId) {
				this.logger.warn(`🚫 [ClaimsService] User ${requestingClerkUserId} attempted to access claims for user ${clerkUserId}`);
				throw new NotFoundException('Access denied: You can only view your own claims');
			}

			// Build query using Clerk IDs (strings) - following leads service pattern
			const queryBuilder = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.owner', 'owner')
				.leftJoinAndSelect('claim.organisation', 'organisation')
				.leftJoinAndSelect('claim.branch', 'branch')
				.where('claim.ownerClerkUserId = :clerkUserId', { clerkUserId })
				.andWhere('claim.isDeleted = :isDeleted', { isDeleted: false })
				.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });

			queryBuilder.orderBy('claim.createdAt', 'DESC');

			const claims = await queryBuilder.getMany();

			if (!claims || claims.length === 0) {
				this.logger.warn(`⚠️ [ClaimsService] No claims found for clerkUserId ${clerkUserId} in organization ${orgId}`);
				return {
					message: process.env.SUCCESS_MESSAGE || 'No claims found',
					claims: [],
					stats: {
						total: 0,
						pending: 0,
						approved: 0,
						declined: 0,
						paid: 0,
					},
				};
			}

			const formattedClaims = claims?.map((claim) => ({
				...claim,
				amount: this.formatCurrency(Number(claim?.amount) || 0),
			}));

			const stats = this.calculateStats(claims);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [ClaimsService] Successfully retrieved ${formattedClaims.length} claims for clerkUserId ${clerkUserId} in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
				claims: formattedClaims,
				stats,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [ClaimsService] Error retrieving claims for clerkUserId ${clerkUserId} after ${duration}ms: ${error.message}`, error.stack);
			// Return proper error response
			if (error instanceof NotFoundException) {
				throw error;
			}
			return {
				message: `could not get claims by user - ${error?.message}`,
				claims: [],
				stats: {
					total: 0,
					pending: 0,
					approved: 0,
					declined: 0,
					paid: 0,
				},
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
		const startTime = Date.now();
		const dateStr = date.toISOString().split('T')[0];
		this.logger.log(`📅 [ClaimsService] Getting claims for date: ${dateStr}`);

		try {
			const claims = await this.claimsRepository.find({
				where: { createdAt: Between(startOfDay(date), endOfDay(date)) },
			});

			if (!claims) {
				this.logger.warn(`⚠️ [ClaimsService] No claims found for date: ${dateStr}`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Group claims by status
			const groupedClaims = {
				pending: claims.filter((claim) => claim.status === ClaimStatus.PENDING),
				approved: claims.filter((claim) => claim.status === ClaimStatus.APPROVED),
				declined: claims.filter((claim) => claim.status === ClaimStatus.DECLINED),
				paid: claims.filter((claim) => claim.status === ClaimStatus.PAID),
			};

			const totalValue = claims?.reduce((sum, claim) => sum + (Number(claim?.amount) || 0), 0);

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [ClaimsService] Successfully retrieved ${claims.length} claims for date ${dateStr} in ${duration}ms`);

			return {
				message: process.env.SUCCESS_MESSAGE,
				claims: {
					...groupedClaims,
					totalValue: this.formatCurrency(totalValue),
				},
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [ClaimsService] Error retrieving claims for date ${dateStr} after ${duration}ms: ${error.message}`, error.stack);
			return {
				message: error?.message,
				claims: null,
			};
		}
	}

	/**
	 * Update a claim with early-return pattern for optimal client response time
	 * 
	 * FLOW:
	 * 1. Validate and fetch existing claim
	 * 2. Update claim in database
	 * 3. Return success response to client immediately
	 * 4. Process non-critical operations asynchronously (emails, notifications, XP, etc.)
	 * 
	 * This pattern ensures the client receives confirmation as soon as the database update completes,
	 * while background processes run without blocking the response.
	 */
	async update(
		ref: number,
		updateClaimDto: UpdateClaimDto,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
		userAccessLevel?: string,
	): Promise<{ message: string }> {
		const startTime = Date.now();
		this.logger.log(`🔄 [ClaimsService] Updating claim ${ref} with status: ${updateClaimDto.status}, orgId: ${orgId}, branchId: ${branchId}, clerkUserId: ${clerkUserId}, accessLevel: ${userAccessLevel}`);

		try {
			// First verify the claim exists and user has access
			const claimResult = await this.findOne(ref, orgId, branchId, clerkUserId, userAccessLevel);

			if (!claimResult || !claimResult.claim) {
				throw new NotFoundException('Claim not found in your organization');
			}

			const claim = claimResult.claim;
			const previousStatus = claim.status;

			// Enforce approval workflow for status changes (except owner editing their own pending claim)
			if (updateClaimDto.status && updateClaimDto.status !== previousStatus) {
				const isAdminOrOwner = userAccessLevel?.toLowerCase() === 'admin' || userAccessLevel?.toLowerCase() === 'owner';
				const isOwnerEditingPending = (claim.ownerClerkUserId === clerkUserId || claim.owner?.clerkUserId === clerkUserId) && previousStatus === ClaimStatus.PENDING && !isAdminOrOwner;
				
				if (!isOwnerEditingPending && (updateClaimDto.status === ClaimStatus.APPROVED || updateClaimDto.status === ClaimStatus.DECLINED)) {
					// Check if there's an active approval for this claim
					// Note: Direct status updates to APPROVED/DECLINED should go through approval workflow
					// This check prevents bypassing the approval system
					// Allow the update but log a warning - the approval workflow handler will manage status changes
				}
			}

			// Convert DTO fields to match entity field types
		const updateData = {
			comments: updateClaimDto.comment,
			status: updateClaimDto.status,
			category: updateClaimDto.category,
			documentUrl: updateClaimDto.documentUrl,
			currency: updateClaimDto.currency,
		} as DeepPartial<Claim>;

		// Handle amount conversion from number to string
		if (updateClaimDto.amount !== undefined) {
			updateData.amount = updateClaimDto.amount.toString();
		}

			// ============================================================
			// CRITICAL PATH: Update claim in database (must complete before response)
			// ============================================================
			const result = await this.claimsRepository.update({ uid: ref }, updateData);

			if (!result) {
				throw new NotFoundException(process.env.UPDATE_ERROR_MESSAGE);
			}

			// Invalidate cache after update (fast operation, safe to await)
			this.invalidateClaimsCache(claim);

			// ============================================================
			// EARLY RETURN: Respond to client immediately after successful update
			// ============================================================
			const response = {
				message: process.env.SUCCESS_MESSAGE,
			};

			const duration = Date.now() - startTime;
			this.logger.log(`✅ [ClaimsService] Successfully updated claim ${ref} to status: ${updateClaimDto.status} in ${duration}ms - returning response to client`);

			// ============================================================
			// POST-RESPONSE PROCESSING: Execute non-critical operations asynchronously
			// These operations run after the response is sent, without blocking the client
			// ============================================================
			setImmediate(async () => {
				try {
					// Get the updated claim with all relations for post-processing
					const updatedClaim = await this.claimsRepository.findOne({
						where: { uid: ref },
						relations: ['owner', 'owner.organisation', 'owner.branch', 'organisation', 'branch'],
					});

					if (!updatedClaim) {
						this.logger.warn(`⚠️ [ClaimsService] Could not fetch updated claim ${ref} for post-processing`);
						return;
					}

					// Update approval workflow when claim is updated (mirrors creation pattern)
					try {
						if (updatedClaim.owner) {
							await this.updateClaimApprovalWorkflow(updatedClaim, updatedClaim.owner, {
								amount: claim.amount,
								category: claim.category,
								comments: claim.comments,
								currency: claim.currency,
								documentUrl: claim.documentUrl,
							});
						}
					} catch (approvalUpdateError) {
						this.logger.error(
							`❌ [ClaimsService] Error updating approval workflow for claim ${ref}:`,
							approvalUpdateError.message,
						);
						// Don't fail claim update if approval update fails
					}

					// 1. Send email notification for status change
					try {
						if (updatedClaim.owner?.email) {
							const baseEmailData: ClaimStatusUpdateEmailData = {
								name: updatedClaim.owner.name || updatedClaim.owner.email,
								claimId: updatedClaim.uid,
								amount: this.formatCurrency(Number(updatedClaim.amount) || 0, updatedClaim.currency),
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
								dashboardLink: `${process.env.APP_URL || 'https://loro.co.za'}/claims/${updatedClaim.uid}`,
								claimRef: updatedClaim.claimRef || `#${updatedClaim.uid}`,
								shareLink: `${process.env.APP_URL || 'https://loro.co.za'}/claims/share/${updatedClaim.shareToken}`,
								previousStatus: previousStatus,
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
						this.logger.error(`❌ [ClaimsService] Error sending claim status update email:`, emailError.message);
					}

					// 2. Send internal notification for status changes
					const notification = {
						type: NotificationType.USER,
						title: 'Claim Updated',
						message: `Claim #${updatedClaim?.uid} status changed to ${updateClaimDto.status || 'updated'}`,
						status: NotificationStatus.UNREAD,
						owner: updatedClaim.owner || claim.owner,
					};

					const recipients = [AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER, AccessLevel.SUPERVISOR];

					this.eventEmitter.emit('send.notification', notification, recipients);

					// 3. Award XP for claim update
					try {
						const owner = updatedClaim.owner || claim.owner;
						if (owner && owner.uid) {
							await this.rewardsService.awardXP(
								{
									owner: owner.uid,
									amount: XP_VALUES.CLAIM,
									action: XP_VALUES_TYPES.CLAIM,
									source: {
										id: String(owner.uid),
										type: XP_VALUES_TYPES.CLAIM,
										details: 'Claim reward',
									},
								},
								orgId,
								branchId,
							);
						} else {
							this.logger.warn(`⚠️ [ClaimsService] Cannot award XP: claim owner is null for claim ${ref}`);
						}
					} catch (xpError) {
						this.logger.error(`❌ [ClaimsService] Failed to award XP for claim update:`, xpError.message);
					}
				} catch (backgroundError) {
					// Log errors but don't affect user experience since response already sent
					this.logger.error(
						`❌ [ClaimsService] Background processing failed for claim ${ref}: ${backgroundError.message}`,
						backgroundError.stack
					);
				}
			});

			return response;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`❌ [ClaimsService] Error updating claim ${ref} after ${duration}ms:`, error?.message);
			const response = {
				message: error?.message || 'Failed to update claim',
			};

			return response;
		}
	}

	async remove(ref: number, orgId?: string, branchId?: number, clerkUserId?: string, userAccessLevel?: string): Promise<{ message: string }> {
		this.logger.log(`🗑️ [ClaimsService] Removing claim ${ref}, orgId: ${orgId}, branchId: ${branchId}, clerkUserId: ${clerkUserId}, accessLevel: ${userAccessLevel}`);

		try {
			// First verify the claim exists and user has access
			const claimResult = await this.findOne(ref, orgId, branchId, clerkUserId, userAccessLevel);

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

	async restore(ref: number, orgId?: string, branchId?: number, clerkUserId?: string, userAccessLevel?: string): Promise<{ message: string }> {
		this.logger.log(`♻️ [ClaimsService] Restoring claim ${ref}, orgId: ${orgId}, branchId: ${branchId}, clerkUserId: ${clerkUserId}, accessLevel: ${userAccessLevel}`);

		try {
			// Check if user is admin, owner, developer, or technician - they can restore any claim
			const canViewAll = ['admin', 'owner', 'developer', 'technician'].includes(userAccessLevel?.toLowerCase() || '');

			// First find the claim with isDeleted=true
			const queryBuilder = this.claimsRepository
				.createQueryBuilder('claim')
				.leftJoinAndSelect('claim.owner', 'owner')
				.leftJoinAndSelect('claim.organisation', 'organisation')
				.leftJoinAndSelect('claim.branch', 'branch')
				.where('claim.uid = :ref', { ref })
				.andWhere('claim.isDeleted = :isDeleted', { isDeleted: true });

			// Organization filter by Clerk org ID / ref (string only)
			if (orgId) {
				queryBuilder.andWhere('(organisation.clerkOrgId = :orgId OR organisation.ref = :orgId)', { orgId });
			}

			// If user is not admin/owner/developer/technician, only allow restoring their own claims
			if (!canViewAll && clerkUserId != null && clerkUserId.trim() !== '') {
				queryBuilder.andWhere('claim.ownerClerkUserId = :clerkUserId', { clerkUserId });
			}

			const claim = await queryBuilder.getOne();

			if (!claim) {
				if (!canViewAll && clerkUserId) {
					this.logger.warn(`🚫 [ClaimsService] User ${clerkUserId} attempted to restore claim ${ref} that doesn't belong to them`);
					throw new NotFoundException('Claim not found or access denied');
				}
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

			// Calculate approval deadline - always 7 days from claim creation
			const deadline = this.calculateClaimApprovalDeadline(claim.createdAt);

			// Use claim currency or default to ZAR if not set
			const claimCurrency = claim.currency || Currency.ZAR;
			const category = this.formatCategoryForDisplay(claim.category);
			const details = claim.comments?.trim() ? claim.comments : 'None';
			const formattedAmount = this.formatCurrency(amount, claimCurrency);

			// Create approval request (description format: "{name} has submitted a {category} claim for {amount}. Attached details are {details}.")
			const approvalDto = {
				title: `${category} Claim - ${formattedAmount}`,
				description: `${requester.name || requester.email} has submitted a ${category} claim for ${formattedAmount}. Attached details are ${details}.`,
				type: ApprovalType.EXPENSE_CLAIM,
				priority: priority,
				flowType: ApprovalFlow.SEQUENTIAL,
				entityId: claim.uid,
				entityType: 'claim',
				amount: amount,
				currency: claimCurrency,
				deadline: deadline.toISOString(),
				requiresSignature: amount > 10000,
				isUrgent: priority === ApprovalPriority.CRITICAL || priority === ApprovalPriority.HIGH,
				notificationFrequency: NotificationFrequency.IMMEDIATE,
				emailNotificationsEnabled: true,
				pushNotificationsEnabled: true,
				organisationRef: requester.organisationRef,
				branchUid: requester.branch?.uid,
				requesterUid: requester.uid,
				autoSubmit: true,
				supportingDocuments: claim.documentUrl
					? [{ filename: 'claim-document', url: claim.documentUrl }]
					: [],
				entityData: {
					claimId: claim.uid,
					claimCategory: claim.category,
					claimAmount: amount,
					currency: claimCurrency,
					documentUrl: claim.documentUrl,
					comments: claim.comments,
					status: claim.status,
				},
				metadata: {
					claimId: claim.uid,
					claimCategory: claim.category,
					claimAmount: amount,
					currency: claimCurrency,
					documentUrl: claim.documentUrl,
					requesterName: requester.name,
					requesterEmail: requester.email,
					branchName: claim.branch?.name,
					submittedAt: claim.createdAt,
				},
				customFields: {
					tags: ['expense-claim', (claim.category || 'general').toLowerCase()],
				},
			};

			// Create the approval using the approvals service (RequestUser shape: uid, clerkUserId, organisationRef, branch)
			const requestUser = {
				uid: requester.uid,
				clerkUserId: requester.clerkUserId,
				organisationRef: requester.organisationRef || (requester.organisation as any)?.clerkOrgId || '',
				branch: requester.branch,
			};
			const approval = await this.approvalsService.create(approvalDto as CreateApprovalDto, requestUser as any);

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
	 * Initialize approval workflow for claim requests within a transaction
	 * This ensures atomicity between claim and approval creation
	 */
	private async initializeClaimApprovalWorkflowTransactional(
		claim: Claim,
		requester: User,
		transactionalEntityManager: any,
	): Promise<void> {
		try {
			this.logger.log(`🔄 [ClaimsService] Initializing approval workflow for claim ${claim.uid} (transactional)`);

			// Determine approval priority based on claim amount and category
			let priority = ApprovalPriority.MEDIUM;
			const amount = parseFloat(claim.amount) || 0;

			if (amount > 100000) {
				priority = ApprovalPriority.CRITICAL;
			} else if (amount > 50000) {
				priority = ApprovalPriority.HIGH;
			} else if (amount < 1000) {
				priority = ApprovalPriority.LOW;
			}

			// Special priority for certain categories
			if (claim.category === ClaimCategory.ANNOUNCEMENT) {
				priority = ApprovalPriority.HIGH;
			}

			// Calculate approval deadline - always 7 days from claim creation
			const deadline = this.calculateClaimApprovalDeadline(claim.createdAt);

			// Use claim currency or default to ZAR if not set
			const claimCurrency = claim.currency || Currency.ZAR;
			const category = this.formatCategoryForDisplay(claim.category);
			const details = claim.comments?.trim() ? claim.comments : 'None';
			const formattedAmount = this.formatCurrency(amount, claimCurrency);

			// Create approval request DTO (description format: "{name} has submitted a {category} claim for {amount}. Attached details are {details}.")
			const approvalDto = {
				title: `${category} Claim - ${formattedAmount}`,
				description: `${requester.name || requester.email} has submitted a ${category} claim for ${formattedAmount}. Attached details are ${details}.`,
				type: ApprovalType.EXPENSE_CLAIM,
				priority: priority,
				flowType: ApprovalFlow.SEQUENTIAL,
				entityId: claim.uid,
				entityType: 'claim',
				amount: amount,
				currency: claimCurrency, // Use claim currency instead of default currencyCode
				deadline: deadline.toISOString(),
				requiresSignature: amount > 10000,
				isUrgent: priority === ApprovalPriority.CRITICAL || priority === ApprovalPriority.HIGH,
				notificationFrequency: NotificationFrequency.IMMEDIATE,
				emailNotificationsEnabled: true,
				pushNotificationsEnabled: true,
				organisationRef: requester.organisationRef,
				branchUid: requester.branch?.uid,
				requesterUid: requester.uid,
				autoSubmit: true,
				metadata: {
					claimId: claim.uid,
					claimCategory: claim.category,
					claimAmount: amount,
					currency: claimCurrency, // Use claim currency instead of default currencyCode
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

			// Create approval using transactional entity manager
			// Note: We need to use the ApprovalsService but with the transactional context
			// Since ApprovalsService.create() uses its own repository, we'll need to create directly
			// or modify ApprovalsService to accept an optional transactional manager
			
			// For now, create approval directly using transactional manager
			// Get Clerk org ID from requester's organisationRef or organisation relation
			const clerkOrgId = requester.organisationRef || requester.organisation?.clerkOrgId || requester.organisation?.ref || '';
			
			const approval = transactionalEntityManager.create(Approval, {
				...approvalDto,
				requesterClerkUserId: requester.clerkUserId,
				organisationRef: clerkOrgId,
				branchUid: requester.branch?.uid,
				requestSource: 'web',
				status: ApprovalStatus.PENDING,
				submittedAt: new Date(),
			});

			const savedApproval = await transactionalEntityManager.save(Approval, approval);

			this.logger.log(
				`✅ [ClaimsService] Approval workflow initialized: approval ${savedApproval.uid} for claim ${claim.uid}`,
			);

			// Note: Approval routing and notifications will be handled asynchronously after transaction commits
			// This ensures transaction completes quickly while maintaining data consistency
		} catch (error) {
			this.logger.error(
				`❌ [ClaimsService] Error initializing approval workflow for claim: ${claim.uid}`,
				error.message,
			);
			throw error; // Re-throw to trigger transaction rollback
		}
	}

	/**
	 * Calculate appropriate deadline for claim approval
	 * The deadline should always be seven days from the time of creation of the lead (claim creation date)
	 */
	private calculateClaimApprovalDeadline(leadCreationDate: Date): Date {
		// Always return 7 days from the lead/claim creation date
		const deadline = new Date(leadCreationDate);
		deadline.setDate(deadline.getDate() + 7);
		deadline.setHours(17, 0, 0, 0); // 5 PM on the 7th day
		return deadline;
	}

	/**
	 * Find the approval associated with a claim
	 */
	private async findClaimApproval(claimUid: number): Promise<Approval | null> {
		try {
			const approval = await this.approvalRepository.findOne({
				where: {
					entityType: 'claim',
					entityId: claimUid,
				},
				order: { createdAt: 'DESC' }, // Get most recent if multiple exist
			});

			return approval || null;
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error finding approval for claim ${claimUid}:`, error.message);
			return null;
		}
	}

	/**
	 * Update approval workflow when claim is updated
	 * Mirrors the pattern of initializeClaimApprovalWorkflowTransactional() but for updates
	 */
	private async updateClaimApprovalWorkflow(
		claim: Claim,
		requester: User,
		previousClaimData?: Partial<Claim>,
	): Promise<void> {
		try {
			this.logger.log(`🔄 [ClaimsService] Updating approval workflow for claim ${claim.uid}`);

			// Find existing approval
			const approval = await this.findClaimApproval(claim.uid);
			if (!approval) {
				this.logger.warn(`⚠️ [ClaimsService] No approval found for claim ${claim.uid}`);
				return;
			}

			// Check if approval can be modified
			if (approval.status === ApprovalStatus.APPROVED || approval.status === ApprovalStatus.REJECTED) {
				this.logger.log(
					`ℹ️ [ClaimsService] Approval ${approval.uid} is ${approval.status}, skipping update`,
				);
				return;
			}

			// Recalculate priority based on updated claim amount and category (same logic as creation)
			let priority = ApprovalPriority.MEDIUM;
			const amount = parseFloat(claim.amount) || 0;

			if (amount > 100000) {
				priority = ApprovalPriority.CRITICAL;
			} else if (amount > 50000) {
				priority = ApprovalPriority.HIGH;
			} else if (amount < 1000) {
				priority = ApprovalPriority.LOW;
			}

			// Special priority for certain categories
			if (claim.category === ClaimCategory.ANNOUNCEMENT) {
				priority = ApprovalPriority.HIGH;
			}

			// Calculate approval deadline - always 7 days from claim creation
			const deadline = this.calculateClaimApprovalDeadline(claim.createdAt);

			// Use claim currency or default to ZAR if not set
			const claimCurrency = claim.currency || Currency.ZAR;
			const category = this.formatCategoryForDisplay(claim.category);
			const details = claim.comments?.trim() ? claim.comments : 'None';
			const formattedAmount = this.formatCurrency(amount, claimCurrency);

			// Prepare update data (description format: "{name} has submitted a {category} claim for {amount}. Attached details are {details}.")
			const updateData: Partial<Approval> = {
				title: `${category} Claim - ${formattedAmount}`,
				description: `${requester.name || requester.email} has submitted a ${category} claim for ${formattedAmount}. Attached details are ${details}.`,
				priority: priority,
				amount: amount,
				currency: claimCurrency,
				deadline: deadline,
				requiresSignature: amount > 10000,
				isUrgent: priority === ApprovalPriority.CRITICAL || priority === ApprovalPriority.HIGH,
				metadata: {
					...approval.metadata,
					claimId: claim.uid,
					claimCategory: claim.category,
					claimAmount: amount,
					currency: claimCurrency,
					documentUrl: claim.documentUrl,
					requesterName: requester.name,
					requesterEmail: requester.email,
					branchName: claim.branch?.name,
					submittedAt: claim.createdAt,
					updatedAt: new Date(),
				},
				entityData: {
					claimId: claim.uid,
					claimCategory: claim.category,
					claimAmount: amount,
					currency: claimCurrency,
					documentUrl: claim.documentUrl,
					comments: claim.comments,
					status: claim.status,
				},
			};

			// Update approval
			await this.approvalRepository.update({ uid: approval.uid }, updateData);

			// Cache invalidation will be handled by the approval update flow if needed

			this.logger.log(
				`✅ [ClaimsService] Approval workflow updated: approval ${approval.uid} for claim ${claim.uid}`,
			);
		} catch (error) {
			this.logger.error(
				`❌ [ClaimsService] Error updating approval workflow for claim ${claim.uid}:`,
				error.message,
			);
			// Don't throw - claim update should succeed even if approval update fails
		}
	}

	/**
	 * Find claim by share token (public access)
	 */
	async findByShareToken(token: string): Promise<{ message: string; claim: Claim | null }> {
		try {
			const claim = await this.claimsRepository.findOne({
				where: { shareToken: token, isDeleted: false },
				relations: ['owner', 'organisation', 'branch'],
			});

			if (!claim) {
				throw new NotFoundException('Claim not found or invalid share token');
			}

			// Check if token has expired
			if (claim.shareTokenExpiresAt && new Date() > claim.shareTokenExpiresAt) {
				throw new BadRequestException('Share token has expired');
			}

			return {
				message: process.env.SUCCESS_MESSAGE || 'Success',
				claim: {
					...claim,
					amount: this.formatCurrency(Number(claim.amount) || 0, claim.currency),
				},
			};
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error finding claim by share token: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Generate or regenerate share token for claim
	 */
	async generateShareToken(
		ref: number,
		orgId?: string,
		branchId?: number,
		clerkUserId?: string,
		userAccessLevel?: string,
	): Promise<{ message: string; shareToken: string; shareLink: string }> {
		try {
			const claimResult = await this.findOne(ref, orgId, branchId, clerkUserId, userAccessLevel);

			if (!claimResult || !claimResult.claim) {
				throw new NotFoundException('Claim not found');
			}

			const claim = claimResult.claim;
			const shareToken = this.generateSecureToken();
			const shareTokenExpiresAt = new Date();
			shareTokenExpiresAt.setDate(shareTokenExpiresAt.getDate() + 30); // 30 days expiry

			await this.claimsRepository.update({ uid: ref }, { shareToken, shareTokenExpiresAt });

			const shareLink = `${process.env.APP_URL || 'https://loro.co.za'}/claims/share/${shareToken}`;

			return {
				message: process.env.SUCCESS_MESSAGE || 'Share token generated successfully',
				shareToken,
				shareLink,
			};
		} catch (error) {
			this.logger.error(`❌ [ClaimsService] Error generating share token: ${error.message}`);
			throw error;
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
					amount: this.formatCurrency(Number(claim.amount) || 0, claim.currency),
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
							claimAmount: this.formatCurrency(Number(claim.amount) || 0, claim.currency),
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

	/**
	 * Check if user has elevated permissions to view all claims
	 * @param userAccessLevel - User's access level/role
	 * @returns true if user can view all claims, false otherwise
	 */
	private canViewAllClaims(userAccessLevel?: string): boolean {
		if (!userAccessLevel) {
			return false;
		}
		
		const elevatedRoles = [
			AccessLevel.ADMIN.toLowerCase(),
			AccessLevel.OWNER.toLowerCase(),
			AccessLevel.MANAGER.toLowerCase(),
			AccessLevel.DEVELOPER.toLowerCase(),
			AccessLevel.TECHNICIAN.toLowerCase(),
			AccessLevel.SUPERVISOR.toLowerCase(),
		];
		
		return elevatedRoles.includes(userAccessLevel.toLowerCase());
	}
}
