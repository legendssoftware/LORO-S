import { UpdateTaskDto } from './dto/update-task.dto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Between, MoreThanOrEqual, LessThanOrEqual, LessThan, Not, In } from 'typeorm';
import { SubTaskStatus } from '../lib/enums/status.enums';
import { Task } from './entities/task.entity';
import { SubTask } from './entities/subtask.entity';
import { UpdateSubtaskDto } from './dto/update-subtask.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { Client } from '../clients/entities/client.entity';
import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { NotificationType, NotificationStatus } from '../lib/enums/notification.enums';
import { TaskStatus, TaskPriority, RepetitionType, TaskType, JobStatus } from '../lib/enums/task.enums';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';
import { User } from '../user/entities/user.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { TaskFlag } from './entities/task-flag.entity';
import { TaskFlagItem } from './entities/task-flag-item.entity';
import { CreateTaskFlagDto } from './dto/create-task-flag.dto';
import { UpdateTaskFlagDto } from './dto/update-task-flag.dto';
import { UpdateTaskFlagItemDto } from './dto/update-task-flag-item.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { TaskFlagStatus, TaskFlagItemStatus } from '../lib/enums/task.enums';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { AccountStatus } from '../lib/enums/status.enums';

@Injectable()
export class TasksService {
	private readonly logger = new Logger(TasksService.name);
	private readonly CACHE_TTL: number;
	private readonly CACHE_PREFIX = 'task:';

	// Define inactive user statuses that should not receive notifications
	private readonly INACTIVE_USER_STATUSES = [
		AccountStatus.INACTIVE,
		AccountStatus.DELETED,
		AccountStatus.BANNED,
		AccountStatus.DECLINED,
	];

	constructor(
		@InjectRepository(Task)
		private taskRepository: Repository<Task>,
		@InjectRepository(SubTask)
		private subtaskRepository: Repository<SubTask>,
		private readonly eventEmitter: EventEmitter2,
		@InjectRepository(Client)
		private readonly clientRepository: Repository<Client>,
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		@Inject(CACHE_MANAGER)
		private cacheManager: Cache,
		private readonly configService: ConfigService,
		@InjectRepository(TaskFlag)
		private taskFlagRepository: Repository<TaskFlag>,
		@InjectRepository(TaskFlagItem)
		private taskFlagItemRepository: Repository<TaskFlagItem>,
		@InjectRepository(OrganisationSettings)
		private readonly organisationSettingsRepository: Repository<OrganisationSettings>,
		private readonly notificationsService: NotificationsService,
		private readonly unifiedNotificationService: UnifiedNotificationService,
	) {
		this.CACHE_TTL = this.configService.get<number>('CACHE_EXPIRATION_TIME') || 30;
	}

	/**
	 * Check if a user is active and should receive notifications
	 */
	private isUserActive(user: User): boolean {
		return !this.INACTIVE_USER_STATUSES.includes(user.status as AccountStatus);
	}

	/**
	 * Filter active users from a list of clerkUserIds
	 * Returns uids for compatibility with notification service
	 */
	private async filterActiveUsers(clerkUserIds: string[]): Promise<number[]> {
		if (clerkUserIds.length === 0) return [];

		const users = await this.userRepository.find({
			where: { clerkUserId: In(clerkUserIds) },
			select: ['uid', 'clerkUserId', 'status'],
		});

		const activeUserIds = users.filter((user) => this.isUserActive(user)).map((user) => user.uid);

		const filteredCount = clerkUserIds.length - activeUserIds.length;

		return activeUserIds;
	}

	private getCacheKey(key: string | number): string {
		return `${this.CACHE_PREFIX}${key}`;
	}

	private async clearTaskCache(taskId?: number): Promise<void> {
		try {
			// Get all cache keys
			const keys = await this.cacheManager.store.keys();

			// Keys to clear
			const keysToDelete = [];

			// If specific task, clear its cache
			if (taskId) {
				keysToDelete.push(this.getCacheKey(taskId));
			}

			// Clear all pagination and filtered task list caches
			const taskListCaches = keys.filter(
				(key) =>
					key.startsWith('tasks_page') || // Pagination caches
					key.startsWith('task:all') || // All tasks cache
					key.includes('_limit'), // Filtered caches
			);
			keysToDelete.push(...taskListCaches);

			// Clear all caches
			await Promise.all(keysToDelete.map((key) => this.cacheManager.del(key)));
		} catch (error) {
			return error;
		}
	}

	private getTaskFlagCacheKey(taskId: number): string {
		return `${this.CACHE_PREFIX}flags:${taskId}`;
	}

	private getTaskFlagDetailCacheKey(flagId: number): string {
		return `${this.CACHE_PREFIX}flag:${flagId}`;
	}

	private getTaskFlagReportsCacheKey(filterHash: string): string {
		return `${this.CACHE_PREFIX}flagreports:${filterHash}`;
	}

	private async clearTaskFlagCache(taskId?: number, flagId?: number): Promise<void> {
		if (taskId) {
			await this.cacheManager.del(this.getTaskFlagCacheKey(taskId));
		}

		if (flagId) {
			await this.cacheManager.del(this.getTaskFlagDetailCacheKey(flagId));
		}

		if (taskId) {
			await this.clearTaskCache(taskId);
		}
	}

	private async createRepeatingTasks(baseTask: Task, createTaskDto: CreateTaskDto): Promise<void> {
		// Early return if no repetition is needed
		if (
			!createTaskDto.repetitionType ||
			createTaskDto.repetitionType === RepetitionType.NONE ||
			!createTaskDto.deadline ||
			!createTaskDto.repetitionDeadline
		) {
			return;
		}

		// Parse dates properly handling timezone
		const startDate = new Date(createTaskDto.deadline);
		const endDate = new Date(createTaskDto.repetitionDeadline);

		// Validate dates
		if (endDate <= startDate) {
			throw new BadRequestException('Repetition end date must be after the start date');
		}

		// Calculate total tasks and initialize counter
		let currentDate = new Date(startDate); // Create new date object to avoid reference issues
		const totalTasks = this.calculateTotalTasks(startDate, endDate, createTaskDto.repetitionType);
		let tasksCreated = 0;

		// Format the repetition type for display
		const repetitionTypeDisplay = createTaskDto.repetitionType.toLowerCase();

		// Now create the remaining tasks
		while (currentDate < endDate) {
			try {
				// Calculate next date based on repetition type
				let nextDate: Date;
				switch (createTaskDto.repetitionType) {
					case RepetitionType.DAILY:
						nextDate = addDays(currentDate, 1);
						break;
					case RepetitionType.WEEKLY:
						nextDate = addWeeks(currentDate, 1);
						break;
					case RepetitionType.MONTHLY:
						nextDate = addMonths(currentDate, 1);
						break;
					case RepetitionType.YEARLY:
						nextDate = addYears(currentDate, 1);
						break;
					default:
						return;
				}

				// Break if we've gone past the end date
				if (nextDate > endDate) {
					break;
				}

				// Create the task for this date
				await this.createSingleRepeatingTask(
					baseTask,
					createTaskDto,
					nextDate,
					tasksCreated + 2, // +2 because we already created the first task
					totalTasks,
					repetitionTypeDisplay,
					startDate,
					endDate,
				);

				currentDate = nextDate;
				tasksCreated++;
			} catch (error) {
				return error;
			}
		}
	}

	private async createSingleRepeatingTask(
		baseTask: Task,
		createTaskDto: CreateTaskDto,
		taskDate: Date,
		sequenceNumber: number,
		totalTasks: number,
		repetitionTypeDisplay: string,
		seriesStart: Date,
		seriesEnd: Date,
	): Promise<Task> {
		// Format date for display
		const formattedDate = taskDate.toLocaleDateString('en-ZA', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});

		// Create season number based on repetition type
		let seasonNumber = 1;
		if (createTaskDto.repetitionType === RepetitionType.YEARLY) {
			seasonNumber = Math.ceil(taskDate.getFullYear() - seriesStart.getFullYear() + 1);
		} else if (createTaskDto.repetitionType === RepetitionType.MONTHLY) {
			const monthDiff =
				(taskDate.getFullYear() - seriesStart.getFullYear()) * 12 +
				(taskDate.getMonth() - seriesStart.getMonth());
			seasonNumber = Math.ceil(monthDiff / 3) + 1; // One season every 3 months
		} else {
			seasonNumber = Math.ceil(
				sequenceNumber / (createTaskDto.repetitionType === RepetitionType.WEEKLY ? 13 : 30),
			); // 13 episodes per season for weekly, 30 for daily
		}

		// Calculate episode number within the season
		const episodeNumber =
			createTaskDto.repetitionType === RepetitionType.WEEKLY
				? ((sequenceNumber - 1) % 13) + 1 // 13 episodes per season for weekly
				: ((sequenceNumber - 1) % 30) + 1; // 30 episodes per season for daily

		// Create the repeated task with TV show style naming
		const repeatedTask = this.taskRepository.create({
			title: `${createTaskDto.title} S${seasonNumber.toString().padStart(2, '0')}  E${episodeNumber
				.toString()
				.padStart(2, '0')} - ${formattedDate}`,
			description: `${
				createTaskDto.description
			}\n\n---\nSeries Information:\n- Season ${seasonNumber}, Episode ${episodeNumber}\n- Series: ${
				createTaskDto.title
			}\n- Repeats: ${repetitionTypeDisplay}\n- Air Date: ${formattedDate}\n- Series Start: ${seriesStart.toLocaleDateString()}\n- Series Finale: ${seriesEnd.toLocaleDateString()}`,
			deadline: taskDate,
			assignees: [], // Will be set after validation below
			clients: createTaskDto.client?.map((c) => ({ uid: c.uid })) || [],
			status: TaskStatus.PENDING,
			taskType: createTaskDto.taskType || TaskType.OTHER,
			priority: createTaskDto.priority,
			completionDate: null,
			repetitionType: RepetitionType.NONE, // Prevent infinite recursion
			repetitionDeadline: null,
			creator: baseTask.creator,
			targetCategory: createTaskDto.targetCategory,
			progress: 0,
			isOverdue: false,
			isDeleted: false,
			organisation: baseTask.organisation,
			branch: baseTask.branch,
			attachments: createTaskDto.attachments || [],
		});

