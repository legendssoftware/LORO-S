import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AnalyticsService } from './analytics.service';
import { Interval } from '@nestjs/schedule';
import { ShopGateway } from '../../shop/shop.gateway';

interface RealTimeMetrics {
	timestamp: Date;
	revenue: {
		today: number;
		thisWeek: number;
		thisMonth: number;
		changePercent: number;
	};
	orders: {
		pending: number;
		processing: number;
		completed: number;
		hourlyRate: number;
	};
	inventory: {
		lowStock: number;
		outOfStock: number;
		totalProducts: number;
		reorderAlerts: number;
	};
	performance: {
		topProduct: string;
		conversionRate: number;
		bounceRate: number;
		averageOrderValue: number;
	};
	alerts: Array<{
		type: string;
		severity: 'info' | 'warning' | 'error' | 'critical';
		message: string;
		timestamp: Date;
	}>;
}

@Injectable()
export class RealTimeAnalyticsService {
	private readonly logger = new Logger(RealTimeAnalyticsService.name);
	private metricsCache: Map<string, RealTimeMetrics> = new Map();
	private alertHistory: Array<any> = [];

	constructor(
		private readonly analyticsService: AnalyticsService,
		private readonly shopGateway: ShopGateway,
	) {}

	/**
	 * 📊 Generate real-time metrics for dashboard
	 */
	async generateRealTimeMetrics(orgId?: number, branchId?: number): Promise<RealTimeMetrics> {
		this.logger.log(`📊 [generateRealTimeMetrics] Generating real-time metrics for org: ${orgId}, branch: ${branchId}`);

		try {
			const now = new Date();
			const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
			const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
			const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

			// Get parallel data for performance
			const [
				todaySales,
				yesterdaySales,
				weekSales,
				monthSales,
				dashboardData,
			] = await Promise.all([
				this.analyticsService.getSalesMetrics(new Date(now.toDateString()), now, orgId, branchId),
				this.analyticsService.getSalesMetrics(yesterday, new Date(yesterday.toDateString() + ' 23:59:59'), orgId, branchId),
				this.analyticsService.getSalesMetrics(lastWeek, now, orgId, branchId),
				this.analyticsService.getSalesMetrics(lastMonth, now, orgId, branchId),
				this.analyticsService.getDashboardData(orgId, branchId),
			]);

			// Calculate revenue change percentage
			const changePercent = yesterdaySales.totalRevenue > 0
				? ((todaySales.totalRevenue - yesterdaySales.totalRevenue) / yesterdaySales.totalRevenue) * 100
				: 0;

			// Calculate hourly order rate
			const hoursToday = now.getHours() + 1;
			const hourlyRate = hoursToday > 0 ? todaySales.totalQuotations / hoursToday : 0;

			// Get top product
			const topProduct = todaySales.topProducts[0]?.productName || 'No sales today';

			// Create real-time metrics
			const metrics: RealTimeMetrics = {
				timestamp: now,
				revenue: {
					today: todaySales.totalRevenue,
					thisWeek: weekSales.totalRevenue,
					thisMonth: monthSales.totalRevenue,
					changePercent,
				},
				orders: {
					pending: dashboardData.sales.totalQuotations, // This would need actual pending count
					processing: 0, // Would need to query processing orders
					completed: dashboardData.sales.totalQuotations,
					hourlyRate,
				},
				inventory: {
					lowStock: dashboardData.inventory.lowStockProducts,
					outOfStock: dashboardData.inventory.outOfStockProducts,
					totalProducts: dashboardData.inventory.totalProducts,
					reorderAlerts: dashboardData.inventory.slowMovingProducts.length,
				},
				performance: {
					topProduct,
					conversionRate: dashboardData.customerBehavior.overallConversionRate,
					bounceRate: dashboardData.customerBehavior.bounceRate,
					averageOrderValue: todaySales.averageOrderValue,
				},
				alerts: this.getRecentAlerts(),
			};

			// Cache metrics for quick access
			const cacheKey = `${orgId || 'global'}-${branchId || 'all'}`;
			this.metricsCache.set(cacheKey, metrics);

			this.logger.log(`✅ [generateRealTimeMetrics] Generated metrics - Revenue today: ${metrics.revenue.today}`);
			return metrics;

		} catch (error) {
			this.logger.error(`❌ [generateRealTimeMetrics] Error generating real-time metrics: ${error.message}`, error.stack);
			throw error;
		}
	}

	/**
	 * 🔄 Automatic real-time updates every 30 seconds
	 */
	@Interval(30000) // 30 seconds
	async broadcastRealTimeUpdates(): Promise<void> {
		this.logger.debug(`🔄 [broadcastRealTimeUpdates] Broadcasting real-time updates`);

		try {
			// For now, broadcast for global metrics
			// In production, you'd iterate through active organizations/branches
			const metrics = await this.generateRealTimeMetrics();
			
			// Broadcast to all connected clients
			this.shopGateway.broadcastAnalyticsUpdate({
				type: 'real-time-metrics',
				data: metrics,
				timestamp: new Date(),
			});

			this.logger.debug(`✅ [broadcastRealTimeUpdates] Broadcasted real-time metrics`);
		} catch (error) {
			this.logger.error(`❌ [broadcastRealTimeUpdates] Error broadcasting updates: ${error.message}`);
		}
	}

