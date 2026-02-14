import { ApiProperty } from '@nestjs/swagger';

/**
 * ========================================================================
 * PERFORMANCE DASHBOARD DTOs
 * ========================================================================
 * 
 * Data Transfer Objects for performance dashboard responses.
 * Defines the structure of all performance data returned to the frontend.
 * 
 * Includes:
 * - Summary metrics (revenue, targets, performance rates)
 * - Chart data (line, bar, pie, area charts)
 * - Metadata (timestamps, data quality indicators)
 * ========================================================================
 */

// ===================================================================
// CHART DATA TYPES
// ===================================================================

export class LineChartDataPoint {
	@ApiProperty({ description: 'X-axis label' })
	label: string;

	@ApiProperty({ description: 'Y-axis value' })
	value: number;

	@ApiProperty({ description: 'Formatted display text', required: false })
	dataPointText?: string;
}

export class BarChartDataPoint {
	@ApiProperty({ description: 'Bar label (code from database)' })
	label: string;

	@ApiProperty({ description: 'Bar value' })
	value: number;

	@ApiProperty({ description: 'Target value for comparison', required: false })
	target?: number;
}

export class PieChartDataPoint {
	@ApiProperty({ description: 'Segment label' })
	label: string;

	@ApiProperty({ description: 'Segment value' })
	value: number;

	@ApiProperty({ description: 'Custom color', required: false })
	color?: string;

	@ApiProperty({ description: 'Display text', required: false })
	text?: string;
}

export class DualAxisChartDataPoint {
	@ApiProperty({ description: 'X-axis label' })
	label: string;

	@ApiProperty({ description: 'Primary Y-axis value' })
	value: number;

	@ApiProperty({ description: 'Secondary Y-axis value' })
	secondaryValue: number;

	@ApiProperty({ description: 'Full name (non-abbreviated)', required: false })
	fullName?: string;
}

// ===================================================================
// CHART RESPONSE DTOs
// ===================================================================

export class LineChartResponseDto {
	@ApiProperty({ type: [LineChartDataPoint] })
	data: LineChartDataPoint[];

	@ApiProperty({ description: 'Target value for comparison', required: false })
	targetValue?: number;
}

export class BarChartResponseDto {
	@ApiProperty({ type: [BarChartDataPoint] })
	data: BarChartDataPoint[];

	@ApiProperty({ description: 'Average target value', required: false })
	averageTarget?: number;
}

export class PieChartResponseDto {
	@ApiProperty({ type: [PieChartDataPoint] })
	data: PieChartDataPoint[];

	@ApiProperty({ description: 'Total of all segments' })
	total: number;

	@ApiProperty({ description: 'Percentage value', required: false })
	percentage?: number;
}

export class DualAxisChartResponseDto {
	@ApiProperty({ type: [DualAxisChartDataPoint] })
	data: DualAxisChartDataPoint[];

	@ApiProperty({ description: 'Target value', required: false })
	targetValue?: number;
}

// ===================================================================
// SUMMARY METRICS
// ===================================================================

export class PerformanceSummaryDto {
	@ApiProperty({ 
		description: 'Total revenue in the period (from tblsalesheader: SUM(total_incl) - SUM(total_tax))',
		example: 835244.01
	})
	totalRevenue: number;

	@ApiProperty({ 
		description: 'Total sales ex VAT and costings (from tblsaleslines: SUM(incl_line_total) - SUM(tax), matches Sales by Category chart)',
		example: 823481.96
	})
	totalSalesExVatAndCost?: number;

	@ApiProperty({ 
		description: 'Total cost (from tblsaleslines: SUM(cost_price * quantity))',
		example: 650000.00
	})
	totalCost?: number;

	@ApiProperty({ 
		description: 'Total gross profit (Revenue - Cost)',
		example: 173481.96
	})
	totalGP?: number;

	@ApiProperty({ 
		description: 'Total target for the period',
		example: 2000000.00
	})
	totalTarget: number;

	@ApiProperty({ 
		description: 'Performance rate as percentage (revenue/target * 100)',
		example: 75.00
	})
	performanceRate: number;

	@ApiProperty({ 
		description: 'Total number of transactions',
		example: 1250
	})
	transactionCount: number;

