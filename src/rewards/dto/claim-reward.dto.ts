import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClaimRewardDto {
	@ApiProperty({
		description: 'Reward ID to claim',
		example: 1
	})
	@IsNumber()
	@IsNotEmpty()
	rewardId: number;

	@ApiPropertyOptional({
		description: 'Order ID if claiming during checkout',
		example: 'ORD-12345'
	})
	@IsString()
	@IsOptional()
	orderId?: string;

	@ApiPropertyOptional({
		description: 'Additional metadata',
		example: {}
	})
	@IsOptional()
	metadata?: any;
}
