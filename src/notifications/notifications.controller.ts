import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { ApiOperation, ApiTags, ApiBody, ApiOkResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { RoleGuard } from '../guards/role.guard';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { AuthenticatedRequest, getClerkUserId } from '../lib/interfaces/authenticated-request.interface';

@ApiTags('🔔 Notifications')
@Controller('notifications')
@UseGuards(ClerkAuthGuard, RoleGuard)
export class NotificationsController {
	constructor(private readonly notificationsService: NotificationsService) {}

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
		summary: 'create a new notification',
		description: createApiDescription(
			'Creates a new notification for users.',
			'The service method `NotificationsService.create()` processes notification creation, validates data, sends push notifications, and returns the created notification.',
			'NotificationsService',
			'create',
			'creates a new notification, validates data, and sends push notifications',
			'an object containing the created notification data',
			['Data validation', 'Push notification sending', 'User targeting'],
		),
	})
	create(@Body() createNotificationDto: CreateNotificationDto, @Req() req: AuthenticatedRequest) {
		const clerkUserId = getClerkUserId(req);
		if (!clerkUserId) throw new BadRequestException('Authentication required');
		return this.notificationsService.create(createNotificationDto, clerkUserId);
	}

	@Post('register-token')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
		AccessLevel.CLIENT,
	)
	@ApiOperation({ summary: 'Register user push token for notifications' })
	@ApiBody({ type: RegisterPushTokenDto })
	@ApiOkResponse({
		description: 'Push token registered successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Push token registered successfully' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Failed to register push token',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to register push token' },
			},
		},
	})
	registerPushToken(@Body() registerTokenDto: RegisterPushTokenDto, @Req() req: AuthenticatedRequest) {
		return this.notificationsService.registerPushToken(req.user.uid, registerTokenDto, req.user.role);
	}

	@Post('verify-token')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
		AccessLevel.CLIENT,
	)
	@ApiOperation({ summary: 'Verify and sync push token status' })
	@ApiBody({
		type: RegisterPushTokenDto,
		description: 'Current device token and platform info',
	})
	@ApiOkResponse({
		description: 'Token verification response',
		schema: {
			type: 'object',
			properties: {
				isValid: { type: 'boolean', example: true },
				needsUpdate: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Token is valid and up to date' },
				serverToken: { type: 'string', example: 'ExponentPushToken[...] or null' },
				lastUpdated: { type: 'string', format: 'date-time' },
			},
		},
	})
	verifyPushToken(@Body() registerTokenDto: RegisterPushTokenDto, @Req() req: AuthenticatedRequest) {
		return this.notificationsService.verifyPushToken(req.user.uid, registerTokenDto, req.user.role);
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
		summary: '📋 Get all notifications',
		description: createApiDescription(
			'Retrieves all notifications in the system for management and administration purposes.',
			'The service method `NotificationsService.findAll()` queries all notifications from the database and returns the complete list.',
			'NotificationsService',
			'findAll',
			'retrieves all notifications from the database',
			'an array of notification objects',
			['Database query', 'Notification retrieval']
		),
	})
	findAll() {
		return this.notificationsService.findAll();
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
		summary: '🔍 Get a notification by reference code',
		description: createApiDescription(
			'Retrieves detailed information about a specific notification by its reference ID.',
			'The service method `NotificationsService.findOne()` queries the database for the notification by reference, validates existence, and returns complete notification details.',
			'NotificationsService',
			'findOne',
			'retrieves a notification by reference ID',
			'a notification object with complete details',
			['Notification lookup', 'Reference validation']
		),
	})
	findOne(@Param('ref') ref: number) {
		return this.notificationsService.findOne(ref);
	}

	@Get('/personal/:ref')
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
		summary: '👤 Get a notification by reference code for a user',
		description: createApiDescription(
			'Retrieves a specific notification for a user, ensuring proper access control and user context.',
			'The service method `NotificationsService.findForUser()` queries the notification by reference, validates user access, and returns user-specific notification details.',
			'NotificationsService',
			'findForUser',
			'retrieves a notification for a specific user with access validation',
			'a notification object for the user',
			['User context', 'Access validation', 'Notification retrieval']
		),
	})
	findForUser(@Param('ref') ref: number) {
		return this.notificationsService.findForUser(ref);
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
		summary: '✏️ Update a notification by reference code',
		description: createApiDescription(
			'Updates an existing notification with new content, status, or other fields.',
			'The service method `NotificationsService.update()` validates the notification exists, applies updates, updates modification timestamp, handles organization/branch context, and returns the updated notification.',
			'NotificationsService',
			'update',
			'updates an existing notification with new information',
			'the updated notification object',
			['Notification validation', 'Data update', 'Organization context', 'Timestamp update']
		),
	})
	update(@Param('ref') ref: number, @Body() updateNotificationDto: UpdateNotificationDto, @Req() req: AuthenticatedRequest) {
		const clerkUserId = getClerkUserId(req);
		if (!clerkUserId) throw new BadRequestException('Authentication required');
		const orgId = req.user?.organisationRef as string | undefined;
		const branchId = req.user?.branch?.uid;
		return this.notificationsService.update(ref, updateNotificationDto, orgId, branchId, clerkUserId);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '🗑️ Soft delete a notification by reference code',
		description: createApiDescription(
			'Marks a notification as deleted without removing it from the database, preserving data for audit purposes.',
			'The service method `NotificationsService.remove()` validates the notification exists, marks it as deleted (soft delete), preserves data, and returns deletion confirmation.',
			'NotificationsService',
			'remove',
			'soft deletes a notification by marking it as deleted',
			'a confirmation object indicating successful deletion',
			['Soft delete', 'Data preservation', 'Audit trail']
		),
	})
	remove(@Param('ref') ref: number) {
		return this.notificationsService.remove(ref);
	}
}
