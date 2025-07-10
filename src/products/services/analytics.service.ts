import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Product } from '../entities/product.entity';
import { ProductAnalytics } from '../entities/product-analytics.entity';
import { Quotation } from '../../shop/entities/quotation.entity';
import { startOfDay, endOfDay, subDays, subMonths, subWeeks, format } from 'date-fns';
import { OrderStatus } from '../../lib/enums/status.enums';
import { ProductStatus } from 'src/lib/enums/product.enums';

export interface SalesMetrics {
	totalRevenue: number;
	totalUnits: number;
	totalQuotations: number;
	conversionRate: number;
	averageOrderValue: number;
	topProducts: Array<{
		productId: number;
		productName: string;
		revenue: number;
		unitsSold: number;
		conversions: number;
	}>;
}

export interface CustomerBehaviorMetrics {
	totalViews: number;
	totalCartAdds: number;
	totalWishlistAdds: number;
	viewToCartRate: number;
	cartToSaleRate: number;
	overallConversionRate: number;
	bounceRate: number;
	engagementScore: number;
}

export interface InventoryMetrics {
	totalProducts: number;
	activeProducts: number;
	lowStockProducts: number;
	outOfStockProducts: number;
	averageStockTurnover: number;
	slowMovingProducts: Array<{
		productId: number;
		productName: string;
		stockLevel: number;
		daysSinceLastSale: number;
		turnoverRate: number;
	}>;
}

export interface TrendAnalysis {
	period: string;
	revenue: number;
	units: number;
	quotations: number;
	conversionRate: number;
	growthRate: number;
}

export interface ProductPerformanceInsight {
	productId: number;
	productName: string;
	category: string;
	performance: 'excellent' | 'good' | 'average' | 'poor' | 'critical';
	insights: string[];
	recommendations: string[];
	metrics: {
		revenue: number;
		unitsSold: number;
		conversionRate: number;
		stockTurnover: number;
		profitMargin: number;
		trendDirection: 'up' | 'down' | 'stable';
	};
}

@Injectable()
export class AnalyticsService {
	private readonly logger = new Logger(AnalyticsService.name);

	constructor(
		@InjectRepository(Product)
		private readonly productRepository: Repository<Product>,
		@InjectRepository(ProductAnalytics)
		private readonly analyticsRepository: Repository<ProductAnalytics>,
		@InjectRepository(Quotation)
		private readonly quotationRepository: Repository<Quotation>,
		private readonly eventEmitter: EventEmitter2,
	) {}

