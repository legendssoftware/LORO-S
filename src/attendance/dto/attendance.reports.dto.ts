import { ReportType } from '../../lib/enums/reports.enums';
import { IsEnum, IsNumber, IsOptional, IsString, IsObject } from 'class-validator';

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
}
