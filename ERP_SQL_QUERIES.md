# ERP SQL Queries for Charts

This document contains the SQL equivalents for each chart/endpoint in the ERP data service.

## 1. Sales Headers by Date Range
**Endpoint:** `getSalesHeadersByDateRange`  
**Chart:** Raw sales headers data

```sql
SELECT header.*
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type = 1  -- Tax Invoices only
  AND header.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND header.store = :storeCode
  -- AND header.sales_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:excludeCustomerCategories)))
```

## 2. Sales Lines by Date Range
**Endpoint:** `getSalesLinesByDateRange`  
**Chart:** Raw sales lines data

```sql
SELECT line.*
FROM tblsaleslines AS line
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type IN (:docTypes)  -- Default: ['1'] (Tax Invoices), can include ['1','2'] for Credit Notes
  AND line.item_code IS NOT NULL
  AND line.sale_date >= '2020-01-01'
  AND line.type = 'I'  -- Only inventory items
  -- Optional filters:
  -- AND line.store = :storeCode
  -- AND line.category = :category
  -- AND line.rep_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:excludeCustomerCategories)))
```

## 3. Sales Lines with Customer Categories
**Endpoint:** `getSalesLinesWithCustomerCategories`  
**Chart:** Sales lines with customer category information

```sql
SELECT 
  line.*,
  customer.Category AS customer_category_code,
  category.cust_cat_description AS customer_category_description
FROM tblsaleslines AS line
LEFT JOIN tblcustomers AS customer ON line.customer = customer.Code
LEFT JOIN tblcustomercategories AS category ON customer.Category = category.cust_cat_code
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type IN (:docTypes)  -- Default: ['1']
  AND line.item_code IS NOT NULL
  AND line.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND line.store = :storeCode
  -- AND line.category = :category
  -- AND line.rep_code IN (:salesPersonIds)
  -- AND customer.Category = :customerCategoryCode
  -- AND category.cust_cat_description = :customerCategoryDescription
  -- AND customer.Category IN (:includeCustomerCategories)
  -- AND (customer.Category IS NULL OR customer.Category NOT IN (:excludeCustomerCategories))
```

## 4. Daily Aggregations
**Endpoint:** `getDailyAggregations`  
**Chart:** Daily sales summary (revenue, transactions, customers)

```sql
SELECT 
  DATE(header.sale_date) AS date,
  header.store AS store,
  SUM(header.total_incl) - SUM(header.total_tax) AS totalRevenue,
  CAST(0 AS DECIMAL(19,2)) AS totalCost,
  COUNT(DISTINCT header.doc_number) AS transactionCount,
  COUNT(DISTINCT header.customer) AS uniqueCustomers,
  0 AS totalQuantity
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type IN (1, 2)  -- Tax Invoices AND Credit Notes
  AND header.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND header.store = :storeCode
  -- AND header.sales_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:excludeCustomerCategories)))
GROUP BY DATE(header.sale_date), header.store
ORDER BY DATE(header.sale_date) ASC
LIMIT 10000
```

## 5. Branch Aggregations
**Endpoint:** `getBranchAggregations`  
**Chart:** Sales summary by branch/store

```sql
SELECT 
  header.store AS store,
  SUM(header.total_incl) - SUM(header.total_tax) AS totalRevenue,
  CAST(0 AS DECIMAL(19,2)) AS totalCost,
  COUNT(DISTINCT header.doc_number) AS transactionCount,
  COUNT(DISTINCT header.customer) AS uniqueCustomers,
  0 AS totalQuantity
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type IN (1, 2)  -- Tax Invoices AND Credit Notes
  AND header.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND header.store = :storeCode
  -- AND header.sales_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:excludeCustomerCategories)))
GROUP BY header.store
ORDER BY totalRevenue DESC
LIMIT 10000
```

## 6. Sales Person Aggregations
**Endpoint:** `getSalesPersonAggregations`  
**Chart:** Sales summary by sales person

```sql
SELECT 
  line.rep_code AS salesCode,
  salesman.Description AS salesName,
  SUM(line.incl_line_total - line.tax) AS totalRevenue,
  CAST(0 AS DECIMAL(19,2)) AS totalCost,
  COUNT(DISTINCT line.doc_number) AS transactionCount,
  COUNT(DISTINCT line.customer) AS uniqueCustomers,
  SUM(line.quantity) AS totalQuantity
FROM tblsaleslines AS line
LEFT JOIN tblsalesman AS salesman ON line.rep_code = salesman.Code
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type IN (1, 2)  -- Tax Invoices AND Credit Notes
  AND line.type = 'I'  -- Only inventory items
  AND line.sale_date >= '2020-01-01'
  AND line.rep_code IS NOT NULL
  AND line.rep_code != ''
  AND line.item_code IS NOT NULL
  -- Optional filters:
  -- AND line.store = :storeCode
  -- AND line.rep_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:excludeCustomerCategories)))
GROUP BY line.rep_code
ORDER BY totalRevenue DESC
LIMIT 10000
```

