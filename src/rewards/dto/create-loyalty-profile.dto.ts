import { IsOptional, IsString, IsEmail, IsNumber, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLoyaltyProfileDto {
	@ApiProperty({
		description: 'Client email address',
		example: 'client@example.com'
	})
	@IsEmail()
	@IsOptional()
	email?: string;

	@ApiProperty({
		description: 'Client phone number',
		example: '+27123456789'
	})
	@IsString()
	@IsOptional()
	phone?: string;

	@ApiPropertyOptional({
		description: 'Client ID if client already exists',
		example: 123
	})
	@IsNumber()
	@IsOptional()
	clientId?: number;

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

	@ApiPropertyOptional({
		description: 'Whether to send welcome message',
		example: true,
		default: true
	})
	@IsBoolean()
	@IsOptional()
	sendWelcomeMessage?: boolean;
}
