import * as Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as juice from 'juice';
import { Logger } from '@nestjs/common';
import {
	SignupEmailData,
	VerificationEmailData,
	PasswordResetData,
	PasswordResetRequestData,
	PasswordChangedData,
	ClientAccountCreatedData,
	InvoiceData,
	DailyReportData,
	LicenseEmailData,
	LicenseLimitData,
	QuotationData,
	QuotationInternalData,
	QuotationResellerData,
	TaskEmailData,
	TaskReminderData,
	NewUserAdminNotificationData,
	NewUserWelcomeData,
	TaskCompletedEmailData,
	LeadConvertedClientData,
	LeadConvertedCreatorData,
	TaskFlagEmailData,
	TaskFeedbackEmailData,
	LeadReminderData,
	TaskOverdueMissedData,
	LeadAssignedToUserData,
	OrderReceivedClientData,
	QuotationWarehouseData,
	BlankQuotationData,
	BlankQuotationInternalData,
	LicenseTransferEmailData,
	WarningIssuedEmailData,
	WarningUpdatedEmailData,
	WarningExpiredEmailData,
	LeaveApplicationConfirmationData,
	LeaveNewApplicationAdminData,
	LeaveStatusUpdateUserData,
	LeaveStatusUpdateAdminData,
	LeaveDeletedNotificationData,
	MorningReportData,
	EveningReportData,
	UserReInvitationData,
	UserPreferencesUpdatedData,
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
	OvertimeReminderData,
	AttendanceMissedShiftAlertData,
	AttendanceLateShiftAlertData,
	AttendanceShiftStartedData,
	AttendanceShiftEndedData,
	AttendanceShiftStartReminderData,
	AttendanceShiftEndReminderData,
	AttendanceBreakStartedData,
	AttendanceBreakEndedData,
	AttendanceRecordsRequestData,
	PayslipAvailableEmailData,
	PayslipUploadedAdminEmailData,
	MonthlyUnattendedLeadsReportData,
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
	ClientProfileUpdateConfirmationData,
	ClientProfileUpdateAdminData,
	ClientCommunicationReminderData,
	ClientVisitReminderData,
	ClientVisitCompletedData,
	ClientVisitOverdueData,
	ClientVisitWeeklyReportData,
	ApprovalEmailData,
} from '../types/email-templates.types';

class EmailTemplateService {
	private readonly logger = new Logger(EmailTemplateService.name);
	private templatesPath: string;
	private compiledTemplates: Map<string, HandlebarsTemplateDelegate> = new Map();

