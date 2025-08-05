import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiInternalServerErrorResponse, ApiConflictResponse } from '@nestjs/swagger';
import { OrganisationHoursService } from '../services/organisation-hours.service';
import { CreateOrganisationHoursDto } from '../dto/create-organisation-hours.dto';
import { UpdateOrganisationHoursDto } from '../dto/update-organisation-hours.dto';
import { OrganisationHours } from '../entities/organisation-hours.entity';
import { AuthGuard } from '../../guards/auth.guard';
import { RoleGuard } from '../../guards/role.guard';
import { Roles } from '../../decorators/role.decorator';
import { AccessLevel } from '../../lib/enums/user.enums';

@ApiTags('🕒 Organisation Hours')
@Controller('organisations')
@UseGuards(AuthGuard, RoleGuard)
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class OrganisationHoursController {
    constructor(private readonly hoursService: OrganisationHoursService) {}

    @Post(':orgRef/hours')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Create organization operating hours',
        description: `Creates new operating hours for a specific organization. This endpoint allows administrators and managers to define business operating hours for different days of the week.
        
        **Business Rules:**
        - Only ADMIN and MANAGER roles can create organization hours
        - Each day can have specific open/close times or be marked as closed
        - Time format should be in HH:mm (24-hour format)
        - Multiple hour entries can exist for different purposes (e.g., seasonal hours)
        - System automatically generates a unique reference code for each hours entry
        
        **Use Cases:**
        - Setting up initial business hours for a new organization
        - Creating seasonal or holiday hour schedules
        - Establishing different hour sets for different services
        - Managing multi-location organization schedules`
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
        type: CreateOrganisationHoursDto,
        description: 'Organization hours data with day, times, and status information',
        examples: {
            'standard-weekday': {
                summary: 'Standard weekday hours',
                description: 'Typical Monday to Friday business hours',
                value: {
                    day: 'MONDAY',
                    openTime: '08:00',
                    closeTime: '17:00',
                    isClosed: false,
                    timezone: 'Africa/Johannesburg',
                    notes: 'Standard business hours'
                }
            },
            'weekend-hours': {
                summary: 'Weekend hours',
                description: 'Saturday operating hours with limited schedule',
                value: {
                    day: 'SATURDAY',
                    openTime: '09:00',
                    closeTime: '13:00',
                    isClosed: false,
                    timezone: 'Africa/Johannesburg',
                    notes: 'Weekend service hours'
                }
            },
            'closed-day': {
                summary: 'Closed day',
                description: 'Day when organization is closed',
                value: {
                    day: 'SUNDAY',
                    openTime: '00:00',
                    closeTime: '00:00',
                    isClosed: true,
                    timezone: 'Africa/Johannesburg',
                    notes: 'Closed on Sundays'
                }
            }
        }
    })
    @ApiCreatedResponse({ 
        description: 'Organization hours created successfully with complete details',
        schema: {
            type: 'object',
            properties: {
                uid: { 
                    type: 'number', 
                    example: 1,
                    description: 'Unique identifier for the hours entry'
                },
                day: { 
                    type: 'string', 
                    example: 'MONDAY',
                    enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
                    description: 'Day of the week for these operating hours'
                },
                openTime: { 
                    type: 'string', 
                    example: '09:00',
                    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                    description: 'Opening time in HH:mm format (24-hour)'
                },
                closeTime: { 
                    type: 'string', 
                    example: '17:00',
                    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                    description: 'Closing time in HH:mm format (24-hour)'
                },
                isClosed: { 
                    type: 'boolean', 
                    example: false,
                    description: 'Whether the organization is closed on this day'
                },
                timezone: {
                    type: 'string',
                    example: 'Africa/Johannesburg',
                    description: 'Timezone for the operating hours'
                },
                notes: {
                    type: 'string',
                    example: 'Standard business hours',
                    description: 'Additional notes about these hours'
                },
                createdAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T08:00:00.000Z',
                    description: 'Timestamp when the hours were created'
                },
                updatedAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T08:00:00.000Z',
                    description: 'Timestamp when the hours were last updated'
                },
                hoursRef: { 
                    type: 'string', 
                    example: 'HRS123456',
                    description: 'Unique reference code for these hours'
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
                        'day must be a valid day of the week',
                        'openTime must be in HH:mm format',
                        'closeTime cannot be before openTime',
                        'timezone must be a valid timezone'
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
        description: 'Conflict - hours already exist for this day and organization',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 409 },
                message: { type: 'string', example: 'Hours already exist for this day' },
                error: { type: 'string', example: 'Conflict' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: 'Internal server error occurred while creating hours',
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
        summary: 'Get organization default operating hours',
        description: `Retrieves the default operating hours for a specific organization. This endpoint provides the primary operating schedule that clients and systems can rely on for business hour information.
        
        **Functionality:**
        - Returns the first/primary hours entry for the organization
        - Accessible by all authenticated users regardless of role
        - Provides complete schedule information including timezone
        - Returns null if no hours are configured
        - Cached for optimal performance
        
        **Use Cases:**
        - Displaying business hours on public-facing applications
        - Validating business hour constraints in appointment systems
        - Calculating service availability windows
        - Integration with scheduling and notification systems
        - Mobile app operating hours display`
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
    @ApiOkResponse({ 
        description: 'Default operating hours retrieved successfully with complete schedule information',
        schema: {
            type: 'object',
            properties: {
                uid: { 
                    type: 'number', 
                    example: 1,
                    description: 'Unique identifier for the hours entry'
                },
                day: {
                    type: 'string',
                    example: 'MONDAY',
                    enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
                    description: 'Day of the week for these hours'
                },
                openTime: { 
                    type: 'string', 
                    example: '09:00',
                    description: 'Opening time in HH:mm format (24-hour)'
                },
                closeTime: { 
                    type: 'string', 
                    example: '17:00',
                    description: 'Closing time in HH:mm format (24-hour)'
                },
                isClosed: {
                    type: 'boolean',
                    example: false,
                    description: 'Whether the organization is closed on this day'
                },
                timezone: { 
                    type: 'string', 
                    example: 'Africa/Johannesburg',
                    description: 'Timezone for the operating hours'
                },
                notes: {
                    type: 'string',
                    example: 'Standard business hours',
                    description: 'Additional notes about operating hours'
                },
                holidayMode: { 
                    type: 'boolean', 
                    example: false,
                    description: 'Whether holiday mode is active'
                },
                schedule: {
                    type: 'object',
                    description: 'Detailed weekly schedule breakdown',
                    properties: {
                        monday: {
                            type: 'object',
                            properties: {
                                start: { type: 'string', example: '09:00' },
                                end: { type: 'string', example: '17:00' },
                                closed: { type: 'boolean', example: false }
                            }
                        },
                        tuesday: {
                            type: 'object',
                            properties: {
                                start: { type: 'string', example: '09:00' },
                                end: { type: 'string', example: '17:00' },
                                closed: { type: 'boolean', example: false }
                            }
                        },
                        saturday: {
                            type: 'object',
                            properties: {
                                start: { type: 'string', example: '09:00' },
                                end: { type: 'string', example: '13:00' },
                                closed: { type: 'boolean', example: false }
                            }
                        },
                        sunday: {
                            type: 'object',
                            properties: {
                                start: { type: 'string', example: '00:00' },
                                end: { type: 'string', example: '00:00' },
                                closed: { type: 'boolean', example: true }
                            }
                        }
                    }
                },
                createdAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T08:00:00.000Z',
                    description: 'Timestamp when the hours were created'
                },
                updatedAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T09:30:00.000Z',
                    description: 'Timestamp when the hours were last updated'
                },
                hoursRef: { 
                    type: 'string', 
                    example: 'HRS123456',
                    description: 'Unique reference code for these hours'
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
    @ApiNotFoundResponse({ 
        description: 'Organization not found or no operating hours configured',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 404 },
                message: { 
                    type: 'string', 
                    example: 'Organization not found or no hours configured',
                    description: 'Specific error message'
                },
                error: { type: 'string', example: 'Not Found' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: 'Internal server error occurred while retrieving hours',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 500 },
                message: { type: 'string', example: 'Internal server error' },
                error: { type: 'string', example: 'Internal Server Error' }
            }
        }
    })
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
        summary: 'Get all organization operating hours',
        description: `Retrieves all operating hours entries for a specific organization. This endpoint provides a comprehensive view of all configured operating schedules including seasonal hours, special schedules, and holiday hours.
        
        **Functionality:**
        - Returns complete list of all hours configurations for the organization
        - Accessible by all authenticated users regardless of role
        - Includes organization details with each hours entry
        - Results are ordered by creation date (newest first)
        - Returns empty array if no hours are configured
        
        **Use Cases:**
        - Administrative management of multiple hour schedules
        - Reviewing seasonal or special operating hours
        - Auditing changes to operating hour configurations
        - Integration with scheduling systems requiring multiple hour sets
        - Historical analysis of operating hour changes`
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
    @ApiOkResponse({ 
        description: 'All operating hours retrieved successfully with complete details',
        schema: {
            type: 'array',
            description: 'Array of all operating hours entries for the organization',
            items: {
                type: 'object',
                properties: {
                    uid: { 
                        type: 'number', 
                        example: 1,
                        description: 'Unique identifier for the hours entry'
                    },
                    day: { 
                        type: 'string', 
                        example: 'MONDAY',
                        enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
                        description: 'Day of the week for these operating hours'
                    },
                    openTime: { 
                        type: 'string', 
                        example: '09:00',
                        pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                        description: 'Opening time in HH:mm format (24-hour)'
                    },
                    closeTime: { 
                        type: 'string', 
                        example: '17:00',
                        pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                        description: 'Closing time in HH:mm format (24-hour)'
                    },
                    isClosed: { 
                        type: 'boolean', 
                        example: false,
                        description: 'Whether the organization is closed on this day'
                    },
                    timezone: {
                        type: 'string',
                        example: 'Africa/Johannesburg',
                        description: 'Timezone for the operating hours'
                    },
                    notes: {
                        type: 'string',
                        example: 'Standard business hours',
                        description: 'Additional notes about these hours'
                    },
                    isDefault: {
                        type: 'boolean',
                        example: true,
                        description: 'Whether this is the default hours entry'
                    },
                    isActive: {
                        type: 'boolean',
                        example: true,
                        description: 'Whether these hours are currently active'
                    },
                    createdAt: { 
                        type: 'string', 
                        format: 'date-time',
                        example: '2024-01-15T08:00:00.000Z',
                        description: 'Timestamp when the hours were created'
                    },
                    updatedAt: { 
                        type: 'string', 
                        format: 'date-time',
                        example: '2024-01-15T09:30:00.000Z',
                        description: 'Timestamp when the hours were last updated'
                    },
                    hoursRef: { 
                        type: 'string', 
                        example: 'HRS123456',
                        description: 'Unique reference code for these hours'
                    },
                    organisation: {
                        type: 'object',
                        properties: {
                            uid: { 
                                type: 'number', 
                                example: 1,
                                description: 'Organization unique identifier'
                            },
                            name: { 
                                type: 'string', 
                                example: 'Acme Corporation',
                                description: 'Organization name'
                            },
                            ref: {
                                type: 'string',
                                example: 'ORG123456',
                                description: 'Organization reference code'
                            }
                        },
                        description: 'Organization details'
                    }
                }
            },
            example: [
                {
                    uid: 1,
                    day: 'MONDAY',
                    openTime: '09:00',
                    closeTime: '17:00',
                    isClosed: false,
                    timezone: 'Africa/Johannesburg',
                    notes: 'Standard weekday hours',
                    isDefault: true,
                    isActive: true,
                    createdAt: '2024-01-15T08:00:00.000Z',
                    updatedAt: '2024-01-15T08:00:00.000Z',
                    hoursRef: 'HRS123456',
                    organisation: {
                        uid: 1,
                        name: 'Acme Corporation',
                        ref: 'ORG123456'
                    }
                },
                {
                    uid: 2,
                    day: 'SATURDAY',
                    openTime: '09:00',
                    closeTime: '13:00',
                    isClosed: false,
                    timezone: 'Africa/Johannesburg',
                    notes: 'Weekend service hours',
                    isDefault: false,
                    isActive: true,
                    createdAt: '2024-01-15T08:00:00.000Z',
                    updatedAt: '2024-01-15T08:00:00.000Z',
                    hoursRef: 'HRS789012',
                    organisation: {
                        uid: 1,
                        name: 'Acme Corporation',
                        ref: 'ORG123456'
                    }
                }
            ]
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
    @ApiInternalServerErrorResponse({
        description: 'Internal server error occurred while retrieving hours',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 500 },
                message: { type: 'string', example: 'Internal server error' },
                error: { type: 'string', example: 'Internal Server Error' }
            }
        }
    })
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
        summary: 'Get specific organization operating hours',
        description: `Retrieves specific operating hours for an organization by hours reference code. This endpoint provides detailed information about a particular hours configuration.
        
        **Functionality:**
        - Returns complete details for a specific hours entry
        - Accessible by all authenticated users regardless of role
        - Includes organization relationship data
        - Validates both organization and hours existence
        - Cached for optimal performance
        
        **Use Cases:**
        - Retrieving details for hours modification
        - Viewing specific seasonal or special hour configurations
        - Integration with external scheduling systems
        - Administrative review of specific hours entries
        - Mobile app detailed hours display`
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
    @ApiParam({
        name: 'hoursRef',
        description: 'Hours reference code - unique identifier for the specific hours entry',
        type: 'string',
        example: 'HRS123456',
        schema: {
            pattern: '^HRS[A-Z0-9]{6,}$',
            minLength: 9
        }
    })
    @ApiOkResponse({ 
        description: 'Specific operating hours retrieved successfully with complete details',
        schema: {
            type: 'object',
            properties: {
                uid: { 
                    type: 'number', 
                    example: 1,
                    description: 'Unique identifier for the hours entry'
                },
                day: { 
                    type: 'string', 
                    example: 'MONDAY',
                    enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
                    description: 'Day of the week for these operating hours'
                },
                openTime: { 
                    type: 'string', 
                    example: '09:00',
                    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                    description: 'Opening time in HH:mm format (24-hour)'
                },
                closeTime: { 
                    type: 'string', 
                    example: '17:00',
                    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                    description: 'Closing time in HH:mm format (24-hour)'
                },
                isClosed: { 
                    type: 'boolean', 
                    example: false,
                    description: 'Whether the organization is closed on this day'
                },
                timezone: {
                    type: 'string',
                    example: 'Africa/Johannesburg',
                    description: 'Timezone for the operating hours'
                },
                notes: {
                    type: 'string',
                    example: 'Standard business hours',
                    description: 'Additional notes about these hours'
                },
                isDefault: {
                    type: 'boolean',
                    example: true,
                    description: 'Whether this is the default hours entry'
                },
                isActive: {
                    type: 'boolean',
                    example: true,
                    description: 'Whether these hours are currently active'
                },
                createdAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T08:00:00.000Z',
                    description: 'Timestamp when the hours were created'
                },
                updatedAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T09:30:00.000Z',
                    description: 'Timestamp when the hours were last updated'
                },
                hoursRef: { 
                    type: 'string', 
                    example: 'HRS123456',
                    description: 'Unique reference code for these hours'
                },
                organisation: {
                    type: 'object',
                    properties: {
                        uid: { 
                            type: 'number', 
                            example: 1,
                            description: 'Organization unique identifier'
                        },
                        name: { 
                            type: 'string', 
                            example: 'Acme Corporation',
                            description: 'Organization name'
                        },
                        ref: {
                            type: 'string',
                            example: 'ORG123456',
                            description: 'Organization reference code'
                        },
                        timezone: {
                            type: 'string',
                            example: 'Africa/Johannesburg',
                            description: 'Organization default timezone'
                        }
                    },
                    description: 'Organization details'
                }
            }
        }
    })
    @ApiNotFoundResponse({ 
        description: 'Hours not found with the provided reference codes',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 404 },
                message: { 
                    type: 'string', 
                    example: 'Hours not found for the specified organization',
                    description: 'Specific error message'
                },
                error: { type: 'string', example: 'Not Found' }
            }
        }
    })
    @ApiBadRequestResponse({
        description: 'Invalid reference codes provided',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 400 },
                message: { 
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'orgRef must match pattern ^ORG[A-Z0-9]{6,}$',
                        'hoursRef must match pattern ^HRS[A-Z0-9]{6,}$'
                    ]
                },
                error: { type: 'string', example: 'Bad Request' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: 'Internal server error occurred while retrieving hours',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 500 },
                message: { type: 'string', example: 'Internal server error' },
                error: { type: 'string', example: 'Internal Server Error' }
            }
        }
    })
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