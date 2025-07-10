import { Injectable, NotFoundException } from '@nestjs/common';
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
import { NewUserAdminNotification, NewUserWelcome, UserReInvitation } from '../lib/templates/emails';
// Lead related templates
import { LeadConvertedClient, LeadConvertedCreator, LeadReminder, LeadAssignedToUser, MonthlyUnattendedLeadsReport } from '../lib/templates/emails';
// Client auth templates
import { ClientPasswordReset, ClientPasswordChanged, ClientAccountCreated, ClientCommunicationReminder } from '../lib/templates/emails';
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
	UserTargetPeriodSummaryEmailData,
	AppUpdateNotificationData,
	ClientCommunicationReminderData,
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
	UserTargetPeriodSummary,
	AppUpdateNotification,
} from '../lib/templates/emails';

// Import the new type
import { MonthlyUnattendedLeadsReportData } from '../lib/types/email-templates.types';

@Injectable()
export class CommunicationService {
	private readonly emailService: nodemailer.Transporter;

	constructor(
		private readonly configService: ConfigService,
		private readonly userService: UserService,
		@InjectRepository(CommunicationLog)
		private communicationLogRepository: Repository<CommunicationLog>,
	) {
		this.emailService = nodemailer.createTransport({
			host: this.configService.get<string>('SMTP_HOST'),
			port: this.configService.get<number>('SMTP_PORT'),
			secure: this.configService.get<number>('SMTP_PORT') === 465,
			auth: {
				user: this.configService.get<string>('SMTP_USER'),
				pass: this.configService.get<string>('SMTP_PASS'),
			},
			tls: {
				rejectUnauthorized: false,
			},
		});
	}

	@OnEvent('send.email')
	async sendEmail<T extends EmailType>(emailType: T, recipientsEmails: string[], data: EmailTemplateData<T>) {
		try {
			console.log(`📧 [EmailService] Email event received: ${emailType}`);
			console.log(`📧 [EmailService] Recipients (${recipientsEmails?.length || 0}): ${recipientsEmails?.join(', ')}`);
			
			if (!recipientsEmails || recipientsEmails.length === 0) {
				console.log('❌ [EmailService] ERROR: No recipients provided for email');
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			console.log(`📧 [EmailService] Generating template for: ${emailType}`);
			const template = this.getEmailTemplate(emailType, data);
			console.log(`📧 [EmailService] Template generated successfully for: ${emailType}`);
			console.log(`📧 [EmailService] Subject: "${template.subject}"`);

			// Construct the from field with display name and email
			const emailFrom = this.configService.get<string>('SMTP_FROM');
			const emailFromName = this.configService.get<string>('EMAIL_FROM_NAME');
			const fromField = emailFromName ? `"${emailFromName}" <${emailFrom}>` : emailFrom;

			console.log(`📧 [EmailService] Sending email via SMTP...`);
			console.log(`📧 [EmailService] From: ${fromField}`);
			const result = await this.emailService.sendMail({
				from: fromField,
				to: recipientsEmails,
				subject: template.subject,
				html: template.body,
			});

			console.log(`✅ [EmailService] Email sent successfully!`);
			console.log(`📧 [EmailService] MessageId: ${result.messageId}`);
			console.log(`📧 [EmailService] Accepted: ${result.accepted?.length || 0}, Rejected: ${result.rejected?.length || 0}`);

			// Log the communication to database
			await this.communicationLogRepository.save({
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

			console.log(`📧 Email log saved for ${emailType}`);
			return result;
		} catch (error) {
			console.error(`❌ [EmailService] ERROR sending ${emailType} email:`, error.message);
			console.error(`❌ [EmailService] Failed recipients: ${recipientsEmails?.join(', ')}`);
			
			const smtpHost = this.configService.get<string>('SMTP_HOST');
			const smtpUser = this.configService.get<string>('SMTP_USER');
			const smtpFrom = this.configService.get<string>('SMTP_FROM');
			const emailFromName = this.configService.get<string>('EMAIL_FROM_NAME');
			console.error('❌ [EmailService] SMTP Configuration:', {
				SMTP_HOST: smtpHost,
				SMTP_USER: smtpUser,
				SMTP_FROM: smtpFrom,
				EMAIL_FROM_NAME: emailFromName,
			});
			
			// Log failed email attempt
			try {
				await this.communicationLogRepository.save({
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
				console.log(`📊 [EmailService] Error logged to database for ${emailType}`);
			} catch (logError) {
				console.error(`❌ [EmailService] Failed to log error:`, logError.message);
			}
			
			throw error;
		}
	}

	async sendAppUpdateNotification(userEmails: string[], appUpdateData: AppUpdateNotificationData) {
		console.log('📱 [EmailService] Sending app update notification to users');
		
		// Send email to all users
		const emailPromises = userEmails.map(async (email) => {
			try {
				await this.sendEmail(EmailType.APP_UPDATE_NOTIFICATION, [email], appUpdateData);
				console.log(`✅ [EmailService] App update notification sent to: ${email}`);
			} catch (error) {
				console.error(`❌ [EmailService] Failed to send app update notification to ${email}:`, error);
			}
		});

		await Promise.all(emailPromises);
		
		console.log(`📱 [EmailService] App update notification process completed for ${userEmails.length} users`);
		return { success: true, message: `App update notification sent to ${userEmails.length} users` };
	}

	private getEmailTemplate<T extends EmailType>(type: T, data: EmailTemplateData<T>): EmailTemplate {
		switch (type) {
			case EmailType.SIGNUP:
				return {
					subject: 'Welcome to Our Platform',
					body: Signup(data as SignupEmailData),
				};
			case EmailType.VERIFICATION:
				return {
					subject: 'Verify Your Email',
					body: Verification(data as VerificationEmailData),
				};
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
			case EmailType.USER_TARGET_PERIOD_SUMMARY:
				return {
					subject: 'Your Target Period Summary',
					body: UserTargetPeriodSummary(data as UserTargetPeriodSummaryEmailData),
				};
			case EmailType.APP_UPDATE_NOTIFICATION:
				return {
					subject: 'App Update Available - New Features Include Leads & PDF Uploads!',
					body: AppUpdateNotification(data as AppUpdateNotificationData),
				};
			case EmailType.CLIENT_COMMUNICATION_REMINDER:
				return {
					subject: 'Client Communication Reminder - Action Required',
					body: ClientCommunicationReminder(data as ClientCommunicationReminderData),
				};
			default:
				throw new NotFoundException(`Unknown email template type: ${type}`);
		}
	}
}