	constructor() {
		const startTime = Date.now();
		const opId = `INIT_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
		
		this.logger.log(`[${opId}] Initializing Email Template Service...`);
		
		try {
			// Try multiple potential template paths for maximum deployment compatibility
			const potentialPaths = [
				// Primary: Relative to project root (works for most deployments)
				join(process.cwd(), 'dist', 'lib', 'templates', 'handlebars'),
				// Fallback: Relative to current service file location
				join(__dirname, '../templates/handlebars'),
				// Alternative: Direct relative to source in case dist structure differs
				join(process.cwd(), 'src', 'lib', 'templates', 'handlebars')
			];

			this.templatesPath = this.findValidTemplatesPath(potentialPaths, opId);
			this.initializeHandlebars(opId);
			
			const initTime = Date.now() - startTime;
			this.logger.log(`[${opId}] Email Template Service initialized successfully in ${initTime}ms`);
		} catch (error) {
			const initTime = Date.now() - startTime;
			this.logger.error(`[${opId}] Failed to initialize Email Template Service after ${initTime}ms`, error.stack);
			throw error;
		}
	}

	private findValidTemplatesPath(paths: string[], opId: string): string {
		const { existsSync } = require('fs');
		
		for (const path of paths) {
			if (existsSync(path)) {
				this.logger.debug(`[${opId}] Using templates path: ${path}`);
				return path;
			}
		}
		
		// If no valid path found, log all attempted paths and use the first one
		this.logger.warn(`[${opId}] No valid templates path found. Using fallback: ${paths[0]}`);
		return paths[0];
	}

	private initializeHandlebars(opId: string) {
		const startTime = Date.now();
		this.logger.debug(`[${opId}] Initializing Handlebars...`);
		
		try {
			// Clear any existing compiled templates to ensure fresh compilation
			this.compiledTemplates.clear();
			
			// Register partials
			this.registerPartials(opId);

			// Register helpers
			this.registerHelpers(opId);
			
			// Preload all email templates
			this.preloadAllTemplates(opId);
			
			const initTime = Date.now() - startTime;
			this.logger.debug(`[${opId}] Handlebars initialization completed in ${initTime}ms`);
		} catch (error) {
			const initTime = Date.now() - startTime;
			this.logger.error(`[${opId}] Handlebars initialization failed after ${initTime}ms`, error.stack);
			throw error;
		}
	}

	private registerPartials(opId: string) {
		const startTime = Date.now();
		const partialsPath = join(this.templatesPath, 'partials');
		const layoutsPath = join(this.templatesPath, 'layouts');

		try {
			// Register base layout with proper layout functionality
			const baseLayoutPath = join(layoutsPath, 'base.hbs');
			const { existsSync } = require('fs');
			
			if (existsSync(baseLayoutPath)) {
				const baseLayout = readFileSync(baseLayoutPath, 'utf8');
				
				// Register as both a partial and a block helper for layout functionality
				Handlebars.registerPartial('base', baseLayout);
				
				// Register a custom block helper for layout support
				Handlebars.registerHelper('base', function(options: any) {
					try {
						const content = options.fn(this);
						const layoutData = { ...this, body: content };
						const template = Handlebars.compile(baseLayout);
						return new Handlebars.SafeString(template(layoutData));
					} catch (error) {
						// Return the content without layout as fallback
						return new Handlebars.SafeString(options.fn(this));
					}
				});
			} else {
				throw new Error(`Base layout file not found: ${baseLayoutPath}`);
			}

			// Register additional partials if they exist
			const partials = ['header', 'footer', 'button', 'card', 'alert'];
			let registered = 0;
			partials.forEach((partial) => {
				try {
					const partialPath = join(partialsPath, `${partial}.hbs`);
					if (existsSync(partialPath)) {
						const content = readFileSync(partialPath, 'utf8');
						Handlebars.registerPartial(partial, content);
						registered++;
					}
				} catch (error) {
					this.logger.warn(`[${opId}] Could not load partial: ${partial}`);
				}
			});
			
			const partialTime = Date.now() - startTime;
			this.logger.debug(`[${opId}] Registered base layout + ${registered}/${partials.length} partials in ${partialTime}ms`);
		} catch (error) {
			const partialTime = Date.now() - startTime;
			this.logger.error(`[${opId}] Failed to register partials after ${partialTime}ms`, error.message);
			throw error; // Re-throw since base layout is critical for email templates
		}
	}

	private registerHelpers(opId: string) {
		const startTime = Date.now();
		
		// Import and register all helpers
		try {
			require('../templates/handlebars/helpers/index');
			const helperTime = Date.now() - startTime;
			this.logger.debug(`[${opId}] Loaded Handlebars helpers in ${helperTime}ms`);
		} catch (error) {
			this.logger.warn(`[${opId}] Could not load helpers, using fallback`);

			// Register essential helpers as fallback
			Handlebars.registerHelper('formatDate', function (date: string | Date) {
				if (!date) return 'N/A';
				const dateObj = new Date(date);
				return dateObj.toLocaleDateString('en-ZA', {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
				});
			});

			Handlebars.registerHelper('formatCurrency', function (amount: number, currency: string) {
				return new Intl.NumberFormat('en-ZA', {
					style: 'currency',
					currency: currency || 'USD',
				}).format(amount);
			});

			Handlebars.registerHelper('fallback', function (value: any, fallback: any) {
				return value || fallback;
			});

			Handlebars.registerHelper('concat', function (...args: any[]) {
				args.pop();
				return args.join('');
			});

			// Switch helpers for conditional rendering
			Handlebars.registerHelper('switch', function(value: any, options: any) {
				this.switchValue = value;
				this.switchBreak = false;
				
				const content = options.fn(this);
				delete this.switchValue;
				delete this.switchBreak;
				
				return content;
			});

			Handlebars.registerHelper('case', function(value: any, options: any) {
				if (this.switchBreak || this.switchValue !== value) {
					return '';
				}
				
				this.switchBreak = true;
				return options.fn(this);
			});

			Handlebars.registerHelper('default', function(options: any) {
				if (!this.switchBreak) {
					return options.fn(this);
				}
				
				return '';
			});
			
			const helperTime = Date.now() - startTime;
			this.logger.debug(`[${opId}] Registered fallback helpers in ${helperTime}ms`);
		}
	}

	private getTemplate(templatePath: string): HandlebarsTemplateDelegate {
		if (this.compiledTemplates.has(templatePath)) {
			return this.compiledTemplates.get(templatePath)!;
		}

		const startTime = Date.now();
		try {
			const fullPath = join(this.templatesPath, 'emails', templatePath);
			const { existsSync } = require('fs');
			
			if (!existsSync(fullPath)) {
				throw new Error(`Template file not found: ${fullPath}`);
			}
			
			const templateContent = readFileSync(fullPath, 'utf8');
			const compiled = Handlebars.compile(templateContent);
			this.compiledTemplates.set(templatePath, compiled);
			
			const loadTime = Date.now() - startTime;
			this.logger.debug(`Loaded template: ${templatePath} (${loadTime}ms)`);
			return compiled;
		} catch (error) {
			const loadTime = Date.now() - startTime;
			this.logger.error(`Failed to load template: ${templatePath} after ${loadTime}ms`, error.message);
			throw new Error(`Template not found: ${templatePath} - ${error.message}`);
		}
	}

	private renderTemplate(templatePath: string, data: any): string {
		const startTime = Date.now();
		try {
			const template = this.getTemplate(templatePath);

			// Inject environment-based global variables into template context
			const enrichedData = {
				...data,
				// Global environment variables
				appName: process.env.APP_NAME || 'LORO',
				appUrl: process.env.APP_URL || 'https://loro.co.za/landing-page',
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
				supportPhone: process.env.SUPPORT_PHONE || '+27 12 345 6789',
				companyName: process.env.COMPANY_NAME || 'LORO',
				companyReg: process.env.COMPANY_REG || '2023/123456/07',
				vatNumber: process.env.VAT_NUMBER || '4567890123',
				headerTagline: process.env.HEADER_TAGLINE || 'Empowering African Business',
				// Email sender information
				emailFromName: process.env.EMAIL_FROM_NAME || process.env.COMPANY_NAME || 'LORO',
				emailFromAddress: process.env.SMTP_FROM || process.env.SUPPORT_EMAIL || 'support@loro.africa',
				currentYear: new Date().getFullYear(),
				// Social media links from environment
				socialLinks: {
					linkedin: process.env.SOCIAL_LINKEDIN_URL || '#',
					twitter: process.env.SOCIAL_TWITTER_URL || '#',
					facebook: process.env.SOCIAL_FACEBOOK_URL || '#',
					instagram: process.env.SOCIAL_INSTAGRAM_URL || '#',
				},
				// Legal links from environment
				privacyPolicyUrl:
					process.env.PRIVACY_POLICY_URL || `${process.env.APP_URL || 'https://loro.co.za/landing-page'}/privacy`,
				termsUrl: process.env.TERMS_URL || `${process.env.APP_URL || 'https://loro.co.za/landing-page'}/terms`,
				unsubscribeUrl:
					process.env.UNSUBSCRIBE_URL ||
					`${process.env.APP_URL || 'https://loro.co.za/landing-page'}/unsubscribe`,
			};

			const renderedTemplate = template(enrichedData);
			
			// Inline CSS for email client compatibility
			const inlinedTemplate = juice(renderedTemplate);
			
			const renderTime = Date.now() - startTime;
			this.logger.debug(`Rendered template: ${templatePath} (${renderTime}ms)`);
			return inlinedTemplate;
		} catch (error) {
			const renderTime = Date.now() - startTime;
			this.logger.error(`Failed to render template: ${templatePath} after ${renderTime}ms`, error.message);
			
			// Provide more specific error information for debugging
			if (error.message.includes('Missing helper')) {
				this.logger.error(`Handlebars helper missing. Available data keys: ${Object.keys(data).join(', ')}`);
				this.logger.error(`Make sure all required helpers are registered in the helpers/index.ts file`);
			}
			
			throw new Error(`Template rendering failed: ${templatePath} - ${error.message}`);
		}
	}

	// Auth Templates
	signup(data: SignupEmailData): string {
		return this.renderTemplate('auth/signup.hbs', data);
	}

	verification(data: VerificationEmailData): string {
		return this.renderTemplate('auth/verification.hbs', data);
	}

	passwordReset(data: PasswordResetData): string {
		return this.renderTemplate('auth/password-reset.hbs', data);
	}

	passwordResetRequest(data: PasswordResetRequestData): string {
		return this.renderTemplate('auth/password-reset-request.hbs', data);
	}

	passwordChanged(data: PasswordChangedData): string {
		return this.renderTemplate('auth/password-changed.hbs', data);
	}

	// Quotation Templates
	newQuotationClient(data: QuotationData): string {
		return this.renderTemplate('quotations/client-new.hbs', data);
	}

	newQuotationInternal(data: QuotationInternalData): string {
		return this.renderTemplate('quotations/internal-new.hbs', data);
	}

	newQuotationReseller(data: QuotationResellerData): string {
		return this.renderTemplate('quotations/reseller-new.hbs', data);
	}

	quotationStatusUpdate(data: QuotationData): string {
		return this.renderTemplate('quotations/status-update.hbs', data);
	}

	newQuotationWarehouseFulfillment(data: QuotationWarehouseData): string {
		return this.renderTemplate('quotations/warehouse-fulfillment.hbs', data);
	}

	// Blank quotation templates
	blankQuotationClient(data: BlankQuotationData): string {
		return this.renderTemplate('emails/quotations/blank-quotation-client.hbs', data);
	}

	blankQuotationInternal(data: BlankQuotationInternalData): string {
		return this.renderTemplate('emails/quotations/blank-quotation-internal.hbs', data);
	}

	// Business Templates
	invoice(data: InvoiceData): string {
		return this.renderTemplate('business/invoice.hbs', data);
	}

	orderReceivedClient(data: OrderReceivedClientData): string {
		return this.renderTemplate('business/order-received-client.hbs', data);
	}

	// Task Templates
	newTask(data: TaskEmailData): string {
		return this.renderTemplate('tasks/new-task.hbs', data);
	}

	taskUpdated(data: TaskEmailData): string {
		return this.renderTemplate('tasks/updated.hbs', data);
	}

	taskCompleted(data: TaskCompletedEmailData): string {
		return this.renderTemplate('tasks/completed.hbs', data);
	}

	taskReminderAssignee(data: TaskReminderData): string {
		return this.renderTemplate('tasks/reminder-assignee.hbs', data);
	}

	taskReminderCreator(data: TaskReminderData): string {
		return this.renderTemplate('tasks/reminder-creator.hbs', data);
	}

	taskFlagCreated(data: TaskFlagEmailData): string {
		return this.renderTemplate('tasks/flag-created.hbs', data);
	}

	taskFlagUpdated(data: TaskFlagEmailData): string {
		return this.renderTemplate('tasks/flag-updated.hbs', data);
	}

	taskFlagResolved(data: TaskFlagEmailData): string {
		return this.renderTemplate('tasks/flag-resolved.hbs', data);
	}

	taskFeedbackAdded(data: TaskFeedbackEmailData): string {
		return this.renderTemplate('tasks/feedback-added.hbs', data);
	}

	taskOverdueMissed(data: TaskOverdueMissedData): string {
		return this.renderTemplate('tasks/overdue-missed.hbs', data);
	}

	// Lead Templates
	leadReminder(data: LeadReminderData): string {
		return this.renderTemplate('leads/reminder.hbs', data);
	}

	leadConvertedClient(data: LeadConvertedClientData): string {
		return this.renderTemplate('leads/converted-client.hbs', data);
	}

	leadConvertedCreator(data: LeadConvertedCreatorData): string {
		return this.renderTemplate('leads/converted-creator.hbs', data);
	}

	leadAssignedToUser(data: LeadAssignedToUserData): string {
		return this.renderTemplate('leads/assigned-to-user.hbs', data);
	}

	monthlyUnattendedLeadsReport(data: MonthlyUnattendedLeadsReportData): string {
		return this.renderTemplate('leads/monthly-unattended-leads-report.hbs', data);
	}

	// License Templates
	licenseCreated(data: LicenseEmailData): string {
		return this.renderTemplate('licenses/created.hbs', data);
	}

	licenseUpdated(data: LicenseEmailData): string {
		return this.renderTemplate('licenses/updated.hbs', data);
	}

	licenseRenewed(data: LicenseEmailData): string {
		return this.renderTemplate('licenses/renewed.hbs', data);
	}

	licenseActivated(data: LicenseEmailData): string {
		return this.renderTemplate('licenses/activated.hbs', data);
	}

	licenseSuspended(data: LicenseEmailData): string {
		return this.renderTemplate('licenses/suspended.hbs', data);
	}

	licenseLimitReached(data: LicenseLimitData): string {
		return this.renderTemplate('licenses/limit-reached.hbs', data);
	}

	licenseTransferredFrom(data: LicenseTransferEmailData): string {
		return this.renderTemplate('licenses/transferred-from.hbs', data);
	}

	licenseTransferredTo(data: LicenseTransferEmailData): string {
		return this.renderTemplate('licenses/transferred-to.hbs', data);
	}

	// Report Templates
	dailyReport(data: DailyReportData): string {
		return this.renderTemplate('reports/daily-report.hbs', data);
	}

	userDailyReport(data: DailyReportData): string {
		return this.renderTemplate('reports/user-daily-report.hbs', data);
	}

	// System Templates
	newUserAdminNotification(data: NewUserAdminNotificationData): string {
		return this.renderTemplate('system/new-user-admin-notification.hbs', data);
	}

	// User welcome template
	newUserWelcome(data: NewUserWelcomeData): string {
		return this.renderTemplate('auth/new-user-welcome.hbs', data);
	}

	// User re-invitation template
	userReInvitation(data: UserReInvitationData): string {
		return this.renderTemplate('auth/user-re-invitation.hbs', data);
	}

	// User preferences updated template
	userPreferencesUpdated(data: UserPreferencesUpdatedData): string {
		return this.renderTemplate('system/user-preferences-updated.hbs', data);
	}

	// Client Templates
	clientPasswordReset(data: PasswordResetData): string {
		return this.renderTemplate('client/password-reset.hbs', data);
	}

	clientPasswordChanged(data: PasswordChangedData): string {
		return this.renderTemplate('client/password-changed.hbs', data);
	}

	clientAccountCreated(data: ClientAccountCreatedData): string {
		return this.renderTemplate('client/account-created.hbs', data);
	}

	// Warning Templates
	warningIssued(data: WarningIssuedEmailData): string {
		return this.renderTemplate('warnings/issued.hbs', data);
	}

	warningUpdated(data: WarningUpdatedEmailData): string {
		return this.renderTemplate('warnings/updated.hbs', data);
	}

	warningExpired(data: WarningExpiredEmailData): string {
		return this.renderTemplate('warnings/expired.hbs', data);
	}

	// Leave Templates
	leaveApplicationConfirmation(data: LeaveApplicationConfirmationData): string {
		return this.renderTemplate('leave/application-confirmation.hbs', data);
	}

	leaveNewApplicationAdmin(data: LeaveNewApplicationAdminData): string {
		return this.renderTemplate('leave/new-application-admin.hbs', data);
	}

	leaveStatusUpdateUser(data: LeaveStatusUpdateUserData): string {
		return this.renderTemplate('leave/status-update-user.hbs', data);
	}

	leaveStatusUpdateAdmin(data: LeaveStatusUpdateAdminData): string {
		return this.renderTemplate('leave/status-update-admin.hbs', data);
	}

	leaveDeletedNotification(data: LeaveDeletedNotificationData): string {
		return this.renderTemplate('leave/deleted-notification.hbs', data);
	}

	// Attendance Report Templates
	attendanceMorningReport(data: MorningReportData): string {
		return this.renderTemplate('attendance/morning-report.hbs', data);
	}

	attendanceEveningReport(data: EveningReportData): string {
		return this.renderTemplate('attendance/evening-report.hbs', data);
	}

	overtimeReminder(data: OvertimeReminderData): string {
		return this.renderTemplate('attendance/overtime-reminder.hbs', data);
	}

	attendanceMissedShiftAlert(data: AttendanceMissedShiftAlertData): string {
		return this.renderTemplate('attendance/missed-shift-alert.hbs', data);
	}

	attendanceLateShiftAlert(data: AttendanceLateShiftAlertData): string {
		return this.renderTemplate('attendance/late-shift-alert.hbs', data);
	}

	attendanceShiftStarted(data: AttendanceShiftStartedData): string {
		return this.renderTemplate('attendance/shift-started.hbs', data);
	}

	attendanceShiftEnded(data: AttendanceShiftEndedData): string {
		return this.renderTemplate('attendance/shift-ended.hbs', data);
	}

	attendanceShiftStartReminder(data: AttendanceShiftStartReminderData): string {
		return this.renderTemplate('attendance/shift-start-reminder.hbs', data);
	}

	attendanceShiftEndReminder(data: AttendanceShiftEndReminderData): string {
		return this.renderTemplate('attendance/shift-end-reminder.hbs', data);
	}

	attendanceBreakStarted(data: AttendanceBreakStartedData): string {
		return this.renderTemplate('attendance/break-started.hbs', data);
	}

	attendanceBreakEnded(data: AttendanceBreakEndedData): string {
		return this.renderTemplate('attendance/break-ended.hbs', data);
	}

	attendanceRecordsRequest(data: AttendanceRecordsRequestData): string {
		return this.renderTemplate('attendance/records-request.hbs', data);
	}

	// Asset related email templates
	assetAssigned(data: AssetEmailData): string {
		return this.renderTemplate('assets/asset-assigned.hbs', data);
	}

	assetTransferred(data: AssetTransferredEmailData): string {
		return this.renderTemplate('assets/asset-transferred.hbs', data);
	}

	assetUpdated(data: AssetUpdatedEmailData): string {
		return this.renderTemplate('assets/asset-updated.hbs', data);
	}

	assetRemoved(data: AssetEmailData): string {
		return this.renderTemplate('assets/asset-removed.hbs', data);
	}

	assetRestored(data: AssetEmailData): string {
		return this.renderTemplate('assets/asset-restored.hbs', data);
	}

	assetInsuranceExpiryWarning(data: AssetInsuranceExpiryWarningEmailData): string {
		return this.renderTemplate('assets/insurance-expiry-warning.hbs', data);
	}

	assetCreatedAdmin(data: AssetAdminNotificationEmailData): string {
		return this.renderTemplate('assets/asset-created-admin.hbs', data);
	}

	assetDeletedAdmin(data: AssetAdminNotificationEmailData): string {
		return this.renderTemplate('assets/asset-deleted-admin.hbs', data);
	}

	// Additional auth email templates
	loginNotification(data: LoginNotificationEmailData): string {
		return this.renderTemplate('auth/login-notification.hbs', data);
	}

	clientLoginNotification(data: LoginNotificationEmailData): string {
		return this.renderTemplate('client/login-notification.hbs', data);
	}

	failedLoginAttempt(data: LoginNotificationEmailData): string {
		return this.renderTemplate('auth/failed-login-attempt.hbs', data);
	}

	clientFailedLoginAttempt(data: LoginNotificationEmailData): string {
		return this.renderTemplate('client/failed-login-attempt.hbs', data);
	}

	emailVerified(data: EmailVerifiedEmailData): string {
		return this.renderTemplate('auth/email-verified.hbs', data);
	}

	// Claims Templates
	claimCreated(data: ClaimEmailData): string {
		return this.renderTemplate('claims/created.hbs', data);
	}

	claimCreatedAdmin(data: ClaimEmailData): string {
		return this.renderTemplate('claims/new-claim-admin.hbs', data);
	}

	claimStatusUpdate(data: ClaimStatusUpdateEmailData): string {
		return this.renderTemplate('claims/status-update.hbs', data);
	}

	claimApproved(data: ClaimStatusUpdateEmailData): string {
		return this.renderTemplate('claims/approved.hbs', data);
	}

	claimRejected(data: ClaimStatusUpdateEmailData): string {
		return this.renderTemplate('claims/rejected.hbs', data);
	}

	claimPaid(data: ClaimStatusUpdateEmailData): string {
		return this.renderTemplate('claims/paid.hbs', data);
	}

	// Lead Templates
	leadCreated(data: LeadCreatedEmailData): string {
		return this.renderTemplate('leads/created.hbs', data);
	}

	leadStatusUpdate(data: LeadStatusUpdateEmailData): string {
		return this.renderTemplate('leads/status-update.hbs', data);
	}

	// Journal Templates
	journalCreated(data: JournalEmailData): string {
		return this.renderTemplate('journals/created.hbs', data);
	}

	journalUpdated(data: JournalUpdatedEmailData): string {
		return this.renderTemplate('journals/updated.hbs', data);
	}

	journalDeleted(data: JournalDeletedEmailData): string {
		return this.renderTemplate('journals/deleted.hbs', data);
	}

	// Payslip Templates
	payslipAvailable(data: PayslipAvailableEmailData): string {
		return this.renderTemplate('payslips/available.hbs', data);
	}

	payslipUploadedAdmin(data: PayslipUploadedAdminEmailData): string {
		return this.renderTemplate('payslips/uploaded-admin.hbs', data);
	}

	// Target Achievement Admin Notification Templates
	userTargetAchievementAdmin(data: UserTargetAchievementAdminData): string {
		return this.renderTemplate('targets/user-target-achievement-admin.hbs', data);
	}

	leadTargetAchievementAdmin(data: LeadTargetAchievementAdminData): string {
		return this.renderTemplate('targets/lead-target-achievement-admin.hbs', data);
	}

	// Target Achievement Templates (User-facing)
	userTargetAchievement(data: UserTargetAchievementEmailData): string {
		return this.renderTemplate('targets/achievement.hbs', data);
	}

	userTargetMilestone(data: UserTargetMilestoneEmailData): string {
		return this.renderTemplate('targets/milestone.hbs', data);
	}

	userTargetDeadlineReminder(data: UserTargetDeadlineReminderEmailData): string {
		return this.renderTemplate('targets/deadline-reminder.hbs', data);
	}

	userTargetPerformanceAlert(data: UserTargetPerformanceAlertEmailData): string {
		return this.renderTemplate('targets/performance-alert.hbs', data);
	}

	userTargetERPUpdateConfirmation(data: UserTargetERPUpdateConfirmationEmailData): string {
		return this.renderTemplate('targets/erp-update-confirmation.hbs', data);
	}

	userTargetContributionProgress(data: UserTargetContributionProgressEmailData): string {
		return this.renderTemplate('targets/contribution-progress.hbs', data);
	}

	userTargetPeriodSummary(data: UserTargetPeriodSummaryEmailData): string {
		return this.renderTemplate('targets/period-summary.hbs', data);
	}

	userTargetSet(data: UserTargetSetEmailData): string {
		return this.renderTemplate('targets/target-set.hbs', data);
	}

	userTargetUpdated(data: UserTargetUpdatedEmailData): string {
		return this.renderTemplate('targets/target-updated.hbs', data);
	}

	userTargetDeleted(data: UserTargetDeletedEmailData): string {
		return this.renderTemplate('targets/target-deleted.hbs', data);
	}

	// App/System Templates
	appUpdateNotification(data: AppUpdateNotificationData): string {
		return this.renderTemplate('system/app-update-notification.hbs', data);
	}

	bulkAnnouncement(data: BulkAnnouncementEmailData): string {
		// Prepare data for base template
		const templateData = {
			...data,
			headerTitle: data.title || 'Important Announcement',
			headerSubtitle: data.greeting ? `${data.greeting} ${data.recipientName}` : `Hello ${data.recipientName}`,
		};
		return this.renderTemplate('system/bulk-announcement.hbs', templateData);
	}

	// Client Profile Update Templates
	clientProfileUpdateConfirmation(data: ClientProfileUpdateConfirmationData): string {
		return this.renderTemplate('client/profile-update-confirmation.hbs', data);
	}

	clientProfileUpdateAdmin(data: ClientProfileUpdateAdminData): string {
		return this.renderTemplate('client/profile-update-admin.hbs', data);
	}

	clientCommunicationReminder(data: ClientCommunicationReminderData): string {
		return this.renderTemplate('client/communication-reminder.hbs', data);
	}

	// Client Visit Templates
	clientVisitReminder(data: ClientVisitReminderData): string {
		return this.renderTemplate('client/visit-reminder.hbs', data);
	}

	clientVisitCompleted(data: ClientVisitCompletedData): string {
		return this.renderTemplate('client/visit-completed.hbs', data);
	}

	clientVisitOverdue(data: ClientVisitOverdueData): string {
		return this.renderTemplate('client/visit-overdue.hbs', data);
	}

	clientVisitWeeklyReport(data: ClientVisitWeeklyReportData): string {
		return this.renderTemplate('client/visit-weekly-report.hbs', data);
	}

	// Approval Templates
	approvalCreated(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-created.hbs', data);
	}

	approvalSubmitted(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-submitted.hbs', data);
	}

	approvalApproved(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-approved.hbs', data);
	}

	approvalRejected(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-rejected.hbs', data);
	}

	approvalEscalated(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-escalated.hbs', data);
	}

	approvalUpdated(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-updated.hbs', data);
	}

	approvalWithdrawn(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-withdrawn.hbs', data);
	}

	approvalArchived(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-archived.hbs', data);
	}

	approvalDeleted(data: ApprovalEmailData): string {
		return this.renderTemplate('approvals/approval-deleted.hbs', data);
	}

	/**
	 * Clear the compiled template cache and reinitialize Handlebars
	 * Useful for development or when templates are updated
	 */
	public clearCache(): void {
		const startTime = Date.now();
		const opId = `CLEAR_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
		
		this.logger.log(`[${opId}] Clearing email template cache and reinitializing...`);
		this.compiledTemplates.clear();
		this.initializeHandlebars(opId);
		
		const clearTime = Date.now() - startTime;
		this.logger.log(`[${opId}] Email template service refreshed in ${clearTime}ms`);
	}