	/**
	 * 📊 Get comprehensive sales metrics for a date range
	 */
	async getSalesMetrics(
		startDate: Date,
		endDate: Date,
		orgId?: number,
		branchId?: number,
	): Promise<SalesMetrics> {
		this.logger.log(`📊 [getSalesMetrics] Fetching sales metrics from ${startDate.toISOString()} to ${endDate.toISOString()}`);

		try {
			// Get quotations in the date range
			const quotationQuery = this.quotationRepository
				.createQueryBuilder('quotation')
				.leftJoinAndSelect('quotation.quotationItems', 'items')
				.leftJoinAndSelect('items.product', 'product')
				.where('quotation.quotationDate BETWEEN :startDate AND :endDate', {
					startDate: startOfDay(startDate),
					endDate: endOfDay(endDate),
				})
				.andWhere('quotation.status IN (:...statuses)', {
					statuses: [OrderStatus.APPROVED, OrderStatus.COMPLETED, OrderStatus.PAID]
				});

			if (orgId) {
				quotationQuery.andWhere('quotation.organisationUid = :orgId', { orgId });
			}
			if (branchId) {
				quotationQuery.andWhere('quotation.branchUid = :branchId', { branchId });
			}

			const quotations = await quotationQuery.getMany();

			// Calculate metrics
			const totalRevenue = quotations.reduce((sum, q) => sum + Number(q.totalAmount), 0);
			const totalQuotations = quotations.length;
			const totalUnits = quotations.reduce((sum, q) => 
				sum + q.quotationItems.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
			);

			// Get total views/cart adds for conversion rate
			const analyticsQuery = this.analyticsRepository
				.createQueryBuilder('analytics')
				.leftJoin('analytics.product', 'product');

			if (orgId) {
				analyticsQuery.andWhere('product.organisationUid = :orgId', { orgId });
			}
			if (branchId) {
				analyticsQuery.andWhere('product.branchUid = :branchId', { branchId });
			}

			const analytics = await analyticsQuery.getMany();
			const totalViews = analytics.reduce((sum, a) => sum + (a.viewCount || 0), 0);
			const conversionRate = totalViews > 0 ? (totalQuotations / totalViews) * 100 : 0;
			const averageOrderValue = totalQuotations > 0 ? totalRevenue / totalQuotations : 0;

			// Calculate top products
			const productStats = new Map<number, {
				productId: number;
				productName: string;
				revenue: number;
				unitsSold: number;
				conversions: number;
			}>();

			quotations.forEach(quotation => {
				quotation.quotationItems.forEach(item => {
					const productId = item.product.uid;
					if (!productStats.has(productId)) {
						productStats.set(productId, {
							productId,
							productName: item.product.name,
							revenue: 0,
							unitsSold: 0,
							conversions: 0,
						});
					}
					const stats = productStats.get(productId);
					stats.revenue += Number(item.totalPrice);
					stats.unitsSold += item.quantity;
					stats.conversions += 1;
				});
			});

			const topProducts = Array.from(productStats.values())
				.sort((a, b) => b.revenue - a.revenue)
				.slice(0, 10);

			this.logger.log(`✅ [getSalesMetrics] Calculated metrics - Revenue: ${totalRevenue}, Units: ${totalUnits}, Quotations: ${totalQuotations}`);

			return {
				totalRevenue,
				totalUnits,
				totalQuotations,
				conversionRate,
				averageOrderValue,
				topProducts,
			};
		} catch (error) {
			this.logger.error(`❌ [getSalesMetrics] Error calculating sales metrics: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 👥 Get customer behavior metrics
	 */
	async getCustomerBehaviorMetrics(
		startDate: Date,
		endDate: Date,
		orgId?: number,
		branchId?: number,
	): Promise<CustomerBehaviorMetrics> {
		this.logger.log(`👥 [getCustomerBehaviorMetrics] Fetching customer behavior metrics`);

		try {
			const analyticsQuery = this.analyticsRepository
				.createQueryBuilder('analytics')
				.leftJoin('analytics.product', 'product');

			if (orgId) {
				analyticsQuery.andWhere('product.organisationUid = :orgId', { orgId });
			}
			if (branchId) {
				analyticsQuery.andWhere('product.branchUid = :branchId', { branchId });
			}

			const analytics = await analyticsQuery.getMany();

			const totalViews = analytics.reduce((sum, a) => sum + (a.viewCount || 0), 0);
			const totalCartAdds = analytics.reduce((sum, a) => sum + (a.cartAddCount || 0), 0);
			const totalWishlistAdds = analytics.reduce((sum, a) => sum + (a.wishlistCount || 0), 0);
			const totalSales = analytics.reduce((sum, a) => sum + (a.salesCount || 0), 0);

			const viewToCartRate = totalViews > 0 ? (totalCartAdds / totalViews) * 100 : 0;
			const cartToSaleRate = totalCartAdds > 0 ? (totalSales / totalCartAdds) * 100 : 0;
			const overallConversionRate = totalViews > 0 ? (totalSales / totalViews) * 100 : 0;

			// Calculate bounce rate (products viewed but not added to cart)
			const bounceRate = totalViews > 0 ? ((totalViews - totalCartAdds) / totalViews) * 100 : 0;

			// Calculate engagement score (0-100 based on multiple factors)
			const engagementScore = Math.min(100, 
				(viewToCartRate * 0.4) + 
				(cartToSaleRate * 0.4) + 
				((totalWishlistAdds / Math.max(totalViews, 1)) * 100 * 0.2)
			);

			this.logger.log(`✅ [getCustomerBehaviorMetrics] Calculated behavior metrics - Conversion: ${overallConversionRate.toFixed(2)}%`);

			return {
				totalViews,
				totalCartAdds,
				totalWishlistAdds,
				viewToCartRate,
				cartToSaleRate,
				overallConversionRate,
				bounceRate,
				engagementScore,
			};
		} catch (error) {
			this.logger.error(`❌ [getCustomerBehaviorMetrics] Error calculating behavior metrics: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 📦 Get inventory metrics and insights
	 */
	async getInventoryMetrics(orgId?: number, branchId?: number): Promise<InventoryMetrics> {
		this.logger.log(`📦 [getInventoryMetrics] Fetching inventory metrics`);

		try {
			const productQuery = this.productRepository
				.createQueryBuilder('product')
				.leftJoinAndSelect('product.analytics', 'analytics')
				.where('product.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				productQuery.andWhere('product.organisationUid = :orgId', { orgId });
			}
			if (branchId) {
				productQuery.andWhere('product.branchUid = :branchId', { branchId });
			}

			const products = await productQuery.getMany();

			const totalProducts = products.length;
			const activeProducts = products.filter(p => p.status !== ProductStatus.INACTIVE).length;
			const lowStockProducts = products.filter(p => 
				p.stockQuantity <= (p.reorderPoint || 10) && p.stockQuantity > 0
			).length;
			const outOfStockProducts = products.filter(p => p.stockQuantity <= 0).length;

			// Calculate average stock turnover
			const stockTurnovers = products
				.filter(p => p.analytics?.stockTurnoverRate)
				.map(p => p.analytics.stockTurnoverRate);
			const averageStockTurnover = stockTurnovers.length > 0 
				? stockTurnovers.reduce((sum, rate) => sum + rate, 0) / stockTurnovers.length 
				: 0;

			// Identify slow-moving products
			const slowMovingProducts = products
				.filter(p => p.analytics)
				.map(product => {
					const analytics = product.analytics;
					const daysSinceLastSale = analytics.lastSaleDate 
						? Math.floor((Date.now() - analytics.lastSaleDate.getTime()) / (1000 * 60 * 60 * 24))
						: 999;
					
					return {
						productId: product.uid,
						productName: product.name,
						stockLevel: product.stockQuantity,
						daysSinceLastSale,
						turnoverRate: analytics.stockTurnoverRate || 0,
					};
				})
				.filter(p => p.daysSinceLastSale > 30 || p.turnoverRate < 0.5)
				.sort((a, b) => b.daysSinceLastSale - a.daysSinceLastSale)
				.slice(0, 20);

			this.logger.log(`✅ [getInventoryMetrics] Calculated inventory metrics - Total: ${totalProducts}, Low stock: ${lowStockProducts}`);

			return {
				totalProducts,
				activeProducts,
				lowStockProducts,
				outOfStockProducts,
				averageStockTurnover,
				slowMovingProducts,
			};
		} catch (error) {
			this.logger.error(`❌ [getInventoryMetrics] Error calculating inventory metrics: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 📈 Get trend analysis for different time periods
	 */
	async getTrendAnalysis(
		period: 'daily' | 'weekly' | 'monthly',
		duration: number = 30,
		orgId?: number,
		branchId?: number,
	): Promise<TrendAnalysis[]> {
		this.logger.log(`📈 [getTrendAnalysis] Fetching ${period} trend analysis for ${duration} periods`);

		try {
			const trends: TrendAnalysis[] = [];
			const now = new Date();

			for (let i = duration - 1; i >= 0; i--) {
				let startDate: Date;
				let endDate: Date;
				let periodLabel: string;

				switch (period) {
					case 'daily':
						startDate = startOfDay(subDays(now, i));
						endDate = endOfDay(subDays(now, i));
						periodLabel = format(startDate, 'MMM dd');
						break;
					case 'weekly':
						startDate = startOfDay(subWeeks(now, i));
						endDate = endOfDay(subWeeks(now, i - 1));
						periodLabel = `Week ${format(startDate, 'MMM dd')}`;
						break;
					case 'monthly':
						startDate = startOfDay(subMonths(now, i));
						endDate = endOfDay(subMonths(now, i - 1));
						periodLabel = format(startDate, 'MMM yyyy');
						break;
				}

				const metrics = await this.getSalesMetrics(startDate, endDate, orgId, branchId);
				
				// Calculate growth rate compared to previous period
				let growthRate = 0;
				if (trends.length > 0) {
					const previousRevenue = trends[trends.length - 1].revenue;
					growthRate = previousRevenue > 0 
						? ((metrics.totalRevenue - previousRevenue) / previousRevenue) * 100 
						: 0;
				}

				trends.push({
					period: periodLabel,
					revenue: metrics.totalRevenue,
					units: metrics.totalUnits,
					quotations: metrics.totalQuotations,
					conversionRate: metrics.conversionRate,
					growthRate,
				});
			}

			this.logger.log(`✅ [getTrendAnalysis] Generated ${trends.length} trend data points`);
			return trends;
		} catch (error) {
			this.logger.error(`❌ [getTrendAnalysis] Error generating trend analysis: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 🎯 Generate AI-powered product performance insights
	 */
	async getProductPerformanceInsights(
		orgId?: number,
		branchId?: number,
	): Promise<ProductPerformanceInsight[]> {
		this.logger.log(`🎯 [getProductPerformanceInsights] Generating performance insights`);

		try {
			const productQuery = this.productRepository
				.createQueryBuilder('product')
				.leftJoinAndSelect('product.analytics', 'analytics')
				.where('product.isDeleted = :isDeleted', { isDeleted: false });

			if (orgId) {
				productQuery.andWhere('product.organisationUid = :orgId', { orgId });
			}
			if (branchId) {
				productQuery.andWhere('product.branchUid = :branchId', { branchId });
			}

			const products = await productQuery.getMany();
			const insights: ProductPerformanceInsight[] = [];

			for (const product of products) {
				if (!product.analytics) continue;

				const analytics = product.analytics;
				const insights_list: string[] = [];
				const recommendations: string[] = [];

				// Calculate metrics
				const revenue = analytics.totalRevenue || 0;
				const unitsSold = analytics.totalUnitsSold || 0;
				const viewCount = analytics.viewCount || 0;
				const conversionRate = viewCount > 0 ? (analytics.salesCount / viewCount) * 100 : 0;
				const stockTurnover = analytics.stockTurnoverRate || 0;
				const profitMargin = analytics.profitMargin || 0;

				// Determine performance level
				let performance: 'excellent' | 'good' | 'average' | 'poor' | 'critical';
				let score = 0;

				// Scoring algorithm
				if (revenue > 10000) score += 25;
				else if (revenue > 5000) score += 15;
				else if (revenue > 1000) score += 10;

				if (conversionRate > 5) score += 25;
				else if (conversionRate > 2) score += 15;
				else if (conversionRate > 1) score += 10;

				if (stockTurnover > 2) score += 25;
				else if (stockTurnover > 1) score += 15;
				else if (stockTurnover > 0.5) score += 10;

				if (profitMargin > 30) score += 25;
				else if (profitMargin > 20) score += 15;
				else if (profitMargin > 10) score += 10;

				// Assign performance level
				if (score >= 80) performance = 'excellent';
				else if (score >= 60) performance = 'good';
				else if (score >= 40) performance = 'average';
				else if (score >= 20) performance = 'poor';
				else performance = 'critical';

				// Generate insights
				if (conversionRate < 1) {
					insights_list.push('Low conversion rate suggests pricing or product description issues');
					recommendations.push('Review product pricing and improve product descriptions');
				}

				if (stockTurnover < 0.5) {
					insights_list.push('Slow inventory turnover indicates low demand');
					recommendations.push('Consider promotional campaigns or inventory reduction');
				}

				if (product.stockQuantity <= (product.reorderPoint || 10)) {
					insights_list.push('Stock level is approaching reorder point');
					recommendations.push('Restock inventory to avoid stockouts');
				}

				if (viewCount > 100 && conversionRate < 2) {
					insights_list.push('High views but low conversions suggest conversion barriers');
					recommendations.push('Analyze and optimize the purchase funnel');
				}

				// Determine trend direction
				let trendDirection: 'up' | 'down' | 'stable' = 'stable';
				// This would ideally compare with historical data
				if (revenue > (analytics.totalRevenue || 0)) trendDirection = 'up';
				else if (revenue < (analytics.totalRevenue || 0)) trendDirection = 'down';

				insights.push({
					productId: product.uid,
					productName: product.name,
					category: product.category,
					performance,
					insights: insights_list,
					recommendations,
					metrics: {
						revenue,
						unitsSold,
						conversionRate,
						stockTurnover,
						profitMargin,
						trendDirection,
					},
				});
			}

			// Sort by performance (excellent first)
			const performanceOrder = { excellent: 5, good: 4, average: 3, poor: 2, critical: 1 };
			insights.sort((a, b) => performanceOrder[b.performance] - performanceOrder[a.performance]);

			this.logger.log(`✅ [getProductPerformanceInsights] Generated insights for ${insights.length} products`);
			return insights;
		} catch (error) {
			this.logger.error(`❌ [getProductPerformanceInsights] Error generating insights: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 📊 Generate comprehensive dashboard data
	 */
	async getDashboardData(orgId?: number, branchId?: number) {
		this.logger.log(`📊 [getDashboardData] Generating comprehensive dashboard data`);

		try {
			const now = new Date();
			const thirtyDaysAgo = subDays(now, 30);
			const sevenDaysAgo = subDays(now, 7);

			// Get parallel data
			const [
				salesMetrics30Days,
				salesMetrics7Days,
				customerBehavior,
				inventoryMetrics,
				trendAnalysis,
				productInsights,
			] = await Promise.all([
				this.getSalesMetrics(thirtyDaysAgo, now, orgId, branchId),
				this.getSalesMetrics(sevenDaysAgo, now, orgId, branchId),
				this.getCustomerBehaviorMetrics(thirtyDaysAgo, now, orgId, branchId),
				this.getInventoryMetrics(orgId, branchId),
				this.getTrendAnalysis('daily', 30, orgId, branchId),
				this.getProductPerformanceInsights(orgId, branchId),
			]);

			// Calculate growth rates
			const revenueGrowth = salesMetrics30Days.totalRevenue > 0 
				? ((salesMetrics7Days.totalRevenue - salesMetrics30Days.totalRevenue) / salesMetrics30Days.totalRevenue) * 100
				: 0;

			const dashboard = {
				summary: {
					totalRevenue30Days: salesMetrics30Days.totalRevenue,
					totalRevenue7Days: salesMetrics7Days.totalRevenue,
					revenueGrowth,
					totalProducts: inventoryMetrics.totalProducts,
					activeProducts: inventoryMetrics.activeProducts,
					conversionRate: customerBehavior.overallConversionRate,
					engagementScore: customerBehavior.engagementScore,
				},
				sales: salesMetrics30Days,
				customerBehavior,
				inventory: inventoryMetrics,
				trends: trendAnalysis,
				topPerformers: productInsights.filter(p => p.performance === 'excellent').slice(0, 5),
				needsAttention: productInsights.filter(p => ['poor', 'critical'].includes(p.performance)).slice(0, 5),
				generatedAt: new Date(),
			};

			this.logger.log(`✅ [getDashboardData] Dashboard data generated successfully`);

			// Emit real-time update event
			this.eventEmitter.emit('analytics.dashboard.updated', {
				orgId,
				branchId,
				data: dashboard,
			});

			return dashboard;
		} catch (error) {
			this.logger.error(`❌ [getDashboardData] Error generating dashboard data: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 🚨 Monitor critical metrics and send alerts
	 */
	async monitorCriticalMetrics(orgId?: number, branchId?: number): Promise<void> {
		this.logger.log(`🚨 [monitorCriticalMetrics] Monitoring critical business metrics`);

		try {
			const [inventoryMetrics, productInsights] = await Promise.all([
				this.getInventoryMetrics(orgId, branchId),
				this.getProductPerformanceInsights(orgId, branchId),
			]);

			const alerts = [];

			// Stock alerts
			if (inventoryMetrics.lowStockProducts > 0) {
				alerts.push({
					type: 'low_stock',
					severity: 'warning',
					message: `${inventoryMetrics.lowStockProducts} products are running low on stock`,
					action: 'Review and reorder inventory',
				});
			}

			if (inventoryMetrics.outOfStockProducts > 0) {
				alerts.push({
					type: 'out_of_stock',
					severity: 'critical',
					message: `${inventoryMetrics.outOfStockProducts} products are out of stock`,
					action: 'Immediate restocking required',
				});
			}

			// Performance alerts
			const criticalProducts = productInsights.filter(p => p.performance === 'critical');
			if (criticalProducts.length > 0) {
				alerts.push({
					type: 'poor_performance',
					severity: 'warning',
					message: `${criticalProducts.length} products have critical performance issues`,
					action: 'Review product strategies and optimize',
				});
			}

			// Slow-moving inventory alert
			if (inventoryMetrics.slowMovingProducts.length > 10) {
				alerts.push({
					type: 'slow_inventory',
					severity: 'warning',
					message: `${inventoryMetrics.slowMovingProducts.length} products are slow-moving`,
					action: 'Consider promotional campaigns or inventory reduction',
				});
			}

			// Emit alerts if any exist
			if (alerts.length > 0) {
				this.eventEmitter.emit('analytics.alerts.generated', {
					orgId,
					branchId,
					alerts,
					timestamp: new Date(),
				});

				this.logger.warn(`🚨 [monitorCriticalMetrics] Generated ${alerts.length} alerts`);
			} else {
				this.logger.log(`✅ [monitorCriticalMetrics] No critical issues detected`);
			}
		} catch (error) {
			this.logger.error(`❌ [monitorCriticalMetrics] Error monitoring metrics: ${error.message}`, error.stack);
		}
	}
} 