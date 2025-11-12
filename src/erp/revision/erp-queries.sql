-- ============================================================================
-- ERP SQL QUERIES
-- ============================================================================
-- All SQL queries used in ERP data service
-- Tables: tblsalesheader (documents), tblsaleslines (line items)
-- Doc Types: 1=Tax Invoice, 2=Credit Note, 3=Quotation, 4=Sales Order, 6=Receipt
-- ============================================================================

-- ============================================================================
-- 1. SALES HEADERS BY DATE RANGE
-- ============================================================================
-- Method: getSalesHeadersByDateRange()
-- Returns: All header columns
-- Filter: Only Tax Invoices (doc_type = 1)
-- Sales Person: Uses header.sales_code

SELECT header.*
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.doc_type = 1
    -- Optional filters (applied conditionally):
    -- AND header.store = :storeCode
    -- AND header.sales_code IN (:salesPersonId1, :salesPersonId2, ...)
ORDER BY header.sale_date ASC;

-- ============================================================================
-- 2. SALES LINES BY DATE RANGE
-- ============================================================================
-- Method: getSalesLinesByDateRange()
-- Returns: All line columns
-- Filter: Multiple doc_types supported (default: ['1'] for Tax Invoices)
-- Sales Person: Uses line.rep_code

SELECT line.*
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
    AND line.doc_type IN (:docType1, :docType2, ...)  -- Default: ['1']
    AND line.item_code IS NOT NULL
    AND line.sale_date >= '2020-01-01'
    -- Optional filters (applied conditionally):
    -- AND line.store = :storeCode
    -- AND line.category = :category
    -- AND line.rep_code IN (:salesPersonId1, :salesPersonId2, ...)
ORDER BY line.sale_date ASC;

-- ============================================================================
-- 3. CREDIT NOTES BY DATE RANGE
-- ============================================================================
-- Method: getCreditNotesByDateRange()
-- Note: Calls getSalesLinesByDateRange() with doc_type = '2'

SELECT line.*
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
    AND line.doc_type = '2'
    AND line.item_code IS NOT NULL
    AND line.sale_date >= '2020-01-01'
    -- Optional filters apply same as query #2
ORDER BY line.sale_date ASC;

-- ============================================================================
-- 4. DAILY AGGREGATIONS
-- ============================================================================
-- Method: getDailyAggregations()
-- Purpose: Revenue, cost, transactions by date and store
-- Filter: Only Tax Invoices (doc_type = '1')

SELECT 
    DATE(line.sale_date) as date,
    line.store as store,
    SUM(line.incl_line_total) as totalRevenue,
    SUM(line.cost_price * line.quantity) as totalCost,
    COUNT(DISTINCT line.doc_number) as transactionCount,
    COUNT(DISTINCT line.customer) as uniqueCustomers,
    SUM(line.quantity) as totalQuantity
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
    AND line.doc_type = '1'
    AND line.item_code IS NOT NULL
    AND line.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND line.store = :storeCode
    -- AND line.rep_code IN (:salesPersonIds)
GROUP BY DATE(line.sale_date), line.store
ORDER BY DATE(line.sale_date) ASC
LIMIT 10000;

-- ============================================================================
-- 5. BRANCH AGGREGATIONS
-- ============================================================================
-- Method: getBranchAggregations()
-- Purpose: Revenue, cost, transactions by store/branch
-- ✅ REVISED: Uses tblsalesheader instead of tblsaleslines
-- Revenue calculation: SUM(total_incl) - SUM(total_tax) grouped by store
-- Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)

SELECT 
    header.store as store,
    SUM(header.total_incl) - SUM(header.total_tax) as totalRevenue,
    CAST(0 AS DECIMAL(19,2)) as totalCost,
    COUNT(DISTINCT header.doc_number) as transactionCount,
    COUNT(DISTINCT header.customer) as uniqueCustomers,
    0 as totalQuantity
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.doc_type IN (1, 2)
    AND header.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND header.store = :storeCode
    -- AND header.sales_code IN (:salesPersonIds)
GROUP BY header.store
ORDER BY totalRevenue DESC
LIMIT 10000;

-- ============================================================================
-- 6. CATEGORY AGGREGATIONS
-- ============================================================================
-- Method: getCategoryAggregations()
-- Purpose: Revenue, cost, transactions by category and store

SELECT 
    line.category as category,
    line.store as store,
    SUM(line.incl_line_total) as totalRevenue,
    SUM(line.cost_price * line.quantity) as totalCost,
    COUNT(DISTINCT line.doc_number) as transactionCount,
    COUNT(DISTINCT line.customer) as uniqueCustomers,
    SUM(line.quantity) as totalQuantity
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
    AND line.doc_type = '1'
    AND line.item_code IS NOT NULL
    AND line.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND line.store = :storeCode
    -- AND line.rep_code IN (:salesPersonIds)
GROUP BY line.category, line.store
ORDER BY totalRevenue DESC


