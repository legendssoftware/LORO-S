import { 
    Controller, 
    Get, 
    Post, 
    Body, 
    Patch, 
    Param, 
    Delete, 
    UseGuards, 
    Req,
    Query,
    HttpCode,
    HttpStatus,
    ParseIntPipe,
} from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { CreateApprovalDto } from './dto/create-approval.dto';
import { UpdateApprovalDto } from './dto/update-approval.dto';
import { ApprovalActionDto, SignApprovalDto, BulkApprovalActionDto } from './dto/approval-action.dto';
import { ApprovalQueryDto } from './dto/approval-query.dto';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { 
    ApiBearerAuth, 
    ApiOperation, 
    ApiTags, 
    ApiParam, 
    ApiBody, 
    ApiOkResponse, 
    ApiCreatedResponse, 
    ApiBadRequestResponse, 
    ApiNotFoundResponse,
    ApiUnauthorizedResponse,
    ApiForbiddenResponse,
    ApiConflictResponse,
    ApiUnprocessableEntityResponse,
    ApiInternalServerErrorResponse,
    ApiServiceUnavailableResponse,
    ApiConsumes,
    ApiProduces,
    ApiQuery
} from '@nestjs/swagger';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { Approval } from './entities/approval.entity';
import { ApprovalHistory } from './entities/approval-history.entity';
import { ApprovalSignature } from './entities/approval-signature.entity';

@ApiBearerAuth('JWT-auth')
@ApiTags('✅ Approvals & Workflow Management')
@Controller('approvals')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('approvals')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({ 
    description: '🔒 Unauthorized - Authentication required',
    schema: {
        type: 'object',
        properties: {
            message: { type: 'string', example: 'Authentication token is required' },
            error: { type: 'string', example: 'Unauthorized' },
            statusCode: { type: 'number', example: 401 }
        }
    }
})
export class ApprovalsController {
    constructor(private readonly approvalsService: ApprovalsService) {}

