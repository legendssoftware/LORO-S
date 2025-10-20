export enum NotificationEvent {
	// Task Events
	TASK_CREATED = 'task_created',
	TASK_ASSIGNED = 'task_assigned',
	TASK_UPDATED = 'task_updated',
	TASK_COMPLETED = 'task_completed',
	TASK_DELETED = 'task_deleted',
	TASK_STATUS_CHANGED = 'task_status_changed',
	TASK_REMINDER = 'task_reminder',
	TASK_OVERDUE = 'task_overdue',
	TASK_DAILY_SUMMARY = 'task_daily_summary',
	TASKS_OVERDUE_SUMMARY = 'tasks_overdue_summary',
	TASK_FLAG_CREATED = 'task_flag_created',
	TASK_FLAG_UPDATED = 'task_flag_updated',
	TASK_FLAG_RESOLVED = 'task_flag_resolved',

	// Lead Events
	LEAD_CREATED = 'lead_created',
	LEAD_ASSIGNED = 'lead_assigned',
	LEAD_UPDATED = 'lead_updated',
	LEAD_STATUS_CHANGED = 'lead_status_changed',
	LEAD_CONVERTED = 'lead_converted',
	LEAD_DELETED = 'lead_deleted',
	LEAD_REMINDER = 'lead_reminder',
	LEAD_FOLLOW_UP_OVERDUE = 'lead_follow_up_overdue',
	LEAD_DAILY_SUMMARY = 'lead_daily_summary',
	LEADS_STALE_SUMMARY = 'leads_stale_summary',

	// Attendance Events
	ATTENDANCE_SHIFT_STARTED = 'attendance_shift_started',
	ATTENDANCE_SHIFT_ENDED = 'attendance_shift_ended',
	ATTENDANCE_BREAK_STARTED = 'attendance_break_started',
	ATTENDANCE_BREAK_ENDED = 'attendance_break_ended',
	ATTENDANCE_OVERTIME_REMINDER = 'attendance_overtime_reminder',
	ATTENDANCE_SHIFT_START_REMINDER = 'attendance_shift_start_reminder',
	ATTENDANCE_SHIFT_END_REMINDER = 'attendance_shift_end_reminder',
	ATTENDANCE_MISSED_SHIFT_ALERT = 'attendance_missed_shift_alert',
	ATTENDANCE_LATE_SHIFT_ALERT = 'attendance_late_shift_alert',

	// User Events
	USER_CREATED = 'user_created',
	USER_UPDATED = 'user_updated',
	USER_PASSWORD_RESET = 'user_password_reset',
	USER_TARGET_ACHIEVEMENT = 'user_target_achievement',
	USER_TARGET_CONTRIBUTION_PROGRESS = 'user_target_contribution_progress',
	USER_TARGET_SET = 'user_target_set',
	USER_TARGET_UPDATED = 'user_target_updated',
	USER_TARGET_MILESTONE = 'user_target_milestone',
	USER_ROLE_CHANGED = 'user_role_changed',
	USER_STATUS_CHANGED = 'user_status_changed',

	// Auth Events
	AUTH_LOGIN_SUCCESS = 'auth_login_success',
	AUTH_LOGIN_FAILED = 'auth_login_failed',
	AUTH_PASSWORD_SET_SUCCESS = 'auth_password_set_success',
	AUTH_PASSWORD_RESET_REQUEST = 'auth_password_reset_request',
	AUTH_PASSWORD_CHANGED = 'auth_password_changed',
	AUTH_TOKEN_EXPIRED = 'auth_token_expired',

	// Leave Events
	LEAVE_CREATED = 'leave_created',
	LEAVE_APPROVED = 'leave_approved',
	LEAVE_REJECTED = 'leave_rejected',
	LEAVE_CANCELLED = 'leave_cancelled',
	LEAVE_STATUS_CHANGED = 'leave_status_changed',

	// Claims Events
	CLAIM_CREATED = 'claim_created',
	CLAIM_APPROVED = 'claim_approved',
	CLAIM_REJECTED = 'claim_rejected',
	CLAIM_STATUS_CHANGED = 'claim_status_changed',

	// Shop/Quotation Events
	QUOTATION_CREATED = 'quotation_created',
	QUOTATION_STATUS_UPDATED = 'quotation_status_updated',
	QUOTATION_APPROVED = 'quotation_approved',
	QUOTATION_REJECTED = 'quotation_rejected',
	QUOTATION_READY_FOR_REVIEW = 'quotation_ready_for_review',

	// Check-in Events
	CHECKIN_CREATED = 'checkin_created',
	CHECKIN_UPDATED = 'checkin_updated',
	CHECKOUT_COMPLETED = 'checkout_completed',

	// IoT Device Events
	IOT_DEVICE_OPENED = 'iot_device_opened',
	IOT_DEVICE_CLOSED = 'iot_device_closed',
	IOT_DEVICE_ONLINE = 'iot_device_online',
	IOT_DEVICE_OFFLINE = 'iot_device_offline',
	IOT_DEVICE_MAINTENANCE_REQUIRED = 'iot_device_maintenance_required',
	IOT_DEVICE_OVERTIME_ALERT = 'iot_device_overtime_alert',
	IOT_DEVICE_AFTER_HOURS_ACCESS = 'iot_device_after_hours_access',
	IOT_DEVICE_ERROR = 'iot_device_error',
	IOT_DEVICE_DAILY_REPORT = 'iot_device_daily_report',

	// Sales & Tips Events
	SALES_TIP_OF_THE_DAY = 'sales_tip_of_the_day',

	// General Events
	GENERAL_NOTIFICATION = 'general_notification',
}

