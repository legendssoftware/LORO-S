import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { CreatePdfGenerationDto } from './dto/create-pdf-generation.dto';
// Use CommonJS require for PDFKit
const PDFDocument = require('pdfkit');
import { generateQuotationPDF } from './templates/quotation';
import { generateCheckInsReportPDF } from './templates/check-ins-report';
import { StorageService, StorageFile } from '../lib/services/storage.service';
import { QuotationTemplateData } from './interfaces/pdf-templates.interface';

@Injectable()
export class PdfGenerationService {
	private readonly logger = new Logger(PdfGenerationService.name);

	constructor(private readonly storageService: StorageService) {}

	/**
	 * Generate a PDF from a template and data, then upload to cloud storage
	 * @param createPdfGenerationDto DTO containing template name and data
	 * @returns Object containing the URL of the uploaded PDF
	 */
	async create(createPdfGenerationDto: CreatePdfGenerationDto) {
		const startTime = Date.now();
		this.logger.log(`[create] Starting PDF generation - Template: ${createPdfGenerationDto?.template}`);

		try {
			// Enhanced validation with logging
			if (!createPdfGenerationDto) {
				this.logger.error('[create] DTO is null or undefined');
				throw new BadRequestException('PDF generation data is required');
			}

			const { template, data } = createPdfGenerationDto;

			if (!template || typeof template !== 'string' || template.trim() === '') {
				this.logger.error(`[create] Invalid template name: ${template}`);
				throw new BadRequestException('Valid template name is required');
			}

			if (!data || typeof data !== 'object') {
				this.logger.error(`[create] Invalid data object: ${typeof data}`);
				throw new BadRequestException('Valid data object is required for PDF generation');
			}

			this.logger.log(`[create] Validation passed - Template: ${template}, Data keys: ${Object.keys(data).length}`);

			// Enhanced data validation for quotation template
			if (template.toLowerCase() === 'quotation') {
				const quotationData = data as QuotationTemplateData;
				this.validateQuotationData(quotationData);
			}

			// Generate the PDF with enhanced error handling
			let pdfBuffer: Buffer;
			try {
				this.logger.log(`[create] Generating PDF from template: ${template}`);
				pdfBuffer = await this.generatePdfFromTemplate(template, data);
				this.logger.log(`[create] PDF buffer generated successfully - Size: ${pdfBuffer.length} bytes`);
			} catch (pdfError) {
				this.logger.error(`[create] PDF generation failed: ${pdfError.message}`, pdfError.stack);
				throw new BadRequestException(`PDF template generation failed: ${pdfError.message}`);
			}

			// Validate PDF buffer
			if (!pdfBuffer || pdfBuffer.length === 0) {
				this.logger.error('[create] Generated PDF buffer is empty');
				throw new BadRequestException('Generated PDF is empty');
			}

			// Generate a secure filename with template validation
			const sanitizedTemplate = template.replace(/[^a-zA-Z0-9]/g, '_');
			const fileName = `${sanitizedTemplate}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.pdf`;
			this.logger.log(`[create] Generated filename: ${fileName}`);

			// Upload to cloud storage with enhanced error handling
			let uploadResult;
			try {
				this.logger.log(`[create] Uploading PDF to storage - Size: ${pdfBuffer.length} bytes`);
				uploadResult = await this.uploadPdfToStorage(pdfBuffer, fileName);
				this.logger.log(`[create] Upload successful - URL: ${uploadResult.publicUrl}`);
			} catch (uploadError) {
				this.logger.error(`[create] Storage upload failed: ${uploadError.message}`, uploadError.stack);
				throw new BadRequestException(`Failed to upload PDF to storage: ${uploadError.message}`);
			}

			// Validate upload result
			if (!uploadResult?.publicUrl) {
				this.logger.error('[create] Upload result missing public URL');
				throw new BadRequestException('PDF upload completed but no URL returned');
			}

			const totalTime = Date.now() - startTime;
			this.logger.log(`[create] PDF generation completed successfully in ${totalTime}ms - URL: ${uploadResult.publicUrl}`);

			return {
				success: true,
				message: 'PDF generated and uploaded successfully',
				url: uploadResult.publicUrl,
				fileName: uploadResult.fileName || fileName,
				size: pdfBuffer.length,
				generationTime: totalTime,
			};

		} catch (error) {
			const totalTime = Date.now() - startTime;
			this.logger.error(`[create] PDF generation failed after ${totalTime}ms: ${error.message}`, error.stack);
			
			// Re-throw BadRequestException as-is, wrap others
			if (error instanceof BadRequestException) {
				throw error;
			}
			
			throw new BadRequestException(`Failed to generate PDF: ${error.message}`);
		}
	}

