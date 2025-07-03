import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { ApiOperation, ApiTags, ApiBody, ApiOkResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { Request } from 'express';
import { User } from '../user/entities/user.entity';

interface AuthenticatedRequest extends Request {
	user: User;
}

@ApiTags('🔔 Notifications')
@Controller('notifications')
@UseGuards(AuthGuard, RoleGuard)
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
	@ApiOperation({ summary: 'create a new notification' })
	create(@Body() createNotificationDto: CreateNotificationDto) {
		return this.notificationsService.create(createNotificationDto);
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
		return this.notificationsService.registerPushToken(req.user.uid, registerTokenDto);
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
		return this.notificationsService.verifyPushToken(req.user.uid, registerTokenDto);
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
	@ApiOperation({ summary: 'get all notifications' })
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
	@ApiOperation({ summary: 'get a notification by reference code' })
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
	@ApiOperation({ summary: 'get a notification by reference code for a user' })
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
	@ApiOperation({ summary: 'update a notification by reference code' })
	update(@Param('ref') ref: number, @Body() updateNotificationDto: UpdateNotificationDto) {
		return this.notificationsService.update(ref, updateNotificationDto);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({ summary: 'soft delete a notification by reference code' })
	remove(@Param('ref') ref: number) {
		return this.notificationsService.remove(ref);
	}
}
