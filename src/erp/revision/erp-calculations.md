# ERP Data Processing and Calculations

## Total Revenue Calculation

**Formula:**
```
Total Revenue = SUM(incl_line_total) WHERE doc_type = 1
```

**Source:**
- Table: `tblsaleslines`
- Field: `incl_line_total` (Decimal 10,3)
- Filter: Only Tax Invoices (`doc_type = 1`)
- Note: Discount already applied, no subtraction needed

**Implementation:**
```typescript
// SQL Query
SUM(line.incl_line_total) as totalRevenue
WHERE line.doc_type = '1'

// TypeScript Calculation
const totalRevenue = data.reduce((sum, item) => {
    const revenue = parseFloat(String(item.revenue || 0));
    return sum + revenue;
}, 0);
```

---

## Data Flow: Mobile Performance Screen

### Flow Path
```
Mobile App → API Call → Backend Generator → ERP Service → SQL Query → Transform → Return
```

### Step-by-Step

1. **Mobile App** (`mobile/app/(tabs)/home/performance/index.tsx`)
   - Uses `usePerformanceDashboard()` hook
   - Calls `PerformanceAPI.fetchDashboardData(filters, token)`

2. **API Call** (`mobile/lib/api/performance.api.ts`)
   - Endpoint: `GET /reports/performance/dashboard`
   - Params: `organisationId`, `startDate`, `endDate`, filters

3. **Backend Controller** (`server/src/reports/reports.controller.ts`)
   - Route: `GET /reports/performance/dashboard`
   - Calls `reportsService.getUnifiedPerformanceData(params)`

4. **Reports Service** (`server/src/reports/reports.service.ts`)
   - Creates `PerformanceDashboardGenerator`
   - Calls `generator.generate(filters)`

5. **Dashboard Generator** (`server/src/reports/generators/performance-dashboard.generator.ts`)
   - Calls `erpDataService.getSalesLinesByDateRange(filters)` → Gets `TblSalesLines[]`
   - Calls `erpDataService.getSalesHeadersByDateRange(filters)` → Gets `TblSalesHeader[]`
   - Calls `erpTransformerService.transformToPerformanceDataList(lines, headers)` → Transforms to `PerformanceData[]`
   - Calculates summary: `totalRevenue = SUM(performanceData.revenue)`

6. **ERP Data Service** (`server/src/erp/services/erp-data.service.ts`)
   - Executes SQL: `SELECT * FROM tblsaleslines WHERE sale_date BETWEEN ... AND doc_type = '1'`
   - Returns raw `TblSalesLines[]` entities

7. **ERP Transformer** (`server/src/erp/services/erp-transformer.service.ts`)
   - Transforms: `revenue = parseFloat(line.incl_line_total)`
   - Maps: `branchId`, `categoryId`, `salesPersonId`

8. **Response**
   - Returns `PerformanceDashboardDataDto` with:
     - `summary.totalRevenue` (calculated from all line items)
     - Charts data
     - Tables data
     - Master data

### Key Methods

**Get Performance Data:**
```typescript
// performance-dashboard.generator.ts
private async getPerformanceData(params): Promise<PerformanceData[]> {
    const filters = this.buildErpFilters(params);
    const salesLines = await this.erpDataService.getSalesLinesByDateRange(filters);
    const headers = await this.erpDataService.getSalesHeadersByDateRange(filters);
    return this.erpTransformerService.transformToPerformanceDataList(salesLines, headers);
}
```

**Calculate Total Revenue:**
```typescript
// performance-dashboard.generator.ts
private calculateSummary(data: PerformanceData[], totalTarget: number) {
    const totalRevenue = data.reduce((sum, item) => {
        const revenue = parseFloat(String(item.revenue || 0));
        return sum + revenue;
    }, 0);
    // ... rest of summary
}
```

---

## Other Calculations

**Cost:** `cost_price × quantity`  
**Gross Profit:** `Revenue - Cost`  
**GP %:** `(GP / Revenue) × 100` (if revenue > 0)

**Aggregations:**
- Daily: `SUM(incl_line_total)` grouped by `DATE(sale_date), store`
- Branch: `SUM(incl_line_total)` grouped by `store`
- Category: `SUM(incl_line_total)` grouped by `category, store`
- Product: `SUM(incl_line_total)` grouped by `item_code, description, category`

