import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Not, In, LessThan, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Task } from './entities/task.entity';
import { User } from '../user/entities/user.entity';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { TaskStatus, TaskPriority } from '../lib/enums/task.enums';
import { AccountStatus } from '../lib/enums/status.enums';

@Injectable()
export class TaskReminderService {
	private readonly logger = new Logger(TaskReminderService.name);

	// Define inactive user statuses that should not receive notifications
	private readonly INACTIVE_USER_STATUSES = [
		AccountStatus.INACTIVE,
		AccountStatus.DELETED,
		AccountStatus.BANNED,
		AccountStatus.DECLINED,
	];

	constructor(
		@InjectRepository(Task)
		private readonly taskRepository: Repository<Task>,
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly unifiedNotificationService: UnifiedNotificationService,
	) {}

	/**
	 * Check if a user is active and should receive notifications
	 */
	private isUserActive(user: User): boolean {
		return !this.INACTIVE_USER_STATUSES.includes(user.status as AccountStatus);
	}

	/**
	 * Filter active users from a list of users
	 */
	private async filterActiveUsers(userIds: number[]): Promise<User[]> {
		if (userIds.length === 0) return [];

		const users = await this.userRepository.find({
			where: { uid: In(userIds) },
			select: ['uid', 'name', 'surname', 'email', 'status'],
		});

		const activeUsers = users.filter((user) => this.isUserActive(user));
		const filteredCount = userIds.length - activeUsers.length;
		
		if (filteredCount > 0) {
			this.logger.debug(`Filtered out ${filteredCount} inactive users from task notifications`);
		}

		return activeUsers;
	}

	/**
	 * Daily task summary - Runs at 7:00 AM
	 * Sends ONE consolidated push notification per user with all their tasks
	 */
	@Cron(CronExpression.EVERY_DAY_AT_7AM)
	async sendDailyTaskSummary() {
		this.logger.log('Starting daily task summary notification...');

		try {
			const now = new Date();
			const startOfToday = new Date(now);
			startOfToday.setHours(0, 0, 0, 0);
			const endOfToday = new Date(now);
			endOfToday.setHours(23, 59, 59, 999);

			// Get all tasks due today that are not completed or cancelled
			const tasksToday = await this.taskRepository.find({
				where: {
					deadline: Between(startOfToday, endOfToday),
					status: Not(In([TaskStatus.COMPLETED, TaskStatus.CANCELLED])),
					isDeleted: false,
				},
				relations: ['creator', 'assignees'],
			});

			// Group tasks by user (assignees + creators)
			const tasksByUser = this.groupTasksByUser(tasksToday);

			// Send consolidated notification to each user
			for (const [userId, userTasks] of Object.entries(tasksByUser)) {
				await this.sendConsolidatedTaskNotification(parseInt(userId), userTasks, 'today');
			}

			this.logger.log(`✅ Daily task summary sent to ${Object.keys(tasksByUser).length} users`);
		} catch (error) {
			this.logger.error('Error sending daily task summary', error.stack);
		}
	}

	/**
	 * Overdue and missed tasks check - Runs at 6:00 AM
	 * Sends ONE consolidated push notification per user with all overdue/missed tasks
	 */
	@Cron(CronExpression.EVERY_DAY_AT_6AM)
	async sendOverdueTasksSummary() {
		this.logger.log('Starting overdue and missed tasks summary notification...');

		try {
			const now = new Date();

			// Find all overdue tasks
			const overdueTasks = await this.taskRepository.find({
				where: [
					{
						status: TaskStatus.OVERDUE,
						isDeleted: false,
					},
					{
						status: TaskStatus.MISSED,
						isDeleted: false,
					},
					{
						deadline: LessThan(now),
						status: Not(In([TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.OVERDUE, TaskStatus.MISSED])),
						isDeleted: false,
					},
				],
				relations: ['creator', 'assignees'],
				order: { deadline: 'ASC' },
			});

			// Group overdue tasks by user
			const tasksByUser = this.groupTasksByUser(overdueTasks);

			// Send consolidated notification to each user
			for (const [userId, userTasks] of Object.entries(tasksByUser)) {
				await this.sendConsolidatedTaskNotification(parseInt(userId), userTasks, 'overdue');
			}

			this.logger.log(`✅ Overdue tasks summary sent to ${Object.keys(tasksByUser).length} users`);
		} catch (error) {
			this.logger.error('Error sending overdue tasks summary', error.stack);
		}
	}

