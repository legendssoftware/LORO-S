import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
	private readonly logger = new Logger(AppService.name);

	constructor(
		@InjectDataSource()
		private dataSource: DataSource,
	) {}

	getHello(): string {
		return 'Hello World!';
	}

	/**
	 * Get database connection status
	 */
	getDatabaseStatus(): { 
		connected: boolean; 
		initialized: boolean; 
		poolSize?: number;
		activeConnections?: number;
	} {
		try {
			const driver = this.dataSource?.driver as any;
			const pool = driver?.pool;
			
			return {
				connected: this.dataSource?.isInitialized || false,
				initialized: this.dataSource?.isInitialized || false,
				poolSize: pool?.config?.connectionLimit || 'unknown',
				activeConnections: pool?._allConnections?.length || 'unknown',
			};
		} catch (error) {
			return {
				connected: false,
				initialized: false,
			};
		}
	}

	/**
	 * Manual database reconnection endpoint
	 */
	async forceReconnect(): Promise<{ success: boolean; message: string }> {
		try {
			if (this.dataSource.isInitialized) {
				await this.dataSource.destroy();
				this.logger.log('Existing connection destroyed');
			}
			
			await new Promise(resolve => setTimeout(resolve, 2000));
			await this.dataSource.initialize();
			
			return { success: true, message: 'Database reconnection successful' };
		} catch (error) {
			return { success: false, message: `Reconnection failed: ${error.message}` };
		}
	}
}
