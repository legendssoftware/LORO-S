import { IsNotEmpty, IsString, IsNumber, IsOptional, IsEmail, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AwardLoyaltyPointsDto {
	@ApiProperty({
		description: 'Loyalty card number, phone, or email to identify the client',
		example: 'LOY-123456789'
	})
	@IsString()
	@IsNotEmpty()
	identifier: string;

	@ApiProperty({
		description: 'Points amount to award',
		example: 100
	})
	@IsNumber()
	@IsNotEmpty()
	points: number;

	@ApiProperty({
		description: 'Action that triggered the points award',
		example: 'PURCHASE'
	})
	@IsString()
	@IsNotEmpty()
	action: string;

	@ApiPropertyOptional({
		description: 'Description of the transaction',
		example: 'Purchase of R1000 worth of products'
	})
	@IsString()
	@IsOptional()
	description?: string;

	@ApiPropertyOptional({
		description: 'Source information',
		example: {
			orderId: 'ORD-12345',
			purchaseAmount: 1000,
			pointsMultiplier: 0.1
		}
	})
	@IsObject()
	@IsOptional()
	source?: {
		id?: string;
		type?: string;
		orderId?: string;
		purchaseAmount?: number;
		pointsMultiplier?: number;
		details?: any;
	};

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
