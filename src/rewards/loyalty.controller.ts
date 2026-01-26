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
import { ConvertPointsDto } from './dto/convert-points.dto';
import { BroadcastMessageDto } from './dto/broadcast-message.dto';
import { BulkAwardPointsDto } from './dto/bulk-award-points.dto';
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

	@Post('external/bulk-award-points')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Bulk award loyalty points (ERP/POS)',
		description: 'Award points to multiple profiles in a single request. Optimized for batch processing.',
	})
	@ApiHeader({
		name: 'X-LOYALTY-API-Key',
		description: 'API key for loyalty system access',
		required: true,
	})
	@ApiBody({ type: BulkAwardPointsDto })
	@ApiCreatedResponse({
		description: 'Points awarded successfully',
	})
	@ApiBadRequestResponse({ description: 'Invalid input data' })
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async bulkAwardPoints(
		@Body() dto: BulkAwardPointsDto,
		@Headers('X-LOYALTY-API-Key') apiKey: string,
	) {
		return this.loyaltyService.bulkAwardPoints(dto.awards, dto.organisationUid);
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

	@Post('external/quick-enroll')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Quick enrollment from POS (ERP/POS)',
		description: 'Faster enrollment endpoint that only requires email or phone. Optimized for till operations.',
	})
	@ApiHeader({
		name: 'X-LOYALTY-API-Key',
		description: 'API key for loyalty system access',
		required: true,
	})
	@ApiBody({
		schema: {
			type: 'object',
			required: ['email', 'phone'],
			properties: {
				email: { type: 'string', example: 'customer@example.com' },
				phone: { type: 'string', example: '+27123456789' },
				name: { type: 'string', example: 'John Doe' },
				organisationUid: { type: 'number', example: 1 },
				branchUid: { type: 'number', example: 1 },
			},
		},
	})
	@ApiCreatedResponse({
		description: 'Client enrolled successfully',
	})
	@ApiBadRequestResponse({ description: 'Invalid input data' })
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async quickEnroll(
		@Body() dto: { email?: string; phone?: string; name?: string; organisationUid?: number; branchUid?: number },
		@Headers('X-LOYALTY-API-Key') apiKey: string,
	) {
		if (!dto.email && !dto.phone) {
			throw new BadRequestException('Either email or phone must be provided');
		}

		const enrollDto: ExternalEnrollDto = {
			email: dto.email,
			phone: dto.phone,
			name: dto.name,
			organisationUid: dto.organisationUid,
			branchUid: dto.branchUid,
			sendWelcomeMessage: false, // Skip welcome message for faster processing
		};

		return this.loyaltyService.externalEnroll(enrollDto, dto.organisationUid, dto.branchUid);
	}

	@Get('external/points-history/:identifier')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Get points transaction history (ERP/POS)',
		description: 'Get transaction history for a loyalty profile by identifier.',
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
		description: 'Transaction history retrieved successfully',
	})
	@ApiNotFoundResponse({ description: 'Profile not found' })
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async getPointsHistory(
		@Param('identifier') identifier: string,
		@Query('orgId') orgId?: number,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Headers('X-LOYALTY-API-Key') apiKey?: string,
	) {
		const profile = await this.loyaltyService.findProfileByIdentifier(identifier, orgId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		return this.loyaltyService.getTransactions(profile.uid, { startDate, endDate });
	}

	@Get('external/balance/:identifier')
	@UseGuards(LoyaltyApiKeyGuard)
	@ApiOperation({
		summary: 'Get real-time points balance (ERP/POS)',
		description: 'Get current points balance for a loyalty profile by identifier. Optimized for fast POS lookups.',
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
		description: 'Balance retrieved successfully',
	})
	@ApiNotFoundResponse({ description: 'Profile not found' })
	@ApiUnauthorizedResponse({ description: 'Invalid or missing API key' })
	async getBalance(
		@Param('identifier') identifier: string,
		@Query('orgId') orgId?: number,
		@Headers('X-LOYALTY-API-Key') apiKey?: string,
	) {
		const profile = await this.loyaltyService.findProfileByIdentifier(identifier, orgId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		return {
			message: 'Balance retrieved successfully',
			cardNumber: profile.loyaltyCardNumber,
			currentPoints: Number(profile.currentPoints),
			tier: profile.tier,
			totalPointsEarned: Number(profile.totalPointsEarned),
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
		description: 'Get transaction history for the authenticated client with optional date range filtering.',
	})
	@ApiOkResponse({
		description: 'Transactions retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getTransactions(
		@Req() req: AuthenticatedRequest,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('type') type?: string,
	) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		return this.loyaltyService.getTransactions(profile.uid, { startDate, endDate, type });
	}

	@Get('my-points-summary')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get detailed points summary',
		description: 'Get comprehensive points breakdown including earned, spent, expired, and converted points.',
	})
	@ApiOkResponse({
		description: 'Points summary retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getPointsSummary(@Req() req: AuthenticatedRequest) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		return this.loyaltyService.getPointsSummary(profile.uid);
	}

	@Get('my-rewards-history')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get reward claim history',
		description: 'Get history of all rewards claimed by the authenticated client.',
	})
	@ApiOkResponse({
		description: 'Rewards history retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getRewardsHistory(@Req() req: AuthenticatedRequest) {
		const clientId = req.user?.uid;
		if (!clientId) {
			throw new NotFoundException('Client ID not found in token');
		}

		const profile = await this.loyaltyService.getProfileByClientId(clientId);
		if (!profile) {
			throw new NotFoundException('Loyalty profile not found');
		}

		return this.loyaltyService.getRewardsHistory(profile.uid);
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

	@Post('convert-to-credit')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Convert loyalty points to credit limit',
		description: 'Convert loyalty points to increase client credit limit. Conversion rate is configurable via environment variable.',
	})
	@ApiBody({ type: ConvertPointsDto })
	@ApiCreatedResponse({
		description: 'Points converted successfully',
	})
	@ApiBadRequestResponse({ description: 'Insufficient points or invalid request' })
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async convertPointsToCredit(
		@Body() dto: ConvertPointsDto,
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

		return this.loyaltyService.convertPointsToCredit(profile.uid, dto);
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

	@Post('broadcast/email')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Send broadcast email to loyalty members (Admin)',
		description: 'Send email broadcast to all loyalty members with optional filtering by tier, organization, or branch.',
	})
	@ApiBody({ type: BroadcastMessageDto })
	@ApiCreatedResponse({
		description: 'Broadcast sent successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async sendBroadcastEmail(
		@Body() dto: BroadcastMessageDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = await this.resolveOrgUid(req);
		const createdBy = req.user?.clerkUserId || 'system';

		if (dto.type !== 'email') {
			throw new BadRequestException('This endpoint is for email broadcasts only');
		}

		return this.loyaltyService.sendBroadcast(dto, orgId, createdBy);
	}

	@Post('broadcast/sms')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Send broadcast SMS to loyalty members (Admin)',
		description: 'Send SMS broadcast to all loyalty members with optional filtering by tier, organization, or branch.',
	})
	@ApiBody({ type: BroadcastMessageDto })
	@ApiCreatedResponse({
		description: 'Broadcast sent successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async sendBroadcastSMS(
		@Body() dto: BroadcastMessageDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = await this.resolveOrgUid(req);
		const createdBy = req.user?.clerkUserId || 'system';

		if (dto.type !== 'sms') {
			throw new BadRequestException('This endpoint is for SMS broadcasts only');
		}

		return this.loyaltyService.sendBroadcast(dto, orgId, createdBy);
	}

	@Get('broadcast/history')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: 'Get broadcast history (Admin)',
		description: 'Get history of all broadcast messages sent.',
	})
	@ApiOkResponse({
		description: 'Broadcast history retrieved successfully',
	})
	@ApiUnauthorizedResponse({ description: 'Authentication required' })
	async getBroadcastHistory(
		@Req() req: AuthenticatedRequest,
		@Query('limit') limit?: number,
	) {
		const orgId = await this.resolveOrgUid(req);
		const broadcasts = await this.loyaltyService.getBroadcastHistory(orgId, limit ? parseInt(limit.toString()) : 50);

		return {
			message: 'Broadcast history retrieved successfully',
			broadcasts,
		};
	}
}
