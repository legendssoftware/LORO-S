import { IsNotEmpty, IsString, IsOptional, IsEnum, IsNumber, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoyaltyTier } from '../../lib/enums/loyalty.enums';

export class BroadcastMessageDto {
	@ApiProperty({
		description: 'Type of broadcast (email or sms)',
		example: 'email',
		enum: ['email', 'sms'],
	})
	@IsEnum(['email', 'sms'])
	@IsNotEmpty()
	type: 'email' | 'sms';

	@ApiProperty({
		description: 'Subject line (for email) or title (for SMS)',
		example: 'Special Offers This Week!',
	})
	@IsString()
	@IsNotEmpty()
	subject: string;

	@ApiProperty({
		description: 'Message content',
		example: 'Check out our exclusive specials this week!',
	})
	@IsString()
	@IsNotEmpty()
	message: string;

	@ApiPropertyOptional({
		description: 'Filter by loyalty tier',
		example: ['BRONZE', 'SILVER'],
		enum: LoyaltyTier,
		isArray: true,
	})
	@IsOptional()
	@IsArray()
	@IsEnum(LoyaltyTier, { each: true })
	filterTier?: LoyaltyTier[];

	@ApiPropertyOptional({
		description: 'Filter by organization ID',
		example: 1,
	})
	@IsOptional()
	@IsNumber()
	organisationUid?: number;

	@ApiPropertyOptional({
		description: 'Filter by branch ID',
		example: 1,
	})
	@IsOptional()
	@IsNumber()
	branchUid?: number;

	@ApiPropertyOptional({
		description: 'Email template type (if type is email)',
		example: 'LOYALTY_SPECIALS_EMAIL',
	})
	@IsOptional()
	@IsString()
	emailTemplate?: string;

	@ApiPropertyOptional({
		description: 'Additional metadata for the broadcast',
		example: {},
	})
	@IsOptional()
	metadata?: Record<string, any>;
}
