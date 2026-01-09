import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ErpImporterService } from './erp-importer.service';

@Injectable()
export class ErpImporterScheduler {
	private readonly logger = new Logger(ErpImporterScheduler.name);

	constructor(
		private readonly importerService: ErpImporterService,
		private readonly configService: ConfigService,
	) {}

	@Cron('0 5 * * *') // Daily at 5 AM
	async handleCron() {
		const enabled = this.configService.get<string>('ERP_IMPORT_ENABLED') === 'true';
		
		if (!enabled) {
			this.logger.log('ERP Import is disabled (ERP_IMPORT_ENABLED != true)');
			return;
		}

		this.logger.log('Starting scheduled ERP import (5 AM daily)...');
		
		try {
			const summary = await this.importerService.importForOrganizations();
			this.logger.log(`Scheduled ERP import completed: ${JSON.stringify(summary)}`);
		} catch (error) {
			this.logger.error(`Scheduled ERP import failed: ${error.message}`, error.stack);
		}
	}
}
