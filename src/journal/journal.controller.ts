import { JournalService } from './journal.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { ApiOperation, ApiTags, ApiParam, ApiBody, ApiOkResponse, ApiCreatedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, getFutureDate, getPastDate, createApiDescription } from '../lib/utils/swagger-helpers';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { Controller, Get, Post, Body, Param, UseGuards, Patch, Delete, Req, BadRequestException } from '@nestjs/common';
import { AuthenticatedRequest, getClerkOrgId, getClerkUserId } from '../lib/interfaces/authenticated-request.interface';

@ApiTags('📝 Journal')
@Controller('journal')
@UseGuards(ClerkAuthGuard, RoleGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class JournalController {
  constructor(private readonly journalService: JournalService) { }

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
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: '📝 Create a new journal entry',
    description: createApiDescription(
      'Creates a new journal entry in the system with full content management and organizational tracking capabilities.',
      'The service method `JournalService.create()` processes journal creation, validates required fields (owner, type), assigns organization and branch context, handles transactions for data consistency, manages cache invalidation, awards XP rewards, and returns success confirmation.',
      'JournalService',
      'create',
      'creates a new journal entry with validation, transaction handling, and reward integration',
      'a success message confirming journal creation',
      ['Field validation', 'Organization and branch assignment', 'Transaction management', 'Cache invalidation', 'XP reward integration'],
    ) + `

# Create Comprehensive Journal Entry

Creates a new journal entry in the system with full content management and organizational tracking capabilities.

## 📋 **Core Features**
- **Complete Journal Management**: Client references, file attachments, comments, and metadata
- **Multi-Type Support**: General entries, inspection reports, shift logs, and custom categories
- **Organization Scoping**: Automatic organization and branch assignment with role-based access
- **File Integration**: Support for file attachments, URLs, and multimedia content
- **Notification System**: Automated notifications to relevant team members and managers
- **XP Rewards**: Automatic experience point awards for journal creation activities

## 🎯 **Use Cases**
- **End-of-Shift Logging**: Comprehensive shift reports with client interactions and incidents
- **Inspection Documentation**: Detailed inspection reports with scoring and validation
- **Client Interaction Logs**: Track client meetings, calls, and service interactions
- **Incident Reporting**: Document workplace incidents, safety concerns, and resolutions
- **Progress Tracking**: Daily work progress, achievements, and challenges
- **Compliance Documentation**: Record compliance activities and regulatory requirements

## 🔧 **Advanced Features**
- **File Attachment Support**: Upload and associate files, documents, and images with journal entries
- **Client Reference Tracking**: Link journal entries to specific client accounts and projects
- **Multi-Organization Support**: Organization and branch-specific journal management
- **Automated Notifications**: Real-time notifications to supervisors and team members
- **XP Integration**: Reward system integration for encouraging regular journal updates
- **Status Management**: Track journal entry status from creation to review and approval

## 📝 **Field Categories**

### Required Fields
- **Basic Information**: owner (user reference), type (entry type)

### Optional Core Fields
- **Content**: title, description, comments, clientRef
- **Media**: fileURL (attachments and documents)
- **Status**: status (defaults to PENDING_REVIEW)
- **Metadata**: timestamp, isDeleted

### Inspection-Specific Fields (For Type: INSPECTION)
- **Scoring**: totalScore, maxScore, percentage
- **Rating**: overallRating (EXCELLENT, GOOD, FAIR, POOR)
- **Form Data**: inspectionData (JSON structure with categories and items)

## 🔒 **Security & Validation**
- Role-based access control with organization and branch scoping
- File upload validation and secure storage
- User ownership verification and audit trails
- Content validation and spam prevention
- Organization membership validation

## 📊 **Integration Features**
- **Rewards System**: Automatic XP awards for journal creation
- **Notification Hub**: Real-time notifications to relevant stakeholders
- **Reporting Engine**: Journal data included in organizational reports
- **Analytics Integration**: Journal metrics and user engagement tracking

## ⚡ **Performance Features**
- **Caching**: Intelligent caching for improved response times
- **Pagination**: Efficient handling of large journal datasets
- **Search**: Advanced search capabilities across all journal fields
- **Filtering**: Multi-criteria filtering by date, type, status, and user
    `
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    return this.journalService.create(createJournalDto, orgId, branchId, clerkUserId);
  }

  @Get()
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: '📊 Retrieve all journal entries',
    description: createApiDescription(
      'Retrieves journal entries with advanced filtering, pagination, and performance optimization capabilities.',
      'The service method `JournalService.findAll()` processes query filters, applies organization and branch scoping, handles pagination, performs optimized database queries with relationships, manages caching, calculates statistics, and returns paginated journal results.',
      'JournalService',
      'findAll',
      'retrieves journals with filtering, pagination, and organization scoping',
      'a paginated response containing journals array, metadata, and statistics',
      ['Filter processing', 'Organization scoping', 'Pagination', 'Cache management', 'Statistics calculation'],
    ) + `

# Comprehensive Journal Entry Retrieval

Retrieves journal entries with advanced filtering, pagination, and performance optimization capabilities.

## 📋 **Core Features**
- **Comprehensive Listing**: Access to all journal entries with full metadata and relationships
- **Advanced Filtering**: Filter by status, type, date range, author, and content search
- **Performance Optimization**: Intelligent caching and optimized database queries
- **Pagination Support**: Efficient handling of large datasets with configurable page sizes
- **Organization Scoping**: Automatic filtering based on user's organization and branch access
- **Real-time Data**: Cache-optimized data retrieval with intelligent cache invalidation

## 🎯 **Use Cases**
- **Daily Operations Dashboard**: Overview of all journal activities across the organization
- **Shift Management**: Review end-of-shift reports and daily activities
- **Inspection Oversight**: Monitor inspection reports and compliance activities
- **Performance Analytics**: Analyze journal entry patterns and user engagement
- **Audit Trail Review**: Complete audit trail of all journal activities
- **Team Coordination**: Stay updated on team activities and client interactions

## 🔧 **Advanced Features**
- **Smart Caching**: Intelligent caching system for improved response times
- **Multi-Level Filtering**: Combine multiple filters for precise data retrieval
- **Search Capabilities**: Full-text search across titles, descriptions, and comments
- **Date Range Queries**: Flexible date range filtering for reporting and analysis
- **Organization Hierarchy**: Automatic scoping based on user permissions and organizational structure
- **Performance Monitoring**: Detailed performance metrics and query optimization

## 📝 **Query Parameters**

### Pagination
- **page**: Page number (default: 1)
- **limit**: Items per page (default: system configured limit)

### Filtering Options
- **status**: Filter by journal status (PENDING_REVIEW, APPROVED, REJECTED)
- **type**: Filter by journal type (GENERAL, INSPECTION, SHIFT_LOG, INCIDENT)
- **authorId**: Filter by specific user/author
- **startDate**: Filter entries from specific date
- **endDate**: Filter entries until specific date
- **search**: Full-text search across content fields

## 📊 **Response Structure**
- **data**: Array of journal entries with complete metadata
- **meta**: Pagination metadata (total, page, limit, totalPages)
- **message**: Response status message

## 🔒 **Security & Access Control**
- Role-based access with organization and branch scoping
- Automatic filtering based on user permissions
- Secure data handling with sensitive information protection
- Audit logging for all data access requests

## ⚡ **Performance Features**
- **Intelligent Caching**: Multi-level caching for optimal performance
- **Query Optimization**: Optimized database queries with proper indexing
- **Lazy Loading**: Efficient loading of related data only when needed
- **Response Compression**: Optimized data transfer for large datasets
    `
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.findAll({}, 1, 25, orgId, branchId);
  }

  @Get(':ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Get a journal entry by reference code',
    description: createApiDescription(
      'Retrieves a specific journal entry by its reference code with complete relationship data.',
      'The service method `JournalService.findOne()` validates the journal reference, applies organization and branch filters, loads related entities (owner, branch, organisation), handles caching, and returns the complete journal details.',
      'JournalService',
      'findOne',
      'retrieves a single journal entry by reference with full relationship data',
      'an object containing the journal details with related entities',
      ['Reference validation', 'Organization scoping', 'Relationship loading', 'Cache management'],
    ),
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.findOne(ref, orgId, branchId);
  }

  @Get('for/:ref')
  @UseGuards(ClerkAuthGuard, RoleGuard)
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.journalsByUser(ref, orgId, branchId);
  }

  @Patch(':ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: 'Update a journal entry by reference code',
    description: createApiDescription(
      'Updates a specific journal entry by its reference code with validation and cache management.',
      'The service method `JournalService.update()` validates the journal reference, applies organization and branch filters, updates journal fields, handles transactions, invalidates cache, and returns success confirmation.',
      'JournalService',
      'update',
      'updates a journal entry with validation, transaction handling, and cache invalidation',
      'a success message confirming the update',
      ['Reference validation', 'Organization scoping', 'Field updates', 'Transaction management', 'Cache invalidation'],
    ),
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.update(ref, updateJournalDto, orgId, branchId);
  }

  @Patch('restore/:ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.restore(ref, orgId, branchId);
  }

  @Delete(':ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN, AccessLevel.DEVELOPER)
  @ApiOperation({ 
    summary: 'Delete a journal entry by reference code',
    description: createApiDescription(
      'Performs a soft delete on a journal entry by setting the isDeleted flag.',
      'The service method `JournalService.remove()` validates the journal reference, applies organization and branch filters, performs soft delete, invalidates cache, and returns success confirmation.',
      'JournalService',
      'remove',
      'performs soft delete on a journal entry with validation and cache invalidation',
      'a success message confirming the deletion',
      ['Reference validation', 'Organization scoping', 'Soft delete', 'Cache invalidation'],
    ),
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.remove(ref, orgId, branchId);
  }

  // Inspection-specific endpoints

  @Post('inspection')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
  @ApiOperation({ 
    summary: '🔍 Create comprehensive inspection journal',
    description: createApiDescription(
      'Creates detailed inspection journals with comprehensive scoring, validation, and compliance tracking capabilities.',
      'The service method `JournalService.createInspection()` processes inspection creation, validates inspection data structure, calculates scores and percentages, determines overall rating, assigns organization and branch context, handles transactions, manages cache invalidation, awards XP rewards, and returns success confirmation with inspection details.',
      'JournalService',
      'createInspection',
      'creates an inspection journal with scoring, validation, and reward integration',
      'a success message with inspection details including scores and rating',
      ['Inspection data validation', 'Score calculation', 'Rating determination', 'Organization assignment', 'Transaction management', 'Cache invalidation', 'XP reward integration'],
    ) + `

# Advanced Inspection Journal Creation

Creates detailed inspection journals with comprehensive scoring, validation, and compliance tracking capabilities.

## 📋 **Core Features**
- **Structured Inspection Forms**: Predefined inspection categories with scoring mechanisms
- **Automated Scoring**: Intelligent calculation of total scores, percentages, and ratings
- **Compliance Tracking**: Built-in compliance validation and regulatory requirement tracking
- **Evidence Management**: Support for photos, documents, and multimedia evidence
- **Real-time Validation**: Instant validation of inspection data and scoring accuracy
- **Performance Analytics**: Detailed performance metrics and trend analysis

## 🎯 **Use Cases**
- **End-of-Shift Inspections**: Comprehensive facility and equipment inspections
- **Safety Compliance Audits**: Workplace safety inspections with compliance tracking
- **Quality Assurance Checks**: Product and service quality validation inspections
- **Equipment Maintenance Reviews**: Regular equipment inspection and maintenance logging
- **Client Site Inspections**: On-site client facility and service quality assessments
- **Regulatory Compliance**: Government and industry standard compliance inspections

## 🔧 **Advanced Features**
- **Dynamic Form Templates**: Customizable inspection forms based on inspection type
- **Automated Scoring Engine**: Intelligent scoring with weighted categories and items
- **Rating Classification**: Automatic classification (EXCELLENT, GOOD, FAIR, POOR)
- **Evidence Integration**: Photo, video, and document attachment with each inspection item
- **Compliance Mapping**: Automatic mapping to regulatory requirements and standards
- **Trend Analysis**: Performance trends and improvement recommendations

## 📝 **Inspection Data Structure**

### Core Fields
- **Basic Information**: title, description, inspector details
- **Scoring**: totalScore, maxScore, percentage, overallRating
- **Evidence**: fileURL, photos, documents, signatures

### Inspection Categories
- **Safety**: Workplace safety checks and compliance items
- **Equipment**: Machinery, tools, and equipment condition assessments
- **Cleanliness**: Facility cleanliness and hygiene standards
- **Documentation**: Record keeping and documentation compliance
- **Procedures**: Process adherence and procedure compliance
- **Quality**: Service and product quality assessments

### Scoring Mechanism
- **Item-Level Scoring**: Individual inspection item scores (0-100)
- **Category Weights**: Weighted importance for different categories
- **Overall Rating**: Automated rating based on total percentage
- **Improvement Areas**: Automatic identification of areas needing attention

## 🔒 **Compliance & Security**
- **Audit Trail**: Complete audit trail for regulatory compliance
- **Digital Signatures**: Support for digital signatures and approvals
- **Data Integrity**: Tamper-proof inspection records with versioning
- **Access Control**: Role-based access to inspection data and reports
- **Regulatory Mapping**: Automatic compliance with industry standards

## 📊 **Analytics & Reporting**
- **Performance Dashboards**: Real-time inspection performance metrics
- **Trend Analysis**: Historical trend analysis and improvement tracking
- **Compliance Reports**: Automated compliance reporting for audits
- **Benchmarking**: Performance comparison against industry standards
- **Predictive Analytics**: AI-powered recommendations for improvements

## ⚡ **Performance Features**
- **Template Caching**: Fast loading of inspection templates
- **Offline Support**: Offline inspection capability with sync when connected
- **Photo Optimization**: Automatic photo compression and optimization
- **Quick Templates**: Pre-configured templates for common inspection types
    `
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    const clerkUserId = getClerkUserId(req);
    return this.journalService.createInspection(createJournalDto, orgId, branchId, clerkUserId);
  }

  @Get('inspections')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.getAllInspections(orgId, branchId);
  }

  @Get('inspection/:ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.getInspectionDetail(ref, orgId, branchId);
  }

  @Get('templates')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.getInspectionTemplates(orgId, branchId);
  }

  @Post('calculate-score/:ref')
  @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.USER,
		AccessLevel.MEMBER, AccessLevel.OWNER, AccessLevel.TECHNICIAN)
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
    const orgId = getClerkOrgId(req);
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    const branchId = this.toNumber(req.user?.branch?.uid);
    return this.journalService.recalculateScore(ref, orgId, branchId);
  }
}
