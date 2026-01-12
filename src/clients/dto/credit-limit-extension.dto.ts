import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/**
 * DTO for requesting a credit limit extension
 */
export class CreditLimitExtensionDto {
	@IsNumber()
	@Min(0, { message: 'Requested limit must be greater than or equal to 0' })
	@ApiProperty({
		example: 100000,
		description: 'The requested credit limit amount',
		minimum: 0,
	})
	requestedLimit: number;

	@IsOptional()
	@IsString()
	@MaxLength(1000, { message: 'Reason must not exceed 1000 characters' })
	@ApiPropertyOptional({
		example: 'Increased order volume requires higher credit limit for Q2 2024',
		description: 'Optional reason for the credit limit extension request',
		maxLength: 1000,
	})
	reason?: string;
}
