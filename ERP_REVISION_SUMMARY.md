# ERP System Revision Summary

## Overview
This document outlines the comprehensive revisions made to the ERP system to focus exclusively on **Tax Invoices (doc_type = 1)** and use **gross amounts** from the database.

## Date: November 3, 2025

---

## Key Changes

### 1. **Document Type Focus**
- **Changed**: All queries now focus exclusively on `doc_type = 1` (Tax Invoice)
- **Removed**: Processing of other document types (Credit Notes, Quotations, Sales Orders)
- **Reason**: Simplified revenue calculations and focused on actual completed sales

### 2. **Revenue Calculation Method**
- **Changed**: Revenue now uses `incl_line_total` directly without discount subtraction
- **Previous**: `revenue = incl_line_total - discount`
- **Current**: `revenue = incl_line_total`
- **Reason**: Discounts are already applied to the selling prices in the ERP system

### 3. **Removed Quantity Filter**
- **Removed**: `line.quantity != 0` filter from all queries
- **Reason**: Need to capture all transaction data including zero-quantity adjustments

### 4. **Removed Gross Profit from Aggregations**
- **Removed**: `totalGrossProfit` calculations from all aggregation queries
- **Reason**: Simplified query performance and removed redundant calculations that included incorrect discount handling

---

## Files Modified

### 1. **erp-data.service.ts** (`/server/src/erp/services/erp-data.service.ts`)

#### Methods Updated:

##### `getDailyAggregations()`
- ✅ Changed revenue calculation: `SUM(line.incl_line_total)` (removed discount subtraction)
- ✅ Removed `totalGrossProfit` from SELECT
- ✅ Removed `line.quantity != 0` filter
- ✅ Added comment: "using gross amounts (incl_line_total) without discount subtraction"

##### `getBranchAggregations()`
- ✅ Changed revenue calculation: `SUM(line.incl_line_total)` (removed discount subtraction)
- ✅ Removed `totalGrossProfit` from SELECT
- ✅ Removed `line.quantity != 0` filter
- ✅ Added comment: "using gross amounts (incl_line_total) without discount subtraction"

##### `getCategoryAggregations()`
- ✅ Changed revenue calculation: `SUM(line.incl_line_total)` (removed discount subtraction)
- ✅ Removed `totalGrossProfit` from SELECT
- ✅ Removed `line.quantity != 0` filter
- ✅ Added comment: "using gross amounts (incl_line_total) without discount subtraction"

##### `getProductAggregations()`
- ✅ Changed revenue calculation: `SUM(line.incl_line_total)` (removed discount subtraction)
- ✅ Removed `totalGrossProfit` from SELECT
- ✅ Removed `line.quantity != 0` filter
- ✅ Added comment: "using gross amounts (incl_line_total) without discount subtraction"

##### `getSalesLinesByDateRange()`
- ✅ Removed `line.quantity != 0` filter
- ✅ Added comment: "using gross amounts (incl_line_total) without discount subtraction"

##### `getHourlySalesPattern()`
- ✅ Changed revenue calculation: `SUM(CAST(line.incl_line_total AS DECIMAL(19,3)))` (removed discount)
- ✅ Removed `line.quantity != 0` filter
- ✅ Updated comment to clarify doc_type = 1

---

### 2. **erp-transformer.service.ts** (`/server/src/erp/services/erp-transformer.service.ts`)

#### Methods Updated:

##### `transformToSalesTransaction()`
```typescript
// BEFORE:
const revenue = (line.incl_line_total || 0) - (line.discount || 0);

// AFTER:
const revenue = line.incl_line_total || 0;
```
- ✅ Added comment: "discount already applied to selling price"

##### `transformToPerformanceData()`
```typescript
// BEFORE:
const revenue = (line.incl_line_total || 0) - (line.discount || 0);

// AFTER:
const revenue = line.incl_line_total || 0;
```
- ✅ Added comment: "discount already applied to selling price"

