import { PartialType } from '@nestjs/swagger';
import { IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateCompetitorDto } from './create-competitor.dto';
import { IsString } from 'class-validator';

export class UpdateCompetitorDto extends PartialType(CreateCompetitorDto) {
  @IsNumber()
  @IsOptional()
  @ApiProperty({
    description: 'Organisation ID this competitor belongs to',
    example: 1,
    required: false,
  })
  organisationId?: number;

  @IsNumber()
  @IsOptional()
  @ApiProperty({
    description: 'Branch ID this competitor belongs to',
    example: 1,
    required: false,
  })
  branchId?: number;

  @IsOptional()
	@IsString()
	@ApiProperty({
		example: 'acme',
		description: 'Alias for the organisation',
	})
	alias?: string;
}
