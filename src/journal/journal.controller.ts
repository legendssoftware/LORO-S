import { JournalService } from './journal.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { ApiOperation, ApiTags, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { AuthGuard } from '../guards/auth.guard';
import { Controller, Get, Post, Body, Param, UseGuards, Patch, Delete, Req } from '@nestjs/common';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';

@ApiTags('📝 Journal')
@Controller('journal')
@UseGuards(AuthGuard, RoleGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class JournalController {
  constructor(private readonly journalService: JournalService) { }

  @Post()
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Create a new journal entry',
    description: 'Creates a new journal entry with the provided data. Requires ADMIN, MANAGER, or SUPPORT role.'
  })
  @ApiBody({ type: CreateJournalDto })
  @ApiCreatedResponse({ 
    description: 'Journal entry created successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Invalid input data provided' })
  create(@Body() createJournalDto: CreateJournalDto, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.create(createJournalDto, orgId, branchId);
  }

  @Get()
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Get all journal entries',
    description: 'Retrieves all journal entries. Requires ADMIN, MANAGER, or SUPPORT role.'
  })
  @ApiOkResponse({ 
    description: 'List of all journal entries',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              uid: { type: 'number', example: 1 },
              clientRef: { type: 'string', example: 'CLT123456' },
              fileURL: { type: 'string', example: 'https://storage.example.com/journals/file123.pdf' },
              comments: { type: 'string', example: 'This is a comment' },
              timestamp: { type: 'string', format: 'date-time' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              isDeleted: { type: 'boolean', example: false },
              owner: { 
                type: 'object',
                properties: {
                  uid: { type: 'number', example: 1 }
                }
              },
              branch: { 
                type: 'object',
                properties: {
                  uid: { type: 'number', example: 1 }
                }
              }
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
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.findAll({}, 1, 25, orgId, branchId);
  }

  @Get(':ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Get a journal entry by reference code',
    description: 'Retrieves a specific journal entry by its reference code. Requires ADMIN, MANAGER, or SUPPORT role.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Journal reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Journal entry found',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            uid: { type: 'number', example: 1 },
            clientRef: { type: 'string', example: 'CLT123456' },
            fileURL: { type: 'string', example: 'https://storage.example.com/journals/file123.pdf' },
            comments: { type: 'string', example: 'This is a comment' },
            timestamp: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            isDeleted: { type: 'boolean', example: false },
            owner: { 
              type: 'object',
              properties: {
                uid: { type: 'number', example: 1 }
              }
            },
            branch: { 
              type: 'object',
              properties: {
                uid: { type: 'number', example: 1 }
              }
            }
          }
        },
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Journal entry not found' })
  findOne(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.findOne(ref, orgId, branchId);
  }

  @Get('for/:ref')
  @UseGuards(AuthGuard, RoleGuard)
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
    summary: 'Get journals by user reference code',
    description: 'Retrieves all journal entries associated with a specific user. Accessible by all authenticated users.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'User reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'List of journal entries for the specified user',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              uid: { type: 'number', example: 1 },
              clientRef: { type: 'string', example: 'CLT123456' },
              fileURL: { type: 'string', example: 'https://storage.example.com/journals/file123.pdf' },
              comments: { type: 'string', example: 'This is a comment' },
              timestamp: { type: 'string', format: 'date-time' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              isDeleted: { type: 'boolean', example: false },
              owner: { 
                type: 'object',
                properties: {
                  uid: { type: 'number', example: 1 }
                }
              },
              branch: { 
                type: 'object',
                properties: {
                  uid: { type: 'number', example: 1 }
                }
              }
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
  @ApiNotFoundResponse({ description: 'User not found or has no journal entries' })
  journalsByUser(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.journalsByUser(ref, orgId, branchId);
  }

  @Patch(':ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Update a journal entry by reference code',
    description: 'Updates a specific journal entry by its reference code. Requires ADMIN, MANAGER, or SUPPORT role.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Journal reference code',
    type: 'number',
    example: 1
  })
  @ApiBody({ type: UpdateJournalDto })
  @ApiOkResponse({ 
    description: 'Journal entry updated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Journal entry not found' })
  @ApiBadRequestResponse({ description: 'Invalid input data provided' })
  update(@Param('ref') ref: number, @Body() updateJournalDto: UpdateJournalDto, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.update(ref, updateJournalDto, orgId, branchId);
  }

  @Patch('restore/:ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Restore a journal entry by reference code',
    description: 'Restores a previously deleted journal entry. Requires ADMIN, MANAGER, or SUPPORT role.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Journal reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Journal entry restored successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Journal entry not found' })
  restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.restore(ref, orgId, branchId);
  }

  @Delete(':ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN, AccessLevel.DEVELOPER)
  @ApiOperation({ 
    summary: 'Delete a journal entry by reference code',
    description: 'Performs a soft delete on a journal entry. Requires ADMIN, MANAGER, or SUPPORT role.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Journal reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Journal entry deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Journal entry not found' })
  remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.remove(ref, orgId, branchId);
  }

  // Inspection-specific endpoints

  @Post('inspection')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Create a new inspection journal',
    description: 'Creates a new inspection journal with form data, scoring, and validation. Requires appropriate role.'
  })
  @ApiBody({ type: CreateJournalDto })
  @ApiCreatedResponse({ 
    description: 'Inspection journal created successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' },
        data: {
          type: 'object',
          properties: {
            uid: { type: 'number', example: 1 },
            totalScore: { type: 'number', example: 85.5 },
            percentage: { type: 'number', example: 85.5 },
            overallRating: { type: 'string', example: 'GOOD' }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Invalid inspection data provided' })
  createInspection(@Body() createJournalDto: CreateJournalDto, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.createInspection(createJournalDto, orgId, branchId);
  }

  @Get('inspections')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Get all inspection journals',
    description: 'Retrieves all inspection-type journal entries with scoring data.'
  })
  @ApiOkResponse({ 
    description: 'List of all inspection journals',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              uid: { type: 'number', example: 1 },
              title: { type: 'string', example: 'Store Inspection Report' },
              type: { type: 'string', example: 'INSPECTION' },
              totalScore: { type: 'number', example: 85.5 },
              percentage: { type: 'number', example: 85.5 },
              overallRating: { type: 'string', example: 'GOOD' },
              inspectionDate: { type: 'string', format: 'date-time' },
              createdAt: { type: 'string', format: 'date-time' }
            }
          }
        },
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  getAllInspections(@Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.getAllInspections(orgId, branchId);
  }

  @Get('inspection/:ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Get inspection journal with detailed form data',
    description: 'Retrieves a specific inspection journal with complete form data and scoring breakdown.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Inspection journal reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Inspection journal with detailed data',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            uid: { type: 'number', example: 1 },
            title: { type: 'string', example: 'Store Inspection Report' },
            inspectionData: { 
              type: 'object',
              description: 'Complete inspection form data with categories and scoring'
            },
            totalScore: { type: 'number', example: 85.5 },
            percentage: { type: 'number', example: 85.5 },
            overallRating: { type: 'string', example: 'GOOD' },
            inspectorComments: { type: 'string', example: 'Overall good performance' }
          }
        },
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Inspection journal not found' })
  getInspectionDetail(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.getInspectionDetail(ref, orgId, branchId);
  }

  @Get('templates')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Get inspection form templates',
    description: 'Retrieves predefined inspection form templates for different types of inspections.'
  })
  @ApiOkResponse({ 
    description: 'List of available inspection templates',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'store_inspection' },
              name: { type: 'string', example: 'Store Inspection' },
              description: { type: 'string', example: 'Comprehensive store inspection checklist' },
              categories: {
                type: 'array',
                description: 'Template categories and items'
              }
            }
          }
        },
        message: { type: 'string', example: 'Success' }
      }
    }
  })
  getInspectionTemplates(@Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.getInspectionTemplates(orgId, branchId);
  }

  @Post('calculate-score/:ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Recalculate inspection scores',
    description: 'Recalculates the total score and percentage for an inspection journal.'
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Inspection journal reference code',
    type: 'number',
    example: 1
  })
  @ApiOkResponse({ 
    description: 'Score calculation completed',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Success' },
        data: {
          type: 'object',
          properties: {
            totalScore: { type: 'number', example: 85.5 },
            maxScore: { type: 'number', example: 100 },
            percentage: { type: 'number', example: 85.5 },
            overallRating: { type: 'string', example: 'GOOD' }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Inspection journal not found' })
  recalculateScore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid || req.user?.organisationRef;
    const branchId = req.user?.branch?.uid;
    return this.journalService.recalculateScore(ref, orgId, branchId);
  }
}
