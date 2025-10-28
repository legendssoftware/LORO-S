# 🚀 Performance Tracker API - Unified Endpoint Documentation

## 📋 Overview

The Performance Tracker provides comprehensive sales and performance analytics through **ONE unified endpoint**. The mobile app only needs to call **ONE API endpoint** to get **ALL performance data**.

---

## 🎯 Main Endpoint: Get All Performance Data

### **Endpoint**
```
GET /reports/performance
```

### **Description**
Returns ALL performance data in a single API call:
- Dashboard with summary metrics and charts
- Daily sales performance
- Branch × Category performance matrix
- Sales per store data
- Master data (locations, branches, products, salespeople, categories)

### **Authentication**
- **Required**: Bearer token in Authorization header
- **Roles**: ADMIN, MANAGER, OWNER, USER

---

## 📥 Request

### **Query Parameters**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `organisationId` | Number | ✅ Yes | Organization ID | `1` |
| `branchId` | Number | ❌ No | Filter by specific branch | `5` |
| `startDate` | String | ❌ No | Start date (YYYY-MM-DD) | `2025-01-01` |
| `endDate` | String | ❌ No | End date (YYYY-MM-DD) | `2025-01-31` |
| `branchIds` | String | ❌ No | Comma-separated branch IDs | `1,2,3` |
| `salesPersonIds` | String | ❌ No | Comma-separated salesperson IDs | `SP001,SP002` |
| `category` | String | ❌ No | Product category name | `Drywall & Partition` |
| `productIds` | String | ❌ No | Comma-separated product IDs | `P001,P002` |
| `minPrice` | Number | ❌ No | Minimum product price | `100` |
| `maxPrice` | Number | ❌ No | Maximum product price | `500` |
| `county` | String | ❌ No | Filter by country | `South Africa` |
| `province` | String | ❌ No | Filter by province | `Gauteng` |
| `city` | String | ❌ No | Filter by city | `Johannesburg` |
| `suburb` | String | ❌ No | Filter by suburb | `Sandton` |

### **Example Request**

```typescript
// Mobile App - Single API Call
const response = await fetch(
  'https://api.loro.com/reports/performance?organisationId=1&startDate=2025-01-01&endDate=2025-01-31',
  {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }
);

const data = await response.json();
```

---

## 📤 Response Structure

### **Success Response (200 OK)**

