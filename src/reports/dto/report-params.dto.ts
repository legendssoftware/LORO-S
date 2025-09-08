import { IsEnum, IsNumber, IsOptional, IsString, IsObject } from 'class-validator';
import { ReportType } from '../constants/report-types.enum';

export class ReportParamsDto {
  @IsEnum(ReportType)
  type: ReportType;

  @IsNumber()
  organisationId: number;

  @IsOptional()
  @IsNumber()
  branchId?: number;

  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  dateRange?: {
    start: Date;
    end: Date;
  };

  @IsOptional()
  @IsObject()
  filters?: Record<string, any>;
  
  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsString()
  granularity?: 'daily' | 'weekly' | 'end-of-day' | 'end-of-week';
} 