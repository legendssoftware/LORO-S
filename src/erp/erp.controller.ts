import { Controller, Get, Post, Query, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ErpHealthIndicator } from './erp.health';
import { ErpCacheWarmerService } from './services/erp-cache-warmer.service';
import { ErpDataService } from './services/erp-data.service';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';

/**
 * ERP Controller
 * 
 * Provides endpoints for ERP database health checks, cache management,
 * and administrative functions.
 */
@ApiTags('📊 Reports')
@Controller('erp')
@UseGuards(AuthGuard, RoleGuard)
@ApiBearerAuth()
export class ErpController {
	private readonly logger = new Logger(ErpController.name);

	constructor(
		private readonly erpHealthIndicator: ErpHealthIndicator,
		private readonly erpCacheWarmerService: ErpCacheWarmerService,
		private readonly erpDataService: ErpDataService,
	) {}

	/**
	 * Get ERP health status
	 */
	@Get('health')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Check ERP database health' })
	@ApiResponse({ status: 200, description: 'ERP health status' })
	async getHealth() {
		try {
			const health = await this.erpHealthIndicator.isHealthy();
			return {
				success: health.status === 'up',
				erp: health,
			};
		} catch (error) {
			this.logger.error(`Health check error: ${error.message}`);
			return {
				success: false,
				error: error.message,
			};
		}
	}

	/**
	 * Get detailed ERP statistics
	 */
	@Get('stats')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Get detailed ERP statistics' })
	@ApiResponse({ status: 200, description: 'ERP statistics' })
	async getStats() {
		try {
			const stats = await this.erpHealthIndicator.getErpStats();
			return {
				success: true,
				data: stats,
			};
		} catch (error) {
			this.logger.error(`Stats error: ${error.message}`);
			return {
				success: false,
				error: error.message,
			};
		}
	}

	/**
	 * Trigger cache warming
	 */
	@Post('cache/warm')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Manually trigger cache warming' })
	@ApiResponse({ status: 200, description: 'Cache warming triggered' })
	async warmCache() {
		try {
			const result = await this.erpCacheWarmerService.triggerCacheWarming();
			return result;
		} catch (error) {
			this.logger.error(`Cache warming error: ${error.message}`);
			return {
				success: false,
				message: error.message,
			};
		}
	}

	/**
	 * Clear and refresh cache
	 */
	@Post('cache/refresh')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Clear and refresh ERP cache' })
	@ApiResponse({ status: 200, description: 'Cache refreshed' })
	async refreshCache() {
		try {
			const result = await this.erpCacheWarmerService.refreshCache();
			return result;
		} catch (error) {
			this.logger.error(`Cache refresh error: ${error.message}`);
			return {
				success: false,
				message: error.message,
			};
		}
	}

	/**
	 * Clear cache for specific date range
	 */
	@Post('cache/clear')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Clear cache for specific date range' })
	@ApiQuery({ name: 'startDate', required: false, example: '2024-01-01' })
	@ApiQuery({ name: 'endDate', required: false, example: '2024-01-31' })
	@ApiResponse({ status: 200, description: 'Cache cleared' })
	async clearCache(
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	) {
		try {
			await this.erpDataService.clearCache(startDate, endDate);
			return {
				success: true,
				message: startDate && endDate
					? `Cache cleared for ${startDate} to ${endDate}`
					: 'All cache cleared',
			};
		} catch (error) {
			this.logger.error(`Cache clear error: ${error.message}`);
			return {
				success: false,
				message: error.message,
			};
		}
	}

	/**
	 * Get cache statistics
	 */
	@Get('cache/stats')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.MANAGER)
	@ApiOperation({ summary: 'Get cache statistics' })
	@ApiResponse({ status: 200, description: 'Cache statistics' })
	async getCacheStats() {
		try {
			const stats = await this.erpDataService.getCacheStats();
			return {
				success: true,
				data: stats,
			};
		} catch (error) {
			this.logger.error(`Cache stats error: ${error.message}`);
			return {
				success: false,
				error: error.message,
			};
		}
	}
}

