import { Controller, Get, Post, Body, Patch, Param, UseGuards, UseFilters } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { LicensingService } from './licensing.service';
import { LicenseUsageService } from './license-usage.service';
import { CreateLicenseDto } from './dto/create-license.dto';
import { UpdateLicenseDto } from './dto/update-license.dto';
import { License } from './entities/license.entity';
import { ConsolidatedLicenseUsageDto } from './dto/consolidated-license-usage.dto';
import { LicenseExceptionFilter } from './lib/filters/license-exception.filter';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { isPublic } from '../decorators/public.decorator';
import { getDynamicDate, getDynamicDateTime, getFutureDate, createApiDescription } from '../lib/utils/swagger-helpers';

@ApiTags('📋 Licensing')
@Controller('licensing')
// @UseGuards(ClerkAuthGuard, RoleGuard, LicenseRateLimitGuard)
@UseFilters(LicenseExceptionFilter)
export class LicensingController {
    constructor(
        private readonly licensingService: LicensingService,
        private readonly licenseUsageService: LicenseUsageService
    ) { }

    @Post()
    @isPublic()
    // @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER)
    @ApiOperation({
        summary: '➕ Create a new license',
        description: createApiDescription(
            'Creates a new license with comprehensive configuration including subscription plan, billing cycle, feature sets, and usage limits.',
            'The service method `LicensingService.create()` generates a unique license key, validates organization reference, sets license status, configures features based on plan, and returns the created license entity.',
            'LicensingService',
            'create',
            'creates a new license, generates license key, validates organization, and configures plan features',
            'a License entity with generated license key and configured features',
            ['License key generation', 'Organization validation', 'Feature configuration', 'Plan setup']
        ),
    })
    @ApiBody({
        type: CreateLicenseDto,
        description: 'License creation payload with organization reference, plan, and configuration',
        examples: {
            starterPlan: {
                summary: '🚀 Starter Plan License',
                description: 'Basic license for small organizations',
                value: {
                    organisationRef: 12345,
                    plan: 'STARTER',
                    type: 'SUBSCRIPTION',
                    billingCycle: 'MONTHLY',
                    maxUsers: 10,
                    maxBranches: 2,
                    storageLimit: 10,
                    apiCallLimit: 10000,
                    integrationLimit: 3,
                    validUntil: getFutureDate(30),
                }
            },
            enterprisePlan: {
                summary: '🏢 Enterprise Plan License',
                description: 'Comprehensive license for large organizations',
                value: {
                    organisationRef: 12345,
                    plan: 'ENTERPRISE',
                    type: 'SUBSCRIPTION',
                    billingCycle: 'ANNUAL',
                    maxUsers: 1000,
                    maxBranches: 100,
                    storageLimit: 1000,
                    apiCallLimit: 1000000,
                    integrationLimit: 50,
                    validUntil: getFutureDate(365),
                }
            },
            perpetualLicense: {
                summary: '♾️ Perpetual License',
                description: 'One-time purchase license without expiration',
                value: {
                    organisationRef: 12345,
                    plan: 'PROFESSIONAL',
                    type: 'PERPETUAL',
                    maxUsers: 50,
                    maxBranches: 10,
                    storageLimit: 100,
                    apiCallLimit: 100000,
                    integrationLimit: 10,
                }
            }
        }
    })
    @ApiCreatedResponse({
        description: '✅ License created successfully',
        type: License,
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                licenseKey: { type: 'string', example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6' },
                type: { type: 'string', example: 'SUBSCRIPTION' },
                plan: { type: 'string', example: 'STARTER' },
                status: { type: 'string', example: 'ACTIVE' },
                billingCycle: { type: 'string', example: 'MONTHLY' },
                validUntil: { type: 'string', format: 'date-time', example: getFutureDate(30) },
                maxUsers: { type: 'number', example: 10 },
                maxBranches: { type: 'number', example: 2 },
                createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
            }
        }
    })
    @ApiBadRequestResponse({
        description: '❌ Bad Request - Invalid input data',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Invalid license creation data' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 }
            }
        }
    })
    @ApiUnauthorizedResponse({
        description: '🔒 Unauthorized - Authentication required',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Unauthorized' },
                statusCode: { type: 'number', example: 401 }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Forbidden - Insufficient permissions',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 }
            }
        }
    })
    @ApiTooManyRequestsResponse({
        description: '⏱️ Too Many Requests - Rate limit exceeded',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Too Many Requests' },
                statusCode: { type: 'number', example: 429 },
                retryAfter: { type: 'number', example: 60 }
            }
        }
    })
    create(@Body() createLicenseDto: CreateLicenseDto): Promise<License> {
        return this.licensingService.create(createLicenseDto);
    }

    @Get()
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER, AccessLevel.SUPPORT)
    @ApiOperation({
        summary: '📋 Get all licenses',
        description: createApiDescription(
            'Retrieves all licenses in the system with complete license information including status, plans, and usage limits.',
            'The service method `LicensingService.findAll()` queries all licenses from the database and returns them with full details.',
            'LicensingService',
            'findAll',
            'retrieves all licenses from the database',
            'an array of License entities',
            ['Database query', 'License retrieval']
        ),
    })
    @ApiOkResponse({
        description: '✅ Returns all licenses',
        type: [License],
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    uid: { type: 'number', example: 12345 },
                    licenseKey: { type: 'string', example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6' },
                    type: { type: 'string', example: 'SUBSCRIPTION' },
                    plan: { type: 'string', example: 'STARTER' },
                    status: { type: 'string', example: 'ACTIVE' },
                    validUntil: { type: 'string', format: 'date-time', example: getFutureDate(30) },
                    organisationRef: { type: 'number', example: 12345 }
                }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    findAll(): Promise<License[]> {
        return this.licensingService.findAll();
    }

    @Get(':ref')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER, AccessLevel.SUPPORT)
    @ApiOperation({
        summary: '🔍 Get license by reference',
        description: createApiDescription(
            'Retrieves detailed information about a specific license by its reference ID or license key.',
            'The service method `LicensingService.findOne()` queries the database for the license by reference, validates existence, and returns complete license details.',
            'LicensingService',
            'findOne',
            'retrieves a license by reference ID or key',
            'a License entity with complete details',
            ['License lookup', 'Reference validation']
        ),
    })
    @ApiParam({
        name: 'ref',
        description: 'License reference ID or license key',
        type: String,
        example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6'
    })
    @ApiOkResponse({
        description: '✅ Returns the license',
        type: License,
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                licenseKey: { type: 'string', example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6' },
                type: { type: 'string', example: 'SUBSCRIPTION' },
                plan: { type: 'string', example: 'STARTER' },
                status: { type: 'string', example: 'ACTIVE' },
                billingCycle: { type: 'string', example: 'MONTHLY' },
                validUntil: { type: 'string', format: 'date-time', example: getFutureDate(30) },
                lastValidated: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
                maxUsers: { type: 'number', example: 10 },
                maxBranches: { type: 'number', example: 2 },
                features: { type: 'object', example: {} }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ License not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'License not found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    findOne(@Param('ref') ref: string): Promise<License> {
        return this.licensingService.findOne(ref);
    }

    @Get('organisation/:ref')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER, AccessLevel.SUPPORT, AccessLevel.MANAGER)
    @ApiOperation({
        summary: '🏢 Get licenses by organisation reference',
        description: createApiDescription(
            'Retrieves all licenses associated with a specific organization by organization reference ID.',
            'The service method `LicensingService.findByOrganisation()` queries licenses filtered by organization reference and returns all associated licenses.',
            'LicensingService',
            'findByOrganisation',
            'retrieves all licenses for a specific organization',
            'an array of License entities for the organization',
            ['Organization filtering', 'License lookup']
        ),
    })
    @ApiParam({
        name: 'ref',
        description: 'Organization reference ID',
        type: String,
        example: '12345'
    })
    @ApiOkResponse({
        description: '✅ Returns organisation licenses',
        type: [License]
    })
    @ApiNotFoundResponse({
        description: '❌ Organisation not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Organisation not found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    findByOrganisation(@Param('ref') ref: string): Promise<License[]> {
        return this.licensingService.findByOrganisation(ref);
    }

    @Patch(':ref')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER)
    @ApiOperation({
        summary: '✏️ Update license',
        description: createApiDescription(
            'Updates an existing license with new configuration including plan changes, usage limits, feature sets, and expiration dates.',
            'The service method `LicensingService.update()` validates the license exists, applies updates, handles plan changes, updates features, and returns the updated license.',
            'LicensingService',
            'update',
            'updates license configuration, handles plan changes, and updates features',
            'the updated License entity',
            ['License validation', 'Plan updates', 'Feature configuration', 'Usage limit updates']
        ),
    })
    @ApiParam({
        name: 'ref',
        description: 'License reference ID or license key',
        type: String,
        example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6'
    })
    @ApiBody({
        type: UpdateLicenseDto,
        description: 'License update payload with fields to modify',
        examples: {
            upgradePlan: {
                summary: '⬆️ Upgrade Plan',
                description: 'Upgrade license to higher plan',
                value: {
                    plan: 'PROFESSIONAL',
                    maxUsers: 50,
                    maxBranches: 10,
                    storageLimit: 100
                }
            },
            extendValidity: {
                summary: '📅 Extend Validity',
                description: 'Extend license expiration date',
                value: {
                    validUntil: getFutureDate(365)
                }
            },
            updateLimits: {
                summary: '📊 Update Usage Limits',
                description: 'Modify usage limits for license',
                value: {
                    maxUsers: 25,
                    apiCallLimit: 50000,
                    integrationLimit: 5
                }
            }
        }
    })
    @ApiOkResponse({
        description: '✅ License updated successfully',
        type: License
    })
    @ApiBadRequestResponse({
        description: '❌ Bad Request - Invalid input data',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Invalid license update data' },
                statusCode: { type: 'number', example: 400 }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ License not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'License not found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    update(@Param('ref') ref: string, @Body() updateLicenseDto: UpdateLicenseDto): Promise<License> {
        return this.licensingService.update(ref, updateLicenseDto);
    }

    @Post(':ref/validate')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER, AccessLevel.SUPPORT)
    @ApiOperation({
        summary: '✅ Validate license',
        description: createApiDescription(
            'Validates a license by checking its status, expiration date, grace period, and active state. Uses caching for performance optimization.',
            'The service method `LicensingService.validateLicense()` checks cache first, validates license status, checks expiration and grace period, updates last validated timestamp, caches result, and returns validation boolean.',
            'LicensingService',
            'validateLicense',
            'validates license status, checks expiration, handles grace period, and caches results',
            'a boolean indicating if the license is valid',
            ['Status validation', 'Expiration checking', 'Grace period handling', 'Caching']
        ),
    })
    @ApiParam({
        name: 'ref',
        description: 'License reference ID or license key',
        type: String,
        example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6'
    })
    @ApiOkResponse({
        description: '✅ Returns license validation status',
        schema: {
            type: 'object',
            properties: {
                valid: { type: 'boolean', example: true },
                status: { type: 'string', example: 'ACTIVE' },
                validUntil: { type: 'string', format: 'date-time', example: getFutureDate(30) },
                lastValidated: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ License not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'License not found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    validate(@Param('ref') ref: string): Promise<boolean> {
        return this.licensingService.validateLicense(ref);
    }

    @Post(':ref/renew')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER)
    @ApiOperation({
        summary: '🔄 Renew license',
        description: createApiDescription(
            'Renews an existing license by extending its validity period based on the billing cycle. Updates expiration date and resets license status.',
            'The service method `LicensingService.renewLicense()` validates license exists, calculates new expiration date based on billing cycle, updates validUntil date, resets status to ACTIVE, clears grace period, and returns renewed license.',
            'LicensingService',
            'renewLicense',
            'extends license validity, updates expiration date, and resets status',
            'the renewed License entity with updated expiration',
            ['Expiration extension', 'Status reset', 'Billing cycle calculation']
        ),
    })
    @ApiParam({
        name: 'ref',
        description: 'License reference ID or license key',
        type: String,
        example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6'
    })
    @ApiOkResponse({
        description: '✅ License renewed successfully',
        type: License,
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                status: { type: 'string', example: 'ACTIVE' },
                validUntil: { type: 'string', format: 'date-time', example: getFutureDate(30) },
                billingCycle: { type: 'string', example: 'MONTHLY' }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ License not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'License not found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    renew(@Param('ref') ref: string): Promise<License> {
        return this.licensingService.renewLicense(ref);
    }

    @Post(':ref/suspend')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER)
    @ApiOperation({
        summary: '⏸️ Suspend license',
        description: createApiDescription(
            'Suspends a license, preventing its use while maintaining the license data. Suspended licenses cannot be validated or used.',
            'The service method `LicensingService.suspendLicense()` validates license exists, sets status to SUSPENDED, prevents validation, and returns suspended license.',
            'LicensingService',
            'suspendLicense',
            'suspends license by setting status to SUSPENDED',
            'the suspended License entity',
            ['Status update', 'License suspension']
        ),
    })
    @ApiParam({
        name: 'ref',
        description: 'License reference ID or license key',
        type: String,
        example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6'
    })
    @ApiOkResponse({
        description: '✅ License suspended successfully',
        type: License,
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                status: { type: 'string', example: 'SUSPENDED' },
                licenseKey: { type: 'string', example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6' }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ License not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'License not found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    suspend(@Param('ref') ref: string): Promise<License> {
        return this.licensingService.suspendLicense(ref);
    }

    @Post(':ref/activate')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER)
    @ApiOperation({
        summary: '▶️ Activate license',
        description: createApiDescription(
            'Activates a suspended or inactive license, making it available for use and validation.',
            'The service method `LicensingService.activateLicense()` validates license exists, sets status to ACTIVE, enables validation, and returns activated license.',
            'LicensingService',
            'activateLicense',
            'activates license by setting status to ACTIVE',
            'the activated License entity',
            ['Status update', 'License activation']
        ),
    })
    @ApiParam({
        name: 'ref',
        description: 'License reference ID or license key',
        type: String,
        example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6'
    })
    @ApiOkResponse({
        description: '✅ License activated successfully',
        type: License,
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                status: { type: 'string', example: 'ACTIVE' },
                licenseKey: { type: 'string', example: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6' }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ License not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'License not found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    activate(@Param('ref') ref: string): Promise<License> {
        return this.licensingService.activateLicense(ref);
    }

    @Get('usage/consolidated/:licenseId')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER, AccessLevel.SUPPORT, AccessLevel.MANAGER)
    @ApiOperation({
        summary: '📊 Get consolidated usage metrics for a specific license',
        description: createApiDescription(
            'Retrieves comprehensive usage metrics for a specific license including API calls, user counts, storage usage, and feature utilization.',
            'The service method `LicenseUsageService.getConsolidatedLicenseUsage()` aggregates usage data, calculates metrics, compares against limits, and returns consolidated usage report.',
            'LicenseUsageService',
            'getConsolidatedLicenseUsage',
            'aggregates usage metrics, calculates statistics, and compares against limits',
            'a ConsolidatedLicenseUsageDto with comprehensive usage metrics',
            ['Usage aggregation', 'Metric calculation', 'Limit comparison']
        ),
    })
    @ApiParam({
        name: 'licenseId',
        description: 'License ID or reference',
        type: String,
        example: '12345'
    })
    @ApiOkResponse({
        description: '✅ Returns consolidated usage metrics',
        type: ConsolidatedLicenseUsageDto
    })
    @ApiNotFoundResponse({
        description: '❌ License not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'License not found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    getConsolidatedUsage(@Param('licenseId') licenseId: string): Promise<ConsolidatedLicenseUsageDto> {
        return this.licenseUsageService.getConsolidatedLicenseUsage(licenseId);
    }

    @Get('usage/consolidated')
    @Roles(AccessLevel.ADMIN, AccessLevel.DEVELOPER, AccessLevel.SUPPORT)
    @ApiOperation({
        summary: '📊 Get consolidated usage metrics for all licenses',
        description: createApiDescription(
            'Retrieves comprehensive usage metrics for all licenses in the system, providing organization-wide usage analytics.',
            'The service method `LicenseUsageService.getAllConsolidatedLicenseUsage()` aggregates usage data for all licenses, calculates system-wide metrics, and returns consolidated usage reports.',
            'LicenseUsageService',
            'getAllConsolidatedLicenseUsage',
            'aggregates usage metrics for all licenses and calculates system-wide statistics',
            'a record mapping license IDs to ConsolidatedLicenseUsageDto objects',
            ['System-wide aggregation', 'Usage analytics', 'Multi-license metrics']
        ),
    })
    @ApiOkResponse({
        description: '✅ Returns consolidated usage metrics for all licenses',
        type: Object,
        schema: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                properties: {
                    licenseId: { type: 'string', example: '12345' },
                    totalApiCalls: { type: 'number', example: 50000 },
                    totalUsers: { type: 'number', example: 45 },
                    storageUsed: { type: 'number', example: 75 }
                }
            }
        }
    })
    @ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
    @ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
    @ApiTooManyRequestsResponse({ description: '⏱️ Too Many Requests - Rate limit exceeded' })
    getAllConsolidatedUsage(): Promise<Record<string, ConsolidatedLicenseUsageDto>> {
        return this.licenseUsageService.getAllConsolidatedLicenseUsage();
    }
} 