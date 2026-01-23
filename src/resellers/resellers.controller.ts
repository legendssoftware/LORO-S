import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ResellersService } from './resellers.service';
import { CreateResellerDto } from './dto/create-reseller.dto';
import { UpdateResellerDto } from './dto/update-reseller.dto';
import { 
  ApiTags, 
  ApiOperation, 
  ApiParam, 
  ApiBody, 
  ApiOkResponse, 
  ApiCreatedResponse, 
  ApiBadRequestResponse, 
  ApiNotFoundResponse, 
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { RoleGuard } from '../guards/role.guard';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('↗️ Resellers')
@Controller('resellers')
@UseGuards(ClerkAuthGuard, RoleGuard)
@EnterpriseOnly('resellers')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class ResellersController {
  constructor(private readonly resellersService: ResellersService) { }

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
    summary: '➕ Create a new reseller',
    description: createApiDescription(
      'Creates a new reseller with comprehensive contact information and address details.',
      'The service method `ResellersService.create()` processes reseller creation, validates contact information, stores address data, generates reseller references, and returns the created reseller record.',
      'ResellersService',
      'create',
      'creates a reseller record, validates data, and generates references',
      'an object containing the created reseller data and success confirmation',
      ['Data validation', 'Reference generation', 'Address validation']
    ),
  })
  @ApiBody({ type: CreateResellerDto })
  @ApiCreatedResponse({ 
    description: 'Reseller created successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiBadRequestResponse({ 
    description: 'Bad Request - Invalid data provided',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Error creating reseller' }
      }
    }
  })
  create(@Body() createResellerDto: CreateResellerDto) {
    return this.resellersService.create(createResellerDto);
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
    summary: '📋 Get all resellers',
    description: createApiDescription(
      'Retrieves a comprehensive list of all resellers with filtering and pagination capabilities.',
      'The service method `ResellersService.findAll()` processes query parameters, applies organization scoping, handles pagination, and returns a list of reseller records.',
      'ResellersService',
      'findAll',
      'retrieves resellers with filtering, pagination, and organization scoping',
      'a paginated response containing reseller records and metadata',
      ['Filtering', 'Pagination', 'Organization scoping']
    ),
  })
  @ApiOkResponse({
    description: 'List of resellers retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        resellers: {
          type: 'array',
          items: { 
            type: 'object',
            properties: {
              uid: { type: 'number' },
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' }
            }
          }
        },
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  findAll() {
    return this.resellersService.findAll();
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
    summary: '🔍 Get a reseller by reference code',
    description: createApiDescription(
      'Retrieves detailed information about a specific reseller by reference code.',
      'The service method `ResellersService.findOne()` locates the reseller record, validates access permissions, loads related data, and returns the complete reseller information.',
      'ResellersService',
      'findOne',
      'retrieves a reseller record by reference and validates access permissions',
      'an object containing the complete reseller data and related information',
      ['Record retrieval', 'Access validation', 'Related data loading']
    ),
  })
  @ApiParam({ name: 'ref', description: 'Reseller reference code or ID', type: 'number' })
  @ApiOkResponse({ 
    description: 'Reseller details retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        reseller: { 
          type: 'object',
          properties: {
            uid: { type: 'number' },
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' }
          }
        },
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ 
    description: 'Reseller not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Reseller not found' },
        reseller: { type: 'null' }
      }
    }
  })
  findOne(@Param('ref') ref: number) {
    return this.resellersService.findOne(ref);
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
    summary: '✏️ Update a reseller',
    description: createApiDescription(
      'Updates an existing reseller with new information or contact details.',
      'The service method `ResellersService.update()` validates update permissions, processes field updates, validates address changes, and returns the updated reseller record.',
      'ResellersService',
      'update',
      'updates reseller data, validates permissions, and processes field changes',
      'an object containing the updated reseller data and change confirmation',
      ['Permission validation', 'Field updates', 'Address validation']
    ),
  })
  @ApiParam({ name: 'ref', description: 'Reseller reference code or ID', type: 'number' })
  @ApiBody({ type: UpdateResellerDto })
  @ApiOkResponse({ 
    description: 'Reseller updated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ 
    description: 'Reseller not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Reseller not found' }
      }
    }
  })
  @ApiBadRequestResponse({ 
    description: 'Bad Request - Invalid data provided',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Error updating reseller' }
      }
    }
  })
  update(@Param('ref') ref: number, @Body() updateResellerDto: UpdateResellerDto) {
    return this.resellersService.update(ref, updateResellerDto);
  }

  @Patch('restore/:ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
  @ApiOperation({ 
    summary: '♻️ Restore a deleted reseller',
    description: createApiDescription(
      'Restores a previously soft-deleted reseller to active status.',
      'The service method `ResellersService.restore()` validates restore permissions, removes the deleted flag, reactivates the reseller record, and returns restoration confirmation.',
      'ResellersService',
      'restore',
      'restores a soft-deleted reseller and reactivates the record',
      'a confirmation object indicating successful restoration',
      ['Permission validation', 'Record reactivation', 'Status update']
    ),
  })
  @ApiParam({ name: 'ref', description: 'Reseller reference code or ID', type: 'number' })
  @ApiOkResponse({ 
    description: 'Reseller restored successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ 
    description: 'Reseller not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Reseller not found' }
      }
    }
  })
  restore(@Param('ref') ref: number) {
    return this.resellersService.restore(ref);
  }

  @Delete(':ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
  @ApiOperation({ 
    summary: '🗑️ Soft delete a reseller',
    description: createApiDescription(
      'Marks a reseller as deleted using soft delete without removing it from the database.',
      'The service method `ResellersService.remove()` validates deletion permissions, performs soft delete by setting deletion flags, preserves data for recovery, and returns deletion confirmation.',
      'ResellersService',
      'remove',
      'performs soft delete on a reseller with validation and data preservation',
      'a confirmation object indicating successful deletion',
      ['Permission validation', 'Soft delete', 'Data preservation']
    ),
  })
  @ApiParam({ name: 'ref', description: 'Reseller reference code or ID', type: 'number' })
  @ApiOkResponse({ 
    description: 'Reseller deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ 
    description: 'Reseller not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Error deleting reseller' }
      }
    }
  })
  remove(@Param('ref') ref: number) {
    return this.resellersService.remove(ref);
  }
}
