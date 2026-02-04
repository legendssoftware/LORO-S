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
import { ErpConnectionManagerService } from '../../erp/services/erp-connection-manager.service';
import { 
	ErpQueryFilters, 
	SalesTransaction as ErpSalesTransaction,
	DailyAggregation,
	BranchAggregation,
	BranchCategoryAggregation,
} from '../../erp/interfaces/erp-data.interface';
import { getCurrencyForCountry } from '../../erp/utils/currency.util';
import { ExchangeRateDto } from '../dto/performance-dashboard.dto';

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
		private readonly erpConnectionManager: ErpConnectionManagerService,
	) {
		this.logger.log('PerformanceDashboardGenerator initialized with ERP services');
	}


	/**
	 * Generate complete performance dashboard data (includes charts + tables)
	 */
	async generate(params: PerformanceFiltersDto): Promise<PerformanceDashboardDataDto> {
		const countryCode = this.getCountryCode(params);
		this.logger.log(`🌍 Generating performance dashboard for org ${params.organisationId}`);
		this.logger.log(`🌍 Country: ${params.country || 'not specified'} → Code: ${countryCode}`);
		this.logger.log(`Date range: ${params.startDate} to ${params.endDate}`);

		// Get currency for country (use ZAR for consolidated/all countries view)
		const currency = !params.country || params.country === 'ALL'
			? getCurrencyForCountry('SA') // ZAR for consolidated view
			: getCurrencyForCountry(countryCode);
		this.logger.log(`💰 Currency: ${currency.code} (${currency.symbol}) - ${currency.name}`);

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

			// ✅ REVISED: Calculate summary using daily aggregations (tblsalesheader.total_incl) instead of line items
			const summary = await this.calculateSummaryFromDailyAggregations(params, rawData, totalTarget);

			// Generate all chart data (now async due to hourly sales)
			const charts = await this.generateCharts(rawData, params);

			// Generate table data (sequential execution for reliability)
			this.logger.log('Starting sequential query execution for table data...');
			
			this.logger.log('Step 1/4: Generating daily sales performance...');
			// Use consolidated daily sales performance (all countries, ZAR) when no country filter is set
			const dailySalesPerformance = !params.country || params.country === 'ALL' 
				? await this.generateConsolidatedDailySalesPerformance(params)
				: await this.generateDailySalesPerformance(params);
			
			this.logger.log('Step 2/4: Generating branch-category performance...');
			// Use consolidated branch-category performance (all countries, ZAR) when no country filter is set
			const branchCategoryPerformance = !params.country || params.country === 'ALL' 
				? await this.generateConsolidatedBranchCategoryPerformance(params)
				: await this.generateBranchCategoryPerformance(params);
			
			this.logger.log('Step 3/4: Generating sales per store...');
			// Use consolidated sales per store (all countries, ZAR) when no country filter is set
			const salesPerStore = !params.country || params.country === 'ALL' 
				? await this.generateConsolidatedSalesPerStore(params)
				: await this.generateSalesPerStore(params);
			
			this.logger.log('Step 4/4: Getting master data...');
			const masterData = await this.getMasterData(params);
			
			this.logger.log('✅ All sequential queries completed successfully');
			
			// Calculate total transactions across all days
			const totalTransactions = dailySalesPerformance.reduce((sum, day) => sum + day.basketCount, 0);
			
			// ✅ FIX: Calculate total unique clients across ALL transactions (not summing per day/store)
			// This prevents double-counting clients who shop on multiple days or at multiple stores
			// Use transactions data which has clientId (PerformanceData doesn't have clientId)
			const allUniqueClients = new Set<string>();
			const transactions = await this.getSalesTransactions(params);
			transactions.forEach((t) => {
				if (t.clientId && t.clientId !== 'UNKNOWN') {
					allUniqueClients.add(t.clientId);
				}
			});
			const totalUniqueClients = allUniqueClients.size;
			
			return {
				summary,
				charts,
				dailySalesPerformance,
				branchCategoryPerformance,
				salesPerStore,
				masterData,
				totalUniqueClients, // ✅ Add total unique clients to response
				currency: {
					code: currency.code,
					symbol: currency.symbol,
					locale: currency.locale,
					name: currency.name,
				},
				filters: params,
				metadata: {
					lastUpdated: new Date().toISOString(),
					dataQuality: 'excellent',
					recordCount: rawData.length,
					organizationTimezone: 'Africa/Johannesburg', // TODO: Get from organization settings
					countryCode, // Include country code in metadata
				},
			};
		} catch (error) {
			this.logger.error(`Error generating performance dashboard: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * Generate daily sales performance data
	 * 
	 * ✅ REVISED: Now uses daily aggregations from tblsaleslines (includes cost data for GP calculation)
	 * Uses SUM(incl_line_total) - SUM(tax) for revenue, SUM(cost_price * quantity) for cost,
	 * COUNT(DISTINCT doc_number) for transactions, COUNT(DISTINCT customer) for unique clients
	 */
	async generateDailySalesPerformance(params: PerformanceFiltersDto): Promise<DailySalesPerformanceDto[]> {
		this.logger.log(`Generating daily sales performance for org ${params.organisationId}`);

		// Build ERP query filters
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params) || 'SA';
		
		// ✅ Get daily aggregations from tblsaleslines (includes cost data for GP)
		const dailyAggregations = await this.erpDataService.getDailyAggregationsFromSalesLines(filters, countryCode);
		
		return this.calculateDailySalesPerformanceFromAggregations(dailyAggregations);
	}

	/**
	 * Generate consolidated daily sales performance across all countries with ZAR conversion
	 * Fetches data from all countries, converts all currency values to ZAR using exchange rates
	 */
	async generateConsolidatedDailySalesPerformance(params: PerformanceFiltersDto): Promise<DailySalesPerformanceDto[]> {
		this.logger.log(`Generating consolidated daily sales performance for org ${params.organisationId} (all countries, ZAR)`);

		// Supported countries
		const countries = [
			{ code: 'SA', name: 'South Africa' },
			{ code: 'BOT', name: 'Botswana' },
			{ code: 'ZAM', name: 'Zambia' },
			{ code: 'MOZ', name: 'Mozambique' },
			{ code: 'ZW', name: 'Zimbabwe' },
		];

		// Build filters for ERP queries
		const filters = this.buildErpFilters(params);

		// Fetch exchange rates for currency conversion (use endDate as reference)
		const exchangeRates = await this.getExchangeRates(params.endDate);
		const exchangeRateMap = new Map<string, number>();
		exchangeRates.forEach(rate => {
			exchangeRateMap.set(rate.code, rate.rate);
		});

		// Fetch data for all countries in parallel
		const countryPromises = countries.map(async (country) => {
			try {
				this.logger.log(`Fetching daily sales performance for ${country.name} (${country.code})`);
				
				// Get daily aggregations from sales lines (includes cost data)
				const dailyAggregations = await this.erpDataService.getDailyAggregationsFromSalesLines(filters, country.code);
				
				// Get currency info for this country
				const currency = getCurrencyForCountry(country.code);
				
				// Get exchange rate for this country's currency to ZAR
				const exchangeRate = currency.code === 'ZAR' ? 1 : (exchangeRateMap.get(currency.code) || 1);
				
				this.logger.log(`${country.name}: ${dailyAggregations.length} daily aggregations, exchange rate ${currency.code} to ZAR: ${exchangeRate}`);

				// Calculate daily sales performance for this country
				const countryDailySales = this.calculateDailySalesPerformanceFromAggregations(dailyAggregations);

				// Convert all values to ZAR
				if (currency.code === 'ZAR' || exchangeRate === 1) {
					return countryDailySales;
				}

				// Divide by exchange rate to convert FROM foreign currency TO ZAR
				return countryDailySales.map(day => ({
					...day,
					salesR: day.salesR / exchangeRate,
					basketValue: day.basketValue / exchangeRate,
					gpR: day.gpR / exchangeRate,
					// Note: gpPercentage doesn't need conversion (it's a percentage)
				}));
			} catch (error: any) {
				this.logger.error(`Error fetching daily sales performance for ${country.name}: ${error?.message || 'Unknown error'}`);
				// Return empty array for this country instead of failing completely
				return [];
			}
		});

		// Wait for all countries to complete
		const allCountryDailySales = await Promise.all(countryPromises);

		// Flatten and combine all daily sales from all countries
		const consolidatedDailySales = allCountryDailySales.flat();

		// Group by date and sum across all countries
		const dailyData = new Map<string, DailySalesPerformanceDto>();
		
		consolidatedDailySales.forEach((day) => {
			const date = day.date;
			if (!dailyData.has(date)) {
				dailyData.set(date, {
					date,
					dayOfWeek: day.dayOfWeek,
					basketCount: 0,
					basketValue: 0,
					clientsQty: 0,
					salesR: 0,
					gpR: 0,
					gpPercentage: 0,
				});
			}
			const dayData = dailyData.get(date)!;
			dayData.basketCount += day.basketCount;
			dayData.clientsQty += day.clientsQty;
			dayData.salesR += day.salesR;
			dayData.gpR += day.gpR;
		});

		// Calculate basket value and GP percentage for each day
		const result: DailySalesPerformanceDto[] = Array.from(dailyData.values()).map(day => ({
			...day,
			basketValue: day.basketCount > 0 ? day.salesR / day.basketCount : 0,
			gpPercentage: day.salesR > 0 ? (day.gpR / day.salesR) * 100 : 0,
		}));

		// Sort by date
		const sortedResult = result.sort((a, b) => a.date.localeCompare(b.date));

		this.logger.log(`✅ Consolidated daily sales performance generated: ${sortedResult.length} days across ${countries.length} countries (all in ZAR)`);

		return sortedResult;
	}

	/**
	 * Generate branch × category performance matrix
	 * 
	 * ✅ REVISED: Uses ONLY tblsaleslines aggregations (matches Sales by Category chart)
	 * Uses SUM(incl_line_total) - SUM(tax) grouped by store and category
	 * This ensures Branch × Category matches Sales by Category total (R823,481.96)
	 * GP calculations use direct cost from sales lines (no scaling)
	 */
	async generateBranchCategoryPerformance(params: PerformanceFiltersDto): Promise<BranchCategoryPerformanceDto[]> {
		this.logger.log(`Generating branch-category performance for org ${params.organisationId}`);

		// Build ERP query filters
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params) || 'SA';
		
		// ✅ LOG: Track countryCode for debugging
		this.logger.log(`🏷️ [BranchCategoryPerformance] Country: ${params.country || 'not specified'} → countryCode: ${countryCode}`);
		
		// ✅ Get branch × category aggregations from tblsaleslines ONLY
		// Uses: SUM(incl_line_total) - SUM(tax) grouped by store, category
		// This matches Sales by Category chart query (R823,481.96)
		const branchCategoryAggregations = await this.erpDataService.getBranchCategoryAggregations(filters, countryCode);
		
		this.logger.log(`🏷️ [BranchCategoryPerformance] Fetched ${branchCategoryAggregations.length} aggregations for country ${countryCode}`);
		
		// ✅ Calculate performance directly from sales lines (no scaling)
		const result = await this.calculateBranchCategoryPerformanceFromAggregations(branchCategoryAggregations, countryCode);
		
		// ✅ LOG: Verify countryCode is set on all branches
		const branchesWithCountryCode = result.filter(b => b.countryCode === countryCode).length;
		const branchesWithoutCountryCode = result.filter(b => !b.countryCode || b.countryCode !== countryCode).length;
		this.logger.log(`🏷️ [BranchCategoryPerformance] Result: ${result.length} branches, ${branchesWithCountryCode} tagged with countryCode ${countryCode}, ${branchesWithoutCountryCode} missing/incorrect`);
		
		// ✅ WARN: Log branches with incorrect countryCode
		if (branchesWithoutCountryCode > 0) {
			result.forEach(branch => {
				if (!branch.countryCode || branch.countryCode !== countryCode) {
					this.logger.warn(`⚠️ [BranchCategoryPerformance] Branch ${branch.branchId} (${branch.branchName}) has countryCode: ${branch.countryCode || 'undefined'}, expected: ${countryCode}`);
				}
			});
		}
		
		return result;
	}

	/**
	 * Generate consolidated branch × category performance across all countries with ZAR conversion
	 * Fetches data from all countries, converts all currency values to ZAR using exchange rates
	 * All branches from all countries are combined into a single list with values in ZAR
	 */
	async generateConsolidatedBranchCategoryPerformance(params: PerformanceFiltersDto): Promise<BranchCategoryPerformanceDto[]> {
		this.logger.log(`Generating consolidated branch-category performance for org ${params.organisationId} (all countries, ZAR)`);

		// Supported countries
		const countries = [
			{ code: 'SA', name: 'South Africa' },
			{ code: 'BOT', name: 'Botswana' },
			{ code: 'ZAM', name: 'Zambia' },
			{ code: 'MOZ', name: 'Mozambique' },
			{ code: 'ZW', name: 'Zimbabwe' },
		];

		// Build filters for ERP queries
		const filters = this.buildErpFilters(params);

		// Fetch exchange rates for currency conversion (use endDate as reference)
		const exchangeRates = await this.getExchangeRates(params.endDate);
		const exchangeRateMap = new Map<string, number>();
		exchangeRates.forEach(rate => {
			exchangeRateMap.set(rate.code, rate.rate);
		});

		// Fetch data for all countries in parallel
		const countryPromises = countries.map(async (country) => {
			try {
				this.logger.log(`Fetching branch-category performance for ${country.name} (${country.code})`);
				
				// Get branch category aggregations for this country
				const branchCategoryAggregations = await this.erpDataService.getBranchCategoryAggregations(filters, country.code);
				
				// Get currency info for this country
				const currency = getCurrencyForCountry(country.code);
				
				// Get exchange rate for this country's currency to ZAR
				// Note: Exchange rates are stored as "1 ZAR = X foreign currency", so we divide to convert TO ZAR
				const exchangeRate = currency.code === 'ZAR' ? 1 : (exchangeRateMap.get(currency.code) || 1);
				
				this.logger.log(`${country.name}: ${branchCategoryAggregations.length} branch-category aggregations, exchange rate ${currency.code} to ZAR: ${exchangeRate}`);

				// Calculate branch category performance for this country
				const countryBranchCategoryPerformance = await this.calculateBranchCategoryPerformanceFromAggregations(
					branchCategoryAggregations,
					country.code
				);

				// Convert all currency values to ZAR
				// If rate is 1 (ZAR) or not found, no conversion needed
				if (currency.code === 'ZAR' || exchangeRate === 1) {
					// Still tag with country code even if no conversion needed
					return countryBranchCategoryPerformance.map(branch => ({
						...branch,
						countryCode: country.code, // ✅ Tag with country code
					}));
				}

				// Divide by exchange rate to convert FROM foreign currency TO ZAR
				// (Rate represents "1 ZAR = X foreign currency", so divide to get ZAR)
				return countryBranchCategoryPerformance.map(branch => {
					// Convert branch totals
					const convertedTotal = {
						...branch.total,
						salesR: branch.total.salesR / exchangeRate,
						gpR: branch.total.gpR / exchangeRate,
						basketValue: branch.total.basketValue / exchangeRate,
						// Note: gpPercentage, basketCount, and clientsQty don't need conversion (they're percentages or counts)
					};

					// Convert category values
					const convertedCategories: Record<string, CategoryPerformanceDto> = {};
					Object.keys(branch.categories).forEach(categoryKey => {
						const category = branch.categories[categoryKey];
						convertedCategories[categoryKey] = {
							...category,
							salesR: category.salesR / exchangeRate,
							gpR: category.gpR / exchangeRate,
							basketValue: category.basketValue / exchangeRate,
							// Note: gpPercentage, basketCount, and clientsQty don't need conversion
						};
					});

					return {
						...branch,
						countryCode: country.code, // ✅ Tag with country code
						total: convertedTotal,
						categories: convertedCategories,
					};
				});
			} catch (error: any) {
				this.logger.error(`Error fetching branch-category performance for ${country.name}: ${error?.message || 'Unknown error'}`);
				// Return empty array for this country instead of failing completely
				return [];
			}
		});

		// Wait for all countries to complete
		const allCountryBranchCategoryPerformance = await Promise.all(countryPromises);

		// Flatten and combine all branch category performance from all countries
		const consolidatedBranchCategoryPerformance = allCountryBranchCategoryPerformance.flat();

		// Sort by revenue (descending)
		const sortedBranchCategoryPerformance = consolidatedBranchCategoryPerformance.sort((a, b) => b.total.salesR - a.total.salesR);

		this.logger.log(`✅ Consolidated branch-category performance generated: ${sortedBranchCategoryPerformance.length} branches across ${countries.length} countries (all in ZAR)`);

		return sortedBranchCategoryPerformance;
	}

	/**
	 * Generate sales per store data
	 * 
	 * ✅ FIXED: Now uses branch category aggregations from tblsaleslines (same data source as Branch × Category Performance)
	 * Revenue, transaction count, and unique customers are calculated from branchCategoryAggregations
	 * Uses the same filtered dataset: item_code IS NOT NULL, item_code != '.', type = 'I'
	 * This ensures Sales Per Store matches Branch × Category Performance totals exactly
	 * GP calculated from BranchCategoryAggregations (sums totalCost per store)
	 */
	async generateSalesPerStore(params: PerformanceFiltersDto): Promise<SalesPerStoreDto[]> {
		this.logger.log(`Generating sales per store for org ${params.organisationId}`);

		// Build ERP query filters
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params) || 'SA';
		
		// ✅ LOG: Track countryCode for debugging
		this.logger.log(`🏷️ [SalesPerStore] Country: ${params.country || 'not specified'} → countryCode: ${countryCode}`);
		
		// ✅ Get branch aggregations from tblsalesheader (kept for backward compatibility, but not used in calculation)
		const branchAggregations = await this.erpDataService.getBranchAggregations(filters, countryCode);
		
		// ✅ Get branch category aggregations from tblsaleslines (used for all calculations)
		const branchCategoryAggregations = await this.erpDataService.getBranchCategoryAggregations(filters, countryCode);
		
		this.logger.log(`🏷️ [SalesPerStore] Fetched ${branchCategoryAggregations.length} aggregations for country ${countryCode}`);
		
		const result = await this.calculateSalesPerStoreFromAggregations(branchAggregations, branchCategoryAggregations, countryCode);
		
		// ✅ LOG: Verify countryCode is set on all stores
		const storesWithCountryCode = result.filter(s => s.countryCode === countryCode).length;
		const storesWithoutCountryCode = result.filter(s => !s.countryCode || s.countryCode !== countryCode).length;
		this.logger.log(`🏷️ [SalesPerStore] Result: ${result.length} stores, ${storesWithCountryCode} tagged with countryCode ${countryCode}, ${storesWithoutCountryCode} missing/incorrect`);
		
		// ✅ WARN: Log stores with incorrect countryCode
		if (storesWithoutCountryCode > 0) {
			result.forEach(store => {
				if (!store.countryCode || store.countryCode !== countryCode) {
					this.logger.warn(`⚠️ [SalesPerStore] Store ${store.storeId} (${store.storeName}) has countryCode: ${store.countryCode || 'undefined'}, expected: ${countryCode}`);
				}
			});
		}
		
		return result;
	}

	/**
	 * Generate consolidated sales per store across all countries with ZAR conversion
	 * Fetches data from all countries, converts all currency values to ZAR using exchange rates
	 */
	async generateConsolidatedSalesPerStore(params: PerformanceFiltersDto): Promise<SalesPerStoreDto[]> {
		this.logger.log(`Generating consolidated sales per store for org ${params.organisationId} (all countries, ZAR)`);

		// Supported countries
		const countries = [
			{ code: 'SA', name: 'South Africa' },
			{ code: 'BOT', name: 'Botswana' },
			{ code: 'ZAM', name: 'Zambia' },
			{ code: 'MOZ', name: 'Mozambique' },
			{ code: 'ZW', name: 'Zimbabwe' },
		];

		// Build filters for ERP queries
		const filters = this.buildErpFilters(params);

		// Fetch exchange rates for currency conversion (use endDate as reference)
		const exchangeRates = await this.getExchangeRates(params.endDate);
		const exchangeRateMap = new Map<string, number>();
		exchangeRates.forEach(rate => {
			exchangeRateMap.set(rate.code, rate.rate);
		});

		// Fetch data for all countries in parallel
		const countryPromises = countries.map(async (country) => {
			try {
				this.logger.log(`Fetching sales per store for ${country.name} (${country.code})`);
				
				// Get branch aggregations for this country
				const branchAggregations = await this.erpDataService.getBranchAggregations(filters, country.code);
				
				// Get branch category aggregations to calculate GP
				const branchCategoryAggregations = await this.erpDataService.getBranchCategoryAggregations(filters, country.code);
				
				// Get currency info for this country
				const currency = getCurrencyForCountry(country.code);
				
				// Get exchange rate for this country's currency to ZAR
				// Note: Exchange rates are stored as "1 ZAR = X foreign currency", so we divide to convert TO ZAR
				const exchangeRate = currency.code === 'ZAR' ? 1 : (exchangeRateMap.get(currency.code) || 1);
				
				this.logger.log(`${country.name}: ${branchAggregations.length} branches, exchange rate ${currency.code} to ZAR: ${exchangeRate}`);

				// Calculate sales per store for this country
				const countrySalesPerStore = await this.calculateSalesPerStoreFromAggregations(
					branchAggregations,
					branchCategoryAggregations,
					country.code
				);

				// Convert all values to ZAR
				// If rate is 1 (ZAR) or not found, no conversion needed
				if (currency.code === 'ZAR' || exchangeRate === 1) {
					// Still tag with country code even if no conversion needed
					const taggedStores = countrySalesPerStore.map(store => ({
						...store,
						countryCode: country.code, // ✅ Tag with country code
					}));
					
					// ✅ LOG: Verify all stores are tagged correctly
					this.logger.log(`🏷️ [ConsolidatedSalesPerStore] ${country.name}: Tagged ${taggedStores.length} stores with countryCode ${country.code}`);
					
					return taggedStores;
				}

				// Divide by exchange rate to convert FROM foreign currency TO ZAR
				// (Rate represents "1 ZAR = X foreign currency", so divide to get ZAR)
				const taggedStores = countrySalesPerStore.map(store => {
					const taggedStore = {
						...store,
						countryCode: country.code, // ✅ Tag with country code
						totalRevenue: store.totalRevenue / exchangeRate,
						averageTransactionValue: store.averageTransactionValue / exchangeRate,
						grossProfit: store.grossProfit / exchangeRate,
						// Note: grossProfitPercentage doesn't need conversion (it's a percentage)
					};
					
					// ✅ LOG: Verify store is tagged correctly
					this.logger.debug(`🏷️ [ConsolidatedSalesPerStore] Tagged store ${taggedStore.storeId} (${taggedStore.storeName}) with countryCode ${country.code}`);
					
					return taggedStore;
				});
				
				// ✅ LOG: Verify all stores are tagged correctly
				this.logger.log(`🏷️ [ConsolidatedSalesPerStore] ${country.name}: Tagged ${taggedStores.length} stores with countryCode ${country.code}`);
				
				return taggedStores;
			} catch (error: any) {
				this.logger.error(`Error fetching sales per store for ${country.name}: ${error?.message || 'Unknown error'}`);
				// Return empty array for this country instead of failing completely
				return [];
			}
		});

		// Wait for all countries to complete
		const allCountrySalesPerStore = await Promise.all(countryPromises);

		// Flatten and combine all sales per store from all countries
		const consolidatedSalesPerStore = allCountrySalesPerStore.flat();

		// Sort by revenue (descending)
		const sortedSalesPerStore = consolidatedSalesPerStore.sort((a, b) => b.totalRevenue - a.totalRevenue);

		this.logger.log(`✅ Consolidated sales per store generated: ${sortedSalesPerStore.length} stores across ${countries.length} countries (all in ZAR)`);

		return sortedSalesPerStore;
	}

	/**
	 * Get exchange rates for currency conversion to ZAR
	 * Fetches rates from bit_consolidated.tblforex_history for the given date
	 */
	private async getExchangeRates(date?: string): Promise<ExchangeRateDto[]> {
		const operationId = 'GET-EXCHANGE-RATES';
		
		// Default to today's date if no date provided
		let queryDate: string;
		if (!date || date.trim() === '') {
			const today = new Date();
			queryDate = today.toISOString().split('T')[0]; // Format as YYYY-MM-DD
			this.logger.log(`[${operationId}] No date provided, using today's date: ${queryDate}`);
		} else {
			queryDate = date.trim();
			this.logger.log(`[${operationId}] Fetching exchange rates for date: ${queryDate}`);
		}

		try {
			// Get consolidated database connection
			const consolidatedDataSource = await this.erpConnectionManager.getConsolidatedConnection();
			this.logger.debug(`[${operationId}] ✅ Connected to consolidated database (bit_consolidated)`);

			// Query forex rates for the exact date
			const query = `
				SELECT forex_code, CAST(rate AS CHAR) as rate
				FROM tblforex_history
				WHERE forex_date = ?
				AND forex_code IN ('BWP', 'ZMW', 'MZN', 'ZWL', 'USD', 'EUR')
				ORDER BY forex_code
			`;
			
			this.logger.debug(`[${operationId}] Executing query with date parameter: ${queryDate}`);
			const results = await consolidatedDataSource.query(query, [queryDate]);

			// Convert to DTO format
			const exchangeRates: ExchangeRateDto[] = results.map((row: any) => {
				const rate = Number(row.rate);
				return {
					code: row.forex_code,
					rate: rate,
				};
			});

			this.logger.log(`[${operationId}] ✅ Successfully fetched ${exchangeRates.length} exchange rates for date ${queryDate}`);
			return exchangeRates;
		} catch (error: any) {
			this.logger.error(`[${operationId}] ❌ Error fetching exchange rates: ${error?.message || 'Unknown error'}`);
			// Return empty array on error - conversion will use rate of 1 (no conversion)
			return [];
		}
	}

	/**
	 * Get master data for filters
	 */
	async getMasterData(params: PerformanceFiltersDto): Promise<{
		branches: Array<{ id: string; name: string }>;
		products: Array<{ id: string; name: string }>;
		salespeople: Array<{ id: string; name: string }>;
		paymentMethods: Array<{ id: string; name: string }>;
		customerCategories: Array<{ id: string; name: string }>;
	}> {
		this.logger.log(`Getting master data for filters`);

		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params);

		return await this.erpDataService.getMasterDataForFilters(filters, countryCode);
	}

	// ===================================================================
	// DATA RETRIEVAL (Phase 1: Mock Data / Phase 2: Real DB Queries)
	// ===================================================================

	/**
	 * Get performance data - NOW USING ERP DATABASE
	 * 
	 * ✅ UPDATED: Now fetches headers to get sales_code for sales person mapping
	 */
	private async getPerformanceData(params: PerformanceFiltersDto): Promise<PerformanceData[]> {
		try {
			// Build ERP query filters
			const filters = this.buildErpFilters(params);
			const countryCode = this.getCountryCode(params);

			this.logger.log(`Fetching ERP performance data for ${filters.startDate} to ${filters.endDate}`);

			// ✅ Use customer category filtering if include/exclude filters are specified
			const hasCustomerCategoryFilters = (filters.includeCustomerCategories && filters.includeCustomerCategories.length > 0) ||
				(filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0);

			let salesLines: any[];
			if (hasCustomerCategoryFilters) {
				// Use method with customer category JOINs when filtering by customer categories
				this.logger.log(`Using customer category filtering - include: ${filters.includeCustomerCategories?.join(',') || 'none'}, exclude: ${filters.excludeCustomerCategories?.join(',') || 'none'}`);
				const salesLinesWithCategories = await this.erpDataService.getSalesLinesWithCustomerCategories(filters, ['1'], countryCode);
				// Convert to regular sales lines format (remove category fields for compatibility)
				salesLines = salesLinesWithCategories.map(line => {
					const { customer_category_code, customer_category_description, ...rest } = line;
					return rest;
				});
			} else {
				// Use standard method when no customer category filtering
				salesLines = await this.erpDataService.getSalesLinesByDateRange(filters, ['1'], countryCode);
			}
			
			// ✅ Get headers to access sales_code for sales person mapping
			const headers = await this.erpDataService.getSalesHeadersByDateRange(filters, countryCode);
			this.logger.log(`Fetched ${headers.length} sales headers for sales_code mapping`);
			
			// ✅ REMOVED: Redundant country filtering - database switching via countryCode handles this
			// The countryCode parameter ensures we're querying the correct database
			// No need to filter by store codes here since the database switch already isolates the data
			
			// Transform to performance data format with headers for sales_code mapping
			const performanceData = this.erpTransformerService.transformToPerformanceDataList(salesLines, headers);
			
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
			const filters = this.buildErpFilters(params);
			const countryCode = this.getCountryCode(params);

			this.logger.log(`Fetching ERP sales transactions for ${filters.startDate} to ${filters.endDate}`);

			// Get sales lines from ERP
			// ✅ REMOVED: Redundant country filtering - database switching via countryCode handles this
			const salesLines = await this.erpDataService.getSalesLinesByDateRange(filters, ['1'], countryCode);
			
			// Get headers if needed
			const headers = await this.erpDataService.getSalesHeadersByDateRange(filters, countryCode);
			
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
	 * ✅ REVISED: Calculate summary metrics using daily aggregations (tblsalesheader.total_incl - total_tax)
	 * This matches the user's SQL query: SELECT SUM(total_incl) - SUM(total_tax) FROM tblsalesheader WHERE doc_type IN (1, 2)
	 * Revenue is exclusive of tax
	 * 
	 * @param params - Performance filters
	 * @param data - Performance data (line items) - still used for transaction count and quantity
	 * @param totalTarget - Real revenue target from ErpTargetsService (based on org settings)
	 */
	private async calculateSummaryFromDailyAggregations(
		params: PerformanceFiltersDto,
		data: PerformanceData[],
		totalTarget: number,
	): Promise<PerformanceSummaryDto> {
		// Build ERP query filters
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params);
		
		// ✅ Get revenue from daily aggregations (uses tblsalesheader.total_incl - total_tax, exclusive of tax)
		const dailyAggregations = await this.erpDataService.getDailyAggregations(filters, countryCode);
		
		// Log filter details for debugging
		if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
			this.logger.log(`📊 Summary calculation with EXCLUSION filters: ${filters.excludeCustomerCategories.join(', ')}`);
			this.logger.log(`📊 Daily aggregations count: ${dailyAggregations.length}`);
		}
		
		// Sum totalRevenue from all daily aggregations (matches SQL: SUM(total_incl) - SUM(total_tax))
		const totalRevenue = dailyAggregations.reduce((sum, agg) => {
			const revenue = typeof agg.totalRevenue === 'number' ? agg.totalRevenue : parseFloat(String(agg.totalRevenue || 0));
			return sum + revenue;
		}, 0);
		
		// Log revenue breakdown for debugging
		if (filters.excludeCustomerCategories && filters.excludeCustomerCategories.length > 0) {
			this.logger.log(`📊 Calculated Total Revenue (after exclusions): R${totalRevenue.toFixed(2)}`);
			dailyAggregations.forEach((agg, idx) => {
				if (idx < 5) { // Log first 5 aggregations
					this.logger.log(`📊   [${idx + 1}] ${agg.date} | Store: ${agg.store} | Revenue: R${agg.totalRevenue.toFixed(2)} | Transactions: ${agg.transactionCount}`);
				}
			});
		}
		
		// ✅ Get category aggregations to calculate cost and GP (from tblsaleslines)
		// This gives us totalSalesExVatAndCost (matches Sales by Category chart: R823,481.96)
		const categoryAggregations = await this.erpDataService.getCategoryAggregations(filters, countryCode);
		
		// Calculate total sales ex VAT and costings from sales lines
		const totalSalesExVatAndCost = categoryAggregations.reduce((sum, agg) => {
			const revenue = typeof agg.totalRevenue === 'number' ? agg.totalRevenue : parseFloat(String(agg.totalRevenue || 0));
			return sum + revenue;
		}, 0);
		
		// Calculate total cost from sales lines
		const totalCost = categoryAggregations.reduce((sum, agg) => {
			const cost = typeof agg.totalCost === 'number' ? agg.totalCost : parseFloat(String(agg.totalCost || 0));
			return sum + cost;
		}, 0);
		
		// Calculate total GP: Revenue - Cost
		const totalGP = totalSalesExVatAndCost - totalCost;
		
		// ✅ FIXED: Use real target from organization settings, not calculated from data
		// This fixes the "stuck at 83.3%" issue where target was always proportional to revenue
		const performanceRate = totalTarget === 0 ? 0 : (totalRevenue / totalTarget) * 100;
		
		// Still use line items for transaction count and quantity (needed for averages)
		const transactionCount = data.length;
		const averageOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;

		// Calculate average items per basket (convert quantities to numbers)
		const totalQuantity = data.reduce((sum, item) => {
			const quantity = typeof item.quantity === 'number' ? item.quantity : parseFloat(String(item.quantity || 0));
			return sum + quantity;
		}, 0);
		const averageItemsPerBasket = transactionCount > 0 ? totalQuantity / transactionCount : 0;

		this.logger.log(`📊 Summary Calculated (from daily aggregations):`);
		this.logger.log(`   - Total Revenue (Ex VAT): R${totalRevenue.toFixed(2)} (from tblsalesheader.total_incl - total_tax)`);
		this.logger.log(`   - Total Sales Ex VAT and Costings: R${totalSalesExVatAndCost.toFixed(2)} (from tblsaleslines, matches Sales by Category)`);
		this.logger.log(`   - Total Cost: R${totalCost.toFixed(2)} (from tblsaleslines)`);
		this.logger.log(`   - Total GP: R${totalGP.toFixed(2)} (Revenue - Cost)`);
		this.logger.log(`   - Total Target: R${totalTarget.toFixed(2)} (from org settings)`);
		this.logger.log(`   - Performance Rate: ${performanceRate.toFixed(2)}%`);
		this.logger.log(`   - Transactions: ${transactionCount}`);

		return {
			totalRevenue,
			totalSalesExVatAndCost,
			totalCost,
			totalGP,
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
		
		// ✅ FIXED: Now using real payment type data (async)
		const customerComposition = await this.generateCustomerCompositionChart(params);
		
		// ✅ FIXED: Now using real conversion rate data (quotations vs invoices)
		const conversionRate = await this.generateConversionRateChart(params);
		
		// ✅ REVISED: Revenue trend chart now uses daily aggregations (async)
		const revenueTrend = await this.generateRevenueTrendChart(data, params);
		
		// ✅ REVISED: Sales by category chart now uses category aggregations (async) - top 5 only
		const salesByCategory = await this.generateSalesByCategoryChart(data, params);
		
		// ✅ NEW: GP trend chart showing gross profit over time
		const gpTrend = await this.generateGPTrendChart(data, params);
		
		return {
			revenueTrend,
			hourlySales,
			salesByCategory,
			branchPerformance: await this.generateBranchPerformanceChart(data, params),
			topProducts: await this.generateTopProductsChart(data, params),
			itemsPerBasket: this.generateItemsPerBasketChart(data),
			salesBySalesperson: await this.generateSalesBySalespersonChart(params),
			conversionRate,
			customerComposition,
			gpTrend,
		};
	}

	/**
	 * ✅ REVISED: Generate revenue trend chart using daily aggregations (tblsalesheader.total_incl - total_tax)
	 * This matches the user's SQL query: SELECT SUM(total_incl) - SUM(total_tax) FROM tblsalesheader WHERE doc_type IN (1, 2)
	 * Revenue is exclusive of tax
	 */
	private async generateRevenueTrendChart(data: PerformanceData[], params: PerformanceFiltersDto) {
		// Build ERP query filters
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params);
		
		// ✅ Get revenue from daily aggregations (uses tblsalesheader.total_incl - total_tax, exclusive of tax)
		const dailyAggregations = await this.erpDataService.getDailyAggregations(filters, countryCode);
		
		// Aggregate revenue by date (sum across all stores for each date)
		const aggregated = dailyAggregations.reduce((acc, agg) => {
			const date = typeof agg.date === 'string' ? agg.date : new Date(agg.date).toISOString().split('T')[0];
			if (!acc[date]) {
				acc[date] = { revenue: 0, target: 0 };
			}
			const revenue = typeof agg.totalRevenue === 'number' ? agg.totalRevenue : parseFloat(String(agg.totalRevenue || 0));
			acc[date].revenue += revenue;
			// Target calculation: use average target from line items (for now, can be enhanced later)
			acc[date].target += 0; // Targets are not in daily aggregations, keeping for compatibility
			return acc;
		}, {} as Record<string, { revenue: number; target: number }>);

		// Calculate average target from line items for display
		const targetByDate = data.reduce((acc, item) => {
			if (!acc[item.date]) {
				acc[item.date] = { sum: 0, count: 0 };
			}
			acc[item.date].sum += item.target;
			acc[item.date].count += 1;
			return acc;
		}, {} as Record<string, { sum: number; count: number }>);

		// Merge target data
		Object.keys(aggregated).forEach(date => {
			if (targetByDate[date]) {
				aggregated[date].target = targetByDate[date].sum / targetByDate[date].count;
			}
		});

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
	 * ✅ NEW: Generate GP trend chart using daily sales performance data
	 * Shows gross profit over time
	 */
	private async generateGPTrendChart(data: PerformanceData[], params: PerformanceFiltersDto) {
		try {
			// Use the daily sales performance data which already has GP calculated
			const dailySalesPerformance = await this.generateDailySalesPerformance(params);
			
			// Convert to chart data format
			const sortedData = dailySalesPerformance
				.map((day) => ({
					date: day.date,
					gp: day.gpR || 0,
				}))
				.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
			
			// Sample data for chart (max 7 points for UI clarity)
			const sampledData =
				sortedData.length <= 7
					? sortedData
					: sortedData.filter((_, index) => index % Math.ceil(sortedData.length / 7) === 0).slice(0, 7);
			
			const chartData: LineChartDataPoint[] = sampledData.map((item) => ({
				label: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
				value: item.gp,
				dataPointText: this.formatValue(item.gp, 1),
			}));
			
			return { data: chartData, targetValue: undefined };
		} catch (error) {
			this.logger.error(`Error generating GP trend chart: ${error.message}`);
			this.logger.error(`Stack: ${error.stack}`);
			// Return empty data on error
			return { data: [], targetValue: undefined };
		}
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
			const filters = this.buildErpFilters(params);
			const countryCode = this.getCountryCode(params);

			// ✅ Get real hourly sales data from ERP
			const hourlyData = await this.erpDataService.getHourlySalesPattern(filters, countryCode);
			
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
	 * ✅ REVISED: Generate sales by category chart using category aggregations (tblsaleslines.incl_line_total - tax)
	 * This matches the user's SQL query: SELECT line.category, SUM(line.incl_line_total) - SUM(tax) as totalRevenue
	 * Revenue is exclusive of tax
	 * ✅ FIXED: Calculates total from ALL categories, but only shows top 5 in legend
	 */
	private async generateSalesByCategoryChart(data: PerformanceData[], params: PerformanceFiltersDto) {
		// Build ERP query filters
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params);
		
		// ✅ Get revenue from category aggregations (uses tblsaleslines.incl_line_total - tax, exclusive of tax)
		// ✅ Get ALL categories (no limit) - data and calculations reflect whole scope
		const categoryAggregations = await this.erpDataService.getCategoryAggregations(filters, countryCode);
		
		// Map and sort ALL categories
		const allCategories = categoryAggregations
			.map(agg => ({
				category: agg.category || 'Uncategorized',
				revenue: typeof agg.totalRevenue === 'number' ? agg.totalRevenue : parseFloat(String(agg.totalRevenue || 0)),
			}))
			.sort((a, b) => b.revenue - a.revenue); // Sort by revenue descending

		// ✅ Calculate total from ALL categories (whole scope)
		const total = allCategories.reduce((sum, item) => sum + item.revenue, 0);

		// ✅ Show ALL categories in chart (legend will be limited to 5 items on frontend)
		const chartData: PieChartDataPoint[] = allCategories.map((item) => ({
			label: item.category,
			value: item.revenue,
		}));

		return { data: chartData, total };
	}

	/**
	 * Generate branch performance chart
	 * 
	 * ✅ REVISED: Uses branch aggregations from tblsalesheader grouped by store
	 * ✅ Uses branch names from mapping (not codes)
	 * ✅ FIXED: Calculates total from ALL branches, but only shows top 10 in legend
	 */
	private async generateBranchPerformanceChart(data: PerformanceData[], params: PerformanceFiltersDto) {
		// Build ERP query filters
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params);
		
		// ✅ Get branch aggregations directly from tblsalesheader (SUM(total_incl) - SUM(total_tax) grouped by store)
		// ✅ Get ALL branches (no limit) - data and calculations reflect whole scope
		const branchAggregations = await this.erpDataService.getBranchAggregations(filters, countryCode);
		
		// Get all store codes and fetch branch names from database
		const storeCodes = branchAggregations.map(agg => String(agg.store || '').trim().padStart(3, '0'));
		const branchNamesMap = await this.erpDataService.getBranchNamesFromDatabase(storeCodes, countryCode);
		
		// Map ALL branch aggregations to chart data using branch names from database
		const allBranches = branchAggregations
			.map((agg) => {
				const storeCode = String(agg.store || '').trim().padStart(3, '0');
				const branchName = branchNamesMap.get(storeCode) || storeCode; // ✅ Use branch name from database
				const revenue = typeof agg.totalRevenue === 'number' 
					? agg.totalRevenue 
					: parseFloat(String(agg.totalRevenue || 0));
				
				return {
					label: branchName,
					value: revenue,
					target: 0, // Target not available from aggregations, can be calculated separately if needed
				};
			})
			.sort((a, b) => b.value - a.value);

		// ✅ Show ALL branches in chart (no limit)
		const averageTarget =
			allBranches.length > 0
				? allBranches.reduce((sum, item) => sum + item.target, 0) / allBranches.length
				: 0;

		this.logger.debug(`Branch performance chart generated with ${allBranches.length} branches displayed (using names from tblsalesheader aggregations)`);

		return { data: allBranches, averageTarget };
	}

	/**
	 * Generate top products chart
	 * 
	 * ✅ REVISED: Uses product aggregations from tblsaleslines grouped by description
	 * ✅ Revenue calculation: SUM(incl_line_total) - SUM(tax)
	 * ✅ Filters: item_code != '.', type = 'I' (inventory items)
	 * ✅ FIXED: Gets ALL products, calculates total from ALL, but only shows top 10 in legend
	 */
	private async generateTopProductsChart(data: PerformanceData[], params: PerformanceFiltersDto) {
		// Build ERP query filters
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params);
		
		// ✅ Get product aggregations directly from tblsaleslines (SUM(incl_line_total) - SUM(tax) grouped by description)
		// ✅ Get ALL products (use high limit to get all) - data and calculations reflect whole scope
		const productAggregations = await this.erpDataService.getProductAggregations(filters, 10000, countryCode); // Get all products
		
		// Map ALL product aggregations to chart data using product description
		const allProducts = productAggregations
			.map((agg) => {
				const revenue = typeof agg.totalRevenue === 'number' 
					? agg.totalRevenue 
					: parseFloat(String(agg.totalRevenue || 0));
				const productName = String(agg.description || agg.itemCode || 'Unknown Product').trim();
				
				return {
					label: productName, // ✅ Use product description (grouped by description)
					value: revenue,
				};
			})
			.sort((a, b) => b.value - a.value); // Sort by revenue descending

		// ✅ Calculate total from ALL products (whole scope)
		const total = allProducts.reduce((sum, item) => sum + item.value, 0);

		// ✅ Show ALL products in chart (no limit)
		this.logger.debug(`Top products chart generated with ${allProducts.length} products displayed (using product aggregations)`);

		return { data: allProducts, total };
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
	 * 
	 * ✅ REVISED: Now uses getSalesPersonAggregations from ERP service
	 * Groups by sales_code and calculates SUM(total_incl) - SUM(total_tax) for revenue
	 * Uses sales_code mapping to show actual sales person names instead of codes
	 * ✅ FIXED: Calculates total from ALL salespeople, but only shows top 10 in legend
	 */
	private async generateSalesBySalespersonChart(params: PerformanceFiltersDto) {
		// Build ERP query filters using buildErpFilters helper
		const filters = this.buildErpFilters(params);
		const countryCode = this.getCountryCode(params);

		// ✅ Get sales person aggregations from ERP service
		// ✅ Get ALL salespeople (no limit) - data and calculations reflect whole scope
		// ✅ Sales rep names are now included in aggregations from tblsalesman table
		const aggregations = await this.erpDataService.getSalesPersonAggregations(filters, countryCode);

		// Convert ALL aggregations to chart data format
		const allSalespeople = aggregations
			.map((agg) => ({
				label: agg.salesName || agg.salesCode, // ✅ Use sales name from tblsalesman or fallback to code
				value: agg.totalRevenue, // Use revenue as primary value for bar chart
			}))
			.sort((a, b) => b.value - a.value);

		// ✅ Show ALL salespeople in chart (no limit)
		this.logger.debug(`Sales by salesperson chart generated with ${allSalespeople.length} salespeople displayed (using ERP aggregations)`);

		return { data: allSalespeople };
	}

	/**
	 * Generate conversion rate chart showing ALL document types breakdown
	 * 
	 * ✅ UPDATED: Now shows breakdown by all document types:
	 * - Tax Invoice (doc_type = 1)
	 * - Credit Note (doc_type = 2)
	 * - Quotation (doc_type = 3)
	 * - Sales Order (doc_type = 4)
	 * - Receipt (doc_type = 6)
	 * - And any other doc_types that exist
	 */
	private async generateConversionRateChart(params: PerformanceFiltersDto) {
		try {
			// Build ERP query filters
			const filters = this.buildErpFilters(params);
			const countryCode = this.getCountryCode(params);

			// ✅ Get document type breakdown from ERP
			const docTypeBreakdown = await this.erpDataService.getDocumentTypeBreakdown(filters, countryCode);
			
			this.logger.log(`📊 Document Type Breakdown Retrieved:`);
			docTypeBreakdown.forEach((item) => {
				this.logger.log(`   - ${item.docTypeLabel} (${item.docType}): ${item.count} docs, R${item.totalValue.toFixed(2)}`);
			});

			// Color mapping for different document types
			const docTypeColors: Record<number, string> = {
				1: '#10B981', // Tax Invoice - Green
				2: '#EF4444', // Credit Note - Red
				3: '#F59E0B', // Quotation - Amber
				4: '#3B82F6', // Sales Order - Blue
				6: '#8B5CF6', // Receipt - Purple
				10: '#6B7280', // Suspended - Gray
				11: '#F97316', // Return - Orange
				12: '#14B8A6', // Purchase Order - Teal
				55: '#EC4899', // Sales - Pink
			};

			// Generate chart data from breakdown
			const chartData: PieChartDataPoint[] = docTypeBreakdown
				.filter((item) => item.totalValue > 0) // Only include types with values
				.map((item) => ({
					label: `${item.docTypeLabel} (${item.count})`,
					value: item.totalValue,
					color: docTypeColors[item.docType] || '#9CA3AF', // Default gray if color not mapped
				}));

			// Calculate total and conversion rate (Tax Invoices / Total)
			const total = chartData.reduce((sum, item) => sum + item.value, 0);
			const taxInvoiceData = docTypeBreakdown.find((item) => item.docType === 1);
			const quotationData = docTypeBreakdown.find((item) => item.docType === 3);
			const conversionRate = quotationData && quotationData.count > 0 && taxInvoiceData
				? (taxInvoiceData.count / quotationData.count) * 100
				: 0;

			if (chartData.length === 0) {
				this.logger.warn(`⚠️ No document type data found for date range ${filters.startDate} to ${filters.endDate}`);
			} else {
				this.logger.log(`✅ Document type breakdown chart generated: ${chartData.length} document types, Total: R${total.toFixed(2)}`);
				if (conversionRate > 0) {
					this.logger.log(`   Conversion Rate (Tax Invoices / Quotations): ${conversionRate.toFixed(2)}%`);
				}
			}
			
			return { data: chartData, total, percentage: conversionRate };
		} catch (error) {
			this.logger.error(`Error generating conversion rate chart: ${error.message}`);
			this.logger.error(`Stack: ${error.stack}`);
			// Return empty data on error
			return { data: [], total: 0, percentage: 0 };
		}
	}

	/**
	 * Generate customer composition chart using real payment type data
	 * 
	 * ✅ FIXED: Now uses real payment type data from tblsalesheader (cash, credit_card, eft, etc.)
	 * Previously used simulated data with hardcoded customer types
	 */
	private async generateCustomerCompositionChart(params: PerformanceFiltersDto) {
		try {
			// Build ERP query filters
			const filters = this.buildErpFilters(params);
			const countryCode = this.getCountryCode(params);

			// ✅ Get real payment type data from ERP
			const paymentTypes = await this.erpDataService.getPaymentTypeAggregations(filters, countryCode);
			
			// Define colors for different payment types
			const colorMap: Record<string, string> = {
				'Cash': '#10B981',
				'Credit Card': '#8B5CF6',
				'EFT': '#06B6D4',
				'Debit Card': '#F59E0B',
				'Account': '#EF4444',
				'SnapScan': '#EC4899',
				'Zapper': '#6366F1',
				'Voucher': '#14B8A6',
				'Cheque': '#84CC16',
				'Extra': '#F97316',
				'Offline Card': '#A855F7',
				'FNB QR': '#22D3EE',
			};

			// Convert to chart data format
			const chartData: PieChartDataPoint[] = paymentTypes.map((pt) => ({
				label: pt.paymentType,
				value: pt.totalAmount,
				color: colorMap[pt.paymentType] || '#6B7280', // Default gray if not mapped
			}));

			const total = chartData.reduce((sum, item) => sum + item.value, 0);

			this.logger.log(`✅ Customer composition chart generated with ${chartData.length} payment types (real data from ERP)`);
			
			return { data: chartData, total };
		} catch (error) {
			this.logger.error(`Error generating customer composition chart: ${error.message}`);
			// Return empty data on error
			return { data: [], total: 0 };
		}
	}

	// ===================================================================
	// DAILY SALES PERFORMANCE
	// ===================================================================

	/**
	 * ✅ REVISED: Calculate daily sales performance from daily aggregations (tblsaleslines)
	 * Uses sales lines aggregations which include cost data for GP calculation
	 * Revenue = SUM(incl_line_total) - SUM(tax) from tblsaleslines
	 * Cost = SUM(cost_price * quantity) with credit note handling
	 * GP = Revenue - Cost
	 * Transaction count = COUNT(DISTINCT doc_number)
	 * Unique clients = COUNT(DISTINCT customer)
	 */
	private calculateDailySalesPerformanceFromAggregations(aggregations: DailyAggregation[]): DailySalesPerformanceDto[] {
		// Group aggregations by date (sum across all stores for each date)
		const dailyData = new Map<string, {
			revenue: number;
			cost: number;
			transactionCount: number;
			uniqueCustomers: number;
		}>();

		aggregations.forEach((agg) => {
			const date = typeof agg.date === 'string' ? agg.date : new Date(agg.date).toISOString().split('T')[0];
			if (!dailyData.has(date)) {
				dailyData.set(date, { revenue: 0, cost: 0, transactionCount: 0, uniqueCustomers: 0 });
			}
			const dayData = dailyData.get(date)!;
			const revenue = typeof agg.totalRevenue === 'number' ? agg.totalRevenue : parseFloat(String(agg.totalRevenue || 0));
			const cost = typeof agg.totalCost === 'number' ? agg.totalCost : parseFloat(String(agg.totalCost || 0));
			const transactionCount = typeof agg.transactionCount === 'number' ? agg.transactionCount : parseInt(String(agg.transactionCount || 0), 10);
			const uniqueCustomers = typeof agg.uniqueCustomers === 'number' ? agg.uniqueCustomers : parseInt(String(agg.uniqueCustomers || 0), 10);
			
			dayData.revenue += revenue;
			dayData.cost += cost;
			dayData.transactionCount += transactionCount;
			// For unique customers: Since aggregations are grouped by date AND store,
			// each store has its own COUNT(DISTINCT customer). When aggregating across stores,
			// we sum them (customers shopping at multiple stores will be counted multiple times,
			// but this is an approximation since we don't have actual customer IDs in aggregations)
			dayData.uniqueCustomers += uniqueCustomers;
		});

		const performance: DailySalesPerformanceDto[] = [];
		const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

		dailyData.forEach((dayData, date) => {
			const dateObj = new Date(date);
			const basketCount = dayData.transactionCount;
			const basketValue = basketCount > 0 ? dayData.revenue / basketCount : 0;
			const gpR = dayData.revenue - dayData.cost;
			const gpPercentage = dayData.revenue > 0 ? (gpR / dayData.revenue) * 100 : 0;

			performance.push({
				date,
				dayOfWeek: dayNames[dateObj.getDay()],
				basketCount, // ✅ Transaction count from aggregations
				basketValue,
				clientsQty: dayData.uniqueCustomers, // ✅ Unique clients from aggregations
				salesR: dayData.revenue, // ✅ Revenue from aggregations
				gpR, // ✅ GP calculated from revenue - cost
				gpPercentage, // ✅ GP percentage calculated
			});
		});

		return performance.sort((a, b) => a.date.localeCompare(b.date));
	}

	/**
	 * Calculate daily sales performance (legacy method using transactions)
	 * Kept for backward compatibility if needed
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
	 * Calculate branch × category performance directly from sales lines aggregations
	 * 
	 * ✅ REVISED: Uses ONLY tblsaleslines data (no scaling, no header dependency)
	 * - Revenue: SUM(incl_line_total) - SUM(tax) from sales lines
	 * - Cost: SUM(cost_price * quantity) from sales lines
	 * - GP: Revenue - Cost (direct calculation, no scaling)
	 * - GP%: (GP / Revenue) * 100
	 * 
	 * This ensures Branch × Category matches Sales by Category total (R823,481.96)
	 */
	private async calculateBranchCategoryPerformanceFromAggregations(
		categoryAggregations: BranchCategoryAggregation[],
		countryCode: string = 'SA'
	): Promise<BranchCategoryPerformanceDto[]> {
		if (categoryAggregations.length === 0) return [];

		// ✅ LOG: Track countryCode at calculation level
		this.logger.debug(`🏷️ [calculateBranchCategoryPerformance] Processing ${categoryAggregations.length} aggregations with countryCode: ${countryCode}`);

		// Step 1: Get all store codes and fetch branch names from database
		const storeCodes = categoryAggregations.map(agg => String(agg.store || '').trim().padStart(3, '0'));
		const branchNamesMap = await this.erpDataService.getBranchNamesFromDatabase(storeCodes, countryCode);
		
		// ✅ LOG: Verify branch names were fetched for correct country
		this.logger.debug(`🏷️ [calculateBranchCategoryPerformance] Fetched ${branchNamesMap.size} branch names from country ${countryCode} database`);

		// Step 2: Group category aggregations by branch (store)
		const branchData = new Map<string, {
			branchName: string;
			categories: Map<string, BranchCategoryAggregation>;
		}>();

		categoryAggregations.forEach((agg) => {
			const storeCode = String(agg.store || '').trim().padStart(3, '0');
			const branchId = `B${storeCode}`; // Format as B001, B002, etc.
			const categoryKey = String(agg.category || 'Uncategorized').trim();

			if (!branchData.has(branchId)) {
				branchData.set(branchId, {
					branchName: branchNamesMap.get(storeCode) || storeCode, // ✅ Use branch name from database
					categories: new Map(),
				});
			}

			const branchInfo = branchData.get(branchId)!;
			branchInfo.categories.set(categoryKey, agg);
		});

		const performance: BranchCategoryPerformanceDto[] = [];

		// Step 2: Calculate performance for each branch directly from sales lines
		branchData.forEach((branchInfo, branchId) => {
			const categories: Record<string, CategoryPerformanceDto> = {};
			
			// Branch totals (summed from categories)
			let branchTotalRevenue = 0;
			let branchTotalCost = 0;
			let branchTotalBasketCount = 0;
			const branchUniqueClients = new Set<string>();

			// Process each category
			branchInfo.categories.forEach((agg, categoryKey) => {
				// ✅ Use revenue directly from sales lines (already excludes tax)
				const revenue = typeof agg.totalRevenue === 'number' 
					? agg.totalRevenue 
					: parseFloat(String(agg.totalRevenue || 0));
				
				// ✅ Use cost directly from sales lines (cost_price * quantity)
				const cost = typeof agg.totalCost === 'number'
					? agg.totalCost
					: parseFloat(String(agg.totalCost || 0));
				
				// ✅ Calculate GP: Revenue - Cost (no scaling)
				const gp = revenue - cost;
				
				// ✅ Calculate GP%: (GP / Revenue) * 100
				const gpPercentage = revenue > 0 ? (gp / revenue) * 100 : 0;
				
				const basketCount = typeof agg.transactionCount === 'number' 
					? agg.transactionCount 
					: parseInt(String(agg.transactionCount || 0), 10);
				
				const uniqueCustomers = typeof agg.uniqueCustomers === 'number' 
					? agg.uniqueCustomers 
					: parseInt(String(agg.uniqueCustomers || 0), 10);

				categories[categoryKey] = {
					categoryName: categoryKey,
					basketCount, // ✅ Transaction count from lines
					basketValue: basketCount > 0 ? revenue / basketCount : 0,
					clientsQty: uniqueCustomers, // ✅ Unique clients from lines
					salesR: revenue, // ✅ Revenue directly from sales lines (no scaling)
					gpR: gp, // ✅ GP calculated directly (revenue - cost)
					gpPercentage: gpPercentage, // ✅ GP% calculated correctly
				};

				// Accumulate branch totals
				branchTotalRevenue += revenue;
				branchTotalCost += cost;
				branchTotalBasketCount += basketCount;
				// Note: uniqueCustomers is already aggregated, so we can't use Set here
				// We'll sum them (may slightly overcount multi-category clients)
			});

			// ✅ Calculate branch total GP
			const branchTotalGP = branchTotalRevenue - branchTotalCost;
			
			// ✅ Calculate branch total GP%
			const branchTotalGPPercentage = branchTotalRevenue > 0 ? (branchTotalGP / branchTotalRevenue) * 100 : 0;

			// Calculate total unique clients (sum across categories - may slightly overcount)
			const branchTotalUniqueClients = Array.from(branchInfo.categories.values()).reduce((sum, agg) => {
				return sum + (typeof agg.uniqueCustomers === 'number' 
					? agg.uniqueCustomers 
					: parseInt(String(agg.uniqueCustomers || 0), 10));
			}, 0);

			// ✅ LOG: Log each branch being created with its countryCode
			this.logger.debug(`🏷️ [calculateBranchCategoryPerformance] Creating branch: ${branchId} (${branchInfo.branchName}) with countryCode: ${countryCode}`);
			
			performance.push({
				branchId,
				branchName: branchInfo.branchName,
				countryCode: countryCode, // ✅ Tag with country code at root level
				categories,
				total: {
					categoryName: 'Total',
					basketCount: branchTotalBasketCount, // ✅ Sum of category basket counts
					basketValue: branchTotalBasketCount > 0 
						? branchTotalRevenue / branchTotalBasketCount 
						: 0,
					clientsQty: branchTotalUniqueClients, // ✅ Sum of category unique clients
					salesR: branchTotalRevenue, // ✅ Sum of category revenues (matches Sales by Category)
					gpR: branchTotalGP, // ✅ Total GP for branch (revenue - cost)
					gpPercentage: branchTotalGPPercentage, // ✅ Total GP% for branch
				},
			});
		});

		return performance.sort((a, b) => b.total.salesR - a.total.salesR); // Sort by revenue
	}

	/**
	 * Calculate branch × category performance (legacy method using transactions)
	 * Kept for backward compatibility if needed
	 * 
	 * ✅ Uses branch names from mapping (not codes)
	 */
	private calculateBranchCategoryPerformance(transactions: ErpSalesTransaction[]): BranchCategoryPerformanceDto[] {
		if (transactions.length === 0) return [];

		// Import branch name mapping
		const { getBranchName } = require('../../erp/config/category-mapping.config');

		// Group transactions by branch and category (using actual ERP data)
		const branchData = new Map<string, {
			branchName: string;
			categories: Map<string, ErpSalesTransaction[]>;
		}>();

		transactions.forEach((t) => {
			// Get branch name from transaction (from ERP store field)
			// branchId is in format "B001", "B002", etc., but getBranchName expects store code "001", "002"
			const branchKey = t.branchId;
			const storeCode = branchKey.replace(/^B/, ''); // Remove "B" prefix to get store code
			const categoryKey = t.categoryId || 'Uncategorized';

			if (!branchData.has(branchKey)) {
				branchData.set(branchKey, {
					branchName: getBranchName(storeCode), // ✅ Use branch name from mapping (pass store code, not branch ID)
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
				// ✅ GP Calculation: Sum all GP values (NOT averaged)
				const revenue = categoryTransactions.reduce((sum, t) => sum + t.revenue, 0);
				const gp = categoryTransactions.reduce((sum, t) => sum + t.grossProfit, 0);
				const basketCount = categoryTransactions.length;

				categories[categoryKey] = {
					categoryName: categoryKey,
					basketCount,
					basketValue: basketCount > 0 ? revenue / basketCount : 0,
					clientsQty: uniqueClients.size,
					salesR: revenue,
					gpR: gp, // ✅ Total GP for this category (summed, not averaged)
					gpPercentage: revenue > 0 ? (gp / revenue) * 100 : 0, // ✅ GP% = (GP / Revenue) * 100
				};

				totalBasketCount += basketCount;
				totalRevenue += revenue;
				totalGP += gp; // ✅ Accumulate GP (summed across categories)
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
					gpR: totalGP, // ✅ Total GP for branch (summed across all categories, not averaged)
					gpPercentage: totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0, // ✅ Overall GP% = (Total GP / Total Revenue) * 100
				},
			});
		});

		return performance.sort((a, b) => b.total.salesR - a.total.salesR); // Sort by revenue
	}

	// ===================================================================
	// SALES PER STORE
	// ===================================================================

	/**
	 * ✅ FIXED: Calculate sales per store from branch category aggregations (tblsaleslines)
	 * Uses the same data source as Branch × Category Performance to ensure consistency
	 * Revenue = SUM of revenue from branchCategoryAggregations (summed across all categories per store)
	 * Uses the same filtered dataset: item_code IS NOT NULL, item_code != '.', type = 'I'
	 * Transaction count and unique customers also from branchCategoryAggregations (summed across categories)
	 * GP calculated from BranchCategoryAggregations by summing totalCost per store
	 * GP = Revenue - Cost, GP% = (GP / Revenue) * 100
	 * 
	 * This ensures Sales Per Store matches Branch × Category Performance totals exactly
	 */
	private async calculateSalesPerStoreFromAggregations(
		aggregations: BranchAggregation[],
		branchCategoryAggregations: BranchCategoryAggregation[],
		countryCode: string = 'SA'
	): Promise<SalesPerStoreDto[]> {
		if (branchCategoryAggregations.length === 0) return [];
		
		// ✅ LOG: Track countryCode at calculation level
		this.logger.debug(`🏷️ [calculateSalesPerStore] Processing ${branchCategoryAggregations.length} aggregations with countryCode: ${countryCode}`);

		// ✅ Aggregate data from branchCategoryAggregations by store
		// This ensures we use the same filtered dataset as Branch × Category Performance
		const storeData = new Map<string, {
			revenue: number;
			cost: number;
			transactionCount: number;
			uniqueCustomers: number;
		}>();

		branchCategoryAggregations.forEach((agg) => {
			const storeCode = String(agg.store || '').trim().padStart(3, '0');
			const revenue = typeof agg.totalRevenue === 'number' 
				? agg.totalRevenue 
				: parseFloat(String(agg.totalRevenue || 0));
			const cost = typeof agg.totalCost === 'number' 
				? agg.totalCost 
				: parseFloat(String(agg.totalCost || 0));
			const transactionCount = typeof agg.transactionCount === 'number' 
				? agg.transactionCount 
				: parseInt(String(agg.transactionCount || 0), 10);
			const uniqueCustomers = typeof agg.uniqueCustomers === 'number' 
				? agg.uniqueCustomers 
				: parseInt(String(agg.uniqueCustomers || 0), 10);
			
			if (!storeData.has(storeCode)) {
				storeData.set(storeCode, { revenue: 0, cost: 0, transactionCount: 0, uniqueCustomers: 0 });
			}
			const storeInfo = storeData.get(storeCode)!;
			storeInfo.revenue += revenue;
			storeInfo.cost += cost;
			storeInfo.transactionCount += transactionCount;
			// Note: uniqueCustomers may slightly overcount if a customer appears in multiple categories,
			// but this matches the behavior in Branch × Category Performance
			storeInfo.uniqueCustomers += uniqueCustomers;
		});

		// Get all store codes and fetch branch names from database
		const storeCodes = Array.from(storeData.keys());
		const branchNamesMap = await this.erpDataService.getBranchNamesFromDatabase(storeCodes, countryCode);
		
		// ✅ LOG: Verify branch names were fetched for correct country
		this.logger.debug(`🏷️ [calculateSalesPerStore] Fetched ${branchNamesMap.size} branch names from country ${countryCode} database`);

		const salesPerStore: SalesPerStoreDto[] = [];

		storeData.forEach((storeInfo, storeCode) => {
			const branchId = `B${storeCode}`; // Format as B001, B002, etc.
			const revenue = storeInfo.revenue; // ✅ Revenue from line items (matches Branch × Category)
			const cost = storeInfo.cost;
			const transactionCount = storeInfo.transactionCount; // ✅ Transaction count from line items
			const uniqueCustomers = storeInfo.uniqueCustomers; // ✅ Unique customers from line items
			
			// ✅ Calculate GP from cost data
			const grossProfit = revenue - cost; // ✅ GP = Revenue - Cost
			const grossProfitPercentage = revenue > 0 ? (grossProfit / revenue) * 100 : 0; // ✅ GP% = (GP / Revenue) * 100

			const storeName = branchNamesMap.get(storeCode) || storeCode;
			
			// ✅ LOG: Log each store being created with its countryCode
			this.logger.debug(`🏷️ [calculateSalesPerStore] Creating store: ${branchId} (${storeName}) with countryCode: ${countryCode}`);

			salesPerStore.push({
				storeId: branchId,
				storeName: storeName, // ✅ Use branch name from database
				countryCode: countryCode, // ✅ Tag with country code at root level
				totalRevenue: revenue, // ✅ Revenue from line items (matches Branch × Category)
				transactionCount, // ✅ Transaction count from line items
				averageTransactionValue: transactionCount > 0 ? revenue / transactionCount : 0,
				totalItemsSold: 0, // Not available in line aggregations
				uniqueClients: uniqueCustomers, // ✅ Unique customers from line items
				grossProfit: grossProfit, // ✅ GP calculated from BranchCategoryAggregations
				grossProfitPercentage: grossProfitPercentage, // ✅ GP% calculated
			});
		});

		return salesPerStore.sort((a, b) => b.totalRevenue - a.totalRevenue);
	}

	/**
	 * Calculate sales per store (legacy method using transactions)
	 * Kept for backward compatibility if needed
	 */
	private calculateSalesPerStore(transactions: ErpSalesTransaction[]): SalesPerStoreDto[] {
		if (transactions.length === 0) return [];

		// Import branch name mapping
		const { getBranchName } = require('../../erp/config/category-mapping.config');

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
			// ✅ GP Calculation: Sum all GP values (NOT averaged)
			const totalRevenue = storeTransactions.reduce((sum, t) => sum + t.revenue, 0);
			const totalGP = storeTransactions.reduce((sum, t) => sum + t.grossProfit, 0);
			const totalItemsSold = storeTransactions.reduce((sum, t) => sum + t.quantity, 0);
			const transactionCount = storeTransactions.length;

			// branchId is in format "B001", "B002", etc., but getBranchName expects store code "001", "002"
			const storeCode = branchId.replace(/^B/, ''); // Remove "B" prefix to get store code

			salesPerStore.push({
				storeId: branchId,
				storeName: getBranchName(storeCode), // ✅ Use branch name from mapping (pass store code, not branch ID)
				totalRevenue,
				transactionCount,
				averageTransactionValue: transactionCount > 0 ? totalRevenue / transactionCount : 0,
				totalItemsSold,
				uniqueClients: uniqueClients.size,
				grossProfit: totalGP, // ✅ Total GP (summed, not averaged)
				grossProfitPercentage: totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0, // ✅ GP% = (Total GP / Total Revenue) * 100
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
	 * Build ERP query filters from PerformanceFiltersDto
	 * Centralizes filter mapping logic
	 * 
	 * ✅ FIXED: Country and branch filters now work together
	 * ✅ FIXED: Branch IDs (B015) are converted to store codes (015)
	 */
	private buildErpFilters(params: PerformanceFiltersDto): ErpQueryFilters {
		const filters: ErpQueryFilters = {
			startDate: params.startDate || this.getDefaultStartDate(),
			endDate: params.endDate || this.getDefaultEndDate(),
		};

		// ✅ FIXED: Convert branch ID to store code (B015 → 015)
		// Helper function to convert branch ID to store code
		const convertBranchIdToStoreCode = (branchId: string | number): string => {
			const branchIdStr = String(branchId).trim();
			// If it starts with 'B', remove it (B015 → 015)
			if (branchIdStr.startsWith('B')) {
				return branchIdStr.substring(1).padStart(3, '0');
			}
			// Otherwise, pad to 3 digits (15 → 015)
			return branchIdStr.padStart(3, '0');
		};

		// ✅ FIXED: Map branch filter (works WITH country filter, not instead of)
		// Country filter switches database, branch filter narrows within that database
		if (params.branchId) {
			filters.storeCode = convertBranchIdToStoreCode(params.branchId);
			this.logger.debug(`Branch filter: ${params.branchId} → store code: ${filters.storeCode}`);
		} else if (params.branchIds && params.branchIds.length > 0) {
			// If multiple branches selected, use first one for now
			// TODO: Support multiple branch filtering if needed
			filters.storeCode = convertBranchIdToStoreCode(params.branchIds[0]);
			this.logger.debug(`Branch filter (multiple): ${params.branchIds[0]} → store code: ${filters.storeCode}`);
		}

		// Note: Country filtering is handled via countryCode parameter passed to ERP service methods
		// Database switching happens automatically via ErpConnectionManagerService
		// No need to filter by store codes here - the database switch handles it

		// Map category filter
		if (params.category) {
			filters.category = params.category;
		} else if (params.product?.category) {
			filters.category = params.product.category;
		}

		// Map sales person filter
		if (params.salesPersonIds && params.salesPersonIds.length > 0) {
			filters.salesPersonId = params.salesPersonIds.length === 1 
				? params.salesPersonIds[0] 
				: params.salesPersonIds;
		}

		// Map customer category filters
		if (params.includeCustomerCategories && params.includeCustomerCategories.length > 0) {
			filters.includeCustomerCategories = params.includeCustomerCategories;
		}

		if (params.excludeCustomerCategories && params.excludeCustomerCategories.length > 0) {
			filters.excludeCustomerCategories = params.excludeCustomerCategories;
		}

		return filters;
	}

	/**
	 * Get country code from params (extracted from country name in Reports Service)
	 * 
	 * ✅ FIXED: Properly extracts countryCode from params
	 * Returns undefined when country is not specified to preserve consolidated view
	 * Country codes: SA (default), ZAM, MOZ, BOT, ZW, MAL
	 */
	private getCountryCode(params: PerformanceFiltersDto): string | undefined {
		// countryCode is set by Reports Service convertParamsToFilters
		// Preserve undefined for consolidated view (all countries)
		const countryCode = (params as any).countryCode;
		
		// ✅ LOG: Enhanced logging for debugging country code issues
		this.logger.log(`🌍 [getCountryCode] Country: "${params.country || 'not specified'}" → countryCode: "${countryCode || 'undefined (consolidated)'}"`);
		
		// ✅ WARN: If country is specified but countryCode is undefined, log a warning
		if (params.country && params.country !== 'ALL' && !countryCode) {
			this.logger.warn(`⚠️ [getCountryCode] Country "${params.country}" specified but countryCode is undefined! This may cause incorrect country tagging.`);
		}
		
		return countryCode;
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

	/**
	 * Get year-to-date transaction count for aggregation milestone checks.
	 * Uses daily aggregations (COUNT(DISTINCT doc_number)) for the current year.
	 */
	async getYtdTransactionCount(params: {
		organisationId: number;
		countryCode?: string;
	}): Promise<number> {
		const now = new Date();
		const ytdStart = `${now.getFullYear()}-01-01`;
		const ytdEnd = now.toISOString().split('T')[0];
		const countryCode = params.countryCode || 'SA';

		const filters: ErpQueryFilters = {
			startDate: ytdStart,
			endDate: ytdEnd,
		};

		const dailyAggregations = await this.erpDataService.getDailyAggregations(filters, countryCode);
		const total = dailyAggregations.reduce((sum, agg) => {
			const count = typeof agg.transactionCount === 'number'
				? agg.transactionCount
				: parseInt(String(agg.transactionCount || 0), 10);
			return sum + count;
		}, 0);

		this.logger.log(`[getYtdTransactionCount] Org ${params.organisationId} YTD (${ytdStart} to ${ytdEnd}): ${total} transactions`);
		return total;
	}
}