export enum NotificationPriority {
	LOW = 'low',
	NORMAL = 'normal',
	MEDIUM = 'medium',
	HIGH = 'high',
	URGENT = 'urgent',
}

export enum NotificationChannel {
	TASKS = 'tasks',
	LEADS = 'leads',
	SALES = 'sales',
	GENERAL = 'general',
	IMPORTANT = 'important',
	REMINDERS = 'reminders',
}

export interface NotificationRecipient {
	userId: number;
	email?: string;
	pushToken?: string;
	name?: string;
	prefersPush?: boolean;
	prefersEmail?: boolean;
}

export interface NotificationData {
	// Core notification info
	event: NotificationEvent;
	title: string;
	message: string;
	priority: NotificationPriority;
	channel: NotificationChannel;

	// Recipients
	recipients: NotificationRecipient[];

	// Data payload for app navigation
	data?: {
		id?: number;
		screen?: string;
		action?: string;
		type?: string;
		metadata?: Record<string, any>;
	};

	// Push notification settings
	push?: {
		sound?: string | boolean;
		badge?: number;
		silent?: boolean;
	};

	// Email settings (if different from push)
	email?: {
		template?: string;
		templateData?: Record<string, any>;
		subject?: string;
	};

	// Tracking and metadata
	source?: {
		service: string;
		method: string;
		entityId?: number;
		entityType?: string;
	};
}

export interface NotificationResult {
	success: boolean;
	pushResults?: {
		sent: number;
		failed: number;
		errors?: string[];
	};
	emailResults?: {
		sent: number;
		failed: number;
		errors?: string[];
	};
	message: string;
}

// Pre-defined notification templates for common events
export interface NotificationTemplate {
	event: NotificationEvent;
	title: string;
	messageTemplate: string;
	priority: NotificationPriority;
	channel: NotificationChannel;
	defaultData?: Record<string, any>;
	pushSettings?: {
		sound?: string | boolean;
		badge?: number;
	};
}

// Type-safe notification variables for attendance notifications
export interface AttendanceNotificationVariables {
	userName: string;
	userId: number;
	shiftStartTime?: string;
	shiftEndTime?: string;
	currentTime?: string;
	lateMinutes?: number;
	overtimeMinutes?: number;
	overtimeHours?: number;
	overtimeFormatted?: string;
	reminderType: string;
	orgId?: number;
	branchId?: number;
	timestamp: string;
	screen?: string;
	action?: string;
	type?: string;
	context?: Record<string, any>;
	breakNumber?: string;
	breakStartTime?: string;
	breakEndTime?: string;
	breakDuration?: string;
	checkInTime?: string;
	checkOutTime?: string;
	workTimeDisplay?: string;
}
