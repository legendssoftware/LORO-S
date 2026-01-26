import { IsNotEmpty, IsArray, ValidateNested, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AwardLoyaltyPointsDto } from './award-loyalty-points.dto';

export class BulkAwardPointsDto {
	@ApiProperty({
		description: 'Array of point awards to process',
		type: [AwardLoyaltyPointsDto],
	})
	@IsArray()
	@IsNotEmpty()
	@ValidateNested({ each: true })
	@Type(() => AwardLoyaltyPointsDto)
	awards: AwardLoyaltyPointsDto[];

	@ApiPropertyOptional({
		description: 'Organization ID',
		example: 1,
	})
	@IsNumber()
	@IsOptional()
	organisationUid?: number;
}