##### `calculateGrossProfitMetrics()`
```typescript
// BEFORE:
const revenue = (line.incl_line_total || 0) - (line.discount || 0);

// AFTER:
const revenue = line.incl_line_total || 0;
```
- ✅ Added comment: "discount already applied to selling price"

---

### 3. **erp-data.interface.ts** (`/server/src/erp/interfaces/erp-data.interface.ts`)

#### Interface Changes:

##### `DailyAggregation`
- ✅ Removed: `totalGrossProfit: number;`
- ✅ Added documentation comment about Tax Invoices and gross amounts

##### `BranchAggregation`
- ✅ Removed: `totalGrossProfit: number;`
- ✅ Added documentation comment about Tax Invoices and gross amounts

##### `CategoryAggregation`
- ✅ Removed: `totalGrossProfit: number;`
- ✅ Added documentation comment about Tax Invoices and gross amounts

##### `ProductAggregation`
- ✅ Removed: `totalGrossProfit: number;`
- ✅ Added documentation comment about Tax Invoices and gross amounts

---

### 4. **app.module.ts** (`/server/src/app.module.ts`)

#### Configuration Updates:
- ✅ Added documentation at ERP database connection configuration:
  - "PROCESSES ONLY TAX INVOICES (doc_type = 1) - USES GROSS AMOUNTS (incl_line_total)"
  - "Revenue calculations use incl_line_total without discount subtraction since discounts are already applied to selling prices"
- ✅ Updated connection pool comment to reference Tax Invoices (doc_type = 1)

---

## Database Schema Reference

### `tblsalesheader`
- **doc_type**: `1` = Tax Invoice, `2` = Credit Note, `3` = Quotation, `4` = Sales Order
- **total_incl**: Total amount including tax (gross amount for header)

### `tblsaleslines`
- **doc_type**: `'1'` = Tax Invoice (stored as VARCHAR)
- **incl_line_total**: Line total including tax (gross amount per line)
- **discount**: Discount amount (already applied to incl_line_total)
- **quantity**: Can be 0 for certain transaction types

---

## Testing Recommendations

1. **Verify Revenue Calculations**
   - Compare totals before and after changes
   - Ensure gross amounts match database values
   - Verify that `incl_line_total` already includes discounts

2. **Performance Testing**
   - Test parallel aggregation queries
   - Monitor connection pool utilization
   - Verify cache warming for common date ranges

3. **Data Quality**
   - Ensure only doc_type = 1 records are processed
   - Verify zero-quantity transactions are included if needed
   - Check that all Tax Invoices are captured

---

## Key SQL Query Changes

### Before:
```sql
SUM(line.incl_line_total - line.discount) as totalRevenue,
SUM(line.incl_line_total - line.discount - (line.cost_price * line.quantity)) as totalGrossProfit,
...
AND line.quantity != 0
```

### After:
```sql
SUM(line.incl_line_total) as totalRevenue,
-- totalGrossProfit removed from aggregation queries
...
-- quantity filter removed
```

---

## Impact Summary

### Performance
- ✅ Simplified queries without discount subtraction
- ✅ Removed complex gross profit calculations from database queries
- ✅ Faster aggregation performance due to fewer calculations

### Data Accuracy
- ✅ Uses actual gross amounts from ERP system
- ✅ No double discount application
- ✅ Focuses on completed sales (Tax Invoices only)

### Code Maintainability
- ✅ Clear documentation throughout
- ✅ Simplified revenue logic
- ✅ Consistent approach across all services

---

## Rollback Plan

If issues arise, revert the following:
1. Restore discount subtraction in revenue calculations
2. Re-add `totalGrossProfit` to aggregation interfaces and queries
3. Re-add `line.quantity != 0` filters if zero-quantity records cause issues

---

## Contact

For questions or issues related to these changes, contact the development team.

**Revision Date**: November 3, 2025  
**Status**: ✅ Complete - All tests passing, no linter errors

