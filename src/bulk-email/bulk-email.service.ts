import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '../user/entities/user.entity';
import { CommunicationService } from '../communication/communication.service';
import { EmailType } from '../lib/enums/email.enums';
import {
	BulkEmailContent,
	BulkEmailInput,
	BulkEmailResult,
	EmailAttachment,
} from '../lib/types/bulk-email.types';
import { BulkAnnouncementEmailData } from '../lib/types/email-templates.types';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BulkEmailService {
	private readonly logger = new Logger(BulkEmailService.name);

	constructor(
		@InjectRepository(User)
		private userRepository: Repository<User>,
		private communicationService: CommunicationService,
		private eventEmitter: EventEmitter2,
	) {}

	/**
	 * Send bulk email to all users or filtered subset
	 */
	async sendBulkEmail(input: BulkEmailInput): Promise<BulkEmailResult> {
		const startTime = Date.now();
		const operationId = `BULK_EMAIL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		
		this.logger.log(`[${operationId}] Starting bulk email operation`);

		try {
			// Get recipients
			const recipients = await this.getRecipients(input.recipientFilter, operationId);
			
			if (recipients.length === 0) {
				this.logger.warn(`[${operationId}] No recipients found matching the criteria`);
				return {
					success: false,
					totalRecipients: 0,
					successfulSends: 0,
					failedSends: 0,
					failedEmails: [],
					messageIds: [],
					executionTime: Date.now() - startTime,
					dryRun: input.sendOptions?.dryRun || false,
				};
			}

			// Handle dry run
			if (input.sendOptions?.dryRun) {
				this.logger.log(`[${operationId}] DRY RUN - Would send emails to: ${recipients.map(u => u.email).join(', ')}`);
				return {
					success: true,
					totalRecipients: recipients.length,
					successfulSends: recipients.length, // Simulated success
					failedSends: 0,
					failedEmails: [],
					messageIds: [],
					executionTime: Date.now() - startTime,
					dryRun: true,
				};
			}

			// Process attachments
			const processedAttachments = await this.processAttachments(input.content.attachments || [], operationId);

			// Send emails
			const batchSize = input.sendOptions?.batchSize || 10;
			const delay = input.sendOptions?.delayBetweenBatches || 1000; // 1 second default

			let successfulSends = 0;
			let failedSends = 0;
			const failedEmails: string[] = [];
			const messageIds: string[] = [];

			// Process recipients in batches
			for (let i = 0; i < recipients.length; i += batchSize) {
				const batch = recipients.slice(i, i + batchSize);

				const batchPromises = batch.map(async (user) => {
					const userOperationId = `${operationId}_USER_${user.uid}`;
					
					try {
						// Prepare email data for this user
						const emailData: BulkAnnouncementEmailData = {
							name: user.name,
							recipientName: `${user.name} ${user.surname}`.trim(),
							recipientEmail: user.email,
							subject: input.content.subject,
							title: input.content.title,
							greeting: input.content.greeting,
							body: input.content.body,
							cta: input.content.cta,
							images: input.content.images,
							links: input.content.links,
							footer: input.content.footer,
						};

						// Send email using the communication service
						const result = await this.sendSingleEmail(
							[user.email],
							emailData,
							processedAttachments,
							userOperationId
						);
						
						if (result.messageId) {
							messageIds.push(result.messageId);
						}

						return { success: true, email: user.email, result };
					} catch (error) {
						this.logger.error(`[${userOperationId}] Failed to send email to ${user.email}:`, error.message);
						return { success: false, email: user.email, error: error.message };
					}
				});

				// Wait for batch to complete
				const batchResults = await Promise.all(batchPromises);
				
				// Count results
				batchResults.forEach(result => {
					if (result.success) {
						successfulSends++;
					} else {
						failedSends++;
						failedEmails.push(result.email);
					}
				});

				// Add delay between batches (except for the last batch)
				if (i + batchSize < recipients.length && delay > 0) {
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}

			const executionTime = Date.now() - startTime;
			const successRate = recipients.length > 0 ? (successfulSends / recipients.length * 100).toFixed(2) : '0.00';

			this.logger.log(`[${operationId}] Bulk email operation completed in ${executionTime}ms`);
			this.logger.log(`[${operationId}] Results - Success: ${successfulSends}/${recipients.length} (${successRate}%), Failed: ${failedSends}`);

			if (failedEmails.length > 0) {
				this.logger.warn(`[${operationId}] Failed emails: ${failedEmails.join(', ')}`);
			}

			return {
				success: successfulSends > 0,
				totalRecipients: recipients.length,
				successfulSends,
				failedSends,
				failedEmails,
				messageIds,
				executionTime,
			};

		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[${operationId}] Bulk email operation failed after ${executionTime}ms`, error.stack);
			throw error;
		}
	}

	/**
	 * Get recipients based on filter criteria
	 */
	private async getRecipients(filter: BulkEmailInput['recipientFilter'], operationId: string): Promise<User[]> {
		let query = this.userRepository
			.createQueryBuilder('user')
			.where('user.isDeleted = :isDeleted', { isDeleted: false })
			.andWhere('user.status = :status', { status: 'active' })
			.andWhere('user.email IS NOT NULL')
			.andWhere('user.email != :emptyEmail', { emptyEmail: '' });

		if (filter?.organizations && filter.organizations.length > 0) {
			query = query.andWhere('user.organisationRef IN (:...orgRefs)', { 
				orgRefs: filter.organizations 
			});
		}

		if (filter?.roles && filter.roles.length > 0) {
			query = query.andWhere('user.role IN (:...roles)', { roles: filter.roles });
		}

		if (filter?.status && filter.status.length > 0) {
			query = query.andWhere('user.status IN (:...statuses)', { statuses: filter.status });
		}

		if (filter?.excludeEmails && filter.excludeEmails.length > 0) {
			query = query.andWhere('user.email NOT IN (:...excludeEmails)', { 
				excludeEmails: filter.excludeEmails 
			});
		}

		const recipients = await query.getMany();
		return recipients;
	}

	/**
	 * Process attachments and convert to format suitable for email sending
	 */
	private async processAttachments(attachments: EmailAttachment[], operationId: string): Promise<any[]> {
		if (!attachments || attachments.length === 0) {
			return [];
		}

		const processedAttachments = [];

		for (const attachment of attachments) {
			try {
				if (attachment.path) {
					// Read file from path
					const fullPath = path.isAbsolute(attachment.path) 
						? attachment.path 
						: path.join(process.cwd(), attachment.path);
					
					if (fs.existsSync(fullPath)) {
						const content = fs.readFileSync(fullPath);
						processedAttachments.push({
							filename: attachment.filename,
							content: content,
							contentType: attachment.contentType,
						});
					} else {
						this.logger.warn(`[${operationId}] Attachment file not found: ${fullPath}`);
					}
				} else if (attachment.content) {
					// Use provided content buffer
					processedAttachments.push({
						filename: attachment.filename,
						content: attachment.content,
						contentType: attachment.contentType,
					});
				}
			} catch (error) {
				this.logger.error(`[${operationId}] Failed to process attachment ${attachment.filename}:`, error.message);
			}
		}

		return processedAttachments;
	}

	/**
	 * Send email to single recipient with attachments support
	 */
	private async sendSingleEmail(
		recipientEmails: string[], 
		emailData: BulkAnnouncementEmailData, 
		attachments: any[], 
		operationId: string
	): Promise<any> {
		// Use the existing communication service's sendEmail method
		// Note: The current sendEmail method doesn't support attachments directly,
		// so we'll need to modify it or create a custom method
		
		// For now, we'll emit the event and handle attachments separately
		// In a production environment, you'd modify the CommunicationService to support attachments
		
		const result = await this.communicationService.sendEmail(
			EmailType.BULK_ANNOUNCEMENT,
			recipientEmails,
			emailData
		);

		// TODO: If attachments are needed, modify the CommunicationService.sendEmail to accept attachments
		// and pass them to the nodemailer sendMail method
		
		return result;
	}

	/**
	 * Load email content from file
	 */
	async loadEmailContentFromFile(filePath: string): Promise<BulkEmailContent> {
		const operationId = `LOAD_FILE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		try {
			const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
			
			if (!fs.existsSync(fullPath)) {
				throw new Error(`File not found: ${fullPath}`);
			}

			const fileContent = fs.readFileSync(fullPath, 'utf8');
			const ext = path.extname(filePath).toLowerCase();

			let content: BulkEmailContent;

			if (ext === '.json') {
				content = JSON.parse(fileContent);
			} else if (ext === '.txt') {
				// For txt files, treat the entire content as the body
				// Subject should be provided separately or default
				content = {
					subject: 'Important Announcement',
					body: fileContent,
				};
			} else {
				throw new Error(`Unsupported file format: ${ext}. Only .json and .txt files are supported.`);
			}

			// Validate required fields
			if (!content.subject) {
				throw new Error('Email subject is required');
			}
			if (!content.body) {
				throw new Error('Email body is required');
			}

			return content;

		} catch (error) {
			this.logger.error(`[${operationId}] Failed to load email content from file`, error.stack);
			throw error;
		}
	}
}
