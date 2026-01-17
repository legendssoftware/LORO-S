import { IsNotEmpty, IsString, IsEmail, IsOptional, IsNumber, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExternalEnrollDto {
	@ApiProperty({
		description: 'Client email address (required if phone not provided)',
		example: 'client@example.com',
		required: false
	})
	@IsEmail()
	@IsOptional()
	email?: string;

	@ApiProperty({
		description: 'Client phone number (required if email not provided)',
		example: '+27123456789',
		required: false
	})
	@IsString()
	@IsOptional()
	phone?: string;

	@ApiPropertyOptional({
		description: 'Client name (optional, will be used if creating new client)',
		example: 'John Doe'
	})
	@IsString()
	@IsOptional()
	name?: string;

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
