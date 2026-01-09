import { Controller, Post, Logger } from '@nestjs/common';
import { ErpImporterService } from './erp-importer.service';
import { ImportSummary } from './interfaces/import-result.interface';

@Controller('erp-importer')
export class ErpImporterController {
	private readonly logger = new Logger(ErpImporterController.name);

	constructor(private readonly importerService: ErpImporterService) {}

	@Post('import')
	async triggerImport(): Promise<ImportSummary> {
		this.logger.log('Manual ERP import triggered');
		return await this.importerService.importForOrganizations();
	}
}
