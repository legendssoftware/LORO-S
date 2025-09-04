import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiInternalServerErrorResponse, ApiConflictResponse, ApiForbiddenResponse } from '@nestjs/swagger';
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
        summary: '📝 Update organization operating hours',
        description: `
# Organization Hours Management System

Updates specific operating hours for an organization with comprehensive validation and business rule enforcement.

## 🕒 **Core Features**
- **Flexible Hour Updates**: Modify opening/closing times, day status, and timezone settings
- **Business Rule Validation**: Ensures logical time sequences and operational constraints
- **Multi-Day Support**: Update hours for any day of the week with independent configurations
- **Timezone Management**: Support for organization-specific timezone configurations
- **Status Control**: Enable/disable operations for specific days with closure management

## 🔧 **Update Capabilities**
- **Time Adjustments**: Modify opening and closing times with minute-level precision
- **Day Configuration**: Set business days, weekends, or custom schedules
- **Seasonal Changes**: Temporary hour adjustments for holidays or special periods
- **Closure Management**: Mark days as closed while preserving hour configurations
- **Notes & Documentation**: Add contextual information for hour changes

## 📋 **Business Rules**
- **Time Validation**: Opening time must precede closing time
- **Day Logic**: Each day can have unique hours or be marked as closed
- **Timezone Consistency**: All hours within organization use consistent timezone
- **Minimum Duration**: Prevents unreasonably short operating windows
- **Maximum Duration**: Validates against 24-hour operational limits

## 🔒 **Security & Access Control**
- **Role-Based Updates**: Only ADMIN and MANAGER roles can modify hours
- **Organization Boundaries**: Users can only modify hours for their organization
- **Audit Trail**: Complete logging of all hour changes with user identification
- **Change Validation**: Validates requesting user has appropriate permissions

## 📈 **Business Intelligence**
- **Operational Analytics**: Track hour changes and their impact on business metrics
- **Customer Impact**: Analyze how hour changes affect customer access patterns
- **Staff Planning**: Align hour changes with staffing and resource allocation
- **Revenue Impact**: Monitor correlation between operating hours and revenue
- **Historical Trends**: Track hour evolution and seasonal patterns

## 🎯 **Use Cases**
- **Seasonal Adjustments**: Modify hours for holiday seasons or business cycles
- **Operational Optimization**: Adjust hours based on customer traffic patterns
- **Staff Management**: Align operating hours with staff availability
- **Emergency Changes**: Rapid hour adjustments for unexpected circumstances
- **Market Response**: Adapt hours to competitive market conditions
- **Compliance Updates**: Modify hours to meet regulatory requirements
        `
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
    @ApiBody({ 
        type: UpdateOrganisationHoursDto,
        description: 'Hours update payload with comprehensive validation',
        examples: {
            extendHours: {
                summary: '⏰ Extend Operating Hours',
                description: 'Extend business hours to accommodate more customers',
                value: {
                    openTime: '07:00',
                    closeTime: '19:00',
                    notes: 'Extended hours for holiday season - November through January',
                    timezone: 'Africa/Johannesburg'
                }
            },
            weekendHours: {
                summary: '📅 Weekend Hours Update',
                description: 'Set special weekend operating schedule',
                value: {
                    day: 'SATURDAY',
                    openTime: '09:00',
                    closeTime: '14:00',
                    isClosed: false,
                    notes: 'Weekend service hours - limited staff availability',
                    timezone: 'Africa/Johannesburg'
                }
            },
            closureDay: {
                summary: '🚫 Mark Day as Closed',
                description: 'Close operations for specific day',
                value: {
                    isClosed: true,
                    notes: 'Closed for public holiday - Heritage Day',
                    openTime: '00:00',
                    closeTime: '00:00'
                }
            },
            timezoneUpdate: {
                summary: '🌍 Timezone Adjustment',
                description: 'Update timezone for international operations',
                value: {
                    timezone: 'Europe/London',
                    notes: 'Timezone updated for UK branch operations'
                }
            },
            emergencyHours: {
                summary: '🚨 Emergency Hour Change',
                description: 'Rapid adjustment for unexpected circumstances',
                value: {
                    openTime: '10:00',
                    closeTime: '16:00',
                    notes: 'Emergency reduced hours due to system maintenance'
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Organization hours updated successfully with complete details',
        schema: {
            type: 'object',
            properties: {
                uid: { 
                    type: 'number', 
                    example: 1,
                    description: 'Unique identifier for the updated hours entry'
                },
                day: { 
                    type: 'string', 
                    example: 'MONDAY',
                    enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
                    description: 'Day of the week for these operating hours'
                },
                openTime: { 
                    type: 'string', 
                    example: '07:00',
                    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                    description: 'Updated opening time in HH:mm format (24-hour)'
                },
                closeTime: { 
                    type: 'string', 
                    example: '19:00',
                    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                    description: 'Updated closing time in HH:mm format (24-hour)'
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
                    example: 'Extended hours for holiday season',
                    description: 'Updated notes about these hours'
                },
                updatedAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T10:30:00.000Z',
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
                        name: { type: 'string', example: 'Orrbit Technologies' },
                        ref: { type: 'string', example: 'ORG123456' }
                    },
                    description: 'Organization details'
                },
                changesSummary: {
                    type: 'object',
                    properties: {
                        modifiedFields: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['openTime', 'closeTime', 'notes'],
                            description: 'List of fields that were updated'
                        },
                        previousValues: {
                            type: 'object',
                            properties: {
                                openTime: { type: 'string', example: '09:00' },
                                closeTime: { type: 'string', example: '17:00' }
                            },
                            description: 'Previous values before update'
                        }
                    },
                    description: 'Summary of changes made during update'
                }
            }
        }
    })
    @ApiNotFoundResponse({ 
        description: '🔍 Hours not found with the provided reference codes',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 404 },
                message: { 
                    type: 'string', 
                    example: 'Hours not found for the specified organization and hours reference',
                    description: 'Specific error message'
                },
                error: { type: 'string', example: 'Not Found' },
                details: {
                    type: 'object',
                    properties: {
                        orgRef: { type: 'string', example: 'ORG123456' },
                        hoursRef: { type: 'string', example: 'HRS123456' },
                        reason: { type: 'string', example: 'Hours entry does not exist or has been deleted' }
                    }
                },
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Verify the hours reference code is correct',
                        'Check if the hours entry has been deleted',
                        'Ensure the organization reference is valid'
                    ]
                }
            }
        }
    })
    @ApiBadRequestResponse({ 
        description: '❌ Invalid input data provided - validation errors or business rule violations',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 400 },
                message: { 
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'openTime must be before closeTime',
                        'Invalid timezone format provided',
                        'Operating hours cannot exceed 24 hours',
                        'Time format must be HH:mm'
                    ]
                },
                error: { type: 'string', example: 'Bad Request' },
                validationDetails: {
                    type: 'object',
                    properties: {
                        field: { type: 'string', example: 'openTime' },
                        rejectedValue: { type: 'string', example: '25:00' },
                        constraint: { type: 'string', example: 'Time must be in valid 24-hour format' }
                    }
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Forbidden - Insufficient permissions to update hours',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 403 },
                message: { type: 'string', example: 'You do not have permission to update organization hours' },
                error: { type: 'string', example: 'Forbidden' },
                reason: { type: 'string', example: 'Insufficient access level or organization mismatch' },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['ADMIN', 'MANAGER']
                }
            }
        }
    })
    @ApiConflictResponse({
        description: '⚠️ Conflict - Hours update conflicts with current state',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 409 },
                message: { type: 'string', example: 'Cannot update hours - conflicts with current system state' },
                error: { type: 'string', example: 'Conflict' },
                conflicts: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Another user is currently updating these hours',
                        'Hours are locked for end-of-day processing'
                    ]
                }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Hours update failed',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 500 },
                message: { type: 'string', example: 'Failed to update hours due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
                path: { type: 'string', example: '/organisations/ORG123456/hours/HRS123456' }
            }
        }
    })
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
        summary: '🏢 Update organization default operating hours',
        description: `
# Default Hours Management System

Updates or creates the primary default operating hours for an organization with comprehensive validation and business intelligence.

## 🎯 **Core Purpose**
- **Primary Hours Configuration**: Set the main operating schedule that serves as organizational standard
- **Default Template**: Creates the baseline hours that other specific day hours can reference
- **Organization-Wide Standard**: Establishes consistent operating expectations across all locations
- **Holiday Mode Support**: Enable special operating modes for holidays and exceptional periods
- **Timezone Coordination**: Set organization-wide timezone for consistent time management

## 🔧 **Advanced Features**
- **Smart Defaults**: Automatically applies default hours to new day configurations
- **Holiday Mode Management**: Toggle special operating modes for seasonal adjustments
- **Cascade Updates**: Option to update all existing hours to match new defaults
- **Template Creation**: Establishes templates for rapid multi-location hour setup
- **Compliance Integration**: Ensures hours meet regulatory and policy requirements

## 📊 **Business Intelligence**
- **Operational Standards**: Define organization-wide operating hour standards
- **Performance Baselines**: Set baseline hours for productivity and availability metrics
- **Customer Expectations**: Establish consistent service availability expectations
- **Staff Planning**: Provide foundation for workforce scheduling and resource allocation
- **Revenue Optimization**: Align default hours with peak business activity periods

## 🔒 **Security & Governance**
- **Administrative Control**: Only ADMIN and MANAGER roles can modify default hours
- **Organization Boundaries**: Ensures changes apply only to authenticated user's organization
- **Change Management**: Complete audit trail of default hour modifications
- **Impact Assessment**: Validates changes against existing operational commitments
- **Policy Compliance**: Ensures hours meet organizational and regulatory policies

## 📈 **Operational Impact**
- **Service Availability**: Defines standard customer service and support availability
- **Resource Planning**: Guides staff scheduling and facility management decisions
- **Customer Communication**: Provides consistent hours for marketing and communication
- **System Integration**: Enables automated scheduling and notification systems
- **Multi-Location Consistency**: Ensures uniform operating standards across branches

## 🎯 **Use Cases**
- **Initial Setup**: Establish organization's primary operating schedule
- **Policy Updates**: Implement new organizational operating hour policies
- **Seasonal Changes**: Adjust standard hours for seasonal business patterns
- **Expansion Support**: Set default hours for new locations and services
- **Compliance Alignment**: Update hours to meet regulatory requirements
- **Emergency Procedures**: Establish emergency or reduced hour protocols
        `
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
        type: UpdateOrganisationHoursDto,
        description: 'Default hours configuration with comprehensive options',
        examples: {
            standardBusiness: {
                summary: '🏢 Standard Business Hours',
                description: 'Set typical Monday-Friday business hours as organization default',
                value: {
                    openTime: '08:00',
                    closeTime: '17:00',
                    timezone: 'Africa/Johannesburg',
                    holidayMode: false,
                    notes: 'Standard business hours - Monday through Friday'
                }
            },
            extendedService: {
                summary: '⏰ Extended Service Hours',
                description: 'Set extended hours for customer service organizations',
                value: {
                    openTime: '06:00',
                    closeTime: '22:00',
                    timezone: 'Africa/Johannesburg',
                    holidayMode: false,
                    notes: 'Extended service hours for customer support operations'
                }
            },
            holidayMode: {
                summary: '🎄 Holiday Operating Mode',
                description: 'Enable holiday mode with special seasonal hours',
                value: {
                    openTime: '10:00',
                    closeTime: '15:00',
                    timezone: 'Africa/Johannesburg',
                    holidayMode: true,
                    notes: 'Holiday season hours - December 15 through January 15'
                }
            },
            globalTimezone: {
                summary: '🌍 Global Operations',
                description: 'Set hours for international operations with different timezone',
                value: {
                    openTime: '09:00',
                    closeTime: '18:00',
                    timezone: 'Europe/London',
                    holidayMode: false,
                    notes: 'UK operations timezone - GMT/BST'
                }
            },
            emergencyHours: {
                summary: '🚨 Emergency Reduced Hours',
                description: 'Set emergency operating hours for special circumstances',
                value: {
                    openTime: '10:00',
                    closeTime: '14:00',
                    timezone: 'Africa/Johannesburg',
                    holidayMode: false,
                    notes: 'Emergency reduced hours due to infrastructure maintenance'
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Default organization hours updated successfully with complete configuration',
        schema: {
            type: 'object',
            properties: {
                uid: { 
                    type: 'number', 
                    example: 1,
                    description: 'Unique identifier for the default hours entry'
                },
                openTime: { 
                    type: 'string', 
                    example: '08:00',
                    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                    description: 'Default opening time in HH:mm format (24-hour)'
                },
                closeTime: { 
                    type: 'string', 
                    example: '17:00',
                    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
                    description: 'Default closing time in HH:mm format (24-hour)'
                },
                timezone: { 
                    type: 'string', 
                    example: 'Africa/Johannesburg',
                    description: 'Organization default timezone for all time calculations'
                },
                holidayMode: { 
                    type: 'boolean', 
                    example: false,
                    description: 'Whether holiday mode is currently active'
                },
                notes: {
                    type: 'string',
                    example: 'Standard business hours - Monday through Friday',
                    description: 'Notes about the default hours configuration'
                },
                isDefault: {
                    type: 'boolean',
                    example: true,
                    description: 'Indicates this is the default hours template'
                },
                updatedAt: { 
                    type: 'string', 
                    format: 'date-time',
                    example: '2024-01-15T10:30:00.000Z',
                    description: 'Timestamp when the default hours were last updated'
                },
                hoursRef: { 
                    type: 'string', 
                    example: 'HRS123456',
                    description: 'Unique reference code for these default hours'
                },
                organisation: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                        name: { type: 'string', example: 'Orrbit Technologies' },
                        ref: { type: 'string', example: 'ORG123456' }
                    },
                    description: 'Organization details'
                },
                systemImpact: {
                    type: 'object',
                    properties: {
                        affectedLocations: { 
                            type: 'number', 
                            example: 5,
                            description: 'Number of locations that will inherit these default hours'
                        },
                        cascadeUpdates: { 
                            type: 'boolean', 
                            example: true,
                            description: 'Whether existing hours were updated to match new defaults'
                        },
                        notificationsSent: { 
                            type: 'number', 
                            example: 12,
                            description: 'Number of stakeholder notifications sent'
                        }
                    },
                    description: 'Impact summary of the default hours update'
                }
            }
        }
    })
    @ApiNotFoundResponse({ 
        description: '🔍 Organization not found with the provided reference code',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 404 },
                message: { type: 'string', example: 'Organization not found' },
                error: { type: 'string', example: 'Not Found' },
                details: {
                    type: 'object',
                    properties: {
                        orgRef: { type: 'string', example: 'ORG123456' },
                        reason: { type: 'string', example: 'Organization does not exist or has been deleted' }
                    }
                },
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Verify the organization reference code is correct',
                        'Check if the organization has been deleted or merged',
                        'Ensure you have access to this organization'
                    ]
                }
            }
        }
    })
    @ApiBadRequestResponse({ 
        description: '❌ Invalid input data provided - validation errors or business rule violations',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 400 },
                message: { 
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'openTime must be before closeTime',
                        'Invalid timezone identifier provided',
                        'Operating hours cannot exceed 18 hours per day',
                        'Holiday mode conflicts with current active schedules'
                    ]
                },
                error: { type: 'string', example: 'Bad Request' },
                businessRuleViolations: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Default hours would conflict with existing customer service commitments',
                        'Proposed hours violate labor regulations in organization jurisdiction',
                        'Holiday mode cannot be enabled during active business periods'
                    ]
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Forbidden - Insufficient permissions to update default hours',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 403 },
                message: { type: 'string', example: 'You do not have permission to update organization default hours' },
                error: { type: 'string', example: 'Forbidden' },
                reason: { type: 'string', example: 'Only ADMIN and MANAGER roles can modify default operating hours' },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['ADMIN', 'MANAGER']
                },
                impactLevel: { type: 'string', example: 'ORGANIZATION_WIDE' }
            }
        }
    })
    @ApiConflictResponse({
        description: '⚠️ Conflict - Default hours update conflicts with current operations',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 409 },
                message: { type: 'string', example: 'Cannot update default hours - conflicts with active operations' },
                error: { type: 'string', example: 'Conflict' },
                operationalConflicts: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Active customer service sessions would be terminated',
                        'Scheduled maintenance windows would be affected',
                        'Staff schedules conflict with proposed hours'
                    ]
                },
                resolution: {
                    type: 'object',
                    properties: {
                        waitTime: { type: 'string', example: '2 hours until operations end' },
                        alternativeActions: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'Schedule update for next business day',
                                'Apply changes gradually over time',
                                'Override with administrative privileges'
                            ]
                        }
                    }
                }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Default hours update failed',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 500 },
                message: { type: 'string', example: 'Failed to update default hours due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
                path: { type: 'string', example: '/organisations/ORG123456/hours' },
                systemImpact: {
                    type: 'object',
                    properties: {
                        rollbackStatus: { type: 'string', example: 'COMPLETED' },
                        affectedSystems: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['Scheduling Service', 'Notification System']
                        }
                    }
                }
            }
        }
    })
    updateDefault(
        @Param('orgRef') orgRef: string,
        @Body() updateHoursDto: UpdateOrganisationHoursDto,
    ): Promise<OrganisationHours> {
        return this.hoursService.updateDefault(orgRef, updateHoursDto);
    }

    @Delete(':orgRef/hours/:hoursRef')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: '🗑️ Delete organization operating hours',
        description: `
# Organization Hours Deletion System

Safely removes specific operating hours for an organization with comprehensive impact analysis and recovery options.

## 🔒 **Safety & Security Features**
- **Soft Deletion**: Hours are marked as deleted but preserved for recovery and historical analysis
- **Impact Assessment**: Comprehensive analysis of deletion impact on operations and scheduling
- **Audit Trail**: Complete logging of deletion actions with user identification and reasoning
- **Recovery Options**: Ability to restore deleted hours within configurable retention period
- **Dependency Validation**: Ensures deletion won't disrupt active operations or scheduled activities

## 📊 **Pre-Deletion Analysis**
- **Active Schedule Check**: Validates no active operations are scheduled during these hours
- **Staff Impact**: Analyzes impact on staff schedules and assignments
- **Customer Service**: Checks for customer service commitments during these hours
- **System Dependencies**: Identifies automated systems that depend on these hours
- **Historical Importance**: Preserves hours that have significant historical operational data

## 🔧 **Deletion Process**
- **Validation Phase**: Comprehensive checks before deletion is allowed
- **Notification System**: Automated notifications to affected stakeholders
- **Graceful Deactivation**: Systematic deactivation of dependent services
- **Data Preservation**: Archive operational data before logical deletion
- **Recovery Documentation**: Generate recovery instructions for potential restoration

## 📈 **Business Intelligence**
- **Operational Impact**: Track how hour deletions affect business operations
- **Resource Optimization**: Analyze resource allocation after hour schedule changes
- **Customer Experience**: Monitor customer satisfaction impact from hour changes
- **Efficiency Metrics**: Measure operational efficiency changes post-deletion
- **Historical Analysis**: Maintain deletion history for trend analysis and planning

## 🎯 **Use Cases**
- **Schedule Optimization**: Remove inefficient or underutilized operating hours
- **Seasonal Adjustments**: Delete temporary seasonal hours after periods end
- **Operational Restructuring**: Remove hours during business model changes
- **Resource Reallocation**: Delete hours to free resources for more productive periods
- **Compliance Requirements**: Remove hours that no longer meet regulatory standards
- **Emergency Response**: Rapidly remove hours during crisis or emergency situations

## ⚠️ **Deletion Safeguards**
- **Minimum Hours Protection**: Prevents deletion if organization would have insufficient operating hours
- **Active Operations Guard**: Blocks deletion during active business operations
- **Future Commitments**: Validates no future commitments exist during these hours
- **Staff Schedule Protection**: Ensures staff aren't left without assigned working hours
- **Customer Impact**: Prevents deletions that would immediately affect customer service

## 🔄 **Recovery & Restoration**
- **Retention Period**: Deleted hours preserved for 90 days by default
- **Quick Restoration**: One-click restoration of recently deleted hours
- **Selective Recovery**: Option to recover specific attributes or time periods
- **Historical Recreation**: Ability to recreate similar hours based on historical patterns
- **Emergency Recovery**: Fast-track recovery for business-critical hours
        `
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
        description: 'Hours reference code - unique identifier for the specific hours entry to delete',
        type: 'string',
        example: 'HRS123456',
        schema: {
            pattern: '^HRS[A-Z0-9]{6,}$',
            minLength: 9
        }
    })
    @ApiOkResponse({ 
        description: '✅ Organization hours deleted successfully with comprehensive impact summary',
        schema: {
            type: 'object',
            properties: {
                success: { 
                    type: 'boolean', 
                    example: true,
                    description: 'Indicates successful deletion operation'
                },
                message: { 
                    type: 'string', 
                    example: 'Organization hours deleted successfully',
                    description: 'Human-readable success message'
                },
                deletionDetails: {
                    type: 'object',
                    properties: {
                        deletedHours: {
                            type: 'object',
                            properties: {
                                uid: { type: 'number', example: 1 },
                                day: { type: 'string', example: 'SATURDAY' },
                                openTime: { type: 'string', example: '09:00' },
                                closeTime: { type: 'string', example: '13:00' },
                                hoursRef: { type: 'string', example: 'HRS123456' }
                            },
                            description: 'Details of the deleted hours entry'
                        },
                        deletionTimestamp: {
                            type: 'string',
                            format: 'date-time',
                            example: '2024-01-15T14:30:00.000Z',
                            description: 'Exact timestamp when deletion occurred'
                        },
                        deletedBy: {
                            type: 'object',
                            properties: {
                                uid: { type: 'number', example: 456 },
                                name: { type: 'string', example: 'John Manager' },
                                role: { type: 'string', example: 'ADMIN' }
                            },
                            description: 'User who performed the deletion'
                        }
                    },
                    description: 'Comprehensive details about the deletion operation'
                },
                impactAnalysis: {
                    type: 'object',
                    properties: {
                        affectedOperations: {
                            type: 'number',
                            example: 0,
                            description: 'Number of operations that were affected by this deletion'
                        },
                        staffImpact: {
                            type: 'object',
                            properties: {
                                affectedEmployees: { type: 'number', example: 3 },
                                scheduleAdjustments: { type: 'number', example: 2 },
                                notificationsSent: { type: 'number', example: 5 }
                            },
                            description: 'Analysis of staff impact from hours deletion'
                        },
                        customerImpact: {
                            type: 'object',
                            properties: {
                                affectedCustomers: { type: 'number', example: 0 },
                                serviceDisruptions: { type: 'number', example: 0 },
                                alternativeOptionsProvided: { type: 'boolean', example: true }
                            },
                            description: 'Analysis of customer service impact'
                        }
                    },
                    description: 'Comprehensive impact analysis of the deletion'
                },
                recoveryOptions: {
                    type: 'object',
                    properties: {
                        retentionPeriod: {
                            type: 'string',
                            example: '90 days',
                            description: 'How long the deleted hours can be recovered'
                        },
                        recoveryDeadline: {
                            type: 'string',
                            format: 'date-time',
                            example: '2024-04-15T14:30:00.000Z',
                            description: 'Last possible date for recovery'
                        },
                        recoveryInstructions: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'Contact system administrator within 90 days',
                                'Provide hours reference: HRS123456',
                                'Include business justification for recovery'
                            ],
                            description: 'Step-by-step recovery instructions'
                        }
                    },
                    description: 'Information about recovery options and procedures'
                }
            }
        }
    })
    @ApiNotFoundResponse({ 
        description: '🔍 Hours not found with the provided reference codes',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 404 },
                message: { type: 'string', example: 'Hours not found for deletion' },
                error: { type: 'string', example: 'Not Found' },
                details: {
                    type: 'object',
                    properties: {
                        orgRef: { type: 'string', example: 'ORG123456' },
                        hoursRef: { type: 'string', example: 'HRS123456' },
                        reason: { type: 'string', example: 'Hours entry does not exist or has already been deleted' }
                    }
                },
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Verify the hours reference code is correct',
                        'Check if the hours have already been deleted',
                        'Ensure you have access to this organization',
                        'Use the hours listing endpoint to see available hours'
                    ]
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Forbidden - Insufficient permissions to delete hours',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 403 },
                message: { type: 'string', example: 'You do not have permission to delete organization hours' },
                error: { type: 'string', example: 'Forbidden' },
                reason: { type: 'string', example: 'Only ADMIN and MANAGER roles can delete operating hours' },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['ADMIN', 'MANAGER']
                },
                impactLevel: { type: 'string', example: 'HIGH - Affects operational scheduling' }
            }
        }
    })
    @ApiConflictResponse({
        description: '⚠️ Conflict - Hours cannot be deleted due to active dependencies',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 409 },
                message: { type: 'string', example: 'Cannot delete hours - active dependencies exist' },
                error: { type: 'string', example: 'Conflict' },
                blockingFactors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Active staff scheduled during these hours',
                        'Customer service commitments exist',
                        'Automated systems depend on these hours',
                        'Future appointments scheduled'
                    ]
                },
                resolution: {
                    type: 'object',
                    properties: {
                        requiredActions: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'Reschedule or reassign staff members',
                                'Notify customers of service changes',
                                'Update automated system configurations',
                                'Move or cancel future appointments'
                            ]
                        },
                        estimatedResolutionTime: { 
                            type: 'string', 
                            example: '24-48 hours for dependency resolution'
                        },
                        alternativeActions: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'Mark hours as inactive instead of deleting',
                                'Schedule deletion for future date',
                                'Use administrative override (with approval)'
                            ]
                        }
                    }
                }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Hours deletion failed',
        schema: {
            type: 'object',
            properties: {
                statusCode: { type: 'number', example: 500 },
                message: { type: 'string', example: 'Failed to delete hours due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
                path: { type: 'string', example: '/organisations/ORG123456/hours/HRS123456' },
                errorDetails: {
                    type: 'object',
                    properties: {
                        component: { type: 'string', example: 'Hours Management Service' },
                        operation: { type: 'string', example: 'DELETE_HOURS' },
                        errorCode: { type: 'string', example: 'HMS_DELETE_FAILURE' },
                        retryable: { type: 'boolean', example: true },
                        rollbackStatus: { type: 'string', example: 'COMPLETED' }
                    }
                }
            }
        }
    })
    remove(
        @Param('orgRef') orgRef: string,
        @Param('hoursRef') hoursRef: string,
    ): Promise<void> {
        return this.hoursService.remove(orgRef, hoursRef);
    }
} 