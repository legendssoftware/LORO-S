import { Controller, Post, Logger, UseGuards } from '@nestjs/common';
import { ErpImporterService } from './erp-importer.service';
import { ImportSummary } from './interfaces/import-result.interface';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBearerAuth, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiInternalServerErrorResponse } from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';

@ApiBearerAuth('JWT-auth')
@ApiTags('📥 ERP Importer')
@Controller('erp-importer')
@UseGuards(ClerkAuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ 
	description: '🔒 Unauthorized - Authentication required',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Authentication token is required' },
			error: { type: 'string', example: 'Unauthorized' },
			statusCode: { type: 'number', example: 401 }
		}
	}
})
export class ErpImporterController {
	private readonly logger = new Logger(ErpImporterController.name);

	constructor(private readonly importerService: ErpImporterService) {}

	@Post('import')
	@Roles(AccessLevel.ADMIN, AccessLevel.OWNER, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '🚀 Trigger manual ERP data import',
		description: createApiDescription(
			'Manually triggers the ERP data import process for all configured organizations.',
			'This endpoint initiates a comprehensive import process that synchronizes data from external ERP systems into the Loro platform. The service method `ErpImporterService.importForOrganizations()` processes imports for all active organizations, validates data integrity, handles errors gracefully, and provides detailed import summaries.',
			'ErpImporterService',
			'importForOrganizations',
			'processes ERP data imports for all organizations, validates data, and handles synchronization',
			'an ImportSummary object containing import statistics, success/failure counts, and detailed results',
			['Multi-organization processing', 'Data validation', 'Error handling', 'Import statistics tracking']
		),
	})
	@ApiOkResponse({
		description: '✅ ERP import triggered successfully',
		schema: {
			type: 'object',
			properties: {
				totalOrganizations: { type: 'number', example: 5, description: 'Total number of organizations processed' },
				successfulImports: { type: 'number', example: 4, description: 'Number of successful imports' },
				failedImports: { type: 'number', example: 1, description: 'Number of failed imports' },
				startTime: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
				endTime: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
				duration: { type: 'number', example: 12500, description: 'Import duration in milliseconds' },
				results: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							organizationId: { type: 'number', example: 1 },
							organizationName: { type: 'string', example: 'Acme Corporation' },
							success: { type: 'boolean', example: true },
							recordsImported: { type: 'number', example: 1250 },
							errors: { type: 'array', items: { type: 'string' } },
							importDate: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
						}
					}
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Admin/Developer access required',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Only administrators and developers can trigger ERP imports' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Import process failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'ERP import process encountered an error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
			}
		}
	})
	async triggerImport(): Promise<ImportSummary> {
		this.logger.log('Manual ERP import triggered');
		return await this.importerService.importForOrganizations();
	}
}
