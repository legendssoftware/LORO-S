import emailTemplateService from '../services/email-template.service';
import {
	SignupEmailData,
	VerificationEmailData,
	PasswordResetData,
	PasswordResetRequestData,
	PasswordChangedData,
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
	PayslipAvailableEmailData,
	PayslipUploadedAdminEmailData,
} from '../types/email-templates.types';

// Auth Templates
export const Signup = (data: SignupEmailData): string => {
	return emailTemplateService.signup(data);
};

export const Verification = (data: VerificationEmailData): string => {
	return emailTemplateService.verification(data);
};

export const PasswordReset = (data: PasswordResetData): string => {
	return emailTemplateService.passwordReset(data);
};

export const PasswordResetRequest = (data: PasswordResetRequestData): string => {
	return emailTemplateService.passwordResetRequest(data);
};

export const PasswordChanged = (data: PasswordChangedData): string => {
	return emailTemplateService.passwordChanged(data);
};

// Quotation Templates
export const NewQuotationClient = (data: QuotationData): string => {
	return emailTemplateService.newQuotationClient(data);
};

export const NewQuotationInternal = (data: QuotationInternalData): string => {
	return emailTemplateService.newQuotationInternal(data);
};

export const NewQuotationReseller = (data: QuotationResellerData): string => {
	return emailTemplateService.newQuotationReseller(data);
};

export const QuotationStatusUpdate = (data: QuotationData): string => {
	return emailTemplateService.quotationStatusUpdate(data);
};

export const NewQuotationWarehouseFulfillment = (data: QuotationWarehouseData): string => {
	return emailTemplateService.newQuotationWarehouseFulfillment(data);
};

// Business Templates
export const Invoice = (data: InvoiceData): string => {
	return emailTemplateService.invoice(data);
};

export const OrderReceivedClient = (data: OrderReceivedClientData): string => {
	return emailTemplateService.orderReceivedClient(data);
};

// Task Templates
export const NewTask = (data: TaskEmailData): string => {
	return emailTemplateService.newTask(data);
};

export const TaskUpdated = (data: TaskEmailData): string => {
	return emailTemplateService.taskUpdated(data);
};

export const TaskCompleted = (data: TaskCompletedEmailData): string => {
	return emailTemplateService.taskCompleted(data);
};

export const TaskReminderAssignee = (data: TaskReminderData): string => {
	return emailTemplateService.taskReminderAssignee(data);
};

export const TaskReminderCreator = (data: TaskReminderData): string => {
	return emailTemplateService.taskReminderCreator(data);
};

export const TaskFlagCreated = (data: TaskFlagEmailData): string => {
	return emailTemplateService.taskFlagCreated(data);
};

export const TaskFlagUpdated = (data: TaskFlagEmailData): string => {
	return emailTemplateService.taskFlagUpdated(data);
};

export const TaskFlagResolved = (data: TaskFlagEmailData): string => {
	return emailTemplateService.taskFlagResolved(data);
};

export const TaskFeedbackAdded = (data: TaskFeedbackEmailData): string => {
	return emailTemplateService.taskFeedbackAdded(data);
};

export const TaskOverdueMissed = (data: TaskOverdueMissedData): string => {
	return emailTemplateService.taskOverdueMissed(data);
};

// Lead Templates
export const LeadReminder = (data: LeadReminderData): string => {
	return emailTemplateService.leadReminder(data);
};

export const LeadConvertedClient = (data: LeadConvertedClientData): string => {
	return emailTemplateService.leadConvertedClient(data);
};

export const LeadConvertedCreator = (data: LeadConvertedCreatorData): string => {
	return emailTemplateService.leadConvertedCreator(data);
};

export const LeadAssignedToUser = (data: LeadAssignedToUserData): string => {
	return emailTemplateService.leadAssignedToUser(data);
};

// License Templates
export const LicenseCreated = (data: LicenseEmailData): string => {
	return emailTemplateService.licenseCreated(data);
};

export const LicenseUpdated = (data: LicenseEmailData): string => {
	return emailTemplateService.licenseUpdated(data);
};

export const LicenseRenewed = (data: LicenseEmailData): string => {
	return emailTemplateService.licenseRenewed(data);
};

export const LicenseActivated = (data: LicenseEmailData): string => {
	return emailTemplateService.licenseActivated(data);
};

export const LicenseSuspended = (data: LicenseEmailData): string => {
	return emailTemplateService.licenseSuspended(data);
};

export const LicenseLimitReached = (data: LicenseLimitData): string => {
	return emailTemplateService.licenseLimitReached(data);
};

export const LicenseTransferredFrom = (data: LicenseTransferEmailData): string => {
	return emailTemplateService.licenseTransferredFrom(data);
};

export const LicenseTransferredTo = (data: LicenseTransferEmailData): string => {
	return emailTemplateService.licenseTransferredTo(data);
};

// Report Templates
export const DailyReport = (data: DailyReportData): string => {
	return emailTemplateService.dailyReport(data);
};

export const UserDailyReport = (data: DailyReportData): string => {
	return emailTemplateService.userDailyReport(data);
};

// System Templates
export const NewUserAdminNotification = (data: NewUserAdminNotificationData): string => {
	return emailTemplateService.newUserAdminNotification(data);
};

export const NewUserWelcome = (data: NewUserWelcomeData): string => {
	return emailTemplateService.newUserWelcome(data);
};

export const UserReInvitation = (data: UserReInvitationData): string => {
	return emailTemplateService.userReInvitation(data);
};