-- ============================================================================
-- 7. PRODUCT AGGREGATIONS
-- ============================================================================
-- Method: getProductAggregations(limit)
-- Purpose: Top products by revenue
-- ✅ REVISED: Uses SUM(incl_line_total) - SUM(tax) for revenue calculation
-- Filters: item_code != '.', type = 'I' (inventory items), groups by description
-- Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
-- Limit: Default 50, max 10000 (Top 10 for sales per product chart)

SELECT 
    line.item_code as itemCode,
    line.description as description,
    line.category as category,
    SUM(line.incl_line_total) - SUM(line.tax) as totalRevenue,
    SUM(line.cost_price * line.quantity) as totalCost,
    SUM(line.quantity) as totalQuantity,
    COUNT(DISTINCT line.doc_number) as transactionCount
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
    AND line.doc_type IN (1, 2)
    AND line.item_code IS NOT NULL
    AND line.item_code != '.'
    AND line.type = 'I'
    AND line.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND line.store = :storeCode
    -- AND line.category = :category
    -- AND line.rep_code IN (:salesPersonIds)
GROUP BY line.description
ORDER BY totalRevenue DESC
LIMIT :limit;

-- ============================================================================
-- 8. HOURLY SALES PATTERN
-- ============================================================================
-- Method: getHourlySalesPattern()
-- Purpose: Sales aggregated by hour of day
-- Filter: Only records with sale_time data
-- ✅ REVISED: Uses tblsalesheader table with SUM(total_incl) - SUM(total_tax) formula
-- Processes Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)

SELECT 
    HOUR(header.sale_time) as hour,
    COUNT(DISTINCT header.doc_number) as transactionCount,
    CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) - SUM(CAST(header.total_tax AS DECIMAL(19,3))) AS DECIMAL(19,2)) as totalRevenue,
    COUNT(DISTINCT header.customer) as uniqueCustomers
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.doc_type IN (1, 2)
    AND header.sale_time IS NOT NULL
    AND header.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND header.store = :storeCode
    -- AND header.sales_code IN (:salesPersonIds)
GROUP BY HOUR(header.sale_time)
ORDER BY HOUR(header.sale_time) ASC;

-- ============================================================================
-- 9. PAYMENT TYPE AGGREGATIONS
-- ============================================================================
-- Method: getPaymentTypeAggregations()
-- Purpose: Payment amounts by type from headers (tax-excluded)
-- Filter: Tax Invoices (doc_type = 1) AND Credit Notes (doc_type = 2)
-- Sales Person: Uses header.sales_code
-- Note: Results filtered to non-zero amounts, transaction counts calculated proportionally
-- ✅ REVISED: Uses tax exclusion approach - payment methods calculated proportionally
--    based on SUM(total_incl) - SUM(total_tax) to match base query
--    Base query: SELECT SUM(total_incl) - SUM(total_tax) AS total_sum FROM tblsalesheader WHERE doc_type IN (1, 2)

