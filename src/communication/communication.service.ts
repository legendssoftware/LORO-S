import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { EmailType } from '../lib/enums/email.enums';
import { EmailTemplate } from '../lib/interfaces/email.interface';
import { UserService } from '../user/user.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunicationLog } from './entities/communication-log.entity';
// Core email templates
import {
	Signup,
	Verification,
	PasswordReset,
	PasswordResetRequest,
	PasswordChanged,
	DailyReport,
	NewTask,
	TaskUpdated,
	TaskCompleted,
	UserDailyReport,
	AttendanceMorningReport,
	AttendanceEveningReport,
	AttendanceMissedShiftAlert,
	AttendanceLateShiftAlert,
	AttendanceShiftStarted,
	AttendanceShiftEnded,
	AttendanceShiftStartReminder,
	AttendanceShiftEndReminder,
	AttendanceBreakStarted,
	AttendanceBreakEnded,
	OvertimeReminder,
	CheckInsDailyReport,
} from '../lib/templates/emails';
// Quotation related templates
import {
	NewQuotationClient,
	NewQuotationInternal,
	NewQuotationReseller,
	NewQuotationWarehouseFulfillment,
	QuotationStatusUpdate,
	Invoice,
} from '../lib/templates/emails';
// License related templates
import {
	LicenseCreated,
	LicenseUpdated,
	LicenseLimitReached,
	LicenseRenewed,
	LicenseSuspended,
	LicenseActivated,
	LicenseTransferredFrom,
	LicenseTransferredTo,
} from '../lib/templates/emails';
// Task related templates
import { TaskReminderAssignee, TaskReminderCreator, TaskOverdueMissed } from '../lib/templates/emails';
// User related templates
import { NewUserAdminNotification, NewUserWelcome, UserReInvitation, UserPreferencesUpdated } from '../lib/templates/emails';
// Lead related templates
import { LeadConvertedClient, LeadConvertedCreator, LeadReminder, LeadAssignedToUser, MonthlyUnattendedLeadsReport } from '../lib/templates/emails';
// Client auth templates
import { ClientPasswordReset, ClientPasswordChanged, ClientAccountCreated, ClientCommunicationReminder } from '../lib/templates/emails';
// Loyalty templates
import { LoyaltyWelcome, LoyaltyTierUpgrade, LoyaltyRewardClaimed } from '../lib/templates/emails';
// Warning templates
import { WarningIssued, WarningUpdated, WarningExpired } from '../lib/templates/emails';
// Leave templates
import { LeaveStatusUpdateUser, LeaveStatusUpdateAdmin, LeaveApplicationConfirmation, LeaveNewApplicationAdmin, LeaveDeletedNotification } from '../lib/templates/emails';
// Email data types
import {
	DailyReportData,
	InvoiceData,
	PasswordChangedData,
	PasswordResetData,
	VerificationEmailData,
	SignupEmailData,
	ClientAccountCreatedData,
	EmailTemplateData,
	LicenseEmailData,
	LicenseLimitData,
	LicenseTransferEmailData,
	QuotationInternalData,
	QuotationResellerData,
	QuotationWarehouseData,
	QuotationData,
	NewUserAdminNotificationData,
	NewUserWelcomeData,
	UserReInvitationData,
	UserPreferencesUpdatedData,
	TaskReminderData,
	TaskCompletedEmailData,
	LeadConvertedClientData,
	LeadConvertedCreatorData,
	LeadReminderData,
	LeadAssignedToUserData,
	TaskEmailData,
	TaskFlagEmailData,
	TaskFeedbackEmailData,
	TaskOverdueMissedData,
	OrderReceivedClientData,
	WarningIssuedEmailData,
	WarningUpdatedEmailData,
	WarningExpiredEmailData,
	MorningReportData,
	EveningReportData,
	OvertimeReminderData,
	AttendanceMissedShiftAlertData,
	AttendanceLateShiftAlertData,
	AttendanceShiftStartedData,
	AttendanceShiftEndedData,
	AttendanceShiftStartReminderData,
	AttendanceShiftEndReminderData,
	AttendanceBreakStartedData,
	AttendanceBreakEndedData,
	LeaveStatusUpdateUserData,
	LeaveStatusUpdateAdminData,
	LeaveApplicationConfirmationData,
	LeaveNewApplicationAdminData,
	LeaveDeletedNotificationData,
	AssetEmailData,
	AssetTransferredEmailData,
	AssetUpdatedEmailData,
	AssetInsuranceExpiryWarningEmailData,
	AssetAdminNotificationEmailData,
	LoginNotificationEmailData,
	EmailVerifiedEmailData,
	ClaimEmailData,
	ClaimStatusUpdateEmailData,
	LeadCreatedEmailData,
	LeadStatusUpdateEmailData,
	JournalEmailData,
	JournalUpdatedEmailData,
	JournalDeletedEmailData,
	PasswordResetRequestData,
	UserTargetAchievementAdminData,
	LeadTargetAchievementAdminData,
	UserTargetAchievementEmailData,
	UserTargetMilestoneEmailData,
	UserTargetDeadlineReminderEmailData,
	UserTargetPerformanceAlertEmailData,
	UserTargetERPUpdateConfirmationEmailData,
	UserTargetContributionProgressEmailData,
	UserTargetPeriodSummaryEmailData,
	UserTargetSetEmailData,
	UserTargetDeletedEmailData,
	UserTargetUpdatedEmailData,
	AppUpdateNotificationData,
	BulkAnnouncementEmailData,
	ClientCommunicationReminderData,
	ApprovalEmailData,
	LoyaltyWelcomeData,
	LoyaltyTierUpgradeData,
	LoyaltyRewardClaimedData,
	CheckInsDailyReportData,
} from '../lib/types/email-templates.types';
import {
	TaskFlagCreated,
	TaskFlagUpdated,
	TaskFlagResolved,
	TaskFeedbackAdded,
	OrderReceivedClient,
	AssetAssigned,
	AssetTransferred,
	AssetUpdated,
	AssetRemoved,
	AssetRestored,
	AssetInsuranceExpiryWarning,
	AssetCreatedAdmin,
	AssetDeletedAdmin,
	LoginNotification,
	ClientLoginNotification,
	FailedLoginAttempt,
	ClientFailedLoginAttempt,
	EmailVerified,
	ClaimCreated,
	ClaimCreatedAdmin,
	ClaimStatusUpdate,
	ClaimApproved,
	ClaimRejected,
	ClaimPaid,
	LeadCreated,
	LeadStatusUpdate,
	JournalCreated,
	JournalUpdated,
	JournalDeleted,
	UserTargetAchievementAdmin,
	LeadTargetAchievementAdmin,
	UserTargetAchievement,
	UserTargetMilestone,
	UserTargetDeadlineReminder,
	UserTargetPerformanceAlert,
	UserTargetERPUpdateConfirmation,
	UserTargetContributionProgress,
	UserTargetPeriodSummary,
	UserTargetSet,
	UserTargetDeleted,
	UserTargetUpdated,
	AppUpdateNotification,
	BulkAnnouncement,
	ApprovalCreated,
	ApprovalSubmitted,
	ApprovalApproved,
	ApprovalRejected,
	ApprovalEscalated,
	ApprovalUpdated,
	ApprovalWithdrawn,
	ApprovalArchived,
	ApprovalDeleted,
} from '../lib/templates/emails';

