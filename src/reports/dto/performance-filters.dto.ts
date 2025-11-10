import { 
	IsOptional, 
	IsDateString, 
	IsNumber, 
	IsString, 
	IsArray, 
	ArrayMinSize,
	Min,
	ValidateNested,
	IsObject
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ========================================================================
 * PERFORMANCE FILTERS DTO
 * ========================================================================
 * 
 * Comprehensive filtering options for performance tracker data.
 * Supports hierarchical location filtering, date ranges, product categories,
 * price ranges, branch filtering, and salesperson filtering.
 * 
 * Used by all performance endpoints to filter and aggregate data.
 * ========================================================================
 */

export class LocationFilterDto {
	@ApiPropertyOptional({ description: 'Country name (e.g., South Africa, Botswana)' })
	@IsOptional()
	@IsString()
	county?: string;

	@ApiPropertyOptional({ description: 'Province/State name' })
	@IsOptional()
	@IsString()
	province?: string;

	@ApiPropertyOptional({ description: 'City name' })
	@IsOptional()
	@IsString()
	city?: string;

	@ApiPropertyOptional({ description: 'Suburb/District name' })
	@IsOptional()
	@IsString()
	suburb?: string;
}

export class ProductFilterDto {
	@ApiPropertyOptional({ description: 'Product category name' })
	@IsOptional()
	@IsString()
	category?: string;

	@ApiPropertyOptional({ 
		description: 'Array of product IDs to filter',
		type: [String]
	})
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	productIds?: string[];
}

export class PriceRangeDto {
	@ApiPropertyOptional({ description: 'Minimum price' })
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Type(() => Number)
	min?: number;

	@ApiPropertyOptional({ description: 'Maximum price' })
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Type(() => Number)
	max?: number;
}

export class PerformanceFiltersDto {
	@ApiPropertyOptional({ 
		description: 'Organization ID (optional, defaults to authenticated user\'s organization)',
		example: 1
	})
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	organisationId?: number;

	@ApiPropertyOptional({ 
		description: 'Branch ID to filter by specific branch',
		example: 1
	})
	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	branchId?: number;

	@ApiPropertyOptional({ 
		description: 'Start date for filtering (ISO format: YYYY-MM-DD)',
		example: '2025-01-01'
	})
	@IsOptional()
	@IsDateString()
	startDate?: string;

	@ApiPropertyOptional({ 
		description: 'End date for filtering (ISO format: YYYY-MM-DD)',
		example: '2025-01-31'
	})
	@IsOptional()
	@IsDateString()
	endDate?: string;

	@ApiPropertyOptional({ 
		description: 'Hierarchical location filter',
		type: LocationFilterDto
	})
	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => LocationFilterDto)
	location?: LocationFilterDto;

	@ApiPropertyOptional({ 
		description: 'Product and category filters',
		type: ProductFilterDto
	})
	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => ProductFilterDto)
	product?: ProductFilterDto;

	@ApiPropertyOptional({ 
		description: 'Price range filter',
		type: PriceRangeDto
	})
	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => PriceRangeDto)
	priceRange?: PriceRangeDto;

	@ApiPropertyOptional({ 
		description: 'Array of branch IDs to filter (comma-separated in query string)',
		type: [String],
		example: ['B001', 'B002', 'B003']
	})
	@IsOptional()
	@Transform(({ value }) => {
		if (typeof value === 'string') {
			return value.split(',').map(id => id.trim());
		}
		return value;
	})
	@IsArray()
	@IsString({ each: true })
	branchIds?: string[];

	@ApiPropertyOptional({ 
		description: 'Array of salesperson IDs to filter (comma-separated in query string)',
		type: [String],
		example: ['SP001', 'SP002']
	})
	@IsOptional()
	@Transform(({ value }) => {
		if (typeof value === 'string') {
			return value.split(',').map(id => id.trim());
		}
		return value;
	})
	@IsArray()
	@IsString({ each: true })
	salesPersonIds?: string[];

	@ApiPropertyOptional({ 
		description: 'Array of payment method IDs to filter (comma-separated in query string)',
		type: [String],
		example: ['cash', 'credit_card', 'eft']
	})
	@IsOptional()
	@Transform(({ value }) => {
		if (typeof value === 'string') {
			return value.split(',').map(id => id.trim());
		}
		return value;
	})
	@IsArray()
	@IsString({ each: true })
	paymentMethodIds?: string[];

	@ApiPropertyOptional({ 
		description: 'Product category name for filtering',
		example: 'Drywall & Partition'
	})
	@IsOptional()
	@IsString()
	category?: string;

	@ApiPropertyOptional({ 
		description: 'Comma-separated product IDs',
		example: 'P001,P002,P003'
	})
	@IsOptional()
	@Transform(({ value }) => {
		if (typeof value === 'string') {
			return value.split(',').map(id => id.trim());
		}
		return value;
	})
	productIds?: string[];

	@ApiPropertyOptional({ 
		description: 'Minimum price for filtering',
		example: 100
	})
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Type(() => Number)
	minPrice?: number;

	@ApiPropertyOptional({ 
		description: 'Maximum price for filtering',
		example: 5000
	})
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Type(() => Number)
	maxPrice?: number;

	@ApiPropertyOptional({ 
		description: 'County/Country name for location filtering',
		example: 'South Africa'
	})
	@IsOptional()
	@IsString()
	county?: string;

	@ApiPropertyOptional({ 
		description: 'Province/State name for location filtering',
		example: 'Gauteng'
	})
	@IsOptional()
	@IsString()
	province?: string;

	@ApiPropertyOptional({ 
		description: 'City name for location filtering',
		example: 'Johannesburg'
	})
	@IsOptional()
	@IsString()
	city?: string;

	@ApiPropertyOptional({ 
		description: 'Suburb/District name for location filtering',
		example: 'Sandton'
	})
	@IsOptional()
	@IsString()
	suburb?: string;
}

