import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, UseInterceptors, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { ApiOperation, ApiTags, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { RoleGuard } from '../guards/role.guard';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { AuthenticatedRequest, getClerkOrgId, getClerkUserId } from '../lib/interfaces/authenticated-request.interface';
import { ClaimStatus } from '../lib/enums/finance.enums';

@ApiTags('🪙 Claims')
@Controller('claims') 
@UseGuards(ClerkAuthGuard, RoleGuard)
@EnterpriseOnly('claims')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class ClaimsController {
  private readonly logger = new Logger(ClaimsController.name);

  constructor(private readonly claimsService: ClaimsService) { }

  /**
   * Safely converts a value to a number
   * @param value - Value to convert (string, number, or undefined)
   * @returns Number or undefined if conversion fails
   */
  private toNumber(value: string | number | undefined): number | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const numValue = Number(value);
    return isNaN(numValue) || !isFinite(numValue) ? undefined : numValue;
  }

  @Post()
 @Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
  @ApiOperation({ 
    summary: 'Create a new claim',
    description: createApiDescription(
      'Creates a new claim with the provided data. Accessible by all authenticated users.',
      'The service method `ClaimsService.create()` processes claim creation, validates data, generates claim reference, handles attachments, and returns the created claim with its reference.',
      'ClaimsService',
      'create',
      'creates a new claim, validates data, generates reference, and handles attachments',
      'an object containing the created claim data, claim reference, and status',
      ['Data validation', 'Reference generation', 'Attachment handling', 'Status management'],
    ),
  })
  @ApiBody({ type: CreateClaimDto })
  @ApiCreatedResponse({ 
    description: 'Claim created successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' },
        claim: {
          type: 'object',
          description: 'The created claim for immediate display or navigation',
          properties: {
            uid: { type: 'number', example: 1 },
            claimRef: { type: 'string', example: 'CLM-2026-000001' },
            amount: { type: 'string', example: 'R 1 250.50', description: 'Formatted currency amount' },
            status: { type: 'string', example: 'PENDING', enum: ['PENDING', 'APPROVED', 'DECLINED', 'PAID'] },
            category: { type: 'string', example: 'GENERAL' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            documentUrl: { type: 'string', nullable: true },
            comments: { type: 'string', nullable: true },
            currency: { type: 'string', example: 'ZAR' },
            owner: {
              type: 'object',
              properties: {
                uid: { type: 'number', example: 1 },
                name: { type: 'string', example: 'John Doe' },
                clerkUserId: { type: 'string', example: 'user_xxx' }
              }
            },
            organisation: { type: 'object', nullable: true },
            branch: { type: 'object', nullable: true }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Invalid input data provided' })
  async create(@Body() createClaimDto: CreateClaimDto, @Req() req: AuthenticatedRequest) {
    const operationId = `POST_CLAIM_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== POST /claims Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}`);
    this.logger.log(`[ClaimsController] [${operationId}] Body: amount=${createClaimDto?.amount}, category=${createClaimDto?.category}, clerkUserId=${getClerkUserId(req)}`);
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    if (!clerkUserId) {
      throw new UnauthorizedException('User authentication required');
    }
    try {
      const result = await this.claimsService.create(createClaimDto, orgId, branchId, clerkUserId);
      this.logger.log(`[ClaimsController] [${operationId}] ✅ POST /claims Request completed. claimId=${result?.claim?.uid}`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ POST /claims Request failed: ${error?.message}`);
      throw error;
    }
  }

  @Get()
 @Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
  @ApiOperation({ 
    summary: 'Get all claims',
    description: 'Retrieves all claims with role-based filtering. Admins/managers see all claims; regular users see only their own.'
  })
  @ApiOkResponse({ 
    description: 'List of all claims',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              uid: { type: 'number', example: 1 },
              title: { type: 'string', example: 'Expense Reimbursement' },
              description: { type: 'string', example: 'Claim for business travel expenses' },
              amount: { type: 'number', example: 1250.50 },
              status: { type: 'string', example: 'PENDING' },
              claimRef: { type: 'string', example: 'CLM123456' },
              attachments: { 
                type: 'array', 
                items: { 
                  type: 'string', 
                  example: 'https://example.com/receipt.pdf' 
                } 
              },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              isDeleted: { type: 'boolean', example: false }
            }
          }
        },
        message: { type: 'string', example: 'Success' },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 10 }
          }
        }
      }
    }
  })
  @Get('report')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300)
  @Roles(
    AccessLevel.ADMIN,
    AccessLevel.MANAGER,
    AccessLevel.OWNER,
    AccessLevel.USER,
    AccessLevel.MEMBER,
    AccessLevel.TECHNICIAN,
  )
  @ApiOperation({
    summary: 'Get claims report (server-generated)',
    description: 'Returns aggregated report data (total, byStatus, byDay) for the date range. Cached 5 min. Use for reports hub charts.',
  })
  @ApiQuery({ name: 'from', required: true, type: String, description: 'Start date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'to', required: true, type: String, description: 'End date (YYYY-MM-DD)' })
  @ApiOkResponse({
    description: 'Report payload with total, byStatus, byDay, meta',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number' },
        byStatus: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'number' } } } },
        byDay: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, count: { type: 'number' } } } },
        meta: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      },
    },
  })
  async getReport(
    @Req() req: AuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const orgId = getClerkOrgId(req);
    if (!orgId) throw new BadRequestException('Organization context required');
    if (!from || !to) throw new BadRequestException('Query params from and to (YYYY-MM-DD) required');
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    if (!clerkUserId && !userAccessLevel) throw new UnauthorizedException('User authentication required');
    return this.claimsService.getReport(from, to, orgId, branchId, clerkUserId, userAccessLevel);
  }

  @ApiQuery({ name: 'createdFrom', required: false, type: String, description: 'Filter by creation date from (ISO date)' })
  @ApiQuery({ name: 'createdTo', required: false, type: String, description: 'Filter by creation date to (ISO date)' })
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string | number,
    @Query('limit') limit?: string | number,
    @Query('status') status?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
  ) {
    const operationId = `GET_CLAIMS_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== GET /claims Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}`);
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;

    if (!clerkUserId && !userAccessLevel) {
      throw new UnauthorizedException('User authentication required');
    }

    const pageNum = this.toNumber(page) ?? 1;
    const limitNum = this.toNumber(limit) ?? 25;
    const filters: { status?: ClaimStatus; startDate?: Date; endDate?: Date } = status ? { status: status as ClaimStatus } : {};
    if (createdFrom) filters.startDate = new Date(createdFrom);
    if (createdTo) filters.endDate = new Date(createdTo);
    this.logger.log(`[ClaimsController] [${operationId}] Query: page=${pageNum}, limit=${limitNum}, status=${status}, createdFrom=${createdFrom ?? 'n/a'}, createdTo=${createdTo ?? 'n/a'}, orgId=${orgId}`);

    try {
      const result = await this.claimsService.findAll(
        filters,
        pageNum,
        limitNum,
        orgId,
        branchId,
        clerkUserId,
        userAccessLevel,
      );
      this.logger.log(`[ClaimsController] [${operationId}] ✅ GET /claims Request completed. Total: ${result?.meta?.total ?? 0}`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ GET /claims Request failed: ${error?.message}`);
      throw error;
    }
  }

  @Get('me')
  @Roles(
    AccessLevel.ADMIN,
    AccessLevel.MANAGER,
    AccessLevel.SUPPORT,
    AccessLevel.DEVELOPER,
    AccessLevel.USER,
    AccessLevel.MEMBER,
    AccessLevel.OWNER,
    AccessLevel.TECHNICIAN,
  )
  @ApiOperation({
    summary: 'Get current user\'s claims',
    description: 'Retrieves all claims for the authenticated user (identity from token). No ref in URL.',
  })
  @ApiOkResponse({
    description: 'List of claims for the current user',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' },
        claims: { type: 'array', items: { type: 'object' } },
        stats: { type: 'object' },
      },
    },
  })
  async claimsMe(@Req() req: AuthenticatedRequest) {
    const operationId = `GET_CLAIMS_ME_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== GET /claims/me Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}`);
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    if (!clerkUserId) {
      throw new UnauthorizedException('User authentication required');
    }
    try {
      const result = await this.claimsService.claimsByUser(clerkUserId, orgId, branchId, clerkUserId, userAccessLevel);
      this.logger.log(`[ClaimsController] [${operationId}] ✅ GET /claims/me Request completed. Count: ${result?.claims?.length ?? 0}`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ GET /claims/me Request failed: ${error?.message}`);
      throw error;
    }
  }

  @Get(':ref')
 @Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
  @ApiOperation({ 
    summary: 'Get a claim by reference code',
    description: 'Retrieves a specific claim by its reference code. Accessible by all authenticated users.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Claim reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Claim found',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            uid: { type: 'number', example: 1 },
            title: { type: 'string', example: 'Expense Reimbursement' },
            description: { type: 'string', example: 'Claim for business travel expenses' },
            amount: { type: 'number', example: 1250.50 },
            status: { type: 'string', example: 'PENDING' },
            claimRef: { type: 'string', example: 'CLM123456' },
            attachments: { 
              type: 'array', 
              items: { 
                type: 'string', 
                example: 'https://example.com/receipt.pdf' 
              } 
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            isDeleted: { type: 'boolean', example: false },
            owner: {
              type: 'object',
              properties: {
                uid: { type: 'number', example: 1 },
                name: { type: 'string', example: 'John Doe' },
                email: { type: 'string', example: 'john.doe@example.com' },
                photoURL: { type: 'string', example: 'https://example.com/photo.jpg', nullable: true }
              }
            }
          }
        },
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Claim not found' })
  async findOne(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
    const operationId = `GET_CLAIM_${ref}_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== GET /claims/:ref Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}, ref=${ref}`);
    const refNum = this.toNumber(ref);
    if (refNum == null || refNum < 1 || !Number.isInteger(refNum)) {
      this.logger.warn(`[ClaimsController] [${operationId}] Invalid ref: ${ref}`);
      throw new BadRequestException('Claim reference must be a positive integer');
    }
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    try {
      const result = await this.claimsService.findOne(refNum, orgId, branchId, clerkUserId, userAccessLevel);
      this.logger.log(`[ClaimsController] [${operationId}] ✅ GET /claims/:ref Request completed, claimFound=${!!result?.claim}`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ GET /claims/:ref Request failed: ${error?.message}`);
      throw error;
    }
  }

  @Patch(':ref')
 @Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
  @ApiOperation({ 
    summary: 'Update a claim',
    description: 'Updates a specific claim by its reference code. Accessible by all authenticated users.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Claim reference code',
    type: 'number',
    example: 1
  })
  @ApiBody({ type: UpdateClaimDto })
  @ApiOkResponse({ 
    description: 'Claim updated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Claim not found' })
  @ApiBadRequestResponse({ description: 'Invalid input data provided' })
  async update(@Param('ref') ref: number, @Body() updateClaimDto: UpdateClaimDto, @Req() req: AuthenticatedRequest) {
    const operationId = `PATCH_CLAIM_${ref}_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== PATCH /claims/:ref Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}, ref=${ref}, status=${updateClaimDto?.status}`);
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    try {
      const result = await this.claimsService.update(ref, updateClaimDto, orgId, branchId, clerkUserId, userAccessLevel);
      this.logger.log(`[ClaimsController] [${operationId}] ✅ PATCH /claims/:ref Request completed`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ PATCH /claims/:ref Request failed: ${error?.message}`);
      throw error;
    }
  }

  @Patch('restore/:ref')
 @Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
  @ApiOperation({ 
    summary: 'Restore a deleted claim',
    description: 'Restores a previously deleted claim. Accessible by all authenticated users.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Claim reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Claim restored successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Claim not found' })
  async restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const operationId = `PATCH_RESTORE_${ref}_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== PATCH /claims/restore/:ref Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}, ref=${ref}`);
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;

    if (!clerkUserId) {
      throw new UnauthorizedException('User authentication required');
    }

    try {
      const result = await this.claimsService.restore(ref, orgId, branchId, clerkUserId, userAccessLevel);
      this.logger.log(`[ClaimsController] [${operationId}] ✅ PATCH /claims/restore/:ref Request completed`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ PATCH /claims/restore/:ref Request failed: ${error?.message}`);
      throw error;
    }
  }

  @Get('for/:ref')
 @Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
  @ApiOperation({ 
    summary: 'Get claims by user reference code',
    description: 'Retrieves all claims associated with a specific user. Accessible by all authenticated users.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'User reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'List of claims for the specified user',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              uid: { type: 'number', example: 1 },
              title: { type: 'string', example: 'Expense Reimbursement' },
              description: { type: 'string', example: 'Claim for business travel expenses' },
              amount: { type: 'number', example: 1250.50 },
              status: { type: 'string', example: 'PENDING' },
              claimRef: { type: 'string', example: 'CLM123456' },
              attachments: { 
                type: 'array', 
                items: { 
                  type: 'string', 
                  example: 'https://example.com/receipt.pdf' 
                } 
              },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              isDeleted: { type: 'boolean', example: false }
            }
          }
        },
        message: { type: 'string', example: 'Success' },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 5 }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'User not found or has no claims' })
  async claimsByUser(@Param('ref') ref: string, @Req() req: AuthenticatedRequest) {
    const operationId = `GET_CLAIMS_FOR_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== GET /claims/for/:ref Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}, ref=${ref}`);
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    if (!clerkUserId) {
      throw new UnauthorizedException('User authentication required');
    }
    try {
      const result = await this.claimsService.claimsByUser(clerkUserId, orgId, branchId, clerkUserId, userAccessLevel);
      this.logger.log(`[ClaimsController] [${operationId}] ✅ GET /claims/for/:ref Request completed. Count: ${result?.claims?.length ?? 0}`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ GET /claims/for/:ref Request failed: ${error?.message}`);
      throw error;
    }
  }

  @Get('share/:token')
  @ApiOperation({ 
    summary: 'Get claim by share token (public access)',
    description: 'Retrieves a claim using a public share token. No authentication required.'
  })
  @ApiParam({ 
    name: 'token', 
    description: 'Share token for public access',
    type: 'string',
    example: 'abc123def456...'
  })
  @ApiOkResponse({ 
    description: 'Claim found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' },
        claim: { type: 'object' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Claim not found or token expired' })
  getByShareToken(@Param('token') token: string) {
    return this.claimsService.findByShareToken(token);
  }

  @Post(':ref/generate-share-token')
 @Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
  @ApiOperation({ 
    summary: 'Generate or regenerate share token for claim',
    description: 'Creates a new share token for public access to a claim.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Claim UID (not reference code)',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Share token generated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' },
        shareToken: { type: 'string' },
        shareLink: { type: 'string' }
      }
    }
  })
  async generateShareToken(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const operationId = `POST_SHARE_TOKEN_${ref}_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== POST /claims/:ref/generate-share-token Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}, ref=${ref}`);
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    try {
      const result = await this.claimsService.generateShareToken(ref, orgId, branchId, clerkUserId, userAccessLevel);
      this.logger.log(`[ClaimsController] [${operationId}] ✅ POST /claims/:ref/generate-share-token Request completed`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ POST /claims/:ref/generate-share-token Request failed: ${error?.message}`);
      throw error;
    }
  }

  @Delete(':ref')
 @Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
  @ApiOperation({ 
    summary: 'Soft delete a claim',
    description: 'Performs a soft delete on a claim. Accessible by all authenticated users.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Claim reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Claim deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Claim not found' })
  async remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const operationId = `DELETE_CLAIM_${ref}_${Date.now()}`;
    this.logger.log(`[ClaimsController] [${operationId}] ========== DELETE /claims/:ref Request Started ==========`);
    this.logger.log(`[ClaimsController] [${operationId}] Request URL: ${req.url}, Method: ${req.method}, ref=${ref}`);
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    try {
      const result = await this.claimsService.remove(ref, orgId, branchId, clerkUserId, userAccessLevel);
      this.logger.log(`[ClaimsController] [${operationId}] ✅ DELETE /claims/:ref Request completed`);
      return result;
    } catch (error) {
      this.logger.error(`[ClaimsController] [${operationId}] ❌ DELETE /claims/:ref Request failed: ${error?.message}`);
      throw error;
    }
  }
}