## 7. Category Aggregations
**Endpoint:** `getCategoryAggregations`  
**Chart:** Sales summary by product category

```sql
SELECT 
  line.category AS category,
  SUM(line.incl_line_total) - SUM(line.tax) AS totalRevenue,
  SUM(line.cost_price * line.quantity) AS totalCost,
  SUM(line.quantity) AS totalQuantity
FROM tblsaleslines AS line
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type IN (1, 2)  -- Tax Invoices AND Credit Notes
  AND line.item_code NOT IN ('.')
  AND line.type = 'I'  -- Only inventory items
  AND line.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND line.rep_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:excludeCustomerCategories)))
GROUP BY line.category
```

## 8. Branch × Category Aggregations
**Endpoint:** `getBranchCategoryAggregations`  
**Chart:** Sales summary by branch and category combination

```sql
SELECT 
  line.store AS store,
  line.category AS category,
  SUM(line.incl_line_total) - SUM(line.tax) AS totalRevenue,
  SUM(line.cost_price * line.quantity) AS totalCost,
  COUNT(DISTINCT line.doc_number) AS transactionCount,
  COUNT(DISTINCT line.customer) AS uniqueCustomers,
  SUM(line.quantity) AS totalQuantity
FROM tblsaleslines AS line
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type IN ('1', '2')  -- Tax Invoices AND Credit Notes
  AND line.item_code IS NOT NULL
  AND line.item_code != '.'
  AND line.type = 'I'  -- Only inventory items
  AND line.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND line.store = :storeCode
  -- AND line.category = :category
  -- AND line.rep_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:excludeCustomerCategories)))
GROUP BY line.store, line.category
ORDER BY totalRevenue DESC
LIMIT 10000
```

## 9. Product Aggregations
**Endpoint:** `getProductAggregations`  
**Chart:** Top products by revenue

```sql
SELECT 
  line.item_code AS itemCode,
  line.description AS description,
  line.category AS category,
  SUM(line.incl_line_total) - SUM(line.tax) AS totalRevenue,
  SUM(line.cost_price * line.quantity) AS totalCost,
  SUM(line.quantity) AS totalQuantity,
  COUNT(DISTINCT line.doc_number) AS transactionCount
FROM tblsaleslines AS line
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type IN ('1', '2')  -- Tax Invoices AND Credit Notes
  AND line.item_code IS NOT NULL
  AND line.item_code != '.'  -- Exclude '.' item codes
  AND line.type = 'I'  -- Only inventory items
  AND line.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND line.store = :storeCode
  -- AND line.category = :category
  -- AND line.rep_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (line.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = line.customer AND customer.Category IN (:excludeCustomerCategories)))
GROUP BY line.description
ORDER BY totalRevenue DESC
LIMIT :limit  -- Default: 50, max: 10000
```

## 10. Hourly Sales Pattern
**Endpoint:** `getHourlySalesPattern`  
**Chart:** Sales aggregated by hour of day

```sql
SELECT 
  HOUR(header.sale_time) AS hour,
  COUNT(DISTINCT header.doc_number) AS transactionCount,
  CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) - SUM(CAST(header.total_tax AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS totalRevenue,
  COUNT(DISTINCT header.customer) AS uniqueCustomers
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type IN (1, 2)  -- Tax Invoices AND Credit Notes
  AND header.sale_time IS NOT NULL  -- Only records with time
  AND header.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND header.store = :storeCode
  -- AND header.sales_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:excludeCustomerCategories)))
GROUP BY HOUR(header.sale_time)
ORDER BY HOUR(header.sale_time) ASC
```

## 11. Payment Type Aggregations
**Endpoint:** `getPaymentTypeAggregations`  
**Chart:** Sales breakdown by payment method