// Client Templates
export const ClientPasswordReset = (data: PasswordResetData): string => {
	return emailTemplateService.clientPasswordReset(data);
};

export const ClientPasswordChanged = (data: PasswordChangedData): string => {
	return emailTemplateService.clientPasswordChanged(data);
};

// Warning Templates
export const WarningIssued = (data: WarningIssuedEmailData): string => {
	return emailTemplateService.warningIssued(data);
};

export const WarningUpdated = (data: WarningUpdatedEmailData): string => {
	return emailTemplateService.warningUpdated(data);
};

export const WarningExpired = (data: WarningExpiredEmailData): string => {
	return emailTemplateService.warningExpired(data);
};

// Leave Templates
export const LeaveApplicationConfirmation = (data: LeaveApplicationConfirmationData): string => {
	return emailTemplateService.leaveApplicationConfirmation(data);
};

export const LeaveNewApplicationAdmin = (data: LeaveNewApplicationAdminData): string => {
	return emailTemplateService.leaveNewApplicationAdmin(data);
};

export const LeaveStatusUpdateUser = (data: LeaveStatusUpdateUserData): string => {
	return emailTemplateService.leaveStatusUpdateUser(data);
};

export const LeaveStatusUpdateAdmin = (data: LeaveStatusUpdateAdminData): string => {
	return emailTemplateService.leaveStatusUpdateAdmin(data);
};

export const LeaveDeletedNotification = (data: LeaveDeletedNotificationData): string => {
	return emailTemplateService.leaveDeletedNotification(data);
};

// Attendance Templates
export const AttendanceMorningReport = (data: MorningReportData): string => {
	return emailTemplateService.attendanceMorningReport(data);
};

export const AttendanceEveningReport = (data: EveningReportData): string => {
	return emailTemplateService.attendanceEveningReport(data);
};

export const OvertimeReminder = (data: OvertimeReminderData): string => {
	return emailTemplateService.overtimeReminder(data);
};

// Asset Templates
export const AssetAssigned = (data: AssetEmailData): string => {
	return emailTemplateService.assetAssigned(data);
};

export const AssetTransferred = (data: AssetTransferredEmailData): string => {
	return emailTemplateService.assetTransferred(data);
};

export const AssetUpdated = (data: AssetUpdatedEmailData): string => {
	return emailTemplateService.assetUpdated(data);
};

export const AssetRemoved = (data: AssetEmailData): string => {
	return emailTemplateService.assetRemoved(data);
};

export const AssetRestored = (data: AssetEmailData): string => {
	return emailTemplateService.assetRestored(data);
};

export const AssetInsuranceExpiryWarning = (data: AssetInsuranceExpiryWarningEmailData): string => {
	return emailTemplateService.assetInsuranceExpiryWarning(data);
};

export const AssetCreatedAdmin = (data: AssetAdminNotificationEmailData): string => {
	return emailTemplateService.assetCreatedAdmin(data);
};

export const AssetDeletedAdmin = (data: AssetAdminNotificationEmailData): string => {
	return emailTemplateService.assetDeletedAdmin(data);
};

// Additional Auth Templates
export const LoginNotification = (data: LoginNotificationEmailData): string => {
	return emailTemplateService.loginNotification(data);
};

export const ClientLoginNotification = (data: LoginNotificationEmailData): string => {
	return emailTemplateService.clientLoginNotification(data);
};

export const FailedLoginAttempt = (data: LoginNotificationEmailData): string => {
	return emailTemplateService.failedLoginAttempt(data);
};

export const ClientFailedLoginAttempt = (data: LoginNotificationEmailData): string => {
	return emailTemplateService.clientFailedLoginAttempt(data);
};

export const EmailVerified = (data: EmailVerifiedEmailData): string => {
	return emailTemplateService.emailVerified(data);
};

// Claims Templates
export const ClaimCreated = (data: ClaimEmailData): string => {
	return emailTemplateService.claimCreated(data);
};

export const ClaimStatusUpdate = (data: ClaimStatusUpdateEmailData): string => {
	return emailTemplateService.claimStatusUpdate(data);
};

export const ClaimApproved = (data: ClaimStatusUpdateEmailData): string => {
	return emailTemplateService.claimApproved(data);
};

export const ClaimRejected = (data: ClaimStatusUpdateEmailData): string => {
	return emailTemplateService.claimRejected(data);
};

export const ClaimPaid = (data: ClaimStatusUpdateEmailData): string => {
	return emailTemplateService.claimPaid(data);
};

// Additional Lead Templates
export const LeadCreated = (data: LeadCreatedEmailData): string => {
	return emailTemplateService.leadCreated(data);
};

export const LeadStatusUpdate = (data: LeadStatusUpdateEmailData): string => {
	return emailTemplateService.leadStatusUpdate(data);
};

// Journal Templates
export const JournalCreated = (data: JournalEmailData): string => {
	return emailTemplateService.journalCreated(data);
};

export const JournalUpdated = (data: JournalUpdatedEmailData): string => {
	return emailTemplateService.journalUpdated(data);
};

export const JournalDeleted = (data: JournalDeletedEmailData): string => {
	return emailTemplateService.journalDeleted(data);
};

// Payslip Templates
export const PayslipAvailable = (data: PayslipAvailableEmailData): string => {
	return emailTemplateService.payslipAvailable(data);
};

export const PayslipUploadedAdmin = (data: PayslipUploadedAdminEmailData): string => {
	return emailTemplateService.payslipUploadedAdmin(data);
};
