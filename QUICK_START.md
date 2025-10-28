# 🚀 Performance Tracker - Quick Start Guide

## For Mobile App Developers

### **TL;DR**
✅ **One endpoint returns EVERYTHING**: `GET /reports/performance?organisationId=1`  
✅ **Mock data is ready to use**  
✅ **No changes needed when we switch to real database**

---

## 📱 Mobile App Integration (5 Steps)

### **Step 1: Make ONE API Call**

```typescript
const response = await fetch(
  'https://api.loro.com/reports/performance?organisationId=1',
  {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }
);

const result = await response.json();
```

### **Step 2: Get ALL Data from Response**

```typescript
if (result.success) {
  const {
    dashboard,      // Summary + Charts
    dailySales,     // Daily sales table
    branchCategory, // Branch × Category matrix
    salesPerStore,  // Sales per store
    masterData      // Filters data (locations, branches, products, etc.)
  } = result.data;
}
```

### **Step 3: Render Your UI**

```typescript
// Summary Cards
<SummaryCards summary={dashboard.summary} />

// Charts
<RevenueTrendChart data={dashboard.charts.revenueTrend} />
<SalesByCategoryPieChart data={dashboard.charts.salesByCategory} />
<BranchPerformanceBarChart data={dashboard.charts.branchPerformance} />
// ... more charts

// Daily Sales Table
<DailySalesTable data={dailySales} />

// Branch Performance Matrix
<BranchCategoryMatrix data={branchCategory} />

// Sales Per Store List
<SalesPerStoreList data={salesPerStore} />
```

### **Step 4: Use Master Data for Filters**

```typescript
// Dropdown filters
<LocationFilter locations={masterData.locations} />
<BranchFilter branches={masterData.branches} />
<CategoryFilter categories={masterData.productCategories} />
<ProductFilter products={masterData.products} />
<SalespersonFilter salesPeople={masterData.salesPeople} />
```

### **Step 5: Apply Filters (Optional)**

```typescript
// Add filters to URL
const filters = {
  organisationId: 1,
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  county: 'South Africa',
  category: 'Drywall & Partition'
};

const queryString = new URLSearchParams(filters).toString();
const url = `https://api.loro.com/reports/performance?${queryString}`;
```

---

## 🎯 What You Get (All in One Response)

```typescript
{
  success: true,
  data: {
    // 1. Dashboard (Summary + 9 Charts)
    dashboard: {
      summary: { totalRevenue, totalTarget, performanceRate, ... },
      charts: {
        revenueTrend,        // Line chart
        hourlySales,         // Line chart
        salesByCategory,     // Pie chart
        branchPerformance,   // Bar chart
        topProducts,         // Bar chart
        itemsPerBasket,      // Dual-axis chart
        salesBySalesperson,  // Dual-axis chart
        conversionRate,      // Pie chart
        customerComposition  // Pie chart
      }
    },
    
    // 2. Daily Sales (Table Data)
    dailySales: [
      { date, dayOfWeek, basketCount, basketValue, clientsQty, salesR, gpR, gpPercentage }
    ],
    
    // 3. Branch × Category Performance (Matrix)
    branchCategory: [
      { branchId, branchName, categories: {...}, total: {...} }
    ],
    
    // 4. Sales Per Store (Aggregated)
    salesPerStore: [
      { storeId, storeName, totalRevenue, transactionCount, ... }
    ],
    
    // 5. Master Data (for Filters)
    masterData: {
      locations: [33 locations],
      branches: [33 branches],
      products: [30 products],
      productCategories: [5 categories],
      salesPeople: [66 salespeople]
    }
  }
}
```

---

## 🔍 Available Filters

| Filter | Type | Example |
|--------|------|---------|
| `organisationId` | Number (Required) | `1` |
| `startDate` | String | `2025-01-01` |
| `endDate` | String | `2025-01-31` |
| `branchIds` | String (comma-separated) | `B001,B002,B003` |
| `county` | String | `South Africa` |
| `province` | String | `Gauteng` |
| `city` | String | `Johannesburg` |
| `suburb` | String | `Sandton` |
| `category` | String | `Drywall & Partition` |
| `productIds` | String (comma-separated) | `P001,P002` |
| `minPrice` | Number | `100` |
| `maxPrice` | Number | `500` |
| `salesPersonIds` | String (comma-separated) | `SP001,SP002` |

---

## 📊 Mock Data Details

**Current data includes:**
- 📍 **33 Southern African locations** (SA, Botswana, Namibia, Zimbabwe, Zambia, Malawi, Rwanda, Mozambique)
- 🏢 **33 branches** (one per location)
- 📦 **30 building materials products**
- 🏷️ **5 product categories**
- 👥 **66 salespeople**
- 📈 **365 days** of performance data
- 💰 **90 days** of detailed transactions

**Realistic patterns:**
- Q1: 95-115% of target (🟢 GREEN)
- Q2: 100-125% of target (🟢 GREEN)
- Q3: 70-90% of target (🔴 RED)
- Q4: 90-110% of target (🟡 YELLOW/🟢 GREEN)
- Weekends: 85% of weekday performance
- Peak hours: 10am-2pm, 5pm-7pm

---

## ⚡ Performance Tips

1. **Cache the response** for 5-10 minutes
2. **Show loading state** during fetch
3. **Use pull-to-refresh** for manual updates
4. **Show last updated timestamp**
5. **Handle errors gracefully**

---

## 🐛 Error Handling

```typescript
try {
  const response = await fetch(url, options);
  const result = await response.json();
  
  if (!result.success) {
    // Handle error
    console.error(result.error?.details);
    showNotification(result.error?.details || 'Failed to load data');
    return;
  }
  
  // Success - use result.data
  renderPerformanceData(result.data);
  
} catch (error) {
  // Network error
  console.error(error);
  showNotification('Network error. Please check your connection.');
}
```

---

## 📚 Full Documentation

For complete details, see:
- **API Documentation**: `PERFORMANCE_TRACKER_API.md`
- **Implementation Details**: `IMPLEMENTATION_SUMMARY.md`

---

## ❓ Need Help?

Contact: backend@loro.com

---

**Status**: ✅ **READY TO USE** (Mock Data - Phase 1)  
**Last Updated**: October 28, 2025

