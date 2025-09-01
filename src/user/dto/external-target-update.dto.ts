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
	INCREMENT = 'INCREMENT', // Add positive values to current amounts (e.g., 10k + 1.5k = 11.5k)
	DECREMENT = 'DECREMENT', // Subtract positive values from current amounts (e.g., 10k - 1.5k = 8.5k)
	REPLACE = 'REPLACE', // Replace current values with absolute amounts (e.g., 10k → 18k = 18k)
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
		description: 'Sales amount value for target update. Must be positive for INCREMENT/DECREMENT modes, any non-negative value for REPLACE mode.',
		examples: {
			increment: {
				summary: 'INCREMENT mode example',
				description: 'Add 1500 to current sales amount (e.g., 10000 + 1500 = 11500)',
				value: 1500
			},
			decrement: {
				summary: 'DECREMENT mode example', 
				description: 'Subtract 1500 from current sales amount (e.g., 10000 - 1500 = 8500)',
				value: 1500
			},
			replace: {
				summary: 'REPLACE mode example',
				description: 'Set sales amount to absolute value (e.g., 10000 → 18000)',
				value: 18000
			}
		}
	})
	@IsOptional()
	@IsNumber()
	currentSalesAmount?: number;

	@ApiPropertyOptional({
		description: 'Quotations amount value for target update. Must be positive for INCREMENT/DECREMENT modes, any non-negative value for REPLACE mode.',
		example: 1000.5,
	})
	@IsOptional()
	@IsNumber()
	currentQuotationsAmount?: number;

	@ApiPropertyOptional({
		description: 'Orders amount value for target update. Must be positive for INCREMENT/DECREMENT modes, any non-negative value for REPLACE mode.',
		example: 2000.0,
	})
	@IsOptional()
	@IsNumber()
	currentOrdersAmount?: number;

	@ApiPropertyOptional({
		description: 'New leads count value for target update. Must be positive for INCREMENT/DECREMENT modes, any non-negative value for REPLACE mode.',
		example: 5,
	})
	@IsOptional()
	@IsNumber()
	currentNewLeads?: number;

	@ApiPropertyOptional({
		description: 'New clients count value for target update. Must be positive for INCREMENT/DECREMENT modes, any non-negative value for REPLACE mode.',
		example: 3,
	})
	@IsOptional()
	@IsNumber()
	currentNewClients?: number;

	@ApiPropertyOptional({
		description: 'Check-ins count value for target update. Must be positive for INCREMENT/DECREMENT modes, any non-negative value for REPLACE mode.',
		example: 10,
	})
	@IsOptional()
	@IsNumber()
	currentCheckIns?: number;

	@ApiPropertyOptional({
		description: 'Hours worked value for target update. Must be positive for INCREMENT/DECREMENT modes, any non-negative value for REPLACE mode.',
		example: 8.5,
	})
	@IsOptional()
	@IsNumber()
	currentHoursWorked?: number;

	@ApiPropertyOptional({
		description: 'Calls made value for target update. Must be positive for INCREMENT/DECREMENT modes, any non-negative value for REPLACE mode.',
		example: 15,
	})
	@IsOptional()
	@IsNumber()
	currentCalls?: number;
}

export class ExternalTargetUpdateDto {
	@ApiPropertyOptional({
		description: 'Source system identifier (optional - defaults to "UNKNOWN_SOURCE" if not provided)',
		example: 'LEGEND_ERP_SYSTEM',
	})
	@IsOptional()
	@IsString()
	source?: string;

	@ApiProperty({
		description: 'Unique transaction ID for idempotency',
		example: 'TXN-2024-001-12345',
	})
	@IsString()
	@IsNotEmpty()
	transactionId: string;

	@ApiProperty({
		description: 'Update mode determines how target values are modified',
		enum: TargetUpdateMode,
		examples: {
			increment: {
				summary: 'INCREMENT mode',
				description: 'Adds positive values to current amounts (10k + 1.5k = 11.5k)',
				value: TargetUpdateMode.INCREMENT
			},
			decrement: {
				summary: 'DECREMENT mode',
				description: 'Subtracts positive values from current amounts (10k - 1.5k = 8.5k)',
				value: TargetUpdateMode.DECREMENT
			},
			replace: {
				summary: 'REPLACE mode',
				description: 'Replaces current values with absolute amounts (10k → 18k = 18k)',
				value: TargetUpdateMode.REPLACE
			}
		}
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
