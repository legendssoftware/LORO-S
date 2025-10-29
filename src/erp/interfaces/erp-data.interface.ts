/**
 * ERP Data Interfaces
 * 
 * These interfaces define the structure of data returned from ERP queries
 * and match the interfaces used in the performance dashboard.
 */

/**
 * Sales Transaction Interface (matches performance-mock-data.ts)
 */
export interface SalesTransaction {
	id: string;
	date: string;
	branchId: string;
	categoryId: string;
	productId: string;
	quantity: number;
	salesPrice: number;
	costPrice: number;
	revenue: number;
	cost: number;
	grossProfit: number;
	grossProfitPercentage: number;
	clientId: string;
}

/**
 * Performance Data Interface (matches performance-mock-data.ts)
 */
export interface PerformanceData {
	id: string;
	date: string;
	productId: string;
	branchId: string;
	salesPersonId: string;
	quantity: number;
	revenue: number;
	target: number;
	actualSales: number;
}

/**
 * Daily Aggregation Result from ERP
 */
export interface DailyAggregation {
	date: string;
	store: string;
	totalRevenue: number;
	totalCost: number;
	totalGrossProfit: number;
	transactionCount: number;
	uniqueCustomers: number;
	totalQuantity: number;
}

/**
 * Branch Aggregation Result from ERP
 */
export interface BranchAggregation {
	store: string;
	totalRevenue: number;
	totalCost: number;
	totalGrossProfit: number;
	transactionCount: number;
	uniqueCustomers: number;
	totalQuantity: number;
}

/**
 * Category Aggregation Result from ERP
 */
export interface CategoryAggregation {
	category: string;
	store: string;
	totalRevenue: number;
	totalCost: number;
	totalGrossProfit: number;
	transactionCount: number;
	uniqueCustomers: number;
	totalQuantity: number;
}

/**
 * Product Aggregation Result from ERP
 */
export interface ProductAggregation {
	itemCode: string;
	description: string;
	category: string;
	totalRevenue: number;
	totalCost: number;
	totalGrossProfit: number;
	totalQuantity: number;
	transactionCount: number;
}

/**
 * ERP Query Filters
 */
export interface ErpQueryFilters {
	startDate: string;
	endDate: string;
	storeCode?: string;
	category?: string;
	customer?: string;
	docType?: string;
}

