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
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('↗️ Resellers')
@Controller('resellers')
@UseGuards(AuthGuard, RoleGuard)
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
    summary: 'Create a new reseller',
    description: 'Creates a new reseller with the provided details including contact information and address'
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
    summary: 'Get all resellers',
    description: 'Retrieves a list of all resellers'
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
    summary: 'Get a reseller by reference code',
    description: 'Retrieves detailed information about a specific reseller'
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
    summary: 'Update a reseller',
    description: 'Updates an existing reseller with the provided information'
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
    summary: 'Restore a deleted reseller',
    description: 'Restores a previously deleted reseller'
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
    summary: 'Soft delete a reseller',
    description: 'Marks a reseller as deleted without removing it from the database'
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
