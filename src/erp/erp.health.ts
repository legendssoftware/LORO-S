import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TblSalesLines } from './entities/tblsaleslines.entity';
import { TblSalesHeader } from './entities/tblsalesheader.entity';

/**
 * ERP Health Status Interface
 */
export interface ErpHealthStatus {
	status: 'up' | 'down';
	connection?: string;
	lastSaleDate?: string | null;
	dataAgeDays?: number;
	queryTimeMs?: number;
	recordCount?: number;
	message?: string;
	issues?: string[];
}

/**
 * ERP Health Indicator
 * 
 * Checks the health of the ERP database connection and data freshness.
 */
@Injectable()
export class ErpHealthIndicator {
	private readonly logger = new Logger(ErpHealthIndicator.name);

	constructor(
		@InjectRepository(TblSalesLines, 'erp')
		private salesLinesRepo: Repository<TblSalesLines>,
		@InjectRepository(TblSalesHeader, 'erp')
		private salesHeaderRepo: Repository<TblSalesHeader>,
	) {}

	/**
	 * Check if ERP database is healthy
	 */
	async isHealthy(): Promise<ErpHealthStatus> {
		this.logger.log('===== ERP Health Check Started =====');
		const startTime = Date.now();
		
		try {
			// Test 1: Connection check - simple query
			this.logger.log('Running connection check...');
			const connectionCheck = await this.checkConnection();
			this.logger.log(`Connection check: ${connectionCheck.connected ? '✅ PASS' : '❌ FAIL'}`);
			
			// Test 2: Data freshness check - check latest sale date
			this.logger.log('Running data freshness check...');
			const dataFreshnessCheck = await this.checkDataFreshness();
			this.logger.log(`Data freshness check: ${dataFreshnessCheck.isFresh ? '✅ PASS' : '❌ FAIL'}`);
			this.logger.log(`  Last sale date: ${dataFreshnessCheck.lastSaleDate || 'N/A'}`);
			this.logger.log(`  Data age: ${dataFreshnessCheck.dataAgeDays} days`);
			
			// Test 3: Query performance check - measure response time
			this.logger.log('Running query performance check...');
			const performanceCheck = await this.checkQueryPerformance();
			this.logger.log(`Query performance check: ${performanceCheck.performant ? '✅ PASS' : '❌ FAIL'}`);
			this.logger.log(`  Query time: ${performanceCheck.queryTimeMs}ms`);

			const isHealthy = 
				connectionCheck.connected && 
				dataFreshnessCheck.isFresh && 
				performanceCheck.performant;

			const duration = Date.now() - startTime;
			
			if (isHealthy) {
				this.logger.log(`===== ERP Health Check: ✅ HEALTHY (${duration}ms) =====`);
				return {
					status: 'up',
					connection: 'connected',
					lastSaleDate: dataFreshnessCheck.lastSaleDate,
					dataAgeDays: dataFreshnessCheck.dataAgeDays,
					queryTimeMs: performanceCheck.queryTimeMs,
					recordCount: dataFreshnessCheck.recordCount,
				};
			} else {
				const issues = [
					!connectionCheck.connected && 'Connection failed',
					!dataFreshnessCheck.isFresh && 'Data is stale',
					!performanceCheck.performant && 'Slow query performance',
				].filter(Boolean) as string[];
				
				this.logger.warn(`===== ERP Health Check: ⚠️ UNHEALTHY (${duration}ms) =====`);
				this.logger.warn(`Issues: ${issues.join(', ')}`);
				
				return {
					status: 'down',
					connection: connectionCheck.connected ? 'connected' : 'disconnected',
					lastSaleDate: dataFreshnessCheck.lastSaleDate,
					dataAgeDays: dataFreshnessCheck.dataAgeDays,
					queryTimeMs: performanceCheck.queryTimeMs,
					issues,
				};
			}
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`===== ERP Health Check: ❌ FAILED (${duration}ms) =====`);
			this.logger.error(`Error: ${error.message}`);
			this.logger.error(`Stack: ${error.stack}`);
			return {
				status: 'down',
				message: error.message,
			};
		}
	}

	/**
	 * Check database connection
	 */
	private async checkConnection(): Promise<{ connected: boolean; error?: string }> {
		const startTime = Date.now();
		try {
			this.logger.debug('Testing database connection with simple count query...');
			// Simple count query to test connection
			await this.salesLinesRepo.count({ take: 1 });
			const duration = Date.now() - startTime;
			this.logger.debug(`Connection test successful (${duration}ms)`);
			return { connected: true };
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logger.error(`Connection check failed (${duration}ms): ${error.message}`);
			this.logger.error(`Error code: ${error.code || 'N/A'}`);
			this.logger.error(`Error errno: ${error.errno || 'N/A'}`);
			return { connected: false, error: error.message };
		}
	}

	/**
	 * Check data freshness - ensure data is recent
	 */
	private async checkDataFreshness(): Promise<{
		isFresh: boolean;
		lastSaleDate: string | null;
		dataAgeDays: number;
		recordCount: number;
	}> {
		try {
			// Get the most recent sale date
			const result = await this.salesLinesRepo
				.createQueryBuilder('line')
				.select('MAX(line.sale_date)', 'lastSaleDate')
				.addSelect('COUNT(*)', 'recordCount')
				.getRawOne();

			const lastSaleDate = result?.lastSaleDate || null;
			const recordCount = parseInt(result?.recordCount || '0', 10);

			if (!lastSaleDate) {
				return {
					isFresh: false,
					lastSaleDate: null,
					dataAgeDays: -1,
					recordCount: 0,
				};
			}

			// Calculate data age in days
			const lastDate = new Date(lastSaleDate);
			const today = new Date();
			const dataAgeDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

			// Consider data fresh if it's less than 7 days old
			const isFresh = dataAgeDays <= 7;

			return {
				isFresh,
				lastSaleDate: lastDate.toISOString().split('T')[0],
				dataAgeDays,
				recordCount,
			};
		} catch (error) {
			this.logger.error(`Data freshness check failed: ${error.message}`);
			return {
				isFresh: false,
				lastSaleDate: null,
				dataAgeDays: -1,
				recordCount: 0,
			};
		}
	}

	/**
	 * Check query performance
	 */
	private async checkQueryPerformance(): Promise<{
		performant: boolean;
		queryTimeMs: number;
	}> {
		try {
			const startTime = Date.now();
			
			// Run a typical aggregation query
			const today = new Date();
			const thirtyDaysAgo = new Date();
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

			await this.salesLinesRepo
				.createQueryBuilder('line')
				.select('line.store')
				.addSelect('COUNT(*)', 'count')
				.where('line.sale_date >= :startDate', { startDate: thirtyDaysAgo.toISOString().split('T')[0] })
				.andWhere('line.sale_date <= :endDate', { endDate: today.toISOString().split('T')[0] })
				.groupBy('line.store')
				.limit(10)
				.getRawMany();

			const queryTimeMs = Date.now() - startTime;

			// Consider performant if query completes in less than 5 seconds
			const performant = queryTimeMs < 5000;

			return {
				performant,
				queryTimeMs,
			};
		} catch (error) {
			this.logger.error(`Query performance check failed: ${error.message}`);
			return {
				performant: false,
				queryTimeMs: -1,
			};
		}
	}

	/**
	 * Get detailed ERP statistics
	 */
	async getErpStats(): Promise<{
		connectionStatus: string;
		totalRecords: number;
		lastSaleDate: string | null;
		dataAgeDays: number;
		storeCount: number;
		dateRange: {
			earliest: string | null;
			latest: string | null;
		};
	}> {
		try {
			// Get connection status
			const connectionCheck = await this.checkConnection();
			
			if (!connectionCheck.connected) {
				return {
					connectionStatus: 'disconnected',
					totalRecords: 0,
					lastSaleDate: null,
					dataAgeDays: -1,
					storeCount: 0,
					dateRange: { earliest: null, latest: null },
				};
			}

			// Get statistics
			const statsResult = await this.salesLinesRepo
				.createQueryBuilder('line')
				.select('COUNT(*)', 'totalRecords')
				.addSelect('MIN(line.sale_date)', 'earliestDate')
				.addSelect('MAX(line.sale_date)', 'latestDate')
				.addSelect('COUNT(DISTINCT line.store)', 'storeCount')
				.getRawOne();

			const latestDate = statsResult?.latestDate ? new Date(statsResult.latestDate) : null;
			const earliestDate = statsResult?.earliestDate ? new Date(statsResult.earliestDate) : null;
			const today = new Date();
			const dataAgeDays = latestDate 
				? Math.floor((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24))
				: -1;

			return {
				connectionStatus: 'connected',
				totalRecords: parseInt(statsResult?.totalRecords || '0', 10),
				lastSaleDate: latestDate ? latestDate.toISOString().split('T')[0] : null,
				dataAgeDays,
				storeCount: parseInt(statsResult?.storeCount || '0', 10),
				dateRange: {
					earliest: earliestDate ? earliestDate.toISOString().split('T')[0] : null,
					latest: latestDate ? latestDate.toISOString().split('T')[0] : null,
				},
			};
		} catch (error) {
			this.logger.error(`Error getting ERP stats: ${error.message}`);
			throw error;
		}
	}
}

