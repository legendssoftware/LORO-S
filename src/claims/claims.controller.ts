import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { ApiOperation, ApiTags, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { RoleGuard } from '../guards/role.guard';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { AuthenticatedRequest, getClerkOrgId } from '../lib/interfaces/authenticated-request.interface';

@ApiTags('🪙 Claims')
@Controller('claims') 
@UseGuards(ClerkAuthGuard, RoleGuard)
@EnterpriseOnly('claims')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class ClaimsController {
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
                avatar: { type: 'string', example: 'https://example.com/avatar.jpg', nullable: true }
              }
            }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Invalid input data provided' })
  create(@Body() createClaimDto: CreateClaimDto, @Req() req: AuthenticatedRequest) {
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const userId = req.user?.uid;
    
    if (!userId) {
      throw new UnauthorizedException('User authentication required');
    }
    
    // Override owner with authenticated user ID for security
    createClaimDto.owner = userId;
    
    return this.claimsService.create(createClaimDto, orgId, branchId);
  }

  @Get()
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
  findAll(@Req() req: AuthenticatedRequest) {
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const userId = req.user?.uid;
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    
    if (!userId && !userAccessLevel) {
      throw new UnauthorizedException('User authentication required');
    }
    
    return this.claimsService.findAll({}, 1, 25, orgId, branchId, userId, userAccessLevel);
  }

  @Get(':ref')
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
  findOne(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const userId = req.user?.uid;
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    return this.claimsService.findOne(ref, orgId, branchId, userId, userAccessLevel);
  }

  @Patch(':ref')
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
  update(@Param('ref') ref: number, @Body() updateClaimDto: UpdateClaimDto, @Req() req: AuthenticatedRequest) {
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const userId = req.user?.uid;
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    return this.claimsService.update(ref, updateClaimDto, orgId, branchId, userId, userAccessLevel);
  }

  @Patch('restore/:ref')
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
  restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const userId = req.user?.uid;
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    
    if (!userId) {
      throw new UnauthorizedException('User authentication required');
    }
    
    return this.claimsService.restore(ref, orgId, branchId, userId, userAccessLevel);
  }

  @Get('for/:ref')
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
  claimsByUser(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const requestingUserId = req.user?.uid;
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    return this.claimsService.claimsByUser(ref, orgId, branchId, requestingUserId, userAccessLevel);
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
  generateShareToken(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const userId = req.user?.uid;
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    return this.claimsService.generateShareToken(ref, orgId, branchId, userId, userAccessLevel);
  }

  @Delete(':ref')
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
  remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const userId = req.user?.uid;
    const userAccessLevel = req.user?.accessLevel || req.user?.role;
    return this.claimsService.remove(ref, orgId, branchId, userId, userAccessLevel);
  }
}