	/**
	 * 📈 Monitor for significant changes and send alerts
	 */
	@Interval(60000) // 1 minute
	async monitorSignificantChanges(): Promise<void> {
		this.logger.debug(`📈 [monitorSignificantChanges] Monitoring for significant changes`);

		try {
			const currentMetrics = await this.generateRealTimeMetrics();
			
			// Check for significant changes
			const alerts = [];

			// Revenue spike detection
			if (Math.abs(currentMetrics.revenue.changePercent) > 50) {
				alerts.push({
					type: 'revenue_spike',
					severity: currentMetrics.revenue.changePercent > 0 ? 'info' : 'warning',
					message: `Revenue ${currentMetrics.revenue.changePercent > 0 ? 'increased' : 'decreased'} by ${Math.abs(currentMetrics.revenue.changePercent).toFixed(1)}% today`,
					timestamp: new Date(),
				});
			}

			// High order rate detection
			if (currentMetrics.orders.hourlyRate > 10) {
				alerts.push({
					type: 'high_order_rate',
					severity: 'info',
					message: `High order rate detected: ${currentMetrics.orders.hourlyRate.toFixed(1)} orders per hour`,
					timestamp: new Date(),
				});
			}

			// Critical inventory alerts
			if (currentMetrics.inventory.outOfStock > 0) {
				alerts.push({
					type: 'out_of_stock',
					severity: 'critical',
					message: `${currentMetrics.inventory.outOfStock} products are out of stock`,
					timestamp: new Date(),
				});
			}

			// Low conversion rate alert
			if (currentMetrics.performance.conversionRate < 1) {
				alerts.push({
					type: 'low_conversion',
					severity: 'warning',
					message: `Low conversion rate detected: ${currentMetrics.performance.conversionRate.toFixed(2)}%`,
					timestamp: new Date(),
				});
			}

			// Broadcast alerts if any
			if (alerts.length > 0) {
				this.alertHistory.push(...alerts);
				// Keep only last 100 alerts
				if (this.alertHistory.length > 100) {
					this.alertHistory = this.alertHistory.slice(-100);
				}

				this.shopGateway.broadcastAnalyticsUpdate({
					type: 'alerts',
					data: alerts,
					timestamp: new Date(),
				});

				this.logger.log(`🚨 [monitorSignificantChanges] Generated ${alerts.length} alerts`);
			}

		} catch (error) {
			this.logger.error(`❌ [monitorSignificantChanges] Error monitoring changes: ${error.message}`);
		}
	}

	/**
	 * 📊 Handle product view events for real-time tracking
	 */
	@OnEvent('product.viewed')
	async handleProductView(data: { productId: number; userId?: number; orgId?: number; branchId?: number }) {
		this.logger.debug(`👀 [handleProductView] Product ${data.productId} viewed by user ${data.userId}`);

		try {
			// Broadcast real-time view update
			this.shopGateway.broadcastAnalyticsUpdate({
				type: 'product-view',
				data: {
					productId: data.productId,
					timestamp: new Date(),
				},
				timestamp: new Date(),
			});

			// Update metrics cache if needed
			const cacheKey = `${data.orgId || 'global'}-${data.branchId || 'all'}`;
			if (this.metricsCache.has(cacheKey)) {
				// Trigger fresh metrics generation
				await this.generateRealTimeMetrics(data.orgId, data.branchId);
			}
		} catch (error) {
			this.logger.error(`❌ [handleProductView] Error handling product view: ${error.message}`);
		}
	}

	/**
	 * 🛒 Handle cart add events for real-time tracking
	 */
	@OnEvent('product.cart.added')
	async handleCartAdd(data: { productId: number; quantity: number; userId?: number; orgId?: number; branchId?: number }) {
		this.logger.debug(`🛒 [handleCartAdd] Product ${data.productId} added to cart (qty: ${data.quantity})`);

		try {
			// Broadcast real-time cart update
			this.shopGateway.broadcastAnalyticsUpdate({
				type: 'cart-add',
				data: {
					productId: data.productId,
					quantity: data.quantity,
					timestamp: new Date(),
				},
				timestamp: new Date(),
			});
		} catch (error) {
			this.logger.error(`❌ [handleCartAdd] Error handling cart add: ${error.message}`);
		}
	}

