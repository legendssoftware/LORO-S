import { PartialType } from '@nestjs/swagger';
import { CreateWarningDto } from './create-warning.dto';
import { IsOptional, IsString, IsEnum, IsDate, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { WarningSeverity, WarningStatus } from '../entities/warning.entity';

/**
 * Owner/recipient resolved via recipientClerkId; no uid in DTO. Issuer from token.
 */
export class UpdateWarningDto extends PartialType(CreateWarningDto) {
	@IsString()
	@IsOptional()
	@ApiProperty({
		description: 'Updated reason for the warning',
		example: 'Revised: Failure to meet performance standards',
		required: false,
	})
	reason?: string;

	@IsEnum(WarningSeverity)
	@IsOptional()
	@ApiProperty({
		description: 'Updated severity level of the warning',
		enum: WarningSeverity,
		example: WarningSeverity.HIGH,
		required: false,
	})
	severity?: WarningSeverity;

	@IsDate()
	@Type(() => Date)
	@IsOptional()
	@ApiProperty({
		description: 'Updated expiration date for the warning',
		example: '2024-05-15T10:30:00Z',
		required: false,
	})
	expiresAt?: Date;

	@IsBoolean()
	@IsOptional()
	@ApiProperty({
		description: 'Flag indicating if the warning is expired',
		example: true,
		required: false,
	})
	isExpired?: boolean;

	@IsEnum(WarningStatus)
	@IsOptional()
	@ApiProperty({
		description: 'Updated status of the warning',
		enum: WarningStatus,
		example: WarningStatus.REVOKED,
		required: false,
	})
	status?: WarningStatus;
}
