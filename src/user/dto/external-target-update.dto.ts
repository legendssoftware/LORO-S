import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	IsString,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsNumber,
	IsEnum,
	IsDateString,
	ValidateNested,
	IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum TargetUpdateMode {
	INCREMENT = 'INCREMENT', // Add to current values
	REPLACE = 'REPLACE', // Replace current values
}

export class SaleDetailDto {
	@ApiProperty({
		description: 'Unique sale ID in ERP system',
		example: 'SALE-12345',
	})
	@IsString()
	@IsNotEmpty()
	saleId: string;

	@ApiProperty({
		description: 'Sale amount',
		example: 2500.0,
	})
	@IsNumber()
	amount: number;

	@ApiProperty({
		description: 'Sale date',
		example: '2024-01-15T10:30:00Z',
	})
	@IsDateString()
	date: string;

	@ApiPropertyOptional({
		description: 'Additional sale metadata',
		example: { clientId: 'CLIENT-789', productId: 'PROD-456' },
	})
	@IsOptional()
	@IsObject()
	metadata?: any;
}

export class TargetUpdateValuesDto {
	@ApiPropertyOptional({
		description: 'Current sales amount to update (total of quotations + orders)',
		example: 15000.5,
	})
	@IsOptional()
	@IsNumber()
	currentSalesAmount?: number;

	@ApiPropertyOptional({
		description: 'Current quotations amount to update (quotes made but not paid)',
		example: 8000.5,
	})
	@IsOptional()
	@IsNumber()
	currentQuotationsAmount?: number;

	@ApiPropertyOptional({
		description: 'Current orders amount to update (converted and paid)',
		example: 7000.0,
	})
	@IsOptional()
	@IsNumber()
	currentOrdersAmount?: number;

	@ApiPropertyOptional({
		description: 'Current new leads count to update',
		example: 12,
	})
	@IsOptional()
	@IsNumber()
	currentNewLeads?: number;

	@ApiPropertyOptional({
		description: 'Current new clients count to update',
		example: 8,
	})
	@IsOptional()
	@IsNumber()
	currentNewClients?: number;

	@ApiPropertyOptional({
		description: 'Current check-ins count to update',
		example: 25,
	})
	@IsOptional()
	@IsNumber()
	currentCheckIns?: number;

	@ApiPropertyOptional({
		description: 'Current hours worked to update',
		example: 160.5,
	})
	@IsOptional()
	@IsNumber()
	currentHoursWorked?: number;

	@ApiPropertyOptional({
		description: 'Current calls made to update',
		example: 45,
	})
	@IsOptional()
	@IsNumber()
	currentCalls?: number;
}

export class ExternalTargetUpdateDto {
	@ApiProperty({
		description: 'Source system identifier',
		example: 'SAP_ERP_SYSTEM',
	})
	@IsString()
	@IsNotEmpty()
	source: string;

	@ApiProperty({
		description: 'Unique transaction ID for idempotency',
		example: 'TXN-2024-001-12345',
	})
	@IsString()
	@IsNotEmpty()
	transactionId: string;

	@ApiProperty({
		description: 'Update mode - INCREMENT adds to current values, REPLACE sets absolute values',
		enum: TargetUpdateMode,
		example: TargetUpdateMode.INCREMENT,
	})
	@IsEnum(TargetUpdateMode)
	updateMode: TargetUpdateMode;

	@ApiProperty({
		description: 'Target values to update',
		type: TargetUpdateValuesDto,
	})
	@ValidateNested()
	@Type(() => TargetUpdateValuesDto)
	@IsObject()
	updates: TargetUpdateValuesDto;

	@ApiProperty({
		description: 'Update metadata and context',
		example: {
			updateReason: 'SALE_COMPLETED',
			timestamp: '2024-01-15T10:30:00Z',
			erpVersion: '2.1.0',
		},
	})
	@IsObject()
	metadata: {
		updateReason: string;
		timestamp: string;
		erpVersion?: string;
		[key: string]: any;
	};

	@ApiPropertyOptional({
		description: 'Detailed sale information (for sales amount updates)',
		type: [SaleDetailDto],
	})
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => SaleDetailDto)
	saleDetails?: SaleDetailDto[];
}