	private preloadAllTemplates(opId: string): void {
		const startTime = Date.now();
		
		// List of all email templates
		const templates = [
			'auth/signup.hbs', 'auth/verification.hbs', 'auth/password-reset.hbs', 'auth/password-reset-request.hbs', 'auth/password-changed.hbs',
			'quotations/client-new.hbs', 'quotations/internal-new.hbs', 'quotations/reseller-new.hbs', 'quotations/status-update.hbs', 'quotations/warehouse-fulfillment.hbs',
			'business/invoice.hbs', 'business/order-received-client.hbs',
			'tasks/new-task.hbs', 'tasks/updated.hbs', 'tasks/completed.hbs', 'tasks/reminder-assignee.hbs', 'tasks/reminder-creator.hbs',
			'tasks/flag-created.hbs', 'tasks/flag-updated.hbs', 'tasks/flag-resolved.hbs', 'tasks/feedback-added.hbs', 'tasks/overdue-missed.hbs',
			'leads/reminder.hbs', 'leads/converted-client.hbs', 'leads/converted-creator.hbs', 'leads/assigned-to-user.hbs', 'leads/monthly-unattended-leads-report.hbs',
			'leads/created.hbs', 'leads/status-update.hbs',
			'licenses/created.hbs', 'licenses/updated.hbs', 'licenses/renewed.hbs', 'licenses/activated.hbs', 'licenses/suspended.hbs', 'licenses/limit-reached.hbs',
			'licenses/transferred-from.hbs', 'licenses/transferred-to.hbs',
			'reports/daily-report.hbs', 'reports/user-daily-report.hbs',
			'system/new-user-admin-notification.hbs', 'system/app-update-notification.hbs',
			'auth/new-user-welcome.hbs', 'auth/user-re-invitation.hbs', 'auth/login-notification.hbs', 'auth/failed-login-attempt.hbs', 'auth/email-verified.hbs',
			'client/password-reset.hbs', 'client/password-changed.hbs', 'client/login-notification.hbs', 'client/failed-login-attempt.hbs',
			'client/profile-update-confirmation.hbs', 'client/profile-update-admin.hbs', 'client/communication-reminder.hbs',
			'warnings/issued.hbs', 'warnings/updated.hbs', 'warnings/expired.hbs',
			'leave/application-confirmation.hbs', 'leave/new-application-admin.hbs', 'leave/status-update-user.hbs', 'leave/status-update-admin.hbs', 'leave/deleted-notification.hbs',
			'attendance/morning-report.hbs', 'attendance/evening-report.hbs', 'attendance/overtime-reminder.hbs',
			'claims/created.hbs', 'claims/status-update.hbs', 'claims/approved.hbs', 'claims/rejected.hbs', 'claims/paid.hbs',
			'journals/created.hbs', 'journals/updated.hbs', 'journals/deleted.hbs',
			'payslips/available.hbs', 'payslips/uploaded-admin.hbs',
			'targets/user-target-achievement-admin.hbs', 'targets/lead-target-achievement-admin.hbs',
			'targets/target-set.hbs', 'targets/target-updated.hbs', 'targets/target-deleted.hbs', 'targets/achievement.hbs', 'targets/milestone.hbs',
			'targets/deadline-reminder.hbs', 'targets/performance-alert.hbs', 'targets/erp-update-confirmation.hbs', 'targets/period-summary.hbs'
		];

		let loaded = 0;
		let failed = 0;
		
		templates.forEach((template) => {
			try {
				this.getTemplate(template);
				loaded++;
			} catch (error) {
				failed++;
				this.logger.warn(`[${opId}] Failed to preload: ${template}`);
			}
		});
		
		const preloadTime = Date.now() - startTime;
		this.logger.log(`[${opId}] Preloaded ${loaded}/${templates.length} templates in ${preloadTime}ms (${failed} failed)`);
	}
}

// Export singleton instance
export const emailTemplateService = new EmailTemplateService();
export default emailTemplateService;
