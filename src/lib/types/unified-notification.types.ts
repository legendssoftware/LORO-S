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

	// Attendance Events
	ATTENDANCE_SHIFT_STARTED = 'attendance_shift_started',
	ATTENDANCE_SHIFT_ENDED = 'attendance_shift_ended',
	ATTENDANCE_BREAK_STARTED = 'attendance_break_started',
	ATTENDANCE_BREAK_ENDED = 'attendance_break_ended',

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