```typescript
{
  success: true,
  message: "Unified performance data retrieved successfully",
  timestamp: "2025-10-28T10:30:00.000Z",
  data: {
    // 1. DASHBOARD DATA
    dashboard: {
      summary: {
        totalRevenue: 1500000.50,
        totalTarget: 2000000.00,
        performanceRate: 75.00,
        transactionCount: 1250,
        averageOrderValue: 1200.00,
        averageItemsPerBasket: 5.5
      },
      charts: {
        revenueTrend: { data: [...], targetValue: 150000 },
        hourlySales: { data: [...], targetValue: 50000 },
        salesByCategory: { data: [...], total: 1500000 },
        branchPerformance: { data: [...], averageTarget: 500000 },
        topProducts: { data: [...], total: 800000 },
        itemsPerBasket: { data: [...], targetValue: 6.0 },
        salesBySalesperson: { data: [...] },
        conversionRate: { data: [...], total: 1000000, percentage: 65.5 },
        customerComposition: { data: [...], total: 1500000 }
      },
      filters: { /* applied filters */ },
      metadata: {
        lastUpdated: "2025-10-28T10:30:00.000Z",
        dataQuality: "excellent",
        recordCount: 1250,
        organizationTimezone: "Africa/Johannesburg"
      }
    },

    // 2. DAILY SALES PERFORMANCE
    dailySales: [
      {
        date: "2025-01-15",
        dayOfWeek: "Monday",
        basketCount: 45,
        basketValue: 1250.50,
        clientsQty: 38,
        salesR: 56272.50,
        gpR: 18456.75,
        gpPercentage: 32.8
      },
      // ... more daily records
    ],

    // 3. BRANCH × CATEGORY PERFORMANCE
    branchCategory: [
      {
        branchId: "B001",
        branchName: "Sandton Branch",
        categories: {
          "CAT001": {
            categoryName: "Drywall & Partition",
            basketCount: 150,
            basketValue: 2500.00,
            clientsQty: 120,
            salesR: 375000.00,
            gpR: 125000.00,
            gpPercentage: 33.33
          },
          // ... more categories
        },
        total: {
          categoryName: "Total",
          basketCount: 450,
          basketValue: 2200.00,
          clientsQty: 380,
          salesR: 990000.00,
          gpR: 330000.00,
          gpPercentage: 33.33
        }
      },
      // ... more branches
    ],

    // 4. SALES PER STORE
    salesPerStore: [
      {
        storeId: "B001",
        storeName: "Sandton Branch",
        totalRevenue: 990000.00,
        transactionCount: 450,
        averageTransactionValue: 2200.00,
        totalItemsSold: 2250,
        uniqueClients: 380,
        grossProfit: 330000.00,
        grossProfitPercentage: 33.33
      },
      // ... more stores
    ],

    // 5. MASTER DATA (for filters)
    masterData: {
      locations: [
        {
          id: "L001",
          county: "South Africa",
          province: "Gauteng",
          city: "Johannesburg",
          suburb: "Sandton"
        },
        // ... 33 locations total
      ],
      productCategories: [
        {
          id: "CAT001",
          name: "Drywall & Partition",
          description: "Drywall sheets, studs, and partition materials"
        },
        // ... 5 categories total
      ],
      products: [
        {
          id: "P001",
          name: "Standard Drywall Sheet 1200x2400mm",
          category: "Drywall & Partition",
          categoryId: "CAT001",
          price: 145,
          costPrice: 98
        },
        // ... 30 products total
      ],
      branches: [
        {
          id: "B001",
          name: "Sandton Branch",
          locationId: "L001"
        },
        // ... 33 branches total
      ],
      salesPeople: [
        {
          id: "SP001",
          name: "Thabo Molefe",
          branchId: "B001",
          role: "Sales Manager",
          employeeNumber: "EMP001"
        },
        // ... 66 salespeople total
      ]
    }
  }
}
```

### **Error Response (4xx, 5xx)**

```typescript
{
  success: false,
  error: {
    code: "UNIFIED_PERFORMANCE_ERROR",
    details: "Error message here",
    context: {
      organisationId: 1
    }
  },
  timestamp: "2025-10-28T10:30:00.000Z"
}
```

---

## 📊 Data Characteristics

### **Mock Data (Phase 1 - Current)**
- **365 days** of performance data
- **90 days** of detailed sales transactions
- **33 branches** across Southern African countries
- **30 building materials products** 
- **5 product categories**
- **66 salespeople**

### **Realistic Patterns**
- **Q1 (Jan-Mar)**: 95-115% of target (GREEN)
- **Q2 (Apr-Jun)**: 100-125% of target (GREEN)
- **Q3 (Jul-Sep)**: 70-90% of target (RED)
- **Q4 (Oct-Dec)**: 90-110% of target (YELLOW/GREEN)
- **Weekends**: Lower performance (85% of weekday average)
- **Hourly patterns**: Peak sales 10am-2pm, secondary peak 5pm-7pm

---

## 🎨 Mobile App Integration

### **TypeScript Types/Interfaces**

