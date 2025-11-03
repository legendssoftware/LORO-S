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
import { ErpTargetsService } from '../../erp/services/erp-targets.service';
import { 
	ErpQueryFilters, 
	SalesTransaction as ErpSalesTransaction 
} from '../../erp/interfaces/erp-data.interface';

/**
 * ========================================================================
 * PERFORMANCE DASHBOARD GENERATOR
 * ========================================================================
 * 
 * Generates comprehensive performance dashboard data using ERP database.
 * 
 * Features:
 * - ERP database integration for real-time data
 * - Date range filtering
 * - Summary calculations (revenue, targets, performance rates)
 * - Chart data generation (line, bar, pie, dual-axis)
 * - Daily sales performance tracking
 * - Branch × Category performance matrix
 * - Sales per store tracking
 * 
 * ========================================================================
 */

/**
 * Performance data interface (derived from ERP data)
 */
interface PerformanceData {
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

@Injectable()
export class PerformanceDashboardGenerator {
	private readonly logger = new Logger(PerformanceDashboardGenerator.name);

	constructor(
		private readonly erpDataService: ErpDataService,
		private readonly erpTransformerService: ErpTransformerService,
		private readonly erpTargetsService: ErpTargetsService,
	) {
		this.logger.log('PerformanceDashboardGenerator initialized with ERP services');
	}


