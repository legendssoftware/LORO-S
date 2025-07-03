import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Request } from '@nestjs/common';
import { WarningsService } from './warnings.service';
import { CreateWarningDto } from './dto/create-warning.dto';
import { UpdateWarningDto } from './dto/update-warning.dto';
import {
	ApiTags,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Warning, WarningStatus, WarningSeverity } from './entities/warning.entity';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('⚠️ Warnings')
@Controller('warnings')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('warnings')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class WarningsController {
	constructor(private readonly warningsService: WarningsService) {}

	@Post()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Create a new warning' })
	@ApiCreatedResponse({
		description: 'The warning has been successfully created',
		type: Warning,
	})
	@ApiBadRequestResponse({ description: 'Bad request' })
	create(@Body() createWarningDto: CreateWarningDto, @Request() req: any) {
		const userId = req.user?.uid;
		// Set the issuer to the current user if not provided
		if (!createWarningDto.issuedBy) {
			createWarningDto.issuedBy = { uid: userId };
		}
		return this.warningsService.create(createWarningDto);
	}

	@Get()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Get all warnings' })
	@ApiQuery({ name: 'status', enum: WarningStatus, required: false, description: 'Filter by warning status' })
	@ApiQuery({ name: 'severity', enum: WarningSeverity, required: false, description: 'Filter by warning severity' })
	@ApiQuery({ name: 'ownerId', type: Number, required: false, description: 'Filter by owner ID' })
	@ApiQuery({ name: 'issuerId', type: Number, required: false, description: 'Filter by issuer ID' })
	@ApiQuery({ name: 'isExpired', type: Boolean, required: false, description: 'Filter by expiration status' })
	@ApiQuery({ name: 'startDate', type: String, required: false, description: 'Filter by start date (ISO format)' })
	@ApiQuery({ name: 'endDate', type: String, required: false, description: 'Filter by end date (ISO format)' })
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to system setting',
	})
	@ApiOkResponse({
		description: 'List of warnings retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: { $ref: '#/components/schemas/Warning' },
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
				message: { type: 'string', example: 'Warnings retrieved successfully' },
			},
		},
	})
	findAll(
		@Query('status') status?: WarningStatus,
		@Query('severity') severity?: WarningSeverity,
		@Query('ownerId') ownerId?: number,
		@Query('issuerId') issuerId?: number,
		@Query('isExpired') isExpired?: string,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('page') page?: string,
		@Query('limit') limit?: string,
	) {
		const filters: any = {};
		if (status) filters.status = status;
		if (severity) filters.severity = severity;
		if (ownerId) filters.ownerId = +ownerId;
		if (issuerId) filters.issuerId = +issuerId;
		if (isExpired !== undefined) filters.isExpired = isExpired === 'true';
		if (startDate) filters.startDate = new Date(startDate);
		if (endDate) filters.endDate = new Date(endDate);

		return this.warningsService.findAll(
			filters,
			page ? parseInt(page, 10) : 1,
			limit ? parseInt(limit, 10) : Number(process.env.DEFAULT_PAGE_LIMIT || 10),
		);
	}

	@Get(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Get a warning by ID' })
	@ApiParam({
		name: 'ref',
		description: 'Warning reference',
		example: '1',
	})
	@ApiOkResponse({
		description: 'Returns the warning with the specified ID',
		type: Warning,
	})
	@ApiNotFoundResponse({ description: 'Warning not found' })
	findOne(@Param('ref') ref: string) {
		return this.warningsService.findOne(+ref);
	}

	@Get('user/:ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Get warnings for a specific user' })
	@ApiParam({
		name: 'ref',
		description: 'User reference',
		example: '1',
	})
	@ApiOkResponse({
		description: 'Returns all warnings for the specified user',
		schema: {
			type: 'object',
			properties: {
				warnings: {
					type: 'array',
					items: { $ref: '#/components/schemas/Warning' },
				},
				message: { type: 'string', example: 'Warnings found' },
			},
		},
	})
	getUserWarnings(@Param('ref') ref: string) {
		return this.warningsService.getUserWarnings(+ref);
	}

	@Patch(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Update a warning' })
	@ApiParam({
		name: 'ref',
		description: 'Warning reference',
		example: '1',
	})
	@ApiOkResponse({
		description: 'The warning has been successfully updated',
		type: Warning,
	})
	@ApiBadRequestResponse({ description: 'Bad request' })
	@ApiNotFoundResponse({ description: 'Warning not found' })
	update(@Param('ref') ref: string, @Body() updateWarningDto: UpdateWarningDto) {
		return this.warningsService.update(+ref, updateWarningDto);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({ summary: 'Delete a warning' })
	@ApiParam({
		name: 'ref',
		description: 'Warning reference',
		example: '1',
	})
	@ApiOkResponse({
		description: 'The warning has been successfully deleted',
	})
	@ApiNotFoundResponse({ description: 'Warning not found' })
	remove(@Param('ref') ref: string) {
		return this.warningsService.remove(+ref);
	}
}
