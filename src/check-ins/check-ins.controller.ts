import { Controller, Post, Body, Patch, Param, UseGuards, Get, Query, Req, ParseIntPipe, BadRequestException, Logger } from '@nestjs/common';
import { CheckInsService } from './check-ins.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { CreateCheckOutDto } from './dto/create-check-out.dto';
import { UpdateCheckInPhotoDto } from './dto/update-check-in-photo.dto';
import { UpdateCheckOutPhotoDto } from './dto/update-check-out-photo.dto';
import { UpdateVisitDetailsDto } from './dto/update-visit-details.dto';
import { Request } from 'express';

import { AuthenticatedRequest, getClerkOrgId, getClerkUserId } from '../lib/interfaces/authenticated-request.interface';

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
	ApiQuery,
} from '@nestjs/swagger';
import { getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';

@ApiTags('📍 Check Ins & Check Outs')
@Controller('check-ins')	
@UseGuards(ClerkAuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class CheckInsController {
	private readonly logger = new Logger(CheckInsController.name);

	constructor(private readonly checkInsService: CheckInsService) {}

	@Get()
	@ApiOperation({
		summary: 'Get all check-ins',
		description: createApiDescription(
			'Retrieves all check-in records with role-based access control. Managers and admins see all check-ins in their organization, while regular users see only their own check-ins.',
			'The service method `CheckInsService.getAllCheckIns()` retrieves check-ins based on user role, applies filters (user, date range), and returns a list of check-in records with client and location information.',
			'CheckInsService',
			'getAllCheckIns',
			'retrieves check-ins with role-based filtering and organization scope',
			'an array of check-in records with client and location details',
			['Role-based access control', 'Organization filtering', 'Date range filtering', 'User filtering'],
		),
	})
	@ApiQuery({ name: 'userUid', type: String, required: false, description: 'Filter by user UID (Clerk user ID or numeric UID). Only available for managers/admins.' })
	@ApiQuery({ name: 'startDate', type: String, required: false, description: 'Filter by start date (ISO format)' })
	@ApiQuery({ name: 'endDate', type: String, required: false, description: 'Filter by end date (ISO format)' })
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
							fullAddress: { type: 'object', nullable: true, description: 'Reverse-geocoded address for check-in location (formattedAddress, street, suburb, city, state, country, etc.)' },
							checkOutFullAddress: { type: 'object', nullable: true, description: 'Reverse-geocoded address for check-out location (formattedAddress, street, suburb, city, state, country, etc.)' },
							ownerClerkUserId: { type: 'string', description: 'Clerk user ID (string identifier) - key relationship field' },
							organisationUid: { type: 'string', description: 'Organization UID (Clerk org ID string) - key relationship field' },
							owner: { type: 'object' },
							client: { type: 'object', nullable: true },
							branch: { type: 'object', nullable: true },
							contactFullName: { type: 'string', nullable: true, description: 'Full name of the person contacted during the visit' },
							contactImage: { type: 'string', nullable: true, description: 'Image URL of the person contacted' },
							contactCellPhone: { type: 'string', nullable: true, description: 'Cell phone number of the person contacted' },
							contactLandline: { type: 'string', nullable: true, description: 'Landline phone number of the person contacted' },
							contactEmail: { type: 'string', nullable: true, description: 'Email address of the person contacted' },
							contactAddress: { type: 'object', nullable: true, description: 'Address of the person contacted' },
							companyName: { type: 'string', nullable: true, description: 'Company name associated with the visit' },
							businessType: { type: 'string', nullable: true, description: 'Type of business visited' },
							personSeenPosition: { type: 'string', nullable: true, description: 'Position/title of the person seen during the visit' },
							meetingLink: { type: 'string', nullable: true, description: 'Meeting link if applicable' },
							salesValue: { type: 'number', nullable: true, description: 'Sales value generated during the visit' },
							quotationNumber: { type: 'string', nullable: true, description: 'Quotation number if quotation was created' },
							quotationUid: { type: 'number', nullable: true, description: 'Quotation UID if quotation was created' },
							quotationStatus: { type: 'string', nullable: true, description: 'Status of the linked quotation' },
							notes: { type: 'string', nullable: true, description: 'Visit notes' },
							resolution: { type: 'string', nullable: true, description: 'Visit resolution' },
							leadUid: { type: 'number', nullable: true, description: 'Lead UID if lead was created from this check-in' },
							methodOfContact: { type: 'string', nullable: true, description: 'Method of contact used during the visit' },
							buildingType: { type: 'string', nullable: true, description: 'Type of building visited' },
							contactMade: { type: 'boolean', nullable: true, description: 'Whether contact was made during the visit' },
						},
					},
				},
			},
		},
	})
	async getAllCheckIns(
		@Req() req: AuthenticatedRequest,
		@Query('userUid') userUid?: string,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const clerkUserId = req.user?.clerkUserId;
		const userAccessLevel = req.user?.accessLevel;
		this.logger.log(`getAllCheckIns entry: orgId=${orgId}, clerkUserId=${clerkUserId ?? 'n/a'}, userAccessLevel=${userAccessLevel ?? 'n/a'}, userUid=${userUid ?? 'n/a'}, startDate=${startDate ?? 'n/a'}, endDate=${endDate ?? 'n/a'}`);
		const result = await this.checkInsService.getAllCheckIns(
			orgId,
			clerkUserId,
			userAccessLevel,
			userUid,
			startDate ? new Date(startDate) : undefined,
			endDate ? new Date(endDate) : undefined,
		);
		const count = Array.isArray(result?.checkIns) ? result.checkIns.length : 0;
		this.logger.log(`Returning getAllCheckIns response, checkIns count: ${count}`);
		return result;
	}

	@Get('user/:userUid')
	@ApiOperation({
		summary: 'Get check-ins for specific user',
		description: 'Retrieves check-in records for a specific user, optionally filtered by organization',
	})
	@ApiParam({ name: 'userUid', description: 'User UID (string)', type: 'string' })
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
							fullAddress: { type: 'object', nullable: true, description: 'Reverse-geocoded address for check-in location' },
							checkOutFullAddress: { type: 'object', nullable: true, description: 'Reverse-geocoded address for check-out location' },
							ownerClerkUserId: { type: 'string', description: 'Clerk user ID (string identifier) - key relationship field' },
							organisationUid: { type: 'number', description: 'Organization UID (number) - key relationship field' },
							owner: { type: 'object' },
							client: { type: 'object', nullable: true },
							branch: { type: 'object', nullable: true },
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
	async getUserCheckIns(
		@Param('userUid') userUid: string,
		@Query('organizationUid') organizationUid?: string
	) {
		this.logger.log(`getUserCheckIns entry: userUid=${userUid}, organizationUid=${organizationUid ?? 'n/a'}`);
		const result = await this.checkInsService.getUserCheckIns(userUid, organizationUid);
		const count = Array.isArray(result?.checkIns) ? result.checkIns.length : 0;
		this.logger.log(`Returning getUserCheckIns, checkIns count: ${count}`);
		return result;
	}

	@Post()
	@ApiOperation({
		summary: 'Record check-in',
		description: 'Creates a new attendance check-in record for a user. Can be associated with a client to update their GPS coordinates. If a client is not provided or does not exist, and contact information (contactFullName, contactCellPhone, contactLandline) is provided, a lead will be automatically created from the contact information. The check-in can also include sales value, quotation references, and detailed contact information.',
	})
	@ApiBody({ type: CreateCheckInDto })
	@ApiCreatedResponse({
		description: 'Check-in recorded successfully. If contact information was provided without an existing client, a lead may have been automatically created.',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				checkInId: { type: 'number', description: 'ID of the created check-in' },
				leadUid: { type: 'number', nullable: true, description: 'ID of the lead created if client was not found' },
				checkIn: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						checkInTime: { type: 'string', format: 'date-time' },
						ownerClerkUserId: { type: 'string', description: 'Clerk user ID (string identifier) - key relationship field' },
						organisationUid: { type: 'string', description: 'Organization UID (Clerk org ID string) - key relationship field' },
						user: { type: 'object' },
						client: { 
							type: 'object',
							nullable: true, 
							description: 'Associated client, if any'
						},
						branch: {
							type: 'object',
							nullable: true,
							description: 'Associated branch, if any'
						},
						contactFullName: { type: 'string', nullable: true, description: 'Full name of the person contacted' },
						contactImage: { type: 'string', nullable: true, description: 'Image URL of the person contacted' },
						contactCellPhone: { type: 'string', nullable: true, description: 'Cell phone number of the person contacted' },
						contactLandline: { type: 'string', nullable: true, description: 'Landline phone number of the person contacted' },
						contactAddress: { type: 'object', nullable: true, description: 'Address of the person contacted' },
						salesValue: { type: 'number', nullable: true, description: 'Amount of sales made during the visit' },
						quotationNumber: { type: 'string', nullable: true, description: 'Quotation number if quotation was created' },
						quotationUid: { type: 'number', nullable: true, description: 'Quotation UID if quotation was created' },
						leadUid: { type: 'number', nullable: true, description: 'Lead UID if lead was created from this check-in' },
						methodOfContact: { type: 'string', nullable: true, description: 'Method of contact used during the visit' },
						buildingType: { type: 'string', nullable: true, description: 'Type of building visited' },
						contactMade: { type: 'boolean', nullable: true, description: 'Whether contact was made during the visit' },
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
	async checkIn(@Body() createCheckInDto: CreateCheckInDto, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const clerkUserId = req.user?.clerkUserId;
		this.logger.log(`checkIn entry: orgId=${orgId}, clerkUserId=${clerkUserId ?? 'n/a'}`);
		const result = await this.checkInsService.checkIn(createCheckInDto, orgId, clerkUserId);
		this.logger.log(`Returning checkIn response${result?.checkInId != null ? `, checkInId: ${result.checkInId}` : ''}`);
		return result;
	}

	@Get('status/me')
	@ApiOperation({
		summary: "Get current user's check-in status",
		description: "Retrieves the current check-in status for the authenticated user. User identity is derived from the token; no user reference is required.",
	})
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
	async checkInStatusMe(@Req() req: AuthenticatedRequest) {
		const clerkUserId = getClerkUserId(req);
		if (!clerkUserId) {
			throw new BadRequestException('Authentication required');
		}
		this.logger.log('checkInStatusMe entry: reference=me');
		const result = await this.checkInsService.checkInStatus(clerkUserId);
		this.logger.log(`Returning checkInStatusMe, nextAction=${result?.nextAction ?? 'n/a'}`);
		return result;
	}

	@Get('status/:reference')
	@ApiOperation({
		summary: 'Get check-in status by reference',
		description: 'Retrieves the current check-in status for a specific user by reference (Clerk user ID or numeric UID). Prefer GET status/me for the authenticated user.',
	})
	@ApiParam({ name: 'reference', description: 'User reference code (string)', type: 'string' })
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
	async checkInStatus(@Param('reference') reference: string) {
		this.logger.log(`checkInStatus entry: reference=${reference}`);
		const result = await this.checkInsService.checkInStatus(reference);
		this.logger.log(`Returning checkInStatus, nextAction=${result?.nextAction ?? 'n/a'}`);
		return result;
	}

	@Patch(':reference')
	@ApiOperation({
		summary: 'Record check-out',
		description: 'Updates an existing check-in record with check-out information. Can update contact information, sales value, and link quotations. If a quotation UID or quotation number is provided, the quotation will be validated and linked to the check-in with its current status.',
	})
	@ApiParam({ name: 'reference', description: 'Check-in reference code', type: 'number' })
	@ApiBody({ type: CreateCheckOutDto })
	@ApiOkResponse({
		description: 'Check-out recorded successfully. Contact information, sales value, and quotation may have been updated.',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				duration: { type: 'string', description: 'Duration of the check-in session' },
				checkInId: { type: 'number', description: 'ID of the check-in record' },
				checkOut: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						checkInTime: { type: 'string', format: 'date-time' },
						checkOutTime: { type: 'string', format: 'date-time' },
						ownerClerkUserId: { type: 'string', description: 'Clerk user ID (string identifier) - key relationship field' },
						organisationUid: { type: 'string', description: 'Organization UID (Clerk org ID string) - key relationship field' },
						contactFullName: { type: 'string', nullable: true, description: 'Full name of the person contacted' },
						contactCellPhone: { type: 'string', nullable: true, description: 'Cell phone number of the person contacted' },
						contactLandline: { type: 'string', nullable: true, description: 'Landline phone number of the person contacted' },
						salesValue: { type: 'number', nullable: true, description: 'Amount of sales made during the visit' },
						quotationNumber: { type: 'string', nullable: true, description: 'Quotation number if quotation was linked' },
						quotationStatus: { type: 'string', nullable: true, description: 'Status of the linked quotation' },
						quotationUid: { type: 'number', nullable: true, description: 'Quotation UID if quotation was linked' },
						methodOfContact: { type: 'string', nullable: true, description: 'Method of contact used during the visit' },
						buildingType: { type: 'string', nullable: true, description: 'Type of building visited' },
						contactMade: { type: 'boolean', nullable: true, description: 'Whether contact was made during the visit' },
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
	async checkOut(@Body() createCheckOutDto: CreateCheckOutDto, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const clerkUserId = req.user?.clerkUserId;
		this.logger.log(`checkOut entry: orgId=${orgId}, clerkUserId=${clerkUserId ?? 'n/a'}`);
		const result = await this.checkInsService.checkOut(createCheckOutDto, orgId, clerkUserId);
		this.logger.log(`Returning checkOut response${result?.checkInId != null ? `, checkInId: ${result.checkInId}` : ''}${result?.duration != null ? `, duration: ${result.duration}` : ''}`);
		return result;
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
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const clerkUserId = req.user?.clerkUserId;
		// Add client to the DTO
		const checkInWithClient = {
			...createCheckInDto,
			client: { uid: clientId }
		};
		return this.checkInsService.checkIn(checkInWithClient, orgId, clerkUserId);
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
	async updateCheckInPhoto(@Body() updateDto: UpdateCheckInPhotoDto, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const clerkUserId = req.user?.clerkUserId;
		this.logger.log(`updateCheckInPhoto entry: checkInId=${updateDto.checkInId}, orgId=${orgId}`);
		const result = await this.checkInsService.updateCheckInPhoto(updateDto.checkInId, updateDto.photoUrl, orgId, clerkUserId);
		this.logger.log(`Returning updateCheckInPhoto: ${result?.message?.includes('success') ? 'success' : 'failure'}`);
		return result;
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
	async updateCheckOutPhoto(@Body() updateDto: UpdateCheckOutPhotoDto, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const clerkUserId = req.user?.clerkUserId;
		this.logger.log(`updateCheckOutPhoto entry: checkInId=${updateDto.checkInId}, orgId=${orgId}`);
		const result = await this.checkInsService.updateCheckOutPhoto(updateDto.checkInId, updateDto.photoUrl, orgId, clerkUserId);
		this.logger.log(`Returning updateCheckOutPhoto: ${result?.message?.includes('success') ? 'success' : 'failure'}`);
		return result;
	}

	@Patch('visit-details')
	@ApiOperation({
		summary: 'Update visit details',
		description: 'Updates visit details (client, notes, resolution, followUp, contact information, sales data) after check-out',
	})
	@ApiBody({ type: UpdateVisitDetailsDto })
	@ApiOkResponse({
		description: 'Visit details updated successfully',
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
	async updateVisitDetails(@Body() updateDto: UpdateVisitDetailsDto, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const clerkUserId = req.user?.clerkUserId;
		this.logger.log(`updateVisitDetails entry: checkInId=${updateDto.checkInId}, orgId=${orgId}`);
		const result = await this.checkInsService.updateVisitDetails(
			updateDto.checkInId,
			updateDto.client?.uid,
			updateDto.notes,
			updateDto.resolution,
			orgId,
			clerkUserId,
			updateDto,
		);
		this.logger.log(`Returning updateVisitDetails: ${result?.message?.includes('success') ? 'success' : 'failure'}`);
		return result;
	}

	@Post(':checkInId/convert-to-lead')
	@ApiOperation({
		summary: 'Convert check-in to lead',
		description: 'Converts an existing check-in record to a lead by extracting available information (contact details, location, notes, etc.) and creating a new lead record. Scoped by org and user only. The check-in will be updated with the leadUid reference. If no contact information is available, a meaningful name will be generated from location, address, or date.',
	})
	@ApiParam({ name: 'checkInId', description: 'Check-in ID', type: 'number' })
	@ApiOkResponse({
		description: 'Check-in converted to lead successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				lead: {
					type: 'object',
					properties: {
						uid: { type: 'number', description: 'UID of the created lead' },
						name: { type: 'string', description: 'Name of the created lead' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data or check-in already has a lead',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'string', 
					example: 'Branch ID is required for lead creation' 
				},
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
	async convertCheckInToLead(
		@Param('checkInId', ParseIntPipe) checkInId: number,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const clerkUserId = req.user?.clerkUserId;
		this.logger.log(`convertCheckInToLead entry: checkInId=${checkInId}, orgId=${orgId}`);
		const result = await this.checkInsService.convertCheckInToLead(checkInId, orgId, clerkUserId);
		this.logger.log(`Returning convertCheckInToLead: ${result?.lead ? `success, leadUid=${result.lead.uid}` : 'failure'}`);
		return result;
	}
}
