import { IsOptional, IsNumber, IsString, IsEnum, IsDateString, IsArray, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { UsageEventStatus, UsageEventType } from '../entities/usage-event.entity';
import { SummaryPeriod } from '../entities/usage-summary.entity';

export class UsageQueryDto {
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	userId?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	organisationId?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	branchId?: number;

	@IsOptional()
	@IsString()
	endpoint?: string;

	@IsOptional()
	@IsEnum(UsageEventType)
	eventType?: UsageEventType;

	@IsOptional()
	@IsEnum(UsageEventStatus)
	status?: UsageEventStatus;

	@IsOptional()
	@IsDateString()
	startDate?: string;

	@IsOptional()
	@IsDateString()
	endDate?: string;

	@IsOptional()
	@IsString()
	deviceType?: string;

	@IsOptional()
	@IsString()
	browserName?: string;

	@IsOptional()
	@IsString()
	osName?: string;

	@IsOptional()
	@IsString()
	country?: string;

	@IsOptional()
	@IsString()
	licenseFeature?: string;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Type(() => Number)
	page?: number = 1;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(1000)
	@Type(() => Number)
	limit?: number = 50;

	@IsOptional()
	@IsString()
	sortBy?: string = 'createdAt';

	@IsOptional()
	@IsString()
	sortOrder?: 'ASC' | 'DESC' = 'DESC';

	@IsOptional()
	@Transform(({ value }) => value === 'true')
	includeMetadata?: boolean = false;
}

export class UsageSummaryQueryDto {
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	userId?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	organisationId?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	branchId?: number;

	@IsEnum(SummaryPeriod)
	period: SummaryPeriod;

	@IsDateString()
	startDate: string;

	@IsDateString()
	endDate: string;

	@IsOptional()
	@IsString()
	endpoint?: string;

	@IsOptional()
	@IsString()
	feature?: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	groupBy?: string[];

	@IsOptional()
	@Transform(({ value }) => value === 'true')
	includeBreakdowns?: boolean = false;
}

export class UsageAnalyticsDto {
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	organisationId?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	userId?: number;

	@IsDateString()
	startDate: string;

	@IsDateString()
	endDate: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	metrics?: string[] = ['requests', 'errors', 'performance', 'usage'];

	@IsOptional()
	@IsEnum(SummaryPeriod)
	granularity?: SummaryPeriod = SummaryPeriod.DAILY;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	endpoints?: string[];

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	features?: string[];

	@IsOptional()
	@Transform(({ value }) => value === 'true')
	compareWithPrevious?: boolean = false;
}