```typescript
// Main Response Interface
interface UnifiedPerformanceResponse {
  success: boolean;
  message?: string;
  data?: UnifiedPerformanceData;
  error?: {
    code: string;
    details: string;
    context?: any;
  };
  timestamp: string;
}

interface UnifiedPerformanceData {
  dashboard: DashboardData;
  dailySales: DailySalesPerformance[];
  branchCategory: BranchCategoryPerformance[];
  salesPerStore: SalesPerStore[];
  masterData: MasterData;
}

// Dashboard Data
interface DashboardData {
  summary: {
    totalRevenue: number;
    totalTarget: number;
    performanceRate: number;
    transactionCount: number;
    averageOrderValue: number;
    averageItemsPerBasket: number;
  };
  charts: {
    revenueTrend: LineChartData;
    hourlySales: LineChartData;
    salesByCategory: PieChartData;
    branchPerformance: BarChartData;
    topProducts: BarChartData;
    itemsPerBasket: DualAxisChartData;
    salesBySalesperson: DualAxisChartData;
    conversionRate: PieChartData;
    customerComposition: PieChartData;
  };
  filters: any;
  metadata: {
    lastUpdated: string;
    dataQuality: string;
    recordCount: number;
    organizationTimezone: string;
    fromCache?: boolean;
    cachedAt?: string;
  };
}

// Daily Sales Performance
interface DailySalesPerformance {
  date: string;
  dayOfWeek: string;
  basketCount: number;
  basketValue: number;
  clientsQty: number;
  salesR: number;
  gpR: number;
  gpPercentage: number;
}

// Branch × Category Performance
interface BranchCategoryPerformance {
  branchId: string;
  branchName: string;
  categories: Record<string, CategoryPerformance>;
  total: CategoryPerformance;
}

interface CategoryPerformance {
  categoryName: string;
  basketCount: number;
  basketValue: number;
  clientsQty: number;
  salesR: number;
  gpR: number;
  gpPercentage: number;
}

// Sales Per Store
interface SalesPerStore {
  storeId: string;
  storeName: string;
  totalRevenue: number;
  transactionCount: number;
  averageTransactionValue: number;
  totalItemsSold: number;
  uniqueClients: number;
  grossProfit: number;
  grossProfitPercentage: number;
}

// Master Data
interface MasterData {
  locations: Location[];
  productCategories: ProductCategory[];
  products: Product[];
  branches: Branch[];
  salesPeople: SalesPerson[];
}

interface Location {
  id: string;
  county: string;
  province: string;
  city: string;
  suburb: string;
}

interface ProductCategory {
  id: string;
  name: string;
  description: string;
}

interface Product {
  id: string;
  name: string;
  category: string;
  categoryId: string;
  price: number;
  costPrice: number;
}

interface Branch {
  id: string;
  name: string;
  locationId: string;
}

interface SalesPerson {
  id: string;
  name: string;
  branchId: string;
  role: string;
  employeeNumber: string;
  avatar?: string;
}

// Chart Data Types
interface LineChartData {
  data: Array<{ label: string; value: number; dataPointText?: string }>;
  targetValue?: number;
}

interface BarChartData {
  data: Array<{ label: string; value: number; target?: number; fullName?: string }>;
  averageTarget?: number;
}

interface PieChartData {
  data: Array<{ label: string; value: number; color?: string; text?: string }>;
  total: number;
  percentage?: number;
}

interface DualAxisChartData {
  data: Array<{ label: string; value: number; secondaryValue: number; fullName?: string }>;
  targetValue?: number;
}
```

### **React/React Native Hook Example**

