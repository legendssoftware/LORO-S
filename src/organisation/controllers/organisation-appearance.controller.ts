import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiInternalServerErrorResponse, ApiConflictResponse } from '@nestjs/swagger';
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
        summary: 'Create organization appearance and branding settings',
        description: `Creates comprehensive appearance and branding settings for a specific organization. This endpoint allows administrators and managers to define the visual identity and branding elements for their organization.
        
        **Business Rules:**
        - Only ADMIN and MANAGER roles can create appearance settings
        - Colors must be valid hex color codes (e.g., #3498db)
        - Logo and favicon URLs must be valid and accessible
        - Font settings must reference available web fonts
        - One appearance configuration per organization (use update to modify)
        - System automatically generates a unique reference code
        
        **Use Cases:**
        - Setting up brand identity for new organizations
        - Customizing application themes and colors
        - Configuring logo and branding assets
        - Establishing consistent visual identity across platforms
        - White-label application customization`
    })
    @ApiParam({
        name: 'orgRef',
        description: 'Organization reference code - unique identifier for the organization',
        type: 'string',
        example: 'ORG123456',
        schema: {
            pattern: '^ORG[A-Z0-9]{6,}$',
            minLength: 9
        }
    })
    @ApiBody({ 
        type: CreateOrganisationAppearanceDto,
        description: 'Organization appearance and branding configuration data',
        examples: {
            'corporate-blue': {
                summary: 'Corporate blue theme',
                description: 'Professional blue-based corporate branding',
                value: {
                    primaryColor: '#2563eb',
                    secondaryColor: '#1e40af',
                    accentColor: '#3b82f6',
                    backgroundColor: '#f8fafc',
                    textColor: '#1e293b',
                    logo: 'https://cdn.example.com/logos/corporate-logo.png',
                    favicon: 'https://cdn.example.com/favicons/corporate-favicon.ico',
                    fontFamily: 'Inter, sans-serif',
                    headerColor: '#1e40af',
                    footerColor: '#334155'
                }
            },
            'modern-green': {
                summary: 'Modern green theme',
                description: 'Fresh green-based modern branding',
                value: {
                    primaryColor: '#059669',
                    secondaryColor: '#047857',
                    accentColor: '#10b981',
                    backgroundColor: '#f0fdf4',
                    textColor: '#064e3b',
                    logo: 'https://cdn.example.com/logos/eco-logo.png',
                    favicon: 'https://cdn.example.com/favicons/eco-favicon.ico',
                    fontFamily: 'Roboto, sans-serif',
                    headerColor: '#047857',
                    footerColor: '#065f46'
                }
            },
            'elegant-purple': {
                summary: 'Elegant purple theme',
                description: 'Sophisticated purple-based luxury branding',
                value: {
                    primaryColor: '#7c3aed',
                    secondaryColor: '#6d28d9',
                    accentColor: '#8b5cf6',
                    backgroundColor: '#faf5ff',
                    textColor: '#581c87',
                    logo: 'https://cdn.example.com/logos/luxury-logo.png',
                    favicon: 'https://cdn.example.com/favicons/luxury-favicon.ico',
                    fontFamily: 'Poppins, sans-serif',
                    headerColor: '#6d28d9',
                    footerColor: '#5b21b6'
                }
            }
        }
    })
    @ApiCreatedResponse({ 
        description: 'Organization appearance settings created successfully with complete branding configuration',
        schema: {
            type: 'object',
            properties: {
                uid: { 
                    type: 'number', 
                    example: 1,
                    description: 'Unique identifier for the appearance settings'
                },
                primaryColor: { 
                    type: 'string', 
                    example: '#2563eb',
                    pattern: '^#[a-fA-F0-9]{6}$',
                    description: 'Primary brand color in hex format'
                },
                secondaryColor: { 
                    type: 'string', 
                    example: '#1e40af',
                    pattern: '^#[a-fA-F0-9]{6}$',
                    description: 'Secondary brand color in hex format'
                },
                accentColor: { 
                    type: 'string', 
                    example: '#3b82f6',
                    pattern: '^#[a-fA-F0-9]{6}$',
                    description: 'Accent color for highlights and call-to-actions'
                },
                backgroundColor: {
                    type: 'string',
                    example: '#f8fafc',
                    pattern: '^#[a-fA-F0-9]{6}$',
                    description: 'Background color for pages and containers'
                },
                textColor: {
                    type: 'string',
                    example: '#1e293b',
                    pattern: '^#[a-fA-F0-9]{6}$',
                    description: 'Primary text color'
                },
                logo: { 
                    type: 'string', 
                    example: 'https://cdn.example.com/logos/corporate-logo.png',
                    format: 'uri',
                    description: 'URL to the organization logo image'
                },
                favicon: { 
                    type: 'string', 
                    example: 'https://cdn.example.com/favicons/corporate-favicon.ico',
                    format: 'uri',
                    description: 'URL to the organization favicon'
                },
                fontFamily: {
                    type: 'string',
                    example: 'Inter, sans-serif',
                    description: 'Font family for text elements'
                },
                headerColor: {
                    type: 'string',
                    example: '#1e40af',
                    pattern: '^#[a-fA-F0-9]{6}$',
                    description: 'Header background color'
                },
                footerColor: {
                    type: 'string',
                    example: '#334155',
                    pattern: '^#[a-fA-F0-9]{6}$',
                    description: 'Footer background color'
                },
                createdAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T08:00:00.000Z',
                    description: 'Timestamp when the settings were created'
                },
                updatedAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T08:00:00.000Z',
                    description: 'Timestamp when the settings were last updated'
                },
                ref: {
                    type: 'string',
                    example: 'APP123456',
                    description: 'Unique reference code for the appearance settings'
                },
                organisation: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 1 },
                        name: { type: 'string', example: 'Acme Corporation' },
                        ref: { type: 'string', example: 'ORG123456' }
                    },
                    description: 'Organization details'
                }
            }
        }
    })
    @ApiBadRequestResponse({ 
        description: 'Invalid input data provided - validation errors or business rule violations',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 400 },
                message: { 
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'primaryColor must be a valid hex color code',
                        'logo must be a valid URL',
                        'fontFamily must be a valid font family',
                        'colors must be in #RRGGBB format'
                    ]
                },
                error: { type: 'string', example: 'Bad Request' }
            }
        }
    })
    @ApiNotFoundResponse({ 
        description: 'Organization not found with the provided reference code',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 404 },
                message: { type: 'string', example: 'Organization not found' },
                error: { type: 'string', example: 'Not Found' }
            }
        }
    })
    @ApiConflictResponse({
        description: 'Conflict - appearance settings already exist for this organization',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 409 },
                message: { type: 'string', example: 'Appearance settings already exist for this organization' },
                error: { type: 'string', example: 'Conflict' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: 'Internal server error occurred while creating appearance settings',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 500 },
                message: { type: 'string', example: 'Internal server error' },
                error: { type: 'string', example: 'Internal Server Error' }
            }
        }
    })
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