```sql
SELECT 
  CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) - SUM(CAST(header.total_tax AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS taxExcludedTotal,
  CAST(SUM(CAST(header.cash AS DECIMAL(19,3))) - SUM(CAST(header.change_amnt AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS cash,
  CAST(SUM(CAST(header.credit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS credit_card,
  CAST(SUM(CAST(header.eft AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS eft,
  CAST(SUM(CAST(header.debit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS debit_card,
  CAST(SUM(CAST(header.cheque AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS cheque,
  CAST(SUM(CAST(header.voucher AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS voucher,
  CAST(SUM(CAST(header.account AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS account,
  CAST(SUM(CAST(header.snap_scan AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS snap_scan,
  CAST(SUM(CAST(header.zapper AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS zapper,
  CAST(SUM(CAST(header.extra AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS extra,
  CAST(SUM(CAST(header.offline_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS offline_card,
  CAST(SUM(CAST(header.fnb_qr AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS fnb_qr,
  COUNT(*) AS totalTransactions
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type IN (1, 2)  -- Tax Invoices AND Credit Notes
  AND header.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND header.store = :storeCode
  -- AND header.sales_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:excludeCustomerCategories)))
```

**Note:** Payment methods are then scaled proportionally to match the tax-excluded total in application code.

## 12. Conversion Rate Data
**Endpoint:** `getConversionRateData`  
**Chart:** Quotation to invoice conversion rate

### Query 1: Quotations
```sql
SELECT 
  COUNT(*) AS totalQuotations,
  CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS totalQuotationValue
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type = 3  -- Quotations
  AND header.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND header.store = :storeCode
  -- AND header.sales_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:excludeCustomerCategories)))
```

### Query 2: Converted Invoices
```sql
SELECT 
  COUNT(*) AS convertedInvoices,
  CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS convertedInvoiceValue
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type = 1  -- Tax Invoices
  AND header.invoice_used = 1  -- Converted from quotation
  AND header.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND header.store = :storeCode
  -- AND header.sales_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:excludeCustomerCategories)))
```

**Conversion Rate Calculation:** `(convertedInvoices / totalQuotations) * 100`

## 13. Document Type Breakdown
**Endpoint:** `getDocumentTypeBreakdown`  
**Chart:** Breakdown of all document types

```sql
SELECT 
  header.doc_type AS docType,
  header.doc_desc AS docDesc,
  COUNT(*) AS count,
  CAST(SUM(CAST(header.total_incl AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS totalValue
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.sale_date >= '2020-01-01'
  -- Optional filters:
  -- AND header.store = :storeCode
  -- AND header.sales_code IN (:salesPersonIds)
  -- AND EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:includeCustomerCategories))
  -- AND (header.customer IS NULL OR NOT EXISTS (SELECT 1 FROM tblcustomers customer WHERE customer.Code = header.customer AND customer.Category IN (:excludeCustomerCategories)))
GROUP BY header.doc_type, header.doc_desc
ORDER BY header.doc_type ASC
```

## 14. Master Data Queries

### 14a. Unique Branches
**Endpoint:** `getUniqueBranches` (part of `getMasterDataForFilters`)

```sql
SELECT DISTINCT line.store AS store
FROM tblsaleslines AS line
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type = '1'  -- Tax Invoices
  AND line.store IS NOT NULL
  AND line.store != ''
ORDER BY line.store ASC
```

### 14b. Unique Products
**Endpoint:** `getUniqueProducts` (part of `getMasterDataForFilters`)

```sql
SELECT DISTINCT 
  line.item_code AS itemCode,
  line.description AS description
FROM tblsaleslines AS line
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type = '1'  -- Tax Invoices
  AND line.item_code IS NOT NULL
  AND line.item_code != ''
ORDER BY line.item_code ASC
LIMIT 1000
```

### 14c. Unique Salespeople
**Endpoint:** `getUniqueSalespeople` (part of `getMasterDataForFilters`)

```sql
SELECT DISTINCT
  header.sales_code AS salesCode,
  salesman.Description AS salesName
FROM tblsalesheader AS header
LEFT JOIN tblsalesman AS salesman ON header.sales_code = salesman.Code
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type = 1  -- Tax Invoices
  AND header.sales_code IS NOT NULL
  AND header.sales_code != ''
ORDER BY header.sales_code ASC
```

### 14d. Unique Payment Methods
**Endpoint:** `getUniquePaymentMethods` (part of `getMasterDataForFilters`)

