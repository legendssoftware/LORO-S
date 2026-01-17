import { Injectable, NotFoundException, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ClientLoyaltyProfile } from './entities/client-loyalty-profile.entity';
import { LoyaltyPointsTransaction } from './entities/loyalty-points-transaction.entity';
import { LoyaltyReward } from './entities/loyalty-reward.entity';
import { LoyaltyRewardClaim } from './entities/loyalty-reward-claim.entity';
import { VirtualLoyaltyCard } from './entities/virtual-loyalty-card.entity';
import { Client } from '../clients/entities/client.entity';
import { LoyaltyTier, LoyaltyPointsTransactionType, LoyaltyRewardClaimStatus } from '../lib/enums/loyalty.enums';
import { CreateLoyaltyProfileDto } from './dto/create-loyalty-profile.dto';
import { ExternalEnrollDto } from './dto/external-enroll.dto';
import { AwardLoyaltyPointsDto } from './dto/award-loyalty-points.dto';
import { ClaimRewardDto } from './dto/claim-reward.dto';
import { UpdateVirtualCardDto } from './dto/update-virtual-card.dto';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { EmailType } from '../lib/enums/email.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorageService } from '../lib/services/storage.service';
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
		@InjectRepository(VirtualLoyaltyCard)
		private virtualCardRepository: Repository<VirtualLoyaltyCard>,
		@InjectRepository(Client)
		private clientRepository: Repository<Client>,
		@InjectDataSource()
		private dataSource: DataSource,
		private readonly eventEmitter: EventEmitter2,
		private readonly unifiedNotificationService: UnifiedNotificationService,
		private readonly storageService: StorageService,
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

		// Try to find existing client
		const whereConditions: any = {};
		if (email) whereConditions.email = email;
		if (phone) whereConditions.phone = phone;
		if (orgId) whereConditions.organisationUid = orgId;

		let client = await this.clientRepository.findOne({
			where: whereConditions,
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
			organisationUid: orgId,
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
				client = await this.clientRepository.findOne({
					where: { uid: clientId, organisationUid: orgId },
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

			// Send welcome email if requested
			if (dto.sendWelcomeMessage !== false) {
				await this.sendWelcomeEmail(savedProfile, client);
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
			profile.tier = newTier;
			profile.tierUpgradedAt = new Date();
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
			});

			const tierUpgraded = updatedProfile.tier !== oldTier;

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

			// Send reward claimed email
			if (updatedProfile?.client) {
				await this.sendRewardClaimedEmail(updatedProfile, reward, savedClaim);
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
	async getAvailableRewards(orgId?: number, branchId?: number, tier?: LoyaltyTier): Promise<LoyaltyReward[]> {
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
}
