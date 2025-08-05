import { IsString, IsNumber, IsOptional, IsEnum, IsObject, IsIP, IsPositive, IsIn, IsDateString } from 'class-validator';
import { UsageEventStatus, UsageEventType } from '../entities/usage-event.entity';

export class CreateUsageEventDto {
	@IsOptional()
	@IsNumber()
	userId?: number;

	@IsOptional()
	@IsNumber()
	organisationId?: number;

	@IsOptional()
	@IsNumber()
	branchId?: number;

	@IsString()
	endpoint: string;

	@IsString()
	@IsIn(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
	method: string;

	@IsEnum(UsageEventType)
	eventType: UsageEventType;

	@IsEnum(UsageEventStatus)
	status: UsageEventStatus;

	@IsNumber()
	@IsPositive()
	httpStatusCode: number;

	@IsNumber()
	@IsPositive()
	durationMs: number;

	@IsOptional()
	@IsString()
	userAgent?: string;

	@IsOptional()
	@IsIP()
	ipAddress?: string;

	@IsOptional()
	@IsNumber()
	@IsPositive()
	requestSizeBytes?: number;

	@IsOptional()
	@IsNumber()
	@IsPositive()
	responseSizeBytes?: number;

	@IsOptional()
	@IsString()
	deviceType?: string;

	@IsOptional()
	@IsString()
	deviceModel?: string;

	@IsOptional()
	@IsString()
	browserName?: string;

	@IsOptional()
	@IsString()
	browserVersion?: string;

	@IsOptional()
	@IsString()
	osName?: string;

	@IsOptional()
	@IsString()
	osVersion?: string;

	@IsOptional()
	@IsString()
	clientVersion?: string;

	@IsOptional()
	@IsString()
	country?: string;

	@IsOptional()
	@IsString()
	region?: string;

	@IsOptional()
	@IsString()
	city?: string;

	@IsOptional()
	@IsObject()
	metadata?: Record<string, any>;

	@IsOptional()
	@IsObject()
	headers?: Record<string, string>;

	@IsOptional()
	@IsString()
	errorMessage?: string;

	@IsOptional()
	@IsString()
	errorStack?: string;

	@IsOptional()
	@IsNumber()
	@IsPositive()
	memoryUsageMb?: number;

	@IsOptional()
	@IsNumber()
	@IsPositive()
	cpuUsagePercent?: number;

	@IsOptional()
	@IsString()
	licenseFeature?: string;

	@IsOptional()
	@IsNumber()
	@IsPositive()
	licenseQuotaConsumed?: number;
}