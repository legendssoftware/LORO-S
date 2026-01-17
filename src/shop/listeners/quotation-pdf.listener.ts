import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quotation } from '../entities/quotation.entity';
import { ShopService } from '../shop.service';
import { EmailType } from '../../lib/enums/email.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventQueueService, EventPriority } from '../../lib/services/event-queue.service';

@Injectable()
export class QuotationPdfListener {
	private readonly logger = new Logger(QuotationPdfListener.name);

	constructor(
		@InjectRepository(Quotation)
		private quotationRepository: Repository<Quotation>,
		private readonly shopService: ShopService,
		private readonly eventEmitter: EventEmitter2,
		private readonly eventQueue: EventQueueService,
	) {}

	@OnEvent('quotation.pdf.generate')
	async handleQuotationPdfGeneration(data: {
		quotationId: number;
		quotationNumber: string;
		recipientEmail?: string;
		clientName?: string;
		reviewUrl?: string;
		totalAmount?: number;
		currency?: string;
		quotationItems?: any[];
	}) {
		const operationId = `PDF_GEN_${data.quotationId}_${Date.now()}`;
		this.logger.log(`[${operationId}] Starting PDF generation for quotation ${data.quotationNumber}`);

		try {
			// Get full quotation with all relations
			const fullQuotation = await this.quotationRepository.findOne({
				where: { uid: data.quotationId },
				relations: [
					'placedBy',
					'client',
					'quotationItems',
					'quotationItems.product',
					'organisation',
					'branch',
					'project',
				],
			});

			if (!fullQuotation) {
				this.logger.error(`[${operationId}] Quotation ${data.quotationId} not found`);
				return;
			}

			// Generate PDF
			const pdfUrl = await this.shopService['generateQuotationPDF'](fullQuotation);

			if (pdfUrl) {
				// Update quotation with PDF URL
				await this.quotationRepository.update(data.quotationId, { pdfURL: pdfUrl });
				this.logger.log(`[${operationId}] PDF generated successfully: ${pdfUrl}`);

				// Send email if recipient email is provided
				if (data.recipientEmail) {
					// Queue email sending with retry mechanism
					await this.eventQueue.queueEvent(
						'send.email',
						{
							type: EmailType.NEW_QUOTATION_CLIENT,
							recipients: [data.recipientEmail],
							data: {
								name: data.clientName || fullQuotation.client?.name || 'Client',
								quotationId: data.quotationNumber,
								pdfUrl: pdfUrl,
								reviewUrl: data.reviewUrl || fullQuotation.reviewUrl,
								total: data.totalAmount || Number(fullQuotation.totalAmount),
								currency: data.currency || fullQuotation.currency || 'ZAR',
								quotationItems: data.quotationItems || [],
							},
						},
						EventPriority.NORMAL,
						{
							maxAttempts: 3,
							retryDelay: 2000,
						},
					);
				}
			} else {
				this.logger.warn(`[${operationId}] PDF generation returned null for quotation ${data.quotationNumber}`);
			}
		} catch (error) {
			this.logger.error(
				`[${operationId}] Error generating PDF for quotation ${data.quotationNumber}: ${error.message}`,
				error.stack,
			);
			// Event queue will handle retry automatically
			throw error;
		}
	}
}