		// Save the task
		const savedTask = await this.taskRepository.save(repeatedTask);

		// Create subtasks if they exist in the DTO
		if (createTaskDto.subtasks?.length > 0) {
			try {
				// Create subtasks with proper task relation
				const subtasks = createTaskDto.subtasks.map((subtask) => ({
					title: subtask.title,
					description: subtask.description,
					status: SubTaskStatus.PENDING,
					task: { uid: savedTask.uid }, // Properly reference the parent task
					isDeleted: false,
					createdAt: new Date(),
					updatedAt: new Date(),
				}));

				// Save all subtasks
				const savedSubtasks = await this.subtaskRepository.save(subtasks);

				if (!savedSubtasks) {
					throw new Error('Failed to save subtasks');
				}

				// Update the task with subtasks relation
				savedTask.subtasks = savedSubtasks;
				await this.taskRepository.save(savedTask);
			} catch (error) {
				throw new Error(`Failed to create subtasks: ${error.message}`);
			}
		}

		// Emit event for task creation with both formats for compatibility
		const creatorId = savedTask.creator?.uid;
		this.eventEmitter.emit('task.created', {
			taskId: savedTask.uid.toString(),
			userId: creatorId,
			orgId: savedTask.organisation?.uid,
			branchId: savedTask.branch?.uid,
			task: savedTask, // Legacy format for TaskRouteService
			isRecurring: true,
			sequenceNumber,
			totalTasks,
			hasSubtasks: createTaskDto.subtasks?.length > 0,
		});

		// Clear cache after task creation
		await this.clearTaskCache();