	/**
	 * Validate quotation data for PDF generation
	 * @param data Quotation template data to validate
	 */
	private validateQuotationData(data: QuotationTemplateData): void {
		this.logger.log(`[validateQuotationData] Validating quotation data`);

		// Validate required fields with fallbacks
		if (!data.quotationId || typeof data.quotationId !== 'string') {
			this.logger.warn(`[validateQuotationData] Invalid quotationId: ${data.quotationId}`);
			// Allow validation to continue as the calling method will handle fallbacks
		}

		if (!data.companyDetails) {
			this.logger.warn(`[validateQuotationData] Missing company details`);
		} else {
			if (!data.companyDetails.name || typeof data.companyDetails.name !== 'string') {
				this.logger.warn(`[validateQuotationData] Invalid company name: ${data.companyDetails.name}`);
			}
		}

		if (!data.client) {
			this.logger.warn(`[validateQuotationData] Missing client information`);
		} else {
			if (!data.client.name || typeof data.client.name !== 'string') {
				this.logger.warn(`[validateQuotationData] Invalid client name: ${data.client.name}`);
			}
		}

		if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
			this.logger.error(`[validateQuotationData] Invalid or empty items array: ${data.items?.length || 0}`);
			throw new BadRequestException('Quotation must have at least one item');
		}

		// Validate each item
		for (let i = 0; i < data.items.length; i++) {
			const item = data.items[i];
			if (!item?.description) {
				this.logger.warn(`[validateQuotationData] Item ${i} missing description`);
			}
			if (typeof item?.quantity !== 'number' || item.quantity <= 0) {
				this.logger.warn(`[validateQuotationData] Item ${i} has invalid quantity: ${item?.quantity}`);
			}
			if (typeof item?.unitPrice !== 'number' || item.unitPrice < 0) {
				this.logger.warn(`[validateQuotationData] Item ${i} has invalid unit price: ${item?.unitPrice}`);
			}
		}

		// Validate financial data
		if (typeof data.total !== 'number' || data.total < 0) {
			this.logger.warn(`[validateQuotationData] Invalid total amount: ${data.total}`);
		}

		if (!data.currency || typeof data.currency !== 'string') {
			this.logger.warn(`[validateQuotationData] Invalid currency: ${data.currency}`);
		}

