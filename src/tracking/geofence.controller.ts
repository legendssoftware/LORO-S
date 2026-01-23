import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	UseGuards,
	Req,
	HttpStatus,
	HttpCode,
} from '@nestjs/common';
import { GeofenceService } from './geofence.service';
import { CreateGeofenceDto } from './dto/create-geofence.dto';
import { UpdateGeofenceDto } from './dto/update-geofence.dto';
import { CreateGeofenceEventDto } from './dto/create-geofence-event.dto';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '../user/entities/user.entity';

// Extended request interface with user property
interface AuthenticatedRequest extends Request {
	user: User;
}

@ApiTags('🔲 Geofence Settings')
@Controller('geofence')
@UseGuards(ClerkAuthGuard, RoleGuard)
@ApiBearerAuth()
export class GeofenceController {
	constructor(private readonly geofenceService: GeofenceService) {}

	@Post()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create a new geofence area' })
	async create(@Body() createGeofenceDto: CreateGeofenceDto, @Req() req: AuthenticatedRequest) {
		const response = await this.geofenceService.createGeofence(createGeofenceDto, req.user);
		return {
			data: response.geofence,
			message: response.message,
			status: HttpStatus.CREATED,
		};
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
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Get all geofence areas for the current user's organisation" })
	async findAll(@Req() req: AuthenticatedRequest) {
		const response = await this.geofenceService.findAllByOrganisation(Number(req?.user?.organisationRef));
		return {
			data: response.geofences,
			message: response.message,
			status: HttpStatus.OK,
		};
	}

	@Get('areas')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Get all geofence areas for mobile app' })
	async getAreasForMobile(@Req() req: AuthenticatedRequest) {
		const response = await this.geofenceService.getGeofenceAreasForMobile(req.user);
		return {
			data: response.areas,
			message: response.message,
			status: HttpStatus.OK,
		};
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
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Get a geofence area by ref' })
	async findOne(@Param('ref') ref: string) {
		const response = await this.geofenceService.findOne(ref);
		return {
			data: response.geofence,
			message: response.message,
			status: HttpStatus.OK,
		};
	}

	@Patch(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Update a geofence area' })
	async update(
		@Param('ref') ref: string,
		@Body() updateGeofenceDto: UpdateGeofenceDto,
		@Req() req: AuthenticatedRequest,
	) {
		const response = await this.geofenceService.update(ref, updateGeofenceDto, req.user);
		return {
			data: response.geofence,
			message: response.message,
			status: HttpStatus.OK,
		};
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Soft delete a geofence area' })
	async remove(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
		const response = await this.geofenceService.remove(ref, req.user);
		return {
			success: response.success,
			message: response.message,
			status: HttpStatus.OK,
		};
	}

	@Post('event')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create a new geofence event' })
	async createEvent(@Body() createGeofenceEventDto: CreateGeofenceEventDto, @Req() req: AuthenticatedRequest) {
		const response = await this.geofenceService.createGeofenceEvent(createGeofenceEventDto, req.user);
		return {
			data: response.event,
			message: response.message,
			status: HttpStatus.CREATED,
		};
	}

	@Get('events/user/:userref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Get all geofence events for a user' })
	async findUserEvents(@Param('userref') userref: string) {
		const response = await this.geofenceService.findUserEvents(userref);
		return {
			data: response.events,
			message: response.message,
			status: HttpStatus.OK,
		};
	}

	@Get('events/geofence/:geofenceref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Get all geofence events for a geofence area' })
	async findGeofenceEvents(@Param('geofenceref') geofenceref: string) {
		const response = await this.geofenceService.findGeofenceEvents(geofenceref);
		return {
			data: response.events,
			message: response.message,
			status: HttpStatus.OK,
		};
	}
}