	/**
	 * 💰 Handle sale events for real-time tracking
	 */
	@OnEvent('product.sold')
	async handleProductSale(data: { productId: number; quantity: number; amount: number; orderId: string; orgId?: number; branchId?: number }) {
		this.logger.log(`💰 [handleProductSale] Product ${data.productId} sold - quantity: ${data.quantity}, amount: ${data.amount}`);

		try {
			// Broadcast real-time sale update
			this.shopGateway.broadcastAnalyticsUpdate({
				type: 'sale',
				data: {
					productId: data.productId,
					quantity: data.quantity,
					amount: data.amount,
					orderId: data.orderId,
					timestamp: new Date(),
				},
				timestamp: new Date(),
			});

			// Force refresh of metrics
			await this.generateRealTimeMetrics(data.orgId, data.branchId);

		} catch (error) {
			this.logger.error(`❌ [handleProductSale] Error handling product sale: ${error.message}`);
		}
	}

	/**
	 * 📦 Handle inventory events for real-time tracking
	 */
	@OnEvent('inventory.updated')
	async handleInventoryUpdate(data: { productId: number; oldQuantity: number; newQuantity: number; type: 'in' | 'out'; orgId?: number; branchId?: number }) {
		this.logger.debug(`📦 [handleInventoryUpdate] Inventory updated for product ${data.productId}: ${data.oldQuantity} → ${data.newQuantity}`);

		try {
			// Check for low stock alert
			const isLowStock = data.newQuantity <= 10; // Default reorder point
			const isOutOfStock = data.newQuantity <= 0;

			if (isOutOfStock || isLowStock) {
				const alert = {
					type: isOutOfStock ? 'out_of_stock' : 'low_stock',
					severity: isOutOfStock ? 'critical' : 'warning' as 'critical' | 'warning',
					message: `Product ${data.productId} is ${isOutOfStock ? 'out of stock' : 'low on stock'} (${data.newQuantity} remaining)`,
					timestamp: new Date(),
				};

				this.alertHistory.push(alert);
				
				this.shopGateway.broadcastAnalyticsUpdate({
					type: 'inventory-alert',
					data: alert,
					timestamp: new Date(),
				});
			}

			// Broadcast inventory update
			this.shopGateway.broadcastAnalyticsUpdate({
				type: 'inventory-update',
				data: {
					productId: data.productId,
					quantity: data.newQuantity,
					change: data.newQuantity - data.oldQuantity,
					type: data.type,
					timestamp: new Date(),
				},
				timestamp: new Date(),
			});

		} catch (error) {
			this.logger.error(`❌ [handleInventoryUpdate] Error handling inventory update: ${error.message}`);
		}
	}

	/**
	 * 🎯 Handle quotation events for real-time tracking
	 */
	@OnEvent('quotation.created')
	async handleQuotationCreated(data: { quotationId: string; amount: number; itemCount: number; clientId: number; orgId?: number; branchId?: number }) {
		this.logger.log(`🎯 [handleQuotationCreated] Quotation ${data.quotationId} created - amount: ${data.amount}`);

		try {
			// Broadcast real-time quotation update
			this.shopGateway.broadcastAnalyticsUpdate({
				type: 'quotation-created',
				data: {
					quotationId: data.quotationId,
					amount: data.amount,
					itemCount: data.itemCount,
					timestamp: new Date(),
				},
				timestamp: new Date(),
			});

			// Update real-time metrics
			await this.generateRealTimeMetrics(data.orgId, data.branchId);

		} catch (error) {
			this.logger.error(`❌ [handleQuotationCreated] Error handling quotation creation: ${error.message}`);
		}
	}

	/**
	 * 📄 Get cached metrics for quick access
	 */
	getCachedMetrics(orgId?: number, branchId?: number): RealTimeMetrics | null {
		const cacheKey = `${orgId || 'global'}-${branchId || 'all'}`;
		return this.metricsCache.get(cacheKey) || null;
	}

	/**
	 * 🚨 Get recent alerts
	 */
	private getRecentAlerts(): Array<any> {
		const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
		return this.alertHistory
			.filter(alert => alert.timestamp > oneHourAgo)
			.slice(-10); // Last 10 alerts
	}

	/**
	 * 📊 Get performance summary for dashboard
	 */
	async getPerformanceSummary(orgId?: number, branchId?: number) {
		try {
			const metrics = await this.generateRealTimeMetrics(orgId, branchId);
			
			return {
				revenue: {
					today: metrics.revenue.today,
					change: metrics.revenue.changePercent,
					trend: metrics.revenue.changePercent > 0 ? 'up' : metrics.revenue.changePercent < 0 ? 'down' : 'stable',
				},
				orders: {
					rate: metrics.orders.hourlyRate,
					total: metrics.orders.completed,
				},
				inventory: {
					issues: metrics.inventory.lowStock + metrics.inventory.outOfStock,
					alerts: metrics.inventory.reorderAlerts,
				},
				performance: {
					conversion: metrics.performance.conversionRate,
					avgOrder: metrics.performance.averageOrderValue,
				},
				alerts: metrics.alerts.length,
			};
		} catch (error) {
			this.logger.error(`❌ [getPerformanceSummary] Error getting performance summary: ${error.message}`);
			return null;
		}
	}
} 