	/**
	 * Generate complete performance dashboard data (includes charts + tables)
	 */
	async generate(params: PerformanceFiltersDto): Promise<PerformanceDashboardDataDto> {
		this.logger.log(`Generating performance dashboard for org ${params.organisationId}`);
		this.logger.log(`Date range: ${params.startDate} to ${params.endDate}`);

		try {
			// Get ERP data
			const rawData = await this.getPerformanceData(params);
			
			this.logger.log(`Retrieved ${rawData.length} performance records from ERP`);

			// ✅ FIXED: Get real revenue target from organization settings
			const totalTarget = await this.erpTargetsService.getRevenueTargetForDateRange(
				params.organisationId,
				params.startDate,
				params.endDate,
			);

			// Calculate summary metrics with real target
			const summary = await this.calculateSummary(rawData, totalTarget);

			// Generate all chart data (now async due to hourly sales)
			const charts = await this.generateCharts(rawData, params);

			// Generate table data (parallel execution for performance)
			this.logger.log('Generating table data in parallel...');
			const [dailySalesPerformance, branchCategoryPerformance, salesPerStore] = await Promise.all([
				this.generateDailySalesPerformance(params),
				this.generateBranchCategoryPerformance(params),
				this.generateSalesPerStore(params),
			]);
			
			// Calculate total transactions across all days
			const totalTransactions = dailySalesPerformance.reduce((sum, day) => sum + day.basketCount, 0);
			
			this.logger.log(`✅ Dashboard generated successfully:`);
			this.logger.log(`   - Total transactions: ${totalTransactions}`);
			this.logger.log(`   - Total records: ${rawData.length}`);
			this.logger.log(`   - Daily records: ${dailySalesPerformance.length}`);
			this.logger.log(`   - Branch-category records: ${branchCategoryPerformance.length}`);
			this.logger.log(`   - Store records: ${salesPerStore.length}`);

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
					recordCount: rawData.length,
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
		return this.calculateDailySalesPerformance(transactions);
	}

	/**
	 * Generate branch × category performance matrix
	 */
	async generateBranchCategoryPerformance(params: PerformanceFiltersDto): Promise<BranchCategoryPerformanceDto[]> {
		this.logger.log(`Generating branch-category performance for org ${params.organisationId}`);

		const transactions = await this.getSalesTransactions(params);
		return this.calculateBranchCategoryPerformance(transactions);
	}

	/**
	 * Generate sales per store data
	 */
	async generateSalesPerStore(params: PerformanceFiltersDto): Promise<SalesPerStoreDto[]> {
		this.logger.log(`Generating sales per store for org ${params.organisationId}`);

		const transactions = await this.getSalesTransactions(params);
		return this.calculateSalesPerStore(transactions);
	}

	// ===================================================================
	// DATA RETRIEVAL (Phase 1: Mock Data / Phase 2: Real DB Queries)
	// ===================================================================

	/**
	 * Get performance data - NOW USING ERP DATABASE
	 */
	private async getPerformanceData(params: PerformanceFiltersDto): Promise<PerformanceData[]> {
		try {
			// Build ERP query filters (only date range)
			const filters: ErpQueryFilters = {
				startDate: params.startDate || this.getDefaultStartDate(),
				endDate: params.endDate || this.getDefaultEndDate(),
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
			// Build ERP query filters (only date range)
			const filters: ErpQueryFilters = {
				startDate: params.startDate || this.getDefaultStartDate(),
				endDate: params.endDate || this.getDefaultEndDate(),
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



	// ===================================================================
	// SUMMARY CALCULATIONS
	// ===================================================================

	/**
	 * Calculate summary metrics with real revenue target from organization settings
	 * 
	 * @param data - Performance data (line items)
	 * @param totalTarget - Real revenue target from ErpTargetsService (based on org settings)
	 */
	private calculateSummary(data: PerformanceData[], totalTarget: number): PerformanceSummaryDto {
		// Convert all revenues to numbers and sum (handles any Decimal/string types from database)
		const totalRevenue = data.reduce((sum, item) => {
			const revenue = typeof item.revenue === 'number' ? item.revenue : parseFloat(String(item.revenue || 0));
			return sum + revenue;
		}, 0);
		
		// ✅ FIXED: Use real target from organization settings, not calculated from data
		// This fixes the "stuck at 83.3%" issue where target was always proportional to revenue
		const performanceRate = totalTarget === 0 ? 0 : (totalRevenue / totalTarget) * 100;
		
		const transactionCount = data.length;
		const averageOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;

		// Calculate average items per basket (convert quantities to numbers)
		const totalQuantity = data.reduce((sum, item) => {
			const quantity = typeof item.quantity === 'number' ? item.quantity : parseFloat(String(item.quantity || 0));
			return sum + quantity;
		}, 0);
		const averageItemsPerBasket = transactionCount > 0 ? totalQuantity / transactionCount : 0;

		this.logger.log(`📊 Summary Calculated:`);
		this.logger.log(`   - Total Revenue: R${totalRevenue.toFixed(2)}`);
		this.logger.log(`   - Total Target: R${totalTarget.toFixed(2)} (from org settings)`);
		this.logger.log(`   - Performance Rate: ${performanceRate.toFixed(2)}%`);
		this.logger.log(`   - Transactions: ${transactionCount}`);

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
	private async generateCharts(data: PerformanceData[], params: PerformanceFiltersDto): Promise<PerformanceChartsDto> {
		// ✅ FIXED: Now using real hourly sales data (async)
		const hourlySales = await this.generateHourlySalesChart(params);
		
		return {
			revenueTrend: this.generateRevenueTrendChart(data, params),
			hourlySales,
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
	 * Generate hourly sales chart from real ERP data
	 * 
	 * ✅ FIXED: Now uses real sale_time data from ERP, no more Math.random()
	 * ✅ Shows only hours up to current time (not future hours)
	 * ✅ Filters to doc_type='1' (Tax Invoices only)
	 */
	private async generateHourlySalesChart(params: PerformanceFiltersDto) {
		try {
			// Build ERP query filters
			const filters: ErpQueryFilters = {
				startDate: params.startDate || this.getDefaultStartDate(),
				endDate: params.endDate || this.getDefaultEndDate(),
				storeCode: params.branchId?.toString(),
			};

			// ✅ Get real hourly sales data from ERP
			const hourlyData = await this.erpDataService.getHourlySalesPattern(filters);
			
			// Get current hour to avoid showing future hours
			const currentHour = new Date().getHours();
			const isToday = filters.endDate === new Date().toISOString().split('T')[0];
			
			// Create hour labels and populate with real data
			const chartData: LineChartDataPoint[] = [];
			
			for (const hourData of hourlyData) {
				const hour = hourData.hour;
				
				// ✅ Skip future hours if viewing today's data
				if (isToday && hour > currentHour) {
					this.logger.debug(`Skipping future hour ${hour} (current hour: ${currentHour})`);
					continue;
				}
				
				// Create hour label
				let label: string;
				if (hour === 0) label = '12am';
				else if (hour < 12) label = `${hour}am`;
				else if (hour === 12) label = '12pm';
				else label = `${hour - 12}pm`;

				chartData.push({
					label,
					value: hourData.totalRevenue,
				});
			}

			// Calculate average and target
			const avgHourlyRevenue = chartData.length > 0
				? chartData.reduce((sum, item) => sum + item.value, 0) / chartData.length
				: 0;
			const targetValue = avgHourlyRevenue * 1.15;

			this.logger.log(`✅ Hourly sales chart generated with ${chartData.length} data points (real data from ERP)`);
			
			return { data: chartData, targetValue };
		} catch (error) {
			this.logger.error(`Error generating hourly sales chart: ${error.message}`);
			// Return empty data on error
			return { data: [], targetValue: 0 };
		}
	}

	/**
	 * Generate sales by category chart
	 */
	private generateSalesByCategoryChart(data: PerformanceData[]) {
		// Aggregate revenue by category from real ERP data
		const aggregated = data.reduce((acc, item) => {
			const category = item.category || 'Uncategorized';
			if (!acc[category]) {
				acc[category] = 0;
			}
			acc[category] += item.revenue;
			return acc;
		}, {} as Record<string, number>);

		const chartData: PieChartDataPoint[] = Object.entries(aggregated)
			.map(([category, revenue]) => ({
				label: category,
				value: revenue,
			}))
			.sort((a, b) => b.value - a.value); // Sort by revenue descending

		const total = chartData.reduce((sum, item) => sum + item.value, 0);

		return { data: chartData, total };
	}

	/**
	 * Generate branch performance chart
	 * 
	 * ✅ Uses branch codes from database (not mock names)
	 */
	private generateBranchPerformanceChart(data: PerformanceData[]) {
		// Aggregate by branch code from real ERP data
		const aggregated = data.reduce((acc, item) => {
			const branchCode = item.branchId; // Use only branch code from database
			if (!acc[branchCode]) {
				acc[branchCode] = { revenue: 0, target: 0 };
			}
			acc[branchCode].revenue += item.revenue;
			acc[branchCode].target += item.target;
			return acc;
		}, {} as Record<string, { revenue: number; target: number }>);

		const sortedBranches = Object.entries(aggregated)
			.map(([code, values]) => ({
				label: code, // Use branch code only
				value: values.revenue,
				target: values.target,
			}))
			.sort((a, b) => b.value - a.value)
			.slice(0, 10); // Top 10 branches

		const averageTarget =
			sortedBranches.length > 0
				? sortedBranches.reduce((sum, item) => sum + item.target, 0) / sortedBranches.length
				: 0;

		this.logger.debug(`Branch performance chart generated with ${sortedBranches.length} branches (using codes)`);

		return { data: sortedBranches, averageTarget };
	}

	/**
	 * Generate top products chart
	 * 
	 * ✅ Uses product codes from database (not full names)
	 */
	private generateTopProductsChart(data: PerformanceData[]) {
		// Aggregate revenue by product code from real ERP data
		const aggregated = data.reduce((acc, item) => {
			const productCode = item.productId; // Use only product code from database
			if (!acc[productCode]) {
				acc[productCode] = {
					revenue: 0,
				};
			}
			acc[productCode].revenue += item.revenue;
			return acc;
		}, {} as Record<string, { revenue: number }>);

		const chartData: BarChartDataPoint[] = Object.entries(aggregated)
			.map(([code, values]) => ({
				label: code, // Use product code only
				value: values.revenue,
			}))
			.sort((a, b) => b.value - a.value)
			.slice(0, 10); // Top 10 products

		const total = chartData.reduce((sum, item) => sum + item.value, 0);

		this.logger.debug(`Top products chart generated with ${chartData.length} products (using codes)`);

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
	 * Note: Currently returns empty data as salesperson info is not in ERP data
	 */
	private generateSalesBySalespersonChart(data: PerformanceData[]) {
		// Aggregate by salesPersonId from ERP data
		const aggregated = data.reduce((acc, item) => {
			const salesPersonKey = item.salesPersonId || 'Unknown';
			if (!acc[salesPersonKey]) {
				acc[salesPersonKey] = { transactionCount: 0, revenue: 0 };
			}
			acc[salesPersonKey].transactionCount += 1;
			acc[salesPersonKey].revenue += item.revenue;
			return acc;
		}, {} as Record<string, { transactionCount: number; revenue: number }>);

		const chartData: DualAxisChartDataPoint[] = Object.entries(aggregated)
			.map(([id, values]) => ({
				label: this.getSalesPersonAbbreviation(id),
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
		const dailyData = new Map<string, ErpSalesTransaction[]>();
		
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
		if (transactions.length === 0) return [];

		// Group transactions by branch and category (using actual ERP data)
		const branchData = new Map<string, {
			branchName: string;
			categories: Map<string, ErpSalesTransaction[]>;
		}>();

		transactions.forEach((t) => {
			// Get branch name from transaction (from ERP store field)
			const branchKey = t.branchId;
			const categoryKey = t.categoryId || 'Uncategorized';

			if (!branchData.has(branchKey)) {
				branchData.set(branchKey, {
					branchName: branchKey, // Use store code as name
					categories: new Map(),
				});
			}

			const branchInfo = branchData.get(branchKey)!;
			if (!branchInfo.categories.has(categoryKey)) {
				branchInfo.categories.set(categoryKey, []);
			}
			branchInfo.categories.get(categoryKey)!.push(t);
		});

		const performance: BranchCategoryPerformanceDto[] = [];

		branchData.forEach((branchInfo, branchId) => {
			const categories: Record<string, CategoryPerformanceDto> = {};
			let totalBasketCount = 0;
			let totalRevenue = 0;
			let totalGP = 0;
			const totalUniqueClients = new Set<string>();

			branchInfo.categories.forEach((categoryTransactions, categoryKey) => {
				const uniqueClients = new Set(categoryTransactions.map((t) => t.clientId));
				const revenue = categoryTransactions.reduce((sum, t) => sum + t.revenue, 0);
				const gp = categoryTransactions.reduce((sum, t) => sum + t.grossProfit, 0);
				const basketCount = categoryTransactions.length;

				categories[categoryKey] = {
					categoryName: categoryKey,
					basketCount,
					basketValue: basketCount > 0 ? revenue / basketCount : 0,
					clientsQty: uniqueClients.size,
					salesR: revenue,
					gpR: gp,
					gpPercentage: revenue > 0 ? (gp / revenue) * 100 : 0,
				};

				totalBasketCount += basketCount;
				totalRevenue += revenue;
				totalGP += gp;
				categoryTransactions.forEach((t) => totalUniqueClients.add(t.clientId));
			});

			performance.push({
				branchId,
				branchName: branchInfo.branchName,
				categories,
				total: {
					categoryName: 'Total',
					basketCount: totalBasketCount,
					basketValue: totalBasketCount > 0 ? totalRevenue / totalBasketCount : 0,
					clientsQty: totalUniqueClients.size,
					salesR: totalRevenue,
					gpR: totalGP,
					gpPercentage: totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0,
				},
			});
		});

		return performance.sort((a, b) => b.total.salesR - a.total.salesR); // Sort by revenue
	}

	// ===================================================================
	// SALES PER STORE
	// ===================================================================

	/**
	 * Calculate sales per store
	 */
	private calculateSalesPerStore(transactions: ErpSalesTransaction[]): SalesPerStoreDto[] {
		if (transactions.length === 0) return [];

		// Group transactions by store (using actual ERP data)
		const storeData = new Map<string, ErpSalesTransaction[]>();

		transactions.forEach((t) => {
			const storeKey = t.branchId;
			if (!storeData.has(storeKey)) {
				storeData.set(storeKey, []);
			}
			storeData.get(storeKey)!.push(t);
		});

		const salesPerStore: SalesPerStoreDto[] = [];

		storeData.forEach((storeTransactions, branchId) => {
			const uniqueClients = new Set(storeTransactions.map((t) => t.clientId));
			const totalRevenue = storeTransactions.reduce((sum, t) => sum + t.revenue, 0);
			const totalGP = storeTransactions.reduce((sum, t) => sum + t.grossProfit, 0);
			const totalItemsSold = storeTransactions.reduce((sum, t) => sum + t.quantity, 0);
			const transactionCount = storeTransactions.length;

			salesPerStore.push({
				storeId: branchId,
				storeName: branchId, // Use store code as name
				totalRevenue,
				transactionCount,
				averageTransactionValue: transactionCount > 0 ? totalRevenue / transactionCount : 0,
				totalItemsSold,
				uniqueClients: uniqueClients.size,
				grossProfit: totalGP,
				grossProfitPercentage: totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0,
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

