import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiInternalServerErrorResponse, ApiConflictResponse } from '@nestjs/swagger';
import { OrganisationSettingsService } from '../services/organisation-settings.service';
import { CreateOrganisationSettingsDto } from '../dto/create-organisation-settings.dto';
import { UpdateOrganisationSettingsDto } from '../dto/update-organisation-settings.dto';
import { OrganisationSettings } from '../entities/organisation-settings.entity';
import { ClerkAuthGuard } from '../../clerk/clerk.guard';
import { RoleGuard } from '../../guards/role.guard';
import { Roles } from '../../decorators/role.decorator';
import { AccessLevel } from '../../lib/enums/user.enums';
import { AuthenticatedRequest } from '../../lib/interfaces/authenticated-request.interface';

@ApiTags('🔧 Organisation Settings')
@Controller('organisations')
@UseGuards(ClerkAuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class OrganisationSettingsController {
    constructor(private readonly settingsService: OrganisationSettingsService) {}

    @Post(':orgRef/settings')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Create organization settings and configuration',
        description: `Creates comprehensive settings and configuration for a specific organization. This endpoint allows administrators and managers to define operational parameters, localization settings, and business rules for their organization.
        
        **Business Rules:**
        - Only ADMIN and MANAGER roles can create organization settings
        - One settings configuration per organization (use update to modify existing settings)
        - Language must be a valid ISO 639-1 language code
        - Timezone must be a valid IANA timezone identifier
        - Currency must be a valid ISO 4217 currency code
        - Date and time formats must follow standard formatting patterns
        - System automatically generates unique reference codes
        
        **Use Cases:**
        - Initial setup for new organizations
        - Localization and internationalization configuration
        - Business operational parameters setup
        - Compliance and regulatory settings
        - Multi-tenant application configuration
        - Regional customization and preferences`
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
        type: CreateOrganisationSettingsDto,
        description: 'Organization settings and configuration data',
        examples: {
            'south-african-org': {
                summary: 'South African organization',
                description: 'Standard settings for South African business operations',
                value: {
                    language: 'en',
                    timezone: 'Africa/Johannesburg',
                    dateFormat: 'DD/MM/YYYY',
                    timeFormat: 'HH:mm',
                    currency: 'ZAR',
                    numberFormat: '#,##0.00',
                    weekStartDay: 'Monday',
                    fiscalYearStart: '01/03',
                    businessHoursStart: '08:00',
                    businessHoursEnd: '17:00',
                    allowWeekendWork: false,
                    requireApprovalForOvertine: true
                }
            },
            'us-organization': {
                summary: 'US organization',
                description: 'Standard settings for US business operations',
                value: {
                    language: 'en',
                    timezone: 'America/New_York',
                    dateFormat: 'MM/DD/YYYY',
                    timeFormat: 'hh:mm A',
                    currency: 'USD',
                    numberFormat: '#,##0.00',
                    weekStartDay: 'Sunday',
                    fiscalYearStart: '01/01',
                    businessHoursStart: '09:00',
                    businessHoursEnd: '17:00',
                    allowWeekendWork: true,
                    requireApprovalForOvertine: true
                }
            },
            'european-org': {
                summary: 'European organization',
                description: 'Standard settings for European business operations',
                value: {
                    language: 'en',
                    timezone: 'Europe/London',
                    dateFormat: 'DD/MM/YYYY',
                    timeFormat: 'HH:mm',
                    currency: 'EUR',
                    numberFormat: '#.##0,00',
                    weekStartDay: 'Monday',
                    fiscalYearStart: '01/01',
                    businessHoursStart: '09:00',
                    businessHoursEnd: '18:00',
                    allowWeekendWork: false,
                    requireApprovalForOvertine: true
                }
            }
        }
    })
    @ApiCreatedResponse({ 
        description: 'Organization settings created successfully with complete configuration',
        schema: {
            type: 'object',
            properties: {
                settings: {
                    type: 'object',
                    properties: {
                        uid: { 
                            type: 'number', 
                            example: 1,
                            description: 'Unique identifier for the settings'
                        },
                        language: { 
                            type: 'string', 
                            example: 'en',
                            pattern: '^[a-z]{2}$',
                            description: 'ISO 639-1 language code for the organization'
                        },
                        timezone: { 
                            type: 'string', 
                            example: 'Africa/Johannesburg',
                            description: 'IANA timezone identifier for the organization'
                        },
                        dateFormat: { 
                            type: 'string', 
                            example: 'DD/MM/YYYY',
                            enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'yyyy-MM-dd', 'DD-MM-YYYY'],
                            description: 'Date format preference for the organization'
                        },
                        timeFormat: { 
                            type: 'string', 
                            example: 'HH:mm',
                            enum: ['HH:mm', 'hh:mm A', 'HH:mm:ss', 'hh:mm:ss A'],
                            description: 'Time format preference for the organization'
                        },
                        currency: { 
                            type: 'string', 
                            example: 'ZAR',
                            pattern: '^[A-Z]{3}$',
                            description: 'ISO 4217 currency code for the organization'
                        },
                        numberFormat: {
                            type: 'string',
                            example: '#,##0.00',
                            description: 'Number format pattern for displaying numbers'
                        },
                        weekStartDay: {
                            type: 'string',
                            example: 'Monday',
                            enum: ['Sunday', 'Monday'],
                            description: 'First day of the week for calendar displays'
                        },
                        fiscalYearStart: {
                            type: 'string',
                            example: '01/03',
                            pattern: '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])$',
                            description: 'Fiscal year start date in DD/MM format'
                        },
                        businessHoursStart: {
                            type: 'string',
                            example: '08:00',
                            pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                            description: 'Standard business hours start time'
                        },
                        businessHoursEnd: {
                            type: 'string',
                            example: '17:00',
                            pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                            description: 'Standard business hours end time'
                        },
                        allowWeekendWork: {
                            type: 'boolean',
                            example: false,
                            description: 'Whether weekend work is allowed'
                        },
                        requireApprovalForOvertime: {
                            type: 'boolean',
                            example: true,
                            description: 'Whether overtime work requires approval'
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
                            example: 'SET123456',
                            description: 'Unique reference code for the settings'
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
                },
                message: { 
                    type: 'string', 
                    example: 'Settings created successfully',
                    description: 'Success message confirming settings creation'
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
                        'language must be a valid ISO 639-1 language code',
                        'timezone must be a valid IANA timezone',
                        'currency must be a valid ISO 4217 currency code',
                        'dateFormat must be one of the allowed formats',
                        'businessHoursStart must be before businessHoursEnd'
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
        description: 'Conflict - settings already exist for this organization',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 409 },
                message: { type: 'string', example: 'Settings already exist for this organization. Use update endpoint to modify existing settings.' },
                error: { type: 'string', example: 'Conflict' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: 'Internal server error occurred while creating settings',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 500 },
                message: { type: 'string', example: 'Internal server error' },
                error: { type: 'string', example: 'Internal Server Error' }
            }
        }
    })
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