```sql
SELECT 
  CAST(SUM(CAST(header.cash AS DECIMAL(19,3))) - SUM(CAST(header.change_amnt AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS cash,
  CAST(SUM(CAST(header.credit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS credit_card,
  CAST(SUM(CAST(header.eft AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS eft,
  CAST(SUM(CAST(header.debit_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS debit_card,
  CAST(SUM(CAST(header.cheque AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS cheque,
  CAST(SUM(CAST(header.voucher AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS voucher,
  CAST(SUM(CAST(header.account AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS account,
  CAST(SUM(CAST(header.snap_scan AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS snap_scan,
  CAST(SUM(CAST(header.zapper AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS zapper,
  CAST(SUM(CAST(header.extra AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS extra,
  CAST(SUM(CAST(header.offline_card AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS offline_card,
  CAST(SUM(CAST(header.fnb_qr AS DECIMAL(19,3))) AS DECIMAL(19,2)) AS fnb_qr
FROM tblsalesheader AS header
WHERE header.sale_date BETWEEN :startDate AND :endDate
  AND header.doc_type IN (1, 2)  -- Tax Invoices AND Credit Notes
```

**Note:** Payment methods with non-zero values are returned as filter options.

### 14e. Unique Customer Categories
**Endpoint:** `getUniqueCustomerCategories` (part of `getMasterDataForFilters`)

```sql
SELECT DISTINCT
  customer.Category AS categoryCode,
  category.cust_cat_description AS categoryDescription
FROM tblsaleslines AS line
LEFT JOIN tblcustomers AS customer ON line.customer = customer.Code
LEFT JOIN tblcustomercategories AS category ON customer.Category = category.cust_cat_code
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type = '1'  -- Tax Invoices
  AND customer.Category IS NOT NULL
  AND customer.Category != ''
ORDER BY customer.Category ASC
```

## 15. Profile Sales (User-Specific)
**Endpoint:** `GET /erp/profile/sales`  
**Chart:** Sales data for logged-in user

Uses **Sales Person Aggregations** query (Query #6) with:
- `salesPersonId` filter set to user's `erpSalesRepCode`
- Date range from `user_targets.periodStartDate` to `user_targets.periodEndDate`

## 16. Profile Commissions by Product
**Endpoint:** `GET /erp/profile/commissions`  
**Chart:** Commission breakdown by product for user

Uses **Sales Lines by Date Range** query (Query #2) with:
- `salesPersonId` filter set to user's `erpSalesRepCode`
- `doc_type IN ('1', '2')`
- Then groups by `item_code` and calculates commission in application code

## 17. Profile Sales by Category
**Endpoint:** `GET /erp/profile/sales-by-category`  
**Chart:** Sales grouped by category for user

Uses **Category Aggregations** query (Query #7) with:
- `salesPersonId` filter set to user's `erpSalesRepCode`

## 18. Profile Commissions by Category
**Endpoint:** `GET /erp/profile/commissions-by-category`  
**Chart:** Commission breakdown grouped by commission percentage

Uses **Sales Lines by Date Range** query (Query #2) with:
- `salesPersonId` filter set to user's `erpSalesRepCode`
- `doc_type IN ('1', '2')`
- Then groups by `commission_per` percentage in application code

---

## Common Filter Patterns

### Customer Category Inclusion
```sql
AND EXISTS (
  SELECT 1 
  FROM tblcustomers customer 
  WHERE customer.Code = [table].customer 
    AND customer.Category IN (:includeCustomerCategories)
)
```

### Customer Category Exclusion
```sql
AND (
  [table].customer IS NULL 
  OR NOT EXISTS (
    SELECT 1 
    FROM tblcustomers customer 
    WHERE customer.Code = [table].customer 
      AND customer.Category IN (:excludeCustomerCategories)
  )
)
```

### Sales Person Filter (Header Table)
```sql
AND header.sales_code IN (:salesPersonIds)
```

### Sales Person Filter (Lines Table)
```sql
AND line.rep_code IN (:salesPersonIds)
```

---

## Notes

1. **Revenue Calculation:** All revenue calculations use `SUM(total_incl) - SUM(total_tax)` or `SUM(incl_line_total) - SUM(tax)` to exclude tax.

2. **Document Types:**
   - `doc_type = 1`: Tax Invoices
   - `doc_type = 2`: Credit Notes
   - `doc_type = 3`: Quotations
   - Revenue calculations typically use `doc_type IN (1, 2)`

3. **Data Quality Filters:**
   - `sale_date >= '2020-01-01'` - Excludes old data
   - `item_code IS NOT NULL` - Excludes null items
   - `item_code != '.'` - Excludes placeholder items
   - `type = 'I'` - Only inventory items (for lines table)

4. **Country Support:** All queries support country-specific database switching via `countryCode` parameter (defaults to 'SA').

5. **Caching:** All queries are cached with 10-minute TTL. Cache keys include country code, date range, and all filter parameters.

6. **Performance:** Large date ranges (>60 days) are automatically chunked into 30-day segments for better performance.