    // Create new approval request
    @Post()
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: '➕ Create new approval request',
        description: `
# Create Approval Request

Submit a new approval request for organizational workflow processing with comprehensive tracking and notification capabilities.

## 📋 **Use Cases**
- **Leave Requests**: Time off, vacation, sick leave, personal days
- **Purchase Orders**: Equipment, software, services, supplies
- **Budget Approvals**: Expense claims, project funding, budget adjustments
- **HR Processes**: Hiring, promotions, policy changes, training requests
- **IT Changes**: System access, software installations, infrastructure changes
- **Project Approvals**: New projects, scope changes, resource allocation
- **Compliance**: Document reviews, policy exceptions, regulatory submissions

## 🔧 **Features**
- Automatic approval routing based on type and organization hierarchy
- Real-time email notifications to all stakeholders
- Document attachment support (internal files and external URLs)
- Priority-based processing with deadline management
- Complete audit trail and history tracking
- Digital signature capability for legally binding approvals
- Delegation and escalation workflows for complex approvals

## 📝 **Required Fields**
- Title and detailed description of the request
- Approval type and priority level
- Supporting documentation (optional but recommended)
- Deadline for processing (if applicable)
- Entity information for context and tracking

## 🔄 **Workflow Process**
1. **Draft Creation**: Request created in draft status for editing
2. **Submission**: Request submitted for review (triggers notifications)
3. **Review Process**: Assigned approver reviews and makes decision
4. **Decision**: Approved, rejected, or escalated with feedback
5. **Completion**: Final status with optional digital signature
        `
    })
    @ApiBody({ 
        type: CreateApprovalDto,
        description: 'Approval request creation payload with comprehensive details',
        examples: {
            leaveRequest: {
                summary: '🏖️ Employee Leave Request',
                description: 'Example of creating a leave request approval',
                value: {
                    title: 'Annual Leave Request - John Doe',
                    description: 'Requesting 10 days annual leave for family vacation to Europe',
                    type: 'LEAVE_REQUEST',
                    priority: 'MEDIUM',
                    deadline: '2024-01-15',
                    entityType: 'leave_application',
                    entityId: 'LEAVE-2024-001',
                    supportingDocuments: [
                        {
                            filename: 'flight-confirmation.pdf',
                            url: 'https://docs.loro.co.za/leaves/flight-conf-12345.pdf',
                            description: 'Flight booking confirmation'
                        }
                    ],
                    requestedAmount: null,
                    requiresSignature: false
                }
            },
            purchaseOrder: {
                summary: '🛒 Purchase Order Request',
                description: 'Example of creating a purchase order approval',
                value: {
                    title: 'Dell Laptops Purchase - IT Department',
                    description: 'Purchase of 5 Dell Latitude laptops for new engineering team members',
                    type: 'PURCHASE_ORDER',
                    priority: 'HIGH',
                    deadline: '2024-01-20',
                    entityType: 'purchase_order',
                    entityId: 'PO-2024-0156',
                    requestedAmount: 15000.00,
                    currency: 'ZAR',
                    supportingDocuments: [
                        {
                            filename: 'laptop-quotation.pdf',
                            url: 'https://docs.loro.co.za/quotes/dell-quote-789.pdf',
                            description: 'Official Dell quotation'
                        }
                    ],
                    requiresSignature: true,
                    approverUid: 45
                }
            },
            budgetApproval: {
                summary: '💰 Budget Approval Request',
                description: 'Example of creating a budget approval request',
                value: {
                    title: 'Q1 Marketing Budget Increase',
                    description: 'Requesting additional budget allocation for digital marketing campaigns in Q1 2024',
                    type: 'BUDGET_APPROVAL',
                    priority: 'URGENT',
                    deadline: '2023-12-31',
                    entityType: 'budget_request',
                    entityId: 'BUD-2024-Q1-001',
                    requestedAmount: 50000.00,
                    currency: 'ZAR',
                    requiresSignature: true,
                    businessJustification: 'Projected 25% increase in lead generation and conversion rates',
                    expectedROI: 2.5
                }
            }
        }
    })
    @ApiCreatedResponse({ 
        description: '✅ Approval request created successfully',
        schema: {
            type: 'object',
            properties: {
                data: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 12345 },
                        title: { type: 'string', example: 'Annual Leave Request - John Doe' },
                        type: { type: 'string', example: 'LEAVE_REQUEST' },
                        status: { type: 'string', example: 'DRAFT' },
                        approvalReference: { type: 'string', example: 'LEA-KBGT6-H4P' },
                        priority: { type: 'string', example: 'MEDIUM' },
                        createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
                        deadline: { type: 'string', format: 'date', example: '2024-01-15' }
                    }
                },
                message: { type: 'string', example: 'Approval request created successfully' },
                notifications: {
                    type: 'object',
                    properties: {
                        emailSent: { type: 'boolean', example: true },
                        notifiedUsers: { 
                            type: 'array',
                            items: { type: 'string' },
                            example: ['john.doe@loro.co.za', 'manager@loro.co.za']
                        }
                    }
                }
            }
        }
    })
    @ApiBadRequestResponse({ 
        description: '❌ Bad Request - Invalid or missing required data',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Validation failed: Title is required and must be between 5 and 200 characters' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Title must be between 5 and 200 characters',
                        'Description is required for this approval type',
                        'Invalid approval type specified',
                        'Deadline must be in the future',
                        'Supporting documents exceed maximum limit of 10'
                    ]
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Forbidden - Insufficient permissions or policy violation',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'You do not have permission to create this type of approval request' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'Approval type requires elevated permissions or violates organizational policy' }
            }
        }
    })
    @ApiConflictResponse({
        description: '⚠️ Conflict - Duplicate or conflicting request',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'A similar approval request already exists for this entity' },
                error: { type: 'string', example: 'Conflict' },
                statusCode: { type: 'number', example: 409 },
                conflictingApproval: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 9876 },
                        title: { type: 'string', example: 'Annual Leave Request - John Doe' },
                        status: { type: 'string', example: 'PENDING' },
                        reference: { type: 'string', example: 'LEA-PREV-123' }
                    }
                }
            }
        }
    })
    @ApiUnprocessableEntityResponse({
        description: '📝 Unprocessable Entity - Business logic validation failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot create approval request due to business rule violations' },
                error: { type: 'string', example: 'Unprocessable Entity' },
                statusCode: { type: 'number', example: 422 },
                businessRuleViolations: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Leave balance insufficient for requested days',
                        'Budget limits exceeded for this department',
                        'Approval deadline conflicts with organizational holidays',
                        'Required pre-approval process not completed'
                    ]
                }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - System malfunction',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to create approval request due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
                path: { type: 'string', example: '/approvals' }
            }
        }
    })
    create(@Body() createApprovalDto: CreateApprovalDto, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.create(createApprovalDto, req.user);
    }

    // Get all approvals with filtering and pagination
    @Get()
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: '📋 Get all approvals with advanced filtering',
        description: `
# List All Approvals

Retrieve a comprehensive, paginated list of approval requests with advanced filtering and search capabilities.

## 📊 **Response Features**
- **Real-time Status**: Current approval status and progress tracking
- **Priority Indicators**: Visual priority levels with urgency flags
- **Assignment Data**: Requester, approver, and delegation information
- **Timeline Tracking**: Submission, review, and completion timestamps
- **Financial Information**: Requested amounts and budget impact
- **Progress Metrics**: Processing time and efficiency analytics

## 🔍 **Advanced Filtering Options**
- **Status-based**: Filter by draft, pending, approved, rejected, or withdrawn
- **Type-specific**: Leave requests, purchase orders, budget approvals, etc.
- **Priority-driven**: URGENT, HIGH, MEDIUM, LOW priority levels
- **Date ranges**: Creation date, submission date, deadline filtering
- **User-centric**: Filter by requester, approver, or involved parties
- **Amount-based**: Filter by requested amount ranges
- **Overdue tracking**: Identify requests past their deadlines

## 📈 **Business Intelligence**
- **Processing efficiency**: Average approval times by type
- **Bottleneck identification**: Delayed approvals and causes
- **Volume analytics**: Request patterns and trends
- **Cost analysis**: Financial impact of approval decisions
- **Compliance tracking**: Audit trail and regulatory requirements

## 🎯 **Use Cases**
- **Management Dashboard**: Executive overview of pending decisions
- **HR Administration**: Employee request tracking and processing
- **Financial Control**: Budget and expense approval monitoring
- **Audit Preparation**: Historical approval data for compliance
- **Process Optimization**: Workflow efficiency analysis
        `
    })
    @ApiOkResponse({ 
        description: '✅ Approvals retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                data: {
                    type: 'object',
                    properties: {
                        approvals: {
                            type: 'array',
                            items: { 
                                type: 'object',
                                properties: {
                                    uid: { type: 'number', example: 12345 },
                                    approvalReference: { type: 'string', example: 'LEA-KBGT6-H4P' },
                                    title: { type: 'string', example: 'Annual Leave Request - John Doe' },
                                    description: { type: 'string', example: 'Requesting 10 days annual leave for family vacation' },
                                    type: { type: 'string', example: 'LEAVE_REQUEST' },
                                    status: { type: 'string', example: 'PENDING' },
                                    priority: { type: 'string', example: 'MEDIUM' },
                                    requestedAmount: { type: 'number', example: 15000.00 },
                                    currency: { type: 'string', example: 'ZAR' },
                                    deadline: { type: 'string', format: 'date', example: '2024-01-15' },
                                    isOverdue: { type: 'boolean', example: false },
                                    isUrgent: { type: 'boolean', example: false },
                                    requester: {
                                        type: 'object',
                                        properties: {
                                            uid: { type: 'number', example: 42 },
                                            name: { type: 'string', example: 'John Doe' },
                                            email: { type: 'string', example: 'john.doe@loro.co.za' },
                                            department: { type: 'string', example: 'Engineering' }
                                        }
                                    },
                                    approver: {
                                        type: 'object',
                                        properties: {
                                            uid: { type: 'number', example: 45 },
                                            name: { type: 'string', example: 'Jane Manager' },
                                            email: { type: 'string', example: 'jane.manager@loro.co.za' }
                                        }
                                    },
                                    submittedAt: { type: 'string', format: 'date-time', example: '2023-12-01T09:00:00Z' },
                                    createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T08:30:00Z' },
                                    entityType: { type: 'string', example: 'leave_application' },
                                    entityId: { type: 'string', example: 'LEAVE-2024-001' },
                                    supportingDocuments: {
                    type: 'array',
                                        items: { type: 'string' },
                                        example: ['https://docs.loro.co.za/leaves/flight-conf-12345.pdf']
                                    },
                                    processingTime: { type: 'number', example: 2.5, description: 'Days since submission' }
                                }
                            }
                        },
                        summary: {
                            type: 'object',
                            properties: {
                                totalApprovals: { type: 'number', example: 1247 },
                                totalValue: { type: 'number', example: 2500000.00 },
                                byStatus: {
                                    type: 'object',
                                    properties: {
                                        PENDING: { type: 'number', example: 45 },
                                        APPROVED: { type: 'number', example: 1100 },
                                        REJECTED: { type: 'number', example: 85 },
                                        DRAFT: { type: 'number', example: 17 }
                                    }
                                },
                                byType: {
                                    type: 'object',
                                    properties: {
                                        LEAVE_REQUEST: { type: 'number', example: 523 },
                                        PURCHASE_ORDER: { type: 'number', example: 341 },
                                        BUDGET_APPROVAL: { type: 'number', example: 189 },
                                        HR_REQUEST: { type: 'number', example: 194 }
                                    }
                                },
                                byPriority: {
                                    type: 'object',
                                    properties: {
                                        URGENT: { type: 'number', example: 12 },
                                        HIGH: { type: 'number', example: 156 },
                                        MEDIUM: { type: 'number', example: 789 },
                                        LOW: { type: 'number', example: 290 }
                                    }
                                },
                                overdueCount: { type: 'number', example: 8 },
                                averageProcessingTime: { type: 'number', example: 3.2, description: 'Days' }
                            }
                        }
                    }
                },
                pagination: {
                    type: 'object',
                    properties: {
                        page: { type: 'number', example: 1 },
                        limit: { type: 'number', example: 20 },
                        total: { type: 'number', example: 1247 },
                        totalPages: { type: 'number', example: 63 },
                        hasNext: { type: 'boolean', example: true },
                        hasPrev: { type: 'boolean', example: false }
                    }
                },
                filters: { 
                    type: 'object',
                    description: 'Applied filters for the query'
                },
                message: { type: 'string', example: 'Approvals retrieved successfully' },
                timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
            }
        }
    })
    @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (1-based, default: 1)' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (max 100, default: 20)' })
    @ApiQuery({ name: 'search', required: false, type: String, description: 'Search in title, description, and reference number' })
    @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'], description: 'Filter by approval status' })
    @ApiQuery({ name: 'type', required: false, description: 'Filter by approval type (LEAVE_REQUEST, PURCHASE_ORDER, etc.)' })
    @ApiQuery({ name: 'priority', required: false, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'], description: 'Filter by priority level' })
    @ApiQuery({ name: 'isOverdue', required: false, type: Boolean, description: 'Filter overdue approvals only' })
    @ApiQuery({ name: 'isUrgent', required: false, type: Boolean, description: 'Filter urgent approvals only' })
    @ApiQuery({ name: 'createdFrom', required: false, type: String, description: 'Filter by creation date from (ISO date)' })
    @ApiQuery({ name: 'createdTo', required: false, type: String, description: 'Filter by creation date to (ISO date)' })
    @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'submittedAt', 'deadline', 'priority', 'requestedAmount'], description: 'Sort field' })
    @ApiQuery({ name: 'sortOrder', required: false, enum: ['ASC', 'DESC'], description: 'Sort order (default: DESC)' })
    @ApiQuery({ name: 'includeHistory', required: false, type: Boolean, description: 'Include approval history in response' })
    @ApiQuery({ name: 'includeSignatures', required: false, type: Boolean, description: 'Include digital signatures in response' })
    @ApiForbiddenResponse({
        description: '🚫 Forbidden - Insufficient permissions to view approvals',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'You do not have permission to view approvals in this organization' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Database connection failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to retrieve approvals due to database error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
                path: { type: 'string', example: '/approvals' }
            }
        }
    })
    findAll(@Query() query: ApprovalQueryDto, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.findAll(query, req.user);
    }

    // Get approvals pending for current user
    @Get('pending')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Get pending approvals for current user',
        description: 'Retrieve all approvals that require action from the currently authenticated user as an approver.'
    })
    @ApiOkResponse({ 
        description: '📝 Pending approvals retrieved successfully',
        type: [Approval]
    })
    getPendingApprovals(@Req() req: AuthenticatedRequest) {
        return this.approvalsService.getPendingApprovals(req.user);
    }

    // Get approvals submitted by current user
    @Get('my-requests')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Get approval requests submitted by current user',
        description: 'Retrieve all approval requests that were submitted by the currently authenticated user.'
    })
    @ApiOkResponse({ 
        description: '📤 User\'s approval requests retrieved successfully',
        type: [Approval]
    })
    getMyRequests(@Query() query: ApprovalQueryDto, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.getMyRequests(query, req.user);
    }

    // Get approval statistics/dashboard data
    @Get('stats')
    @Roles(AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Get approval statistics and dashboard data',
        description: 'Retrieve comprehensive statistics about approvals for dashboard and reporting purposes.'
    })
    @ApiOkResponse({ 
        description: '📊 Approval statistics retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                summary: {
                    type: 'object',
                    properties: {
                        total: { type: 'number', example: 1250 },
                        pending: { type: 'number', example: 45 },
                        approved: { type: 'number', example: 1100 },
                        rejected: { type: 'number', example: 85 },
                        overdue: { type: 'number', example: 12 }
                    }
                },
                byType: { type: 'object' },
                byPriority: { type: 'object' },
                trends: { type: 'object' },
                message: { type: 'string', example: 'Statistics retrieved successfully' }
            }
        }
    })
    getStats(@Req() req: AuthenticatedRequest) {
        return this.approvalsService.getStats(req.user);
    }

    // Get specific approval by ID
    @Get(':id')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Get approval by ID',
        description: 'Retrieve detailed information about a specific approval including history and signatures if authorized.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiOkResponse({ 
        description: '✅ Approval details retrieved successfully',
        type: Approval
    })
    @ApiNotFoundResponse({ 
        description: '❌ Approval not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval not found' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied to this approval',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Access denied to this approval' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 }
            }
        }
    })
    findOne(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.findOne(id, req.user);
    }

    // Update approval (for requesters to modify draft approvals)
    @Patch(':id')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Update approval request',
        description: 'Update an approval request. Only draft approvals can be modified by the requester.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiOkResponse({ 
        description: '✅ Approval updated successfully',
        type: Approval
    })
    @ApiBadRequestResponse({ 
        description: '❌ Invalid update data or approval cannot be modified',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot modify approval in current status' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 }
            }
        }
    })
    update(
        @Param('id', ParseIntPipe) id: number, 
        @Body() updateApprovalDto: UpdateApprovalDto, 
        @Req() req: AuthenticatedRequest
    ) {
        return this.approvalsService.update(id, updateApprovalDto, req.user);
    }

    // Submit approval for review (change from draft to pending)
    @Post(':id/submit')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Submit approval request for review',
        description: 'Submit a draft approval request for review. This will change the status to pending and notify approvers.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiOkResponse({ 
        description: '📤 Approval submitted for review successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                status: { type: 'string', example: 'pending' },
                submittedAt: { type: 'string', format: 'date-time' },
                message: { type: 'string', example: 'Approval submitted for review successfully' }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    submitForReview(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.submitForReview(id, req.user);
    }

    // Perform action on approval (approve, reject, etc.)
    @Post(':id/action')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Perform action on approval',
        description: 'Perform various actions on an approval request such as approve, reject, request information, delegate, or escalate.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiBody({ type: ApprovalActionDto })
    @ApiOkResponse({ 
        description: '✅ Action performed successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                status: { type: 'string', example: 'approved' },
                action: { type: 'string', example: 'approve' },
                actionBy: { type: 'number', example: 456 },
                actionAt: { type: 'string', format: 'date-time' },
                message: { type: 'string', example: 'Approval action completed successfully' }
            }
        }
    })
    @ApiBadRequestResponse({ 
        description: '❌ Invalid action or approval cannot be acted upon',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot perform this action on approval in current status' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    performAction(
        @Param('id', ParseIntPipe) id: number, 
        @Body() actionDto: ApprovalActionDto, 
        @Req() req: AuthenticatedRequest
    ) {
        return this.approvalsService.performAction(id, actionDto, req.user);
    }

    // Sign approval digitally
    @Post(':id/sign')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Digitally sign an approval',
        description: 'Apply a digital signature to an approved request to make it legally binding.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiBody({ type: SignApprovalDto })
    @ApiOkResponse({ 
        description: '✍️ Approval signed successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                isSigned: { type: 'boolean', example: true },
                signedAt: { type: 'string', format: 'date-time' },
                signatureId: { type: 'number', example: 123 },
                message: { type: 'string', example: 'Approval signed successfully' }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    signApproval(
        @Param('id', ParseIntPipe) id: number, 
        @Body() signDto: SignApprovalDto, 
        @Req() req: AuthenticatedRequest
    ) {
        return this.approvalsService.signApproval(id, signDto, req.user);
    }

    // Bulk actions on multiple approvals
    @Post('bulk-action')
    @Roles(AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: 'Perform bulk actions on multiple approvals',
        description: 'Perform the same action on multiple approvals simultaneously. Requires manager role or higher.'
    })
    @ApiBody({ type: BulkApprovalActionDto })
    @ApiOkResponse({ 
        description: '✅ Bulk action completed successfully',
        schema: {
            type: 'object',
            properties: {
                processed: { type: 'number', example: 15 },
                successful: { type: 'number', example: 12 },
                failed: { type: 'number', example: 3 },
                results: { 
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 1 },
                            success: { type: 'boolean', example: true },
                            message: { type: 'string', example: 'Action completed successfully' }
                        }
                    }
                },
                message: { type: 'string', example: 'Bulk action completed successfully' }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    bulkAction(@Body() bulkActionDto: BulkApprovalActionDto, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.bulkAction(bulkActionDto, req.user);
    }

    // Get approval history
    @Get(':id/history')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Get approval history',
        description: 'Retrieve the complete history of actions and status changes for a specific approval.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiOkResponse({ 
        description: '📜 Approval history retrieved successfully',
        type: [ApprovalHistory]
    })
    getHistory(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.getHistory(id, req.user);
    }

    // Get approval signatures
    @Get(':id/signatures')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Get approval signatures',
        description: 'Retrieve all digital signatures associated with a specific approval.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiOkResponse({ 
        description: '✍️ Approval signatures retrieved successfully',
        type: [ApprovalSignature]
    })
    getSignatures(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.getSignatures(id, req.user);
    }

    // Withdraw approval (by requester)
    @Post(':id/withdraw')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: 'Withdraw approval request',
        description: 'Withdraw a pending approval request. Only the original requester can withdraw their own request.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiOkResponse({ 
        description: '🔙 Approval withdrawn successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                status: { type: 'string', example: 'withdrawn' },
                withdrawnAt: { type: 'string', format: 'date-time' },
                message: { type: 'string', example: 'Approval withdrawn successfully' }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    withdraw(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.withdraw(id, req.user);
    }

    // Archive approval (admin only)
    @Post(':id/archive')
    @Roles(AccessLevel.ADMIN)
    @ApiOperation({ 
        summary: 'Archive an approval',
        description: 'Archive a completed approval for long-term storage. Admin access required.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiOkResponse({ 
        description: '📦 Approval archived successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                isArchived: { type: 'boolean', example: true },
                archivedAt: { type: 'string', format: 'date-time' },
                archivedBy: { type: 'number', example: 789 },
                message: { type: 'string', example: 'Approval archived successfully' }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    archive(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.archive(id, req.user);
    }

    // Delete approval (soft delete)
    @Delete(':id')
    @Roles(AccessLevel.ADMIN)
    @ApiOperation({ 
        summary: 'Delete an approval',
        description: 'Soft delete an approval request. Admin access required. This marks the approval as deleted but preserves data for audit purposes.'
    })
    @ApiParam({ name: 'id', description: 'Approval unique identifier', type: 'number' })
    @ApiOkResponse({ 
        description: '🗑️ Approval deleted successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 1 },
                isDeleted: { type: 'boolean', example: true },
                message: { type: 'string', example: 'Approval deleted successfully' }
            }
        }
    })
    @ApiNotFoundResponse({ 
        description: '❌ Approval not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval not found' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.remove(id, req.user);
    }
}
