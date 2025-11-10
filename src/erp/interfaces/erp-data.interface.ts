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
	productName?: string; // Product description from ERP
	category?: string; // Category name from ERP
	branchId: string;
	branchName?: string; // Branch/Store name
	salesPersonId: string;
	quantity: number;
	revenue: number;
	target: number;
	actualSales: number;
}

/**
 * Daily Aggregation Result from ERP
 * Note: Uses gross amounts (incl_line_total) - discount already applied to selling prices
 * Only processes Tax Invoices (doc_type = 1)
 */
export interface DailyAggregation {
	date: string;
	store: string;
	totalRevenue: number;
	totalCost: number;
	transactionCount: number;
	uniqueCustomers: number;
	totalQuantity: number;
}

/**
 * Branch Aggregation Result from ERP
 * Note: Uses gross amounts (incl_line_total) - discount already applied to selling prices
 * Only processes Tax Invoices (doc_type = 1)
 */
export interface BranchAggregation {
	store: string;
	totalRevenue: number;
	totalCost: number;
	transactionCount: number;
	uniqueCustomers: number;
	totalQuantity: number;
}

/**
 * Category Aggregation Result from ERP
 * Note: Uses gross amounts (incl_line_total) - discount already applied to selling prices
 * Only processes Tax Invoices (doc_type = 1)
 */
export interface CategoryAggregation {
	category: string;
	store: string;
	totalRevenue: number;
	totalCost: number;
	transactionCount: number;
	uniqueCustomers: number;
	totalQuantity: number;
}

/**
 * Product Aggregation Result from ERP
 * Note: Uses gross amounts (incl_line_total) - discount already applied to selling prices
 * Only processes Tax Invoices (doc_type = 1)
 */
export interface ProductAggregation {
	itemCode: string;
	description: string;
	category: string;
	totalRevenue: number;
	totalCost: number;
	totalQuantity: number;
	transactionCount: number;
}

/**
 * Payment Type Aggregation Result from ERP
 * Aggregates payment amounts from tblsalesheader by payment type
 */
export interface PaymentTypeAggregation {
	paymentType: string;
	totalAmount: number;
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
	salesPersonId?: string | string[]; // Sales person code(s) from tblsalesheader.sales_code or tblsaleslines.rep_code
}

