import { Controller, Post, Body, Patch, Param, UseGuards, Get, Query, Req } from '@nestjs/common';
import { CheckInsService } from './check-ins.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { CreateCheckOutDto } from './dto/create-check-out.dto';
import { UpdateCheckInPhotoDto } from './dto/update-check-in-photo.dto';
import { UpdateCheckOutPhotoDto } from './dto/update-check-out-photo.dto';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
	user: any;
}

import {
	ApiOperation,
	ApiTags,
	ApiBody,
	ApiParam,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';

@ApiTags('📍 Check Ins & Check Outs')
@Controller('check-ins')	
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class CheckInsController {
	constructor(private readonly checkInsService: CheckInsService) {}

	@Get()
	@ApiOperation({
		summary: 'Get all check-ins',
		description: 'Retrieves all check-in records, optionally filtered by organization',
	})
	@ApiOkResponse({
		description: 'Check-ins retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkIns: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							checkInTime: { type: 'string', format: 'date-time' },
							checkOutTime: { type: 'string', format: 'date-time', nullable: true },
							duration: { type: 'string', nullable: true },
							checkInLocation: { type: 'string' },
							checkOutLocation: { type: 'string', nullable: true },
							owner: { type: 'object' },
							client: { type: 'object', nullable: true },
							branch: { type: 'object' },
						},
					},
				},
			},
		},
	})
	getAllCheckIns(@Query('organizationUid') organizationUid?: string) {
		return this.checkInsService.getAllCheckIns(organizationUid);
	}

	@Get('user/:userUid')
	@ApiOperation({
		summary: 'Get check-ins for specific user',
		description: 'Retrieves check-in records for a specific user, optionally filtered by organization',
	})
	@ApiParam({ name: 'userUid', description: 'User UID', type: 'number' })
	@ApiOkResponse({
		description: 'User check-ins retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkIns: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							checkInTime: { type: 'string', format: 'date-time' },
							checkOutTime: { type: 'string', format: 'date-time', nullable: true },
							duration: { type: 'string', nullable: true },
							checkInLocation: { type: 'string' },
							checkOutLocation: { type: 'string', nullable: true },
							owner: { type: 'object' },
							client: { type: 'object', nullable: true },
							branch: { type: 'object' },
						},
					},
				},
				user: { type: 'object' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'User not found or no check-ins found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found' },
			},
		},
	})
	getUserCheckIns(
		@Param('userUid') userUid: number,
		@Query('organizationUid') organizationUid?: string
	) {
		return this.checkInsService.getUserCheckIns(userUid, organizationUid);
	}

	@Post()
	@ApiOperation({
		summary: 'Record check-in',
		description: 'Creates a new attendance check-in record for a user. Can be associated with a client to update their GPS coordinates.',
	})
	@ApiBody({ type: CreateCheckInDto })
	@ApiCreatedResponse({
		description: 'Check-in recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkIn: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						checkInTime: { type: 'string', format: 'date-time' },
						user: { type: 'object' },
						client: { 
							type: 'object',
							nullable: true, 
							description: 'Associated client, if any'
						},
						// Other check-in properties
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error recording check-in' },
			},
		},
	})
	checkIn(@Body() createCheckInDto: CreateCheckInDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.checkInsService.checkIn(createCheckInDto, orgId, branchId);
	}

	@Get('status/:reference')
	@ApiOperation({
		summary: 'Get check-in status',
		description: 'Retrieves the current check-in status for a specific user',
	})
	@ApiParam({ name: 'reference', description: 'User reference code', type: 'number' })
	@ApiOkResponse({
		description: 'Check-in status retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				status: { type: 'string', example: 'CHECKED_IN' },
				lastCheckIn: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						checkInTime: { type: 'string', format: 'date-time' },
						checkOutTime: { type: 'string', format: 'date-time', nullable: true },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'User not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found' },
				status: { type: 'null' },
			},
		},
	})
	checkInStatus(@Param('reference') reference: number) {
		return this.checkInsService.checkInStatus(reference);
	}

	@Patch(':reference')
	@ApiOperation({
		summary: 'Record check-out',
		description: 'Updates an existing check-in record with check-out information',
	})
	@ApiParam({ name: 'reference', description: 'Check-in reference code', type: 'number' })
	@ApiBody({ type: CreateCheckOutDto })
	@ApiOkResponse({
		description: 'Check-out recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkOut: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						checkInTime: { type: 'string', format: 'date-time' },
						checkOutTime: { type: 'string', format: 'date-time' },
						// Other check-out properties
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error recording check-out' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Check-in not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Check-in not found' },
			},
		},
	})
	checkOut(@Body() createCheckOutDto: CreateCheckOutDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.checkInsService.checkOut(createCheckOutDto, orgId, branchId);
	}

	@Post('client/:clientId')
	@ApiOperation({
		summary: 'Check-in at client location',
		description: 'Creates a check-in record associated with a specific client and updates client GPS coordinates',
	})
	@ApiParam({ name: 'clientId', description: 'Client ID', type: 'number' })
	@ApiBody({ type: CreateCheckInDto })
	@ApiCreatedResponse({
		description: 'Client check-in recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
	})
	@ApiNotFoundResponse({
		description: 'Client not found',
	})
	checkInAtClient(
		@Param('clientId') clientId: number,
		@Body() createCheckInDto: CreateCheckInDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		// Add client to the DTO
		const checkInWithClient = {
			...createCheckInDto,
			client: { uid: clientId }
		};
		return this.checkInsService.checkIn(checkInWithClient, orgId, branchId);
	}

	@Patch('photo/check-in')
	@ApiOperation({
		summary: 'Update check-in photo URL',
		description: 'Fast endpoint to update check-in photo URL after background upload completes',
	})
	@ApiBody({ type: UpdateCheckInPhotoDto })
	@ApiOkResponse({
		description: 'Check-in photo updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
	})
	@ApiNotFoundResponse({
		description: 'Check-in not found',
	})
	updateCheckInPhoto(@Body() updateDto: UpdateCheckInPhotoDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.checkInsService.updateCheckInPhoto(updateDto.checkInId, updateDto.photoUrl, orgId, branchId);
	}

	@Patch('photo/check-out')
	@ApiOperation({
		summary: 'Update check-out photo URL',
		description: 'Fast endpoint to update check-out photo URL after background upload completes',
	})
	@ApiBody({ type: UpdateCheckOutPhotoDto })
	@ApiOkResponse({
		description: 'Check-out photo updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
	})
	@ApiNotFoundResponse({
		description: 'Check-in not found',
	})
	updateCheckOutPhoto(@Body() updateDto: UpdateCheckOutPhotoDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.checkInsService.updateCheckOutPhoto(updateDto.checkInId, updateDto.photoUrl, orgId, branchId);
	}
}
