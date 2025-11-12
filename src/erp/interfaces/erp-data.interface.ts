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
 * Note: Uses tblsalesheader.total_incl - total_tax for revenue calculation (exclusive of tax)
 * Revenue = SUM(total_incl) - SUM(total_tax)
 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
 * totalCost and totalQuantity are set to 0 as they're not available in header table
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
 * Note: Uses tblsalesheader.total_incl - total_tax for revenue calculation (exclusive of tax)
 * Revenue = SUM(total_incl) - SUM(total_tax) grouped by store
 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
 * totalCost and totalQuantity are set to 0 as they're not available in header table
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
 * Sales Person Aggregation Result from ERP
 * Note: Uses tblsalesheader.total_incl - total_tax for revenue calculation (exclusive of tax)
 * Revenue = SUM(total_incl) - SUM(total_tax) grouped by sales_code
 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
 * totalCost and totalQuantity are set to 0 as they're not available in header table
 */
export interface SalesPersonAggregation {
	salesCode: string;
	totalRevenue: number;
	totalCost: number;
	transactionCount: number;
	uniqueCustomers: number;
	totalQuantity: number;
}

/**
 * Category Aggregation Result from ERP
 * Note: Uses SUM(incl_line_total) - SUM(tax) for revenue calculation (exclusive of tax)
 * Revenue = SUM(incl_line_total) - SUM(tax) grouped by category
 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
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
 * Branch × Category Aggregation Result from ERP
 * Note: Uses tblsaleslines for category data (category is only in lines table)
 * Revenue calculation: SUM(incl_line_total) - SUM(tax) grouped by store and category
 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
 * This combines branch (store) and category performance metrics
 */
export interface BranchCategoryAggregation {
	store: string;
	category: string;
	totalRevenue: number;
	totalCost: number;
	transactionCount: number;
	uniqueCustomers: number;
	totalQuantity: number;
}

/**
 * Product Aggregation Result from ERP
 * Note: Uses SUM(incl_line_total) - SUM(tax) for revenue calculation (exclusive of tax)
 * Revenue = SUM(incl_line_total) - SUM(tax) grouped by description
 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
 * Filters: item_code != '.', type = 'I' (inventory items only)
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
 * Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
 * 
 * ✅ REVISED: Cash payment type calculation
 * - Cash amount = SUM(cash) - SUM(change_amnt)
 * - This gives the net cash received after deducting change given to customers
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
	salesPersonId?: string | string[]; // Sales person code(s): use tblsalesheader.sales_code for header queries, tblsaleslines.rep_code for line queries
}