SELECT 
    CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) - SUM(CAST(header.total_tax AS DECIMAL(19,3))) AS DECIMAL(19,2)) as taxExcludedTotal,
    CAST(SUM(CAST(header.cash AS DECIMAL(19,3))) - SUM(CAST(header.change_amnt AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cash,
    CAST(SUM(CAST(header.credit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as credit_card,
    CAST(SUM(CAST(header.eft AS DECIMAL(19,3))) AS DECIMAL(19,2)) as eft,
    CAST(SUM(CAST(header.debit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as debit_card,
    CAST(SUM(CAST(header.cheque AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cheque,
    CAST(SUM(CAST(header.voucher AS DECIMAL(19,3))) AS DECIMAL(19,2)) as voucher,
    CAST(SUM(CAST(header.account AS DECIMAL(19,3))) AS DECIMAL(19,2)) as account,
    CAST(SUM(CAST(header.snap_scan AS DECIMAL(19,3))) AS DECIMAL(19,2)) as snap_scan,
    CAST(SUM(CAST(header.zapper AS DECIMAL(19,3))) AS DECIMAL(19,2)) as zapper,
    CAST(SUM(CAST(header.extra AS DECIMAL(19,3))) AS DECIMAL(19,2)) as extra,
    CAST(SUM(CAST(header.offline_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as offline_card,
    CAST(SUM(CAST(header.fnb_qr AS DECIMAL(19,3))) AS DECIMAL(19,2)) as fnb_qr,
    COUNT(*) as totalTransactions
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.doc_type IN (1, 2)
    AND header.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND header.store = :storeCode
    -- AND header.sales_code IN (:salesPersonIds);

-- ============================================================================
-- 10. CONVERSION RATE DATA
-- ============================================================================
-- Method: getConversionRateData()
-- Purpose: Quotation to invoice conversion tracking
-- Sales Person: Uses header.sales_code
-- Returns: Two separate queries executed sequentially

-- Query 1: Quotations (doc_type = 3)
SELECT 
    COUNT(*) as totalQuotations,
    CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) as totalQuotationValue
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.doc_type = 3
    AND header.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND header.store = :storeCode
    -- AND header.sales_code IN (:salesPersonIds);

-- Query 2: Converted Invoices (doc_type = 1 AND invoice_used = 1)
SELECT 
    COUNT(*) as convertedInvoices,
    CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) as convertedInvoiceValue
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.doc_type = 1
    AND header.invoice_used = 1
    AND header.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND header.store = :storeCode
    -- AND header.sales_code IN (:salesPersonIds);

-- Conversion Rate = (convertedInvoices / totalQuotations) * 100

-- ============================================================================
-- 11. DOCUMENT TYPE BREAKDOWN
-- ============================================================================
-- Method: getDocumentTypeBreakdown()
-- Purpose: Count and value by document type
-- Sales Person: Uses header.sales_code

SELECT 
    header.doc_type as docType,
    header.doc_desc as docDesc,
    COUNT(*) as count,
    CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) as totalValue
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.sale_date >= '2020-01-01'
    -- Optional filters:
    -- AND header.store = :storeCode
    -- AND header.sales_code IN (:salesPersonIds)
GROUP BY header.doc_type, header.doc_desc
ORDER BY header.doc_type ASC;

-- ============================================================================
-- 12. MASTER DATA FOR FILTERS
-- ============================================================================
-- Method: getMasterDataForFilters()
-- Purpose: Unique values for filter dropdowns
-- Executes 4 queries sequentially

-- 12.1: Unique Branches
SELECT DISTINCT line.store as store
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
    AND line.doc_type = '1'
    AND line.store IS NOT NULL
    AND line.store != ''
ORDER BY line.store ASC;

-- 12.2: Unique Products (limit 1000)
SELECT DISTINCT 
    line.item_code as itemCode,
    line.description as description
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
    AND line.doc_type = '1'
    AND line.item_code IS NOT NULL
    AND line.item_code != ''
ORDER BY line.item_code ASC
LIMIT 1000;

-- 12.3: Unique Salespeople (from headers)
SELECT DISTINCT header.sales_code as salesCode
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.doc_type = 1
    AND header.sales_code IS NOT NULL
    AND header.sales_code != ''
ORDER BY header.sales_code ASC;

-- 12.4: Payment Methods (sums all payment columns)
SELECT 
    CAST(SUM(CAST(header.cash AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cash,
    CAST(SUM(CAST(header.credit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as credit_card,
    CAST(SUM(CAST(header.eft AS DECIMAL(19,3))) AS DECIMAL(19,2)) as eft,
    CAST(SUM(CAST(header.debit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as debit_card,
    CAST(SUM(CAST(header.cheque AS DECIMAL(19,3))) AS DECIMAL(19,2)) as cheque,
    CAST(SUM(CAST(header.voucher AS DECIMAL(19,3))) AS DECIMAL(19,2)) as voucher,
    CAST(SUM(CAST(header.account AS DECIMAL(19,3))) AS DECIMAL(19,2)) as account,
    CAST(SUM(CAST(header.snap_scan AS DECIMAL(19,3))) AS DECIMAL(19,2)) as snap_scan,
    CAST(SUM(CAST(header.zapper AS DECIMAL(19,3))) AS DECIMAL(19,2)) as zapper,
    CAST(SUM(CAST(header.extra AS DECIMAL(19,3))) AS DECIMAL(19,2)) as extra,
    CAST(SUM(CAST(header.offline_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) as offline_card,
    CAST(SUM(CAST(header.fnb_qr AS DECIMAL(19,3))) AS DECIMAL(19,2)) as fnb_qr
FROM tblsalesheader header
WHERE header.sale_date BETWEEN :startDate AND :endDate
    AND header.doc_type = 1;
-- Note: Filtered to non-zero amounts in post-processing

-- ============================================================================
-- 13. HEALTH CHECK QUERIES
-- ============================================================================
-- Method: erp.health.ts

-- 13.1: Connection Test
SELECT COUNT(*) 
FROM tblsaleslines 
LIMIT 1;

-- 13.2: Data Freshness
SELECT 
    MAX(line.sale_date) as lastSaleDate,
    COUNT(*) as recordCount
FROM tblsaleslines line;

-- 13.3: Query Performance Test
SELECT 
    line.store,
    COUNT(*) as count
FROM tblsaleslines line
WHERE line.sale_date >= :startDate
    AND line.sale_date <= :endDate
GROUP BY line.store
LIMIT 10;

-- 13.4: ERP Statistics
SELECT 
    COUNT(*) as totalRecords,
    MIN(line.sale_date) as earliestDate,
    MAX(line.sale_date) as latestDate,
    COUNT(DISTINCT line.store) as storeCount
FROM tblsaleslines line;

-- ============================================================================
-- QUERY OPTIMIZATION NOTES
-- ============================================================================
-- 1. Date Chunking: Ranges > 60 days split into 30-day chunks
-- 2. Caching: 4-hour TTL (14400s) for all queries
-- 3. Sequential Execution: One query at a time to prevent pool exhaustion
-- 4. Circuit Breaker: Auto-retry with exponential backoff
-- 5. Adaptive Timeouts: 90s (headers), 120s (lines/aggregations), scales with range
-- 6. Result Limits: Aggregations max 10,000 records
-- 7. Data Quality: item_code IS NOT NULL, sale_date >= '2020-01-01'
-- ============================================================================
