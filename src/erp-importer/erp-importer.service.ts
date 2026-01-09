import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErpProductImporterService } from './services/erp-product-importer.service';
import { ErpClientImporterService } from './services/erp-client-importer.service';
import { ImportSummary } from './interfaces/import-result.interface';

@Injectable()
export class ErpImporterService {
	private readonly logger = new Logger(ErpImporterService.name);

	constructor(
		private readonly productImporter: ErpProductImporterService,
		private readonly clientImporter: ErpClientImporterService,
		private readonly configService: ConfigService,
	) {}

	async importForOrganizations(): Promise<ImportSummary> {
		const orgIds = this.getImportOrgIds();
		this.logger.log(`Starting import for organizations: ${orgIds.join(', ')}`);

		const summary: ImportSummary = {
			products: { created: 0, updated: 0, skipped: 0, errors: [] },
			clients: { created: 0, updated: 0, skipped: 0, errors: [] },
			timestamp: new Date(),
		};

		for (const orgId of orgIds) {
			try {
				// Default branch ID is same as org ID (org 2 -> branch 2)
				const branchId = orgId;
				const countryCode = 'SA'; // Default to SA, can be enhanced later

				this.logger.log(`Importing for org ${orgId}, branch ${branchId}`);

				// Import products
				const productResult = await this.productImporter.importProducts(
					orgId,
					branchId,
					countryCode,
				);
				summary.products.created += productResult.created;
				summary.products.updated += productResult.updated;
				summary.products.skipped += productResult.skipped;
				summary.products.errors.push(...productResult.errors);

				// Import clients
				const clientResult = await this.clientImporter.importClients(
					orgId,
					branchId,
					countryCode,
				);
				summary.clients.created += clientResult.created;
				summary.clients.updated += clientResult.updated;
				summary.clients.skipped += clientResult.skipped;
				summary.clients.errors.push(...clientResult.errors);
			} catch (error) {
				this.logger.error(`Failed to import for org ${orgId}: ${error.message}`, error.stack);
			}
		}

		this.logger.log(`Import completed: ${JSON.stringify(summary)}`);
		return summary;
	}

	private getImportOrgIds(): number[] {
		const envValue = this.configService.get<string>('EXTERNAL_IMPORTER');
		if (!envValue) return [];

		try {
			// Parse "[1,2,3]" or "1,2,3" format
			const cleaned = envValue.trim().replace(/^\[|\]$/g, '');
			return cleaned.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
		} catch (error) {
			this.logger.error(`Failed to parse EXTERNAL_IMPORTER: ${envValue}`, error.stack);
			return [];
		}
	}
}
