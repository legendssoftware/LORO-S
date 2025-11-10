import { Injectable, Logger } from '@nestjs/common';
import { TblSalesLines } from '../entities/tblsaleslines.entity';
import { TblSalesHeader } from '../entities/tblsalesheader.entity';
import { SalesTransaction, PerformanceData } from '../interfaces/erp-data.interface';
import { getCategoryId, getBranchId, getBranchName } from '../config/category-mapping.config';

/**
 * ERP Transformer Service
 * 
 * Transforms ERP database entities into the format expected by
 * the performance dashboard and charts.
 */
@Injectable()
export class ErpTransformerService {
	private readonly logger = new Logger(ErpTransformerService.name);

	/**
	 * Generate unique operation ID for tracking
	 */
	private generateOperationId(operation: string): string {
		return `${operation}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
	}

	/**
	 * Transform TblSalesLines to SalesTransaction format
	 * 
	 * This matches the SalesTransaction interface from performance-mock-data.ts
	 */
	transformToSalesTransaction(line: TblSalesLines, header?: TblSalesHeader): SalesTransaction {
		try {
			// Calculate revenue using gross amount (incl_line_total) - discount already applied to selling price
			// Convert to number to ensure JavaScript numeric operations work correctly
			const revenue = parseFloat(String(line.incl_line_total || 0));
			
			// Calculate cost
			const cost = parseFloat(String(line.cost_price || 0)) * parseFloat(String(line.quantity || 0));
			
			// Calculate gross profit
			const grossProfit = revenue - cost;
			
			// Calculate GP percentage (avoid division by zero)
			const grossProfitPercentage = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

			return {
				id: `TXN${line.ID.toString().padStart(6, '0')}`,
				date: this.formatDate(line.sale_date),
				branchId: getBranchId(line.store),
				categoryId: getCategoryId(line.category),
				productId: line.item_code || 'UNKNOWN',
				quantity: parseFloat(String(line.quantity || 0)),
				salesPrice: parseFloat(String(line.incl_price || 0)),
				costPrice: parseFloat(String(line.cost_price || 0)),
				revenue,
				cost,
				grossProfit,
				grossProfitPercentage,
				clientId: line.customer || 'UNKNOWN',
			};
		} catch (error) {
			this.logger.error(`Error transforming sales line ${line.ID}: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Transform multiple sales lines to sales transactions
	 */
	transformToSalesTransactions(lines: TblSalesLines[], headers?: TblSalesHeader[]): SalesTransaction[] {
		const operationId = this.generateOperationId('TRANSFORM_SALES_TXN');
		
		this.logger.log(`[${operationId}] Starting bulk sales transaction transformation`);
		this.logger.log(`[${operationId}] Lines to transform: ${lines.length}`);
		this.logger.log(`[${operationId}] Headers provided: ${headers ? headers.length : 0}`);
		
		const startTime = Date.now();
		
		try {
			const headerMap = new Map<string, TblSalesHeader>();
			
			if (headers) {
				headers.forEach(header => {
					if (header.doc_number) {
						headerMap.set(header.doc_number, header);
					}
				});
				this.logger.debug(`[${operationId}] Built header map with ${headerMap.size} entries`);
			}

			const results = lines.map(line => {
				const header = line.doc_number ? headerMap.get(line.doc_number) : undefined;
				return this.transformToSalesTransaction(line, header);
			});
			
			const duration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Transformed ${results.length} transactions (${duration}ms)`);
			
			return results;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error transforming sales transactions (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Transform TblSalesLines to PerformanceData format
	 * 
	 * This matches the PerformanceData interface from performance-mock-data.ts
	 * Note: Target is set to 0 here - actual targets should be calculated at the 
	 * daily/period level in the performance dashboard generator using ErpTargetsService.
	 * Individual line items don't have meaningful targets.
	 * 
	 * ✅ UPDATED: Now uses sales_code from header instead of rep_code from line
	 */
	transformToPerformanceData(line: TblSalesLines, header?: TblSalesHeader): PerformanceData {
		try {
			// Use gross amount (incl_line_total) - discount already applied to selling price
			// Convert to number to ensure JavaScript numeric operations work correctly
			const revenue = parseFloat(String(line.incl_line_total || 0));
			const cost = parseFloat(String(line.cost_price || 0)) * parseFloat(String(line.quantity || 0));
			const grossProfit = revenue - cost;
			
			// ✅ FIXED: Target should be set at the daily/period level, not line-item level
			// This is calculated in performance-dashboard.generator.ts using ErpTargetsService
			const target = 0;
			
			// Actual sales = revenue in this context
			const actualSales = revenue;

			// ✅ UPDATED: Use sales_code from header (tblsalesheader) instead of rep_code from line
			// sales_code is the primary field for sales person identification
			const salesCode = header?.sales_code || line.rep_code || null;
			const salesPersonId = salesCode || 'UNKNOWN';

			return {
				id: `PD${line.ID.toString().padStart(6, '0')}`,
				date: this.formatDate(line.sale_date),
				productId: line.item_code || 'UNKNOWN',
				productName: line.description || undefined,
				category: line.category || undefined,
				branchId: getBranchId(line.store),
				branchName: getBranchName(line.store),
				salesPersonId, // ✅ Now uses sales_code from header
				quantity: parseFloat(String(line.quantity || 0)),
				revenue,
				target,
				actualSales,
			};
		} catch (error) {
			this.logger.error(`Error transforming to performance data ${line.ID}: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Transform multiple sales lines to performance data
	 * 
	 * ✅ UPDATED: Now accepts headers to map sales_code from tblsalesheader
	 */
	transformToPerformanceDataList(lines: TblSalesLines[], headers?: TblSalesHeader[]): PerformanceData[] {
		const operationId = this.generateOperationId('TRANSFORM_PERF_DATA');
		
		this.logger.log(`[${operationId}] Starting bulk performance data transformation`);
		this.logger.log(`[${operationId}] Lines to transform: ${lines.length}`);
		this.logger.log(`[${operationId}] Headers provided: ${headers ? headers.length : 0}`);
		
		const startTime = Date.now();
		
		try {
			// Build header map by doc_number for quick lookup
			const headerMap = new Map<string, TblSalesHeader>();
			
			if (headers) {
				headers.forEach(header => {
					if (header.doc_number) {
						headerMap.set(header.doc_number, header);
					}
				});
				this.logger.debug(`[${operationId}] Built header map with ${headerMap.size} entries`);
			}

			const results = lines.map(line => {
				const header = line.doc_number ? headerMap.get(line.doc_number) : undefined;
				return this.transformToPerformanceData(line, header);
			});
			
			const duration = Date.now() - startTime;
			this.logger.log(`[${operationId}] ✅ Transformed ${results.length} performance data records (${duration}ms)`);
			
			return results;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`[${operationId}] ❌ Error transforming performance data (${duration}ms)`);
			this.logger.error(`[${operationId}] Error: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Aggregate sales lines by date for daily performance
	 */
	aggregateByDate(transactions: SalesTransaction[]): Map<string, SalesTransaction[]> {
		const dateMap = new Map<string, SalesTransaction[]>();
		
		transactions.forEach(transaction => {
			if (!dateMap.has(transaction.date)) {
				dateMap.set(transaction.date, []);
			}
			dateMap.get(transaction.date)!.push(transaction);
		});
		
		return dateMap;
	}

	/**
	 * Aggregate sales lines by branch
	 */
	aggregateByBranch(transactions: SalesTransaction[]): Map<string, SalesTransaction[]> {
		const branchMap = new Map<string, SalesTransaction[]>();
		
		transactions.forEach(transaction => {
			if (!branchMap.has(transaction.branchId)) {
				branchMap.set(transaction.branchId, []);
			}
			branchMap.get(transaction.branchId)!.push(transaction);
		});
		
		return branchMap;
	}

	/**
	 * Aggregate sales lines by category
	 */
	aggregateByCategory(transactions: SalesTransaction[]): Map<string, SalesTransaction[]> {
		const categoryMap = new Map<string, SalesTransaction[]>();
		
		transactions.forEach(transaction => {
			if (!categoryMap.has(transaction.categoryId)) {
				categoryMap.set(transaction.categoryId, []);
			}
			categoryMap.get(transaction.categoryId)!.push(transaction);
		});
		
		return categoryMap;
	}

	/**
	 * Calculate summary statistics for a set of transactions
	 */
	calculateSummaryStats(transactions: SalesTransaction[]): {
		totalRevenue: number;
		totalCost: number;
		totalGrossProfit: number;
		totalQuantity: number;
		averageBasketValue: number;
		uniqueClients: number;
		transactionCount: number;
		gpPercentage: number;
	} {
		if (transactions.length === 0) {
			return {
				totalRevenue: 0,
				totalCost: 0,
				totalGrossProfit: 0,
				totalQuantity: 0,
				averageBasketValue: 0,
				uniqueClients: 0,
				transactionCount: 0,
				gpPercentage: 0,
			};
		}

		const totalRevenue = transactions.reduce((sum, t) => sum + t.revenue, 0);
		const totalCost = transactions.reduce((sum, t) => sum + t.cost, 0);
		const totalGrossProfit = transactions.reduce((sum, t) => sum + t.grossProfit, 0);
		const totalQuantity = transactions.reduce((sum, t) => sum + t.quantity, 0);
		const uniqueClients = new Set(transactions.map(t => t.clientId)).size;
		const transactionCount = transactions.length;
		const averageBasketValue = totalRevenue / transactionCount;
		const gpPercentage = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;

		return {
			totalRevenue,
			totalCost,
			totalGrossProfit,
			totalQuantity,
			averageBasketValue,
			uniqueClients,
			transactionCount,
			gpPercentage,
		};
	}

	/**
	 * Format date to YYYY-MM-DD string
	 */
	private formatDate(date: Date | string | null | undefined): string {
		if (!date) return new Date().toISOString().split('T')[0];
		
		try {
			if (typeof date === 'string') {
				// If already in YYYY-MM-DD format, return as is
				if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
					return date;
				}
				date = new Date(date);
			}
			
			return date.toISOString().split('T')[0];
		} catch (error) {
			this.logger.warn(`Error formatting date ${date}: ${error.message}`);
			return new Date().toISOString().split('T')[0];
		}
	}

	/**
	 * Calculate gross profit metrics from sales lines
	 */
	calculateGrossProfitMetrics(lines: TblSalesLines[]): {
		totalRevenue: number;
		totalCost: number;
		totalGrossProfit: number;
		averageGPPercentage: number;
		bestPerformingCategory: string | null;
		worstPerformingCategory: string | null;
	} {
		if (lines.length === 0) {
			return {
				totalRevenue: 0,
				totalCost: 0,
				totalGrossProfit: 0,
				averageGPPercentage: 0,
				bestPerformingCategory: null,
				worstPerformingCategory: null,
			};
		}

		let totalRevenue = 0;
		let totalCost = 0;
		const categoryGP = new Map<string, { revenue: number; gp: number }>();

		lines.forEach(line => {
			// Use gross amount (incl_line_total) - discount already applied to selling price
			// Convert to number to ensure JavaScript numeric operations work correctly
			const revenue = parseFloat(String(line.incl_line_total || 0));
			const cost = parseFloat(String(line.cost_price || 0)) * parseFloat(String(line.quantity || 0));
			const gp = revenue - cost;

			totalRevenue += revenue;
			totalCost += cost;

			const category = line.category || 'Other';
			if (!categoryGP.has(category)) {
				categoryGP.set(category, { revenue: 0, gp: 0 });
			}
			const catData = categoryGP.get(category)!;
			catData.revenue += revenue;
			catData.gp += gp;
		});

		const totalGrossProfit = totalRevenue - totalCost;
		const averageGPPercentage = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;

		// Find best and worst performing categories by GP%
		let bestCategory: string | null = null;
		let worstCategory: string | null = null;
		let bestGP = -Infinity;
		let worstGP = Infinity;

		categoryGP.forEach((data, category) => {
			const gpPercent = data.revenue > 0 ? (data.gp / data.revenue) * 100 : 0;
			if (gpPercent > bestGP) {
				bestGP = gpPercent;
				bestCategory = category;
			}
			if (gpPercent < worstGP) {
				worstGP = gpPercent;
				worstCategory = category;
			}
		});

		return {
			totalRevenue,
			totalCost,
			totalGrossProfit,
			averageGPPercentage,
			bestPerformingCategory: bestCategory,
			worstPerformingCategory: worstCategory,
		};
	}
}

