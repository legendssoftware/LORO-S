import {
	Controller,
	Get,
	Post,
	Body,
	Param,
	UseGuards,
	Req,
	ParseIntPipe,
	Headers,
	Query,
	Patch,
	Res,
	NotFoundException,
	BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { LoyaltyService } from './loyalty.service';
import { ExternalEnrollDto } from './dto/external-enroll.dto';
import { AwardLoyaltyPointsDto } from './dto/award-loyalty-points.dto';
import { ClaimRewardDto } from './dto/claim-reward.dto';
import { UpdateVirtualCardDto } from './dto/update-virtual-card.dto';
import { CreateLoyaltyRewardDto } from './dto/create-loyalty-reward.dto';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { LoyaltyApiKeyGuard } from '../guards/loyalty-api-key.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthenticatedRequest, getClerkOrgId } from '../lib/interfaces/authenticated-request.interface';
import { OrganisationService } from '../organisation/organisation.service';
import {
	ApiOperation,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiHeader,
	ApiBearerAuth,
} from '@nestjs/swagger';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('🎁 Loyalty')
@Controller('loyalty')
@EnterpriseOnly('rewards')
export class LoyaltyController {
	constructor(
		private readonly loyaltyService: LoyaltyService,
		private readonly organisationService: OrganisationService,
	) {}

	private async resolveOrgUid(req: AuthenticatedRequest): Promise<number> {
		const clerkOrgId = getClerkOrgId(req);
		if (!clerkOrgId) {
			throw new BadRequestException('Organization context required');
		}
		const uid = await this.organisationService.findUidByClerkId(clerkOrgId);
		if (uid == null) {
			throw new BadRequestException('Organization not found');
		}
		return uid;
	}

	// ========== PUBLIC ERP/POS ENDPOINTS ==========

	@Post('external/enroll')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Enroll client in loyalty program (ERP/POS)',
		description: 'Public endpoint for ERP/POS systems to enroll clients. Creates client if needed and sends welcome message.',
	})
	@ApiHeader({
		name: 'X-LOYALTY-API-Key',
		description: 'API key for loyalty system access',
		required: true,
	})
	@ApiBody({ type: ExternalEnrollDto })
	@ApiCreatedResponse({
		description: 'Client enrolled successfully',
	})
	@ApiBadRequestResponse({ description: 'Invalid input data' })
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async externalEnroll(
		@Body() dto: ExternalEnrollDto,
		@Headers('X-LOYALTY-API-Key') apiKey: string,
	) {
		return this.loyaltyService.externalEnroll(dto, dto.organisationUid, dto.branchUid);
	}

	@Post('external/award-points')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Award loyalty points (ERP/POS)',
		description: 'Public endpoint for ERP/POS systems to award points for purchases or actions.',
	})
	@ApiHeader({
		name: 'X-LOYALTY-API-Key',
		description: 'API key for loyalty system access',
		required: true,
	})
	@ApiBody({ type: AwardLoyaltyPointsDto })
	@ApiCreatedResponse({
		description: 'Points awarded successfully',
	})
	@ApiBadRequestResponse({ description: 'Invalid input data' })
	@ApiNotFoundResponse({ description: 'Loyalty profile not found' })
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async externalAwardPoints(
		@Body() dto: AwardLoyaltyPointsDto,
		@Headers('X-LOYALTY-API-Key') apiKey: string,
	) {
		return this.loyaltyService.awardPoints(dto, dto.organisationUid);
	}

	@Get('external/profile/:identifier')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Get loyalty profile by identifier (ERP/POS)',
		description: 'Public endpoint to get loyalty profile by card number, phone, email, or client ID.',
	})
	@ApiHeader({
		name: 'X-LOYALTY-API-Key',
		description: 'API key for loyalty system access',
		required: true,
	})
	@ApiParam({
		name: 'identifier',
		description: 'Loyalty card number, phone, email, or client ID',
		example: 'LOY-2024-123456',
	})
	@ApiOkResponse({
		description: 'Profile retrieved successfully',
	})
	@ApiNotFoundResponse({ description: 'Profile not found' })
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async getProfileByIdentifier(
		@Param('identifier') identifier: string,
		@Query('orgId') orgId?: number,
		@Headers('X-LOYALTY-API-Key') apiKey?: string,
	) {
		const profile = await this.loyaltyService.findProfileByIdentifier(identifier, orgId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}
		return {
			message: 'Profile retrieved successfully',
			profile,
		};
	}

	// ========== CLIENT AUTHENTICATED ENDPOINTS ==========

	@Get('my-profile')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get own loyalty profile',
		description: 'Get the authenticated client\'s loyalty profile with points, tier, and virtual card.',
	})
	@ApiOkResponse({
		description: 'Profile retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getMyProfile(@Req() req: AuthenticatedRequest) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found. Please enroll in the loyalty program.');
		}

		return {
			message: 'Profile retrieved successfully',
			profile,
		};
	}

	@Get('rewards')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get available rewards',
		description: 'Get list of rewards available to the authenticated client based on their tier.',
	})
	@ApiOkResponse({
		description: 'Rewards retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getAvailableRewards(@Req() req: AuthenticatedRequest) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;

		const rewards = await this.loyaltyService.getAvailableRewards(
			orgId,
			branchId,
			profile?.tier,
		);

		return {
			message: 'Rewards retrieved successfully',
			rewards,
		};
	}

	@Get('transactions')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get points transaction history',
		description: 'Get transaction history for the authenticated client.',
	})
	@ApiOkResponse({
		description: 'Transactions retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getTransactions(@Req() req: AuthenticatedRequest) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		return {
			message: 'Transactions retrieved successfully',
			transactions: profile.transactions || [],
		};
	}

	@Post('rewards/:rewardId/claim')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Claim a reward',
		description: 'Claim a reward using loyalty points. Returns voucher code.',
	})
	@ApiParam({
		name: 'rewardId',
		description: 'Reward ID to claim',
		type: Number,
	})
	@ApiBody({ type: ClaimRewardDto })
	@ApiCreatedResponse({
		description: 'Reward claimed successfully',
	})
	@ApiBadRequestResponse({ description: 'Insufficient points or invalid reward' })
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async claimReward(
		@Param('rewardId', ParseIntPipe) rewardId: number,
		@Body() dto: ClaimRewardDto,
		@Req() req: AuthenticatedRequest,
	) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		dto.rewardId = rewardId;
		return this.loyaltyService.claimReward(profile.uid, dto);
	}

	@Patch('virtual-card')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Update virtual card customization',
		description: 'Update virtual loyalty card appearance and settings.',
	})
	@ApiBody({ type: UpdateVirtualCardDto })
	@ApiOkResponse({
		description: 'Virtual card updated successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async updateVirtualCard(
		@Body() dto: UpdateVirtualCardDto,
		@Req() req: AuthenticatedRequest,
	) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		return this.loyaltyService.updateVirtualCard(profile.uid, dto);
	}

	@Get('qr-code')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get QR code image',
		description: 'Get QR code image for the authenticated client\'s loyalty card.',
	})
	@ApiOkResponse({
		description: 'QR code image returned',
		content: {
			'image/png': {
				schema: {
					type: 'string',
					format: 'binary',
				},
			},
		},
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getQRCode(@Req() req: AuthenticatedRequest, @Res() res: Response) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		const qrBuffer = await this.loyaltyService.getQRCodeImage(profile.uid);
		if (!qrBuffer) {
			throw new NotFoundException('QR code not found');
		}

		res.setHeader('Content-Type', 'image/png');
		res.setHeader('Content-Disposition', `inline; filename="loyalty-qr-${profile.loyaltyCardNumber}.png"`);
		res.send(qrBuffer);
	}

	@Get('barcode')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get barcode image',
		description: 'Get barcode image for the authenticated client\'s loyalty card.',
	})
	@ApiOkResponse({
		description: 'Barcode image returned',
		content: {
			'image/png': {
				schema: {
					type: 'string',
					format: 'binary',
				},
			},
		},
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getBarcode(@Req() req: AuthenticatedRequest, @Res() res: Response) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		const barcodeBuffer = await this.loyaltyService.getBarcodeImage(profile.uid);
		if (!barcodeBuffer) {
			throw new NotFoundException('Barcode not found');
		}

		res.setHeader('Content-Type', 'image/png');
		res.setHeader('Content-Disposition', `inline; filename="loyalty-barcode-${profile.loyaltyCardNumber}.png"`);
		res.send(barcodeBuffer);
	}

	@Get('external/qr-code/:identifier')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Get QR code image by identifier (ERP/POS)',
		description: 'Public endpoint to get QR code image by card number, phone, email, or client ID.',
	})
	@ApiHeader({
		name: 'X-LOYALTY-API-Key',
		description: 'API key for loyalty system access',
		required: true,
	})
	@ApiParam({
		name: 'identifier',
		description: 'Loyalty card number, phone, email, or client ID',
		example: 'LOY-2024-123456',
	})
	@ApiOkResponse({
		description: 'QR code image returned',
		content: {
			'image/png': {
				schema: {
					type: 'string',
					format: 'binary',
				},
			},
		},
	})
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async getQRCodeByIdentifier(
		@Param('identifier') identifier: string,
		@Res() res: Response,
		@Query('orgId') orgId?: number,
		@Headers('X-LOYALTY-API-Key') apiKey?: string,
	) {
		const profile = await this.loyaltyService.findProfileByIdentifier(identifier, orgId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		const qrBuffer = await this.loyaltyService.getQRCodeImage(profile.uid);
		if (!qrBuffer) {
			throw new NotFoundException('QR code not found');
		}

		res.setHeader('Content-Type', 'image/png');
		res.setHeader('Content-Disposition', `inline; filename="loyalty-qr-${profile.loyaltyCardNumber}.png"`);
		res.send(qrBuffer);
	}

	@Get('external/barcode/:identifier')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Get barcode image by identifier (ERP/POS)',
		description: 'Public endpoint to get barcode image by card number, phone, email, or client ID.',
	})
	@ApiHeader({
		name: 'X-LOYALTY-API-Key',
		description: 'API key for loyalty system access',
		required: true,
	})
	@ApiParam({
		name: 'identifier',
		description: 'Loyalty card number, phone, email, or client ID',
		example: 'LOY-2024-123456',
	})
	@ApiOkResponse({
		description: 'Barcode image returned',
		content: {
			'image/png': {
				schema: {
					type: 'string',
					format: 'binary',
				},
			},
		},
	})
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async getBarcodeByIdentifier(
		@Param('identifier') identifier: string,
		@Res() res: Response,
		@Query('orgId') orgId?: number,
		@Headers('X-LOYALTY-API-Key') apiKey?: string,
	) {
		const profile = await this.loyaltyService.findProfileByIdentifier(identifier, orgId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		const barcodeBuffer = await this.loyaltyService.getBarcodeImage(profile.uid);
		if (!barcodeBuffer) {
			throw new NotFoundException('Barcode not found');
		}

		res.setHeader('Content-Type', 'image/png');
		res.setHeader('Content-Disposition', `inline; filename="loyalty-barcode-${profile.loyaltyCardNumber}.png"`);
		res.send(barcodeBuffer);
	}

	@Post('complete-profile')
	@ApiOperation({
		summary: 'Complete loyalty profile',
		description: 'Complete profile using token from welcome email.',
	})
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				token: { type: 'string', example: 'abc123...' },
			},
		},
	})
	@ApiOkResponse({
		description: 'Profile completed successfully',
	})
	@ApiBadRequestResponse({ description: 'Invalid or expired token' })
	async completeProfile(@Body('token') token: string) {
		return this.loyaltyService.completeProfile(token);
	}

	// ========== ADMIN ENDPOINTS ==========

	@Get('profiles')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'List all loyalty profiles (Admin)',
		description: 'Get all loyalty profiles in the organization.',
	})
	@ApiOkResponse({
		description: 'Profiles retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getAllProfiles(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = req.user?.branch?.uid;

		const profiles = await this.loyaltyService['loyaltyProfileRepository'].find({
			where: {
				...(orgId != null && { organisationUid: orgId }),
				...(branchId && { branchUid: branchId }),
			},
			relations: ['client', 'virtualCard'],
		});

		return {
			message: 'Profiles retrieved successfully',
			profiles,
		};
	}

	@Post('rewards')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Create reward definition (Admin)',
		description: 'Create a new reward that clients can claim.',
	})
	@ApiBody({ type: CreateLoyaltyRewardDto })
	@ApiCreatedResponse({
		description: 'Reward created successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async createReward(
		@Body() dto: CreateLoyaltyRewardDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = req.user?.branch?.uid;

		const reward = this.loyaltyService['rewardRepository'].create({
			...dto,
			organisationUid: orgId ?? dto.organisationUid,
			branchUid: branchId ?? dto.branchUid,
			validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
			validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
		});

		const savedReward = await this.loyaltyService['rewardRepository'].save(reward);

		return {
			message: 'Reward created successfully',
			reward: savedReward,
		};
	}

	@Get('analytics')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get loyalty program analytics (Admin)',
		description: 'Get analytics and metrics for the loyalty program.',
	})
	@ApiOkResponse({
		description: 'Analytics retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getAnalytics(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = req.user?.branch?.uid;

		const whereConditions: any = {};
		if (orgId != null) whereConditions.organisationUid = orgId;
		if (branchId) whereConditions.branchUid = branchId;

		const [
			totalProfiles,
			totalPointsEarned,
			totalPointsSpent,
			tierDistribution,
			recentTransactions,
		] = await Promise.all([
			this.loyaltyService['loyaltyProfileRepository'].count({ where: whereConditions }),
			this.loyaltyService['loyaltyProfileRepository']
				.createQueryBuilder('profile')
				.select('SUM(profile.totalPointsEarned)', 'total')
				.where(whereConditions)
				.getRawOne(),
			this.loyaltyService['loyaltyProfileRepository']
				.createQueryBuilder('profile')
				.select('SUM(profile.totalPointsSpent)', 'total')
				.where(whereConditions)
				.getRawOne(),
			this.loyaltyService['loyaltyProfileRepository']
				.createQueryBuilder('profile')
				.select('profile.tier', 'tier')
				.addSelect('COUNT(*)', 'count')
				.where(whereConditions)
				.groupBy('profile.tier')
				.getRawMany(),
			this.loyaltyService['pointsTransactionRepository'].find({
				where: {},
				order: { createdAt: 'DESC' },
				take: 10,
			}),
		]);

		return {
			message: 'Analytics retrieved successfully',
			analytics: {
				totalProfiles,
				totalPointsEarned: parseFloat(totalPointsEarned?.total || '0'),
				totalPointsSpent: parseFloat(totalPointsSpent?.total || '0'),
				tierDistribution,
				recentTransactions,
			},
		};
	}
}