		return savedTask;
	}

	private calculateTotalTasks(startDate: Date, endDate: Date, repetitionType: RepetitionType): number {
		const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

		switch (repetitionType) {
			case RepetitionType.DAILY:
				return diffDays;
			case RepetitionType.WEEKLY:
				return Math.ceil(diffDays / 7);
			case RepetitionType.MONTHLY:
				return Math.ceil(diffDays / 30);
			case RepetitionType.YEARLY:
				return Math.ceil(diffDays / 365);
			default:
				return 0;
		}
	}

	/**
	 * Helper method to check if a task has open flags and update its status to PENDING if needed
	 * @param taskId The task ID to check
	 */
	private async checkFlagsAndUpdateTaskStatus(taskId: number): Promise<void> {
		try {
			// Get the task with its flags
			const task = await this.taskRepository.findOne({
				where: { uid: taskId },
				relations: ['flags'],
			});

			if (!task) {
				return;
			}

			// Check if there are any open flags
			const hasOpenFlags = task.flags?.some(
				(flag) =>
					flag.isDeleted === false &&
					(flag.status === TaskFlagStatus.OPEN || flag.status === TaskFlagStatus.IN_PROGRESS),
			);

			// If there are open flags and task is not in PENDING status, update it
			if (hasOpenFlags && task.status !== TaskStatus.PENDING) {
				task.status = TaskStatus.PENDING;
				await this.taskRepository.save(task);

				// Clear task cache
				await this.clearTaskCache(taskId);
			}
		} catch (error) {
			// Silent fail - don't disrupt main flow
		}
	}

	async create(createTaskDto: CreateTaskDto, orgId?: number, branchId?: number, clerkUserId?: string): Promise<{ message: string }> {
		try {
			// === CRITICAL PATH - Operations before response ===
			
			// Enhanced validation
			if (!orgId) {
				throw new BadRequestException('Organization ID is required');
			}

			if (!createTaskDto.title || createTaskDto.title.trim() === '') {
				throw new BadRequestException('Task title is required');
			}

			// Creating the task from the DTOs
			const task = new Task();

			// Map DTO fields to task
			task.title = createTaskDto.title;
			task.description = createTaskDto.description;
			task.priority = createTaskDto.priority || TaskPriority.MEDIUM;
			task.deadline = createTaskDto.deadline ? new Date(createTaskDto.deadline) : null;
			task.taskType = createTaskDto.taskType || TaskType.OTHER;
			task.targetCategory = createTaskDto.targetCategory;
			task.attachments = createTaskDto.attachments || [];
			task.repetitionType = createTaskDto.repetitionType || RepetitionType.NONE;
			task.repetitionDeadline = createTaskDto.repetitionDeadline
				? new Date(createTaskDto.repetitionDeadline)
				: null;

			// Handle assignees with enhanced validation
			if (createTaskDto.assignees?.length) {
				// Validate assignees belong to the same organization
				const assigneeIds = createTaskDto.assignees.map((assignee) => assignee.uid);
				const assignees = await this.userRepository.find({
					where: { uid: In(assigneeIds) },
					relations: ['organisation'],
				});

				const validAssignees = assignees.filter((user) => user.organisation?.uid === orgId);
				const invalidAssignees = assignees.filter((user) => user.organisation?.uid !== orgId);

				if (invalidAssignees.length > 0) {
					this.logger.warn(`Found ${invalidAssignees.length} assignees from different organizations - excluding them`);
				}

				task.assignees = validAssignees.map((assignee) => ({ clerkUserId: assignee.clerkUserId }));
			} else {
				task.assignees = [];
			}

			// Handle clients with organization filtering
			if (createTaskDto.client?.length) {
				// Validate clients belong to the same organization
				const clientIds = createTaskDto.client.map((client) => client.uid);
				const clients = await this.clientRepository.find({
					where: { uid: In(clientIds) },
					relations: ['organisation'],
				});

				const validClients = clients.filter((client) => client.organisation?.uid === orgId);
				const invalidClients = clients.filter((client) => client.organisation?.uid !== orgId);

				if (invalidClients.length > 0) {
					this.logger.warn(`Found ${invalidClients.length} clients from different organizations - excluding them`);
				}

				task.clients = validClients.map((client) => ({ uid: client.uid }));
			} else {
				task.clients = [];
			}

			// Set creator with validation
			// Creator is extracted from token (clerkUserId)
			if (!clerkUserId) {
				throw new BadRequestException('Creator ID is required');
			}

			const creator = await this.userRepository.findOne({
				where: { clerkUserId },
				relations: ['organisation'],
			});

			if (!creator) {
				this.logger.warn(`Creator with Clerk ID ${clerkUserId} not found`);
				throw new BadRequestException('Creator not found');
			}

			// Validate creator belongs to the same organization
			if (creator.organisation?.uid !== orgId) {
				this.logger.warn(`Creator ${creator.uid} belongs to different organization ${creator.organisation?.uid}`);
				throw new BadRequestException('Creator must belong to the same organization');
			}

			task.creator = creator;

			// Set organization and branch
			if (orgId) {
				const organisation = { uid: orgId } as Organisation;
				task.organisation = organisation;
			}

			if (branchId) {
				const branch = { uid: branchId } as Branch;
				task.branch = branch;
			}

			// Save the task
			const savedTask = await this.taskRepository.save(task);

			if (!savedTask) {
				throw new BadRequestException('Failed to create task');
			}

			// === EARLY RETURN: Respond to user immediately with success ===
			// All non-critical operations will continue asynchronously
			const immediateResponse = { message: 'success' };

			// === POST-RESPONSE PROCESSING ===
			// Process all non-critical operations asynchronously after responding to user
			setImmediate(async () => {
				try {
					// 1. Create subtasks if provided
					if (createTaskDto.subtasks && createTaskDto.subtasks.length > 0) {
						const subtasks = createTaskDto.subtasks.map((subtaskDto) => {
							const subtask = new SubTask();
							subtask.title = subtaskDto.title;
							subtask.description = subtaskDto.description || '';
							subtask.status = SubTaskStatus.PENDING;
							subtask.task = savedTask;
							return subtask;
						});

						try {
							await this.subtaskRepository.save(subtasks);
						} catch (subtaskError) {
							this.logger.error(`Failed to create subtasks: ${subtaskError.message}`);
						}
					}

					// 2. Send push notifications to assignees
					if (savedTask?.assignees?.length > 0) {
						try {
							const assigneeIds = savedTask.assignees.map((assignee) => assignee.clerkUserId);
							const activeAssigneeIds = await this.filterActiveUsers(assigneeIds);

							if (activeAssigneeIds.length > 0) {
								const creatorName = savedTask.creator?.name || 'Team Member';
								
								await this.unifiedNotificationService.sendTemplatedNotification(
									NotificationEvent.TASK_ASSIGNED,
									activeAssigneeIds,
									{
										taskTitle: savedTask.title,
										taskId: savedTask.uid,
										assignedBy: creatorName,
										deadline: savedTask.deadline?.toLocaleDateString() || 'No deadline',
										priority: savedTask.priority,
									},
									{
										priority: NotificationPriority.HIGH,
										customData: {
											screen: '/sales/tasks',
											action: 'view_task',
										},
									},
								);
							}
						} catch (notificationError) {
							this.logger.error(`Failed to send task notifications: ${notificationError.message}`);
						}
					}

					// 3. Create repeating tasks if needed
					if (task.repetitionType !== RepetitionType.NONE && task.repetitionDeadline && task.deadline) {
						try {
							await this.createRepeatingTasks(savedTask, createTaskDto);
						} catch (repeatError) {
							this.logger.error(`Failed to create repeating tasks: ${repeatError.message}`);
						}
					}

					// 4. Check for flags and update task status if needed
					try {
						await this.checkFlagsAndUpdateTaskStatus(savedTask.uid);
					} catch (flagError) {
						this.logger.error(`Failed to check flags: ${flagError.message}`);
					}

					// 5. Clear cache
					try {
						await this.clearTaskCache();
					} catch (cacheError) {
						this.logger.error(`Failed to clear cache: ${cacheError.message}`);
					}

					// 6. Emit task creation event for external integrations
					try {
						// Fetch full task with relations for event handlers
						// Note: assignees and clients are JSON columns, not relations
						const taskWithRelations = await this.taskRepository.findOne({
							where: { uid: savedTask.uid },
							relations: ['creator', 'organisation', 'branch'], // Removed 'assignees' and 'clients' - they are JSON columns
						});

						if (taskWithRelations) {
							// Populate assignees and clients using the helper method
							const populatedTask = await this.populateTaskRelations(taskWithRelations);
							
							// Emit task.created event with both formats for compatibility
							const creatorId = populatedTask.creator?.uid;
							this.eventEmitter.emit('task.created', {
								taskId: populatedTask.uid.toString(),
								userId: creatorId,
								orgId: populatedTask.organisation?.uid,
								branchId: populatedTask.branch?.uid,
								task: populatedTask, // Legacy format for TaskRouteService
							});
						}
					} catch (eventError) {
						this.logger.error(`Failed to emit task creation event: ${eventError.message}`);
					}

				} catch (error) {
					this.logger.error(`Error in async post-task processing: ${error.message}`, error.stack);
				}
			});

			return immediateResponse;

		} catch (error) {
			this.logger.error(`Error creating task: ${error.message}`, error.stack);
			return { message: error?.message };
		}
	}

	private async populateTaskRelations(task: Task): Promise<Task> {
		if (task.assignees?.length > 0) {
			const assigneeIds = task.assignees.map((a) => a.clerkUserId);
			const assigneeProfiles = await this.userRepository.find({
				where: { clerkUserId: In(assigneeIds) },
				select: ['uid', 'clerkUserId', 'username', 'name', 'surname', 'email', 'phone', 'photoURL', 'accessLevel', 'status'],
			});
			// Keep the original structure with clerkUserId for JSON field
			task.assignees = assigneeProfiles.map((user) => ({ clerkUserId: user.clerkUserId }));
		}

		if (task.clients?.length > 0) {
			const clientIds = task.clients.map((c) => c.uid);
			const clientProfiles = await this.clientRepository.find({
				where: { uid: In(clientIds) },
			});
			task.clients = clientProfiles;
		}

		return task;
	}

	async findOne(ref: number, orgId?: number, branchId?: number): Promise<{ message: string; task: Task | null }> {
		this.logger.log(`Finding task with ID: ${ref}, orgId: ${orgId}, branchId: ${branchId}`);
		try {
			if (!orgId) {
				this.logger.warn('Organization ID is required for task retrieval');
				throw new BadRequestException('Organization ID is required');
			}

			const cacheKey = this.getCacheKey(`${orgId}_${branchId}_${ref}`);
			const cachedTask = await this.cacheManager.get<{ message: string; task: Task }>(cacheKey);

			if (cachedTask) {
				return cachedTask;
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const task = await this.taskRepository.findOne({
				where: whereClause,
				relations: ['creator', 'subtasks', 'organisation', 'branch', 'routes', 'flags'],
			});

			if (!task) {
				return {
					message: process.env.NOT_FOUND_MESSAGE,
					task: null,
				};
			}

			const populatedTask = await this.populateTaskRelations(task);
			const result = {
				message: process.env.SUCCESS_MESSAGE,
				task: populatedTask,
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			return result;
		} catch (error) {
			return {
				message: error?.message,
				task: null,
			};
		}
	}

	public async tasksByUser(
		ref: string,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string; tasks: Task[] }> {
		this.logger.log(`Getting tasks for user: ${ref}, orgId: ${orgId}, branchId: ${branchId}`);
		try {
			if (!orgId) {
				this.logger.warn('Organization ID is required for user tasks retrieval');
				throw new BadRequestException('Organization ID is required');
			}

			const cacheKey = this.getCacheKey(`user_${ref}_org_${orgId}_branch_${branchId}`);
			const cachedTasks = await this.cacheManager.get<{ message: string; tasks: Task[] }>(cacheKey);

			if (cachedTasks) {
				return cachedTasks;
			}

			const whereClause: any = {
				isDeleted: false,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			// Add the assignee filter
			whereClause.assignees = [{ uid: ref }];

			const tasks = await this.taskRepository.find({
				where: whereClause,
				relations: ['creator', 'subtasks', 'organisation', 'branch'],
				order: { createdAt: 'DESC' },
			});

			if (!tasks || tasks.length === 0) {
				return {
					tasks: [],
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			const result = {
				tasks: tasks,
				message: process.env.SUCCESS_MESSAGE,
			};

			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			return result;
		} catch (error) {
			return {
				tasks: [],
				message: error?.message,
			};
		}
	}

	async findAll(
		filters?: {
			status?: TaskStatus;
			priority?: TaskPriority;
			assigneeId?: number;
			clientId?: number;
			startDate?: Date;
			endDate?: Date;
			isOverdue?: boolean;
			organisationRef?: string;
			branchId?: number;
		},
		page: number = 1,
		limit: number = Number(process.env.DEFAULT_PAGE_LIMIT),
		orgId?: number,
		branchId?: number,
	): Promise<PaginatedResponse<Task>> {
		this.logger.log(`Finding tasks with filters: ${JSON.stringify(filters)}, page: ${page}, limit: ${limit}, orgId: ${orgId}, branchId: ${branchId}`);
		try {
			if (!orgId) {
				this.logger.warn('Organization ID is required for tasks retrieval');
				throw new BadRequestException('Organization ID is required');
			}

			// Calculate skip for pagination
			const skip = (page - 1) * limit;

			// Default where clause with organization filter
			let whereClause: any = {
				isDeleted: false,
				organisation: { uid: orgId },
			};

			// Add branch filter if provided
			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			// Apply additional filters from the filters object if provided
			if (filters) {
				if (filters.status) {
					whereClause.status = filters.status;
				}

				if (filters.priority) {
					whereClause.priority = filters.priority;
				}

				if (filters.startDate) {
					whereClause.deadline = MoreThanOrEqual(filters.startDate);
				}

				if (filters.endDate) {
					whereClause.deadline = LessThanOrEqual(filters.endDate);
				}

				if (filters.isOverdue) {
					whereClause.deadline = LessThan(new Date());
					whereClause.status = Not(TaskStatus.COMPLETED);
				}

				// Add organization and branch filtering
				if (filters.organisationRef) {
					whereClause.organisation = { ref: filters.organisationRef };
				}

				if (filters.branchId) {
					whereClause.branch = { uid: filters.branchId };
				}
			}

			const [tasks, total] = await this.taskRepository.findAndCount({
				where: whereClause,
				skip: skip,
				relations: ['creator', 'subtasks', 'organisation', 'branch', 'routes', 'flags'],
				take: limit,
				order: {
					createdAt: 'DESC',
				},
			});

			let filteredTasks = await Promise.all(tasks?.map((task) => this.populateTaskRelations(task)));

			// Apply post-query filters that can't be done in the database
			if (filters?.assigneeId) {
				// Convert uid to clerkUserId for comparison
				const assigneeUser = await this.userRepository.findOne({
					where: { uid: filters.assigneeId },
					select: ['clerkUserId'],
				});
				if (assigneeUser) {
					filteredTasks = filteredTasks?.filter((task) =>
						task.assignees?.some((assignee) => assignee?.clerkUserId === assigneeUser.clerkUserId),
					);
				} else {
					// If user not found, filter out all tasks
					filteredTasks = [];
				}
			}

			if (filters?.clientId) {
				filteredTasks = filteredTasks?.filter((task) =>
					task.clients?.some((client) => client?.uid === filters?.clientId),
				);
			}

			const response = {
				data: filteredTasks,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: process.env.SUCCESS_MESSAGE,
			};

			await this.cacheManager.set(
				this.getCacheKey(`${orgId}_${branchId}_${JSON.stringify(filters)}`),
				response,
				this.CACHE_TTL,
			);

			return response;
		} catch (error) {
			return {
				data: [],
				meta: {
					total: 0,
					page,
					limit,
					totalPages: 0,
				},
				message: error?.message,
			};
		}
	}

	async update(
		ref: number,
		updateTaskDto: UpdateTaskDto,
		orgId?: number,
		branchId?: number,
	): Promise<{ message: string }> {
		this.logger.log(`Updating task: ${ref}, orgId: ${orgId}, branchId: ${branchId}, updateData: ${JSON.stringify(updateTaskDto)}`);
		try {
			if (!orgId) {
				this.logger.warn('Organization ID is required for task update');
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const task = await this.taskRepository.findOne({
				where: whereClause,
				relations: ['organisation', 'branch', 'creator'],
			});

			if (!task) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Track original assignees for comparison (defensive null checking)
			const originalAssigneeIds = Array.isArray(task.assignees)
				? task.assignees.map((assignee) => assignee?.clerkUserId).filter(Boolean)
				: [];

			// Check if task is being marked as completed
			const isCompletingTask =
				updateTaskDto.status === TaskStatus.COMPLETED && task.status !== TaskStatus.COMPLETED;

			// Set completion date if task is being completed
			if (isCompletingTask && !updateTaskDto.completionDate) {
				updateTaskDto.completionDate = new Date();
				updateTaskDto.progress = 100;
			}

			// Handle subtasks separately if they exist in the DTO
			const subtasks = updateTaskDto.subtasks;
			delete updateTaskDto.subtasks; // Remove subtasks from the main update

			// Convert assignees from uid to clerkUserId if present
			const updateData: any = { ...updateTaskDto };
			if (updateTaskDto.assignees && Array.isArray(updateTaskDto.assignees)) {
				const assigneeUids = updateTaskDto.assignees.map((a) => a.uid);
				const assigneeUsers = await this.userRepository.find({
					where: { uid: In(assigneeUids) },
					select: ['clerkUserId'],
				});
				updateData.assignees = assigneeUsers.map((u) => ({ clerkUserId: u.clerkUserId }));
			}
			
			// Update the task with the new data
			await this.taskRepository.update(ref, updateData);

			// Send push notifications for task updates
			if (Array.isArray(updateTaskDto.assignees) && updateTaskDto.assignees.length > 0) {
				try {
					// Convert DTO uids to clerkUserIds for comparison
					const newAssigneeUids = updateTaskDto.assignees.map((assignee) => assignee?.uid).filter(Boolean);
					const newAssigneeUsers = await this.userRepository.find({
						where: { uid: In(newAssigneeUids) },
						select: ['clerkUserId'],
					});
					const newAssigneeIds = newAssigneeUsers.map((u) => u.clerkUserId);
					const addedAssigneeIds = newAssigneeIds.filter((id) => !originalAssigneeIds.includes(id));

					// Track changes
					const changes = await this.trackTaskChanges(task, updateTaskDto);

					// Send push notification to new assignees
					if (addedAssigneeIds.length > 0) {
						const activeNewAssigneeIds = await this.filterActiveUsers(addedAssigneeIds);

						if (activeNewAssigneeIds.length > 0) {
							const creatorName = task.creator?.name || 'Team Member';
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.TASK_ASSIGNED,
							activeNewAssigneeIds,
							{
								taskTitle: task.title,
								taskId: task.uid,
								assignedBy: creatorName,
								deadline: task.deadline?.toLocaleDateString() || 'No deadline',
								priority: task.priority,
							},
							{
								priority: NotificationPriority.HIGH,
								customData: {
									screen: '/sales/tasks',
									action: 'view_task',
								},
							},
						);
							this.logger.log(`✅ Task assignment push notifications sent to ${activeNewAssigneeIds.length} new assignees`);
						}
					}

					// Send update notifications to existing assignees if there are changes
					if (changes.length > 0) {
						const existingAssigneeIds = newAssigneeIds.filter((id) => originalAssigneeIds.includes(id));

						if (existingAssigneeIds.length > 0) {
							const activeExistingAssigneeIds = await this.filterActiveUsers(existingAssigneeIds);

							if (activeExistingAssigneeIds.length > 0) {
							await this.unifiedNotificationService.sendTemplatedNotification(
								NotificationEvent.TASK_UPDATED,
								activeExistingAssigneeIds,
								{
									taskTitle: task.title,
									taskId: task.uid,
									updatedBy: 'Task Manager',
									changes: changes.join(', '),
								},
								{
									priority: NotificationPriority.NORMAL,
									customData: {
										screen: '/sales/tasks',
										action: 'view_task',
									},
								},
							);
								this.logger.log(`✅ Task update push notifications sent to ${activeExistingAssigneeIds.length} assignees`);
							}
						}
					}
				} catch (notificationError) {
					// Log error but don't fail task update
					this.logger.error('Failed to send task update push notifications:', notificationError.message);
				}
			}

			// If subtasks were provided, handle them
			if (subtasks && subtasks.length > 0) {
				// Get existing subtasks
				const existingSubtasks = await this.subtaskRepository.find({
					where: { task: { uid: ref } },
				});

				// Delete existing subtasks
				if (existingSubtasks.length > 0) {
					await this.subtaskRepository.delete(existingSubtasks.map((st) => st.uid));
				}

				// Create new subtasks
				const newSubtasks = subtasks.map((subtask) => ({
					...subtask,
					task: { uid: ref },
					status: SubTaskStatus.PENDING,
				}));

				await this.subtaskRepository.save(newSubtasks);
			}

			// Check for flags and update status if needed
			await this.checkFlagsAndUpdateTaskStatus(ref);

			// Reload the task to get the updated data
			let updatedTask = task;

			if (isCompletingTask) {
				updatedTask = await this.taskRepository.findOne({
					where: whereClause,
					relations: ['organisation', 'branch', 'creator'],
				});

				if (updatedTask) {
					// Push notifications are already sent above when task is completed
					this.logger.log('Task completed - push notifications already sent');
				}
			}

			// Clear cache after update
			await this.clearTaskCache(ref);

			return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}

	async remove(ref: number, orgId?: number, branchId?: number): Promise<{ message: string }> {
		this.logger.log(`Removing task: ${ref}, orgId: ${orgId}, branchId: ${branchId}`);
		try {
			if (!orgId) {
				this.logger.warn('Organization ID is required for task removal');
				throw new BadRequestException('Organization ID is required');
			}

			const whereClause: any = {
				uid: ref,
				isDeleted: false,
				organisation: { uid: orgId },
			};

			if (branchId) {
				whereClause.branch = { uid: branchId };
			}

			const task = await this.taskRepository.findOne({
				where: whereClause,
			});

			if (!task) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Perform soft delete
			await this.taskRepository.update(ref, { isDeleted: true });

			// Clear caches
			await this.clearTaskCache(ref);

			return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}

	async getTaskStatusSummary(): Promise<{
		byStatus: Record<TaskStatus, number>;
		total: number;
	}> {
		this.logger.log('Getting task status summary for today');
		try {
			const today = new Date();
			const startOfDay = new Date(today.setHours(0, 0, 0, 0));
			const endOfDay = new Date(today.setHours(23, 59, 59, 999));

			const tasks = await this.taskRepository.find({
				where: {
					deadline: Between(startOfDay, endOfDay),
				},
			});

			const byStatus: Record<TaskStatus, number> = {
				[TaskStatus.PENDING]: 0,
				[TaskStatus.IN_PROGRESS]: 0,
				[TaskStatus.COMPLETED]: 0,
				[TaskStatus.CANCELLED]: 0,
				[TaskStatus.OVERDUE]: 0,
				[TaskStatus.POSTPONED]: 0,
				[TaskStatus.MISSED]: 0,
			};

			tasks.forEach((task) => {
				if (task.status) byStatus[task.status]++;
			});

			return {
				byStatus,
				total: tasks.length,
			};
		} catch (error) {
			return {
				byStatus: Object.values(TaskStatus).reduce(
					(acc, status) => ({ ...acc, [status]: 0 }),
					{} as Record<TaskStatus, number>,
				),
				total: 0,
			};
		}
	}

	public async getTasksForDate(date: Date): Promise<{ total: number }> {
		try {
			// Create new Date objects to avoid modifying the input date
			const startOfDay = new Date(date);
			startOfDay.setHours(0, 0, 0, 0);

			const endOfDay = new Date(date);
			endOfDay.setHours(23, 59, 59, 999);

			const tasks = await this.taskRepository.count({
				where: {
					createdAt: Between(startOfDay, endOfDay),
				},
				relations: ['subtasks'],
			});

			return { total: tasks };
		} catch (error) {
			return { total: 0 };
		}
	}

	async findOneSubTask(
		ref: number,
		orgId?: number,
		branchId?: number,
	): Promise<{ tasks: SubTask | null; message: string }> {
		try {
			// First get the subtask
			const subtask = await this.subtaskRepository.findOne({
				where: { uid: ref, isDeleted: false },
				relations: ['task'],
			});

			if (!subtask) {
				return {
					tasks: null,
					message: process.env.NOT_FOUND_MESSAGE,
				};
			}

			// If we have organization or branch filters, verify the parent task belongs to them
			if (orgId || branchId) {
				const taskWhere: any = {
					uid: subtask.task.uid,
					isDeleted: false,
				};

				if (orgId) {
					taskWhere.organisation = { uid: orgId };
				}

				if (branchId) {
					taskWhere.branch = { uid: branchId };
				}

				// Check if the parent task matches the org/branch criteria
				const parentTask = await this.taskRepository.findOne({
					where: taskWhere,
				});

				if (!parentTask) {
					return {
						tasks: null,
						message: 'Subtask does not belong to the specified organization or branch',
					};
				}
			}

			return {
				tasks: subtask,
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			return {
				message: error?.message,
				tasks: null,
			};
		}
	}

	private async getParentTaskId(subtaskId: number): Promise<number | null> {
		try {
			const subtask = await this.subtaskRepository.findOne({
				where: { uid: subtaskId },
				relations: ['task'],
			});
			return subtask?.task?.uid || null;
		} catch (error) {
			return null;
		}
	}

	async updateSubTask(ref: number, updateSubTaskDto: UpdateSubtaskDto): Promise<{ message: string }> {
		try {
			// Update the subtask
			await this.subtaskRepository.update(ref, updateSubTaskDto);

			// Get parent task ID and clear cache
			const parentTaskId = await this.getParentTaskId(ref);
			if (parentTaskId) {
				await this.clearTaskCache(parentTaskId);
			}

			return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}

	async deleteSubTask(ref: number): Promise<{ message: string }> {
		try {
			// Get parent task ID before deletion
			const parentTaskId = await this.getParentTaskId(ref);

			// Delete the subtask
			await this.subtaskRepository.delete(ref);

			// Clear cache if we found the parent task
			if (parentTaskId) {
				await this.clearTaskCache(parentTaskId);
			}

			return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}

	async completeSubTask(ref: number): Promise<{ message: string }> {
		try {
			// Update the subtask status
			await this.subtaskRepository.update(ref, { status: SubTaskStatus.COMPLETED });

			// Get parent task ID and clear cache
			const parentTaskId = await this.getParentTaskId(ref);
			if (parentTaskId) {
				await this.clearTaskCache(parentTaskId);
			}

			return { message: process.env.SUCCESS_MESSAGE };
		} catch (error) {
			return { message: error?.message };
		}
	}

	async updateProgress(ref: number, progress: number): Promise<{ message: string }> {
		try {
			const task = await this.taskRepository.findOne({
				where: { uid: ref },
				relations: ['creator', 'subtasks', 'organisation'], // Removed 'assignees' - it's a JSON column, not a relation
			});

			if (!task) {
				throw new NotFoundException(process.env.NOT_FOUND_MESSAGE);
			}

			// Validate progress value
			if (progress < 0 || progress > 100) {
				throw new BadRequestException('Progress must be between 0 and 100');
			}

			// Update progress and let the entity hooks handle status updates
			task.progress = progress;
			const now = new Date();

			// If task is being completed, set the completion date
			if (progress === 100 && !task.completionDate) {
				task.status = TaskStatus.COMPLETED;
				task.completionDate = now;
			}

			await this.taskRepository.save(task);

			// Send notifications if task is completed
			if (progress === 100) {
				// Find who completed the task - for now, we don't have user context, so we'll use "System"
				const completedBy = 'Team Member'; // This could be enhanced to pass user context

				// Send push notifications to creator and assignees for task completion
				try {
					const creatorId = task.creator?.clerkUserId || null;
					const assigneeIds = task.assignees?.map((assignee) => assignee.clerkUserId) || [];
					const allRecipientIds = [creatorId, ...assigneeIds].filter(Boolean) as string[];

					// Filter out inactive users before sending notifications
					const activeRecipientIds = await this.filterActiveUsers(allRecipientIds);

					if (activeRecipientIds.length > 0) {
						// Use unified notification service for both email and push
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.TASK_COMPLETED,
							activeRecipientIds,
							{
								taskId: task.uid,
								taskTitle: task.title,
								completedBy: completedBy,
								taskDescription: task.description,
								taskPriority: task.priority,
								completionDate: task.completionDate?.toISOString() || now.toISOString(),
							},
							{
								priority: NotificationPriority.NORMAL,
								customData: {
									screen: '/sales/tasks',
									action: 'view_task',
								},
							},
						);
					}

					this.logger.log(`✅ Task completion push notifications sent to ${activeRecipientIds.length} assignees/creators`);
				} catch (notificationError) {
					// Silent fail - don't fail task completion
				}

				// Internal system notification for assignees and creator
				const notification = {
					type: NotificationType.USER,
					title: 'Task Completed',
					message: `Task "${task.title}" has been marked as complete`,
					status: NotificationStatus.UNREAD,
					owner: null,
				};

				const recipients = [task.creator?.clerkUserId, ...(task.assignees?.map((assignee) => assignee.clerkUserId) || [])].filter(Boolean) as string[];
				const uniqueRecipients = [...new Set(recipients)];

				// Filter out inactive users before sending internal notifications
				const activeInternalRecipients = await this.filterActiveUsers(uniqueRecipients);

				activeInternalRecipients.forEach((recipientId) => {
					this.eventEmitter.emit(
						'send.notification',
						{
							...notification,
							owner: { uid: recipientId },
							metadata: {
								taskId: task.uid,
								completedAt: now,
							},
						},
						[recipientId],
					);
				});

				// Push notifications already sent above to assignees and creators
				this.logger.log('Task completed - push notifications already sent');
			}

			// Clear cache after progress update
			await this.clearTaskCache(ref);

			return {
				message: process.env.SUCCESS_MESSAGE,
			};
		} catch (error) {
			throw new BadRequestException(error?.message);
		}
	}

	/**
	 * Track changes in task updates for notifications
	 */
	private async trackTaskChanges(originalTask: Task, updates: UpdateTaskDto): Promise<string[]> {
		const changes: string[] = [];

		if (updates.title && updates.title !== originalTask.title) {
			changes.push('Title updated');
		}
		if (updates.description !== undefined && updates.description !== originalTask.description) {
			changes.push('Description updated');
		}
		if (updates.priority && updates.priority !== originalTask.priority) {
			changes.push(`Priority changed to ${updates.priority}`);
		}
		if (updates.status && updates.status !== originalTask.status) {
			changes.push(`Status changed to ${updates.status}`);
		}
		if (updates.deadline) {
			const newDeadline = new Date(updates.deadline).getTime();
			const oldDeadline = originalTask.deadline ? new Date(originalTask.deadline).getTime() : 0;
			if (newDeadline !== oldDeadline) {
				changes.push('Deadline updated');
			}
		}
		if (updates.assignees && Array.isArray(updates.assignees)) {
			// Convert DTO uids to clerkUserIds for comparison
			const newAssigneeUids = updates.assignees.map((a) => a.uid);
			if (newAssigneeUids.length > 0) {
				const newAssigneeUsers = await this.userRepository.find({
					where: { uid: In(newAssigneeUids) },
					select: ['clerkUserId'],
				});
				const newAssigneeIds = newAssigneeUsers.map((u) => u.clerkUserId).sort().join(',');
				const oldAssigneeIds = (originalTask.assignees || []).map((a) => a.clerkUserId).sort().join(',');
				if (newAssigneeIds !== oldAssigneeIds) {
					changes.push('Assignees updated');
				}
			} else {
				// New assignees list is empty
				const oldAssigneeIds = (originalTask.assignees || []).map((a) => a.clerkUserId).sort().join(',');
				if (oldAssigneeIds.length > 0) {
					changes.push('Assignees updated');
				}
			}
		}

		return changes;
	}

	private async populateTasksForAnalytics(tasks: Task[]): Promise<Task[]> {
		return Promise.all(tasks.map((task) => this.populateTaskRelations(task)));
	}

	async getTasksReport(filter: any) {
		try {
			const tasks = await this.taskRepository.find({
				where: {
					...filter,
					isDeleted: false,
				},
				relations: ['creator', 'subtasks', 'organisation', 'branch'],
			});

			if (!tasks) {
				throw new NotFoundException('No tasks found for the specified period');
			}

			const populatedTasks = await this.populateTasksForAnalytics(tasks);

			const groupedTasks = {
				pending: populatedTasks.filter((task) => task.status === TaskStatus.PENDING),
				inProgress: populatedTasks.filter((task) => task.status === TaskStatus.IN_PROGRESS),
				completed: populatedTasks.filter((task) => task.status === TaskStatus.COMPLETED),
				overdue: populatedTasks.filter((task) => task.status === TaskStatus.OVERDUE),
			};

			const totalTasks = populatedTasks.length;
			const completedTasks = groupedTasks.completed.length;
			const avgCompletionTime = this.calculateAverageCompletionTime(populatedTasks);
			const overdueRate = this.calculateOverdueRate(populatedTasks);
			const taskDistribution = this.analyzeTaskDistribution(populatedTasks);
			const incompletionReasons = this.analyzeIncompletionReasons(populatedTasks);
			const clientCompletionRates = await this.analyzeClientCompletionRates(populatedTasks);
			const taskPriorityDistribution = this.analyzeTaskPriorityDistribution(populatedTasks);
			const assigneePerformance = await this.analyzeAssigneePerformance(populatedTasks);

			return {
				...groupedTasks,
				total: totalTasks,
				metrics: {
					completionRate: `${((completedTasks / totalTasks) * 100).toFixed(1)}%`,
					averageCompletionTime: `${avgCompletionTime} hours`,
					overdueRate: `${overdueRate}%`,
					taskDistribution,
					incompletionReasons,
					clientCompletionRates,
					taskPriorityDistribution,
					assigneePerformance,
				},
			};
		} catch (error) {
			return null;
		}
	}

	private calculateAverageCompletionTime(tasks: Task[]): number {
		const completedTasks = tasks.filter((task) => task.status === TaskStatus.COMPLETED && task.completionDate);

		if (completedTasks.length === 0) return 0;

		const totalCompletionTime = completedTasks.reduce((sum, task) => {
			const completionTime = task.completionDate.getTime() - task.createdAt.getTime();
			return sum + completionTime;
		}, 0);

		// Convert from milliseconds to hours
		return Number((totalCompletionTime / (completedTasks.length * 60 * 60 * 1000)).toFixed(1));
	}

	private calculateOverdueRate(tasks: Task[]): number {
		if (tasks.length === 0) return 0;
		const overdueTasks = tasks.filter((task) => task.isOverdue || task.status === TaskStatus.OVERDUE).length;
		return Number(((overdueTasks / tasks.length) * 100).toFixed(1));
	}

	private analyzeTaskDistribution(tasks: Task[]): Record<TaskType, number> {
		const distribution: Record<TaskType, number> = Object.values(TaskType).reduce((acc, type) => {
			acc[type] = 0;
			return acc;
		}, {} as Record<TaskType, number>);

		tasks.forEach((task) => {
			distribution[task.taskType] = (distribution[task.taskType] || 0) + 1;
		});
		return distribution;
	}

	private analyzeIncompletionReasons(tasks: Task[]): Array<{ reason: string; count: number }> {
		const reasons: Record<string, number> = {};
		tasks.forEach((task) => {
			if (task.status !== TaskStatus.COMPLETED) {
				const reason = this.determineIncompletionReason(task);
				reasons[reason] = (reasons[reason] || 0) + 1;
			}
		});
		return Object.entries(reasons)
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count);
	}

	private determineIncompletionReason(task: Task): string {
		if (task.status === TaskStatus.OVERDUE) return 'Deadline Missed';
		if (task.status === TaskStatus.CANCELLED) return 'Cancelled';
		if (task.status === TaskStatus.MISSED) {
			if (!task.completionDate) return 'Never Started';
			if (task.progress < 50) return 'Insufficient Progress';
			return 'Incomplete Work';
		}
		return 'Other';
	}

	private analyzeClientCompletionRates(tasks: Task[]): Array<{
		clientId: number;
		totalTasks: number;
		completedTasks: number;
		completionRate: string;
	}> {
		const clientStats: Record<
			number,
			{
				totalTasks: number;
				completedTasks: number;
			}
		> = {};

		tasks.forEach((task) => {
			task.clients?.forEach((client) => {
				if (!clientStats[client.uid]) {
					clientStats[client.uid] = {
						totalTasks: 0,
						completedTasks: 0,
					};
				}
				clientStats[client.uid].totalTasks++;
				if (task.status === TaskStatus.COMPLETED) {
					clientStats[client.uid].completedTasks++;
				}
			});
		});

		return Object.entries(clientStats).map(([clientId, stats]) => ({
			clientId: parseInt(clientId),
			totalTasks: stats.totalTasks,
			completedTasks: stats.completedTasks,
			completionRate: `${((stats.completedTasks / stats.totalTasks) * 100).toFixed(1)}%`,
		}));
	}

	private analyzeTaskPriorityDistribution(tasks: Task[]): Record<TaskPriority, number> {
		const distribution: Record<TaskPriority, number> = Object.values(TaskPriority).reduce((acc, priority) => {
			acc[priority] = 0;
			return acc;
		}, {} as Record<TaskPriority, number>);

		tasks.forEach((task) => {
			distribution[task.priority] = (distribution[task.priority] || 0) + 1;
		});
		return distribution;
	}

	private analyzeAssigneePerformance(tasks: Task[]): Array<{
		assigneeId: string;
		totalTasks: number;
		completedTasks: number;
		completionRate: string;
		averageCompletionTime: string;
	}> {
		const assigneeStats: Record<
			string,
			{
				totalTasks: number;
				completedTasks: number;
				totalCompletionTime: number;
			}
		> = {};

		tasks.forEach((task) => {
			task.assignees?.forEach((assignee) => {
				if (!assigneeStats[assignee.clerkUserId]) {
					assigneeStats[assignee.clerkUserId] = {
						totalTasks: 0,
						completedTasks: 0,
						totalCompletionTime: 0,
					};
				}
				assigneeStats[assignee.clerkUserId].totalTasks++;
				if (task.status === TaskStatus.COMPLETED && task.completionDate) {
					assigneeStats[assignee.clerkUserId].completedTasks++;
					assigneeStats[assignee.clerkUserId].totalCompletionTime +=
						new Date(task.completionDate).getTime() - new Date(task.createdAt).getTime();
				}
			});
		});

		return Object.entries(assigneeStats).map(([assigneeId, stats]) => ({
			assigneeId: assigneeId,
			totalTasks: stats.totalTasks,
			completedTasks: stats.completedTasks,
			completionRate: `${((stats.completedTasks / stats.totalTasks) * 100).toFixed(1)}%`,
			averageCompletionTime:
				stats.completedTasks > 0
					? `${Math.round(stats.totalCompletionTime / stats.completedTasks / (1000 * 60 * 60))} hours`
					: 'N/A',
		}));
	}

	async toggleJobStatus(taskId: number): Promise<{ task: Partial<Task>; message: string }> {
		this.logger.log(`Toggling job status for task: ${taskId}`);
		try {
			const task = await this.taskRepository.findOne({
				where: {
					uid: taskId,
					isDeleted: false,
				},
				relations: ['subtasks'],
			});

			if (!task) {
				throw new NotFoundException(`Task with ID ${taskId} not found`);
			}

			const now = new Date();

			// Determine the action based on current job status
			switch (task.jobStatus) {
				case JobStatus.QUEUED:
					// Start the job
					task.jobStartTime = now;
					task.jobEndTime = null;
					task.jobDuration = null;
					task.jobStatus = JobStatus.RUNNING;
					task.status = TaskStatus.IN_PROGRESS;
					break;

				case JobStatus.RUNNING:
					// Complete the job
					task.jobEndTime = now;
					task.jobStatus = JobStatus.COMPLETED;

					// Calculate duration in minutes
					if (task.jobStartTime) {
						const durationMs = task.jobEndTime.getTime() - task.jobStartTime.getTime();
						task.jobDuration = Math.round(durationMs / (1000 * 60));
					}

					// Update task status if appropriate (no subtasks or all subtasks completed)
					if (!task.subtasks?.length) {
						task.status = TaskStatus.COMPLETED;
						task.completionDate = now;
					} else if (
						task.subtasks.every(
							(subtask) => !subtask.isDeleted && subtask.status === SubTaskStatus.COMPLETED,
						)
					) {
						task.status = TaskStatus.COMPLETED;
						task.completionDate = now;
					}

				// Send completion push notifications if task was just completed
				if (task.status === TaskStatus.COMPLETED) {
					try {
						const creatorId = task.creator?.clerkUserId || null;
						const assigneeIds = task.assignees?.map((assignee) => assignee.clerkUserId) || [];
						const allRecipientIds = [creatorId, ...assigneeIds].filter(Boolean) as string[];
						const activeRecipientIds = await this.filterActiveUsers(allRecipientIds);

						if (activeRecipientIds.length > 0) {
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.TASK_COMPLETED,
							activeRecipientIds,
							{
								taskId: task.uid,
								taskTitle: task.title,
								completedBy: 'Task Manager',
								taskDescription: task.description,
								taskPriority: task.priority,
							},
							{
								priority: NotificationPriority.NORMAL,
								customData: {
									screen: '/sales/tasks',
									action: 'view_task',
								},
							},
						);
							this.logger.log(`✅ Task completion push notifications sent to ${activeRecipientIds.length} users`);
						}
					} catch (notificationError) {
						this.logger.error('Failed to send task completion push notifications:', notificationError.message);
					}
				}
					break;

				case JobStatus.COMPLETED:
					// Reset the job to start again
					task.jobStartTime = now;
					task.jobEndTime = null;
					task.jobDuration = null;
					task.jobStatus = JobStatus.RUNNING;
					task.status = TaskStatus.IN_PROGRESS;
					break;

				default:
					// Default to starting a job if status is not set
					task.jobStatus = JobStatus.RUNNING;
					task.jobStartTime = now;
					task.jobEndTime = null;
					task.jobDuration = null;
					task.status = TaskStatus.IN_PROGRESS;
					break;
			}

			// Save the updated task
			const savedTask = await this.taskRepository.save(task);

			// Emit event
			this.eventEmitter.emit('task.jobStatusChanged', {
				task: savedTask,
				previousStatus: task.jobStatus,
			});

			// Enhanced cache invalidation - clear both general cache and specific task cache
			await this.clearTaskCache(taskId);

			// Also clear any task flag cache if task has flags
			if (savedTask.flags?.length > 0) {
				await this.clearTaskFlagCache(taskId);
			}

			// Return the task with relevant fields
			return {
				task: {
					uid: savedTask.uid,
					title: savedTask.title,
					status: savedTask.status,
					jobStatus: savedTask.jobStatus,
					jobStartTime: savedTask.jobStartTime,
					jobEndTime: savedTask.jobEndTime,
					jobDuration: savedTask.jobDuration,
				},
				message: 'Job status updated successfully',
			};
		} catch (error) {
			throw error;
		}
	}

	async addComment(flagId: number, commentDto: AddCommentDto, userId: number): Promise<any> {
		try {
			const taskFlag = await this.taskFlagRepository.findOne({
				where: { uid: flagId },
				relations: ['task'],
			});

			if (!taskFlag) {
				throw new Error(`Task flag with ID ${flagId} not found`);
			}

			const user = await this.userRepository.findOne({
				where: { uid: userId },
				select: ['uid', 'name', 'surname'],
			});
			if (!user) {
				throw new Error('User not found');
			}

			// Initialize comments array if it doesn't exist
			if (!taskFlag.comments) {
				taskFlag.comments = [];
			}

			// Add the new comment with required database schema
			const newComment = {
				clerkUserId: user.clerkUserId,
				content: commentDto.content,
				createdAt: new Date(),
				createdBy: {
					clerkUserId: user.clerkUserId,
					name: `${user.name} ${user.surname}`,
				},
			};
			taskFlag.comments.push(newComment);

			// Save the updated flag
			await this.taskFlagRepository.save(taskFlag);

			// Clear cache for this flag and its related task
			await this.clearTaskFlagCache(taskFlag.task?.uid, flagId);

			return {
				message: 'Comment added successfully',
			};
		} catch (error) {
			throw new Error(`Failed to add comment: ${error.message}`);
		}
	}

	// Helper function to transform comments for email templates
	private transformCommentsForEmail(
		comments: Array<{
			uid: number;
			content: string;
			createdAt: Date | string;
			createdBy: { uid: number; name: string };
		}> = [],
	): Array<{
		content: string;
		createdAt: string;
		createdBy: { name: string };
	}> {
		return (comments || []).map((comment) => ({
			content: comment.content,
			createdAt:
				comment.createdAt instanceof Date
					? comment.createdAt.toISOString()
					: typeof comment.createdAt === 'string'
					? comment.createdAt
					: new Date().toISOString(),
			createdBy: {
				name: comment.createdBy.name,
			},
		}));
	}

	async createTaskFlag(createTaskFlagDto: CreateTaskFlagDto, userId: number): Promise<any> {
		try {
			// Find the task to flag with all necessary relations
			const task = await this.taskRepository.findOne({
				where: { uid: createTaskFlagDto.taskId },
				relations: ['creator'], // Removed 'assignees' since it's a JSON column, not a relation
			});
			if (!task) {
				throw new Error(`Task with ID ${createTaskFlagDto.taskId} not found`);
			}

			// Get user information with all necessary fields
			const user = await this.userRepository.findOne({
				where: { uid: userId },
				select: ['uid', 'name', 'surname', 'email'],
			});
			if (!user) {
				throw new Error('User not found');
			}

			// Always set task status to PENDING when a flag is added
			task.status = TaskStatus.PENDING;
			await this.taskRepository.save(task);

			// Create the flag
			const taskFlag = new TaskFlag();
			taskFlag.title = createTaskFlagDto.title;
			taskFlag.description = createTaskFlagDto.description;
			taskFlag.status = TaskFlagStatus.OPEN;
			taskFlag.task = task;
			taskFlag.createdBy = user;

			// Add deadline if provided
			if (createTaskFlagDto.deadline) {
				taskFlag.deadline = new Date(createTaskFlagDto.deadline);
			}

			// Handle attachments
			if (createTaskFlagDto.attachments?.length) {
				taskFlag.attachments = createTaskFlagDto.attachments;
			}

			// Initialize comments as empty array if not adding a comment
			taskFlag.comments = [];

			// Add initial comment if provided
			if (createTaskFlagDto.comment) {
				const newComment = {
					clerkUserId: user.clerkUserId,
					content: createTaskFlagDto.comment,
					createdAt: new Date(),
					createdBy: {
						clerkUserId: user.clerkUserId,
						name: `${user.name} ${user.surname}`,
					},
				};
				taskFlag.comments.push(newComment);
			}

			// Save the flag
			const savedFlag = await this.taskFlagRepository.save(taskFlag);

			// Add checklist items if provided
			let savedItems = [];
			if (createTaskFlagDto.items?.length) {
				const items = createTaskFlagDto.items.map((item) => {
					const flagItem = new TaskFlagItem();
					flagItem.title = item.title;
					flagItem.description = item.description;
					flagItem.status = TaskFlagItemStatus.PENDING;
					flagItem.taskFlag = savedFlag;
					return flagItem;
				});

				savedItems = await this.taskFlagItemRepository.save(items);
			}

			// Clear cache for this task's flags
			await this.clearTaskFlagCache(task.uid);
			await this.clearTaskCache(task.uid);

			// Create response object first
			const response = {
				flagId: savedFlag.uid,
				message: 'Task flag created successfully',
			};

			// Send push notifications asynchronously
			this.sendTaskFlagPushNotification(task, taskFlag, savedFlag, user, savedItems).catch((error) => {
				this.logger.error('Failed to send task flag push notification:', error.message);
			});

			return response;
		} catch (error) {
			throw new Error(`Failed to create task flag: ${error.message}`);
		}
	}

	// Helper method to send push notifications for task flags
	private async sendTaskFlagPushNotification(
		task: Task,
		taskFlag: TaskFlag,
		savedFlag: TaskFlag,
		user: User,
		savedItems: TaskFlagItem[],
	): Promise<void> {
		try {
			const userIds = new Set<string>();

			// Fetch client names if clients exist
			let clientNames = 'No Client';
			if (task.clients?.length > 0) {
				const clientIds = task.clients.map((c) => c.uid);
				const clientProfiles = await this.clientRepository.find({
					where: { uid: In(clientIds) },
					select: ['name'],
				});
				clientNames = clientProfiles.map(c => c.name).join(', ') || 'No Client';
			}

			// Collect all user IDs
			if (task.creator?.clerkUserId) {
				userIds.add(task.creator.clerkUserId);
			}

			const assigneeIds = task.assignees?.map((a) => a.clerkUserId) || [];
			assigneeIds.forEach((id) => userIds.add(id));

			if (taskFlag.createdBy?.clerkUserId) {
				userIds.add(taskFlag.createdBy.clerkUserId);
			}

			// Filter out inactive users
			const activeUserIds = await this.filterActiveUsers(Array.from(userIds) as string[]);

			if (activeUserIds.length === 0) {
				this.logger.log(`No active users found for task flag notification on task ${task.uid}`);
				return;
			}

			// Send detailed push notification for task flag creation
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.TASK_FLAG_CREATED,
				activeUserIds,
				{
					taskTitle: task.title,
					taskId: task.uid,
					flagTitle: savedFlag.title,
					flagCreatedBy: `${user.name} ${user.surname || ''}`.trim(),
					flagDescription: savedFlag.description,
					itemsCount: savedItems.length,
					items: savedItems.map(item => ({
						id: item.uid,
						title: item.title,
						description: item.description,
						status: item.status,
					})),
					taskDetails: {
						id: task.uid,
						title: task.title,
						description: task.description,
						priority: task.priority,
						status: task.status,
						deadline: task.deadline?.toISOString(),
						assignees: task.assignees?.map((a: any) => a.name || a.username) || [],
						creator: task.creator?.name || task.creator?.username || 'Unknown',
						client: clientNames,
						createdAt: task.createdAt?.toISOString(),
						updatedAt: task.updatedAt?.toISOString(),
					},
					flagDetails: {
						id: savedFlag.uid,
						title: taskFlag.title,
						description: taskFlag.description,
						createdBy: `${user.name} ${user.surname || ''}`.trim(),
						createdAt: savedFlag.createdAt?.toISOString(),
						items: savedItems.map(item => ({
							id: item.uid,
							title: item.title,
							description: item.description,
							status: item.status,
							createdAt: item.createdAt?.toISOString(),
						})),
					},
				},
				{
					priority: NotificationPriority.HIGH,
					customData: {
						screen: '/sales/tasks',
						action: 'view_task_flag',
						taskId: task.uid,
						flagId: savedFlag.uid,
						flagTitle: taskFlag.title,
						itemsCount: savedItems.length,
					},
				},
			);
			this.logger.log(`✅ Task flag push notifications sent to ${activeUserIds.length} recipients`);
		} catch (error) {
			this.logger.error('Error sending task flag push notification:', error.message);
			// Don't rethrow - we don't want this to affect the main operation
		}
	}

	async getTaskFlags(taskId: number, page: number = 1, limit: number = 10): Promise<any> {
		try {
			// Try to get from cache first
			const cacheKey = this.getTaskFlagCacheKey(taskId);
			const cacheKeyWithPagination = `${cacheKey}:${page}:${limit}`;

			const cachedFlags = await this.cacheManager.get(cacheKeyWithPagination);
			if (cachedFlags) {
				return cachedFlags;
			}

			// If not in cache, fetch from database
			const [flags, total] = await this.taskFlagRepository.findAndCount({
				where: { task: { uid: taskId }, isDeleted: false },
				relations: ['createdBy', 'items'],
				skip: (page - 1) * limit,
				take: limit,
				order: { createdAt: 'DESC' },
			});

			const result = {
				data: flags,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: 'Task flags retrieved successfully',
			};

			// Cache the result
			await this.cacheManager.set(cacheKeyWithPagination, result, this.CACHE_TTL);

			return result;
		} catch (error) {
			throw new Error(`Failed to get task flags: ${error.message}`);
		}
	}

	async getTaskFlag(flagId: number): Promise<any> {
		try {
			// Try to get from cache first
			const cacheKey = this.getTaskFlagDetailCacheKey(flagId);
			const cachedFlag = await this.cacheManager.get(cacheKey);

			if (cachedFlag) {
				return cachedFlag;
			}

			// If not in cache, fetch from database
			const taskFlag = await this.taskFlagRepository.findOne({
				where: { uid: flagId, isDeleted: false },
				relations: ['task', 'task.creator', 'createdBy', 'items'],
			});

			if (!taskFlag) {
				throw new Error(`Task flag with ID ${flagId} not found`);
			}

			const result = {
				data: taskFlag,
				message: 'Task flag retrieved successfully',
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			return result;
		} catch (error) {
			throw new Error(`Failed to get task flag: ${error.message}`);
		}
	}

	async updateTaskFlag(flagId: number, updateTaskFlagDto: UpdateTaskFlagDto): Promise<any> {
		try {
			const taskFlag = await this.taskFlagRepository.findOne({
				where: { uid: flagId, isDeleted: false },
				relations: ['task', 'task.creator', 'createdBy', 'items'],
			});

			if (!taskFlag) {
				throw new Error(`Task flag with ID ${flagId} not found`);
			}

			const previousStatus = taskFlag.status;

			// Update the flag properties
			if (updateTaskFlagDto.title) taskFlag.title = updateTaskFlagDto.title;
			if (updateTaskFlagDto.description) taskFlag.description = updateTaskFlagDto.description;
			if (updateTaskFlagDto.status) taskFlag.status = updateTaskFlagDto.status;
			if (updateTaskFlagDto.deadline) taskFlag.deadline = new Date(updateTaskFlagDto.deadline);

			// Save the updated flag
			await this.taskFlagRepository.save(taskFlag);

			// Check for flags and update the task status if needed
			if (taskFlag.task?.uid) {
				await this.checkFlagsAndUpdateTaskStatus(taskFlag.task.uid);
			}

			// Clear cache for this flag and its related task
			await this.clearTaskFlagCache(taskFlag.task?.uid, flagId);

			// Prepare success response first before email sending
			const successResponse = {
				message: 'Task flag updated successfully',
			};

			// Send push notifications asynchronously if status has changed
			if (updateTaskFlagDto.status && updateTaskFlagDto.status !== previousStatus) {
				// Use setTimeout with 0 to make this non-blocking
				setTimeout(async () => {
					try {
						const userIds = new Set<string>();

						// Collect all user IDs
						if (taskFlag.task.creator?.clerkUserId) {
							userIds.add(taskFlag.task.creator.clerkUserId);
						}

						const assigneeIds = taskFlag.task.assignees?.map((a) => a.clerkUserId) || [];
						assigneeIds.forEach((id) => userIds.add(id));

						if (taskFlag.createdBy?.clerkUserId) {
							userIds.add(taskFlag.createdBy.clerkUserId);
						}

						// Filter out inactive users
						const activeUserIds = await this.filterActiveUsers(Array.from(userIds));

						if (activeUserIds.length === 0) {
							this.logger.log(
								`No active users found for task flag update notification on task ${taskFlag.task.uid}`,
							);
							return;
						}

						// Send appropriate push notification based on status
						const notificationEvent =
							updateTaskFlagDto.status === TaskFlagStatus.RESOLVED
								? NotificationEvent.TASK_FLAG_RESOLVED
								: NotificationEvent.TASK_FLAG_UPDATED;

					await this.unifiedNotificationService.sendTemplatedNotification(
						notificationEvent,
						activeUserIds,
						{
							taskTitle: taskFlag.task.title,
							taskId: taskFlag.task.uid,
							flagTitle: taskFlag.title,
							flagStatus: updateTaskFlagDto.status,
						},
						{
							priority: NotificationPriority.NORMAL,
							customData: {
								screen: '/sales/tasks',
								action: 'view_task',
							},
						},
					);
						this.logger.log(`✅ Task flag update push notifications sent to ${activeUserIds.length} users`);
					} catch (error) {
						// Log error but don't throw - this allows task resolution to succeed even if notification fails
						this.logger.error(`Push notification failed for task flag ${flagId}: ${error.message}`);
					}
				}, 0);
			}

			return successResponse;
		} catch (error) {
			throw new Error(`Failed to update task flag: ${error.message}`);
		}
	}

	async updateTaskFlagItem(itemId: number, updateDto: UpdateTaskFlagItemDto): Promise<any> {
		try {
			const flagItem = await this.taskFlagItemRepository.findOne({
				where: { uid: itemId, isDeleted: false },
				relations: [
					'taskFlag',
					'taskFlag.task',
					'taskFlag.task.creator',
					'taskFlag.createdBy',
					'taskFlag.items',
				],
			});

			if (!flagItem) {
				throw new Error(`Task flag item with ID ${itemId} not found`);
			}

			// Update the item properties
			if (updateDto.title) flagItem.title = updateDto.title;
			if (updateDto.description) flagItem.description = updateDto.description;
			if (updateDto.status) flagItem.status = updateDto.status;

			// Save the updated item
			await this.taskFlagItemRepository.save(flagItem);

			// Check if all items are completed to auto-update flag status
			if (updateDto.status === TaskFlagItemStatus.COMPLETED) {
				const allItems = await this.taskFlagItemRepository.find({
					where: { taskFlag: { uid: flagItem.taskFlag.uid }, isDeleted: false },
				});

				const allCompleted = allItems.every(
					(item) =>
						item.status === TaskFlagItemStatus.COMPLETED || item.status === TaskFlagItemStatus.SKIPPED,
				);

				if (allCompleted) {
					const previousStatus = flagItem.taskFlag.status;
					flagItem.taskFlag.status = TaskFlagStatus.RESOLVED;
					await this.taskFlagRepository.save(flagItem.taskFlag);

					// Send push notification when flag is resolved
					const userIds = new Set<string>();

					// Collect all user IDs
					if (flagItem.taskFlag.task.creator?.clerkUserId) {
						userIds.add(flagItem.taskFlag.task.creator.clerkUserId);
					}

					const assigneeIds = flagItem.taskFlag.task.assignees?.map((a) => a.clerkUserId) || [];
					assigneeIds.forEach((id) => userIds.add(id));

					if (flagItem.taskFlag.createdBy?.clerkUserId) {
						userIds.add(flagItem.taskFlag.createdBy.clerkUserId);
					}

					// Filter out inactive users
					const activeUserIds = await this.filterActiveUsers(Array.from(userIds));

					if (activeUserIds.length === 0) {
						this.logger.log(
							`No active users found for task flag resolution notification on task ${flagItem.taskFlag.task.uid}`,
						);
						return {
							message: 'Task flag item updated successfully',
						};
					}

				// Send push notification
				await this.unifiedNotificationService.sendTemplatedNotification(
					NotificationEvent.TASK_FLAG_RESOLVED,
					activeUserIds,
					{
						taskTitle: flagItem.taskFlag.task.title,
						taskId: flagItem.taskFlag.task.uid,
						flagTitle: flagItem.taskFlag.title,
					},
					{
						priority: NotificationPriority.NORMAL,
						customData: {
							screen: '/sales/tasks',
							action: 'view_task',
						},
					},
				);
					this.logger.log(`✅ Task flag resolution push notifications sent to ${activeUserIds.length} users`);
				}
			}

			// Clear cache for this flag and its related task
			await this.clearTaskFlagCache(flagItem.taskFlag?.task?.uid, flagItem.taskFlag?.uid);

			return {
				message: 'Task flag item updated successfully',
			};
		} catch (error) {
			throw new Error(`Failed to update task flag item: ${error.message}`);
		}
	}

	async deleteTaskFlag(flagId: number): Promise<any> {
		try {
			const taskFlag = await this.taskFlagRepository.findOne({
				where: { uid: flagId },
				relations: ['task'],
			});

			if (!taskFlag) {
				throw new Error(`Task flag with ID ${flagId} not found`);
			}

			// Soft delete
			taskFlag.isDeleted = true;
			await this.taskFlagRepository.save(taskFlag);

			// After deleting a flag, check and update task status
			if (taskFlag.task?.uid) {
				await this.checkFlagsAndUpdateTaskStatus(taskFlag.task.uid);
			}

			// Clear cache for this flag and its related task
			await this.clearTaskFlagCache(taskFlag.task?.uid, flagId);

			return {
				message: 'Task flag deleted successfully',
			};
		} catch (error) {
			throw new Error(`Failed to delete task flag: ${error.message}`);
		}
	}

	async getTaskFlagReports(filters: any = {}, page: number = 1, limit: number = 10): Promise<any> {
		try {
			// Create a hash of the filters for cache key
			const filterHash = JSON.stringify(filters) + `:${page}:${limit}`;
			const cacheKey = this.getTaskFlagReportsCacheKey(filterHash);

			// Try to get from cache first
			const cachedReports = await this.cacheManager.get(cacheKey);
			if (cachedReports) {
				return cachedReports;
			}

			// If not in cache, fetch from database
			const queryBuilder = this.taskFlagRepository
				.createQueryBuilder('taskFlag')
				.leftJoinAndSelect('taskFlag.task', 'task')
				.leftJoinAndSelect('taskFlag.createdBy', 'user')
				.leftJoinAndSelect('taskFlag.items', 'items')
				.where('taskFlag.isDeleted = :isDeleted', { isDeleted: false });

			// Apply filters
			if (filters.status) {
				queryBuilder.andWhere('taskFlag.status = :status', { status: filters.status });
			}

			if (filters.startDate) {
				queryBuilder.andWhere('taskFlag.createdAt >= :startDate', { startDate: filters.startDate });
			}

			if (filters.endDate) {
				queryBuilder.andWhere('taskFlag.createdAt <= :endDate', { endDate: filters.endDate });
			}

			if (filters.deadlineBefore) {
				queryBuilder.andWhere('taskFlag.deadline <= :deadlineBefore', {
					deadlineBefore: filters.deadlineBefore,
				});
			}

			if (filters.deadlineAfter) {
				queryBuilder.andWhere('taskFlag.deadline >= :deadlineAfter', {
					deadlineAfter: filters.deadlineAfter,
				});
			}

			if (filters.userId) {
				queryBuilder.andWhere('user.uid = :userId', { userId: filters.userId });
			}

			// Add organization filter if provided
			if (filters.organisationRef) {
				queryBuilder.andWhere('task.organisation.uid = :organisationRef', {
					organisationRef: filters.organisationRef,
				});
			}

			// Add branch filter if provided
			if (filters.branchId) {
				queryBuilder.andWhere('task.branch.uid = :branchId', { branchId: filters.branchId });
			}

			// Count total matching records
			const total = await queryBuilder.getCount();

			// Add pagination
			queryBuilder
				.skip((page - 1) * limit)
				.take(limit)
				.orderBy('taskFlag.createdAt', 'DESC');

			// Execute query
			const flags = await queryBuilder.getMany();

			const result = {
				data: flags,
				meta: {
					total,
					page,
					limit,
					totalPages: Math.ceil(total / limit),
				},
				message: 'Task flag reports retrieved successfully',
			};

			// Cache the result
			await this.cacheManager.set(cacheKey, result, this.CACHE_TTL);

			return result;
		} catch (error) {
			throw new Error(`Failed to get task flag reports: ${error.message}`);
		}
	}
}