		this.logger.log(`[validateQuotationData] Validation completed for quotation ${data.quotationId}`);
	}

	/**
	 * Generate a PDF in memory using PDFKit based on template and data
	 * @param templateName Name of the template to use
	 * @param data Data to populate the template with
	 * @returns Buffer containing the generated PDF
	 */
	private async generatePdfFromTemplate(templateName: string, data: any): Promise<Buffer> {
		const templateStartTime = Date.now();
		this.logger.log(`[generatePdfFromTemplate] Starting template generation - Template: ${templateName}`);

		return new Promise((resolve, reject) => {
			try {
				// Enhanced template validation
				if (!templateName || typeof templateName !== 'string') {
					throw new Error('Invalid template name provided');
				}

				if (!data || typeof data !== 'object') {
					throw new Error('Invalid template data provided');
				}

				this.logger.log(`[generatePdfFromTemplate] Creating PDF document for template: ${templateName}`);

				// Create PDF document with enhanced metadata
				const doc = new PDFDocument({
					size: 'A4',
					margin: 50,
					info: {
						Title: `${templateName.charAt(0).toUpperCase() + templateName.slice(1)} Document`,
						Creator: 'Loro PDF Service',
						Producer: 'PDFKit',
						Author: data?.companyDetails?.name || 'Loro',
						Subject: `Generated ${templateName}`,
						Keywords: `${templateName}, document, loro`,
						CreationDate: new Date(),
					},
				});

				// Accumulate PDF data in chunks with error handling
				const chunks: Buffer[] = [];
				let totalSize = 0;

				doc.on('data', (chunk) => {
					chunks.push(chunk);
					totalSize += chunk.length;
				});

				doc.on('end', () => {
					const templateTime = Date.now() - templateStartTime;
					this.logger.log(`[generatePdfFromTemplate] PDF generation completed in ${templateTime}ms - Total size: ${totalSize} bytes`);
					resolve(Buffer.concat(chunks));
				});

				doc.on('error', (error) => {
					const templateTime = Date.now() - templateStartTime;
					this.logger.error(`[generatePdfFromTemplate] PDF document error after ${templateTime}ms: ${error.message}`);
					reject(error);
				});

				// Enhanced template processing with specific error handling
				try {
					this.logger.log(`[generatePdfFromTemplate] Processing template: ${templateName}`);

					switch (templateName.toLowerCase()) {
						case 'quotation':
							this.logger.log(`[generatePdfFromTemplate] Generating quotation PDF for ID: ${data?.quotationId || 'UNKNOWN'}`);
							generateQuotationPDF(doc, data as QuotationTemplateData);
							break;
						case 'check-ins-report':
							this.logger.log(`[generatePdfFromTemplate] Generating check-ins report PDF`);
							generateCheckInsReportPDF(doc, data as any);
							break;
						default:
							throw new Error(`Template '${templateName}' is not supported. Available templates: quotation, check-ins-report`);
					}

					this.logger.log(`[generatePdfFromTemplate] Template processing completed, finalizing document`);
				} catch (templateError) {
					this.logger.error(`[generatePdfFromTemplate] Template processing failed: ${templateError.message}`, templateError.stack);
					throw new Error(`Template processing failed: ${templateError.message}`);
				}

				// Finalize the PDF with timeout protection
				setTimeout(() => {
					this.logger.log(`[generatePdfFromTemplate] Finalizing PDF document`);
					doc.end();
				}, 10); // Small delay to ensure template processing is complete

			} catch (error) {
				const templateTime = Date.now() - templateStartTime;
				this.logger.error(`[generatePdfFromTemplate] PDF generation failed after ${templateTime}ms: ${error.message}`, error.stack);
				reject(error);
			}
		});
	}

	/**
	 * Upload a PDF buffer to cloud storage
	 * @param pdfBuffer Buffer containing the PDF data
	 * @param fileName Name to give the file
	 * @returns Upload result including public URL
	 */
	private async uploadPdfToStorage(pdfBuffer: Buffer, fileName: string) {
		const uploadStartTime = Date.now();
		this.logger.log(`[uploadPdfToStorage] Starting upload - File: ${fileName}, Size: ${pdfBuffer?.length || 0} bytes`);

		try {
			// Enhanced validation
			if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
				throw new Error('Invalid PDF buffer provided');
			}

			if (pdfBuffer.length === 0) {
				throw new Error('PDF buffer is empty');
			}

			if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
				throw new Error('Valid filename is required');
			}

			// Validate PDF buffer starts with PDF signature
			const pdfSignature = pdfBuffer.slice(0, 4).toString();
			if (!pdfSignature.startsWith('%PDF')) {
				this.logger.warn(`[uploadPdfToStorage] Buffer may not be a valid PDF - Signature: ${pdfSignature}`);
			}

			// Sanitize filename further
			const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
			this.logger.log(`[uploadPdfToStorage] Sanitized filename: ${sanitizedFileName}`);

			// Prepare storage file with comprehensive metadata
			const file: StorageFile = {
				buffer: pdfBuffer,
				mimetype: 'application/pdf',
				originalname: sanitizedFileName,
				size: pdfBuffer.length,
				metadata: {
					type: 'pdf',
					generatedBy: 'pdf-generation-service',
					uploadTimestamp: new Date().toISOString(),
					bufferSize: pdfBuffer.length.toString(),
					contentType: 'application/pdf',
				},
			};

			this.logger.log(`[uploadPdfToStorage] Uploading to storage service`);

			// Perform upload with error handling
			let uploadResult;
			try {
				uploadResult = await this.storageService.upload(file);
			} catch (storageError) {
				this.logger.error(`[uploadPdfToStorage] Storage service error: ${storageError.message}`, storageError.stack);
				throw new Error(`Storage upload failed: ${storageError.message}`);
			}

			// Validate upload result
			if (!uploadResult) {
				throw new Error('Storage service returned null result');
			}

			if (!uploadResult.publicUrl) {
				this.logger.error(`[uploadPdfToStorage] Upload result missing public URL: ${JSON.stringify(uploadResult)}`);
				throw new Error('Upload completed but no public URL returned');
			}

			const uploadTime = Date.now() - uploadStartTime;
			this.logger.log(`[uploadPdfToStorage] Upload completed successfully in ${uploadTime}ms - URL: ${uploadResult.publicUrl}`);

			return {
				...uploadResult,
				uploadTime: uploadTime,
				originalSize: pdfBuffer.length,
			};

		} catch (error) {
			const uploadTime = Date.now() - uploadStartTime;
			this.logger.error(`[uploadPdfToStorage] Upload failed after ${uploadTime}ms: ${error.message}`, error.stack);
			throw error;
		}
	}

	findAll() {
		return `This action returns all pdfGeneration`;
	}

	findOne(id: number) {
		return `This action returns a #${id} pdfGeneration`;
	}

	remove(id: number) {
		return `This action removes a #${id} pdfGeneration`;
	}
}