	@ApiProperty({ 
		description: 'Average order value',
		example: 1200.00
	})
	averageOrderValue: number;

	@ApiProperty({ 
		description: 'Average items per basket/transaction',
		example: 5.5
	})
	averageItemsPerBasket: number;
}

// ===================================================================
// CHARTS COLLECTION
// ===================================================================

export class PerformanceChartsDto {
	@ApiProperty({ type: LineChartResponseDto, description: 'Revenue trend over time' })
	revenueTrend: LineChartResponseDto;

	@ApiProperty({ type: LineChartResponseDto, description: 'Hourly sales pattern' })
	hourlySales: LineChartResponseDto;

	@ApiProperty({ type: PieChartResponseDto, description: 'Sales distribution by category' })
	salesByCategory: PieChartResponseDto;

	@ApiProperty({ type: BarChartResponseDto, description: 'Branch performance comparison' })
	branchPerformance: BarChartResponseDto;

	@ApiProperty({ type: BarChartResponseDto, description: 'Top selling products' })
	topProducts: BarChartResponseDto;

	@ApiProperty({ type: DualAxisChartResponseDto, description: 'Items per basket trend' })
	itemsPerBasket: DualAxisChartResponseDto;

	@ApiProperty({ type: BarChartResponseDto, description: 'Sales by salesperson' })
	salesBySalesperson: BarChartResponseDto;

	@ApiProperty({ type: PieChartResponseDto, description: 'Conversion rate (quotations vs sales)' })
	conversionRate: PieChartResponseDto;

	@ApiProperty({ type: PieChartResponseDto, description: 'Customer type composition' })
	customerComposition: PieChartResponseDto;

	@ApiProperty({ type: LineChartResponseDto, description: 'Gross profit trend over time' })
	gpTrend: LineChartResponseDto;
}

// ===================================================================
// METADATA
// ===================================================================

export class PerformanceMetadataDto {
	@ApiProperty({ 
		description: 'Timestamp of last data update',
		example: '2025-10-28T10:30:00.000Z'
	})
	lastUpdated: string;

	@ApiProperty({ 
		description: 'Data quality indicator',
		example: 'excellent',
		enum: ['excellent', 'good', 'fair', 'poor']
	})
	dataQuality: string;

	@ApiProperty({ 
		description: 'Number of records in filtered dataset',
		example: 1250
	})
	recordCount: number;

	@ApiProperty({ 
		description: 'Organization timezone',
		example: 'Africa/Johannesburg'
	})
	organizationTimezone: string;

	@ApiProperty({ 
		description: 'Country code for the selected country',
		required: false,
		example: 'SA'
	})
	countryCode?: string;

	@ApiProperty({ 
		description: 'Whether data was served from cache',
		required: false
	})
	fromCache?: boolean;

	@ApiProperty({ 
		description: 'Cache timestamp if from cache',
		required: false
	})
	cachedAt?: string;
}

// ===================================================================
// DAILY SALES PERFORMANCE
// ===================================================================

export class DailySalesPerformanceDto {
	@ApiProperty({ description: 'Date in YYYY-MM-DD format' })
	date: string;

	@ApiProperty({ description: 'Day of week name' })
	dayOfWeek: string;

	@ApiProperty({ description: 'Number of transactions/baskets' })
	basketCount: number;

	@ApiProperty({ description: 'Average basket value' })
	basketValue: number;

	@ApiProperty({ description: 'Number of unique clients' })
	clientsQty: number;

	@ApiProperty({ description: 'Total sales revenue' })
	salesR: number;

	@ApiProperty({ description: 'Total gross profit' })
	gpR: number;

	@ApiProperty({ description: 'Gross profit percentage' })
	gpPercentage: number;
}

// ===================================================================
// BRANCH × CATEGORY PERFORMANCE
// ===================================================================

export class CategoryPerformanceDto {
	@ApiProperty({ description: 'Category name' })
	categoryName: string;

	@ApiProperty({ description: 'Number of transactions' })
	basketCount: number;

	@ApiProperty({ description: 'Average basket value' })
	basketValue: number;

