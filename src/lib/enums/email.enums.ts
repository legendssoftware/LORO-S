export enum EmailType {
	SIGNUP = 'signup',
	VERIFICATION = 'verification',
	PASSWORD_RESET = 'password_reset',
	PASSWORD_RESET_REQUEST = 'password_reset_request',
	PASSWORD_CHANGED = 'password_changed',
	INVOICE = 'invoice',
	DAILY_REPORT = 'daily_report',
	USER_DAILY_REPORT = 'user_daily_report',
	// Attendance Reports
	ATTENDANCE_MORNING_REPORT = 'attendance_morning_report',
	ATTENDANCE_EVENING_REPORT = 'attendance_evening_report',
	// Organisation activity reports
	ORG_ACTIVITY_REPORT = 'org_activity_report',
	// Organization Settings Reminders
	ORGANIZATION_HOURS_REMINDER = 'organization_hours_reminder',
	// Overtime related emails
	OVERTIME_REMINDER = 'overtime_reminder',
	// Attendance shift alerts
	ATTENDANCE_MISSED_SHIFT_ALERT = 'attendance_missed_shift_alert',
	ATTENDANCE_LATE_SHIFT_ALERT = 'attendance_late_shift_alert',
	// Quotation related emails
	ORDER_RECEIVED_CLIENT = 'order_received_client',
	NEW_QUOTATION_CLIENT = 'new_quotation_client',
	NEW_QUOTATION_INTERNAL = 'new_quotation_internal',
	NEW_QUOTATION_RESELLER = 'new_quotation_reseller',
	NEW_QUOTATION_WAREHOUSE_FULFILLMENT = 'new_quotation_warehouse_fulfillment',
	QUOTATION_APPROVED = 'quotation_approved',
	QUOTATION_REJECTED = 'quotation_rejected',
	QUOTATION_STATUS_UPDATE = 'quotation_status_update',
	QUOTATION_READY_FOR_REVIEW = 'quotation_ready_for_review',
	QUOTATION_UPDATED = 'quotation_updated',
	QUOTATION_SOURCING = 'quotation_sourcing',
	QUOTATION_PACKING = 'quotation_packing',
	QUOTATION_IN_FULFILLMENT = 'quotation_in_fulfillment',
	QUOTATION_PAID = 'quotation_paid',
	QUOTATION_SHIPPED = 'quotation_shipped',
	QUOTATION_DELIVERED = 'quotation_delivered',
	QUOTATION_RETURNED = 'quotation_returned',
	QUOTATION_COMPLETED = 'quotation_completed',
	// Blank quotation related emails
	BLANK_QUOTATION_CLIENT = 'blank_quotation_client',
	BLANK_QUOTATION_INTERNAL = 'blank_quotation_internal',
	// License related emails
	LICENSE_CREATED = 'license_created',
	LICENSE_UPDATED = 'license_updated',
	LICENSE_LIMIT_REACHED = 'license_limit_reached',
	LICENSE_RENEWED = 'license_renewed',
	LICENSE_SUSPENDED = 'license_suspended',
	LICENSE_ACTIVATED = 'license_activated',
	LICENSE_TRANSFERRED_FROM = 'license.transferred.from',
	LICENSE_TRANSFERRED_TO = 'license.transferred.to',
	// Task related emails
	NEW_TASK = 'new_task',
	TASK_UPDATED = 'task_updated',
	TASK_COMPLETED = 'task_completed',
	TASK_REMINDER_ASSIGNEE = 'TASK_REMINDER_ASSIGNEE',
	TASK_REMINDER_CREATOR = 'TASK_REMINDER_CREATOR',
	TASK_OVERDUE_MISSED = 'task_overdue_missed',
	// User related emails
	NEW_USER_ADMIN_NOTIFICATION = 'new_user_admin_notification',
	NEW_USER_WELCOME = 'new_user_welcome',
	// Lead related emails
	LEAD_CONVERTED_CLIENT = 'lead_converted_client',
	LEAD_CONVERTED_CREATOR = 'lead_converted_creator',
	LEAD_REMINDER = 'lead_reminder',
	LEAD_ASSIGNED_TO_USER = 'lead_assigned_to_user',
	MONTHLY_UNATTENDED_LEADS_REPORT = 'monthly_unattended_leads_report',
	WEEKLY_STALE_LEADS_REMINDER = 'weekly_stale_leads_reminder',
	// Task Flag related emails
	TASK_FLAG_CREATED = 'task_flag_created',
	TASK_FLAG_UPDATED = 'task_flag_updated',
	TASK_FLAG_RESOLVED = 'task_flag_resolved',
	// Task Feedback related emails
	TASK_FEEDBACK_ADDED = 'task_feedback_added',
	// Client authentication related emails
	CLIENT_ACCOUNT_CREATED = 'client_account_created',
	CLIENT_PASSWORD_RESET = 'client_password_reset',
	CLIENT_PASSWORD_CHANGED = 'client_password_changed',
	// Client profile update related emails
	CLIENT_PROFILE_UPDATED_ADMIN = 'client_profile_updated_admin',
	CLIENT_PROFILE_UPDATED_CONFIRMATION = 'client_profile_updated_confirmation',
	// Client communication related emails
	CLIENT_COMMUNICATION_REMINDER = 'client_communication_reminder',
	// Warning related emails
	WARNING_ISSUED = 'warning_issued',
	WARNING_UPDATED = 'warning_updated',
	WARNING_EXPIRED = 'warning_expired',
	// Leave related emails
	LEAVE_APPLICATION_CONFIRMATION = 'leave_application_confirmation',
	LEAVE_NEW_APPLICATION_ADMIN = 'leave_new_application_admin',
	LEAVE_STATUS_UPDATE_USER = 'leave_status_update_user',
	LEAVE_STATUS_UPDATE_ADMIN = 'leave_status_update_admin',
	LEAVE_DELETED_NOTIFICATION = 'leave_deleted_notification',
	// User re-invitation emails
	USER_RE_INVITATION = 'user_re_invitation',
	// Asset related emails
	ASSET_ASSIGNED = 'asset_assigned',
	ASSET_TRANSFERRED = 'asset_transferred',
	ASSET_UPDATED = 'asset_updated',
	ASSET_REMOVED = 'asset_removed',
	ASSET_RESTORED = 'asset_restored',
	ASSET_INSURANCE_EXPIRY_WARNING = 'asset_insurance_expiry_warning',
	ASSET_CREATED_ADMIN = 'asset_created_admin',
	ASSET_DELETED_ADMIN = 'asset_deleted_admin',
	// Additional auth emails
	LOGIN_NOTIFICATION = 'login_notification',
	CLIENT_LOGIN_NOTIFICATION = 'client_login_notification',
	FAILED_LOGIN_ATTEMPT = 'failed_login_attempt',
	CLIENT_FAILED_LOGIN_ATTEMPT = 'client_failed_login_attempt',
	EMAIL_VERIFIED = 'email_verified',
	// Claims related emails
	CLAIM_CREATED = 'claim_created',
	CLAIM_CREATED_ADMIN = 'claim_created_admin',
	CLAIM_STATUS_UPDATE = 'claim_status_update',
	CLAIM_APPROVED = 'claim_approved',
	CLAIM_REJECTED = 'claim_rejected',
	CLAIM_PAID = 'claim_paid',
	// Additional lead emails
	LEAD_CREATED = 'lead_created',
	LEAD_STATUS_UPDATE = 'lead_status_update',
	// Journal related emails
	JOURNAL_CREATED = 'journal_created',
	JOURNAL_UPDATED = 'journal_updated',
	JOURNAL_DELETED = 'journal_deleted',
	// User target related emails
	USER_TARGET_SET = 'user_target_set',
	USER_TARGET_UPDATED = 'user_target_updated',
	USER_TARGET_DELETED = 'user_target_deleted',
	USER_TARGET_ACHIEVEMENT = 'user_target_achievement',
	USER_TARGET_MILESTONE = 'user_target_milestone',
	USER_TARGET_DEADLINE_REMINDER = 'user_target_deadline_reminder',
	USER_TARGET_PERFORMANCE_ALERT = 'user_target_performance_alert',
	USER_TARGET_ERP_UPDATE_CONFIRMATION = 'user_target_erp_update_confirmation',
	USER_TARGET_CONTRIBUTION_PROGRESS = 'user_target_contribution_progress',
	USER_TARGET_PERIOD_SUMMARY = 'user_target_period_summary',
	// Payslip related emails
	PAYSLIP_AVAILABLE = 'payslip_available',
	PAYSLIP_UPLOADED_ADMIN = 'payslip_uploaded_admin',
	// Target achievement admin notifications
	USER_TARGET_ACHIEVEMENT_ADMIN = 'user_target_achievement_admin',
	LEAD_TARGET_ACHIEVEMENT_ADMIN = 'lead_target_achievement_admin',
	// App/System notifications
	APP_UPDATE_NOTIFICATION = 'app_update_notification',
	// Approval related emails
	APPROVAL_CREATED = 'approval_created',
	APPROVAL_SUBMITTED = 'approval_submitted',
	APPROVAL_APPROVED = 'approval_approved',
	APPROVAL_REJECTED = 'approval_rejected',
	APPROVAL_ESCALATED = 'approval_escalated',
	APPROVAL_UPDATED = 'approval_updated',
	APPROVAL_WITHDRAWN = 'approval_withdrawn',
	APPROVAL_ARCHIVED = 'approval_archived',
	APPROVAL_DELETED = 'approval_deleted',
}
