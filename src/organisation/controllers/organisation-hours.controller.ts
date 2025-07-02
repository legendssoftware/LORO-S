import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { OrganisationHoursService } from '../services/organisation-hours.service';
import { CreateOrganisationHoursDto } from '../dto/create-organisation-hours.dto';
import { UpdateOrganisationHoursDto } from '../dto/update-organisation-hours.dto';
import { OrganisationHours } from '../entities/organisation-hours.entity';
import { AuthGuard } from '../../guards/auth.guard';
import { RoleGuard } from '../../guards/role.guard';
import { Roles } from '../../decorators/role.decorator';
import { AccessLevel } from '../../lib/enums/user.enums';

@ApiTags('org hours')
@Controller('organisations')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class OrganisationHoursController {
    constructor(private readonly hoursService: OrganisationHoursService) {}

    @Post(':orgRef/hours')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Create organization hours',
        description: 'Creates operating hours for a specific organization. Requires ADMIN or MANAGER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiBody({ type: CreateOrganisationHoursDto })
    @ApiCreatedResponse({ 
        description: 'Hours created successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                day: { type: 'string', example: 'MONDAY' },
                openTime: { type: 'string', example: '09:00' },
                closeTime: { type: 'string', example: '17:00' },
                isClosed: { type: 'boolean', example: false },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
                hoursRef: { type: 'string', example: 'HRS123456' }
            }
        }
    })
    @ApiBadRequestResponse({ description: 'Invalid input data provided' })
    @ApiNotFoundResponse({ description: 'Organization not found' })
    create(
        @Param('orgRef') orgRef: string,
        @Body() createHoursDto: CreateOrganisationHoursDto,
    ): Promise<OrganisationHours> {
        return this.hoursService.create(orgRef, createHoursDto);
    }

    @Get(':orgRef/hours')
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
        summary: 'Get organization default hours',
        description: 'Retrieves the default operating hours for a specific organization. If multiple hours exist, returns the first one. Accessible by all authenticated users.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiOkResponse({ 
        description: 'Hours retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                openTime: { type: 'string', example: '09:00' },
                closeTime: { type: 'string', example: '17:00' },
                timezone: { type: 'string', example: 'America/New_York' },
                holidayMode: { type: 'boolean', example: false },
                schedule: {
                    type: 'object',
                    properties: {
                        monday: {
                            type: 'object',
                            properties: {
                                start: { type: 'string', example: '09:00' },
                                end: { type: 'string', example: '17:00' },
                                closed: { type: 'boolean', example: false }
                            }
                        }
                    }
                },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
                ref: { type: 'string', example: 'HRS123456' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Organization or hours not found' })
    findDefault(@Param('orgRef') orgRef: string): Promise<OrganisationHours | null> {
        return this.hoursService.findDefault(orgRef);
    }

    @Get(':orgRef/hours/all')
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
        summary: 'Get all organization hours',
        description: 'Retrieves all operating hours for a specific organization. Accessible by all authenticated users.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiOkResponse({ 
        description: 'Hours retrieved successfully',
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    uid: { type: 'number', example: 1 },
                    day: { type: 'string', example: 'MONDAY' },
                    openTime: { type: 'string', example: '09:00' },
                    closeTime: { type: 'string', example: '17:00' },
                    isClosed: { type: 'boolean', example: false },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' },
                    hoursRef: { type: 'string', example: 'HRS123456' },
                    organisation: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 1 },
                            name: { type: 'string', example: 'Acme Inc.' }
                        }
                    }
                }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Organization not found' })
    findAll(@Param('orgRef') orgRef: string): Promise<OrganisationHours[]> {
        return this.hoursService.findAll(orgRef);
    }

    @Get(':orgRef/hours/:hoursRef')
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
        summary: 'Get specific organization hours',
        description: 'Retrieves specific operating hours for an organization by hours reference code. Accessible by all authenticated users.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiParam({
        name: 'hoursRef',
        description: 'Hours reference code',
        type: 'string',
        example: 'HRS123456'
    })
    @ApiOkResponse({ 
        description: 'Hours retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                day: { type: 'string', example: 'MONDAY' },
                openTime: { type: 'string', example: '09:00' },
                closeTime: { type: 'string', example: '17:00' },
                isClosed: { type: 'boolean', example: false },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
                hoursRef: { type: 'string', example: 'HRS123456' },
                organisation: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 1 },
                        name: { type: 'string', example: 'Acme Inc.' }
                    }
                }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Hours not found' })
    findOne(
        @Param('orgRef') orgRef: string,
        @Param('hoursRef') hoursRef: string,
    ): Promise<OrganisationHours> {
        return this.hoursService.findOne(orgRef, hoursRef);
    }

    @Patch(':orgRef/hours/:hoursRef')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Update organization hours',
        description: 'Updates specific operating hours for an organization. Requires ADMIN or MANAGER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiParam({
        name: 'hoursRef',
        description: 'Hours reference code',
        type: 'string',
        example: 'HRS123456'
    })
    @ApiBody({ type: UpdateOrganisationHoursDto })
    @ApiOkResponse({ 
        description: 'Hours updated successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                day: { type: 'string', example: 'MONDAY' },
                openTime: { type: 'string', example: '08:00' },
                closeTime: { type: 'string', example: '18:00' },
                isClosed: { type: 'boolean', example: false },
                updatedAt: { type: 'string', format: 'date-time' },
                hoursRef: { type: 'string', example: 'HRS123456' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Hours not found' })
    @ApiBadRequestResponse({ description: 'Invalid input data provided' })
    update(
        @Param('orgRef') orgRef: string,
        @Param('hoursRef') hoursRef: string,
        @Body() updateHoursDto: UpdateOrganisationHoursDto,
    ): Promise<OrganisationHours> {
        return this.hoursService.update(orgRef, hoursRef, updateHoursDto);
    }

    @Patch(':orgRef/hours')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Update organization default hours',
        description: 'Updates or creates the default operating hours for an organization. Requires ADMIN or MANAGER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiBody({ type: UpdateOrganisationHoursDto })
    @ApiOkResponse({ 
        description: 'Hours updated successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                openTime: { type: 'string', example: '08:00' },
                closeTime: { type: 'string', example: '18:00' },
                timezone: { type: 'string', example: 'America/New_York' },
                holidayMode: { type: 'boolean', example: false },
                updatedAt: { type: 'string', format: 'date-time' },
                ref: { type: 'string', example: 'HRS123456' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Organization not found' })
    @ApiBadRequestResponse({ description: 'Invalid input data provided' })
    updateDefault(
        @Param('orgRef') orgRef: string,
        @Body() updateHoursDto: UpdateOrganisationHoursDto,
    ): Promise<OrganisationHours> {
        return this.hoursService.updateDefault(orgRef, updateHoursDto);
    }

    @Delete(':orgRef/hours/:hoursRef')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Delete organization hours',
        description: 'Deletes specific operating hours for an organization. Requires ADMIN or MANAGER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiParam({
        name: 'hoursRef',
        description: 'Hours reference code',
        type: 'string',
        example: 'HRS123456'
    })
    @ApiOkResponse({ 
        description: 'Hours deleted successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string', example: 'Hours deleted successfully' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Hours not found' })
    remove(
        @Param('orgRef') orgRef: string,
        @Param('hoursRef') hoursRef: string,
    ): Promise<void> {
        return this.hoursService.remove(orgRef, hoursRef);
    }
} 