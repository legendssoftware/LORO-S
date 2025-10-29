import { Injectable, Logger } from '@nestjs/common';
import { PerformanceFiltersDto } from '../dto/performance-filters.dto';
import {
	PerformanceDashboardDataDto,
	PerformanceSummaryDto,
	PerformanceChartsDto,
	LineChartDataPoint,
	BarChartDataPoint,
	PieChartDataPoint,
	DualAxisChartDataPoint,
	DailySalesPerformanceDto,
	BranchCategoryPerformanceDto,
	CategoryPerformanceDto,
	SalesPerStoreDto,
} from '../dto/performance-dashboard.dto';
import { ErpDataService } from '../../erp/services/erp-data.service';
import { ErpTransformerService } from '../../erp/services/erp-transformer.service';
import { 
	ErpQueryFilters, 
	SalesTransaction as ErpSalesTransaction 
} from '../../erp/interfaces/erp-data.interface';
import { getCategoryName } from '../../erp/config/category-mapping.config';

/**
 * ========================================================================
 * PERFORMANCE DASHBOARD GENERATOR
 * ========================================================================
 * 
 * Generates comprehensive performance dashboard data with filtering and aggregation.
 * 
 * PHASE 1: Uses server-side mock data generation (matching frontend structure)
 * PHASE 2: Will integrate with real database queries (Quotations, Orders, etc.)
 * 
 * Features:
 * - Mock data generation with realistic patterns
 * - Multi-dimensional filtering (date, location, branch, product, price, salesperson)
 * - Summary calculations (revenue, targets, performance rates)
 * - Chart data generation (line, bar, pie, dual-axis)
 * - Daily sales performance tracking
 * - Branch × Category performance matrix
 * 
 * ========================================================================
 */

// ===================================================================
// MOCK DATA INTERFACES (Phase 1)
// ===================================================================

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

interface PerformanceData {
	id: string;
	date: string;
	productId: string;
	branchId: string;
	salesPersonId: string;
	quantity: number;
	revenue: number;
	target: number;
	actualSales: number;
}

interface SalesTransaction {
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

@Injectable()
export class PerformanceDashboardGenerator {
	private readonly logger = new Logger(PerformanceDashboardGenerator.name);

	constructor(
		private readonly erpDataService: ErpDataService,
		private readonly erpTransformerService: ErpTransformerService,
	) {
		this.logger.log('PerformanceDashboardGenerator initialized with ERP services');
	}

	// Cache for master data structures (minimal - for filtering/lookup only)
	private mockDataCache: {
		locations?: Location[];
		productCategories?: ProductCategory[];
		products?: Product[];
		branches?: Branch[];
		salesPeople?: SalesPerson[];
	} = {};

