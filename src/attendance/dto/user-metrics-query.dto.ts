import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UserMetricsQueryDto {
  @ApiProperty({
    description: 'Start date for metrics calculation (YYYY-MM-DD)',
    example: '2024-01-01',
    required: true,
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'End date for metrics calculation (YYYY-MM-DD)',
    example: '2024-03-31',
    required: true,
  })
  @IsDateString()
  endDate: string;

  @ApiProperty({
    description: 'User ID to calculate metrics for',
    example: 123,
    required: true,
  })
  @IsNumber()
  @Type(() => Number)
  userId: number;

  @ApiProperty({
    description: 'Include performance insights in the response',
    example: true,
    required: false,
    default: true,
  })
  @IsOptional()
  includeInsights?: boolean = true;
}
