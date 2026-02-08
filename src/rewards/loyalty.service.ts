import { Injectable, NotFoundException, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ClientLoyaltyProfile } from './entities/client-loyalty-profile.entity';
import { LoyaltyPointsTransaction } from './entities/loyalty-points-transaction.entity';
import { LoyaltyReward } from './entities/loyalty-reward.entity';
import { LoyaltyRewardClaim } from './entities/loyalty-reward-claim.entity';
import { LoyaltyPointsConversion } from './entities/loyalty-points-conversion.entity';
import { LoyaltyBroadcast } from './entities/loyalty-broadcast.entity';
import { VirtualLoyaltyCard } from './entities/virtual-loyalty-card.entity';
import { Client } from '../clients/entities/client.entity';
import { LoyaltyTier, LoyaltyPointsTransactionType, LoyaltyRewardClaimStatus } from '../lib/enums/loyalty.enums';
import { CreateLoyaltyProfileDto } from './dto/create-loyalty-profile.dto';
import { ExternalEnrollDto } from './dto/external-enroll.dto';
import { AwardLoyaltyPointsDto } from './dto/award-loyalty-points.dto';
import { ClaimRewardDto } from './dto/claim-reward.dto';
import { UpdateVirtualCardDto } from './dto/update-virtual-card.dto';
import { ConvertPointsDto } from './dto/convert-points.dto';
import { BroadcastMessageDto } from './dto/broadcast-message.dto';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { SMSService } from '../lib/services/sms.service';
import { EmailType } from '../lib/enums/email.enums';
import { SMSType } from '../lib/enums/sms.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorageService } from '../lib/services/storage.service';
import { OrganisationService } from '../organisation/organisation.service';
import * as QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { createCanvas } from 'canvas';
import * as crypto from 'crypto';

@Injectable()
export class LoyaltyService {
	private readonly logger = new Logger(LoyaltyService.name);

	// Tier thresholds
	private readonly TIER_THRESHOLDS = {
		[LoyaltyTier.BRONZE]: 0,
		[LoyaltyTier.SILVER]: 1000,
		[LoyaltyTier.GOLD]: 5000,
		[LoyaltyTier.PLATINUM]: 15000,
	};

	// Tier multipliers for earning points
	private readonly TIER_MULTIPLIERS = {
		[LoyaltyTier.BRONZE]: 1.0,
		[LoyaltyTier.SILVER]: 1.1,
		[LoyaltyTier.GOLD]: 1.25,
		[LoyaltyTier.PLATINUM]: 1.5,
	};

	constructor(
		@InjectRepository(ClientLoyaltyProfile)
		private loyaltyProfileRepository: Repository<ClientLoyaltyProfile>,
		@InjectRepository(LoyaltyPointsTransaction)
		private pointsTransactionRepository: Repository<LoyaltyPointsTransaction>,
		@InjectRepository(LoyaltyReward)
		private rewardRepository: Repository<LoyaltyReward>,
		@InjectRepository(LoyaltyRewardClaim)
		private rewardClaimRepository: Repository<LoyaltyRewardClaim>,
		@InjectRepository(LoyaltyPointsConversion)
		private pointsConversionRepository: Repository<LoyaltyPointsConversion>,
		@InjectRepository(LoyaltyBroadcast)
		private broadcastRepository: Repository<LoyaltyBroadcast>,
		@InjectRepository(VirtualLoyaltyCard)
		private virtualCardRepository: Repository<VirtualLoyaltyCard>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectDataSource()
		private dataSource: DataSource,
		private readonly eventEmitter: EventEmitter2,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly storageService: StorageService,
		private readonly smsService: SMSService,
		private readonly organisationService: OrganisationService,
	) {}

	/**
	 * Generate unique loyalty card number
	 */
	private async generateLoyaltyCardNumber(): Promise<string> {
		let attempts = 0;
		const maxAttempts = 10;

		while (attempts < maxAttempts) {
			const year = new Date().getFullYear();
			const random = Math.floor(100000 + Math.random() * 900000);
			const cardNumber = `LOY-${year}-${random}`;

			const existing = await this.loyaltyProfileRepository.findOne({
				where: { loyaltyCardNumber: cardNumber },
			});

			if (!existing) {
				return cardNumber;
			}

			attempts++;
		}

		throw new Error('Failed to generate unique loyalty card number');
	}

	/**
	 * Generate secure token for profile completion
	 */
	private generateSecureToken(): string {
		return crypto.randomBytes(32).toString('hex');
	}

	/**
	 * Calculate tier based on total points
	 */
	private calculateTier(totalPoints: number): LoyaltyTier {
		if (totalPoints >= this.TIER_THRESHOLDS[LoyaltyTier.PLATINUM]) {
			return LoyaltyTier.PLATINUM;
		}
		if (totalPoints >= this.TIER_THRESHOLDS[LoyaltyTier.GOLD]) {
			return LoyaltyTier.GOLD;
		}
		if (totalPoints >= this.TIER_THRESHOLDS[LoyaltyTier.SILVER]) {
			return LoyaltyTier.SILVER;
		}
		return LoyaltyTier.BRONZE;
	}

	/**
	 * Find or create client by email/phone
	 */
	private async findOrCreateClient(
		email?: string,
		phone?: string,
		name?: string,
		orgId?: number,
		branchId?: number,
	): Promise<Client> {
		if (!email && !phone) {
			throw new BadRequestException('Either email or phone must be provided');
		}

		// Resolve numeric orgId to Clerk org ID (Client.organisationUid is string)
		const organisationUid =
			orgId != null ? await this.organisationService.findClerkOrgIdByUid(orgId) : undefined;

		// Try to find existing client
		const whereConditions: Record<string, unknown> = {};
		if (email) whereConditions.email = email;
		if (phone) whereConditions.phone = phone;
		if (organisationUid) whereConditions.organisationUid = organisationUid;

		let client = await this.clientRepository.findOne({
			where: whereConditions as any,
		});

		if (client) {
			this.logger.log(`Found existing client: ${client.uid}`);
			return client;
		}

		// Create new client if not found
		if (!name) {
			name = email?.split('@')[0] || `Client-${phone?.slice(-4)}` || 'New Client';
		}

		this.logger.log(`Creating new client: ${name}`);
		client = this.clientRepository.create({
			name,
			email: email || `client-${Date.now()}@example.com`,
			phone: phone || '',
			contactPerson: name,
			...(organisationUid && { organisationUid }),
			branchUid: branchId,
		});

		return await this.clientRepository.save(client);
	}

