import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Not, In, LessThan, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Task } from './entities/task.entity';
import { User } from '../user/entities/user.entity';
import { CommunicationService } from '../communication/communication.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { EmailType } from '../lib/enums/email.enums';
import { TaskStatus } from '../lib/enums/task.enums';
import { NotificationType } from '../lib/enums/notification.enums';
import { TaskEmailDataMapper } from './helpers/email-data-mapper';

@Injectable()
export class TaskReminderService {
	private readonly logger = new Logger(TaskReminderService.name);

	constructor(
		@InjectRepository(Task)
		private readonly taskRepository: Repository<Task>,
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly communicationService: CommunicationService,
		private readonly notificationsService: NotificationsService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
	) {}

	@Cron('*/5 * * * *') // Run every 5 minutes
	async checkUpcomingDeadlines() {
		const now = new Date();
		const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60000);

		// Find tasks due in 30 minutes
		const tasks = await this.taskRepository.find({
			where: {
				deadline: Between(now, thirtyMinutesFromNow),
				status: Not(In([TaskStatus.COMPLETED, TaskStatus.CANCELLED])),
				isDeleted: false,
			},
			relations: ['creator', 'subtasks'],
		});

		// Send reminders for each task
		for (const task of tasks) {
			await this.sendReminders(task);
		}
	}

	// Run every day at 5:00 AM
	@Cron(CronExpression.EVERY_DAY_AT_5AM)
	async checkOverdueAndMissedTasks() {
		this.logger.log('Starting overdue and missed tasks check...');

		const now = new Date();

		try {
			// Get all users
			const users = await this.userRepository.find();

			for (const user of users) {
				await this.processUserOverdueAndMissedTasks(user);
			}

			this.logger.log('Overdue and missed tasks check completed');
		} catch (error) {
			this.logger.error('Error checking overdue and missed tasks', error.stack);
		}
	}

	private async processUserOverdueAndMissedTasks(user: User) {
		const now = new Date();

		try {
			// Find overdue tasks (tasks with status OVERDUE)
			const overdueTasks = await this.taskRepository.find({
				where: {
					status: TaskStatus.OVERDUE,
					isDeleted: false,
					assignees: { uid: user.uid },
				},
				order: { deadline: 'ASC' },
			});

			// Find missed tasks (tasks with status MISSED or tasks with deadline in past and not completed)
			const missedTasks = await this.taskRepository.find({
				where: [
					{
						status: TaskStatus.MISSED,
						isDeleted: false,
						assignees: { uid: user.uid },
					},
					{
						deadline: LessThan(now),
						status: Not(In([TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.OVERDUE])),
						isDeleted: false,
						assignees: { uid: user.uid },
					},
				],
				order: { deadline: 'ASC' },
			});

			// If there are any overdue or missed tasks, send an email notification
			if (overdueTasks.length > 0 || missedTasks.length > 0) {
				await this.sendOverdueAndMissedTasksReminder(user, overdueTasks, missedTasks);
			}
		} catch (error) {
			this.logger.error(`Error processing overdue/missed tasks for user ${user.uid}`, error.stack);
		}
	}

	private async sendOverdueAndMissedTasksReminder(user: User, overdueTasks: Task[], missedTasks: Task[]) {
		try {
			const now = new Date();

			// Format overdue tasks for the email
			const formattedOverdueTasks = overdueTasks.map((task) => {
				const deadlineDate = task.deadline ? new Date(task.deadline) : null;
				const daysOverdue = deadlineDate
					? Math.ceil((now.getTime() - deadlineDate.getTime()) / (1000 * 3600 * 24))
					: 0;

				return {
					uid: task.uid,
					title: task.title,
					description: task.description,
					deadline: deadlineDate
						? deadlineDate.toLocaleDateString('en-US', {
								year: 'numeric',
								month: 'short',
								day: 'numeric',
						  })
						: 'No deadline',
					priority: task.priority,
					status: task.status,
					progress: task.progress,
					daysOverdue,
				};
			});

			// Format missed tasks for the email
			const formattedMissedTasks = missedTasks.map((task) => {
				const deadlineDate = task.deadline ? new Date(task.deadline) : null;
				const daysOverdue = deadlineDate
					? Math.ceil((now.getTime() - deadlineDate.getTime()) / (1000 * 3600 * 24))
					: 0;

				return {
					uid: task.uid,
					title: task.title,
					description: task.description,
					deadline: deadlineDate
						? deadlineDate.toLocaleDateString('en-US', {
								year: 'numeric',
								month: 'short',
								day: 'numeric',
						  })
						: 'No deadline',
					priority: task.priority,
					status: task.status,
					progress: task.progress,
					daysOverdue,
				};
			});

			// Prepare email data
			const emailData = {
				name: user.name || 'Team Member',
				overdueTasks: formattedOverdueTasks,
				missedTasks: formattedMissedTasks,
				overdueMissedCount: {
					overdue: formattedOverdueTasks.length,
					missed: formattedMissedTasks.length,
					total: formattedOverdueTasks.length + formattedMissedTasks.length,
				},
				dashboardLink: `${process.env.DASHBOARD_URL}/tasks`,
			};

			// Send email notification
			await this.communicationService.sendEmail(EmailType.TASK_OVERDUE_MISSED, [user.email], emailData);

			// Create in-app notification
			await this.notificationsService.create({
				title: 'Overdue & Missed Tasks',
				message: `You have ${emailData.overdueMissedCount.total} task(s) that need attention (${emailData.overdueMissedCount.overdue} overdue, ${emailData.overdueMissedCount.missed} missed)`,
				type: NotificationType.TASK_REMINDER,
				owner: user,
			});

			this.logger.log(`Sent overdue/missed tasks reminder to user ${user.uid} (${user.email})`);
		} catch (error) {
			this.logger.error(`Error sending overdue/missed tasks reminder to user ${user.uid}`, error.stack);
		}
	}

	private async sendReminders(task: Task) {
		// Get all assignees' full user objects
		const assignees = await this.userRepository.findBy({
			uid: In(task.assignees.map((a) => a.uid)),
		});

		// Get the creator
		const creator = await this.userRepository.findOne({
			where: { uid: task.creator[0]?.uid || task.creator.uid },
		});

		if (!creator) {
			this.logger.error(`Creator not found for task ${task.uid}`);
			return;
		}

		// Send to creator with proper data mapping
		const creatorEmailData = TaskEmailDataMapper.mapTaskReminderCreatorData(task, creator, assignees);
		await this.communicationService.sendEmail(EmailType.TASK_REMINDER_CREATOR, [creator.email], creatorEmailData);

		// Send to each assignee with proper data mapping
		for (const assignee of assignees) {
			const assigneeEmailData = TaskEmailDataMapper.mapTaskReminderAssigneeData(task, assignee);
			await this.communicationService.sendEmail(
				EmailType.TASK_REMINDER_ASSIGNEE,
				[assignee.email],
				assigneeEmailData,
			);
		}

		// Send push notifications to all recipients (creator and assignees)
		try {
			const allRecipientIds = [creator.uid, ...assignees.map(a => a.uid)];
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.TASK_REMINDER,
				allRecipientIds,
				{
					taskTitle: task.title,
					taskId: task.uid,
					deadline: task.deadline?.toLocaleDateString() || 'No deadline',
					priority: task.priority,
					timeRemaining: '30 minutes',
				},
				{
					priority: NotificationPriority.HIGH,
				},
			);
			console.log(`✅ Task reminder emails & push notifications sent for task: ${task.title}`);
		} catch (notificationError) {
			console.error('Failed to send task reminder push notifications:', notificationError.message);
		}
	}
}
