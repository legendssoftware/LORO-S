import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { ExpoPushService, ExpoPushMessage } from './expo-push.service';
import {
	NotificationData,
	NotificationResult,
	NotificationEvent,
	NotificationPriority,
	NotificationChannel,
	NotificationTemplate,
	NotificationRecipient,
} from '../types/unified-notification.types';
import { EmailType } from '../enums/email.enums';
import { AccountStatus } from '../enums/status.enums';

@Injectable()
export class UnifiedNotificationService {
	private readonly logger = new Logger(UnifiedNotificationService.name);

	// Define inactive user statuses that should not receive notifications
	private readonly INACTIVE_USER_STATUSES = [
		AccountStatus.INACTIVE,
		AccountStatus.DELETED,
		AccountStatus.BANNED,
		AccountStatus.DECLINED,
	];

		// Pre-defined notification templates
	private readonly templates: Map<NotificationEvent, NotificationTemplate> = new Map([
		// Task Templates
		[
			NotificationEvent.TASK_CREATED,
			{
				event: NotificationEvent.TASK_CREATED,
				title: '📋 New Task Created',
				messageTemplate: '{taskTitle} has been created by {createdBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.TASKS,
				defaultData: { screen: '/home/tasks', action: 'view_task' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_ASSIGNED,
			{
				event: NotificationEvent.TASK_ASSIGNED,
				title: '📋 New Task Assigned',
				messageTemplate: '{taskTitle} - Assigned by {assignedBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.TASKS,
				defaultData: { screen: '/home/tasks', action: 'view_task' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_UPDATED,
			{
				event: NotificationEvent.TASK_UPDATED,
				title: '📝 Task Updated',
				messageTemplate: '{taskTitle} has been updated by {updatedBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.TASKS,
				defaultData: { screen: '/home/tasks', action: 'view_task' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_COMPLETED,
			{
				event: NotificationEvent.TASK_COMPLETED,
				title: '✅ Task Completed',
				messageTemplate: '{taskTitle} has been completed by {completedBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.TASKS,
				defaultData: { screen: '/home/tasks', action: 'view_task' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_STATUS_CHANGED,
			{
				event: NotificationEvent.TASK_STATUS_CHANGED,
				title: '🔄 Task Status Changed',
				messageTemplate: '{taskTitle} status changed to {newStatus}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.TASKS,
				defaultData: { screen: '/home/tasks', action: 'view_task' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_DELETED,
			{
				event: NotificationEvent.TASK_DELETED,
				title: '🗑️ Task Deleted',
				messageTemplate: '{taskTitle} has been deleted by {deletedBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.TASKS,
				defaultData: { screen: '/home/tasks', action: 'view_tasks' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_REMINDER,
			{
				event: NotificationEvent.TASK_REMINDER,
				title: '⏰ Task Deadline Approaching',
				messageTemplate: '{taskTitle} is due {timeLeft}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.REMINDERS,
				defaultData: { screen: '/home/tasks', action: 'view_task' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_OVERDUE,
			{
				event: NotificationEvent.TASK_OVERDUE,
				title: '🚨 Overdue & Missed Tasks',
				messageTemplate:
					'You have {taskCount} task(s) that need attention ({overdueCount} overdue, {missedCount} missed)',
				priority: NotificationPriority.URGENT,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/sales/tasks', action: 'view_overdue_tasks' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_FLAG_CREATED,
			{
				event: NotificationEvent.TASK_FLAG_CREATED,
				title: '🚩 Task Flag Created',
				messageTemplate: 'Flag "{flagTitle}" created for task {taskTitle} by {createdBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/tasks', action: 'view_task' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_FLAG_RESOLVED,
			{
				event: NotificationEvent.TASK_FLAG_RESOLVED,
				title: '✅ Task Flag Resolved',
				messageTemplate: 'Flag "{flagTitle}" for task {taskTitle} has been resolved',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.TASKS,
				defaultData: { screen: '/home/tasks', action: 'view_task' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Lead Templates
		[
			NotificationEvent.LEAD_CREATED,
			{
				event: NotificationEvent.LEAD_CREATED,
				title: '🎯 New Lead Created',
				messageTemplate: 'Lead "{leadName}" has been created by {createdBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.LEADS,
				defaultData: { screen: '/home/leads', action: 'view_lead' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAD_ASSIGNED,
			{
				event: NotificationEvent.LEAD_ASSIGNED,
				title: '💰 New Lead Assigned',
				messageTemplate: '{leadName} - New sales opportunity assigned by {assignedBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.SALES,
				defaultData: { screen: '/home/leads', action: 'view_lead' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAD_UPDATED,
			{
				event: NotificationEvent.LEAD_UPDATED,
				title: '📝 Lead Updated',
				messageTemplate: 'Lead "{leadName}" has been updated by {updatedBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.LEADS,
				defaultData: { screen: '/home/leads', action: 'view_lead' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAD_STATUS_CHANGED,
			{
				event: NotificationEvent.LEAD_STATUS_CHANGED,
				title: '🔄 Lead Status Changed',
				messageTemplate: 'Lead "{leadName}" status changed to {newStatus}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.LEADS,
				defaultData: { screen: '/home/leads', action: 'view_lead' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAD_CONVERTED,
			{
				event: NotificationEvent.LEAD_CONVERTED,
				title: '🎉 Lead Converted!',
				messageTemplate: 'Lead "{leadName}" has been converted to a client!',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.SALES,
				defaultData: { screen: '/home/leads', action: 'view_lead' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAD_DELETED,
			{
				event: NotificationEvent.LEAD_DELETED,
				title: '🗑️ Lead Deleted',
				messageTemplate: 'Lead "{leadName}" has been deleted by {deletedBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.LEADS,
				defaultData: { screen: '/home/leads', action: 'view_leads' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAD_REMINDER,
			{
				event: NotificationEvent.LEAD_REMINDER,
				title: '📞 Lead Follow-up Reminder',
				messageTemplate: 'You have {leadsCount} pending lead(s) requiring follow-up',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.REMINDERS,
				defaultData: { screen: '/home/leads', action: 'view_leads' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAD_FOLLOW_UP_OVERDUE,
			{
				event: NotificationEvent.LEAD_FOLLOW_UP_OVERDUE,
				title: '⚠️ Overdue Lead Follow-up',
				messageTemplate: 'Lead "{leadName}" is {daysOverdue} day(s) overdue for follow-up',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/leads', action: 'view_lead' },
				pushSettings: { sound: 'critical', badge: 1 },
			},
		],

		// Attendance Templates
		[
			NotificationEvent.ATTENDANCE_SHIFT_STARTED,
			{
				event: NotificationEvent.ATTENDANCE_SHIFT_STARTED,
				title: '🟢 Shift Started',
				messageTemplate: 'Welcome to work, {userName}! 🟢 Your shift started successfully at {checkInTime:time}. Have a productive day ahead!',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/hr/attendance', action: 'attendance_start' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.ATTENDANCE_SHIFT_ENDED,
			{
				event: NotificationEvent.ATTENDANCE_SHIFT_ENDED,
				title: '🔴 Shift Ended',
				messageTemplate: 'Great work today, {userName}! 🔴 You\'ve successfully completed your shift. Worked from {checkInTime:time} to {checkOutTime:time} for a total of {workTimeDisplay:duration}. Rest well and see you tomorrow!',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/hr/attendance', action: 'attendance_end' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.ATTENDANCE_BREAK_STARTED,
			{
				event: NotificationEvent.ATTENDANCE_BREAK_STARTED,
				title: '☕ Break Started',
				messageTemplate: 'Time for a well-deserved break, {userName}! ☕ Your {breakNumber} break started at {breakStartTime:time}. Take your time to recharge and refresh yourself!',
				priority: NotificationPriority.LOW,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/hr/attendance', action: 'attendance_break_reminder' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.ATTENDANCE_BREAK_ENDED,
			{
				event: NotificationEvent.ATTENDANCE_BREAK_ENDED,
				title: '🏃 Break Ended',
				messageTemplate: 'Welcome back, {userName}! 🚀 Your break is complete. You were refreshing from {breakStartTime:time} to {breakEndTime:time} ({breakDuration:duration}). Hope you\'re feeling recharged and ready to tackle the rest of your day!',
				priority: NotificationPriority.LOW,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/hr/attendance', action: 'attendance_break_reminder' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.ATTENDANCE_OVERTIME_REMINDER,
			{
				event: NotificationEvent.ATTENDANCE_OVERTIME_REMINDER,
				title: '⏰ Overtime Alert',
				messageTemplate: 'Hi {userName}! ⏰ You\'ve worked {overtimeMinutes:duration} of overtime today. Great dedication! Please ensure you get adequate rest and consider checking out when possible.',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/hr/attendance', action: 'attendance_overtime' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.ATTENDANCE_SHIFT_START_REMINDER,
			{
				event: NotificationEvent.ATTENDANCE_SHIFT_START_REMINDER,
				title: '🌅 Time to Start Work',
				messageTemplate: 'Good morning {userName}! ⏰ Your shift starts in 30 minutes at {shiftStartTime:time}. Please prepare to check in on time. Have a productive day ahead!',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/hr/attendance', action: 'attendance_pre_start' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER,
			{
				event: NotificationEvent.ATTENDANCE_SHIFT_END_REMINDER,
				title: '🌆 End of Shift Reminder',
				messageTemplate: 'Hi {userName}! ⏰ Your shift ends in 30 minutes at {shiftEndTime:time}. Please prepare to check out and wrap up your work. Thank you for your dedication today!',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/hr/attendance', action: 'attendance_pre_end' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.ATTENDANCE_MISSED_SHIFT_ALERT,
			{
				event: NotificationEvent.ATTENDANCE_MISSED_SHIFT_ALERT,
				title: '⚠️ Missed Shift Alert',
				messageTemplate: 'Hi {userName}! ⚠️ You missed your scheduled shift that was supposed to start at {shiftStartTime:time}. Please contact your supervisor if there was an emergency. We hope everything is okay!',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/hr/attendance', action: 'attendance_missed_shift' },
				pushSettings: { sound: 'critical', badge: 1 },
			},
		],
		[
			NotificationEvent.ATTENDANCE_LATE_SHIFT_ALERT,
			{
				event: NotificationEvent.ATTENDANCE_LATE_SHIFT_ALERT,
				title: '⏰ Late for Shift',
				messageTemplate: 'Hi {userName}! ⏰ You checked in {lateMinutes:number} minutes late for your shift. Please try to be punctual in the future. Thanks for checking in!',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/hr/attendance', action: 'attendance_late_shift' },
				pushSettings: { sound: 'critical', badge: 1 },
			},
		],

		// User Templates
		[
			NotificationEvent.USER_CREATED,
			{
				event: NotificationEvent.USER_CREATED,
				title: '👤 Welcome to the Team!',
				messageTemplate: 'Your account has been created. Welcome aboard, {userName}!',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_profile' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.USER_UPDATED,
			{
				event: NotificationEvent.USER_UPDATED,
				title: '👤 Profile Updated',
				messageTemplate: 'Your profile has been updated by {updatedBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_profile' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.USER_PASSWORD_RESET,
			{
				event: NotificationEvent.USER_PASSWORD_RESET,
				title: '🔐 Password Reset',
				messageTemplate: 'Your password has been reset successfully',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/auth/login', action: 'login' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.USER_TARGET_ACHIEVEMENT,
			{
				event: NotificationEvent.USER_TARGET_ACHIEVEMENT,
				title: '🎯 Target Achievement!',
				messageTemplate: 'Congratulations! You achieved {achievementPercentage}% of your {targetType} target',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_targets' },
				pushSettings: { sound: 'celebration', badge: 1 },
			},
		],
		[
			NotificationEvent.USER_TARGET_CONTRIBUTION_PROGRESS,
			{
				event: NotificationEvent.USER_TARGET_CONTRIBUTION_PROGRESS,
				title: '🚀 Great Progress Update!',
				messageTemplate: 'Your contributions have increased by {totalProgressImprovement}%! Keep the momentum going!',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_targets' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.USER_ROLE_CHANGED,
			{
				event: NotificationEvent.USER_ROLE_CHANGED,
				title: '👑 Role Updated',
				messageTemplate: 'Your role has been changed to {newRole}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_profile' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.USER_STATUS_CHANGED,
			{
				event: NotificationEvent.USER_STATUS_CHANGED,
				title: '📊 Account Status Updated',
				messageTemplate: 'Your account status has been changed to {newStatus}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_profile' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Leave Templates
		[
			NotificationEvent.LEAVE_CREATED,
			{
				event: NotificationEvent.LEAVE_CREATED,
				title: '🏝️ Leave Request Submitted',
				messageTemplate: 'Your {leaveType} leave request from {startDate} to {endDate} has been submitted',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/leave', action: 'view_leave' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAVE_APPROVED,
			{
				event: NotificationEvent.LEAVE_APPROVED,
				title: '✅ Leave Request Approved',
				messageTemplate: 'Your {leaveType} leave request has been approved by {approvedBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/leave', action: 'view_leave' },
				pushSettings: { sound: 'success', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAVE_REJECTED,
			{
				event: NotificationEvent.LEAVE_REJECTED,
				title: '❌ Leave Request Rejected',
				messageTemplate: 'Your {leaveType} leave request has been rejected. Reason: {rejectionReason}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/leave', action: 'view_leave' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAVE_CANCELLED,
			{
				event: NotificationEvent.LEAVE_CANCELLED,
				title: '🚫 Leave Request Cancelled',
				messageTemplate: 'Your {leaveType} leave request has been cancelled',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/leave', action: 'view_leave' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAVE_STATUS_CHANGED,
			{
				event: NotificationEvent.LEAVE_STATUS_CHANGED,
				title: '📋 Leave Status Updated',
				messageTemplate: 'Your leave request status changed to {newStatus}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/leave', action: 'view_leave' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Claims Templates
		[
			NotificationEvent.CLAIM_CREATED,
			{
				event: NotificationEvent.CLAIM_CREATED,
				title: '💰 Claim Submitted',
				messageTemplate: 'Your {claimCategory} claim for {claimAmount} has been submitted',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/claims', action: 'view_claim' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.CLAIM_APPROVED,
			{
				event: NotificationEvent.CLAIM_APPROVED,
				title: '✅ Claim Approved',
				messageTemplate: 'Your {claimCategory} claim for {claimAmount} has been approved',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/claims', action: 'view_claim' },
				pushSettings: { sound: 'success', badge: 1 },
			},
		],
		[
			NotificationEvent.CLAIM_REJECTED,
			{
				event: NotificationEvent.CLAIM_REJECTED,
				title: '❌ Claim Rejected',
				messageTemplate: 'Your {claimCategory} claim for {claimAmount} has been rejected',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/claims', action: 'view_claim' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.CLAIM_STATUS_CHANGED,
			{
				event: NotificationEvent.CLAIM_STATUS_CHANGED,
				title: '📋 Claim Status Updated',
				messageTemplate: 'Your claim status changed to {newStatus}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/claims', action: 'view_claim' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Shop/Quotation Templates
		[
			NotificationEvent.QUOTATION_CREATED,
			{
				event: NotificationEvent.QUOTATION_CREATED,
				title: '🛒 New Order Received',
				messageTemplate: 'New order #{quotationRef} received from {clientName}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/quotations', action: 'view_quotation' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.QUOTATION_STATUS_UPDATED,
			{
				event: NotificationEvent.QUOTATION_STATUS_UPDATED,
				title: '📦 Order Status Updated',
				messageTemplate: 'Order #{quotationRef} status changed to {newStatus}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/quotations', action: 'view_quotation' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.QUOTATION_APPROVED,
			{
				event: NotificationEvent.QUOTATION_APPROVED,
				title: '✅ Order Approved',
				messageTemplate: 'Order #{quotationRef} has been approved',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/quotations', action: 'view_quotation' },
				pushSettings: { sound: 'success', badge: 1 },
			},
		],
		[
			NotificationEvent.QUOTATION_REJECTED,
			{
				event: NotificationEvent.QUOTATION_REJECTED,
				title: '❌ Order Rejected',
				messageTemplate: 'Order #{quotationRef} has been rejected',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/quotations', action: 'view_quotation' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.QUOTATION_READY_FOR_REVIEW,
			{
				event: NotificationEvent.QUOTATION_READY_FOR_REVIEW,
				title: '👁️ Order Ready for Review',
				messageTemplate: 'Order #{quotationRef} is ready for your review',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/quotations', action: 'review_quotation' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Check-in Templates
		[
			NotificationEvent.CHECKIN_CREATED,
			{
				event: NotificationEvent.CHECKIN_CREATED,
				title: '📍 Check-in Recorded',
				messageTemplate: 'You have successfully checked in at {clientName}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/checkins', action: 'view_checkin' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.CHECKIN_UPDATED,
			{
				event: NotificationEvent.CHECKIN_UPDATED,
				title: '📍 Check-in Updated',
				messageTemplate: 'Your check-in at {clientName} has been updated',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/checkins', action: 'view_checkin' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.CHECKOUT_COMPLETED,
			{
				event: NotificationEvent.CHECKOUT_COMPLETED,
				title: '📍 Check-out Completed',
				messageTemplate: 'You have successfully checked out from {clientName} after {duration}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/checkins', action: 'view_checkin' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Auth Templates
		[
			NotificationEvent.AUTH_LOGIN_SUCCESS,
			{
				event: NotificationEvent.AUTH_LOGIN_SUCCESS,
				title: '✅ Welcome Back!',
				messageTemplate: 'Successfully signed in at {loginTime} on {loginDate}',
				priority: NotificationPriority.LOW,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home', action: 'view_dashboard' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.AUTH_LOGIN_FAILED,
			{
				event: NotificationEvent.AUTH_LOGIN_FAILED,
				title: '🚨 Login Attempt Failed',
				messageTemplate: 'Failed login attempt detected at {attemptTime} on {attemptDate}. If this wasn\'t you, please secure your account immediately.',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/sign-in', action: 'view_sign_in' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.AUTH_PASSWORD_SET_SUCCESS,
			{
				event: NotificationEvent.AUTH_PASSWORD_SET_SUCCESS,
				title: '🎉 Welcome to Loro!',
				messageTemplate: 'Your password has been set successfully. Your account is now ready to use!',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/sign-in', action: 'view_sign_in' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.AUTH_PASSWORD_RESET_REQUEST,
			{
				event: NotificationEvent.AUTH_PASSWORD_RESET_REQUEST,
				title: '🔐 Password Reset Requested',
				messageTemplate: 'A password reset was requested for your account at {requestTime}. Check your email for instructions.',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/sign-in', action: 'view_sign_in' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.AUTH_PASSWORD_CHANGED,
			{
				event: NotificationEvent.AUTH_PASSWORD_CHANGED,
				title: '✅ Password Changed Successfully',
				messageTemplate: 'Your password was successfully changed on {changeDate} at {changeTime}.',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/profile', action: 'view_profile' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.AUTH_TOKEN_EXPIRED,
			{
				event: NotificationEvent.AUTH_TOKEN_EXPIRED,
				title: '⏰ Session Expired',
				messageTemplate: 'Your session has expired. Please sign in again to continue.',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/sign-in', action: 'sign_in' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Sales Tip Templates
		[
			NotificationEvent.SALES_TIP_OF_THE_DAY,
			{
				event: NotificationEvent.SALES_TIP_OF_THE_DAY,
				title: '💡 Sales Tip of the Day',
				messageTemplate: '{title} - {content}',
				priority: NotificationPriority.LOW,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home', action: 'view_tip' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Additional User Templates  
		[
			NotificationEvent.USER_TARGET_SET,
			{
				event: NotificationEvent.USER_TARGET_SET,
				title: '🎯 New Target Set',
				messageTemplate: 'Your new {targetType} target has been set: {targetValue}. Let\'s achieve great things together!',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_targets' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.USER_TARGET_UPDATED,
			{
				event: NotificationEvent.USER_TARGET_UPDATED,
				title: '📈 Target Updated',
				messageTemplate: 'Your {targetType} target has been updated to {newTargetValue}. Keep pushing towards your goals!',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_targets' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.USER_TARGET_MILESTONE,
			{
				event: NotificationEvent.USER_TARGET_MILESTONE,
				title: '🏆 Milestone Reached!',
				messageTemplate: 'Congratulations! You\'ve reached {milestonePercentage}% of your {targetType} target. You\'re doing amazing!',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/profile', action: 'view_targets' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],


		// IoT Device Templates
		[
			NotificationEvent.IOT_DEVICE_OPENED,
			{
				event: NotificationEvent.IOT_DEVICE_OPENED,
				title: '🚪 Door Opened',
				messageTemplate: '{location} was just opened',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/iot', action: 'view_device_activity' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.IOT_DEVICE_CLOSED,
			{
				event: NotificationEvent.IOT_DEVICE_CLOSED,
				title: '🔒 Door Closed',
				messageTemplate: '{location} was just closed',
				priority: NotificationPriority.LOW,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/iot', action: 'view_device_activity' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.IOT_DEVICE_AFTER_HOURS_ACCESS,
			{
				event: NotificationEvent.IOT_DEVICE_AFTER_HOURS_ACCESS,
				title: '🌙 After Hours Access',
				messageTemplate: '{location} was accessed outside business hours',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/iot', action: 'view_security_alerts' },
				pushSettings: { sound: 'alert', badge: 1 },
			},
		],
		[
			NotificationEvent.IOT_DEVICE_ONLINE,
			{
				event: NotificationEvent.IOT_DEVICE_ONLINE,
				title: '✅ Door Online',
				messageTemplate: '{deviceName} is now online and operational',
				priority: NotificationPriority.LOW,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/iot', action: 'view_device_status' },
				pushSettings: { sound: false, badge: 0 },
			},
		],
		[
			NotificationEvent.IOT_DEVICE_OFFLINE,
			{
				event: NotificationEvent.IOT_DEVICE_OFFLINE,
				title: '⚠️ Door Offline',
				messageTemplate: '{deviceName} has gone offline - last seen at {lastSeen}',
				priority: NotificationPriority.MEDIUM,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/iot', action: 'view_device_status' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.IOT_DEVICE_MAINTENANCE_REQUIRED,
			{
				event: NotificationEvent.IOT_DEVICE_MAINTENANCE_REQUIRED,
				title: '🔧 Door Maintenance Required',
				messageTemplate: '{deviceName} requires maintenance - {maintenanceReason}',
				priority: NotificationPriority.MEDIUM,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/iot', action: 'schedule_maintenance' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.IOT_DEVICE_OVERTIME_ALERT,
			{
				event: NotificationEvent.IOT_DEVICE_OVERTIME_ALERT,
				title: '⏰ Extended Door Access Alert',
				messageTemplate: '{deviceName} has been active for {duration} - Extended usage detected',
				priority: NotificationPriority.MEDIUM,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/iot', action: 'view_device_activity' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.IOT_DEVICE_ERROR,
			{
				event: NotificationEvent.IOT_DEVICE_ERROR,
				title: '❌ Door Error',
				messageTemplate: '{deviceName} encountered an error: {errorMessage}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/iot', action: 'view_device_errors' },
				pushSettings: { sound: 'alert', badge: 1 },
			},
		],
		[
			NotificationEvent.IOT_DEVICE_DAILY_REPORT,
			{
				event: NotificationEvent.IOT_DEVICE_DAILY_REPORT,
				title: '📊 Daily Door Report',
				messageTemplate: 'Daily activity summary for {deviceCount} devices - {totalEvents} events recorded',
				priority: NotificationPriority.LOW,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/iot', action: 'view_device_reports' },
				pushSettings: { sound: false, badge: 0 },
			},
		],

		// Additional missing templates for consistency
		[
			NotificationEvent.TASK_DAILY_SUMMARY,
			{
				event: NotificationEvent.TASK_DAILY_SUMMARY,
				title: '📋 Daily Task Summary',
				messageTemplate: 'You have {taskCount} tasks for today ({urgentCount} urgent, {highCount} high priority)',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.REMINDERS,
				defaultData: { screen: '/home/tasks', action: 'view_tasks' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.TASKS_OVERDUE_SUMMARY,
			{
				event: NotificationEvent.TASKS_OVERDUE_SUMMARY,
				title: '🚨 Overdue Tasks Alert',
				messageTemplate: 'You have {overdueCount} overdue tasks that need immediate attention',
				priority: NotificationPriority.URGENT,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/tasks', action: 'view_overdue_tasks' },
				pushSettings: { sound: 'critical', badge: 1 },
			},
		],
		[
			NotificationEvent.TASK_FLAG_UPDATED,
			{
				event: NotificationEvent.TASK_FLAG_UPDATED,
				title: '🚩 Task Flag Updated',
				messageTemplate: 'Flag "{flagTitle}" for task {taskTitle} has been updated by {updatedBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.TASKS,
				defaultData: { screen: '/home/tasks', action: 'view_task_flag' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEAD_DAILY_SUMMARY,
			{
				event: NotificationEvent.LEAD_DAILY_SUMMARY,
				title: '🎯 Daily Lead Summary',
				messageTemplate: 'You have {leadsCount} leads requiring follow-up today',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.REMINDERS,
				defaultData: { screen: '/home/leads', action: 'view_leads' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.LEADS_STALE_SUMMARY,
			{
				event: NotificationEvent.LEADS_STALE_SUMMARY,
				title: '⚠️ Stale Leads Alert',
				messageTemplate: 'You have {staleLeadsCount} leads that haven\'t been contacted in {daysStale} days',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/leads', action: 'view_stale_leads' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			NotificationEvent.GENERAL_NOTIFICATION,
			{
				event: NotificationEvent.GENERAL_NOTIFICATION,
				title: '📢 General Notification',
				messageTemplate: '{message}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home', action: 'view_dashboard' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],

		// Approval Templates
		[
			'APPROVAL_CREATED' as NotificationEvent,
			{
				event: 'APPROVAL_CREATED' as NotificationEvent,
				title: '📋 New Approval Request',
				messageTemplate: 'New approval request "{title}" from {requesterName}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			'APPROVAL_SUBMITTED' as NotificationEvent,
			{
				event: 'APPROVAL_SUBMITTED' as NotificationEvent,
				title: '📤 Approval Request Submitted',
				messageTemplate: 'Approval request "{title}" submitted for your review',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			'APPROVAL_APPROVED' as NotificationEvent,
			{
				event: 'APPROVAL_APPROVED' as NotificationEvent,
				title: '✅ Approval Request Approved',
				messageTemplate: 'Your approval request "{title}" has been approved by {actionBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'success', badge: 1 },
			},
		],
		[
			'APPROVAL_REJECTED' as NotificationEvent,
			{
				event: 'APPROVAL_REJECTED' as NotificationEvent,
				title: '❌ Approval Request Rejected',
				messageTemplate: 'Your approval request "{title}" has been rejected by {actionBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			'APPROVAL_INFO_REQUESTED' as NotificationEvent,
			{
				event: 'APPROVAL_INFO_REQUESTED' as NotificationEvent,
				title: '❓ Additional Information Requested',
				messageTemplate: 'Additional information requested for approval "{title}" by {actionBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			'APPROVAL_DELEGATED' as NotificationEvent,
			{
				event: 'APPROVAL_DELEGATED' as NotificationEvent,
				title: '👥 Approval Request Delegated',
				messageTemplate: 'Approval request "{title}" has been delegated to you by {actionBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			'APPROVAL_ESCALATED' as NotificationEvent,
			{
				event: 'APPROVAL_ESCALATED' as NotificationEvent,
				title: '🚨 Approval Request Escalated',
				messageTemplate: 'Approval request "{title}" has been escalated to you by {actionBy}',
				priority: NotificationPriority.URGENT,
				channel: NotificationChannel.IMPORTANT,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'critical', badge: 1 },
			},
		],
		[
			'APPROVAL_UPDATED' as NotificationEvent,
			{
				event: 'APPROVAL_UPDATED' as NotificationEvent,
				title: '📝 Approval Request Updated',
				messageTemplate: 'Approval request "{title}" has been updated by {updatedBy}',
				priority: NotificationPriority.NORMAL,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'default', badge: 1 },
			},
		],
		[
			'APPROVAL_SIGNED' as NotificationEvent,
			{
				event: 'APPROVAL_SIGNED' as NotificationEvent,
				title: '✍️ Approval Request Signed',
				messageTemplate: 'Your approval request "{title}" has been digitally signed by {signedBy}',
				priority: NotificationPriority.HIGH,
				channel: NotificationChannel.GENERAL,
				defaultData: { screen: '/home/approvals', action: 'view_approval' },
				pushSettings: { sound: 'success', badge: 1 },
			},
		],
	]);

	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly expoPushService: ExpoPushService,
		@Inject(forwardRef(() => {
			const { CommunicationService } = require('../../communication/communication.service');
			return CommunicationService;
		}))
		private readonly communicationService: any,
	) {}

	/**
	 * Main method to send unified notifications (both email and push)
	 */
	async sendNotification(data: NotificationData): Promise<NotificationResult> {
		this.logger.log(`🚀 Sending ${data.event} notification to ${data.recipients.length} recipient(s)`);

		try {
			// Enrich recipients with missing data (email, push tokens, etc.)
			const enrichedRecipients = await this.enrichRecipients(data.recipients);

			const results: NotificationResult = {
				success: true,
				message: 'Notifications processed successfully',
			};

			// Send push notifications
			const pushResults = await this.sendPushNotifications(data, enrichedRecipients);
			results.pushResults = pushResults;

			// Send email notifications if configured
			if (data.email) {
				const emailResults = await this.sendEmailNotifications(data, enrichedRecipients);
				results.emailResults = emailResults;
			}

			// Mark as failed if both push and email failed
			if (pushResults.sent === 0 && (!results.emailResults || results.emailResults.sent === 0)) {
				results.success = false;
				results.message = 'All notifications failed to send';
			}

			return results;
		} catch (error) {
			this.logger.error(`❌ Failed to send ${data.event} notification:`, error);
			return {
				success: false,
				message: `Failed to send notification: ${error.message}`,
			};
		}
	}

	/**
	 * Convenience method using predefined templates
	 */
	async sendTemplatedNotification(
		event: NotificationEvent,
		userIds: number[],
		variables: Record<string, any>,
		options?: {
			sendEmail?: boolean;
			emailTemplate?: EmailType;
			emailData?: Record<string, any>;
			customData?: Record<string, any>;
			priority?: NotificationPriority;
		},
	): Promise<NotificationResult> {
		const template = this.templates.get(event);
		if (!template) {
			throw new Error(`No template found for event: ${event}`);
		}

		// Interpolate message template
		const message = this.interpolateTemplate(template.messageTemplate, variables);

		const recipients: NotificationRecipient[] = userIds.map((userId) => ({ userId }));

		const notificationData: NotificationData = {
			event,
			title: template.title,
			message,
			priority: options?.priority || template.priority,
			channel: template.channel,
			recipients,
			data: {
				...template.defaultData,
				...options?.customData,
				id: variables.id || variables.taskId || variables.leadId,
				type: event,
				metadata: variables,
			},
			push: {
				sound: template.pushSettings?.sound || 'default',
				badge: template.pushSettings?.badge || 1,
			},
			source: {
				service: 'UnifiedNotificationService',
				method: 'sendTemplatedNotification',
				entityId: variables.id || variables.taskId || variables.leadId,
				entityType: event.includes('task') ? 'task' : 'lead',
			},
		};

		// Add email configuration if requested
		if (options?.sendEmail && options?.emailTemplate) {
			notificationData.email = {
				template: options.emailTemplate,
				templateData: options.emailData || variables,
			};
		}

		return this.sendNotification(notificationData);
	}

	/**
	 * Check if a user is active and should receive notifications
	 */
	private isUserActive(user: User): boolean {
		return !this.INACTIVE_USER_STATUSES.includes(user.status as AccountStatus);
	}

	/**
	 * Enrich recipients with email addresses and push tokens from database
	 * Filters out inactive users (suspended, deleted, banned, etc.)
	 */
	private async enrichRecipients(recipients: NotificationRecipient[]): Promise<NotificationRecipient[]> {
		const userIds = recipients.map((r) => r.userId).filter(Boolean);

		if (userIds.length === 0) {
			return recipients;
		}

		const users = await this.userRepository.find({
			where: { uid: In(userIds) },
			select: ['uid', 'email', 'expoPushToken', 'name', 'surname', 'username', 'status'],
		});

		// Filter out inactive users and enrich remaining recipients
		const enrichedRecipients = recipients
			.map((recipient) => {
				const user = users.find((u) => u.uid === recipient.userId);
				if (!user) return null; // User not found
				
				// Skip inactive users
				if (!this.isUserActive(user)) {
					this.logger.debug(`Skipping notification for inactive user ${user.uid} (status: ${user.status})`);
					return null;
				}

				return {
					...recipient,
					email: recipient.email || user.email,
					pushToken: recipient.pushToken || user.expoPushToken,
					name: recipient.name || `${user.name || ''} ${user.surname || ''}`.trim() || user.username,
				};
			})
			.filter(Boolean); // Remove null entries

		const filteredCount = recipients.length - enrichedRecipients.length;
		if (filteredCount > 0) {
			this.logger.log(`🚫 Filtered out ${filteredCount} inactive users from notifications`);
		}

		return enrichedRecipients;
	}

	/**
	 * Send push notifications to all valid recipients
	 */
	private async sendPushNotifications(
		data: NotificationData,
		recipients: NotificationRecipient[],
	): Promise<{ sent: number; failed: number; errors?: string[] }> {
		const pushRecipients = recipients.filter(
			(r) => r.pushToken && this.expoPushService.isValidExpoPushToken(r.pushToken) && r.prefersPush !== false,
		);

		if (pushRecipients.length === 0) {
			return { sent: 0, failed: 0 };
		}

		try {
			const messages: ExpoPushMessage[] = pushRecipients.map((recipient) => ({
				to: recipient.pushToken!,
				title: data.title,
				body: data.message,
				data: {
					...data.data,
					recipientId: recipient.userId,
				},
				sound: data.push?.silent ? false : data.push?.sound || 'default',
				badge: data.push?.badge || 1,
				priority: this.mapPriorityToExpo(data.priority),
				channelId: data.channel,
			}));

			const tickets = await this.expoPushService.sendPushNotifications(messages);

			const sent = tickets.filter((t) => t.status === 'ok').length;
			const failed = tickets.filter((t) => t.status === 'error').length;
			const errors = tickets
				.filter((t) => t.status === 'error')
				.map((t) => t.message)
				.filter(Boolean);

			// Handle invalid tokens by clearing them from user records
			const invalidTokenErrors = tickets
				.filter((t) => t.status === 'error' && t.message?.includes('InvalidCredentials'))
				.map((t, index) => pushRecipients[index]?.userId)
				.filter(Boolean);

			if (invalidTokenErrors.length > 0) {
				this.logger.warn(`🧹 Cleaning up ${invalidTokenErrors.length} invalid push tokens`);
				await this.cleanupInvalidTokens(invalidTokenErrors);
			}

			// Check receipts for successful tickets (optional - can be done async)
			const successfulTickets = tickets
				.filter((t) => t.status === 'ok' && t.id)
				.map((t) => t.id!)
				.filter(Boolean);

			if (successfulTickets.length > 0) {
				// Check receipts asynchronously without blocking the response
				setTimeout(async () => {
					try {
						await this.checkAndLogReceipts(successfulTickets);
					} catch (error) {
						this.logger.error('Failed to check notification receipts:', error);
					}
				}, 30000); // Check receipts after 30 seconds
			}

			this.logger.log(`📱 Push notifications: ${sent} sent, ${failed} failed`);

			return { sent, failed, errors: errors.length > 0 ? errors : undefined };
		} catch (error) {
			this.logger.error('❌ Push notification batch failed:', error);
			return { sent: 0, failed: pushRecipients.length, errors: [error.message] };
		}
	}

	/**
	 * Clean up invalid push tokens from user records
	 */
	private async cleanupInvalidTokens(userIds: number[]): Promise<void> {
		try {
			await this.userRepository.update({ uid: In(userIds) }, { expoPushToken: null });
			this.logger.log(`✅ Cleaned up invalid tokens for ${userIds.length} users`);
		} catch (error) {
			this.logger.error('Failed to cleanup invalid tokens:', error);
		}
	}

	/**
	 * Check receipts and log delivery status
	 */
	private async checkAndLogReceipts(ticketIds: string[]): Promise<void> {
		try {
			const receipts = await this.expoPushService.checkPushReceipts(ticketIds);

			let deliveredCount = 0;
			let failedCount = 0;
			const failedReasons: string[] = [];

			receipts.forEach((receipt, ticketId) => {
				if (receipt.status === 'ok') {
					deliveredCount++;
				} else {
					failedCount++;
					if (receipt.message) {
						failedReasons.push(receipt.message);
					}
				}
			});

			this.logger.log(`📨 Delivery receipts: ${deliveredCount} delivered, ${failedCount} failed`);

			if (failedReasons.length > 0) {
				this.logger.warn('📨 Failed delivery reasons:', failedReasons);
			}
		} catch (error) {
			this.logger.error('Failed to check delivery receipts:', error);
		}
	}

	/**
	 * Send email notifications to all valid recipients
	 */
	private async sendEmailNotifications(
		data: NotificationData,
		recipients: NotificationRecipient[],
	): Promise<{ sent: number; failed: number; errors?: string[] }> {
		const emailRecipients = recipients.filter((r) => r.email && r.prefersEmail !== false);

		if (emailRecipients.length === 0 || !data.email?.template) {
			return { sent: 0, failed: 0 };
		}

		try {
			const emails = emailRecipients.map((r) => r.email!);

			// Use any type for template data since we're handling dynamic data
			await (this.communicationService as any).sendEmail(
				data.email.template as EmailType,
				emails,
				data.email.templateData || {},
			);

			this.logger.log(`📧 Email notifications: ${emails.length} sent`);

			return { sent: emails.length, failed: 0 };
		} catch (error) {
			this.logger.error('❌ Email notification batch failed:', error);
			return { sent: 0, failed: emailRecipients.length, errors: [error.message] };
		}
	}

	/**
	 * Map internal priority to Expo priority format
	 */
	private mapPriorityToExpo(priority: NotificationPriority): 'default' | 'normal' | 'high' {
		switch (priority) {
			case NotificationPriority.LOW:
				return 'default';
			case NotificationPriority.NORMAL:
				return 'normal';
			case NotificationPriority.HIGH:
			case NotificationPriority.URGENT:
				return 'high';
			default:
				return 'normal';
		}
	}

	/**
	 * Enhanced template interpolation with formatting support
	 */
	private interpolateTemplate(template: string, variables: Record<string, any>): string {
		const missingVars: string[] = [];
		const operationId = `interpolate_${Date.now()}`;

		// Log what we're working with for debugging
		this.logger.debug(
			`[${operationId}] Interpolating template with ${Object.keys(variables).length} variables: ${Object.keys(variables).join(', ')}`
		);

		const result = template.replace(/\{(\w+)(?::([^}]+))?\}/g, (match, key, format) => {
			const value = variables[key];
			
			// Handle undefined/null values
			if (value === undefined || value === null) {
				missingVars.push(key);
				this.logger.error(
					`[${operationId}] ⚠️ Missing template variable: "${key}". Available: ${Object.keys(variables).join(', ')}`
				);
				
				// Return user-friendly fallback instead of placeholder
				switch(key) {
					case 'userName':
					case 'userFullName':
					case 'name':
						return 'Team Member';
					case 'employeeName':
						return 'Employee';
					case 'assignedBy':
					case 'createdBy':
					case 'updatedBy':
					case 'completedBy':
					case 'deletedBy':
						return 'User';
					case 'taskTitle':
						return 'Task';
					case 'leadName':
						return 'Lead';
					case 'clientName':
						return 'Client';
					default:
						return `[${key}]`; // More obvious than {key}
				}
			}
			
			// Handle empty strings
			if (typeof value === 'string' && value.trim() === '') {
				this.logger.warn(
					`[${operationId}] Empty string for variable: "${key}". Using fallback.`
				);
				switch(key) {
					case 'userName':
					case 'userFullName':
						return 'Team Member';
					default:
						return `[${key}]`;
				}
			}
			
			// Apply formatting based on type
			if (format) {
				try {
					switch (format) {
						case 'time':
							return this.formatTime(value);
						case 'duration':
							return this.formatDuration(value);
						case 'date':
							return this.formatDate(value);
						case 'number':
							return this.formatNumber(value);
						default:
							return value.toString();
					}
				} catch (error) {
					this.logger.error(
						`[${operationId}] Error formatting ${key} with format ${format}: ${error.message}`
					);
					return value.toString();
				}
			}
			
			return value.toString();
		});

		// Enhanced logging if variables were missing
		if (missingVars.length > 0) {
			this.logger.error(
				`[${operationId}] ⚠️ Template interpolation incomplete!\n` +
				`Missing variables: [${missingVars.join(', ')}]\n` +
				`Template: "${template.substring(0, 100)}..."\n` +
				`Provided variables: ${JSON.stringify(Object.keys(variables))}`
			);
		} else {
			this.logger.debug(
				`[${operationId}] ✅ Successfully interpolated all template variables`
			);
		}

		return result;
	}

	/**
	 * Format time values for display
	 */
	private formatTime(value: any): string {
		if (value instanceof Date) {
			return value.toLocaleTimeString('en-ZA', { 
				hour: '2-digit', 
				minute: '2-digit',
				hour12: false 
			});
		}
		if (typeof value === 'string') {
			// Try to parse string as time
			const timeMatch = value.match(/(\d{1,2}):(\d{2})/);
			if (timeMatch) {
				return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
			}
		}
		return value.toString();
	}

	/**
	 * Format duration values (minutes) for display
	 */
	private formatDuration(minutes: number): string {
		if (typeof minutes !== 'number' || isNaN(minutes)) {
			return '0m';
		}
		
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		
		if (hours === 0) return `${mins}m`;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	}

	/**
	 * Format date values for display
	 */
	private formatDate(value: any): string {
		if (value instanceof Date) {
			return value.toLocaleDateString('en-ZA', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric'
			});
		}
		return value.toString();
	}

	/**
	 * Format number values for display
	 */
	private formatNumber(value: any): string {
		if (typeof value === 'number') {
			return value.toLocaleString('en-ZA');
		}
		return value.toString();
	}

	/**
	 * Get available notification templates
	 */
	getTemplates(): NotificationTemplate[] {
		return Array.from(this.templates.values());
	}

	/**
	 * Add or update a notification template
	 */
	setTemplate(template: NotificationTemplate): void {
		this.templates.set(template.event, template);
	}
}