	/**
	 * Create loyalty profile (internal)
	 */
	async createLoyaltyProfile(
		dto: CreateLoyaltyProfileDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; profile: ClientLoyaltyProfile }> {
		try {
			const clientId = dto.clientId;
			let client: Client;

			if (clientId) {
				const organisationUid =
					orgId != null ? await this.organisationService.findClerkOrgIdByUid(orgId) : undefined;
				client = await this.clientRepository.findOne({
					where: {
						uid: clientId,
						...(organisationUid && { organisationUid }),
					},
				});
				if (!client) {
					throw new NotFoundException('Client not found');
				}
			} else {
				client = await this.findOrCreateClient(
					dto.email,
					dto.phone,
					undefined,
					orgId || dto.organisationUid,
					branchId || dto.branchUid,
				);
			}

			// Check if profile already exists
			const existingProfile = await this.loyaltyProfileRepository.findOne({
				where: { clientUid: client.uid },
			});

			if (existingProfile) {
				throw new ConflictException('Loyalty profile already exists for this client');
			}

			// Generate loyalty card number
			const cardNumber = await this.generateLoyaltyCardNumber();

			// Generate profile completion token
			const completionToken = this.generateSecureToken();
			const tokenExpiry = new Date();
			tokenExpiry.setDate(tokenExpiry.getDate() + 30); // 30 days

			// Determine signup method
			const signupMethod = dto.email ? 'email' : (dto.phone ? 'phone' : null);

			// Create loyalty profile
			const profile = this.loyaltyProfileRepository.create({
				clientUid: client.uid,
				loyaltyCardNumber: cardNumber,
				currentPoints: parseFloat(process.env.LOYALTY_WELCOME_POINTS || '100'),
				totalPointsEarned: parseFloat(process.env.LOYALTY_WELCOME_POINTS || '100'),
				tier: LoyaltyTier.BRONZE,
				status: 'active' as any,
				isProfileComplete: false,
				profileCompletionToken: completionToken,
				profileCompletionTokenExpiry: tokenExpiry,
				organisationUid: orgId || dto.organisationUid,
				branchUid: branchId || dto.branchUid,
				enrolledAt: new Date(),
				lastActivityAt: new Date(),
				signupMethod,
				signupCompletedAt: new Date(),
			});

			const savedProfile = await this.loyaltyProfileRepository.save(profile);

			// Create virtual card
			const virtualCard = this.virtualCardRepository.create({
				loyaltyProfileUid: savedProfile.uid,
				cardNumber: cardNumber,
				isActive: true,
				showQRCode: true,
				showBarcode: true,
				barcodeFormat: 'CODE128',
			});

			const savedCard = await this.virtualCardRepository.save(virtualCard);

			// Generate QR code and barcode asynchronously (don't block enrollment)
			this.generateQRCode(savedCard, savedProfile).catch(err => {
				this.logger.error(`Failed to generate QR code during enrollment: ${err.message}`);
			});
			this.generateBarcode(savedCard, cardNumber).catch(err => {
				this.logger.error(`Failed to generate barcode during enrollment: ${err.message}`);
			});

			// Award welcome points
			const welcomePoints = parseFloat(process.env.LOYALTY_WELCOME_POINTS || '100');
			if (welcomePoints > 0) {
				await this.createPointsTransaction(
					savedProfile.uid,
					welcomePoints,
					'ENROLLMENT',
					'Welcome points for joining loyalty program',
					LoyaltyPointsTransactionType.EARNED,
					{ sourceType: 'enrollment' },
				);
			}

			// Send welcome email and SMS if requested
			if (dto.sendWelcomeMessage !== false) {
				await this.sendWelcomeEmail(savedProfile, client);
				await this.sendWelcomeSMS(savedProfile, client);
			}

			return {
				message: process.env.SUCCESS_MESSAGE || 'Loyalty profile created successfully',
				profile: savedProfile,
			};
		} catch (error) {
			this.logger.error(`Failed to create loyalty profile: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * External enrollment endpoint (for ERP/POS)
	 */
	async externalEnroll(
		dto: ExternalEnrollDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; profile: ClientLoyaltyProfile; cardNumber: string }> {
		try {
			if (!dto.email && !dto.phone) {
				throw new BadRequestException('Either email or phone must be provided');
			}

			const finalOrgId = orgId || dto.organisationUid;
			const finalBranchId = branchId || dto.branchUid;

			// Find or create client
			const client = await this.findOrCreateClient(
				dto.email,
				dto.phone,
				dto.name,
				finalOrgId,
				finalBranchId,
			);

			// Check if profile already exists
			let profile = await this.loyaltyProfileRepository.findOne({
				where: { clientUid: client.uid },
				relations: ['client', 'virtualCard'],
			});

			if (profile) {
				this.logger.log(`Loyalty profile already exists for client ${client.uid}`);
				return {
					message: 'Loyalty profile already exists',
					profile,
					cardNumber: profile.loyaltyCardNumber,
				};
			}

			// Create profile using internal method
			const createDto: CreateLoyaltyProfileDto = {
				clientId: client.uid,
				email: dto.email,
				phone: dto.phone,
				organisationUid: finalOrgId,
				branchUid: finalBranchId,
				sendWelcomeMessage: dto.sendWelcomeMessage !== false,
			};

			const result = await this.createLoyaltyProfile(createDto, finalOrgId, finalBranchId);

			// Reload with client relation for email
			if (result.profile && dto.sendWelcomeMessage !== false) {
				const profileWithClient = await this.loyaltyProfileRepository.findOne({
					where: { uid: result.profile.uid },
					relations: ['client'],
				});
				if (profileWithClient?.client) {
					await this.sendWelcomeEmail(profileWithClient, profileWithClient.client);
				}
			}

			// Reload with relations
			profile = await this.loyaltyProfileRepository.findOne({
				where: { uid: result.profile.uid },
				relations: ['client', 'virtualCard'],
			});

			return {
				message: result.message,
				profile,
				cardNumber: profile.loyaltyCardNumber,
			};
		} catch (error) {
			this.logger.error(`Failed to enroll client externally: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Find loyalty profile by identifier (card number, phone, email, or client ID)
	 */
	async findProfileByIdentifier(
		identifier: string,
		orgId?: number,
	): Promise<ClientLoyaltyProfile | null> {
		// Try by card number first
		let profile = await this.loyaltyProfileRepository.findOne({
			where: { loyaltyCardNumber: identifier },
			relations: ['client', 'virtualCard'],
		});

		if (profile) {
			if (orgId && profile.organisationUid !== orgId) {
				return null;
			}
			return profile;
		}

		// Try by client email or phone
		const client = await this.clientRepository.findOne({
			where: [
				{ email: identifier },
				{ phone: identifier },
				{ uid: parseInt(identifier) || 0 },
			],
		});

		if (client) {
			profile = await this.loyaltyProfileRepository.findOne({
				where: { clientUid: client.uid },
				relations: ['client', 'virtualCard'],
			});

			if (profile && orgId && profile.organisationUid !== orgId) {
				return null;
			}

			return profile;
		}

		return null;
	}

	/**
	 * Create points transaction
	 */
	private async createPointsTransaction(
		profileUid: number,
		points: number,
		action: string,
		description: string,
		type: LoyaltyPointsTransactionType,
		metadata: any,
	): Promise<LoyaltyPointsTransaction> {
		const profile = await this.loyaltyProfileRepository.findOne({
			where: { uid: profileUid },
		});

		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		const balanceBefore = profile.currentPoints;

		// Update profile points
		if (type === LoyaltyPointsTransactionType.EARNED || type === LoyaltyPointsTransactionType.ADJUSTMENT) {
			profile.currentPoints += points;
			profile.totalPointsEarned += points;
		} else if (type === LoyaltyPointsTransactionType.SPENT) {
			profile.currentPoints -= points;
			profile.totalPointsSpent += points;
		} else if (type === LoyaltyPointsTransactionType.EXPIRED) {
			profile.currentPoints -= points;
		}

		// Check for tier upgrade
		const newTier = this.calculateTier(profile.totalPointsEarned);
		const tierUpgraded = newTier !== profile.tier;

		if (tierUpgraded) {
			const oldTier = profile.tier;
			profile.tier = newTier;
			profile.tierUpgradedAt = new Date();
			
			// Send tier upgrade notifications
			const profileWithClient = await this.loyaltyProfileRepository.findOne({
				where: { uid: profileUid },
				relations: ['client'],
			});
			if (profileWithClient?.client) {
				await this.sendTierUpgradeEmail(profileWithClient, oldTier);
				await this.sendTierUpgradeSMS(profileWithClient, oldTier);
			}
		}

		profile.lastActivityAt = new Date();
		await this.loyaltyProfileRepository.save(profile);

		// Create transaction record
		const transaction = this.pointsTransactionRepository.create({
			loyaltyProfileUid: profileUid,
			transactionType: type,
			pointsAmount: points,
			action,
			description,
			metadata: {
				...metadata,
				tierUpgraded,
				oldTier: tierUpgraded ? profile.tier : undefined,
				newTier: tierUpgraded ? newTier : undefined,
			},
			balanceBefore,
			balanceAfter: profile.currentPoints,
		});

		return await this.pointsTransactionRepository.save(transaction);
	}

	/**
	 * Award loyalty points
	 */
	async awardPoints(
		dto: AwardLoyaltyPointsDto,
		orgId?: number,
	): Promise<{ message: string; transaction: LoyaltyPointsTransaction; newTier?: LoyaltyTier }> {
		try {
			const profile = await this.findProfileByIdentifier(dto.identifier, orgId || dto.organisationUid);

			if (!profile) {
				throw new NotFoundException('Loyalty profile not found');
			}

			// Apply tier multiplier
			const multiplier = this.TIER_MULTIPLIERS[profile.tier];
			const finalPoints = Math.floor(dto.points * multiplier);

			const oldTier = profile.tier;

			// Create transaction
			const transaction = await this.createPointsTransaction(
				profile.uid,
				finalPoints,
				dto.action,
				dto.description || `Points awarded for ${dto.action}`,
				LoyaltyPointsTransactionType.EARNED,
				{
					...dto.source,
					originalPoints: dto.points,
					multiplier,
					finalPoints,
				},
			);

			// Reload profile to get updated tier
			const updatedProfile = await this.loyaltyProfileRepository.findOne({
				where: { uid: profile.uid },
				relations: ['client'],
			});

			const tierUpgraded = updatedProfile.tier !== oldTier;

			// Send points earned SMS notification (async, don't block)
			if (updatedProfile?.client?.phone) {
				this.sendPointsEarnedSMS(updatedProfile, finalPoints, dto.action).catch((err) => {
					this.logger.warn(`Failed to send points earned SMS: ${err.message}`);
				});
			}

			return {
				message: process.env.SUCCESS_MESSAGE || 'Points awarded successfully',
				transaction,
				newTier: tierUpgraded ? updatedProfile.tier : undefined,
			};
		} catch (error) {
			this.logger.error(`Failed to award points: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Bulk award points to multiple profiles
	 */
	async bulkAwardPoints(
		awards: AwardLoyaltyPointsDto[],
		orgId?: number,
	): Promise<{
		message: string;
		successful: number;
		failed: number;
		results: Array<{ identifier: string; success: boolean; transaction?: LoyaltyPointsTransaction; error?: string }>;
	}> {
		const results: Array<{ identifier: string; success: boolean; transaction?: LoyaltyPointsTransaction; error?: string }> = [];
		let successful = 0;
		let failed = 0;

		// Process awards in parallel batches
		const BATCH_SIZE = 10;
		for (let i = 0; i < awards.length; i += BATCH_SIZE) {
			const batch = awards.slice(i, i + BATCH_SIZE);

			await Promise.all(
				batch.map(async (award) => {
					try {
						const result = await this.awardPoints(award, orgId);
						results.push({
							identifier: award.identifier,
							success: true,
							transaction: result.transaction,
						});
						successful++;
					} catch (error) {
						results.push({
							identifier: award.identifier,
							success: false,
							error: error.message,
						});
						failed++;
						this.logger.error(`Failed to award points to ${award.identifier}: ${error.message}`);
					}
				}),
			);
		}

		return {
			message: `Bulk award completed: ${successful} successful, ${failed} failed`,
			successful,
			failed,
			results,
		};
	}

	/**
	 * Claim a reward
	 */
	async claimReward(
		profileUid: number,
		dto: ClaimRewardDto,
	): Promise<{ message: string; claim: LoyaltyRewardClaim; voucherCode?: string }> {
		try {
			const profile = await this.loyaltyProfileRepository.findOne({
				where: { uid: profileUid },
			});

			if (!profile) {
				throw new NotFoundException('Loyalty profile not found');
			}

			const reward = await this.rewardRepository.findOne({
				where: { uid: dto.rewardId },
			});

			if (!reward) {
				throw new NotFoundException('Reward not found');
			}

			// Validate reward availability
			if (!reward.isActive) {
				throw new BadRequestException('Reward is not active');
			}

			if (reward.validFrom && new Date(reward.validFrom) > new Date()) {
				throw new BadRequestException('Reward is not yet valid');
			}

			if (reward.validUntil && new Date(reward.validUntil) < new Date()) {
				throw new BadRequestException('Reward has expired');
			}

			if (reward.usageLimit && reward.timesRedeemed >= reward.usageLimit) {
				throw new BadRequestException('Reward usage limit reached');
			}

			// Check tier requirement
			if (reward.minimumTier) {
				const tierOrder = [LoyaltyTier.BRONZE, LoyaltyTier.SILVER, LoyaltyTier.GOLD, LoyaltyTier.PLATINUM];
				const clientTierIndex = tierOrder.indexOf(profile.tier);
				const requiredTierIndex = tierOrder.indexOf(reward.minimumTier);

				if (clientTierIndex < requiredTierIndex) {
					throw new BadRequestException(`Reward requires ${reward.minimumTier} tier or higher`);
				}
			}

			// Check points balance
			if (profile.currentPoints < reward.pointsRequired) {
				throw new BadRequestException('Insufficient points to claim this reward');
			}

			// Check per-client redemption limit
			if (reward.maxRedemptionsPerClient) {
				const clientClaims = await this.rewardClaimRepository.count({
					where: {
						loyaltyProfileUid: profile.uid,
						rewardUid: reward.uid,
						status: LoyaltyRewardClaimStatus.REDEEMED,
					},
				});

				if (clientClaims >= reward.maxRedemptionsPerClient) {
					throw new BadRequestException('You have reached the maximum redemptions for this reward');
				}
			}

			// Generate claim code
			const claimCode = `CLAIM-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
			const voucherCode = `VOUCHER-${Date.now()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

			// Create claim record
			const claim = this.rewardClaimRepository.create({
				loyaltyProfileUid: profile.uid,
				rewardUid: reward.uid,
				claimCode,
				voucherCode,
				pointsSpent: reward.pointsRequired,
				status: LoyaltyRewardClaimStatus.PENDING,
				metadata: {
					discountCode: voucherCode,
					originalPoints: reward.pointsRequired,
					discountAmount: reward.discountAmount || null,
					details: {
						discountPercentage: reward.discountPercentage || null,
					},
				} as any,
			});

			const savedClaim = await this.rewardClaimRepository.save(claim);

			// Deduct points
			await this.createPointsTransaction(
				profile.uid,
				reward.pointsRequired,
				'REWARD_CLAIM',
				`Claimed reward: ${reward.name}`,
				LoyaltyPointsTransactionType.SPENT,
				{
					rewardId: reward.uid,
					claimId: savedClaim.uid,
				},
			);

			// Update reward redemption count
			reward.timesRedeemed += 1;
			await this.rewardRepository.save(reward);

			// Reload profile with client relation
			const updatedProfile = await this.loyaltyProfileRepository.findOne({
				where: { uid: profile.uid },
				relations: ['client'],
			});

			// Send reward claimed email and SMS
			if (updatedProfile?.client) {
				await this.sendRewardClaimedEmail(updatedProfile, reward, savedClaim);
				await this.sendRewardClaimedSMS(updatedProfile, reward, savedClaim);
			}

			return {
				message: 'Reward claimed successfully',
				claim: savedClaim,
				voucherCode,
			};
		} catch (error) {
			this.logger.error(`Failed to claim reward: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get loyalty profile by client ID
	 */
	async getProfileByClientId(clientId: number, orgId?: number): Promise<ClientLoyaltyProfile | null> {
		const profile = await this.loyaltyProfileRepository.findOne({
			where: { clientUid: clientId },
			relations: ['client', 'virtualCard', 'transactions', 'rewardClaims'],
		});

		if (profile && orgId && profile.organisationUid !== orgId) {
			return null;
		}

		return profile;
	}

	/**
	 * Update virtual card
	 */
	async updateVirtualCard(
		profileUid: number,
		dto: UpdateVirtualCardDto,
	): Promise<{ message: string; card: VirtualLoyaltyCard }> {
		const profile = await this.loyaltyProfileRepository.findOne({
			where: { uid: profileUid },
			relations: ['virtualCard'],
		});

		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		let card = profile.virtualCard;

		if (!card) {
			// Create new virtual card if doesn't exist
			card = this.virtualCardRepository.create({
				loyaltyProfileUid: profile.uid,
				cardNumber: profile.loyaltyCardNumber,
				isActive: true,
			});
		}

		// Update card properties
		Object.assign(card, dto);
		card = await this.virtualCardRepository.save(card);

		// Regenerate QR code and barcode if requested
		if (dto.showQRCode !== false && (!card.qrCodeUrl || dto.showQRCode === true)) {
			this.generateQRCode(card, profile).catch(err => {
				this.logger.error(`Failed to regenerate QR code: ${err.message}`);
			});
		}

		if (dto.showBarcode !== false && (!card.barcodeUrl || dto.showBarcode === true)) {
			this.generateBarcode(card, card.cardNumber).catch(err => {
				this.logger.error(`Failed to regenerate barcode: ${err.message}`);
			});
		}

		return {
			message: process.env.SUCCESS_MESSAGE || 'Virtual card updated successfully',
			card,
		};
	}

	/**
	 * Complete profile using token
	 */
	async completeProfile(token: string): Promise<{ message: string; profile: ClientLoyaltyProfile }> {
		const profile = await this.loyaltyProfileRepository.findOne({
			where: { profileCompletionToken: token },
		});

		if (!profile) {
			throw new NotFoundException('Invalid or expired token');
		}

		if (profile.profileCompletionTokenExpiry && profile.profileCompletionTokenExpiry < new Date()) {
			throw new BadRequestException('Token has expired');
		}

		if (profile.isProfileComplete) {
			throw new BadRequestException('Profile is already complete');
		}

		profile.isProfileComplete = true;
		profile.profileCompletionToken = null;
		profile.profileCompletionTokenExpiry = null;

		await this.loyaltyProfileRepository.save(profile);

		// Award profile completion points
		const completionPoints = parseFloat(process.env.LOYALTY_PROFILE_COMPLETION_POINTS || '50');
		if (completionPoints > 0) {
			await this.createPointsTransaction(
				profile.uid,
				completionPoints,
				'PROFILE_COMPLETION',
				'Points for completing loyalty profile',
				LoyaltyPointsTransactionType.EARNED,
				{ sourceType: 'profile_completion' },
			);
		}

		return {
			message: 'Profile completed successfully',
			profile,
		};
	}

	/**
	 * Get available rewards
	 */
	async getAvailableRewards(orgId?: string, branchId?: number, tier?: LoyaltyTier): Promise<LoyaltyReward[]> {
		const whereConditions: any = {
			isActive: true,
		};

		if (orgId) {
			whereConditions.organisationUid = orgId;
		}

		if (branchId) {
			whereConditions.branchUid = branchId;
		}

		const rewards = await this.rewardRepository.find({
			where: whereConditions,
			order: { pointsRequired: 'ASC' },
		});

		// Filter by validity dates
		const now = new Date();
		return rewards.filter((reward) => {
			if (reward.validFrom && new Date(reward.validFrom) > now) {
				return false;
			}
			if (reward.validUntil && new Date(reward.validUntil) < now) {
				return false;
			}
			if (reward.usageLimit && reward.timesRedeemed >= reward.usageLimit) {
				return false;
			}
			if (tier && reward.minimumTier) {
				const tierOrder = [LoyaltyTier.BRONZE, LoyaltyTier.SILVER, LoyaltyTier.GOLD, LoyaltyTier.PLATINUM];
				const clientTierIndex = tierOrder.indexOf(tier);
				const requiredTierIndex = tierOrder.indexOf(reward.minimumTier);
				return clientTierIndex >= requiredTierIndex;
			}
			return true;
		});
	}

	/**
	 * Send welcome email
	 */
	private async sendWelcomeEmail(profile: ClientLoyaltyProfile, client: Client): Promise<void> {
		try {
			const portalDomain = process.env.CLIENT_PORTAL_DOMAIN || 'https://portal.loro.co.za';
			const completeProfileLink = `${portalDomain}/loyalty/complete-profile?token=${profile.profileCompletionToken}`;
			const viewRewardsLink = `${portalDomain}/loyalty/rewards`;
			const supportEmail = process.env.SUPPORT_EMAIL || 'support@loro.co.za';

			// Get organization name
			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			this.eventEmitter.emit('send.email', EmailType.LOYALTY_WELCOME, [client.email], {
				name: client.contactPerson || client.name,
				clientName: client.contactPerson || client.name,
				clientEmail: client.email,
				organizationName: orgName,
				cardNumber: profile.loyaltyCardNumber,
				welcomePoints: profile.currentPoints,
				tier: profile.tier.toUpperCase(),
				completeProfileLink,
				viewRewardsLink,
				supportEmail,
			});

			this.logger.log(`Welcome email sent to ${client.email} for loyalty profile ${profile.uid}`);
		} catch (error) {
			this.logger.error(`Failed to send welcome email: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send tier upgrade email
	 */
	private async sendTierUpgradeEmail(
		profile: ClientLoyaltyProfile,
		oldTier: LoyaltyTier,
	): Promise<void> {
		try {
			const client = profile.client;
			if (!client) {
				return;
			}

			const portalDomain = process.env.CLIENT_PORTAL_DOMAIN || 'https://portal.loro.co.za';
			const viewRewardsLink = `${portalDomain}/loyalty/rewards`;
			const supportEmail = process.env.SUPPORT_EMAIL || 'support@loro.co.za';

			// Get organization name
			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			const multiplier = this.TIER_MULTIPLIERS[profile.tier];

			this.eventEmitter.emit('send.email', EmailType.LOYALTY_TIER_UPGRADE, [client.email], {
				name: client.contactPerson || client.name,
				clientName: client.contactPerson || client.name,
				clientEmail: client.email,
				organizationName: orgName,
				oldTier: oldTier.toUpperCase(),
				newTier: profile.tier.toUpperCase(),
				totalPoints: profile.totalPointsEarned,
				multiplier,
				higherMultiplier: multiplier > 1.0,
				birthdayRewards: profile.tier === LoyaltyTier.GOLD || profile.tier === LoyaltyTier.PLATINUM,
				viewRewardsLink,
				supportEmail,
			});

			this.logger.log(`Tier upgrade email sent to ${client.email} for tier upgrade to ${profile.tier}`);
		} catch (error) {
			this.logger.error(`Failed to send tier upgrade email: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send reward claimed email
	 */
	private async sendRewardClaimedEmail(
		profile: ClientLoyaltyProfile,
		reward: LoyaltyReward,
		claim: LoyaltyRewardClaim,
	): Promise<void> {
		try {
			const client = profile.client;
			if (!client) {
				return;
			}

			const portalDomain = process.env.CLIENT_PORTAL_DOMAIN || 'https://portal.loro.co.za';
			const viewRewardsLink = `${portalDomain}/loyalty/rewards`;
			const supportEmail = process.env.SUPPORT_EMAIL || 'support@loro.co.za';

			// Get organization name
			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			this.eventEmitter.emit('send.email', EmailType.LOYALTY_REWARD_CLAIMED, [client.email], {
				name: client.contactPerson || client.name,
				clientName: client.contactPerson || client.name,
				clientEmail: client.email,
				organizationName: orgName,
				rewardName: reward.name,
				voucherCode: claim.voucherCode,
				pointsSpent: claim.pointsSpent,
				remainingPoints: profile.currentPoints,
				discountAmount: reward.discountAmount,
				discountPercentage: reward.discountPercentage,
				expiresAt: claim.expiresAt ? new Date(claim.expiresAt).toLocaleDateString() : undefined,
				viewRewardsLink,
				supportEmail,
			});

			this.logger.log(`Reward claimed email sent to ${client.email} for reward ${reward.uid}`);
		} catch (error) {
			this.logger.error(`Failed to send reward claimed email: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send welcome SMS
	 */
	private async sendWelcomeSMS(profile: ClientLoyaltyProfile, client: Client): Promise<void> {
		try {
			if (!client.phone || !this.smsService.isSMSEnabled()) {
				return;
			}

			// Get organization name
			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			const message = `Welcome to ${orgName} Loyalty Program! Your card number is ${profile.loyaltyCardNumber}. You have ${profile.currentPoints} welcome points. Start earning more today!`;

			const result = await this.smsService.sendSMS({
				to: client.phone,
				message,
				type: SMSType.LOYALTY_WELCOME,
				metadata: {
					profileId: profile.uid,
					cardNumber: profile.loyaltyCardNumber,
					clientId: client.uid,
				},
			});

			if (result.success) {
				this.logger.log(`Welcome SMS sent to ${client.phone} for loyalty profile ${profile.uid}`);
			} else {
				this.logger.warn(`Failed to send welcome SMS: ${result.error}`);
			}
		} catch (error) {
			this.logger.error(`Failed to send welcome SMS: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send points earned SMS
	 */
	private async sendPointsEarnedSMS(
		profile: ClientLoyaltyProfile,
		points: number,
		action: string,
	): Promise<void> {
		try {
			if (!profile.client?.phone || !this.smsService.isSMSEnabled()) {
				return;
			}

			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			const message = `${orgName}: You earned ${points} loyalty points! New balance: ${profile.currentPoints} points. Keep earning to unlock rewards!`;

			const result = await this.smsService.sendSMS({
				to: profile.client.phone,
				message,
				type: SMSType.LOYALTY_POINTS_EARNED,
				metadata: {
					profileId: profile.uid,
					points,
					action,
					newBalance: profile.currentPoints,
				},
			});

			if (result.success) {
				this.logger.log(`Points earned SMS sent to ${profile.client.phone}`);
			} else {
				this.logger.warn(`Failed to send points earned SMS: ${result.error}`);
			}
		} catch (error) {
			this.logger.error(`Failed to send points earned SMS: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send tier upgrade SMS
	 */
	private async sendTierUpgradeSMS(
		profile: ClientLoyaltyProfile,
		oldTier: LoyaltyTier,
	): Promise<void> {
		try {
			if (!profile.client?.phone || !this.smsService.isSMSEnabled()) {
				return;
			}

			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			const multiplier = this.TIER_MULTIPLIERS[profile.tier];
			const message = `🎉 ${orgName}: Congratulations! You've been upgraded to ${profile.tier.toUpperCase()} tier! You now earn ${(multiplier * 100).toFixed(0)}% more points on every purchase. Total points: ${profile.totalPointsEarned}`;

			const result = await this.smsService.sendSMS({
				to: profile.client.phone,
				message,
				type: SMSType.LOYALTY_TIER_UPGRADE,
				metadata: {
					profileId: profile.uid,
					oldTier,
					newTier: profile.tier,
					totalPoints: profile.totalPointsEarned,
					multiplier,
				},
			});

			if (result.success) {
				this.logger.log(`Tier upgrade SMS sent to ${profile.client.phone} for tier upgrade to ${profile.tier}`);
			} else {
				this.logger.warn(`Failed to send tier upgrade SMS: ${result.error}`);
			}
		} catch (error) {
			this.logger.error(`Failed to send tier upgrade SMS: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send reward claimed SMS
	 */
	private async sendRewardClaimedSMS(
		profile: ClientLoyaltyProfile,
		reward: LoyaltyReward,
		claim: LoyaltyRewardClaim,
	): Promise<void> {
		try {
			if (!profile.client?.phone || !this.smsService.isSMSEnabled()) {
				return;
			}

			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			let message = `${orgName}: Reward claimed! ${reward.name} - Voucher: ${claim.voucherCode}. Remaining points: ${profile.currentPoints}`;
			
			if (reward.discountAmount) {
				message += ` Discount: R${reward.discountAmount}`;
			} else if (reward.discountPercentage) {
				message += ` Discount: ${reward.discountPercentage}%`;
			}

			const result = await this.smsService.sendSMS({
				to: profile.client.phone,
				message,
				type: SMSType.LOYALTY_REWARD_CLAIMED,
				metadata: {
					profileId: profile.uid,
					rewardId: reward.uid,
					claimId: claim.uid,
					voucherCode: claim.voucherCode,
					pointsSpent: claim.pointsSpent,
					remainingPoints: profile.currentPoints,
				},
			});

			if (result.success) {
				this.logger.log(`Reward claimed SMS sent to ${profile.client.phone} for reward ${reward.uid}`);
			} else {
				this.logger.warn(`Failed to send reward claimed SMS: ${result.error}`);
			}
		} catch (error) {
			this.logger.error(`Failed to send reward claimed SMS: ${error.message}`, error.stack);
		}
	}

	/**
	 * Generate QR code for loyalty card
	 */
	private async generateQRCode(
		card: VirtualLoyaltyCard,
		profile: ClientLoyaltyProfile,
	): Promise<void> {
		try {
			// QR code data: JSON with card info for scanning
			const qrData = {
				type: 'loyalty_card',
				cardNumber: card.cardNumber,
				profileId: profile.uid,
				clientId: profile.clientUid,
				organizationId: profile.organisationUid,
			};

			const qrDataString = JSON.stringify(qrData);

			// Generate QR code as buffer
			const qrBuffer = await QRCode.toBuffer(qrDataString, {
				errorCorrectionLevel: 'M',
				type: 'png',
				width: 300,
				margin: 2,
				color: {
					dark: '#000000',
					light: '#FFFFFF',
				},
			});

			// Upload to cloud storage
			const fileName = `loyalty/qr-codes/${card.cardNumber}-${Date.now()}.png`;
			const uploadResult = await this.storageService.upload({
				buffer: qrBuffer,
				mimetype: 'image/png',
				originalname: `${card.cardNumber}-qr.png`,
				size: qrBuffer.length,
				metadata: {
					type: 'loyalty_qr_code',
					cardNumber: card.cardNumber,
					profileId: profile.uid.toString(),
				},
			}, fileName);

			// Update card with QR code URL and data
			card.qrCodeUrl = uploadResult.publicUrl;
			card.qrCodeData = qrDataString;
			await this.virtualCardRepository.save(card);

			this.logger.log(`QR code generated for card ${card.cardNumber}`);
		} catch (error) {
			this.logger.error(`Failed to generate QR code: ${error.message}`, error.stack);
		}
	}

	/**
	 * Generate barcode for loyalty card
	 */
	private async generateBarcode(
		card: VirtualLoyaltyCard,
		cardNumber: string,
	): Promise<void> {
		try {
			// Create canvas for barcode
			const canvas = createCanvas(300, 100);
			const ctx = canvas.getContext('2d');

			// Generate barcode using jsbarcode
			JsBarcode(canvas, cardNumber, {
				format: card.barcodeFormat || 'CODE128',
				width: 2,
				height: 60,
				displayValue: true,
				fontSize: 16,
				margin: 10,
			});

			// Convert canvas to buffer
			const barcodeBuffer = canvas.toBuffer('image/png');

			// Upload to cloud storage
			const fileName = `loyalty/barcodes/${cardNumber}-${Date.now()}.png`;
			const uploadResult = await this.storageService.upload({
				buffer: barcodeBuffer,
				mimetype: 'image/png',
				originalname: `${cardNumber}-barcode.png`,
				size: barcodeBuffer.length,
				metadata: {
					type: 'loyalty_barcode',
					cardNumber: cardNumber,
					format: card.barcodeFormat || 'CODE128',
				},
			}, fileName);

			// Update card with barcode URL and data
			card.barcodeUrl = uploadResult.publicUrl;
			card.barcodeData = cardNumber;
			await this.virtualCardRepository.save(card);

			this.logger.log(`Barcode generated for card ${cardNumber}`);
		} catch (error) {
			this.logger.error(`Failed to generate barcode: ${error.message}`, error.stack);
		}
	}

	/**
	 * Get QR code image as buffer
	 */
	async getQRCodeImage(profileUid: number): Promise<Buffer | null> {
		try {
			const profile = await this.loyaltyProfileRepository.findOne({
				where: { uid: profileUid },
				relations: ['virtualCard'],
			});

			if (!profile?.virtualCard?.qrCodeData) {
				return null;
			}

			// Generate QR code from stored data
			const qrBuffer = await QRCode.toBuffer(profile.virtualCard.qrCodeData, {
				errorCorrectionLevel: 'M',
				type: 'png',
				width: 300,
				margin: 2,
			});

			return qrBuffer;
		} catch (error) {
			this.logger.error(`Failed to get QR code image: ${error.message}`, error.stack);
			return null;
		}
	}

	/**
	 * Get barcode image as buffer
	 */
	async getBarcodeImage(profileUid: number): Promise<Buffer | null> {
		try {
			const profile = await this.loyaltyProfileRepository.findOne({
				where: { uid: profileUid },
				relations: ['virtualCard'],
			});

			if (!profile?.virtualCard?.barcodeData) {
				return null;
			}

			// Create canvas for barcode
			const canvas = createCanvas(300, 100);
			const ctx = canvas.getContext('2d');

			// Generate barcode
			JsBarcode(canvas, profile.virtualCard.barcodeData, {
				format: profile.virtualCard.barcodeFormat || 'CODE128',
				width: 2,
				height: 60,
				displayValue: true,
				fontSize: 16,
				margin: 10,
			});

			return canvas.toBuffer('image/png');
		} catch (error) {
			this.logger.error(`Failed to get barcode image: ${error.message}`, error.stack);
			return null;
		}
	}

	/**
	 * Cron job to process delayed follow-up communications (runs every hour)
	 * Sends follow-up emails/SMS 1 day after signup with specials
	 */
	@Cron('0 * * * *') // Run every hour
	async processDelayedFollowUps(): Promise<void> {
		try {
			const followUpDelayHours = parseFloat(process.env.LOYALTY_FOLLOWUP_DELAY_HOURS || '24');
			const cutoffTime = new Date();
			cutoffTime.setHours(cutoffTime.getHours() - followUpDelayHours);

			// Find profiles that need follow-up
			const profilesNeedingFollowUp = await this.loyaltyProfileRepository.find({
				where: [
					{
						signupCompletedAt: LessThan(cutoffTime),
						followUpEmailSentAt: null,
						signupMethod: 'email',
					},
					{
						signupCompletedAt: LessThan(cutoffTime),
						followUpSMSSentAt: null,
						signupMethod: 'phone',
					},
				],
				relations: ['client'],
			});

			if (profilesNeedingFollowUp.length === 0) {
				return;
			}

			this.logger.log(`Processing ${profilesNeedingFollowUp.length} loyalty profiles for delayed follow-up`);

			for (const profile of profilesNeedingFollowUp) {
				try {
					if (!profile.client) {
						continue;
					}

					// Send email follow-up if email signup and not sent yet
					if (profile.signupMethod === 'email' && !profile.followUpEmailSentAt && profile.client.email) {
						await this.sendFollowUpEmail(profile, profile.client);
						profile.followUpEmailSentAt = new Date();
						await this.loyaltyProfileRepository.save(profile);
					}

					// Send SMS follow-up if phone signup and not sent yet
					// Check if phone starts with a number (not email format)
					if (
						profile.signupMethod === 'phone' &&
						!profile.followUpSMSSentAt &&
						profile.client.phone &&
						/^\d/.test(profile.client.phone)
					) {
						await this.sendFollowUpSMS(profile, profile.client);
						profile.followUpSMSSentAt = new Date();
						await this.loyaltyProfileRepository.save(profile);
					}
				} catch (error) {
					this.logger.error(
						`Failed to process follow-up for profile ${profile.uid}: ${error.message}`,
						error.stack,
					);
				}
			}

			this.logger.log(`Completed processing delayed follow-ups for ${profilesNeedingFollowUp.length} profiles`);
		} catch (error) {
			this.logger.error(`Failed to process delayed follow-ups: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send follow-up email with specials link
	 */
	private async sendFollowUpEmail(profile: ClientLoyaltyProfile, client: Client): Promise<void> {
		try {
			const portalDomain = process.env.CLIENT_PORTAL_DOMAIN || 'https://portal.loro.co.za';
			const viewSpecialsLink = `${portalDomain}/loyalty/specials?token=${profile.profileCompletionToken}`;
			const viewRewardsLink = `${portalDomain}/loyalty/rewards`;

			// Get organization name
			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			this.eventEmitter.emit('send.email', EmailType.LOYALTY_SPECIALS_EMAIL, [client.email], {
				name: client.contactPerson || client.name,
				clientName: client.contactPerson || client.name,
				clientEmail: client.email,
				organizationName: orgName,
				cardNumber: profile.loyaltyCardNumber,
				currentPoints: profile.currentPoints,
				tier: profile.tier.toUpperCase(),
				viewSpecialsLink,
				viewRewardsLink,
			});

			this.logger.log(`Follow-up email sent to ${client.email} for loyalty profile ${profile.uid}`);
		} catch (error) {
			this.logger.error(`Failed to send follow-up email: ${error.message}`, error.stack);
		}
	}

	/**
	 * Send follow-up SMS with specials
	 */
	private async sendFollowUpSMS(profile: ClientLoyaltyProfile, client: Client): Promise<void> {
		try {
			if (!client.phone || !this.smsService.isSMSEnabled()) {
				return;
			}

			// Get organization name
			const orgRepo = this.dataSource.getRepository('Organisation');
			const org = await orgRepo.findOne({
				where: { uid: profile.organisationUid },
			});
			const orgName = org?.name || 'Our Organization';

			const message = `${orgName}: Check out our exclusive specials! You have ${profile.currentPoints} points. Visit our store or check your email for special offers. Card: ${profile.loyaltyCardNumber}`;

			const result = await this.smsService.sendSMS({
				to: client.phone,
				message,
				type: SMSType.LOYALTY_SPECIALS,
				metadata: {
					profileId: profile.uid,
					cardNumber: profile.loyaltyCardNumber,
					clientId: client.uid,
					followUpType: 'specials',
				},
			});

			if (result.success) {
				this.logger.log(`Follow-up SMS sent to ${client.phone} for loyalty profile ${profile.uid}`);
			} else {
				this.logger.warn(`Failed to send follow-up SMS: ${result.error}`);
			}
		} catch (error) {
			this.logger.error(`Failed to send follow-up SMS: ${error.message}`, error.stack);
		}
	}

	/**
	 * Convert loyalty points to credit limit
	 */
	async convertPointsToCredit(
		profileUid: number,
		dto: ConvertPointsDto,
	): Promise<{ message: string; conversion: LoyaltyPointsConversion; newCreditLimit: number }> {
		try {
			// Get profile with client
			const profile = await this.loyaltyProfileRepository.findOne({
				where: { uid: profileUid },
				relations: ['client'],
			});

			if (!profile) {
				throw new NotFoundException('Loyalty profile not found');
			}

			if (!profile.client) {
				throw new NotFoundException('Client not found for loyalty profile');
			}

			// Get conversion rate from environment (default: 100 points = 1 ZAR)
			const conversionRate = parseFloat(process.env.LOYALTY_POINTS_TO_CREDIT_RATE || '100');
			const minPointsRequired = conversionRate; // Minimum points to convert

			// Validate minimum points
			if (dto.points < minPointsRequired) {
				throw new BadRequestException(
					`Minimum ${minPointsRequired} points required for conversion (current rate: ${conversionRate} points = 1 currency unit)`,
				);
			}

			// Validate sufficient points
			if (profile.currentPoints < dto.points) {
				throw new BadRequestException(
					`Insufficient points. You have ${profile.currentPoints} points, but trying to convert ${dto.points} points`,
				);
			}

			// Calculate credit amount
			const creditAmount = dto.points / conversionRate;

			// Get current credit limit
			const creditLimitBefore = Number(profile.client.creditLimit) || 0;
			const creditLimitAfter = creditLimitBefore + creditAmount;

			// Create conversion record
			const conversion = this.pointsConversionRepository.create({
				loyaltyProfileUid: profile.uid,
				clientUid: profile.client.uid,
				pointsConverted: dto.points,
				creditAmount,
				conversionRate,
				creditLimitBefore,
				creditLimitAfter,
				reason: dto.reason,
				status: 'completed', // Auto-approve for now, can add approval workflow later
				metadata: {
					originalPoints: profile.currentPoints,
					pointsAfterConversion: profile.currentPoints - dto.points,
					conversionType: 'points_to_credit',
				},
			});

			const savedConversion = await this.pointsConversionRepository.save(conversion);

			// Deduct points from profile
			profile.currentPoints -= dto.points;
			await this.loyaltyProfileRepository.save(profile);

			// Create points transaction record
			await this.createPointsTransaction(
				profile.uid,
				dto.points,
				'POINTS_TO_CREDIT_CONVERSION',
				`Converted ${dto.points} points to R${creditAmount.toFixed(2)} credit`,
				LoyaltyPointsTransactionType.SPENT,
				{
					conversionId: savedConversion.uid,
					creditAmount,
					conversionRate,
					creditLimitBefore,
					creditLimitAfter,
				},
			);

			// Update client credit limit
			profile.client.creditLimit = creditLimitAfter;
			await this.clientRepository.save(profile.client);

			this.logger.log(
				`Points converted: ${dto.points} points to R${creditAmount.toFixed(2)} credit for profile ${profile.uid}`,
			);

			return {
				message: `Successfully converted ${dto.points} points to R${creditAmount.toFixed(2)} credit`,
				conversion: savedConversion,
				newCreditLimit: creditLimitAfter,
			};
		} catch (error) {
			this.logger.error(`Failed to convert points to credit: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Send broadcast message to all loyalty members
	 */
	async sendBroadcast(
		dto: BroadcastMessageDto,
		orgId?: number,
		createdBy?: string,
	): Promise<{ message: string; broadcast: LoyaltyBroadcast; results: any }> {
		try {
			// Build filter conditions
			const whereConditions: any = {
				status: 'active' as any,
			};

			if (orgId || dto.organisationUid) {
				whereConditions.organisationUid = orgId || dto.organisationUid;
			}

			if (dto.branchUid) {
				whereConditions.branchUid = dto.branchUid;
			}

			// Get all matching profiles
			let profiles = await this.loyaltyProfileRepository.find({
				where: whereConditions,
				relations: ['client'],
			});

			// Filter by tier if specified
			if (dto.filterTier && dto.filterTier.length > 0) {
				profiles = profiles.filter((p) => dto.filterTier!.includes(p.tier));
			}

			// Filter out profiles without required contact info
			if (dto.type === 'email') {
				profiles = profiles.filter((p) => p.client?.email);
			} else if (dto.type === 'sms') {
				profiles = profiles.filter((p) => p.client?.phone);
			}

			const totalRecipients = profiles.length;

			// Create broadcast record
			const broadcast = this.broadcastRepository.create({
				type: dto.type,
				subject: dto.subject,
				message: dto.message,
				filterTier: dto.filterTier?.join(',') || null,
				organisationUid: orgId || dto.organisationUid,
				branchUid: dto.branchUid,
				totalRecipients,
				status: 'processing',
				createdBy,
				metadata: {
					filters: {
						tier: dto.filterTier,
						organisationUid: orgId || dto.organisationUid,
						branchUid: dto.branchUid,
					},
					...dto.metadata,
				},
			});

			const savedBroadcast = await this.broadcastRepository.save(broadcast);

			// Send messages in batches to avoid overwhelming the system
			const BATCH_SIZE = 50;
			let sentCount = 0;
			let failedCount = 0;
			const successful: string[] = [];
			const failed: Array<{ recipient: string; error: string }> = [];

			for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
				const batch = profiles.slice(i, i + BATCH_SIZE);

				await Promise.all(
					batch.map(async (profile) => {
						try {
							if (dto.type === 'email' && profile.client?.email) {
								// Send email
								if (dto.emailTemplate) {
									this.eventEmitter.emit(
										'send.email',
										dto.emailTemplate as any,
										[profile.client.email],
										{
											subject: dto.subject,
											message: dto.message,
											clientName: profile.client.contactPerson || profile.client.name,
											cardNumber: profile.loyaltyCardNumber,
											currentPoints: profile.currentPoints,
											tier: profile.tier.toUpperCase(),
											...dto.metadata,
										},
									);
								} else {
									// Simple email send
									this.eventEmitter.emit('send.email', EmailType.LOYALTY_SPECIALS_EMAIL, [profile.client.email], {
										subject: dto.subject,
										message: dto.message,
										clientName: profile.client.contactPerson || profile.client.name,
										...dto.metadata,
									});
								}
								sentCount++;
								successful.push(profile.client.email);
							} else if (dto.type === 'sms' && profile.client?.phone) {
								// Send SMS
								const result = await this.smsService.sendSMS({
									to: profile.client.phone,
									message: `${dto.subject}\n\n${dto.message}`,
									type: SMSType.LOYALTY_BROADCAST,
									metadata: {
										broadcastId: savedBroadcast.uid,
										profileId: profile.uid,
										...dto.metadata,
									},
								});

								if (result.success) {
									sentCount++;
									successful.push(profile.client.phone);
								} else {
									failedCount++;
									failed.push({ recipient: profile.client.phone, error: result.error || 'Unknown error' });
								}
							}
						} catch (error) {
							failedCount++;
							const recipient = dto.type === 'email' ? profile.client?.email : profile.client?.phone;
							failed.push({
								recipient: recipient || 'unknown',
								error: error.message,
							});
							this.logger.error(`Failed to send ${dto.type} to ${recipient}: ${error.message}`);
						}
					}),
				);

				// Small delay between batches to avoid rate limiting
				if (i + BATCH_SIZE < profiles.length) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			}

			// Update broadcast record
			savedBroadcast.sentCount = sentCount;
			savedBroadcast.failedCount = failedCount;
			savedBroadcast.status = failedCount === 0 ? 'completed' : sentCount > 0 ? 'completed' : 'failed';
			savedBroadcast.completedAt = new Date();
			savedBroadcast.metadata = {
				...savedBroadcast.metadata,
				deliveryResults: {
					successful,
					failed,
				},
			};

			await this.broadcastRepository.save(savedBroadcast);

			this.logger.log(
				`Broadcast ${savedBroadcast.uid} completed: ${sentCount} sent, ${failedCount} failed out of ${totalRecipients} recipients`,
			);

			return {
				message: `Broadcast sent to ${sentCount} recipients${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
				broadcast: savedBroadcast,
				results: {
					total: totalRecipients,
					sent: sentCount,
					failedCount,
					successful,
					failed,
				},
			};
		} catch (error) {
			this.logger.error(`Failed to send broadcast: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Get broadcast history
	 */
	async getBroadcastHistory(orgId?: number, limit: number = 50): Promise<LoyaltyBroadcast[]> {
		const whereConditions: any = {};
		if (orgId) {
			whereConditions.organisationUid = orgId;
		}

			return this.broadcastRepository.find({
			where: whereConditions,
			order: { createdAt: 'DESC' },
			take: limit,
		});
	}

	/**
	 * Get transactions with filtering
	 */
	async getTransactions(
		profileUid: number,
		filters?: { startDate?: string; endDate?: string; type?: string },
	): Promise<{ message: string; transactions: LoyaltyPointsTransaction[]; summary: any }> {
		const queryBuilder = this.pointsTransactionRepository
			.createQueryBuilder('transaction')
			.where('transaction.loyaltyProfileUid = :profileUid', { profileUid });

		if (filters?.type) {
			queryBuilder.andWhere('transaction.transactionType = :type', { type: filters.type });
		}

		if (filters?.startDate) {
			queryBuilder.andWhere('transaction.createdAt >= :startDate', { startDate: new Date(filters.startDate) });
		}

		if (filters?.endDate) {
			queryBuilder.andWhere('transaction.createdAt <= :endDate', { endDate: new Date(filters.endDate) });
		}

		queryBuilder.orderBy('transaction.createdAt', 'DESC');

		const transactions = await queryBuilder.getMany();

		// Calculate summary
		const summary = {
			totalEarned: transactions
				.filter((t) => t.transactionType === LoyaltyPointsTransactionType.EARNED)
				.reduce((sum, t) => sum + Number(t.pointsAmount), 0),
			totalSpent: transactions
				.filter((t) => t.transactionType === LoyaltyPointsTransactionType.SPENT)
				.reduce((sum, t) => sum + Number(t.pointsAmount), 0),
			totalExpired: transactions
				.filter((t) => t.transactionType === LoyaltyPointsTransactionType.EXPIRED)
				.reduce((sum, t) => sum + Number(t.pointsAmount), 0),
			totalAdjustments: transactions
				.filter((t) => t.transactionType === LoyaltyPointsTransactionType.ADJUSTMENT)
				.reduce((sum, t) => sum + Number(t.pointsAmount), 0),
			totalTransactions: transactions.length,
		};

		return {
			message: 'Transactions retrieved successfully',
			transactions,
			summary,
		};
	}

	/**
	 * Get comprehensive points summary
	 */
	async getPointsSummary(profileUid: number): Promise<{
		message: string;
		summary: {
			currentPoints: number;
			totalPointsEarned: number;
			totalPointsSpent: number;
			totalPointsExpired: number;
			totalPointsConverted: number;
			tier: string;
			tierUpgradedAt?: Date;
			pointsByCategory: {
				earned: number;
				spent: number;
				expired: number;
				converted: number;
				adjustments: number;
			};
			recentActivity: LoyaltyPointsTransaction[];
		};
	}> {
		const profile = await this.loyaltyProfileRepository.findOne({
			where: { uid: profileUid },
		});

		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		// Get all transactions
		const allTransactions = await this.pointsTransactionRepository.find({
			where: { loyaltyProfileUid: profileUid },
			order: { createdAt: 'DESC' },
		});

		// Get conversions
		const conversions = await this.pointsConversionRepository.find({
			where: { loyaltyProfileUid: profileUid },
		});

		const totalPointsConverted = conversions.reduce((sum, c) => sum + Number(c.pointsConverted), 0);

		// Calculate points by category
		const pointsByCategory = {
			earned: allTransactions
				.filter((t) => t.transactionType === LoyaltyPointsTransactionType.EARNED)
				.reduce((sum, t) => sum + Number(t.pointsAmount), 0),
			spent: allTransactions
				.filter((t) => t.transactionType === LoyaltyPointsTransactionType.SPENT)
				.reduce((sum, t) => sum + Number(t.pointsAmount), 0),
			expired: allTransactions
				.filter((t) => t.transactionType === LoyaltyPointsTransactionType.EXPIRED)
				.reduce((sum, t) => sum + Number(t.pointsAmount), 0),
			converted: totalPointsConverted,
			adjustments: allTransactions
				.filter((t) => t.transactionType === LoyaltyPointsTransactionType.ADJUSTMENT)
				.reduce((sum, t) => sum + Number(t.pointsAmount), 0),
		};

		return {
			message: 'Points summary retrieved successfully',
			summary: {
				currentPoints: Number(profile.currentPoints),
				totalPointsEarned: Number(profile.totalPointsEarned),
				totalPointsSpent: Number(profile.totalPointsSpent),
				totalPointsExpired: 0, // Can be calculated from transactions
				totalPointsConverted,
				tier: profile.tier,
				tierUpgradedAt: profile.tierUpgradedAt,
				pointsByCategory,
				recentActivity: allTransactions.slice(0, 10), // Last 10 transactions
			},
		};
	}

	/**
	 * Get rewards claim history
	 */
	async getRewardsHistory(profileUid: number): Promise<{
		message: string;
		claims: LoyaltyRewardClaim[];
		summary: {
			totalClaims: number;
			totalPointsSpent: number;
			claimsByStatus: Record<string, number>;
		};
	}> {
		const claims = await this.rewardClaimRepository.find({
			where: { loyaltyProfileUid: profileUid },
			relations: ['reward'],
			order: { createdAt: 'DESC' },
		});

		const summary = {
			totalClaims: claims.length,
			totalPointsSpent: claims.reduce((sum, c) => sum + Number(c.pointsSpent), 0),
			claimsByStatus: claims.reduce((acc, c) => {
				acc[c.status] = (acc[c.status] || 0) + 1;
				return acc;
			}, {} as Record<string, number>),
		};

		return {
			message: 'Rewards history retrieved successfully',
			claims,
			summary,
		};
	}
}