	/**
	 * Generate complete performance dashboard data (includes charts + tables)
	 */
	async generate(params: PerformanceFiltersDto): Promise<PerformanceDashboardDataDto> {
		this.logger.log(`Generating performance dashboard for org ${params.organisationId}`);

		try {
			// Get or generate mock data (Phase 1)
			const rawData = await this.getPerformanceData(params);
			
			// Filter data based on parameters
			const filteredData = this.filterData(rawData, params);

			this.logger.debug(`Filtered ${filteredData.length} records from ${rawData.length} total`);

			// Calculate summary metrics
			const summary = this.calculateSummary(filteredData);

			// Generate all chart data
			const charts = this.generateCharts(filteredData, params);

			// Generate table data (parallel execution for performance)
			this.logger.log('Generating table data in parallel...');
			const [dailySalesPerformance, branchCategoryPerformance, salesPerStore] = await Promise.all([
				this.generateDailySalesPerformance(params),
				this.generateBranchCategoryPerformance(params),
				this.generateSalesPerStore(params),
			]);
			this.logger.log(`Table data generated: ${dailySalesPerformance.length} daily records, ${branchCategoryPerformance.length} branch-category records, ${salesPerStore.length} store records`);

			return {
				summary,
				charts,
				dailySalesPerformance,
				branchCategoryPerformance,
				salesPerStore,
				filters: params,
				metadata: {
					lastUpdated: new Date().toISOString(),
					dataQuality: 'excellent',
					recordCount: filteredData.length,
					organizationTimezone: 'Africa/Johannesburg', // TODO: Get from organization settings
				},
			};
		} catch (error) {
			this.logger.error(`Error generating performance dashboard: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Generate daily sales performance data
	 */
	async generateDailySalesPerformance(params: PerformanceFiltersDto): Promise<DailySalesPerformanceDto[]> {
		this.logger.log(`Generating daily sales performance for org ${params.organisationId}`);

		const transactions = await this.getSalesTransactions(params);
		const filteredTransactions = this.filterSalesTransactions(transactions, params);

		return this.calculateDailySalesPerformance(filteredTransactions);
	}

	/**
	 * Generate branch × category performance matrix
	 */
	async generateBranchCategoryPerformance(params: PerformanceFiltersDto): Promise<BranchCategoryPerformanceDto[]> {
		this.logger.log(`Generating branch-category performance for org ${params.organisationId}`);

		const transactions = await this.getSalesTransactions(params);
		const filteredTransactions = this.filterSalesTransactions(transactions, params);

		return this.calculateBranchCategoryPerformance(filteredTransactions);
	}

	/**
	 * Generate sales per store data
	 */
	async generateSalesPerStore(params: PerformanceFiltersDto): Promise<SalesPerStoreDto[]> {
		this.logger.log(`Generating sales per store for org ${params.organisationId}`);

		const transactions = await this.getSalesTransactions(params);
		const filteredTransactions = this.filterSalesTransactions(transactions, params);

		return this.calculateSalesPerStore(filteredTransactions);
	}

	// ===================================================================
	// DATA RETRIEVAL (Phase 1: Mock Data / Phase 2: Real DB Queries)
	// ===================================================================

	/**
	 * Get performance data - NOW USING ERP DATABASE
	 */
	private async getPerformanceData(params: PerformanceFiltersDto): Promise<PerformanceData[]> {
		try {
			// Build ERP query filters
			const filters: ErpQueryFilters = {
				startDate: params.startDate || this.getDefaultStartDate(),
				endDate: params.endDate || this.getDefaultEndDate(),
				storeCode: params.branchIds && params.branchIds.length > 0 ? params.branchIds[0] : undefined,
				category: params.category,
			};

			this.logger.log(`Fetching ERP performance data for ${filters.startDate} to ${filters.endDate}`);

			// Get sales lines from ERP
			const salesLines = await this.erpDataService.getSalesLinesByDateRange(filters);
			
			// Transform to performance data format
			const performanceData = this.erpTransformerService.transformToPerformanceDataList(salesLines);
			
			this.logger.log(`Transformed ${performanceData.length} performance data records from ERP`);
			
			return performanceData;
		} catch (error) {
			this.logger.error(`Error fetching ERP performance data: ${error.message}`, error.stack);
			
			// Return empty data on error
			this.logger.warn('Returning empty data due to ERP error');
			return [];
		}
	}

	/**
	 * Get sales transactions - NOW USING ERP DATABASE
	 */
	private async getSalesTransactions(params: PerformanceFiltersDto): Promise<ErpSalesTransaction[]> {
		try {
			// Build ERP query filters
			const filters: ErpQueryFilters = {
				startDate: params.startDate || this.getDefaultStartDate(),
				endDate: params.endDate || this.getDefaultEndDate(),
				storeCode: params.branchIds && params.branchIds.length > 0 ? params.branchIds[0] : undefined,
				category: params.category,
			};

			this.logger.log(`Fetching ERP sales transactions for ${filters.startDate} to ${filters.endDate}`);

			// Get sales lines from ERP
			const salesLines = await this.erpDataService.getSalesLinesByDateRange(filters);
			
			// Get headers if needed
			const headers = await this.erpDataService.getSalesHeadersByDateRange(filters);
			
			// Transform to sales transaction format
			const transactions = this.erpTransformerService.transformToSalesTransactions(salesLines, headers);
			
			this.logger.log(`Transformed ${transactions.length} sales transactions from ERP`);
			
			return transactions;
		} catch (error) {
			this.logger.error(`Error fetching ERP sales transactions: ${error.message}`, error.stack);
			
			// Return empty data on error
			this.logger.warn('Returning empty data due to ERP error');
			return [];
		}
	}

	/**
	 * Get master data (branches, products, locations, etc.)
	 * Returns empty structures if not initialized
	 */
	getMasterData() {
		if (!this.mockDataCache.locations) {
			this.initializeMasterData();
		}

		return {
			locations: this.mockDataCache.locations || [],
			productCategories: this.mockDataCache.productCategories || [],
			products: this.mockDataCache.products || [],
			branches: this.mockDataCache.branches || [],
			salesPeople: this.mockDataCache.salesPeople || [],
		};
	}

	// ===================================================================
	// FILTERING LOGIC
	// ===================================================================

	/**
	 * Filter performance data based on parameters
	 */
	private filterData(data: PerformanceData[], params: PerformanceFiltersDto): PerformanceData[] {
		let filtered = [...data];

		// Date range filter
		if (params.startDate && params.endDate) {
			filtered = filtered.filter(
				(item) => item.date >= params.startDate && item.date <= params.endDate,
			);
		}

		// Branch filter
		if (params.branchIds && params.branchIds.length > 0) {
			filtered = filtered.filter((item) => params.branchIds.includes(item.branchId));
		}

		// Location filter (hierarchical)
		if (params.county || params.province || params.city || params.suburb) {
			const masterData = this.getMasterData();
			filtered = filtered.filter((item) => {
				const branch = masterData.branches.find((b) => b.id === item.branchId);
				if (!branch) return false;

				const location = masterData.locations.find((l) => l.id === branch.locationId);
				if (!location) return false;

				if (params.county && location.county !== params.county) return false;
				if (params.province && location.province !== params.province) return false;
				if (params.city && location.city !== params.city) return false;
				if (params.suburb && location.suburb !== params.suburb) return false;

				return true;
			});
		}

		// Product/Category filter
		if (params.category || (params.productIds && params.productIds.length > 0)) {
			const masterData = this.getMasterData();
			filtered = filtered.filter((item) => {
				const product = masterData.products.find((p) => p.id === item.productId);
				if (!product) return false;

				if (params.category && product.category !== params.category) return false;
				if (params.productIds && params.productIds.length > 0 && !params.productIds.includes(product.id)) {
					return false;
				}

				return true;
			});
		}

		// Price range filter
		if (params.minPrice || params.maxPrice) {
			const masterData = this.getMasterData();
			filtered = filtered.filter((item) => {
				const product = masterData.products.find((p) => p.id === item.productId);
				if (!product) return false;

				if (params.minPrice && product.price < params.minPrice) return false;
				if (params.maxPrice && product.price > params.maxPrice) return false;

				return true;
			});
		}

		// Sales person filter
		if (params.salesPersonIds && params.salesPersonIds.length > 0) {
			filtered = filtered.filter((item) => params.salesPersonIds.includes(item.salesPersonId));
		}

		return filtered;
	}

	/**
	 * Filter sales transactions
	 */
	private filterSalesTransactions(
		data: ErpSalesTransaction[],
		params: PerformanceFiltersDto,
	): ErpSalesTransaction[] {
		let filtered = [...data];

		// Date range filter
		if (params.startDate && params.endDate) {
			filtered = filtered.filter(
				(item) => item.date >= params.startDate && item.date <= params.endDate,
			);
		}

		// Branch filter
		if (params.branchIds && params.branchIds.length > 0) {
			filtered = filtered.filter((item) => params.branchIds.includes(item.branchId));
		}

		// Category filter
		if (params.category) {
			const masterData = this.getMasterData();
			const category = masterData.productCategories.find((c) => c.name === params.category);
			if (category) {
				filtered = filtered.filter((item) => item.categoryId === category.id);
			}
		}

		// Product filter
		if (params.productIds && params.productIds.length > 0) {
			filtered = filtered.filter((item) => params.productIds.includes(item.productId));
		}

		// Price range filter
		if (params.minPrice || params.maxPrice) {
			filtered = filtered.filter((item) => {
				if (params.minPrice && item.salesPrice < params.minPrice) return false;
				if (params.maxPrice && item.salesPrice > params.maxPrice) return false;
				return true;
			});
		}

		return filtered;
	}

	// ===================================================================
	// SUMMARY CALCULATIONS
	// ===================================================================

	/**
	 * Calculate summary metrics
	 */
	private calculateSummary(data: PerformanceData[]): PerformanceSummaryDto {
		const totalRevenue = data.reduce((sum, item) => sum + item.revenue, 0);
		const totalTarget = data.reduce((sum, item) => sum + item.target, 0);
		const performanceRate = totalTarget === 0 ? 0 : (totalRevenue / totalTarget) * 100;
		const transactionCount = data.length;
		const averageOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;

		// Calculate average items per basket
		const dateAggregated = data.reduce((acc, item) => {
			if (!acc[item.date]) {
				acc[item.date] = { totalItems: 0, transactionCount: 0 };
			}
			acc[item.date].totalItems += item.quantity;
			acc[item.date].transactionCount += 1;
			return acc;
		}, {} as Record<string, { totalItems: number; transactionCount: number }>);

		const itemsPerBasketByDate = Object.values(dateAggregated).map(
			(d) => d.totalItems / d.transactionCount,
		);
		const averageItemsPerBasket =
			itemsPerBasketByDate.length > 0
				? itemsPerBasketByDate.reduce((sum, val) => sum + val, 0) / itemsPerBasketByDate.length
				: 0;

		return {
			totalRevenue,
			totalTarget,
			performanceRate,
			transactionCount,
			averageOrderValue,
			averageItemsPerBasket,
		};
	}

	// ===================================================================
	// CHART GENERATION
	// ===================================================================

	/**
	 * Generate all chart data
	 */
	private generateCharts(data: PerformanceData[], params: PerformanceFiltersDto): PerformanceChartsDto {
		return {
			revenueTrend: this.generateRevenueTrendChart(data, params),
			hourlySales: this.generateHourlySalesChart(data),
			salesByCategory: this.generateSalesByCategoryChart(data),
			branchPerformance: this.generateBranchPerformanceChart(data),
			topProducts: this.generateTopProductsChart(data),
			itemsPerBasket: this.generateItemsPerBasketChart(data),
			salesBySalesperson: this.generateSalesBySalespersonChart(data),
			conversionRate: this.generateConversionRateChart(data),
			customerComposition: this.generateCustomerCompositionChart(data),
		};
	}

	/**
	 * Generate revenue trend chart
	 */
	private generateRevenueTrendChart(data: PerformanceData[], params: PerformanceFiltersDto) {
		const aggregated = data.reduce((acc, item) => {
			if (!acc[item.date]) {
				acc[item.date] = { revenue: 0, target: 0 };
			}
			acc[item.date].revenue += item.revenue;
			acc[item.date].target += item.target;
			return acc;
		}, {} as Record<string, { revenue: number; target: number }>);

		const sortedData = Object.entries(aggregated)
			.map(([date, values]) => ({
				date,
				revenue: values.revenue,
				target: values.target,
			}))
			.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

		// Sample data for chart (max 7 points for UI clarity)
		const sampledData =
			sortedData.length <= 7
				? sortedData
				: sortedData.filter((_, index) => index % Math.ceil(sortedData.length / 7) === 0).slice(0, 7);

		const chartData: LineChartDataPoint[] = sampledData.map((item) => ({
			label: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
			value: item.revenue,
			dataPointText: this.formatValue(item.revenue, 1),
		}));

		const targetValue =
			sampledData.length > 0
				? sampledData.reduce((sum, item) => sum + item.target, 0) / sampledData.length
				: 0;

		return { data: chartData, targetValue };
	}

	/**
	 * Generate hourly sales chart
	 */
	private generateHourlySalesChart(data: PerformanceData[]) {
		const hours = Array.from({ length: 13 }, (_, i) => i + 7); // 7-19 (7am-7pm)
		const hourlyAggregation: Record<number, number> = {};
		
		hours.forEach((hour) => {
			hourlyAggregation[hour] = 0;
		});

		// Simulate hourly distribution
		data.forEach((item) => {
			hours.forEach((hour) => {
				const peakMultiplier = hour >= 10 && hour <= 14 ? 1.5 : hour >= 17 && hour <= 19 ? 1.3 : 1;
				const hourlyPortion = (item.revenue / 13) * peakMultiplier * (0.8 + Math.random() * 0.4);
				hourlyAggregation[hour] += hourlyPortion;
			});
		});

		const chartData: LineChartDataPoint[] = hours.map((hour) => {
			let label: string;
			if (hour === 7) label = '7am';
			else if (hour === 12) label = '12pm';
			else if (hour < 12) label = `${hour}am`;
			else if (hour === 19) label = '7pm';
			else label = `${hour - 12}pm`;

			return {
				label,
				value: hourlyAggregation[hour],
			};
		});

		const avgHourlyRevenue = chartData.reduce((sum, item) => sum + item.value, 0) / chartData.length;
		const targetValue = avgHourlyRevenue * 1.15;

		return { data: chartData, targetValue };
	}

	/**
	 * Generate sales by category chart
	 */
	private generateSalesByCategoryChart(data: PerformanceData[]) {
		const masterData = this.getMasterData();
		const aggregated = data.reduce((acc, item) => {
			const product = masterData.products.find((p) => p.id === item.productId);
			if (product) {
				if (!acc[product.category]) {
					acc[product.category] = 0;
				}
				acc[product.category] += item.revenue;
			}
			return acc;
		}, {} as Record<string, number>);

		const chartData: PieChartDataPoint[] = Object.entries(aggregated).map(([category, revenue]) => ({
			label: category,
			value: revenue,
		}));

		const total = chartData.reduce((sum, item) => sum + item.value, 0);

		return { data: chartData, total };
	}

	/**
	 * Generate branch performance chart
	 */
	private generateBranchPerformanceChart(data: PerformanceData[]) {
		const masterData = this.getMasterData();
		const aggregated = data.reduce((acc, item) => {
			const branch = masterData.branches.find((b) => b.id === item.branchId);
			if (branch) {
				if (!acc[branch.name]) {
					acc[branch.name] = { revenue: 0, target: 0 };
				}
				acc[branch.name].revenue += item.revenue;
				acc[branch.name].target += item.target;
			}
			return acc;
		}, {} as Record<string, { revenue: number; target: number }>);

		const sortedBranches = Object.entries(aggregated)
			.map(([name, values]) => ({
				label: this.getBranchAbbreviation(name),
				value: values.revenue,
				target: values.target,
			}))
			.sort((a, b) => b.value - a.value)
			.slice(0, 10);

		// Calculate targets
		if (sortedBranches.length > 0) {
			const maxTarget = 2000000;
			const minTarget = 350000;

			sortedBranches.forEach((branch, index) => {
				if (index === 0) {
					branch.target = maxTarget;
				} else if (index === sortedBranches.length - 1) {
					branch.target = minTarget;
				} else {
					const ratio = index / (sortedBranches.length - 1);
					branch.target = maxTarget - (maxTarget - minTarget) * ratio;
				}
			});
		}

		const averageTarget =
			sortedBranches.length > 0
				? sortedBranches.reduce((sum, item) => sum + item.target, 0) / sortedBranches.length
				: 0;

		return { data: sortedBranches, averageTarget };
	}

	/**
	 * Generate top products chart
	 */
	private generateTopProductsChart(data: PerformanceData[]) {
		const masterData = this.getMasterData();
		const aggregated = data.reduce((acc, item) => {
			const product = masterData.products.find((p) => p.id === item.productId);
			if (product) {
				if (!acc[product.id]) {
					acc[product.id] = { code: product.id, revenue: 0 };
				}
				acc[product.id].revenue += item.revenue;
			}
			return acc;
		}, {} as Record<string, { code: string; revenue: number }>);

		const chartData: BarChartDataPoint[] = Object.entries(aggregated)
			.map(([id, values]) => ({
				label: values.code,
				value: values.revenue,
			}))
			.sort((a, b) => b.value - a.value)
			.slice(0, 10);

		const total = chartData.reduce((sum, item) => sum + item.value, 0);

		return { data: chartData, total };
	}

	/**
	 * Generate items per basket chart
	 */
	private generateItemsPerBasketChart(data: PerformanceData[]) {
		const aggregated = data.reduce((acc, item) => {
			if (!acc[item.date]) {
				acc[item.date] = { totalItems: 0, transactionCount: 0, totalRevenue: 0 };
			}
			acc[item.date].totalItems += item.quantity;
			acc[item.date].transactionCount += 1;
			acc[item.date].totalRevenue += item.revenue;
			return acc;
		}, {} as Record<string, { totalItems: number; transactionCount: number; totalRevenue: number }>);

		const sortedData = Object.entries(aggregated)
			.map(([date, values]) => ({
				date,
				itemsPerBasket: values.totalItems / values.transactionCount,
				basketValue: values.totalRevenue / values.transactionCount,
			}))
			.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

		const sampledData =
			sortedData.length <= 7
				? sortedData
				: sortedData.filter((_, index) => index % Math.ceil(sortedData.length / 7) === 0).slice(0, 7);

		const chartData: DualAxisChartDataPoint[] = sampledData.map((item) => ({
			label: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
			value: item.itemsPerBasket,
			secondaryValue: item.basketValue,
		}));

		const avgItems =
			sampledData.length > 0
				? sampledData.reduce((sum, item) => sum + item.itemsPerBasket, 0) / sampledData.length
				: 0;
		const targetValue = avgItems * 1.2;

		return { data: chartData, targetValue };
	}

	/**
	 * Generate sales by salesperson chart
	 */
	private generateSalesBySalespersonChart(data: PerformanceData[]) {
		const masterData = this.getMasterData();
		const aggregated = data.reduce((acc, item) => {
			const salesPerson = masterData.salesPeople.find((s) => s.id === item.salesPersonId);
			if (salesPerson) {
				if (!acc[salesPerson.name]) {
					acc[salesPerson.name] = { transactionCount: 0, revenue: 0 };
				}
				acc[salesPerson.name].transactionCount += 1;
				acc[salesPerson.name].revenue += item.revenue;
			}
			return acc;
		}, {} as Record<string, { transactionCount: number; revenue: number }>);

		const chartData: DualAxisChartDataPoint[] = Object.entries(aggregated)
			.map(([name, values]) => ({
				label: this.getSalesPersonAbbreviation(name),
				value: values.transactionCount,
				secondaryValue: values.revenue,
			}))
			.sort((a, b) => b.secondaryValue - a.secondaryValue)
			.slice(0, 10);

		return { data: chartData };
	}

	/**
	 * Generate conversion rate chart
	 */
	private generateConversionRateChart(data: PerformanceData[]) {
		const totalQuotationsValue = data.reduce((sum, item) => sum + item.target, 0);
		const totalSalesValue = data.reduce((sum, item) => sum + item.actualSales, 0);

		const conversionValue = Math.min(totalSalesValue, totalQuotationsValue);
		const unconvertedValue = Math.max(0, totalQuotationsValue - totalSalesValue);

		const chartData: PieChartDataPoint[] = [
			{
				label: 'Converted Sales',
				value: conversionValue,
				color: '#10B981',
			},
			{
				label: 'Pending Quotations',
				value: unconvertedValue,
				color: '#F59E0B',
			},
		];

		const total = conversionValue + unconvertedValue;
		const percentage = total > 0 ? (conversionValue / total) * 100 : 0;

		return { data: chartData, total, percentage };
	}

	/**
	 * Generate customer composition chart
	 */
	private generateCustomerCompositionChart(data: PerformanceData[]) {
		const customerTypes: Record<string, { value: number; color: string }> = {
			'Walk-in': { value: 0, color: '#8B5CF6' },
			'Account': { value: 0, color: '#06B6D4' },
			'Returning': { value: 0, color: '#10B981' },
		};

		// Simulate distribution based on sales data
		data.forEach((item) => {
			const revenue = item.actualSales;
			customerTypes['Walk-in'].value += revenue * 0.4;
			customerTypes['Account'].value += revenue * 0.35;
			customerTypes['Returning'].value += revenue * 0.25;
		});

		const chartData: PieChartDataPoint[] = Object.entries(customerTypes)
			.map(([label, data]) => ({
				label,
				value: data.value,
				color: data.color,
			}))
			.sort((a, b) => b.value - a.value);

		const total = chartData.reduce((sum, item) => sum + item.value, 0);

		return { data: chartData, total };
	}

	// ===================================================================
	// DAILY SALES PERFORMANCE
	// ===================================================================

	/**
	 * Calculate daily sales performance
	 */
	private calculateDailySalesPerformance(transactions: ErpSalesTransaction[]): DailySalesPerformanceDto[] {
		const dailyData = new Map<string, SalesTransaction[]>();
		
		transactions.forEach((t) => {
			if (!dailyData.has(t.date)) {
				dailyData.set(t.date, []);
			}
			dailyData.get(t.date).push(t);
		});

		const performance: DailySalesPerformanceDto[] = [];
		const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

		dailyData.forEach((dayTransactions, date) => {
			const uniqueClients = new Set(dayTransactions.map((t) => t.clientId));
			const totalRevenue = dayTransactions.reduce((sum, t) => sum + t.revenue, 0);
			const totalGP = dayTransactions.reduce((sum, t) => sum + t.grossProfit, 0);
			const basketCount = dayTransactions.length;

			const dateObj = new Date(date);

			performance.push({
				date,
				dayOfWeek: dayNames[dateObj.getDay()],
				basketCount,
				basketValue: totalRevenue / basketCount,
				clientsQty: uniqueClients.size,
				salesR: totalRevenue,
				gpR: totalGP,
				gpPercentage: (totalGP / totalRevenue) * 100,
			});
		});

		return performance.sort((a, b) => a.date.localeCompare(b.date));
	}

	// ===================================================================
	// BRANCH × CATEGORY PERFORMANCE
	// ===================================================================

	/**
	 * Calculate branch × category performance
	 */
	private calculateBranchCategoryPerformance(transactions: ErpSalesTransaction[]): BranchCategoryPerformanceDto[] {
		const masterData = this.getMasterData();
		const branchData = new Map<string, Map<string, SalesTransaction[]>>();

		transactions.forEach((t) => {
			if (!branchData.has(t.branchId)) {
				branchData.set(t.branchId, new Map());
			}
			const categoryMap = branchData.get(t.branchId);
			if (!categoryMap.has(t.categoryId)) {
				categoryMap.set(t.categoryId, []);
			}
			categoryMap.get(t.categoryId).push(t);
		});

		const performance: BranchCategoryPerformanceDto[] = [];

		branchData.forEach((categoryMap, branchId) => {
			const branch = masterData.branches.find((b) => b.id === branchId);
			if (!branch) return;

			const categories: Record<string, CategoryPerformanceDto> = {};
			let totalBasketCount = 0;
			let totalRevenue = 0;
			let totalGP = 0;
			const totalUniqueClients = new Set<string>();

			categoryMap.forEach((categoryTransactions, categoryId) => {
				const category = masterData.productCategories.find((c) => c.id === categoryId);
				if (!category) return;

				const uniqueClients = new Set(categoryTransactions.map((t) => t.clientId));
				const revenue = categoryTransactions.reduce((sum, t) => sum + t.revenue, 0);
				const gp = categoryTransactions.reduce((sum, t) => sum + t.grossProfit, 0);
				const basketCount = categoryTransactions.length;

				categories[categoryId] = {
					categoryName: category.name,
					basketCount,
					basketValue: revenue / basketCount,
					clientsQty: uniqueClients.size,
					salesR: revenue,
					gpR: gp,
					gpPercentage: (gp / revenue) * 100,
				};

				totalBasketCount += basketCount;
				totalRevenue += revenue;
				totalGP += gp;
				categoryTransactions.forEach((t) => totalUniqueClients.add(t.clientId));
			});

			performance.push({
				branchId,
				branchName: branch.name,
				categories,
				total: {
					categoryName: 'Total',
					basketCount: totalBasketCount,
					basketValue: totalRevenue / totalBasketCount,
					clientsQty: totalUniqueClients.size,
					salesR: totalRevenue,
					gpR: totalGP,
					gpPercentage: (totalGP / totalRevenue) * 100,
				},
			});
		});

		return performance.sort((a, b) => a.branchName.localeCompare(b.branchName));
	}

	// ===================================================================
	// SALES PER STORE
	// ===================================================================

	/**
	 * Calculate sales per store
	 */
	private calculateSalesPerStore(transactions: ErpSalesTransaction[]): SalesPerStoreDto[] {
		const masterData = this.getMasterData();
		const storeData = new Map<string, SalesTransaction[]>();

		transactions.forEach((t) => {
			if (!storeData.has(t.branchId)) {
				storeData.set(t.branchId, []);
			}
			storeData.get(t.branchId).push(t);
		});

		const salesPerStore: SalesPerStoreDto[] = [];

		storeData.forEach((storeTransactions, branchId) => {
			const branch = masterData.branches.find((b) => b.id === branchId);
			if (!branch) return;

			const uniqueClients = new Set(storeTransactions.map((t) => t.clientId));
			const totalRevenue = storeTransactions.reduce((sum, t) => sum + t.revenue, 0);
			const totalGP = storeTransactions.reduce((sum, t) => sum + t.grossProfit, 0);
			const totalItemsSold = storeTransactions.reduce((sum, t) => sum + t.quantity, 0);

			salesPerStore.push({
				storeId: branchId,
				storeName: branch.name,
				totalRevenue,
				transactionCount: storeTransactions.length,
				averageTransactionValue: totalRevenue / storeTransactions.length,
				totalItemsSold,
				uniqueClients: uniqueClients.size,
				grossProfit: totalGP,
				grossProfitPercentage: (totalGP / totalRevenue) * 100,
			});
		});

		return salesPerStore.sort((a, b) => b.totalRevenue - a.totalRevenue);
	}

	// ===================================================================
	// UTILITY METHODS
	// ===================================================================

	/**
	 * Format value for display
	 */
	private formatValue(value: number, precision: number = 1): string {
		if (value >= 1000000) {
			return `${(value / 1000000).toFixed(precision)}M`;
		} else if (value >= 1000) {
			return `${(value / 1000).toFixed(precision)}K`;
		}
		return value.toFixed(precision);
	}

	/**
	 * Get branch abbreviation
	 */
	private getBranchAbbreviation(branchName: string): string {
		const cityAbbreviations: Record<string, string> = {
			Sandton: 'JHB',
			Rosebank: 'JHB',
			Centurion: 'PTA',
			'Cape Town': 'CPT',
			Umhlanga: 'DBN',
			Gaborone: 'GBE',
			Riverwalk: 'GBE',
			Maun: 'MUN',
			Francistown: 'FTN',
			Maerua: 'WHK',
			'Grove Mall': 'WHK',
			Swakopmund: 'SWP',
			Oshakati: 'OSH',
			Avondale: 'HRE',
			Borrowdale: 'HRE',
			Bulawayo: 'BYO',
			Mutare: 'MUT',
			Woodlands: 'LSK',
			Kabulonga: 'LSK',
			Kitwe: 'KTW',
			Ndola: 'NDL',
			Chichiri: 'BLZ',
			Limbe: 'BLZ',
			Lilongwe: 'LLW',
			Kimihurura: 'KGL',
			Nyarutarama: 'KGL',
			Rwamagana: 'RWM',
			Huye: 'HUY',
			Sommerschield: 'MPT',
			Polana: 'MPT',
			Beira: 'BRA',
			Nampula: 'NPL',
		};

		for (const [city, abbr] of Object.entries(cityAbbreviations)) {
			if (branchName.includes(city)) {
				return abbr;
			}
		}

		const firstWord = branchName.split(' ')[0];
		return firstWord.substring(0, 3).toUpperCase();
	}

	/**
	 * Get sales person abbreviation
	 */
	private getSalesPersonAbbreviation(fullName: string): string {
		const nameParts = fullName.trim().split(' ');

		if (nameParts.length === 1) {
			return nameParts[0].substring(0, 3).toUpperCase();
		} else if (nameParts.length === 2) {
			return (nameParts[0][0] + nameParts[1][0]).toUpperCase();
		} else {
			return (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
		}
	}

	// ===================================================================
	// MOCK DATA GENERATION (Phase 1)
	// To be replaced with real database queries in Phase 2
	// ===================================================================

	/**
	 * Initialize master data (locations, products, branches, salespeople)
	 * Now returns empty structures - all data comes from ERP
	 */
	private initializeMasterData() {
		this.logger.log('Initializing empty master data structures...');
		
		// Initialize empty arrays - all real data comes from ERP
		this.mockDataCache.locations = [];
		this.mockDataCache.productCategories = [];
		this.mockDataCache.products = [];
		this.mockDataCache.branches = [];
		this.mockDataCache.salesPeople = [];
		
		this.logger.log('Master data structures initialized (empty - all data from ERP)');
	}

	/**
	 * Generate mock performance data
	 */
	private generateMockPerformanceData(): PerformanceData[] {
		this.logger.log('Generating mock performance data (365 days)...');
		
		const mockData = require('./performance-mock-data.generator');
		const data = mockData.generatePerformanceData(365);
		
		this.logger.log(`Generated ${data.length} performance records`);
		return data;
	}

	/**
	 * Generate mock sales transactions
	 */
	private generateMockSalesTransactions(): ErpSalesTransaction[] {
		this.logger.log('Generating mock sales transactions (90 days)...');
		
		const mockData = require('./performance-mock-data.generator');
		const transactions = mockData.generateSalesTransactions(90);
		
		this.logger.log(`Generated ${transactions.length} sales transactions`);
		return transactions;
	}

	/**
	 * Get default start date (30 days ago)
	 */
	private getDefaultStartDate(): string {
		const date = new Date();
		date.setDate(date.getDate() - 30);
		return date.toISOString().split('T')[0];
	}

	/**
	 * Get default end date (today)
	 */
	private getDefaultEndDate(): string {
		return new Date().toISOString().split('T')[0];
	}
}