	/**
	 * Group tasks by user (includes both assignees and creators)
	 */
	private groupTasksByUser(tasks: Task[]): Record<number, Task[]> {
		const tasksByUser: Record<number, Task[]> = {};

		for (const task of tasks) {
			const userIds = new Set<number>();

			// Add creator
			if (task.creator && Array.isArray(task.creator) && task.creator.length > 0) {
				userIds.add(task.creator[0].uid);
			} else if (task.creator && typeof task.creator === 'object' && 'uid' in task.creator) {
				userIds.add((task.creator as any).uid);
			}

			// Add assignees
			if (task.assignees && Array.isArray(task.assignees)) {
				task.assignees.forEach((assignee: any) => {
					if (assignee.uid) {
						userIds.add(assignee.uid);
					}
				});
			}

			// Add task to each user's list
			userIds.forEach((userId) => {
				if (!tasksByUser[userId]) {
					tasksByUser[userId] = [];
				}
				tasksByUser[userId].push(task);
			});
		}

		return tasksByUser;
	}

	/**
	 * Send consolidated task notification to a user
	 */
	private async sendConsolidatedTaskNotification(userId: number, tasks: Task[], type: 'today' | 'overdue') {
		try {
			// Check if user is active
			const activeUsers = await this.filterActiveUsers([userId]);
			if (activeUsers.length === 0) {
				this.logger.debug(`User ${userId} is inactive, skipping notification`);
			return;
		}

			const user = activeUsers[0];

		// Calculate task statistics
		const urgentCount = tasks.filter((t) => t.priority === TaskPriority.URGENT).length;
			const highCount = tasks.filter((t) => t.priority === TaskPriority.HIGH).length;
			const mediumCount = tasks.filter((t) => t.priority === TaskPriority.MEDIUM).length;
			const lowCount = tasks.filter((t) => t.priority === TaskPriority.LOW).length;

		// Get top 5 most urgent tasks
		const sortedTasks = [...tasks].sort((a, b) => {
			const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
			return priorityOrder[a.priority] - priorityOrder[b.priority];
		});
			const topTasks = sortedTasks.slice(0, 5);

			if (type === 'today') {
				// Daily task summary
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.TASK_DAILY_SUMMARY,
					[userId],
					{
						userName: user.name || 'Team Member',
						taskCount: tasks.length,
						urgentCount,
						highCount,
						mediumCount,
						lowCount,
						topTasks: topTasks.map((t) => ({
							id: t.uid,
							title: t.title,
							priority: t.priority,
							deadline: t.deadline?.toLocaleTimeString('en-ZA', {
								hour: '2-digit',
								minute: '2-digit',
							}) || 'No time set',
						})),
					},
					{
						priority: urgentCount > 0 ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
					},
				);

				this.logger.debug(`✅ Daily task summary sent to user ${userId}: ${tasks.length} tasks`);
			} else {
				// Overdue tasks summary
				const now = new Date();
				const mostOverdue = tasks.reduce((max, task) => {
					if (!task.deadline) return max;
					const daysOverdue = Math.floor((now.getTime() - task.deadline.getTime()) / (24 * 60 * 60 * 1000));
					return daysOverdue > max ? daysOverdue : max;
				}, 0);

			await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.TASKS_OVERDUE_SUMMARY,
					[userId],
					{
						userName: user.name || 'Team Member',
						overdueCount: tasks.length,
						mostOverdueDays: mostOverdue,
						urgentCount,
						topTasks: topTasks.map((t) => ({
							id: t.uid,
							title: t.title,
							priority: t.priority,
							daysOverdue: t.deadline
								? Math.floor((now.getTime() - t.deadline.getTime()) / (24 * 60 * 60 * 1000))
								: 0,
						})),
				},
				{
					priority: NotificationPriority.HIGH,
				},
			);

				this.logger.debug(`✅ Overdue tasks summary sent to user ${userId}: ${tasks.length} overdue tasks`);
			}
		} catch (error) {
			this.logger.error(`Error sending consolidated task notification to user ${userId}`, error.stack);
		}
	}
}
