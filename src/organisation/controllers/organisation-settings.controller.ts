import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { OrganisationSettingsService } from '../services/organisation-settings.service';
import { CreateOrganisationSettingsDto } from '../dto/create-organisation-settings.dto';
import { UpdateOrganisationSettingsDto } from '../dto/update-organisation-settings.dto';
import { OrganisationSettings } from '../entities/organisation-settings.entity';
import { AuthGuard } from '../../guards/auth.guard';
import { RoleGuard } from '../../guards/role.guard';
import { Roles } from '../../decorators/role.decorator';
import { AccessLevel } from '../../lib/enums/user.enums';
import { AuthenticatedRequest } from '../../lib/interfaces/authenticated-request.interface';

@ApiTags('org settings')
@Controller('organisations')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class OrganisationSettingsController {
    constructor(private readonly settingsService: OrganisationSettingsService) {}

    @Post(':orgRef/settings')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Create organization settings',
        description: 'Creates settings for a specific organization. Requires ADMIN or MANAGER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiBody({ type: CreateOrganisationSettingsDto })
    @ApiCreatedResponse({ 
        description: 'Settings created successfully',
        schema: {
            type: 'object',
            properties: {
                settings: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 1 },
                        language: { type: 'string', example: 'en' },
                        timezone: { type: 'string', example: 'Africa/Johannesburg' },
                        dateFormat: { type: 'string', example: 'DD/MM/YYYY' },
                        timeFormat: { type: 'string', example: 'HH:mm' },
                        currency: { type: 'string', example: 'ZAR' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' }
                    }
                },
                message: { type: 'string', example: 'Settings created successfully' }
            }
        }
    })
    @ApiBadRequestResponse({ description: 'Settings already exist or invalid input data provided' })
    @ApiNotFoundResponse({ description: 'Organization not found' })
    async create(
        @Param('orgRef') orgRef: string,
        @Body() createSettingsDto: CreateOrganisationSettingsDto,
        @Req() req: AuthenticatedRequest,
    ): Promise<{ settings: OrganisationSettings | null; message: string }> {
        return this.settingsService.create(orgRef, createSettingsDto);
    }

    @Get(':orgRef/settings')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
    @ApiOperation({ 
        summary: 'Get organization settings',
        description: 'Retrieves settings for a specific organization. Requires ADMIN, MANAGER, SUPPORT, or DEVELOPER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiOkResponse({ 
        description: 'Settings retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                settings: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 1 },
                        language: { type: 'string', example: 'en' },
                        timezone: { type: 'string', example: 'Africa/Johannesburg' },
                        dateFormat: { type: 'string', example: 'DD/MM/YYYY' },
                        timeFormat: { type: 'string', example: 'HH:mm' },
                        currency: { type: 'string', example: 'ZAR' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                        organisation: {
                            type: 'object',
                            properties: {
                                uid: { type: 'number', example: 1 },
                                name: { type: 'string', example: 'Acme Inc.' }
                            }
                        }
                    }
                },
                message: { type: 'string', example: 'Settings retrieved successfully' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Settings not found' })
    async findOne(
        @Param('orgRef') orgRef: string,
    ): Promise<{ settings: OrganisationSettings | null; message: string }> {
        return this.settingsService.findOne(orgRef);
    }

    @Patch(':orgRef/settings')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Update organization settings',
        description: 'Updates settings for a specific organization. Requires ADMIN or MANAGER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiBody({ type: UpdateOrganisationSettingsDto })
    @ApiOkResponse({ 
        description: 'Settings updated successfully',
        schema: {
            type: 'object',
            properties: {
                settings: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 1 },
                        language: { type: 'string', example: 'en' },
                        timezone: { type: 'string', example: 'Africa/Johannesburg' },
                        dateFormat: { type: 'string', example: 'DD/MM/YYYY' },
                        timeFormat: { type: 'string', example: 'HH:mm' },
                        currency: { type: 'string', example: 'ZAR' },
                        updatedAt: { type: 'string', format: 'date-time' }
                    }
                },
                message: { type: 'string', example: 'Settings updated successfully' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Settings not found' })
    @ApiBadRequestResponse({ description: 'Invalid input data provided' })
    async update(
        @Param('orgRef') orgRef: string,
        @Body() updateSettingsDto: UpdateOrganisationSettingsDto,
    ): Promise<{ settings: OrganisationSettings | null; message: string }> {
        return this.settingsService.update(orgRef, updateSettingsDto);
    }

    @Delete(':orgRef/settings')
    @Roles(AccessLevel.ADMIN)
    @ApiOperation({ 
        summary: 'Delete organization settings',
        description: 'Deletes settings for a specific organization. Requires ADMIN role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiOkResponse({ 
        description: 'Settings deleted successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string', example: 'Settings deleted successfully' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Settings not found' })
    async remove(
        @Param('orgRef') orgRef: string,
    ): Promise<{ success: boolean; message: string }> {
        return this.settingsService.remove(orgRef);
    }
} 