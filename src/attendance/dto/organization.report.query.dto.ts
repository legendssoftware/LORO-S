import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AccessLevel } from '../../lib/enums/user.enums';
import { IsOptional, IsString, IsBoolean, IsDateString, IsEnum } from 'class-validator';

export class OrganizationReportQueryDto {
  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Start date for report period (YYYY-MM-DD)',
    example: '2024-01-01',
    required: false,
  })
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'End date for report period (YYYY-MM-DD)',
    example: '2024-03-31',
    required: false,
  })
  dateTo?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Filter by specific branch ID',
    example: 'branch-001',
    required: false,
  })
  branchId?: string;

  @IsOptional()
  @IsEnum(AccessLevel)
  @ApiProperty({
    description: 'Filter by specific role/access level',
    enum: AccessLevel,
    example: AccessLevel.TECHNICIAN,
    required: false,
  })
  role?: AccessLevel;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  @ApiProperty({
    description: 'Include individual user metrics breakdown',
    example: true,
    default: true,
    required: false,
  })
  includeUserDetails?: boolean;
} 