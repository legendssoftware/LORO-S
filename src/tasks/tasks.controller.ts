import { TasksService } from './tasks.service';
import { TaskRouteService } from './task-route.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
	ApiOperation,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiQuery,
} from '@nestjs/swagger';
import { Roles } from '../decorators/role.decorator';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { UpdateSubtaskDto } from './dto/update-subtask.dto';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { TaskStatus, TaskPriority } from '../lib/enums/task.enums';
import { OptimizedRoute } from './interfaces/route.interface';
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Request, ParseIntPipe } from '@nestjs/common';
import { CreateTaskFlagDto } from './dto/create-task-flag.dto';
import { UpdateTaskFlagDto } from './dto/update-task-flag.dto';
import { UpdateTaskFlagItemDto } from './dto/update-task-flag-item.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { TaskFlagStatus } from '../lib/enums/task.enums';

@ApiTags('🔧 Tasks')
@Controller('tasks')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('tasks')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class TasksController {
	constructor(private readonly tasksService: TasksService, private readonly taskRouteService: TaskRouteService) {}

	@Post()
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Create a new task',
		description: 'Creates a new task with the provided details including assignees, clients, and subtasks',
	})
	@ApiBody({ type: CreateTaskDto })
	@ApiCreatedResponse({
		description: 'Task created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error creating task' },
			},
		},
	})
	create(@Body() createTaskDto: CreateTaskDto, @Request() req: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		return this.tasksService.create(createTaskDto, orgId, branchId);
	}

	@Get()
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get all tasks',
		description:
			'Retrieves a paginated list of all tasks with optional filtering by status, priority, assignee, client, date range, and overdue status',
	})
	@ApiQuery({ name: 'status', enum: TaskStatus, required: false, description: 'Filter by task status' })
	@ApiQuery({ name: 'priority', enum: TaskPriority, required: false, description: 'Filter by task priority' })
	@ApiQuery({ name: 'assigneeId', type: String, required: false, description: 'Filter by assignee ID' })
	@ApiQuery({ name: 'clientId', type: String, required: false, description: 'Filter by client ID' })
	@ApiQuery({ name: 'startDate', type: String, required: false, description: 'Filter by start date (ISO format)' })
	@ApiQuery({ name: 'endDate', type: String, required: false, description: 'Filter by end date (ISO format)' })
	@ApiQuery({
		name: 'isOverdue',
		type: String,
		required: false,
		description: 'Filter by overdue status (true/false)',
	})
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to system setting',
	})
	@ApiOkResponse({
		description: 'List of tasks retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							title: { type: 'string' },
							description: { type: 'string' },
							status: { type: 'string', enum: Object.values(TaskStatus) },
							priority: { type: 'string', enum: Object.values(TaskPriority) },
							deadline: { type: 'string', format: 'date-time' },
							progress: { type: 'number' },
							isOverdue: { type: 'boolean' },
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 100 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 10 },
						totalPages: { type: 'number', example: 10 },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	findAll(
		@Query('status') status?: string,
		@Query('priority') priority?: string,
		@Query('assigneeId') assigneeId?: string,
		@Query('clientId') clientId?: string,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('isOverdue') isOverdue?: string,
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Request() req?: any,
	) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;

		// Parse the filters
		const filters: any = {};
		if (status) filters.status = status;
		if (priority) filters.priority = priority;
		if (assigneeId) filters.assigneeId = parseInt(assigneeId, 10);
		if (clientId) filters.clientId = parseInt(clientId, 10);
		if (startDate) filters.startDate = new Date(startDate);
		if (endDate) filters.endDate = new Date(endDate);
		if (isOverdue) filters.isOverdue = isOverdue.toLowerCase() === 'true';

		return this.tasksService.findAll(
			filters,
			page ? parseInt(page, 10) : 1,
			limit ? parseInt(limit, 10) : Number(process.env.DEFAULT_PAGE_LIMIT),
			orgId,
			branchId,
		);
	}

	@Get(':ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get task by reference code',
		description: 'Retrieves detailed information about a specific task by its reference code',
	})
	@ApiParam({ name: 'ref', description: 'Task reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Task details retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				task: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						title: { type: 'string' },
						description: { type: 'string' },
						status: { type: 'string', enum: Object.values(TaskStatus) },
						priority: { type: 'string', enum: Object.values(TaskPriority) },
						deadline: { type: 'string', format: 'date-time' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Task not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Task not found' },
				task: { type: 'null' },
			},
		},
	})
	findOne(@Param('ref', ParseIntPipe) ref: number, @Request() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		return this.tasksService.findOne(ref, orgId, branchId);
	}

	@Get('for/:ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get tasks for a specific user',
		description: 'Retrieves all tasks assigned to a specific user by their ID',
	})
	@ApiParam({ name: 'ref', description: 'User reference ID', type: 'number' })
	@ApiOkResponse({
		description: 'User tasks retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				tasks: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							title: { type: 'string' },
							description: { type: 'string' },
							status: { type: 'string', enum: Object.values(TaskStatus) },
							priority: { type: 'string', enum: Object.values(TaskPriority) },
							deadline: { type: 'string', format: 'date-time' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	tasksByUser(@Param('ref', ParseIntPipe) ref: number, @Request() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		return this.tasksService.tasksByUser(ref, orgId, branchId);
	}

	@Get('sub-task/:ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get subtask by reference code',
		description: 'Retrieves detailed information about a specific subtask by its reference code',
	})
	findOneSubTask(@Param('ref', ParseIntPipe) ref: number, @Request() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		return this.tasksService.findOneSubTask(ref, orgId, branchId);
	}

	@Patch(':ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Update a task',
		description: 'Updates a task with the provided details',
	})
	@ApiParam({ name: 'ref', description: 'Task reference code', type: 'number' })
	@ApiBody({ type: UpdateTaskDto })
	@ApiOkResponse({
		description: 'Task updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Task not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Task not found' },
			},
		},
	})
	update(@Param('ref', ParseIntPipe) ref: number, @Body() updateTaskDto: UpdateTaskDto, @Request() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		return this.tasksService.update(ref, updateTaskDto, orgId, branchId);
	}

	@Patch('sub-task/:ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Update a subtask by reference',
		description: 'Updates an existing subtask with the provided information',
	})
	@ApiParam({ name: 'ref', description: 'Subtask reference code or ID', type: 'number' })
	@ApiBody({ type: UpdateSubtaskDto })
	@ApiOkResponse({
		description: 'Subtask updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Subtask not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Subtask not found' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error updating subtask' },
			},
		},
	})
	updateSubTask(@Param('ref', ParseIntPipe) ref: number, @Body() updateSubTaskDto: UpdateSubtaskDto) {
		return this.tasksService.updateSubTask(ref, updateSubTaskDto);
	}

	@Patch('sub-task/complete/:ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Complete a subtask by reference',
		description: 'Marks a subtask as completed',
	})
	@ApiParam({ name: 'ref', description: 'Subtask reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Subtask completed successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Subtask not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Subtask not found' },
			},
		},
	})
	completeSubTask(@Param('ref', ParseIntPipe) ref: number) {
		return this.tasksService.completeSubTask(ref);
	}

	@Delete('sub-task/:ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Soft delete a subtask by reference',
		description: 'Marks a subtask as deleted without removing it from the database',
	})
	@ApiParam({ name: 'ref', description: 'Subtask reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Subtask deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Subtask not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Subtask not found' },
			},
		},
	})
	deleteSubTask(@Param('ref', ParseIntPipe) ref: number) {
		return this.tasksService.deleteSubTask(ref);
	}

	@Delete(':ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Delete a task',
		description: 'Soft-deletes a task by its reference code',
	})
	@ApiParam({ name: 'ref', description: 'Task reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Task deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Task not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Task not found' },
			},
		},
	})
	remove(@Param('ref', ParseIntPipe) ref: number, @Request() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		return this.tasksService.remove(ref, orgId, branchId);
	}

	@Get('routes/optimized')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get optimized task routes',
		description: 'Retrieves optimized routes for field technicians based on task locations',
	})
	async getOptimizedRoutes(@Query('date') dateStr?: string, @Request() req?: any): Promise<OptimizedRoute[]> {
		const date = dateStr ? new Date(dateStr) : new Date();
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		const routes = await this.taskRouteService.getRoutes(date, orgId, branchId);

		return routes.map((route) => ({
			userId: route.assignee.uid,
			stops: route.waypoints.map((wp) => ({
				taskId: wp.taskId,
				clientId: wp.clientId,
				location: {
					latitude: wp.location.lat,
					longitude: wp.location.lng,
					address: '',
				},
			})),
			estimatedDuration: route.totalDuration,
			totalDistance: route.totalDistance,
		}));
	}

	@Post('routes/calculate')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: 'Calculate optimized routes',
		description: 'Triggers the calculation of optimized routes for field technicians',
	})
	async calculateOptimizedRoutes(
		@Query('date') dateStr?: string,
		@Request() req?: any,
	): Promise<{ message: string }> {
		const date = dateStr ? new Date(dateStr) : new Date();
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		await this.taskRouteService.planRoutes(date, orgId, branchId);

		return { message: 'Routes calculated successfully' };
	}

	@Patch('toggle-job-status/:id')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Toggle job status',
		description:
			'Toggles job status between QUEUED, RUNNING, and COMPLETED. Updates start/end times and calculates duration.',
	})
	@ApiParam({ name: 'id', description: 'Task ID', type: 'number' })
	@ApiOkResponse({
		description: 'Job status toggled successfully',
		schema: {
			type: 'object',
			properties: {
				task: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						title: { type: 'string' },
						status: { type: 'string' },
						jobStatus: { type: 'string' },
						jobStartTime: { type: 'string', format: 'date-time' },
						jobEndTime: { type: 'string', format: 'date-time' },
						jobDuration: { type: 'number' },
					},
				},
				message: { type: 'string', example: 'Job status updated successfully' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Task not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Task not found' },
			},
		},
	})
	toggleJobStatus(@Param('id') id: string) {
		return this.tasksService.toggleJobStatus(+id);
	}

	@Post('flags')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'Create task flag', description: 'Creates a new task flag for issue tracking' })
	createTaskFlag(@Body() createTaskFlagDto: CreateTaskFlagDto, @Request() req: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;
		
		return this.tasksService.createTaskFlag(createTaskFlagDto, userId);
	}

	@Post('flags/:flagId/comments')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Add a comment to a task flag',
		description: 'Adds a new comment to an existing task flag',
	})
	@ApiParam({ name: 'flagId', description: 'Task flag ID', type: 'number' })
	@ApiBody({ type: AddCommentDto })
	@ApiCreatedResponse({
		description: 'Comment added successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Comment added successfully' },
			},
		},
	})
	addComment(@Param('flagId', ParseIntPipe) flagId: number, @Body() commentDto: AddCommentDto, @Request() req: any) {
		const userId = req.user?.uid;
		return this.tasksService.addComment(flagId, commentDto, userId);
	}

	@Get('tasks/:taskId/flags')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get flags for a specific task',
		description: 'Retrieves all flags created for a specific task',
	})
	@ApiParam({ name: 'taskId', description: 'Task ID', type: 'number' })
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to 10',
	})
	getTaskFlags(@Param('taskId', ParseIntPipe) taskId: number, @Query('page') page?: string, @Query('limit') limit?: string) {
		const pageNum = page ? parseInt(page, 10) : 1;
		const limitNum = limit ? parseInt(limit, 10) : 10;
		return this.tasksService.getTaskFlags(taskId, pageNum, limitNum);
	}

	@Get('flags/:flagId')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get a specific task flag',
		description: 'Retrieves detailed information about a specific task flag',
	})
	@ApiParam({ name: 'flagId', description: 'Flag ID', type: 'number' })
	getTaskFlag(@Param('flagId', ParseIntPipe) flagId: number) {
		return this.tasksService.getTaskFlag(flagId);
	}

	@Patch('flags/:flagId')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Update a task flag',
		description: 'Updates the details of an existing task flag',
	})
	@ApiParam({ name: 'flagId', description: 'Flag ID', type: 'number' })
	updateTaskFlag(@Param('flagId', ParseIntPipe) flagId: number, @Body() updateTaskFlagDto: UpdateTaskFlagDto) {
		return this.tasksService.updateTaskFlag(flagId, updateTaskFlagDto);
	}

	@Patch('flag-items/:itemId')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Update a task flag checklist item',
		description: 'Updates the status or details of a task flag checklist item',
	})
	@ApiParam({ name: 'itemId', description: 'Flag Item ID', type: 'number' })
	updateTaskFlagItem(@Param('itemId', ParseIntPipe) itemId: number, @Body() updateTaskFlagItemDto: UpdateTaskFlagItemDto) {
		return this.tasksService.updateTaskFlagItem(itemId, updateTaskFlagItemDto);
	}

	@Delete('flags/:flagId')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Delete a task flag',
		description: 'Soft deletes a task flag',
	})
	@ApiParam({ name: 'flagId', description: 'Flag ID', type: 'number' })
	deleteTaskFlag(@Param('flagId', ParseIntPipe) flagId: number) {
		return this.tasksService.deleteTaskFlag(flagId);
	}

	@Get('flags/reports')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: 'Get task flag reports',
		description: 'Retrieves reports and analytics for task flags with various filtering options',
	})
	@ApiQuery({ name: 'status', enum: TaskFlagStatus, required: false, description: 'Filter by flag status' })
	@ApiQuery({ name: 'startDate', type: String, required: false, description: 'Filter by start date (ISO format)' })
	@ApiQuery({ name: 'endDate', type: String, required: false, description: 'Filter by end date (ISO format)' })
	@ApiQuery({
		name: 'deadlineBefore',
		type: String,
		required: false,
		description: 'Filter by deadline before date (ISO format)',
	})
	@ApiQuery({
		name: 'deadlineAfter',
		type: String,
		required: false,
		description: 'Filter by deadline after date (ISO format)',
	})
	@ApiQuery({ name: 'userId', type: Number, required: false, description: 'Filter by user who created the flag' })
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to 10',
	})
	getTaskFlagReports(
		@Query('status') status?: TaskFlagStatus,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('deadlineBefore') deadlineBefore?: string,
		@Query('deadlineAfter') deadlineAfter?: string,
		@Query('userId') userId?: number,
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Request() req?: any,
	) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		
		const filters: any = {};
		if (status) filters.status = status;
		if (startDate) filters.startDate = new Date(startDate);
		if (endDate) filters.endDate = new Date(endDate);
		if (deadlineBefore) filters.deadlineBefore = new Date(deadlineBefore);
		if (deadlineAfter) filters.deadlineAfter = new Date(deadlineAfter);
		if (userId) filters.userId = Number(userId);
		if (orgId) filters.organisationId = orgId;
		if (branchId) filters.branchId = branchId;

		return this.tasksService.getTaskFlagReports(
			filters,
			page ? parseInt(page, 10) : 1,
			limit ? parseInt(limit, 10) : Number(process.env.DEFAULT_PAGE_LIMIT),
		);
	}
}
