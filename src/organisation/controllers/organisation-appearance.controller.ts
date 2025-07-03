import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { OrganisationAppearanceService } from '../services/organisation-appearance.service';
import { CreateOrganisationAppearanceDto } from '../dto/create-organisation-appearance.dto';
import { UpdateOrganisationAppearanceDto } from '../dto/update-organisation-appearance.dto';
import { OrganisationAppearance } from '../entities/organisation-appearance.entity';
import { AuthGuard } from '../../guards/auth.guard';
import { RoleGuard } from '../../guards/role.guard';
import { Roles } from '../../decorators/role.decorator';
import { AccessLevel } from '../../lib/enums/user.enums';

@ApiTags('🎨 Organisation Appearance')
@Controller('organisations')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class OrganisationAppearanceController {
    constructor(private readonly appearanceService: OrganisationAppearanceService) {}

    @Post(':orgRef/appearance')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Create organization appearance settings',
        description: 'Creates appearance settings for a specific organization. Requires ADMIN or MANAGER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiBody({ type: CreateOrganisationAppearanceDto })
    @ApiCreatedResponse({ 
        description: 'Appearance settings created successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                primaryColor: { type: 'string', example: '#3498db' },
                secondaryColor: { type: 'string', example: '#2ecc71' },
                accentColor: { type: 'string', example: '#e74c3c' },
                logo: { type: 'string', example: 'https://example.com/logo.png' },
                favicon: { type: 'string', example: 'https://example.com/favicon.ico' },
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' }
            }
        }
    })
    @ApiBadRequestResponse({ description: 'Invalid input data provided' })
    @ApiNotFoundResponse({ description: 'Organization not found' })
    create(
        @Param('orgRef') orgRef: string,
        @Body() createAppearanceDto: CreateOrganisationAppearanceDto,
    ): Promise<OrganisationAppearance> {
        return this.appearanceService.create(orgRef, createAppearanceDto);
    }

    @Get(':orgRef/appearance')
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
        summary: 'Get organization appearance settings',
        description: 'Retrieves appearance settings for a specific organization. Accessible by all authenticated users.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiOkResponse({ 
        description: 'Appearance settings retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                primaryColor: { type: 'string', example: '#3498db' },
                secondaryColor: { type: 'string', example: '#2ecc71' },
                accentColor: { type: 'string', example: '#e74c3c' },
                logo: { type: 'string', example: 'https://example.com/logo.png' },
                favicon: { type: 'string', example: 'https://example.com/favicon.ico' },
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
        }
    })
    @ApiNotFoundResponse({ description: 'Appearance settings not found' })
    findOne(@Param('orgRef') orgRef: string): Promise<OrganisationAppearance> {
        return this.appearanceService.findOne(orgRef);
    }

    @Patch(':orgRef/appearance')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Update organization appearance settings',
        description: 'Updates appearance settings for a specific organization. Requires ADMIN or MANAGER role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiBody({ type: UpdateOrganisationAppearanceDto })
    @ApiOkResponse({ 
        description: 'Appearance settings updated successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                primaryColor: { type: 'string', example: '#3498db' },
                secondaryColor: { type: 'string', example: '#2ecc71' },
                accentColor: { type: 'string', example: '#e74c3c' },
                logo: { type: 'string', example: 'https://example.com/logo.png' },
                favicon: { type: 'string', example: 'https://example.com/favicon.ico' },
                updatedAt: { type: 'string', format: 'date-time' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Appearance settings not found' })
    @ApiBadRequestResponse({ description: 'Invalid input data provided' })
    update(
        @Param('orgRef') orgRef: string,
        @Body() updateAppearanceDto: UpdateOrganisationAppearanceDto,
    ): Promise<OrganisationAppearance> {
        return this.appearanceService.update(orgRef, updateAppearanceDto);
    }

    @Delete(':orgRef/appearance')
    @Roles(AccessLevel.ADMIN)
    @ApiOperation({ 
        summary: 'Delete organization appearance settings',
        description: 'Deletes appearance settings for a specific organization. Requires ADMIN role.'
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code',
        type: 'string',
        example: 'ORG123456'
    })
    @ApiOkResponse({ 
        description: 'Appearance settings deleted successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string', example: 'Appearance settings deleted successfully' }
            }
        }
    })
    @ApiNotFoundResponse({ description: 'Appearance settings not found' })
    remove(@Param('orgRef') orgRef: string): Promise<void> {
        return this.appearanceService.remove(orgRef);
    }
} 