import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Request, Req } from '@nestjs/common';
import { LeaveService } from './leave.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { UpdateLeaveDto } from './dto/update-leave.dto';
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
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { LeaveStatus, LeaveType } from '../lib/enums/leave.enums';

@ApiTags('🌴 Leave')
@Controller('leave')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('leave')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class LeaveController {
	constructor(private readonly leaveService: LeaveService) {}

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
		summary: 'Create a new leave request',
		description: 'Creates a new leave request with the provided details including dates, type, and duration',
	})
	@ApiBody({ type: CreateLeaveDto })
	@ApiCreatedResponse({
		description: 'Leave request created successfully',
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
				message: { type: 'string', example: 'Error creating leave request' },
			},
		},
	})
	create(@Body() createLeaveDto: CreateLeaveDto, @Req() req: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.create(createLeaveDto, orgId, branchId, userId);
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
		summary: 'Get all leave requests',
		description:
			'Retrieves a paginated list of all leave requests with optional filtering by status, type, date range, and user',
	})
	@ApiQuery({ name: 'status', enum: LeaveStatus, required: false, description: 'Filter by leave status' })
	@ApiQuery({ name: 'leaveType', enum: LeaveType, required: false, description: 'Filter by leave type' })
	@ApiQuery({ name: 'ownerUid', type: String, required: false, description: 'Filter by owner user ID' })
	@ApiQuery({ name: 'startDate', type: String, required: false, description: 'Filter by start date (ISO format)' })
	@ApiQuery({ name: 'endDate', type: String, required: false, description: 'Filter by end date (ISO format)' })
	@ApiQuery({ name: 'isApproved', type: Boolean, required: false, description: 'Filter by approval status' })
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to system setting',
	})
	@ApiOkResponse({
		description: 'List of leave requests retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							leaveType: { type: 'string', enum: Object.values(LeaveType) },
							startDate: { type: 'string', format: 'date' },
							endDate: { type: 'string', format: 'date' },
							duration: { type: 'number' },
							status: { type: 'string', enum: Object.values(LeaveStatus) },
							isHalfDay: { type: 'boolean' },
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
		@Query('leaveType') leaveType?: string,
		@Query('ownerUid') ownerUid?: string,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('isApproved') isApproved?: string,
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Req() req?: any,
	) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		// Parse the filters
		const filters: any = {};
		if (status) filters.status = status;
		if (leaveType) filters.leaveType = leaveType;
		if (ownerUid) filters.ownerUid = parseInt(ownerUid, 10);
		if (startDate) filters.startDate = new Date(startDate);
		if (endDate) filters.endDate = new Date(endDate);
		if (isApproved) filters.isApproved = isApproved.toLowerCase() === 'true';

		return this.leaveService.findAll(
			filters,
			page ? parseInt(page, 10) : 1,
			limit ? parseInt(limit, 10) : Number(process.env.DEFAULT_PAGE_LIMIT),
			orgId,
			branchId,
			userId,
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
		summary: 'Get leave request by reference code',
		description: 'Retrieves detailed information about a specific leave request by its reference code',
	})
	@ApiParam({ name: 'ref', description: 'Leave reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Leave request details retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				leave: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						leaveType: { type: 'string', enum: Object.values(LeaveType) },
						startDate: { type: 'string', format: 'date' },
						endDate: { type: 'string', format: 'date' },
						duration: { type: 'number' },
						status: { type: 'string', enum: Object.values(LeaveStatus) },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Leave request not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found' },
				leave: { type: 'null' },
			},
		},
	})
	findOne(@Param('ref') ref: number, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.findOne(ref, orgId, branchId, userId);
	}

	@Get('user/:ref')
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
		summary: 'Get leave requests for a specific user',
		description: 'Retrieves all leave requests for a specific user by their ID',
	})
	@ApiParam({ name: 'ref', description: 'User reference ID', type: 'number' })
	@ApiOkResponse({
		description: 'User leave requests retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				leaves: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							leaveType: { type: 'string', enum: Object.values(LeaveType) },
							startDate: { type: 'string', format: 'date' },
							endDate: { type: 'string', format: 'date' },
							duration: { type: 'number' },
							status: { type: 'string', enum: Object.values(LeaveStatus) },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	leavesByUser(@Param('ref') ref: number, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.leavesByUser(ref, orgId, branchId, userId);
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
		summary: 'Update a leave request',
		description: 'Updates a leave request with the provided details',
	})
	@ApiParam({ name: 'ref', description: 'Leave reference code', type: 'number' })
	@ApiBody({ type: UpdateLeaveDto })
	@ApiOkResponse({
		description: 'Leave request updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Leave request not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error updating leave request' },
			},
		},
	})
	update(@Param('ref') ref: number, @Body() updateLeaveDto: UpdateLeaveDto, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.update(ref, updateLeaveDto, orgId, branchId, userId);
	}

	@Patch(':ref/approve')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Approve a leave request',
		description: 'Approves a pending leave request',
	})
	@ApiParam({ name: 'ref', description: 'Leave reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Leave request approved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Leave request not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found' },
			},
		},
	})
	approve(@Param('ref') ref: number, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;
		const approverUid = req.user?.uid;

		return this.leaveService.approveLeave(ref, approverUid, orgId, branchId, userId);
	}

	@Patch(':ref/reject')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Reject a leave request',
		description: 'Rejects a pending leave request',
	})
	@ApiParam({ name: 'ref', description: 'Leave reference code', type: 'number' })
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				rejectionReason: { type: 'string', example: 'Staff shortage during that period' },
			},
			required: ['rejectionReason'],
		},
	})
	@ApiOkResponse({
		description: 'Leave request rejected successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Leave request not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found' },
			},
		},
	})
	reject(@Param('ref') ref: number, @Body() body: { rejectionReason: string }, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.rejectLeave(ref, body.rejectionReason, orgId, branchId, userId);
	}

	@Patch(':ref/cancel')
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
		summary: 'Cancel a leave request',
		description: 'Cancels a leave request (can be done by the owner or admin/manager)',
	})
	@ApiParam({ name: 'ref', description: 'Leave reference code', type: 'number' })
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				cancellationReason: { type: 'string', example: 'Plans changed' },
			},
			required: ['cancellationReason'],
		},
	})
	@ApiOkResponse({
		description: 'Leave request cancelled successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Leave request not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found' },
			},
		},
	})
	cancel(@Param('ref') ref: number, @Body() body: { cancellationReason: string }, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.cancelLeave(ref, body.cancellationReason, userId, orgId, branchId);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Delete a leave request',
		description: 'Soft deletes a leave request from the system',
	})
	@ApiParam({ name: 'ref', description: 'Leave reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Leave request deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Leave request not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Leave request not found' },
			},
		},
	})
	remove(@Param('ref') ref: number, @Req() req?: any) {
		const orgId = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchId = req.user?.branch?.uid || req.branch?.uid;
		const userId = req.user?.uid;

		return this.leaveService.remove(ref, orgId, branchId, userId);
	}
}