// Import the new type
import { MonthlyUnattendedLeadsReportData } from '../lib/types/email-templates.types';

@Injectable()
export class CommunicationService {
	private readonly logger = new Logger(CommunicationService.name);
	private readonly emailService: nodemailer.Transporter;
	// Deduplication cache: key = `${emailType}:${recipient}:${dataHash}`, value = timestamp
	private readonly emailDeduplicationCache = new Map<string, number>();
	private readonly DEDUPLICATION_WINDOW_MS = 5000; // 5 seconds

	constructor(
		private readonly configService: ConfigService,
		private readonly userService: UserService,
		@InjectRepository(CommunicationLog)
		private communicationLogRepository: Repository<CommunicationLog>,
	) {
		const initStartTime = Date.now();
		const operationId = `INIT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		
		this.logger.log(`[${operationId}] Initializing CommunicationService...`);
		
		try {
			const configStartTime = Date.now();
			// Load and validate SMTP configuration
			const smtpHost = this.configService.get<string>('SMTP_HOST');
			const smtpPort = this.configService.get<number>('SMTP_PORT');
			const smtpUser = this.configService.get<string>('SMTP_USER');
			const smtpPass = this.configService.get<string>('SMTP_PASS');
			const smtpFrom = this.configService.get<string>('SMTP_FROM');
			const emailFromName = this.configService.get<string>('EMAIL_FROM_NAME');
			const configTime = Date.now() - configStartTime;
			
			const validationStartTime = Date.now();
			// Validate required configuration
			
			if (!smtpHost) {
				this.logger.error(`[${operationId}] SMTP_HOST is not configured`);
				throw new Error('SMTP_HOST environment variable is required');
			}
			
			if (!smtpPort || isNaN(smtpPort)) {
				this.logger.error(`[${operationId}] SMTP_PORT is not configured or invalid: ${smtpPort}`);
				throw new Error('SMTP_PORT environment variable must be a valid number');
			}
			
			if (!smtpUser) {
				this.logger.error(`[${operationId}] SMTP_USER is not configured`);
				throw new Error('SMTP_USER environment variable is required');
			}
			
			if (!smtpPass) {
				this.logger.error(`[${operationId}] SMTP_PASS is not configured`);
				throw new Error('SMTP_PASS environment variable is required');
			}
			
			if (!smtpFrom) {
				this.logger.warn(`[${operationId}] SMTP_FROM is not configured - emails may have missing sender`);
			}
			const validationTime = Date.now() - validationStartTime;
			
			const transporterStartTime = Date.now();
			// Create email transporter
			this.emailService = nodemailer.createTransport({
			host: smtpHost,
			port: smtpPort,
			secure: smtpPort === 465,
			auth: {
				user: smtpUser,
					pass: smtpPass,
			},
			tls: {
				rejectUnauthorized: false,
			},
		});
			const transporterTime = Date.now() - transporterStartTime;
		
			// Test transporter connection (optional - can be commented out in production)
			// Note: We don't await this to avoid blocking initialization
			const connectionTestStartTime = Date.now();
			this.emailService.verify().then(() => {
				this.logger.log(`[${operationId}] SMTP connection verified successfully`);
			}).catch((error) => {
				const connectionTestTime = Date.now() - connectionTestStartTime;
				this.logger.warn(`[${operationId}] SMTP connection verification failed after ${connectionTestTime}ms: ${error.message}`);
			});
			
			const totalInitTime = Date.now() - initStartTime;
			this.logger.log(`[${operationId}] CommunicationService initialized successfully in ${totalInitTime}ms (Config: ${configTime}ms, Validation: ${validationTime}ms, Transporter: ${transporterTime}ms)`);
			
		} catch (error) {
			const initTime = Date.now() - initStartTime;
			this.logger.error(`[${operationId}] Failed to initialize CommunicationService after ${initTime}ms`, error.stack);
			throw error;
		}
	}

	/**
	 * Validate email address format
	 * @param email - Email address to validate
	 * @returns True if email format is valid
	 */
	private isValidEmail(email: string): boolean {
		const startTime = Date.now();
		this.logger.debug(`Validating email format for: ${email ? email.substring(0, 3) + '***' + email.substring(email.lastIndexOf('@')) : 'null'}`);
		
		try {
			// Handle null, undefined, or non-string inputs
			if (!email || typeof email !== 'string') {
				this.logger.debug('Email validation failed: null, undefined, or non-string input');
				return false;
			}
			
			// Trim whitespace and convert to lowercase for validation
			const trimmedEmail = email.trim().toLowerCase();
			
			// Basic format validation
			const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
			const isValid = emailRegex.test(trimmedEmail);
			const validationTime = Date.now() - startTime;
			
			if (!isValid) {
				this.logger.debug(`Email validation failed for: ${email} (trimmed: ${trimmedEmail}). Reason: Failed regex test`);
			}
			
			this.logger.debug(`Email validation completed in ${validationTime}ms. Result: ${isValid ? 'Valid' : 'Invalid'}`);
			return isValid;
		} catch (error) {
			const validationTime = Date.now() - startTime;
			this.logger.error(`Email validation failed after ${validationTime}ms for email: ${email}`, error.stack);
			return false;
		}
	}

	/**
	 * Create and log email template generation
	 * @param type - Email type for logging
	 * @param subject - Email subject
	 * @param body - Email body content
	 * @param startTime - Template generation start time
	 * @returns Email template with logging
	 */
	private createTemplateWithLogging(type: EmailType, subject: string, body: string, startTime: number): EmailTemplate {
		const templateStartTime = Date.now();
		this.logger.debug(`Creating template wrapper for ${type}. Subject: "${subject}", Body length: ${body?.length || 0} chars`);
		
		try {
		const template = { subject, body };
		const generationTime = Date.now() - startTime;
			const wrapperTime = Date.now() - templateStartTime;
			
			this.logger.debug(`Template created successfully for ${type} in ${wrapperTime}ms (total generation: ${generationTime}ms). Subject: "${subject}", Body length: ${body?.length || 0} chars`);
			
			// Validate template content
			if (!subject || subject.trim().length === 0) {
				this.logger.warn(`Empty or invalid subject generated for ${type}`);
			}
			if (!body || body.trim().length === 0) {
				this.logger.warn(`Empty or invalid body generated for ${type}`);
			}
			
		return template;
		} catch (error) {
			const wrapperTime = Date.now() - templateStartTime;
			this.logger.error(`Failed to create template wrapper for ${type} after ${wrapperTime}ms`, error.stack);
			throw error;
		}
	}

	/**
	 * Generate a simple hash of email data for deduplication
	 * @param data - Email template data
	 * @returns Hash string
	 */
	private hashEmailData(data: any): string {
		try {
			// Create a stable hash from key data fields that identify the email content
			// EXCLUDE time-based fields like loginTime, changeTime, etc. to ensure stable hashing
			const keyFields = ['name', 'ipAddress', 'email', 'resetLink', 'token'];
			const hashData: any = {};
			
			if (data) {
				for (const key of keyFields) {
					if (data[key] !== undefined) {
						hashData[key] = data[key];
					}
				}
				// Include other non-time fields for better uniqueness
				if (data.deviceType) hashData.deviceType = data.deviceType;
				if (data.browser) hashData.browser = data.browser;
				if (data.operatingSystem) hashData.operatingSystem = data.operatingSystem;
			}
			
			// Simple hash: JSON string length + first few chars of key values
			const jsonStr = JSON.stringify(hashData);
			return `${jsonStr.length}_${jsonStr.substring(0, 50)}`;
		} catch {
			return 'unknown';
		}
	}

	/**
	 * Check if this email should be deduplicated
	 * @param emailType - Type of email
	 * @param recipient - Recipient email
	 * @param dataHash - Hash of email data
	 * @returns True if email should be skipped (duplicate)
	 */
	private shouldDeduplicateEmail(emailType: EmailType, recipient: string, dataHash: string): boolean {
		const now = Date.now();
		const cacheKey = `${emailType}:${recipient}:${dataHash}`;
		const lastSent = this.emailDeduplicationCache.get(cacheKey);
		
		if (lastSent && (now - lastSent) < this.DEDUPLICATION_WINDOW_MS) {
			return true; // Duplicate detected
		}
		
		// Update cache
		this.emailDeduplicationCache.set(cacheKey, now);
		
		// Clean up old entries (older than 1 minute)
		if (this.emailDeduplicationCache.size > 1000) {
			for (const [key, timestamp] of this.emailDeduplicationCache.entries()) {
				if (now - timestamp > 60000) {
					this.emailDeduplicationCache.delete(key);
				}
			}
		}
		
		return false;
	}

	/**
	 * Send email based on event trigger with comprehensive logging and error handling
	 * @param emailType - Type of email to send
	 * @param recipientsEmails - Array of recipient email addresses
	 * @param data - Email template data specific to the email type
	 * @returns Email sending result with message ID and delivery details
	 */
	@OnEvent('send.email')
	async sendEmail<T extends EmailType>(emailType: T, recipientsEmails: string[], data: EmailTemplateData<T>) {
		const startTime = Date.now();
		const operationId = `${emailType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		
		this.logger.log(`[${operationId}] Email event received for type: ${emailType}`);
		this.logger.debug(`[${operationId}] Recipients (${recipientsEmails?.length || 0}): ${recipientsEmails?.join(', ')}`);
		this.logger.debug(`[${operationId}] Email data keys: ${data ? Object.keys(data).join(', ') : 'No data provided'}`);
		
		try {
			// Deduplication check for failed login attempts and other security emails
			if (emailType === EmailType.CLIENT_FAILED_LOGIN_ATTEMPT || emailType === EmailType.FAILED_LOGIN_ATTEMPT) {
				const dataHash = this.hashEmailData(data);
				for (const recipient of recipientsEmails) {
					if (this.shouldDeduplicateEmail(emailType, recipient, dataHash)) {
						this.logger.warn(`[${operationId}] Duplicate email detected and skipped for ${emailType} to ${recipient} (within ${this.DEDUPLICATION_WINDOW_MS}ms window)`);
						return {
							accepted: [],
							rejected: [],
							messageId: null,
							messageSize: null,
							envelopeTime: null,
							messageTime: null,
							response: 'Duplicate email skipped',
							envelope: null,
						};
					}
				}
			}
			
			// Validate recipients
			this.logger.debug(`[${operationId}] Validating recipients...`);
			if (!recipientsEmails || recipientsEmails.length === 0) {
				this.logger.error(`[${operationId}] Validation failed: No recipients provided for email`);
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Validate email addresses format
			const invalidEmails = recipientsEmails.filter(email => !this.isValidEmail(email));
			if (invalidEmails.length > 0) {
				this.logger.warn(`[${operationId}] Invalid email addresses detected: ${invalidEmails.join(', ')}`);
			}

			this.logger.debug(`[${operationId}] Generating email template for type: ${emailType}`);
			const templateStartTime = Date.now();
			const template = this.getEmailTemplate(emailType, data);
			const templateGenerationTime = Date.now() - templateStartTime;
			this.logger.debug(`[${operationId}] Template generated successfully in ${templateGenerationTime}ms. Subject: "${template.subject}", Body length: ${template.body?.length || 0} chars`);

			// Construct the from field with display name and email
			const emailFrom = this.configService.get<string>('SMTP_FROM');
			const emailFromName = this.configService.get<string>('EMAIL_FROM_NAME');
			const fromField = emailFromName ? `"${emailFromName}" <${emailFrom}>` : emailFrom;

			this.logger.debug(`[${operationId}] Preparing email transport from: ${fromField}`);
			this.logger.debug(`[${operationId}] Email size estimate: ${(template.body?.length || 0 + template.subject?.length || 0)} chars`);

			const sendStartTime = Date.now();
			this.logger.debug(`[${operationId}] Sending email via SMTP...`);
			const result = await this.emailService.sendMail({
				from: fromField,
				to: recipientsEmails,
				subject: template.subject,
				html: template.body,
			});
			const sendTime = Date.now() - sendStartTime;

			// Log the communication to database
			this.logger.debug(`[${operationId}] Saving communication log to database...`);
			const dbSaveStartTime = Date.now();
			const communicationLog = await this.communicationLogRepository.save({
				emailType,
				recipientEmails: recipientsEmails,
				accepted: result.accepted,
				rejected: result.rejected,
				messageId: result.messageId,
				messageSize: result.messageSize,
				envelopeTime: result.envelopeTime,
				messageTime: result.messageTime,
				response: result.response,
				envelope: result.envelope,
			});
			const dbSaveTime = Date.now() - dbSaveStartTime;

			const totalExecutionTime = Date.now() - startTime;
			
			// Single comprehensive log entry with all information
			this.logger.log(`[${operationId}] Email sent successfully for type: ${emailType} in ${totalExecutionTime}ms (Template: ${templateGenerationTime}ms, Send: ${sendTime}ms, DB: ${dbSaveTime}ms) - MessageId: ${result.messageId}, Log ID: ${communicationLog.uid || 'Unknown'}`);
			
			if (result.rejected && result.rejected.length > 0) {
				this.logger.warn(`[${operationId}] Some recipients were rejected: ${result.rejected.join(', ')}`);
			}
			
			return result;
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[${operationId}] Failed to send ${emailType} email to recipients: ${recipientsEmails?.join(', ')} after ${executionTime}ms`, error.stack);
			
			// Log SMTP configuration for debugging (without sensitive data)
			const smtpHost = this.configService.get<string>('SMTP_HOST');
			const smtpUser = this.configService.get<string>('SMTP_USER');
			const smtpPort = this.configService.get<number>('SMTP_PORT');
			const smtpFrom = this.configService.get<string>('SMTP_FROM');
			const emailFromName = this.configService.get<string>('EMAIL_FROM_NAME');
			
			this.logger.error(`[${operationId}] SMTP Configuration details:`, {
				SMTP_HOST: smtpHost,
				SMTP_PORT: smtpPort,
				SMTP_USER: smtpUser,
				SMTP_FROM: smtpFrom,
				EMAIL_FROM_NAME: emailFromName,
				hasPassword: !!this.configService.get<string>('SMTP_PASS'),
			});
			
			// Log failed email attempt
			try {
				this.logger.debug(`[${operationId}] Logging failed email attempt to database...`);
				const failedLogStartTime = Date.now();
				const failedLog = await this.communicationLogRepository.save({
					emailType,
					recipientEmails: recipientsEmails,
					accepted: [],
					rejected: recipientsEmails,
					messageId: null,
					messageSize: null,
					envelopeTime: null,
					messageTime: null,
					response: `Error: ${error.message}`,
					createdAt: new Date(),
				});
				const failedLogTime = Date.now() - failedLogStartTime;
				this.logger.debug(`[${operationId}] Failed email attempt logged to database in ${failedLogTime}ms (Log ID: ${failedLog.uid || 'Unknown'})`);
			} catch (logError) {
				this.logger.error(`[${operationId}] Failed to log email error to database:`, logError.stack);
			}
			
			throw error;
		}
	}

	/**
	 * Send app update notifications to multiple users with detailed logging and error tracking
	 * @param userEmails - Array of user email addresses to notify
	 * @param appUpdateData - App update notification data
	 * @returns Success status and message
	 */
	async sendAppUpdateNotification(userEmails: string[], appUpdateData: AppUpdateNotificationData) {
		const startTime = Date.now();
		const operationId = `APP_UPDATE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		
		this.logger.log(`[${operationId}] Starting app update notification process`);
		this.logger.debug(`[${operationId}] Input validation - User emails count: ${userEmails?.length || 0}`);
		this.logger.debug(`[${operationId}] Target user emails: ${userEmails?.join(', ') || 'None provided'}`);
		this.logger.debug(`[${operationId}] Update data provided: ${appUpdateData ? 'Yes' : 'No'}`);
		this.logger.debug(`[${operationId}] Update data keys: ${appUpdateData ? Object.keys(appUpdateData).join(', ') : 'No data provided'}`);
		this.logger.debug(`[${operationId}] Update data size: ${appUpdateData ? JSON.stringify(appUpdateData).length : 0} chars`);
		
		let successCount = 0;
		let failureCount = 0;
		const failures: string[] = [];
		const validationStartTime = Date.now();
		
		try {
			// Enhanced input validation
			this.logger.debug(`[${operationId}] Validating input parameters...`);
			if (!userEmails || userEmails.length === 0) {
				const validationTime = Date.now() - validationStartTime;
				this.logger.warn(`[${operationId}] Validation failed: No user emails provided after ${validationTime}ms`);
				return { 
					success: false, 
					message: 'No user emails provided',
					successCount: 0,
					failureCount: 0
				};
			}
			
			if (!appUpdateData) {
				const validationTime = Date.now() - validationStartTime;
				this.logger.warn(`[${operationId}] Validation failed: No app update data provided after ${validationTime}ms`);
				return { 
					success: false, 
					message: 'No app update data provided',
					successCount: 0,
					failureCount: 0
				};
			}
			
			// Validate email addresses
			const invalidEmails = userEmails.filter(email => !this.isValidEmail(email));
			if (invalidEmails.length > 0) {
				this.logger.warn(`[${operationId}] Invalid email addresses detected: ${invalidEmails.join(', ')}`);
			}
			
			const validationTime = Date.now() - validationStartTime;
			this.logger.debug(`[${operationId}] Input validation completed in ${validationTime}ms. Valid emails: ${userEmails.length - invalidEmails.length}/${userEmails.length}`);
			
			// Proceed with valid emails only
			const validEmails = userEmails.filter(email => this.isValidEmail(email));
			if (validEmails.length === 0) {
				this.logger.warn(`[${operationId}] No valid email addresses found`);
				return { 
					success: false, 
					message: 'No valid email addresses provided',
					successCount: 0,
					failureCount: userEmails.length,
					failures: userEmails
				};
			}

			// Send email to all valid users
			this.logger.log(`[${operationId}] Starting email dispatch to ${validEmails.length} valid recipients`);
			const emailSendStartTime = Date.now();
			
			const emailPromises = validEmails.map(async (email, index) => {
				const emailStartTime = Date.now();
				const emailOperationId = `${operationId}_EMAIL_${index + 1}`;
				
				try {
					this.logger.debug(`[${emailOperationId}] Sending app update notification to: ${email} (${index + 1}/${validEmails.length})`);
					
					const emailResult = await this.sendEmail(EmailType.APP_UPDATE_NOTIFICATION, [email], appUpdateData);
					const emailTime = Date.now() - emailStartTime;
					
					this.logger.debug(`[${emailOperationId}] App update notification sent successfully to: ${email} in ${emailTime}ms. MessageId: ${emailResult?.messageId || 'Unknown'}`);
					successCount++;
					
					return { email, success: true, messageId: emailResult?.messageId, time: emailTime };
				} catch (error) {
					const emailTime = Date.now() - emailStartTime;
					this.logger.error(`[${emailOperationId}] Failed to send app update notification to ${email} after ${emailTime}ms:`, error.stack);
					failureCount++;
					failures.push(email);
					
					return { email, success: false, error: error.message, time: emailTime };
				}
			});

			this.logger.debug(`[${operationId}] Awaiting completion of ${emailPromises.length} email promises...`);
			const emailResults = await Promise.all(emailPromises);
			const emailSendTime = Date.now() - emailSendStartTime;
			
			this.logger.debug(`[${operationId}] Email dispatch completed in ${emailSendTime}ms`);
			
			// Log detailed results
			const successfulEmails = emailResults.filter(result => result.success);
			const failedEmails = emailResults.filter(result => !result.success);
			
			if (successfulEmails.length > 0) {
				const avgSuccessTime = successfulEmails.reduce((sum, result) => sum + result.time, 0) / successfulEmails.length;
				this.logger.debug(`[${operationId}] Successful emails: ${successfulEmails.length}, Average time: ${avgSuccessTime.toFixed(2)}ms`);
			}
			
			if (failedEmails.length > 0) {
				const avgFailureTime = failedEmails.reduce((sum, result) => sum + result.time, 0) / failedEmails.length;
				this.logger.debug(`[${operationId}] Failed emails: ${failedEmails.length}, Average time: ${avgFailureTime.toFixed(2)}ms`);
			}
			
			const totalExecutionTime = Date.now() - startTime;
			const avgExecutionTimePerEmail = validEmails.length > 0 ? totalExecutionTime / validEmails.length : 0;
			
			// Calculate success rate
			const totalAttempted = validEmails.length;
			const successRate = totalAttempted > 0 ? (successCount / totalAttempted * 100).toFixed(2) : '0.00';
			
			this.logger.log(`[${operationId}] App update notification process completed in ${totalExecutionTime}ms`);
			this.logger.log(`[${operationId}] Results Summary - Success: ${successCount}/${totalAttempted} (${successRate}%), Failures: ${failureCount}, Invalid emails: ${userEmails.length - validEmails.length}`);
			this.logger.debug(`[${operationId}] Performance - Avg time per email: ${avgExecutionTimePerEmail.toFixed(2)}ms, Validation: ${validationTime}ms, Email dispatch: ${emailSendTime}ms`);
			
			if (failures.length > 0) {
				this.logger.warn(`[${operationId}] Failed to send notifications to: ${failures.join(', ')}`);
			}

			// Include invalid emails in the failure count for total accountability
			const totalFailureCount = failureCount + (userEmails.length - validEmails.length);
			const allFailures = [...failures, ...userEmails.filter(email => !this.isValidEmail(email))];

			const result = { 
				success: successCount > 0, 
				message: `App update notification sent to ${successCount}/${userEmails.length} users (${successRate}% success rate)`,
				successCount,
				failureCount: totalFailureCount,
				validEmailsProcessed: validEmails.length,
				invalidEmailsSkipped: userEmails.length - validEmails.length,
				totalExecutionTime,
				averageTimePerEmail: parseFloat(avgExecutionTimePerEmail.toFixed(2)),
				successRate: parseFloat(successRate),
				failures: allFailures.length > 0 ? allFailures : undefined
			};
			
			this.logger.debug(`[${operationId}] Returning result with ${Object.keys(result).length} properties`);
			return result;
			
		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logger.error(`[${operationId}] Failed to send app update notifications after ${executionTime}ms`, error.stack);
			
			// Log additional context for debugging
			this.logger.error(`[${operationId}] Failure context:`, {
				originalEmailCount: userEmails?.length || 0,
				appUpdateDataProvided: !!appUpdateData,
				successCount,
				failureCount,
				failures: failures.length > 0 ? failures : 'None',
				errorType: error.constructor.name,
				errorMessage: error.message,
			});
			
			throw error;
		}
	}

	/**
	 * Generate email template based on email type with comprehensive logging
	 * @param type - Email type from EmailType enum
	 * @param data - Template data specific to the email type
	 * @returns Email template with subject and body
	 */
	private getEmailTemplate<T extends EmailType>(type: T, data: EmailTemplateData<T>): EmailTemplate {
		const startTime = Date.now();
		const operationId = `TEMPLATE_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		
		this.logger.debug(`[${operationId}] Starting email template generation for type: ${type}`);
		this.logger.debug(`[${operationId}] Template data provided: ${data ? 'Yes' : 'No'}, Keys: ${data ? Object.keys(data).join(', ') : 'None'}`);
		this.logger.debug(`[${operationId}] Data size estimate: ${data ? JSON.stringify(data).length : 0} chars`);
		
		try {
			// Validate input parameters
			if (!type) {
				this.logger.error(`[${operationId}] Email type is null or undefined`);
				throw new Error('Email type is required');
			}
			
			this.logger.debug(`[${operationId}] Processing email template for: ${type}`);
			const caseStartTime = Date.now();
			switch (type) {
			case EmailType.SIGNUP:
				return this.createTemplateWithLogging(type, 'Welcome to Our Platform', Signup(data as SignupEmailData), startTime);
			case EmailType.VERIFICATION:
				return this.createTemplateWithLogging(type, 'Verify Your Email', Verification(data as VerificationEmailData), startTime);
			case EmailType.PASSWORD_RESET:
				return {
					subject: 'Password Reset Request',
					body: PasswordReset(data as PasswordResetData),
				};
			case EmailType.PASSWORD_RESET_REQUEST:
				return {
					subject: 'Security Alert: Password Reset Requested',
					body: PasswordResetRequest(data as PasswordResetRequestData), 
				};
			case EmailType.NEW_QUOTATION_CLIENT:
				return {
					subject: 'Your Quotation Details',
					body: NewQuotationClient(data as QuotationData),
				};
			case EmailType.NEW_QUOTATION_INTERNAL:
				return {
					subject: 'New Quotation from Customer',
					body: NewQuotationInternal(data as QuotationInternalData),
				};
			case EmailType.NEW_QUOTATION_RESELLER:
				return {
					subject: 'New Quotation from Your Referral',
					body: NewQuotationReseller(data as QuotationResellerData),
				};
			case EmailType.NEW_QUOTATION_WAREHOUSE_FULFILLMENT:
				return {
					subject: 'New Quotation from Warehouse Fulfillment',
					body: NewQuotationWarehouseFulfillment(data as QuotationWarehouseData),
				};
			case EmailType.INVOICE:
				return {
					subject: 'Invoice for Your Quotation',
					body: Invoice(data as InvoiceData),
				};
			case EmailType.PASSWORD_CHANGED:
				return {
					subject: 'Password Successfully Changed',
					body: PasswordChanged(data as PasswordChangedData),
				};
			case EmailType.DAILY_REPORT:
				return {
					subject: 'Daily Report',
					body: DailyReport(data as DailyReportData),
				};
			case EmailType.USER_DAILY_REPORT:
				return {
					subject: 'Your Daily Activity Summary',
					body: UserDailyReport(data as DailyReportData),
				};
			case EmailType.LICENSE_CREATED:
				return {
					subject: 'License Created Successfully',
					body: LicenseCreated(data as LicenseEmailData),
				};
			case EmailType.LICENSE_UPDATED:
				return {
					subject: 'License Updated',
					body: LicenseUpdated(data as LicenseEmailData),
				};
			case EmailType.LICENSE_LIMIT_REACHED:
				return {
					subject: 'License Limit Reached',
					body: LicenseLimitReached(data as LicenseLimitData),
				};
			case EmailType.LICENSE_RENEWED:
				return {
					subject: 'License Renewed Successfully',
					body: LicenseRenewed(data as LicenseEmailData),
				};
			case EmailType.LICENSE_SUSPENDED:
				return {
					subject: 'License Suspended',
					body: LicenseSuspended(data as LicenseEmailData),
				};
			case EmailType.LICENSE_ACTIVATED:
				return {
					subject: 'License Activated Successfully',
					body: LicenseActivated(data as LicenseEmailData),
				};
			case EmailType.LICENSE_TRANSFERRED_FROM:
				return {
					subject: 'License Transferred From',
					body: LicenseTransferredFrom(data as LicenseTransferEmailData),
				};
			case EmailType.LICENSE_TRANSFERRED_TO:
				return {
					subject: 'License Transferred To',
					body: LicenseTransferredTo(data as LicenseTransferEmailData),
				};
			case EmailType.NEW_TASK:
				return {
					subject: 'New Task Assigned',
					body: NewTask(data as TaskEmailData),
				};
			case EmailType.TASK_UPDATED:
				return {
					subject: 'Task Updated',
					body: TaskUpdated(data as TaskEmailData),
				};
			case EmailType.TASK_COMPLETED:
				return {
					subject: 'Task Completed Successfully',
					body: TaskCompleted(data as TaskCompletedEmailData),
				};
			case EmailType.QUOTATION_APPROVED:
				return {
					subject: 'Quotation Approved',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_REJECTED:
				return {
					subject: 'Quotation Not Approved',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_STATUS_UPDATE:
				return {
					subject: 'Quotation Status Update',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_READY_FOR_REVIEW:
				return {
					subject: 'Quotation Ready for Review',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_UPDATED:
				return {
					subject: 'Quotation Updated',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_SOURCING:
				return {
					subject: 'Quotation Items Being Sourced',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_PACKING:
				return {
					subject: 'Quotation Items Being Packed',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_PAID:
				return {
					subject: 'Quotation Payment Received',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_SHIPPED:
				return {
					subject: 'Quotation Items Shipped',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_DELIVERED:
				return {
					subject: 'Quotation Items Delivered',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_RETURNED:
				return {
					subject: 'Quotation Items Returned',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.QUOTATION_COMPLETED:
				return {
					subject: 'Quotation Completed',
					body: QuotationStatusUpdate(data as QuotationData),
				};
			case EmailType.NEW_USER_ADMIN_NOTIFICATION:
				return {
					subject: 'New User Registration Alert',
					body: NewUserAdminNotification(data as NewUserAdminNotificationData),
				};
			case EmailType.NEW_USER_WELCOME:
				return {
					subject: 'Your Account is Ready - Welcome to the Team!',
					body: NewUserWelcome(data as NewUserWelcomeData),
				};
			case EmailType.USER_RE_INVITATION:
				return {
					subject: 'You\'re Invited Back to the Platform!',
					body: UserReInvitation(data as UserReInvitationData),
				};
			case EmailType.USER_PREFERENCES_UPDATED:
				return {
					subject: 'Preferences Updated Successfully',
					body: UserPreferencesUpdated(data as UserPreferencesUpdatedData),
				};
			case EmailType.TASK_REMINDER_ASSIGNEE:
				return {
					subject: 'Task Deadline Approaching',
					body: TaskReminderAssignee(data as TaskReminderData),
				};
			case EmailType.TASK_REMINDER_CREATOR:
				return {
					subject: 'Task Deadline Alert',
					body: TaskReminderCreator(data as TaskReminderData),
				};
			case EmailType.TASK_OVERDUE_MISSED:
				return {
					subject: 'Action Required: Overdue & Missed Tasks',
					body: TaskOverdueMissed(data as TaskOverdueMissedData),
				};
			case EmailType.LEAD_CONVERTED_CLIENT:
				return {
					subject: 'Welcome Aboard! Your Account Has Been Upgraded',
					body: LeadConvertedClient(data as LeadConvertedClientData),
				};
			case EmailType.LEAD_CONVERTED_CREATOR:
				return {
					subject: 'Lead Successfully Converted to Client',
					body: LeadConvertedCreator(data as LeadConvertedCreatorData),
				};
			case EmailType.LEAD_REMINDER:
				return {
					subject: 'Pending Leads Require Your Attention',
					body: LeadReminder(data as LeadReminderData),
				};
			case EmailType.LEAD_ASSIGNED_TO_USER:
				return {
					subject: 'You have been assigned a new lead',
					body: LeadAssignedToUser(data as LeadAssignedToUserData),
				};
			case EmailType.MONTHLY_UNATTENDED_LEADS_REPORT:
				return {
					subject: 'Monthly Unattended Leads Report',
					body: MonthlyUnattendedLeadsReport(data as MonthlyUnattendedLeadsReportData),
				};
			case EmailType.TASK_FLAG_CREATED:
				return {
					subject: 'New Task Flag Created',
					body: TaskFlagCreated(data as TaskFlagEmailData),
				};
			case EmailType.TASK_FLAG_UPDATED:
				return {
					subject: 'Task Flag Status Updated',
					body: TaskFlagUpdated(data as TaskFlagEmailData),
				};
			case EmailType.TASK_FLAG_RESOLVED:
				return {
					subject: 'Task Flag Resolved',
					body: TaskFlagResolved(data as TaskFlagEmailData),
				};
			case EmailType.TASK_FEEDBACK_ADDED:
				return {
					subject: 'New Task Feedback Received',
					body: TaskFeedbackAdded(data as TaskFeedbackEmailData),
				};
			case EmailType.ORDER_RECEIVED_CLIENT:
				return {
					subject: 'Your Order Request Has Been Received',
					body: OrderReceivedClient(data as OrderReceivedClientData),
				};
			case EmailType.CLIENT_PASSWORD_RESET:
				return {
					subject: 'Password Reset Request',
					body: ClientPasswordReset(data as PasswordResetData),
				};
			case EmailType.CLIENT_PASSWORD_CHANGED:
				return {
					subject: 'Password Successfully Changed',
					body: ClientPasswordChanged(data as PasswordChangedData),
				};
			case EmailType.CLIENT_ACCOUNT_CREATED:
				return {
					subject: 'Welcome to Loro - Your Account Has Been Created',
					body: ClientAccountCreated(data as ClientAccountCreatedData),
				};
			case EmailType.WARNING_ISSUED:
				return {
					subject: 'Warning Issued',
					body: WarningIssued(data as WarningIssuedEmailData),
				};
			case EmailType.WARNING_UPDATED:
				return {
					subject: 'Warning Updated',
					body: WarningUpdated(data as WarningUpdatedEmailData),
				};
			case EmailType.WARNING_EXPIRED:
				return {
					subject: 'Warning Expired',
					body: WarningExpired(data as WarningExpiredEmailData),
				};
			case EmailType.ATTENDANCE_MORNING_REPORT:
				return {
					subject: 'Daily Attendance Morning Report',
					body: AttendanceMorningReport(data as MorningReportData),
				};
			case EmailType.ATTENDANCE_EVENING_REPORT:
				return {
					subject: 'Daily Attendance Evening Report',
					body: AttendanceEveningReport(data as EveningReportData),
				};
			case EmailType.ATTENDANCE_SHIFT_STARTED:
				return {
					subject: 'Shift Started Successfully',
					body: AttendanceShiftStarted(data as AttendanceShiftStartedData),
				};
			case EmailType.ATTENDANCE_SHIFT_ENDED:
				return {
					subject: 'Shift Completed Successfully',
					body: AttendanceShiftEnded(data as AttendanceShiftEndedData),
				};
			case EmailType.ATTENDANCE_SHIFT_START_REMINDER:
				return {
					subject: 'Shift Starting Soon',
					body: AttendanceShiftStartReminder(data as AttendanceShiftStartReminderData),
				};
			case EmailType.ATTENDANCE_SHIFT_END_REMINDER:
				return {
					subject: 'Shift End Reminder',
					body: AttendanceShiftEndReminder(data as AttendanceShiftEndReminderData),
				};
			case EmailType.ATTENDANCE_BREAK_STARTED:
				return {
					subject: 'Break Time Started',
					body: AttendanceBreakStarted(data as AttendanceBreakStartedData),
				};
			case EmailType.ATTENDANCE_BREAK_ENDED:
				return {
					subject: 'Break Complete',
					body: AttendanceBreakEnded(data as AttendanceBreakEndedData),
				};
			case EmailType.ATTENDANCE_MISSED_SHIFT_ALERT:
				return {
					subject: 'Missed Shift Alert',
					body: AttendanceMissedShiftAlert(data as AttendanceMissedShiftAlertData),
				};
			case EmailType.ATTENDANCE_LATE_SHIFT_ALERT:
				return {
					subject: 'Late Shift Alert',
					body: AttendanceLateShiftAlert(data as AttendanceLateShiftAlertData),
				};
			case EmailType.OVERTIME_REMINDER:
				return {
					subject: 'Overtime Work Reminder',
					body: OvertimeReminder(data as OvertimeReminderData),
				};
			case EmailType.CHECK_INS_DAILY_REPORT:
				return {
					subject: `Daily Check-Ins Report - ${(data as CheckInsDailyReportData).reportDate}`,
					body: CheckInsDailyReport(data as CheckInsDailyReportData),
				};
			case EmailType.LEAVE_STATUS_UPDATE_USER:
				return {
					subject: 'Leave Status Update',
					body: LeaveStatusUpdateUser(data as LeaveStatusUpdateUserData),
				};
			case EmailType.LEAVE_STATUS_UPDATE_ADMIN:
				return {
					subject: 'Leave Status Update - Admin Notification',
					body: LeaveStatusUpdateAdmin(data as LeaveStatusUpdateAdminData),
				};
			case EmailType.LEAVE_APPLICATION_CONFIRMATION:
				return {
					subject: 'Leave Application Confirmation',
					body: LeaveApplicationConfirmation(data as LeaveApplicationConfirmationData),
				};
			case EmailType.LEAVE_NEW_APPLICATION_ADMIN:
				return {
					subject: 'New Leave Application - Admin Notification',
					body: LeaveNewApplicationAdmin(data as LeaveNewApplicationAdminData),
				};
			case EmailType.LEAVE_DELETED_NOTIFICATION:
				return {
					subject: 'Leave Application Deleted',
					body: LeaveDeletedNotification(data as LeaveDeletedNotificationData),
				};
			case EmailType.ASSET_ASSIGNED:
				return {
					subject: 'Asset Assigned to You',
					body: AssetAssigned(data as AssetEmailData),
				};
			case EmailType.ASSET_TRANSFERRED:
				return {
					subject: 'Asset Transfer Notification',
					body: AssetTransferred(data as AssetTransferredEmailData),
				};
			case EmailType.ASSET_UPDATED:
				return {
					subject: 'Asset Information Updated',
					body: AssetUpdated(data as AssetUpdatedEmailData),
				};
			case EmailType.ASSET_REMOVED:
				return {
					subject: 'Asset Removed from Your Account',
					body: AssetRemoved(data as AssetEmailData),
				};
			case EmailType.ASSET_RESTORED:
				return {
					subject: 'Asset Restored to Your Account',
					body: AssetRestored(data as AssetEmailData),
				};
			case EmailType.ASSET_INSURANCE_EXPIRY_WARNING:
				return {
					subject: 'Asset Insurance Expiry Warning',
					body: AssetInsuranceExpiryWarning(data as AssetInsuranceExpiryWarningEmailData),
				};
			case EmailType.ASSET_CREATED_ADMIN:
				return {
					subject: 'New Asset Created - Admin Notification',
					body: AssetCreatedAdmin(data as AssetAdminNotificationEmailData),
				};
			case EmailType.ASSET_DELETED_ADMIN:
				return {
					subject: 'Asset Deleted - Admin Notification',
					body: AssetDeletedAdmin(data as AssetAdminNotificationEmailData),
				};
			case EmailType.BLANK_QUOTATION_CLIENT:
				return {
					subject: 'Your Blank Quotation is Ready',
					body: NewQuotationClient(data as QuotationInternalData), // Reuse existing template for now
				};
			case EmailType.BLANK_QUOTATION_INTERNAL:
				return {
					subject: 'New Blank Quotation Created',
					body: NewQuotationInternal(data as QuotationInternalData), // Reuse existing template for now
				};
			case EmailType.LOGIN_NOTIFICATION:
				return {
					subject: 'Security Alert: New Login to Your Account',
					body: LoginNotification(data as LoginNotificationEmailData),
				};
			case EmailType.CLIENT_LOGIN_NOTIFICATION:
				return {
					subject: 'Security Alert: New Login to Your Client Portal',
					body: ClientLoginNotification(data as LoginNotificationEmailData),
				};
			case EmailType.FAILED_LOGIN_ATTEMPT:
				return {
					subject: 'Security Alert: Failed Login Attempt on Your Account',
					body: FailedLoginAttempt(data as LoginNotificationEmailData),
				};
			case EmailType.CLIENT_FAILED_LOGIN_ATTEMPT:
				return {
					subject: 'Security Alert: Failed Login Attempt on Your Client Portal',
					body: ClientFailedLoginAttempt(data as LoginNotificationEmailData),
				};
			case EmailType.EMAIL_VERIFIED:
				return {
					subject: 'Email Successfully Verified',
					body: EmailVerified(data as EmailVerifiedEmailData),
				};
			case EmailType.CLAIM_CREATED:
				return {
					subject: 'New Claim Submitted',
					body: ClaimCreated(data as ClaimEmailData),
				};
			case EmailType.CLAIM_CREATED_ADMIN:
				return {
					subject: 'New Claim Submission - Admin Notification',
					body: ClaimCreatedAdmin(data as ClaimEmailData),
				};
			case EmailType.CLAIM_STATUS_UPDATE:
				return {
					subject: 'Claim Status Update',
					body: ClaimStatusUpdate(data as ClaimStatusUpdateEmailData),
				};
			case EmailType.CLAIM_APPROVED:
				return {
					subject: 'Claim Approved',
					body: ClaimApproved(data as ClaimStatusUpdateEmailData),
				};
			case EmailType.CLAIM_REJECTED:
				return {
					subject: 'Claim Rejected',
					body: ClaimRejected(data as ClaimStatusUpdateEmailData),
				};
			case EmailType.CLAIM_PAID:
				return {
					subject: 'Claim Payment Processed',
					body: ClaimPaid(data as ClaimStatusUpdateEmailData),
				};
			case EmailType.LEAD_CREATED:
				return {
					subject: 'New Lead Created',
					body: LeadCreated(data as LeadCreatedEmailData),
				};
			case EmailType.LEAD_STATUS_UPDATE:
				return {
					subject: 'Lead Status Update',
					body: LeadStatusUpdate(data as LeadStatusUpdateEmailData),
				};
			case EmailType.JOURNAL_CREATED:
				return {
					subject: 'New Journal Entry Created',
					body: JournalCreated(data as JournalEmailData),
				};
			case EmailType.JOURNAL_UPDATED:
				return {
					subject: 'Journal Entry Updated',
					body: JournalUpdated(data as JournalUpdatedEmailData),
				};
			case EmailType.JOURNAL_DELETED:
				return {
					subject: 'Journal Entry Deleted',
					body: JournalDeleted(data as JournalDeletedEmailData),
				};
			case EmailType.USER_TARGET_ACHIEVEMENT_ADMIN:
				return {
					subject: 'Team Member Target Achievement - Admin Notification',
					body: UserTargetAchievementAdmin(data as UserTargetAchievementAdminData), 
				};
			case EmailType.LEAD_TARGET_ACHIEVEMENT_ADMIN:
				return {
					subject: 'Lead Target Achievement - Admin Notification',
					body: LeadTargetAchievementAdmin(data as LeadTargetAchievementAdminData),
				};
			case EmailType.USER_TARGET_ACHIEVEMENT:
				return {
					subject: 'Your Target Achievement',
					body: UserTargetAchievement(data as UserTargetAchievementEmailData),
				};
			case EmailType.USER_TARGET_MILESTONE:
				return {
					subject: 'You\'ve Reached a Milestone!',
					body: UserTargetMilestone(data as UserTargetMilestoneEmailData),
				};
			case EmailType.USER_TARGET_DEADLINE_REMINDER:
				return {
					subject: 'Your Target Deadline Approaching',
					body: UserTargetDeadlineReminder(data as UserTargetDeadlineReminderEmailData),
				};
			case EmailType.USER_TARGET_PERFORMANCE_ALERT:
				return {
					subject: 'Your Performance Needs Attention',
					body: UserTargetPerformanceAlert(data as UserTargetPerformanceAlertEmailData),
				};
			case EmailType.USER_TARGET_ERP_UPDATE_CONFIRMATION:
				return {
					subject: 'Your ERP System Update is Ready',
					body: UserTargetERPUpdateConfirmation(data as UserTargetERPUpdateConfirmationEmailData),
				};
			case EmailType.USER_TARGET_CONTRIBUTION_PROGRESS:
				return {
					subject: 'Great Progress Update - Keep The Momentum Going!',
					body: UserTargetContributionProgress(data as UserTargetContributionProgressEmailData),
				};
			case EmailType.USER_TARGET_PERIOD_SUMMARY:
				return {
					subject: 'Your Target Period Summary',
					body: UserTargetPeriodSummary(data as UserTargetPeriodSummaryEmailData),
				};
			case EmailType.USER_TARGET_SET:
				return {
					subject: 'New Target Set for You',
					body: UserTargetSet(data as UserTargetSetEmailData),
				};
			case EmailType.USER_TARGET_UPDATED:
				return {
					subject: 'Your Targets Have Been Updated',
					body: UserTargetUpdated(data as UserTargetUpdatedEmailData),
				};
			case EmailType.USER_TARGET_DELETED:
				return {
					subject: 'Target Removed',
					body: UserTargetDeleted(data as UserTargetDeletedEmailData),
				};
			case EmailType.APP_UPDATE_NOTIFICATION:
				return {
					subject: 'App Update Available - New Features Include Leads & PDF Uploads!',
					body: AppUpdateNotification(data as AppUpdateNotificationData),
				};
			case EmailType.BULK_ANNOUNCEMENT:
				const bulkData = data as BulkAnnouncementEmailData;
				return {
					subject: bulkData.subject,
					body: BulkAnnouncement(bulkData),
				};
			case EmailType.CLIENT_COMMUNICATION_REMINDER:
				return {
					subject: 'Client Communication Reminder - Action Required',
					body: ClientCommunicationReminder(data as ClientCommunicationReminderData),
				};
			case EmailType.APPROVAL_CREATED:
				return {
					subject: 'Approval Request Created',
					body: ApprovalCreated(data as ApprovalEmailData), 
				};
			case EmailType.APPROVAL_SUBMITTED:
				return {
					subject: 'Approval Request Submitted',
					body: ApprovalSubmitted(data as ApprovalEmailData),
				};
			case EmailType.APPROVAL_APPROVED:
				return {
					subject: 'Approval Approved',
					body: ApprovalApproved(data as ApprovalEmailData),
				};
			case EmailType.APPROVAL_REJECTED:
				return {
					subject: 'Approval Rejected',
					body: ApprovalRejected(data as ApprovalEmailData),
				};
			case EmailType.APPROVAL_ESCALATED:
				return {
					subject: 'Approval Escalated',
					body: ApprovalEscalated(data as ApprovalEmailData),
				};
			case EmailType.APPROVAL_UPDATED:
				return {
					subject: 'Approval Updated',
					body: ApprovalUpdated(data as ApprovalEmailData),
				};
			case EmailType.APPROVAL_WITHDRAWN:
				return {
					subject: 'Approval Withdrawn',
					body: ApprovalWithdrawn(data as ApprovalEmailData),
				};
			case EmailType.APPROVAL_ARCHIVED:
				return {
					subject: 'Approval Archived',
					body: ApprovalArchived(data as ApprovalEmailData),
				};
			case EmailType.APPROVAL_DELETED:
				return {
					subject: 'Approval Deleted',
					body: ApprovalDeleted(data as ApprovalEmailData),
				};
			case EmailType.LOYALTY_WELCOME:
				return {
					subject: 'Welcome to Our Loyalty Program!',
					body: LoyaltyWelcome(data as LoyaltyWelcomeData),
				};
			case EmailType.LOYALTY_TIER_UPGRADE:
				return {
					subject: 'Congratulations! You\'ve Upgraded Your Tier!',
					body: LoyaltyTierUpgrade(data as LoyaltyTierUpgradeData),
				};
			case EmailType.LOYALTY_REWARD_CLAIMED:
				return {
					subject: 'Your Reward is Ready!',
					body: LoyaltyRewardClaimed(data as LoyaltyRewardClaimedData),
				};
			default:
				const caseTime = Date.now() - caseStartTime;
				const generationTime = Date.now() - startTime;
				this.logger.error(`[${operationId}] Unknown email template type: ${type} after ${generationTime}ms (case processing: ${caseTime}ms)`);
				throw new NotFoundException(`Unknown email template type: ${type}`);
			}
		} catch (error) {
			const generationTime = Date.now() - startTime;
			this.logger.error(`[${operationId}] Failed to generate email template for type: ${type} after ${generationTime}ms`, error.stack);
			
			// Log additional context for debugging
			this.logger.error(`[${operationId}] Template generation context:`, {
				emailType: type,
				hasData: !!data,
				dataKeys: data ? Object.keys(data) : [],
				errorType: error.constructor.name,
				errorMessage: error.message,
			});
			
			throw error;
		}
	}
}