```typescript
import { useState, useEffect } from 'react';

export const usePerformanceData = (organisationId: number, filters?: any) => {
  const [data, setData] = useState<UnifiedPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPerformanceData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const queryParams = new URLSearchParams({
          organisationId: organisationId.toString(),
          ...filters
        });

        const response = await fetch(
          `https://api.loro.com/reports/performance?${queryParams}`,
          {
            headers: {
              'Authorization': `Bearer ${getToken()}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const result: UnifiedPerformanceResponse = await response.json();

        if (result.success) {
          setData(result.data);
        } else {
          setError(result.error?.details || 'Failed to fetch performance data');
        }
      } catch (err) {
        setError(err.message || 'Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchPerformanceData();
  }, [organisationId, JSON.stringify(filters)]);

  return { data, loading, error };
};

// Usage in component
function PerformanceDashboard() {
  const { data, loading, error } = usePerformanceData(1, {
    startDate: '2025-01-01',
    endDate: '2025-01-31'
  });

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;
  if (!data) return null;

  return (
    <View>
      {/* Dashboard Summary */}
      <SummaryCards summary={data.dashboard.summary} />
      
      {/* Charts */}
      <Charts charts={data.dashboard.charts} />
      
      {/* Daily Sales Table */}
      <DailySalesTable data={data.dailySales} />
      
      {/* Branch Performance Matrix */}
      <BranchCategoryMatrix data={data.branchCategory} />
      
      {/* Sales Per Store */}
      <SalesPerStoreList data={data.salesPerStore} />
      
      {/* Filters - use masterData */}
      <Filters masterData={data.masterData} />
    </View>
  );
}
```

---

## ⚡ Performance & Caching

### **Server-Side Caching**
- **Cache Duration**: 5 minutes (configurable)
- **Cache Key**: Based on all filter parameters
- **Benefits**: 
  - Faster response times
  - Reduced server load
  - Consistent data within cache period

### **Mobile App Recommendations**
1. **Cache the response** locally for 5-10 minutes
2. **Show loading state** during initial fetch
3. **Use cached data** when filters haven't changed
4. **Implement pull-to-refresh** for manual data refresh
5. **Show last updated timestamp** from metadata

---

## 🔄 Phase 2: Database Integration (Future)

### **What Will Change**
- Mock data will be replaced with real database queries
- Same endpoint structure and response format
- No changes needed in mobile app

### **Database Queries to Implement**
1. **Performance Data**: Query `quotations`, `orders`, `sales` tables
2. **Sales Transactions**: Query `transactions`, `orders` tables
3. **Locations/Branches**: Query from `organization` database
4. **Products**: Query from `inventory` or `products` table
5. **Sales People**: Query from `users` table with role filters

### **Mobile App Impact**
✅ **Zero impact** - Same endpoint, same response structure

---

## 🛠️ Error Handling

### **Common Error Codes**

| Code | Description | Action |
|------|-------------|--------|
| `UNIFIED_PERFORMANCE_ERROR` | General error | Show error message, retry |
| `INVALID_FILTERS` | Invalid filter parameters | Check filter values |
| `ACCESS_DENIED` | Unauthorized access | Check user permissions |
| `ORGANIZATION_NOT_FOUND` | Invalid org ID | Verify organization ID |

### **Error Handling Example**

```typescript
try {
  const response = await fetch(url, options);
  const result = await response.json();
  
  if (!result.success) {
    switch (result.error?.code) {
      case 'UNIFIED_PERFORMANCE_ERROR':
        showNotification('Failed to load performance data. Please try again.');
        break;
      case 'ACCESS_DENIED':
        redirectToLogin();
        break;
      default:
        showNotification(result.error?.details || 'An error occurred');
    }
    return;
  }
  
  // Success - process data
  handlePerformanceData(result.data);
} catch (error) {
  showNotification('Network error. Please check your connection.');
}
```

---

## 📚 Additional Resources

### **API Base URL**
- **Production**: `https://api.loro.com`
- **Staging**: `https://staging-api.loro.com`
- **Development**: `http://localhost:3000`

### **Related Endpoints** (Individual - Not Recommended)

While the unified endpoint is recommended, individual endpoints are still available:

- `GET /reports/performance/dashboard` - Dashboard only
- `GET /reports/performance/daily-sales` - Daily sales only
- `GET /reports/performance/branch-category` - Branch×Category only
- `GET /reports/performance/sales-per-store` - Sales per store only
- `GET /reports/performance/meta` - Master data only

**⚠️ Note**: Using individual endpoints requires **5 API calls** instead of **1 unified call**.

---

## 🤝 Support

For questions or issues:
- Backend Team: backend@loro.com
- API Documentation: https://docs.loro.com/api
- Swagger UI: https://api.loro.com/api-docs

---

**Last Updated**: October 28, 2025  
**Version**: 1.0.0  
**Status**: ✅ Production Ready (Phase 1 - Mock Data)

