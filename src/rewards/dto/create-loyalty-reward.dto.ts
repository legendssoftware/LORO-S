import { IsNotEmpty, IsString, IsNumber, IsOptional, IsBoolean, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoyaltyRewardType, LoyaltyTier } from '../../lib/enums/loyalty.enums';

export class CreateLoyaltyRewardDto {
	@ApiProperty({
		description: 'Reward name',
		example: '10% Off Next Purchase'
	})
	@IsString()
	@IsNotEmpty()
	name: string;

	@ApiPropertyOptional({
		description: 'Reward description',
		example: 'Get 10% discount on your next purchase'
	})
	@IsString()
	@IsOptional()
	description?: string;

	@ApiProperty({
		description: 'Reward type',
		enum: LoyaltyRewardType,
		example: LoyaltyRewardType.PERCENTAGE_DISCOUNT
	})
	@IsEnum(LoyaltyRewardType)
	@IsNotEmpty()
	rewardType: LoyaltyRewardType;

	@ApiProperty({
		description: 'Points required to claim this reward',
		example: 500
	})
	@IsNumber()
	@IsNotEmpty()
	pointsRequired: number;

	@ApiPropertyOptional({
		description: 'Discount percentage (for percentage_discount type)',
		example: 10
	})
	@IsNumber()
	@IsOptional()
	discountPercentage?: number;

	@ApiPropertyOptional({
		description: 'Discount amount (for fixed_discount type)',
		example: 50
	})
	@IsNumber()
	@IsOptional()
	discountAmount?: number;

	@ApiPropertyOptional({
		description: 'Free item name (for free_item type)',
		example: 'Free Coffee'
	})
	@IsString()
	@IsOptional()
	freeItemName?: string;

	@ApiPropertyOptional({
		description: 'Free item SKU (for free_item type)',
		example: 'COFFEE-001'
	})
	@IsString()
	@IsOptional()
	freeItemSku?: string;

	@ApiPropertyOptional({
		description: 'Cashback amount (for cashback type)',
		example: 25
	})
	@IsNumber()
	@IsOptional()
	cashbackAmount?: number;

	@ApiPropertyOptional({
		description: 'Minimum tier required',
		enum: LoyaltyTier,
		example: LoyaltyTier.SILVER
	})
	@IsEnum(LoyaltyTier)
	@IsOptional()
	minimumTier?: LoyaltyTier;

	@ApiPropertyOptional({
		description: 'Reward icon URL',
		example: 'https://example.com/icon.png'
	})
	@IsString()
	@IsOptional()
	icon?: string;

	@ApiPropertyOptional({
		description: 'Reward image URL',
		example: 'https://example.com/image.png'
	})
	@IsString()
	@IsOptional()
	imageUrl?: string;

	@ApiPropertyOptional({
		description: 'Whether reward is active',
		example: true,
		default: true
	})
	@IsBoolean()
	@IsOptional()
	isActive?: boolean;

	@ApiPropertyOptional({
		description: 'Total usage limit (null for unlimited)',
		example: 100
	})
	@IsNumber()
	@IsOptional()
	usageLimit?: number;

	@ApiPropertyOptional({
		description: 'Valid from date',
		example: '2024-01-01T00:00:00Z'
	})
	@IsDateString()
	@IsOptional()
	validFrom?: string;

	@ApiPropertyOptional({
		description: 'Valid until date',
		example: '2024-12-31T23:59:59Z'
	})
	@IsDateString()
	@IsOptional()
	validUntil?: string;

	@ApiPropertyOptional({
		description: 'Max redemptions per client',
		example: 1
	})
	@IsNumber()
	@IsOptional()
	maxRedemptionsPerClient?: number;

	@ApiPropertyOptional({
		description: 'Organization ID',
		example: 1
	})
	@IsNumber()
	@IsOptional()
	organisationUid?: number;

	@ApiPropertyOptional({
		description: 'Branch ID',
		example: 1
	})
	@IsNumber()
	@IsOptional()
	branchUid?: number;
}
