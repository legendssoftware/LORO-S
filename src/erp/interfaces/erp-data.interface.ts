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
	salesName?: string; // Sales person name from tblsalesman.Description
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
 * Store-level aggregation from tblsaleslines (GROUP BY store only).
 * Used for correct unique customer count per branch (COUNT(DISTINCT customer) at store level).
 * Same filters as BranchCategoryAggregation; uniqueCustomers is not summed across categories.
 */
export interface StoreAggregation {
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
 * Sales Lines with Customer Category Information
 * Extends TblSalesLines with customer category data from joined tables
 */
export interface TblSalesLinesWithCategory {
	// All fields from TblSalesLines
	ID: number;
	discount: number;
	pay_type: string;
	isSpecial: number;
	discount_perc: number;
	doc_number: string;
	item_code: string;
	description: string;
	serialNumber: string;
	unit: string;
	quantity: number;
	excl_price: number;
	incl_price: number;
	tax: number;
	tax_per: number;
	incl_line_total: number;
	store: string;
	deposit: number;
	total_incl_disc: number;
	sale_date: Date;
	deliver: string;
	cost_price: number;
	tax_type: string;
	rep_code: string;
	doc_type: string;
	sale_time: string;
	customer: string;
	category: string;
	lot_item: string;
	period: string;
	type: string;
	net_mass: number;
	status: number;
	link: number;
	link_qty: number;
	DI: number;
	ho_sales: number;
	qty_left: number;
	DocLinked: string;
	main_item: string;
	supplier: string;
	edit_date: Date;
	edit_time: string;
	smart: number;
	int_line_excl: number;
	int_line_incl: number;
	int_line_tax: number;
	int_line_total: number;
	exchange_rate_line: number;
	commission_item: number;
	commission_per: number;
	// Additional fields from JOINs
	customer_category_code?: string;
	customer_category_description?: string;
}

/**
 * Basket Value Ranges by Store
 * Invoice count per store by basket value (excl. tax) ranges
 */
export interface BasketValueRangesByStore {
	store: string;
	under500: number;
	range500to2000: number;
	range2000to5000: number;
	over5000: number;
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
	customerCategoryCode?: string; // Filter by customer category code (from tblcustomers.Category) - single category filter (legacy)
	customerCategoryDescription?: string; // Filter by customer category description (from tblcustomercategories.cust_cat_description)
	includeCustomerCategories?: string[]; // Array of customer category codes to INCLUDE
	excludeCustomerCategories?: string[]; // Array of customer category codes to EXCLUDE
}

