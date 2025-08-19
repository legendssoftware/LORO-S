import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';

export enum ReportType {
  MORNING = 'morning',
  EVENING = 'evening',
}

export class RequestReportDto {
  @IsNotEmpty()
  @IsEnum(ReportType)
  @ApiProperty({
    enum: ReportType,
    description: 'Type of attendance report to generate and send',
    example: ReportType.MORNING,
    required: true,
  })
  reportType: ReportType;
} 