import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { ApiOperation, ApiTags, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';

@ApiTags('💰 Claims')
@Controller('claims')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('claims')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) { }

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
    description: 'Creates a new claim with the provided data. Accessible by all authenticated users.'
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
                name: { type: 'string', example: 'John Doe' }
              }
            }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Invalid input data provided' })
  create(@Body() createClaimDto: CreateClaimDto, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
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
    description: 'Retrieves all claims. Accessible by all authenticated users.'
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
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.claimsService.findAll({}, 1, 25, orgId, branchId);
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
                email: { type: 'string', example: 'john.doe@example.com' }
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
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.claimsService.findOne(ref, orgId, branchId);
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
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.claimsService.update(ref, updateClaimDto, orgId, branchId);
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
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.claimsService.restore(ref, orgId, branchId);
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
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.claimsService.claimsByUser(ref, orgId, branchId);
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
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.claimsService.remove(ref, orgId, branchId);
  }
}