	@ApiProperty({ description: 'Number of unique clients' })
	clientsQty: number;

	@ApiProperty({ description: 'Total sales revenue' })
	salesR: number;

	@ApiProperty({ description: 'Total gross profit' })
	gpR: number;

	@ApiProperty({ description: 'Gross profit percentage' })
	gpPercentage: number;
}

export class BranchCategoryPerformanceDto {
	@ApiProperty({ description: 'Branch ID' })
	branchId: string;

	@ApiProperty({ description: 'Branch name' })
	branchName: string;

	@ApiProperty({ 
		description: 'Country code for this branch (SA, BOT, ZAM, MOZ, ZW)',
		required: false,
		example: 'SA'
	})
	countryCode?: string;

	@ApiProperty({ 
		description: 'Performance by category',
		type: 'object',
		additionalProperties: { type: 'object' }
	})
	categories: Record<string, CategoryPerformanceDto>;

	@ApiProperty({ 
		description: 'Total performance across all categories',
		type: CategoryPerformanceDto
	})
	total: CategoryPerformanceDto;
}

// ===================================================================
// SALES PER STORE
// ===================================================================

export class SalesPerStoreDto {
	@ApiProperty({ description: 'Store/Branch ID' })
	storeId: string;

	@ApiProperty({ description: 'Store/Branch name' })
	storeName: string;

	@ApiProperty({ 
		description: 'Country code for this branch (SA, BOT, ZAM, MOZ, ZW)',
		required: false,
		example: 'SA'
	})
	countryCode?: string;

	@ApiProperty({ description: 'Total revenue' })
	totalRevenue: number;

	@ApiProperty({ description: 'Total transactions' })
	transactionCount: number;

	@ApiProperty({ description: 'Average transaction value' })
	averageTransactionValue: number;

	@ApiProperty({ description: 'Total items sold' })
	totalItemsSold: number;

	@ApiProperty({ description: 'Unique clients served' })
	uniqueClients: number;

	@ApiProperty({ description: 'Gross profit' })
	grossProfit: number;

	@ApiProperty({ description: 'Gross profit percentage' })
	grossProfitPercentage: number;

	@ApiProperty({
		description: 'Invoice count by basket value range (excl. tax)',
		required: false,
		example: { under500: 10, range500to2000: 25, range2000to5000: 15, over5000: 5 },
	})
	basketRanges?: {
		under500: number;
		range500to2000: number;
		range2000to5000: number;
		over5000: number;
	};
}

// ===================================================================
// MASTER DATA FOR FILTERS
// ===================================================================

export class FilterOptionDto {
	@ApiProperty({ description: 'Unique identifier' })
	id: string;

	@ApiProperty({ description: 'Display name' })
	name: string;
}

export class MasterDataDto {
	@ApiProperty({ 
		type: [FilterOptionDto],
		description: 'List of available branches/stores'
	})
	branches: FilterOptionDto[];

	@ApiProperty({ 
		type: [FilterOptionDto],
		description: 'List of available products'
	})
	products: FilterOptionDto[];

	@ApiProperty({ 
		type: [FilterOptionDto],
		description: 'List of available salespeople'
	})
	salespeople: FilterOptionDto[];

	@ApiProperty({ 
		type: [FilterOptionDto],
		description: 'List of available payment methods'
	})
	paymentMethods: FilterOptionDto[];
}

// ===================================================================
// MAIN DASHBOARD RESPONSE
// ===================================================================

export class PerformanceDashboardDataDto {
	@ApiProperty({ type: PerformanceSummaryDto })
	summary: PerformanceSummaryDto;

	@ApiProperty({ type: PerformanceChartsDto })
	charts: PerformanceChartsDto;

	@ApiProperty({ 
		type: [DailySalesPerformanceDto],
		description: 'Daily sales performance table data'
	})
	dailySalesPerformance: DailySalesPerformanceDto[];

	@ApiProperty({ 
		type: [BranchCategoryPerformanceDto],
		description: 'Branch × Category performance matrix table data'
	})
	branchCategoryPerformance: BranchCategoryPerformanceDto[];

	@ApiProperty({ 
		type: [SalesPerStoreDto],
		description: 'Sales per store table data'
	})
	salesPerStore: SalesPerStoreDto[];

