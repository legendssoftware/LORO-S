import { ApiProperty } from '@nestjs/swagger';
import { 
	PerformanceDashboardDataDto,
	DailySalesPerformanceDto,
	BranchCategoryPerformanceDto,
	SalesPerStoreDto
} from './performance-dashboard.dto';

/**
 * ========================================================================
 * PERFORMANCE API RESPONSE DTOs
 * ========================================================================
 * 
 * Standard response wrappers for all performance API endpoints.
 * Follows consistent API response pattern with success flag, data, and optional error info.
 * ========================================================================
 */

// ===================================================================
// ERROR DETAILS
// ===================================================================

export class ApiErrorDetailsDto {
	@ApiProperty({ description: 'Error code', example: 'INVALID_FILTERS' })
	code: string;

	@ApiProperty({ description: 'Detailed error message' })
	details: string;

	@ApiProperty({ description: 'Additional error context', required: false })
	context?: any;
}

// ===================================================================
// GENERIC API RESPONSE
// ===================================================================

export class ApiResponseDto<T> {
	@ApiProperty({ description: 'Whether the request was successful' })
	success: boolean;

	@ApiProperty({ description: 'Response data', required: false })
	data?: T;

	@ApiProperty({ description: 'Success or informational message', required: false })
	message?: string;

	@ApiProperty({ type: ApiErrorDetailsDto, required: false })
	error?: ApiErrorDetailsDto;

	@ApiProperty({ description: 'Timestamp of response' })
	timestamp: string;
}

// ===================================================================
// PERFORMANCE-SPECIFIC RESPONSES
// ===================================================================

export class PerformanceDashboardResponseDto extends ApiResponseDto<PerformanceDashboardDataDto> {
	@ApiProperty({ type: PerformanceDashboardDataDto })
	data: PerformanceDashboardDataDto;
}

export class DailySalesPerformanceResponseDto extends ApiResponseDto<DailySalesPerformanceDto[]> {
	@ApiProperty({ type: [DailySalesPerformanceDto] })
	data: DailySalesPerformanceDto[];
}

export class BranchCategoryPerformanceResponseDto extends ApiResponseDto<BranchCategoryPerformanceDto[]> {
	@ApiProperty({ type: [BranchCategoryPerformanceDto] })
	data: BranchCategoryPerformanceDto[];
}

export class SalesPerStoreResponseDto extends ApiResponseDto<SalesPerStoreDto[]> {
	@ApiProperty({ type: [SalesPerStoreDto] })
	data: SalesPerStoreDto[];
}

// ===================================================================
// UNIFIED COMPREHENSIVE PERFORMANCE RESPONSE
// ===================================================================

/**
 * Unified response containing ALL performance data
 * This is the main response for mobile app - single endpoint for all data
 */
export class UnifiedPerformanceDataDto {
	@ApiProperty({ type: PerformanceDashboardDataDto, description: 'Main dashboard with summary and charts' })
	dashboard: PerformanceDashboardDataDto;

	@ApiProperty({ type: [DailySalesPerformanceDto], description: 'Daily sales performance data' })
	dailySales: DailySalesPerformanceDto[];

	@ApiProperty({ type: [BranchCategoryPerformanceDto], description: 'Branch × Category performance matrix' })
	branchCategory: BranchCategoryPerformanceDto[];

	@ApiProperty({ type: [SalesPerStoreDto], description: 'Sales per store/branch data' })
	salesPerStore: SalesPerStoreDto[];

	@ApiProperty({ description: 'Master data for filters' })
	masterData: {
		locations: LocationDto[];
		productCategories: ProductCategoryDto[];
		products: ProductDto[];
		branches: BranchDto[];
		salesPeople: SalesPersonDto[];
	};
}

export class UnifiedPerformanceResponseDto extends ApiResponseDto<UnifiedPerformanceDataDto> {
	@ApiProperty({ type: UnifiedPerformanceDataDto })
	data: UnifiedPerformanceDataDto;
}

// ===================================================================
// MASTER DATA RESPONSES
// ===================================================================

export class BranchDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	@ApiProperty()
	locationId: string;

	@ApiProperty({ required: false })
	location?: LocationDto;
}

export class LocationDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	county: string;

	@ApiProperty()
	province: string;

	@ApiProperty()
	city: string;

	@ApiProperty()
	suburb: string;
}

export class ProductDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	@ApiProperty()
	category: string;

	@ApiProperty()
	categoryId: string;

	@ApiProperty()
	price: number;

	@ApiProperty()
	costPrice: number;
}

export class ProductCategoryDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	@ApiProperty()
	description: string;
}

export class SalesPersonDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	@ApiProperty()
	branchId: string;

	@ApiProperty()
	role: string;

	@ApiProperty()
	employeeNumber: string;

	@ApiProperty({ required: false })
	avatar?: string;
}

export class BranchesResponseDto extends ApiResponseDto<BranchDto[]> {
	@ApiProperty({ type: [BranchDto] })
	data: BranchDto[];
}

export class LocationsResponseDto extends ApiResponseDto<LocationDto[]> {
	@ApiProperty({ type: [LocationDto] })
	data: LocationDto[];
}

export class ProductsResponseDto extends ApiResponseDto<ProductDto[]> {
	@ApiProperty({ type: [ProductDto] })
	data: ProductDto[];
}

export class ProductCategoriesResponseDto extends ApiResponseDto<ProductCategoryDto[]> {
	@ApiProperty({ type: [ProductCategoryDto] })
	data: ProductCategoryDto[];
}

export class SalesPeopleResponseDto extends ApiResponseDto<SalesPersonDto[]> {
	@ApiProperty({ type: [SalesPersonDto] })
	data: SalesPersonDto[];
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create a successful API response
 */
export function createSuccessResponse<T>(data: T, message?: string): ApiResponseDto<T> {
	return {
		success: true,
		data,
		message,
		timestamp: new Date().toISOString(),
	};
}

/**
 * Create an error API response
 */
export function createErrorResponse(
	code: string,
	details: string,
	context?: any
): ApiResponseDto<null> {
	return {
		success: false,
		error: {
			code,
			details,
			context,
		},
		timestamp: new Date().toISOString(),
	};
}

