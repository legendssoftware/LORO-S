# ERP System - Quick Reference Guide

## Core Business Rules

### 1. Document Types (CRITICAL)
```typescript
// We ONLY process Tax Invoices
doc_type = 1  // ✅ Tax Invoice (completed sale)
doc_type = 2  // ❌ Credit Note (not processed)
doc_type = 3  // ❌ Quotation (not processed)
doc_type = 4  // ❌ Sales Order (not processed)
```

### 2. Revenue Calculation
```typescript
// ✅ CORRECT - Use gross amount directly
revenue = line.incl_line_total

// ❌ WRONG - DO NOT subtract discount
revenue = line.incl_line_total - line.discount
```

**Reason**: The `incl_line_total` field already has discounts applied to the selling price.

---

## Database Fields

### tblsalesheader
| Field | Type | Description | Usage |
|-------|------|-------------|-------|
| `doc_type` | INT | Document type | Must equal `1` |
| `total_incl` | DECIMAL(19,3) | Gross total including tax | Used for header totals |
| `doc_number` | VARCHAR(500) | Unique invoice number | Transaction identifier |
| `sale_date` | DATE | Sale date | Date filtering |
| `store` | VARCHAR(3) | Store/branch code | Branch filtering |

### tblsaleslines
| Field | Type | Description | Usage |
|-------|------|-------------|-------|
| `doc_type` | VARCHAR(20) | Document type | Must equal `'1'` |
| `incl_line_total` | DECIMAL(10,3) | Gross line total | **Primary revenue field** |
| `discount` | DECIMAL(19,2) | Discount amount | Already applied, don't subtract |
| `quantity` | DECIMAL(10,3) | Quantity sold | Can be 0 |
| `cost_price` | DECIMAL(10,2) | Cost per unit | For GP calculation |
| `item_code` | VARCHAR(100) | Product code | Product identifier |
| `category` | VARCHAR(200) | Product category | Category reporting |

---

## Common Query Patterns

### 1. Daily Sales Aggregation
```sql
SELECT
  DATE(line.sale_date) as date,
  line.store as store,
  SUM(line.incl_line_total) as totalRevenue,  -- ✅ Use gross amount
  SUM(line.cost_price * line.quantity) as totalCost,
  COUNT(DISTINCT line.doc_number) as transactionCount,
  COUNT(DISTINCT line.customer) as uniqueCustomers,
  SUM(line.quantity) as totalQuantity
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type = '1'  -- ✅ Tax Invoices only
  AND line.item_code IS NOT NULL
  AND line.sale_date >= '2020-01-01'
GROUP BY DATE(line.sale_date), line.store
ORDER BY DATE(line.sale_date) ASC
```

### 2. Branch Performance
```sql
SELECT
  line.store as store,
  SUM(line.incl_line_total) as totalRevenue,  -- ✅ Use gross amount
  SUM(line.cost_price * line.quantity) as totalCost,
  COUNT(DISTINCT line.doc_number) as transactionCount
FROM tblsaleslines line
WHERE line.sale_date BETWEEN :startDate AND :endDate
  AND line.doc_type = '1'  -- ✅ Tax Invoices only
  AND line.item_code IS NOT NULL
GROUP BY line.store
ORDER BY totalRevenue DESC
```

---

## TypeScript Transformers

### Revenue Calculation
```typescript
// ✅ CORRECT
transformToSalesTransaction(line: TblSalesLines): SalesTransaction {
  const revenue = line.incl_line_total || 0;  // Use gross amount
  const cost = (line.cost_price || 0) * (line.quantity || 0);
  const grossProfit = revenue - cost;
  
  return { revenue, cost, grossProfit, ... };
}

// ❌ WRONG
transformToSalesTransaction(line: TblSalesLines): SalesTransaction {
  const revenue = (line.incl_line_total || 0) - (line.discount || 0);  // Don't do this!
  ...
}
```

---

## Data Filters

### What We Include ✅
- Tax Invoices only (`doc_type = '1'`)
- All quantities (including 0)
- Transactions from 2020-01-01 onwards
- Items with valid `item_code`

### What We Exclude ❌
- Credit Notes (`doc_type = '2'`)
- Quotations (`doc_type = '3'`)
- Sales Orders (`doc_type = '4'`)
- Items without `item_code`
- Transactions before 2020-01-01

---

## Interface Reference

### Aggregation Results
```typescript
interface DailyAggregation {
  date: string;
  store: string;
  totalRevenue: number;        // Sum of incl_line_total
  totalCost: number;           // Sum of (cost_price * quantity)
  transactionCount: number;    // COUNT DISTINCT doc_number
  uniqueCustomers: number;     // COUNT DISTINCT customer
  totalQuantity: number;       // Sum of quantity
  // NOTE: totalGrossProfit removed from queries
}
```

---

## Common Mistakes to Avoid

### ❌ DON'T
```typescript
// 1. Don't subtract discount from revenue
revenue = incl_line_total - discount  // WRONG!

// 2. Don't filter out zero quantities
.andWhere('line.quantity != 0')  // WRONG!

// 3. Don't process all document types
.andWhere('line.doc_type IN (:...docTypes)', { docTypes: ['1', '2', '3', '4'] })  // WRONG!

// 4. Don't calculate gross profit in aggregation queries
SUM(line.incl_line_total - line.discount - (line.cost_price * line.quantity)) as totalGrossProfit  // WRONG!
```

### ✅ DO
```typescript
// 1. Use gross amount directly
revenue = incl_line_total  // CORRECT!

// 2. Include all quantities
// Simply don't filter by quantity

// 3. Process only Tax Invoices
.andWhere('line.doc_type = :docType', { docType: '1' })  // CORRECT!

// 4. Keep queries simple
SUM(line.incl_line_total) as totalRevenue  // CORRECT!
```

---

## Cache Configuration

### Cache Keys
```typescript
// Pattern: erp:v2:{dataType}:{startDate}:{endDate}:{store}:{category}:{docTypes}
'erp:v2:daily_agg:2024-01-01:2024-01-31:all:all:1'
'erp:v2:branch_agg:2024-01-01:2024-01-31:001:all:1'
```

### Cache TTL
- Default: 3600 seconds (1 hour)
- Warmed hourly for common date ranges
- Cleared on manual refresh

---

## Connection Pool Settings

```typescript
// ERP Database Configuration
connectionLimit: 75              // Handles 15 concurrent requests × 4 parallel queries
acquireTimeout: 30000           // 30s wait for connection
timeout: 90000                  // 90s query timeout for large aggregations
idleTimeout: 600000             // 10 minutes idle before release
waitForConnections: true        // Queue instead of fail
queueLimit: 0                   // Unlimited queue
```

---

## Performance Tips

1. **Always use date range filters** - Don't query without date constraints
2. **Cache warm common ranges** - Pre-cache frequent queries
3. **Parallel aggregations** - Use `getAllAggregationsParallel()` for multiple metrics
4. **Store-specific queries** - Filter by store when possible
5. **Monitor connection pool** - Check utilization with `getConnectionPoolInfo()`

---

## Debugging

### Check Connection
```typescript
await this.erpDataService.getConnectionPoolInfo();
```

### Clear Cache
```typescript
await this.erpDataService.clearCache('2024-01-01', '2024-01-31');
```

### Verify Query
```typescript
// Add logging to see SQL generated
logging: true  // In app.module.ts ERP config
```

---

## Version History

- **v2.0** (Nov 3, 2025): Revised to use gross amounts, removed discount subtraction
- **v1.0** (Initial): Original implementation with discount subtraction

---

**Last Updated**: November 3, 2025  
**Status**: Production Ready ✅