	@ApiProperty({ 
		type: MasterDataDto,
		description: 'Master data for populating filter dropdowns'
	})
	masterData: MasterDataDto;

	@ApiProperty({ 
		description: 'Total unique clients across all transactions (prevents double-counting)',
		example: 65
	})
	totalUniqueClients?: number;

	@ApiProperty({ description: 'Applied filters', required: false })
	filters?: any;

	@ApiProperty({ 
		type: 'object',
		description: 'Currency information for the selected country',
		properties: {
			code: { type: 'string', example: 'ZAR' },
			symbol: { type: 'string', example: 'R' },
			locale: { type: 'string', example: 'en-ZA' },
			name: { type: 'string', example: 'South African Rand' },
		}
	})
	currency?: {
		code: string;
		symbol: string;
		locale: string;
		name: string;
	};

	@ApiProperty({ type: PerformanceMetadataDto })
	metadata: PerformanceMetadataDto;
}

// ===================================================================
// CONSOLIDATED INCOME STATEMENT
// ===================================================================

export class ConsolidatedBranchDataDto {
	@ApiProperty({ description: 'Branch/store ID' })
	branchId: string;

	@ApiProperty({ description: 'Branch/store name' })
	branchName: string;

	@ApiProperty({ description: 'Total revenue for this branch' })
	totalRevenue: number;

	@ApiProperty({ description: 'Number of transactions', required: false })
	transactionCount?: number;

	@ApiProperty({ description: 'Gross profit', required: false })
	grossProfit?: number;

	@ApiProperty({ description: 'Gross profit percentage', required: false })
	grossProfitPercentage?: number;
}

export class ConsolidatedIncomeStatementDto {
	@ApiProperty({ description: 'Country code (SA, BOT, ZAM, MOZ, ZW)' })
	countryCode: string;

	@ApiProperty({ description: 'Full country name' })
	countryName: string;

	@ApiProperty({ 
		type: 'object',
		description: 'Currency information for the country',
		properties: {
			code: { type: 'string', example: 'ZAR' },
			symbol: { type: 'string', example: 'R' },
			locale: { type: 'string', example: 'en-ZA' },
			name: { type: 'string', example: 'South African Rand' },
		}
	})
	currency: {
		code: string;
		symbol: string;
		locale: string;
		name: string;
	};

	@ApiProperty({ 
		type: [ConsolidatedBranchDataDto],
		description: 'Branches and their sales data for this country'
	})
	branches: ConsolidatedBranchDataDto[];

	@ApiProperty({ description: 'Total revenue across all branches in this country' })
	totalRevenue: number;

	@ApiProperty({ description: 'Total number of branches', required: false })
	branchCount?: number;
}

export class ExchangeRateDto {
	@ApiProperty({ description: 'Currency code (ZAR, BWP, ZMW, MZN, ZWL)' })
	code: string;

	@ApiProperty({ description: 'Exchange rate to ZAR' })
	rate: number;
}

export class ConsolidatedIncomeStatementResponseDto {
	@ApiProperty({ 
		type: [ConsolidatedIncomeStatementDto],
		description: 'Consolidated income statement data by country'
	})
	data: ConsolidatedIncomeStatementDto[];

	@ApiProperty({ description: 'Date range start' })
	startDate: string;

	@ApiProperty({ description: 'Date range end' })
	endDate: string;

	@ApiProperty({ description: 'Total number of countries' })
	totalCountries: number;

	@ApiProperty({ description: 'Total number of branches across all countries' })
	totalBranches: number;

	@ApiProperty({ 
		type: [ExchangeRateDto],
		description: 'Exchange rates for currency conversion to ZAR',
		required: false
	})
	exchangeRates?: ExchangeRateDto[];

	@ApiProperty({ 
		description: 'Grand total revenue in ZAR (sum of all branches converted to ZAR)',
		example: 760031.26
	})
	grandTotalZAR: number;

	@ApiProperty({ 
		description: 'Consolidated gross profit in ZAR (sum of all branch GP converted to ZAR)',
		example: 234567.89
	})
	consolidatedGrossProfitZAR: number;
}

