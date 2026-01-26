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
    Logger,
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
import { getDynamicDate, getDynamicDateTime, getFutureDate, getPastDate, createApiDescription, generateCodeExamples } from '../lib/utils/swagger-helpers';
import { RoleGuard } from '../guards/role.guard';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { FeatureGuard } from '../guards/feature.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { RequireFeature } from '../decorators/require-feature.decorator';

@ApiBearerAuth('JWT-auth')
@ApiTags('✅ Approvals')
@Controller('approvals')
@UseGuards(ClerkAuthGuard, RoleGuard, FeatureGuard)
@RequireFeature('approvals.basic')
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
    private readonly logger = new Logger(ApprovalsController.name);

    constructor(private readonly approvalsService: ApprovalsService) {}

    /**
     * Determines access scope for the authenticated user
     * @param user - Authenticated user object
     * @returns Access scope with orgId and branchId (null for org-wide access)
     */
    private getAccessScope(user: any) {
        const isElevatedUser = [
            AccessLevel.ADMIN,
            AccessLevel.OWNER,
            AccessLevel.MANAGER,
            AccessLevel.DEVELOPER,
            AccessLevel.SUPPORT,
        ].includes(user?.role || user?.accessLevel);

        const orgId = user?.org?.uid || user?.organisationRef;
        const branchId = isElevatedUser ? null : user?.branch?.uid;

        return {
            orgId,
            branchId,
            isElevated: isElevatedUser,
        };
    }

    // Create new approval request
    @Post()
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: '➕ Create new approval request',
        description: createApiDescription(
            'Submit a new approval request for organizational workflow processing with comprehensive tracking and notification capabilities.',
            'Creates a new approval request in the system. The service method `ApprovalsService.create()` processes the request, validates data, assigns approvers based on workflow rules, sends notifications to stakeholders, and returns the created approval with its reference number.',
            'ApprovalsService',
            'create',
            'creates a new approval request, validates data, assigns approvers, and sends notifications',
            'an object containing the created approval data, approval reference, status, and notification details',
            ['Workflow routing', 'Approver assignment', 'Email notifications', 'Audit trail creation'],
        ) + `

## 📋 **Use Cases**

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
                    type: 'leave_request',
                    priority: 'medium',
                    deadline: getFutureDate(7),
                    entityType: 'leave_application',
                    entityId: `LEAVE-${new Date().getFullYear()}-001`,
                    supportingDocuments: [
                        {
                            url: 'https://docs.loro.co.za/leaves/flight-conf-12345.pdf',
                            name: 'Flight booking confirmation',
                            type: 'application/pdf'
                        }
                    ],
                    amount: 0,
                    requiresSignature: false,
                    leaveType: 'annual_leave',
                    startDate: getFutureDate(14),
                    endDate: getFutureDate(24),
                    totalDays: 10
                }
            },
            purchaseOrder: {
                summary: '🛒 Purchase Order Request',
                description: 'Example of creating a purchase order approval',
                value: {
                    title: 'Dell Laptops Purchase - IT Department',
                    description: 'Purchase of 5 Dell Latitude laptops for new engineering team members',
                    type: 'purchase_order',
                    priority: 'high',
                    deadline: getFutureDate(14),
                    entityType: 'purchase_order',
                    entityId: `PO-${new Date().getFullYear()}-0156`,
                    amount: 15000.00,
                    currency: 'ZAR',
                    supportingDocuments: [
                        {
                            url: 'https://docs.loro.co.za/quotes/dell-quote-789.pdf',
                            name: 'Official Dell quotation',
                            type: 'application/pdf'
                        }
                    ],
                    requiresSignature: true,
                    vendorName: 'Dell Technologies',
                    quantity: 5,
                    unitPrice: 3000.00
                }
            },
            expenseClaim: {
                summary: '💳 Business Expense Claim',
                description: 'Example of creating a business expense reimbursement request',
                value: {
                    title: 'Client Meeting Expenses - Sarah Johnson',
                    description: 'Reimbursement for lunch and transportation expenses during client presentation',
                    type: 'expense_claim',
                    priority: 'medium',
                    deadline: getFutureDate(3),
                    entityType: 'expense_claim',
                    entityId: `EXP-${new Date().getFullYear()}-0045`,
                    amount: 1250.00,
                    currency: 'ZAR',
                    supportingDocuments: [
                        {
                            url: 'https://docs.loro.co.za/expenses/receipts-jhb-meeting.pdf',
                            name: 'Restaurant receipts',
                            type: 'application/pdf'
                        },
                        {
                            url: 'https://docs.loro.co.za/expenses/uber-receipts.pdf',
                            name: 'Transportation receipts',
                            type: 'application/pdf'
                        }
                    ],
                    requiresSignature: false,
                    expenseCategory: 'client_entertainment',
                    expenseDate: getPastDate(15),
                    clientName: 'ABC Manufacturing'
                }
            },
            budgetRequest: {
                summary: '💰 Budget Allocation Request',
                description: 'Example of creating a budget approval request',
                value: {
                    title: `Q1 Marketing Budget Increase`,
                    description: `Requesting additional budget allocation for digital marketing campaigns in Q1 ${new Date().getFullYear()}`,
                    type: 'budget_request',
                    priority: 'urgent',
                    deadline: getFutureDate(5),
                    entityType: 'budget_request',
                    entityId: `BUD-${new Date().getFullYear()}-Q1-001`,
                    amount: 50000.00,
                    currency: 'ZAR',
                    supportingDocuments: [
                        {
                            url: 'https://docs.loro.co.za/budgets/q1-marketing-plan.pdf',
                            name: 'Q1 Marketing Plan',
                            type: 'application/pdf'
                        }
                    ],
                    requiresSignature: true,
                    department: 'Marketing',
                    fiscalYear: String(new Date().getFullYear()),
                    businessJustification: 'Projected 25% increase in lead generation and conversion rates',
                    expectedROI: 2.5
                }
            },
            systemChange: {
                summary: '🔧 System Configuration Change',
                description: 'Example of requesting approval for system changes',
                value: {
                    title: 'Database Server Upgrade - Production Environment',
                    description: 'Planned database server upgrade to improve performance and security',
                    type: 'system_change',
                    priority: 'urgent',
                    deadline: getFutureDate(2),
                    entityType: 'system_change',
                    entityId: `SYS-${new Date().getFullYear()}-0012`,
                    amount: 0,
                    supportingDocuments: [
                        {
                            url: 'https://docs.loro.co.za/systems/upgrade-plan.pdf',
                            name: 'Upgrade Implementation Plan',
                            type: 'application/pdf'
                        }
                    ],
                    requiresSignature: true,
                    changeType: 'infrastructure_upgrade',
                    impactLevel: 'high',
                    maintenanceWindow: `${getFutureDate(5)} 02:00-04:00 UTC`,
                    businessImpact: '15-minute service interruption expected'
                }
            },
            trainingRequest: {
                summary: '📚 Training Course Request',
                description: 'Example of requesting approval for training courses',
                value: {
                    title: 'AWS Cloud Certification Training',
                    description: 'Advanced AWS cloud architecture and DevOps certification program',
                    type: 'training_request',
                    priority: 'medium',
                    deadline: getFutureDate(21),
                    entityType: 'training_request',
                    entityId: `TRAIN-${new Date().getFullYear()}-0089`,
                    amount: 8500.00,
                    currency: 'ZAR',
                    supportingDocuments: [
                        {
                            url: 'https://docs.loro.co.za/training/aws-course-outline.pdf',
                            name: 'Course Curriculum',
                            type: 'application/pdf'
                        }
                    ],
                    requiresSignature: false,
                    courseName: 'AWS Solutions Architect Professional',
                    trainingProvider: 'AWS Training',
                    courseDuration: '5 days',
                    businessJustification: 'Required for upcoming cloud migration project'
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
                        createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
                        deadline: { type: 'string', format: 'date', example: getFutureDate(7) }
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
                timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
                path: { type: 'string', example: '/approvals' }
            }
        }
    })
    create(@Body() createApprovalDto: CreateApprovalDto, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.create(createApprovalDto, req.user);
    }

    // Get all approvals with filtering and pagination
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
        summary: '📋 Get all approvals with advanced filtering',
        description: createApiDescription(
            'Retrieve a comprehensive, paginated list of approval requests with advanced filtering and search capabilities.',
            'The service method `ApprovalsService.findAll()` retrieves approvals based on query parameters, applies filters, pagination, and access control. It returns a paginated list with metadata including pending counts, overdue counts, and total values.',
            'ApprovalsService',
            'findAll',
            'retrieves approvals with filtering, pagination, and access control',
            'a paginated response object containing approval data, pagination metadata, metrics, and applied filters',
            ['Access control', 'Filtering and search', 'Pagination', 'Metrics calculation'],
        ) + `

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
                timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
                path: { type: 'string', example: '/approvals' }
            }
        }
    })
    findAll(@Query() query: ApprovalQueryDto, @Req() req: AuthenticatedRequest) {
        this.logger.debug(`Finding all approvals with filters: ${JSON.stringify(query)}`);
        const accessScope = this.getAccessScope(req.user);
        
        this.logger.debug('🔍 DEBUG findAll route:', {
            requestingUser: {
                uid: req.user?.uid,
                accessLevel: req.user?.accessLevel || req.user?.role,
                isElevated: accessScope.isElevated,
            },
            accessScope: {
                orgId: accessScope.orgId,
                branchId: accessScope.branchId,
                orgWideAccess: accessScope.branchId === null,
            },
        });

        return this.approvalsService.findAll(query, req.user);
    }

    // Get approvals pending for current user
    @Get('pending')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: '⏳ Get pending approvals for current user',
        description: `
# Pending Approvals Dashboard

Retrieve all approval requests that require immediate action from the currently authenticated user as an approver or delegate.

## 🎯 **Primary Use Cases**
- **Manager Dashboard**: Quick access to all pending decisions requiring managerial approval
- **HR Processing**: Employee requests awaiting HR review and approval
- **Financial Control**: Purchase orders and expense claims requiring financial approval
- **Delegation Management**: Approvals delegated to the current user by other approvers
- **Priority Management**: Urgent approvals that need immediate attention

## 📋 **What's Included**
- **Personal Queue**: Approvals assigned directly to the authenticated user
- **Delegated Queue**: Approvals delegated to the user by others
- **Priority Sorting**: Urgent and high-priority approvals listed first
- **Complete Context**: Full approval details including requester info, amounts, and deadlines
- **Action Readiness**: All information needed to make informed approval decisions

## ⚡ **Smart Filtering**
- **Status-based**: Automatically filters for actionable statuses (PENDING, ADDITIONAL_INFO_REQUIRED, ESCALATED)
- **Authority-based**: Only shows approvals where user has approval authority
- **Organization-scoped**: Respects organizational and branch boundaries
- **Time-sensitive**: Prioritizes overdue and urgent requests

## 🔧 **Features**
- **Real-time Updates**: Live updates as new approvals are assigned
- **Deadline Tracking**: Clear visibility of approaching deadlines
- **Escalation Alerts**: Highlights escalated approvals requiring senior attention
- **Bulk Processing**: Foundation for bulk approval actions
- **Mobile Optimized**: Responsive design for mobile approval workflows

## 📊 **Performance Optimizations**
- **Intelligent Caching**: Cached results for faster dashboard loading
- **Optimized Queries**: Efficient database queries with proper indexing
- **Minimal Data Transfer**: Only essential data for quick decision-making
- **Progressive Loading**: Supports pagination for large approval queues
        `
    })
    @ApiOkResponse({ 
        description: '✅ Pending approvals retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 12345 },
                            approvalReference: { type: 'string', example: 'LEA-KBGT6-H4P' },
                            title: { type: 'string', example: 'Annual Leave Request - Sarah Johnson' },
                            description: { type: 'string', example: 'Requesting 7 days annual leave for wedding celebration' },
                            type: { type: 'string', example: 'LEAVE_REQUEST' },
                            status: { type: 'string', example: 'PENDING' },
                            priority: { type: 'string', example: 'HIGH' },
                            amount: { type: 'number', example: null },
                            currency: { type: 'string', example: null },
                            deadline: { type: 'string', format: 'date', example: '2024-01-20' },
                            isOverdue: { type: 'boolean', example: false },
                            isUrgent: { type: 'boolean', example: true },
                            isEscalated: { type: 'boolean', example: false },
                            daysPending: { type: 'number', example: 2.5 },
                            requester: {
                                type: 'object',
                                properties: {
                                    uid: { type: 'number', example: 67 },
                                    name: { type: 'string', example: 'Sarah Johnson' },
                                    email: { type: 'string', example: 'sarah.johnson@loro.co.za' },
                                    department: { type: 'string', example: 'Marketing' },
                                    photoURL: { type: 'string', example: 'https://avatar.loro.co.za/sarah-j.jpg' }
                                }
                            },
                            submittedAt: { type: 'string', format: 'date-time', example: '2024-01-10T14:30:00Z' },
                            entityType: { type: 'string', example: 'leave_application' },
                            entityId: { type: 'string', example: 'LEAVE-2024-045' },
                            supportingDocuments: {
                                type: 'array',
                                items: { type: 'string' },
                                example: ['https://docs.loro.co.za/leaves/wedding-invitation.pdf']
                            },
                            escalationInfo: {
                                type: 'object',
                                properties: {
                                    level: { type: 'number', example: 0 },
                                    reason: { type: 'string', example: null },
                                    escalatedAt: { type: 'string', format: 'date-time', example: null }
                                }
                            }
                        }
                    }
                },
                count: { type: 'number', example: 8, description: 'Total number of pending approvals' },
                summary: {
                    type: 'object',
                    properties: {
                        urgent: { type: 'number', example: 3 },
                        overdue: { type: 'number', example: 1 },
                        escalated: { type: 'number', example: 0 },
                        byType: {
                            type: 'object',
                            properties: {
                                LEAVE_REQUEST: { type: 'number', example: 4 },
                                EXPENSE_CLAIM: { type: 'number', example: 2 },
                                PURCHASE_ORDER: { type: 'number', example: 2 }
                            }
                        },
                        totalValue: { type: 'number', example: 45600.00, description: 'Total monetary value requiring approval' }
                    }
                },
                message: { type: 'string', example: 'Pending approvals retrieved successfully' }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - User lacks approval permissions',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'You do not have approval permissions in this organization' },
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
                message: { type: 'string', example: 'Failed to retrieve pending approvals due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
                path: { type: 'string', example: '/approvals/pending' }
            }
        }
    })
    getPendingApprovals(@Req() req: AuthenticatedRequest) {
        this.logger.debug(`Getting pending approvals for user ${req.user?.uid}`);
        const accessScope = this.getAccessScope(req.user);
        
        this.logger.debug('🔍 DEBUG getPendingApprovals route:', {
            requestingUser: {
                uid: req.user?.uid,
                accessLevel: req.user?.accessLevel || req.user?.role,
                isElevated: accessScope.isElevated,
            },
            accessScope: {
                orgId: accessScope.orgId,
                branchId: accessScope.branchId,
                orgWideAccess: accessScope.branchId === null,
            },
        });

        return this.approvalsService.getPendingApprovals(req.user);
    }

    // Get approvals submitted by current user
    @Get('my-requests')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: '📤 Get approval requests submitted by current user',
        description: `
# My Approval Requests

Retrieve all approval requests that were submitted by the currently authenticated user, providing complete visibility into personal approval history and status.

## 🎯 **Primary Use Cases**
- **Personal Dashboard**: Track all submitted approval requests and their current status
- **Status Monitoring**: Monitor progress of pending requests through approval workflows
- **History Review**: Access complete history of past approval requests and outcomes
- **Resubmission Planning**: Identify rejected requests that may need resubmission
- **Compliance Tracking**: Maintain personal records for audit and compliance purposes

## 📋 **Comprehensive Tracking**
- **All Statuses**: Draft, pending, approved, rejected, withdrawn, and completed requests
- **Complete Timeline**: Submission dates, approval dates, and completion timestamps
- **Decision Details**: Approval comments, rejection reasons, and condition requirements
- **Document History**: Supporting documents and attachments for each request
- **Version Control**: Track modifications and resubmissions of approval requests

## 🔍 **Advanced Filtering & Search**
- **Status Filtering**: Filter by specific approval statuses for focused views
- **Type Filtering**: Filter by approval type (leave, expense, purchase, etc.)
- **Date Range**: Filter by submission date, approval date, or deadline
- **Search Capability**: Full-text search across titles, descriptions, and reference numbers
- **Amount Filtering**: Filter financial approvals by monetary ranges

## 📊 **Smart Analytics**
- **Response Time Tracking**: Average time from submission to approval
- **Success Rate Analysis**: Approval vs. rejection ratios by type
- **Trend Identification**: Patterns in approval types and frequencies
- **Performance Insights**: Peak submission times and seasonal patterns

## 🔧 **Enhanced Features**
- **Bulk Operations**: Select and perform actions on multiple requests
- **Export Capabilities**: Download approval history for reporting
- **Mobile Optimization**: Full functionality on mobile devices
- **Real-time Updates**: Live status updates as approvals progress
- **Smart Notifications**: Alerts for status changes and required actions
        `
    })
    @ApiOkResponse({ 
        description: '✅ User approval requests retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 12345 },
                            approvalReference: { type: 'string', example: 'EXP-QR8T2-M9K' },
                            title: { type: 'string', example: 'Business Travel Expense Claim - Client Meeting' },
                            description: { type: 'string', example: 'Reimbursement for travel expenses to Cape Town for client presentation' },
                            type: { type: 'string', example: 'EXPENSE_CLAIM' },
                            status: { type: 'string', example: 'APPROVED' },
                            priority: { type: 'string', example: 'MEDIUM' },
                            amount: { type: 'number', example: 2850.50 },
                            currency: { type: 'string', example: 'ZAR' },
                            deadline: { type: 'string', format: 'date', example: '2024-01-25' },
                            isOverdue: { type: 'boolean', example: false },
                            isUrgent: { type: 'boolean', example: false },
                            approver: {
                                type: 'object',
                                properties: {
                                    uid: { type: 'number', example: 89 },
                                    name: { type: 'string', example: 'Michael Thompson' },
                                    email: { type: 'string', example: 'michael.thompson@loro.co.za' },
                                    title: { type: 'string', example: 'Finance Manager' }
                                }
                            },
                            createdAt: { type: 'string', format: 'date-time', example: '2024-01-08T09:15:00Z' },
                            submittedAt: { type: 'string', format: 'date-time', example: '2024-01-08T09:20:00Z' },
                            approvedAt: { type: 'string', format: 'date-time', example: '2024-01-12T16:45:00Z' },
                            approvalComments: { type: 'string', example: 'Approved - all receipts verified and amounts are reasonable' },
                            rejectionReason: { type: 'string', example: null },
                            canEdit: { type: 'boolean', example: false },
                            canWithdraw: { type: 'boolean', example: false },
                            canResubmit: { type: 'boolean', example: false },
                            processingDays: { type: 'number', example: 4.3 },
                            supportingDocuments: {
                                type: 'array',
                                items: { type: 'string' },
                                example: [
                                    'https://docs.loro.co.za/expenses/flight-receipt-12345.pdf',
                                    'https://docs.loro.co.za/expenses/hotel-receipt-12345.pdf'
                                ]
                            }
                        }
                    }
                },
                pagination: {
                    type: 'object',
                    properties: {
                        page: { type: 'number', example: 1 },
                        limit: { type: 'number', example: 20 },
                        total: { type: 'number', example: 45 },
                        totalPages: { type: 'number', example: 3 },
                        hasNext: { type: 'boolean', example: true },
                        hasPrev: { type: 'boolean', example: false }
                    }
                },
                summary: {
                    type: 'object',
                    properties: {
                        total: { type: 'number', example: 45 },
                        pending: { type: 'number', example: 3 },
                        approved: { type: 'number', example: 38 },
                        rejected: { type: 'number', example: 4 },
                        draft: { type: 'number', example: 0 },
                        totalRequested: { type: 'number', example: 125600.75 },
                        totalApproved: { type: 'number', example: 118400.25 },
                        averageProcessingTime: { type: 'number', example: 3.8, description: 'Days' },
                        approvalRate: { type: 'number', example: 0.91, description: 'Percentage as decimal' }
                    }
                },
                message: { type: 'string', example: 'Your approval requests retrieved successfully' }
            }
        }
    })
    @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (1-based, default: 1)' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (max 100, default: 20)' })
    @ApiQuery({ name: 'search', required: false, type: String, description: 'Search in title, description, and reference number' })
    @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'], description: 'Filter by approval status' })
    @ApiQuery({ name: 'type', required: false, description: 'Filter by approval type' })
    @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'submittedAt', 'approvedAt', 'deadline', 'amount'], description: 'Sort field' })
    @ApiQuery({ name: 'sortOrder', required: false, enum: ['ASC', 'DESC'], description: 'Sort order (default: DESC)' })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Cannot view requests from this organization',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Access denied to approval requests in this organization' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Database query failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to retrieve user approval requests' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 }
            }
        }
    })
    getMyRequests(@Query() query: ApprovalQueryDto, @Req() req: AuthenticatedRequest) {
        this.logger.debug(`Getting my requests for user ${req.user?.uid}`);
        const accessScope = this.getAccessScope(req.user);
        
        this.logger.debug('🔍 DEBUG getMyRequests route:', {
            requestingUser: {
                uid: req.user?.uid,
                accessLevel: req.user?.accessLevel || req.user?.role,
                isElevated: accessScope.isElevated,
            },
            accessScope: {
                orgId: accessScope.orgId,
                branchId: accessScope.branchId,
                orgWideAccess: accessScope.branchId === null,
            },
        });

        return this.approvalsService.getMyRequests(query, req.user);
    }

    // Get comprehensive approval history for a specific user (matching warnings pattern)
    @Get('user/:ref')
    @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER, AccessLevel.USER)
    @ApiOperation({ 
        summary: '👤 Get comprehensive approval history for a specific user',
        description: 'Retrieve complete approval history for a specific user with analytics and patterns, matching the warnings pattern for consistency.'
    })
    @ApiParam({
        name: 'ref',
        description: 'User Clerk ID to retrieve approval history for (string). Returns approvals where user is requester, approver, or delegatedTo.',
        example: 'user_abc123',
        schema: { type: 'string' }
    })
    @ApiOkResponse({
        description: '✅ User approval history retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                data: {
                    type: 'object',
                    properties: {
                        employee: {
                            type: 'object',
                            properties: {
                                uid: { type: 'number', example: 123 },
                                name: { type: 'string', example: 'John' },
                                surname: { type: 'string', example: 'Doe' },
                                email: { type: 'string', example: 'john.doe@company.com' }
                            }
                        },
                        approvals: {
                            type: 'array',
                            items: { type: 'object' }
                        },
                        analytics: {
                            type: 'object',
                            properties: {
                                summary: {
                                    type: 'object',
                                    properties: {
                                        totalApprovals: { type: 'number', example: 15 },
                                        pendingApprovals: { type: 'number', example: 2 },
                                        approvedApprovals: { type: 'number', example: 10 },
                                        rejectedApprovals: { type: 'number', example: 3 },
                                        draftApprovals: { type: 'number', example: 1 },
                                        withdrawnApprovals: { type: 'number', example: 0 }
                                    }
                                },
                                byType: { type: 'object', additionalProperties: { type: 'number' } },
                                byStatus: { type: 'object', additionalProperties: { type: 'number' } }
                            }
                        }
                    }
                },
                message: { type: 'string', example: 'User approval history retrieved successfully' }
            }
        }
    })
    getUserApprovals(@Param('ref') ref: string) {
        return this.approvalsService.getUserApprovals(ref);
    }

    // Get approval statistics/dashboard data
    @Get('stats')
    @Roles(AccessLevel.MANAGER)
    @ApiOperation({ 
        summary: '📊 Get comprehensive approval statistics and analytics',
        description: `
# Approval Analytics Dashboard

Generate comprehensive statistics and analytics about approval workflows for executive decision-making, process optimization, and compliance reporting.

## 🎯 **Executive Use Cases**
- **Management Dashboard**: High-level overview of organizational approval performance
- **Process Optimization**: Identify bottlenecks and inefficiencies in approval workflows
- **Compliance Reporting**: Generate reports for regulatory and audit requirements
- **Performance Analytics**: Track approval processing times and success rates
- **Resource Planning**: Understand approval volumes and plan resource allocation

## 📈 **Comprehensive Analytics**
- **Volume Metrics**: Total approvals processed, pending queue sizes, and processing rates
- **Performance Indicators**: Average processing times, approval rates, and escalation frequencies
- **Financial Analytics**: Total monetary values under review and approved amounts
- **Trend Analysis**: Historical patterns, seasonal variations, and growth trends
- **User Performance**: Individual approver statistics and workload distribution

## 🔍 **Advanced Insights**
- **Bottleneck Identification**: Pinpoint stages where approvals get delayed
- **Risk Assessment**: Identify high-risk approval patterns and compliance gaps
- **Efficiency Metrics**: Processing velocity, turnaround times, and resource utilization
- **Quality Indicators**: Rejection rates, resubmission frequencies, and error patterns
- **Compliance Tracking**: Audit trail completeness and regulatory adherence

## 📊 **Multi-dimensional Analysis**
- **By Type**: Breakdown statistics by approval type (leave, expense, purchase, etc.)
- **By Priority**: Analysis of urgent vs. standard approval processing
- **By Department**: Cross-departmental approval patterns and performance
- **By User Role**: Manager, admin, and executive approval behaviors
- **By Time Period**: Daily, weekly, monthly, and quarterly trend analysis

## 🎛️ **Customizable Dashboards**
- **Real-time Updates**: Live statistics with automatic refresh capabilities
- **Configurable Views**: Customize metrics display based on user role and preferences
- **Export Functionality**: Generate reports in PDF, Excel, and CSV formats
- **Drill-down Capability**: Click through to detailed views and individual records
- **Comparative Analysis**: Year-over-year and period-over-period comparisons
        `
    })
    @ApiOkResponse({ 
        description: '✅ Approval statistics retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                summary: {
                    type: 'object',
                    properties: {
                        total: { type: 'number', example: 2847, description: 'Total approvals in system' },
                        pending: { type: 'number', example: 73, description: 'Currently pending approvals' },
                        approved: { type: 'number', example: 2456, description: 'Total approved requests' },
                        rejected: { type: 'number', example: 298, description: 'Total rejected requests' },
                        overdue: { type: 'number', example: 12, description: 'Overdue approvals' },
                        escalated: { type: 'number', example: 8, description: 'Escalated approvals' },
                        withdrawn: { type: 'number', example: 20, description: 'Withdrawn requests' }
                    }
                },
                byType: {
                    type: 'object',
                    properties: {
                        LEAVE_REQUEST: {
                            type: 'object',
                            properties: {
                                total: { type: 'number', example: 1204 },
                                pending: { type: 'number', example: 28 },
                                approved: { type: 'number', example: 1089 },
                                rejected: { type: 'number', example: 87 },
                                averageProcessingDays: { type: 'number', example: 2.3 },
                                approvalRate: { type: 'number', example: 0.93 }
                            }
                        },
                        EXPENSE_CLAIM: {
                            type: 'object',
                            properties: {
                                total: { type: 'number', example: 856 },
                                pending: { type: 'number', example: 19 },
                                approved: { type: 'number', example: 743 },
                                rejected: { type: 'number', example: 94 },
                                averageProcessingDays: { type: 'number', example: 4.1 },
                                approvalRate: { type: 'number', example: 0.89 },
                                totalValue: { type: 'number', example: 2450600.75 },
                                averageAmount: { type: 'number', example: 2863.62 }
                            }
                        },
                        PURCHASE_ORDER: {
                            type: 'object',
                            properties: {
                                total: { type: 'number', example: 423 },
                                pending: { type: 'number', example: 15 },
                                approved: { type: 'number', example: 356 },
                                rejected: { type: 'number', example: 52 },
                                averageProcessingDays: { type: 'number', example: 6.8 },
                                approvalRate: { type: 'number', example: 0.87 },
                                totalValue: { type: 'number', example: 8950400.00 },
                                averageAmount: { type: 'number', example: 21163.13 }
                            }
                        }
                    }
                },
                byPriority: {
                    type: 'object',
                    properties: {
                        URGENT: {
                            type: 'object',
                            properties: {
                                total: { type: 'number', example: 145 },
                                pending: { type: 'number', example: 8 },
                                averageProcessingHours: { type: 'number', example: 18.5 },
                                escalationRate: { type: 'number', example: 0.12 }
                            }
                        },
                        HIGH: {
                            type: 'object',
                            properties: {
                                total: { type: 'number', example: 687 },
                                pending: { type: 'number', example: 23 },
                                averageProcessingDays: { type: 'number', example: 2.8 },
                                escalationRate: { type: 'number', example: 0.05 }
                            }
                        },
                        MEDIUM: {
                            type: 'object',
                            properties: {
                                total: { type: 'number', example: 1534 },
                                pending: { type: 'number', example: 31 },
                                averageProcessingDays: { type: 'number', example: 4.2 },
                                escalationRate: { type: 'number', example: 0.02 }
                            }
                        },
                        LOW: {
                            type: 'object',
                            properties: {
                                total: { type: 'number', example: 481 },
                                pending: { type: 'number', example: 11 },
                                averageProcessingDays: { type: 'number', example: 7.1 },
                                escalationRate: { type: 'number', example: 0.01 }
                            }
                        }
                    }
                },
                performance: {
                    type: 'object',
                    properties: {
                        averageProcessingTime: { type: 'number', example: 3.8, description: 'Days' },
                        medianProcessingTime: { type: 'number', example: 2.1, description: 'Days' },
                        overallApprovalRate: { type: 'number', example: 0.895, description: 'Percentage as decimal' },
                        escalationRate: { type: 'number', example: 0.034, description: 'Percentage as decimal' },
                        onTimeCompletionRate: { type: 'number', example: 0.912, description: 'Percentage as decimal' },
                        firstTimeApprovalRate: { type: 'number', example: 0.867, description: 'Approved without resubmission' }
                    }
                },
                trends: {
                    type: 'object',
                    properties: {
                        last30Days: {
                            type: 'object',
                            properties: {
                                totalSubmitted: { type: 'number', example: 186 },
                                totalProcessed: { type: 'number', example: 174 },
                                averageProcessingTime: { type: 'number', example: 3.2 },
                                trendDirection: { type: 'string', example: 'improving' }
                            }
                        },
                        monthOverMonth: {
                            type: 'object',
                            properties: {
                                volumeChange: { type: 'number', example: 0.12, description: 'Percentage change' },
                                processingTimeChange: { type: 'number', example: -0.08, description: 'Percentage change' },
                                approvalRateChange: { type: 'number', example: 0.03, description: 'Percentage change' }
                            }
                        }
                    }
                },
                financials: {
                    type: 'object',
                    properties: {
                        totalValuePending: { type: 'number', example: 485600.50 },
                        totalValueApproved: { type: 'number', example: 18950400.75 },
                        totalValueRejected: { type: 'number', example: 1250300.25 },
                        averageApprovalAmount: { type: 'number', example: 7713.42 },
                        largestPendingApproval: { type: 'number', example: 125000.00 },
                        budgetUtilization: { type: 'number', example: 0.73, description: 'Percentage as decimal' }
                    }
                },
                userInfo: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 123 },
                        accessLevel: { type: 'string', example: 'MANAGER' },
                        canApprove: { type: 'boolean', example: true },
                        organizationScope: { type: 'string', example: 'ORG123' },
                        branchScope: { type: 'number', example: 456 }
                    }
                },
                lastUpdated: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
                message: { type: 'string', example: 'Approval statistics retrieved successfully' }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Manager role or higher required',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Manager role or higher required to view approval statistics' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Statistics calculation failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to calculate approval statistics' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 }
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
        summary: '🔍 Get detailed approval information by ID',
        description: `
# Detailed Approval View

Retrieve comprehensive information about a specific approval request, including complete history, signatures, and all related metadata.

## 🎯 **Primary Use Cases**
- **Detailed Review**: Complete approval information for informed decision-making
- **Audit Trail**: Full history of actions and status changes for compliance
- **Status Tracking**: Real-time status and progress information
- **Document Access**: Supporting documents and digital signatures
- **Investigation**: Deep dive into approval details for dispute resolution

## 📋 **Complete Information Package**
- **Core Details**: Title, description, type, status, priority, and amounts
- **Stakeholder Information**: Requester, approver, and delegation details
- **Timeline Data**: Creation, submission, deadline, and completion timestamps
- **Decision Details**: Approval comments, rejection reasons, and conditions
- **Supporting Evidence**: Documents, attachments, and external references

## 🔐 **Advanced Security Features**
- **Access Validation**: Strict permission checking based on user role and relationship
- **Organization Scoping**: Automatic filtering by organization and branch boundaries
- **Audit Logging**: All access attempts logged for security monitoring
- **Data Masking**: Sensitive information masked based on user permissions
- **Version Control**: Track changes and maintain integrity of approval data

## 📊 **Enhanced Data Relations**
- **User Details**: Complete information about all involved parties
- **Organization Context**: Branch, department, and hierarchical information
- **Entity Relations**: Connected records (leave applications, purchase orders, etc.)
- **Workflow State**: Current step in multi-stage approval processes
- **History Timeline**: Chronological sequence of all actions and changes

## 🔧 **Advanced Features**
- **Real-time Updates**: Live status changes and notifications
- **Action Recommendations**: Suggested next steps based on current state
- **Related Approvals**: Links to similar or dependent approval requests
- **Performance Metrics**: Processing time and efficiency indicators
- **Export Options**: Generate PDF reports or extract data for external systems
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Unique approval identifier', 
        type: 'number',
        example: 12345
    })
    @ApiOkResponse({ 
        description: '✅ Approval details retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                approvalReference: { type: 'string', example: 'PUR-8XQ2K-L7M' },
                title: { type: 'string', example: 'Office Equipment Purchase - Marketing Department' },
                description: { type: 'string', example: 'Purchase of 3 new laptops and 2 monitors for expanding marketing team' },
                type: { type: 'string', example: 'PURCHASE_ORDER' },
                status: { type: 'string', example: 'APPROVED' },
                priority: { type: 'string', example: 'HIGH' },
                flowType: { type: 'string', example: 'SINGLE_APPROVER' },
                amount: { type: 'number', example: 45600.00 },
                currency: { type: 'string', example: 'ZAR' },
                deadline: { type: 'string', format: 'date', example: '2024-01-30' },
                isOverdue: { type: 'boolean', example: false },
                isUrgent: { type: 'boolean', example: true },
                isEscalated: { type: 'boolean', example: false },
                requiresSignature: { type: 'boolean', example: true },
                isSigned: { type: 'boolean', example: true },
                signatureType: { type: 'string', example: 'ELECTRONIC' },
                requester: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 89 },
                        name: { type: 'string', example: 'Jennifer Martinez' },
                        surname: { type: 'string', example: 'Marketing Manager' },
                        email: { type: 'string', example: 'jennifer.martinez@loro.co.za' },
                        accessLevel: { type: 'string', example: 'MANAGER' },
                        photoURL: { type: 'string', example: 'https://avatar.loro.co.za/jennifer-m.jpg' },
                        department: { type: 'string', example: 'Marketing' }
                    }
                },
                approver: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 23 },
                        name: { type: 'string', example: 'David Chen' },
                        surname: { type: 'string', example: 'Finance Director' },
                        email: { type: 'string', example: 'david.chen@loro.co.za' },
                        accessLevel: { type: 'string', example: 'ADMIN' },
                        photoURL: { type: 'string', example: 'https://avatar.loro.co.za/david-c.jpg' }
                    }
                },
                organisation: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 1 },
                        name: { type: 'string', example: 'Loro Technologies' },
                        ref: { type: 'string', example: 'ORG123' }
                    }
                },
                branch: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 5 },
                        name: { type: 'string', example: 'Johannesburg Head Office' },
                        ref: { type: 'string', example: 'JHB-HO' }
                    }
                },
                entityType: { type: 'string', example: 'purchase_order' },
                entityId: { type: 'string', example: 'PO-2024-0087' },
                entityData: {
                    type: 'object',
                    properties: {
                        vendor: { type: 'string', example: 'Dell Technologies' },
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    description: { type: 'string', example: 'Dell Latitude 7420 Laptop' },
                                    quantity: { type: 'number', example: 3 },
                                    unitPrice: { type: 'number', example: 12800.00 },
                                    totalPrice: { type: 'number', example: 38400.00 }
                                }
                            }
                        },
                        deliveryDate: { type: 'string', format: 'date', example: '2024-02-15' }
                    }
                },
                createdAt: { type: 'string', format: 'date-time', example: '2024-01-10T08:30:00Z' },
                submittedAt: { type: 'string', format: 'date-time', example: '2024-01-10T09:15:00Z' },
                approvedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:20:00Z' },
                signedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:25:00Z' },
                approvalComments: { type: 'string', example: 'Approved - equipment needed for Q1 marketing campaign. Ensure delivery by mid-February.' },
                supportingDocuments: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'https://docs.loro.co.za/po/dell-quote-87432.pdf',
                        'https://docs.loro.co.za/po/budget-approval-form.pdf'
                    ]
                },
                history: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 567 },
                            action: { type: 'string', example: 'APPROVE' },
                            fromStatus: { type: 'string', example: 'PENDING' },
                            toStatus: { type: 'string', example: 'APPROVED' },
                            actionBy: { type: 'number', example: 23 },
                            actionByUser: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string', example: 'David Chen' },
                                    email: { type: 'string', example: 'david.chen@loro.co.za' }
                                }
                            },
                            comments: { type: 'string', example: 'Approved after budget verification' },
                            createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:20:00Z' }
                        }
                    }
                },
                signatures: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 89 },
                            signerUid: { type: 'number', example: 23 },
                            signatureType: { type: 'string', example: 'ELECTRONIC' },
                            signedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:25:00Z' },
                            isValid: { type: 'boolean', example: true },
                            certificateInfo: {
                                type: 'object',
                                properties: {
                                    issuer: { type: 'string', example: 'Loro Digital Certificates' },
                                    validFrom: { type: 'string', format: 'date-time', example: '2023-01-01T00:00:00Z' },
                                    validTo: { type: 'string', format: 'date-time', example: '2025-01-01T00:00:00Z' }
                                }
                            }
                        }
                    }
                },
                version: { type: 'number', example: 2 },
                processingDays: { type: 'number', example: 5.2 },
                currentUserPermissions: {
                    type: 'object',
                    properties: {
                        canEdit: { type: 'boolean', example: false },
                        canApprove: { type: 'boolean', example: false },
                        canReject: { type: 'boolean', example: false },
                        canWithdraw: { type: 'boolean', example: false },
                        canDelegate: { type: 'boolean', example: false },
                        canEscalate: { type: 'boolean', example: false },
                        canSign: { type: 'boolean', example: false },
                        canViewHistory: { type: 'boolean', example: true },
                        canViewSignatures: { type: 'boolean', example: true }
                    }
                }
            }
        }
    })
    @ApiNotFoundResponse({ 
        description: '❌ Approval not found or access denied',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval with ID 12345 not found or access denied' },
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
                message: { type: 'string', example: 'You do not have permission to view this approval' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'Approval belongs to different organization or you lack sufficient permissions' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Database query failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to retrieve approval details' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 }
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
        summary: '✏️ Update approval request',
        description: `
# Modify Approval Request

Update an existing approval request with new information, corrections, or additional details. Only draft approvals can be modified by the original requester.

## 🎯 **Primary Use Cases**
- **Draft Refinement**: Improve draft approvals before submission for review
- **Correction Updates**: Fix errors or add missing information to pending requests
- **Document Addition**: Attach additional supporting documents or evidence
- **Amount Adjustments**: Modify requested amounts based on updated quotes or requirements
- **Timeline Changes**: Update deadlines or urgency based on business needs

## 📋 **Updateable Fields**
- **Basic Information**: Title, description, priority, and type modifications
- **Financial Details**: Amount and currency adjustments for financial approvals
- **Timeline Management**: Deadline updates and urgency flag modifications
- **Supporting Evidence**: Addition or removal of supporting documents
- **Approval Routing**: Approver changes (before submission only)

## 🔐 **Security & Validation**
- **Ownership Verification**: Only original requester can modify their own requests
- **Status Restrictions**: Only draft and certain conditional statuses allow modifications
- **Business Rules**: Automatic validation of business logic and constraints
- **Audit Trail**: All changes tracked in approval history for transparency
- **Version Control**: Automatic version incrementing for change tracking

## ⚠️ **Important Restrictions**
- **Status Limitations**: Only DRAFT approvals can be freely modified
- **Ownership Rules**: Modifications restricted to original requester
- **Workflow Constraints**: Some fields locked once approval process begins
- **Organizational Boundaries**: Cannot move approvals between organizations
- **Amount Limits**: Large amount changes may require re-approval routing

## 🔧 **Advanced Features**
- **Smart Validation**: Real-time validation of updated data
- **Auto-save Draft**: Periodic saving to prevent data loss
- **Change Tracking**: Detailed logging of all modifications
- **Notification Management**: Optional notifications to stakeholders about changes
- **Rollback Capability**: Ability to revert to previous versions if needed
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier to update', 
        type: 'number',
        example: 12345
    })
    @ApiBody({ 
        type: UpdateApprovalDto,
        description: 'Approval update payload with modified fields',
        examples: {
            basicUpdate: {
                summary: '📝 Basic Information Update',
                description: 'Update title, description, and priority',
                value: {
                    title: 'Updated Annual Leave Request - Sarah Johnson - Family Emergency',
                    description: 'Updated request for 7 days annual leave due to family emergency - dates adjusted to March 20-27',
                    priority: 'URGENT',
                    isUrgent: true,
                    deadline: '2024-03-18'
                }
            },
            financialUpdate: {
                summary: '💰 Financial Details Update',
                description: 'Update monetary amounts and add supporting documents',
                value: {
                    title: 'Office Equipment Purchase - Updated Quote',
                    amount: 52400.00,
                    currency: 'ZAR',
                    supportingDocumentUrls: [
                        'https://docs.loro.co.za/quotes/dell-updated-quote-2024.pdf',
                        'https://docs.loro.co.za/approvals/budget-justification.pdf'
                    ],
                    customFields: {
                        vendor: 'Dell Technologies',
                        quoteVersion: '2.1',
                        deliveryDate: '2024-02-20'
                    }
                }
            },
            documentUpdate: {
                summary: '📎 Document Addition',
                description: 'Add additional supporting documents',
                value: {
                    supportingDocumentUrls: [
                        'https://docs.loro.co.za/medical/doctors-certificate.pdf',
                        'https://docs.loro.co.za/forms/emergency-leave-form.pdf'
                    ],
                    metadata: {
                        documentationComplete: true,
                        urgencyJustification: 'Medical emergency requiring immediate family support'
                    }
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Approval updated successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                approvalReference: { type: 'string', example: 'LEA-8XQ2K-L7M' },
                title: { type: 'string', example: 'Updated Annual Leave Request - Sarah Johnson - Family Emergency' },
                description: { type: 'string', example: 'Updated request for 7 days annual leave due to family emergency' },
                type: { type: 'string', example: 'LEAVE_REQUEST' },
                status: { type: 'string', example: 'DRAFT' },
                priority: { type: 'string', example: 'URGENT' },
                amount: { type: 'number', example: null },
                currency: { type: 'string', example: null },
                deadline: { type: 'string', format: 'date', example: '2024-03-18' },
                isUrgent: { type: 'boolean', example: true },
                version: { type: 'number', example: 3 },
                updatedAt: { type: 'string', format: 'date-time', example: '2024-03-10T16:45:00Z' },
                changes: {
                    type: 'object',
                    description: 'Summary of changes made',
                    properties: {
                        title: {
                            type: 'object',
                            properties: {
                                from: { type: 'string', example: 'Annual Leave Request - Sarah Johnson' },
                                to: { type: 'string', example: 'Updated Annual Leave Request - Sarah Johnson - Family Emergency' }
                            }
                        },
                        priority: {
                            type: 'object',
                            properties: {
                                from: { type: 'string', example: 'MEDIUM' },
                                to: { type: 'string', example: 'URGENT' }
                            }
                        },
                        deadline: {
                            type: 'object',
                            properties: {
                                from: { type: 'string', example: '2024-03-25' },
                                to: { type: 'string', example: '2024-03-18' }
                            }
                        }
                    }
                },
                supportingDocuments: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'https://docs.loro.co.za/medical/doctors-certificate.pdf',
                        'https://docs.loro.co.za/forms/emergency-leave-form.pdf'
                    ]
                },
                lastModifiedBy: { type: 'number', example: 89 },
                canSubmit: { type: 'boolean', example: true },
                validationStatus: {
                    type: 'object',
                    properties: {
                        isValid: { type: 'boolean', example: true },
                        errors: { type: 'array', items: { type: 'string' }, example: [] },
                        warnings: { 
                            type: 'array', 
                            items: { type: 'string' }, 
                            example: ['Urgent priority may require additional justification'] 
                        }
                    }
                },
                message: { type: 'string', example: 'Approval updated successfully' }
            }
        }
    })
    @ApiBadRequestResponse({ 
        description: '❌ Invalid update data or approval cannot be modified',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot modify approval in current status or validation failed' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Cannot modify approval in PENDING status',
                        'Amount exceeds maximum limit for this approval type',
                        'Deadline cannot be in the past',
                        'Invalid document URL format'
                    ]
                },
                currentStatus: { type: 'string', example: 'PENDING' },
                allowedStatuses: { 
                    type: 'array', 
                    items: { type: 'string' }, 
                    example: ['DRAFT'] 
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Cannot modify this approval',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Only the original requester can modify this approval' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'Approval belongs to different user or status does not allow modifications' },
                requesterUid: { type: 'number', example: 89 },
                currentUserUid: { type: 'number', example: 123 }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ Approval not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval with ID 12345 not found' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Update operation failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to update approval due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 }
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
        summary: '📤 Submit approval request for review',
        description: `
# Submit for Review

Submit a draft approval request for formal review and decision-making. This action transitions the approval from draft status to pending and initiates the approval workflow.

## 🎯 **Primary Use Cases**
- **Workflow Initiation**: Begin formal approval process after completing draft preparation
- **Review Request**: Submit completed request to designated approvers for decision
- **Process Automation**: Trigger automated workflows and notification systems
- **Compliance Activation**: Initiate required compliance and audit tracking
- **Timeline Management**: Start official processing timers and deadline tracking

## 📋 **Submission Requirements**
- **Status Validation**: Only draft approvals can be submitted for review
- **Completeness Check**: Ensure all required fields and documents are provided
- **Approver Assignment**: Verify designated approver is available and authorized
- **Business Rules**: Validate against organizational policies and approval limits
- **Document Verification**: Confirm all supporting documents are accessible

## ⚡ **Automated Actions**
- **Status Transition**: Automatic change from DRAFT to PENDING status
- **Timestamp Recording**: Official submission time for SLA tracking
- **Notification Dispatch**: Immediate alerts to approvers and stakeholders
- **Workflow Activation**: Trigger approval routing and escalation timers
- **History Logging**: Record submission event in approval history

## 🔔 **Notification & Communication**
- **Approver Alerts**: Immediate email and push notifications to assigned approvers
- **Manager Updates**: Notifications to reporting managers for awareness
- **Requester Confirmation**: Submission confirmation with reference number
- **Calendar Integration**: Automatic calendar events for deadline tracking
- **Mobile Sync**: Real-time updates to mobile applications

## 🚨 **Important Considerations**
- **Irreversible Action**: Cannot revert to draft once submitted (withdrawal required)
- **Edit Restrictions**: Limited modifications allowed after submission
- **SLA Activation**: Official processing timers begin upon submission
- **Approval Pressure**: Creates commitment for timely approver response
- **Audit Trail**: Permanent record of submission time and circumstances
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier to submit', 
        type: 'number',
        example: 12345
    })
    @ApiOkResponse({ 
        description: '📤 Approval submitted for review successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                approvalReference: { type: 'string', example: 'EXP-9XR2L-M8K' },
                title: { type: 'string', example: 'Business Conference Attendance - Tech Summit 2024' },
                status: { type: 'string', example: 'PENDING' },
                submittedAt: { type: 'string', format: 'date-time', example: '2024-03-15T10:30:00Z' },
                deadline: { type: 'string', format: 'date', example: '2024-03-22' },
                approver: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 45 },
                        name: { type: 'string', example: 'Michael Thompson' },
                        email: { type: 'string', example: 'michael.thompson@loro.co.za' },
                        title: { type: 'string', example: 'Department Manager' }
                    }
                },
                estimatedResponseTime: { type: 'string', example: '2-3 business days' },
                nextSteps: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Approval notification sent to Michael Thompson',
                        'Awaiting approver review and decision',
                        'You will be notified once a decision is made'
                    ]
                },
                notifications: {
                    type: 'object',
                    properties: {
                        emailSent: { type: 'boolean', example: true },
                        pushSent: { type: 'boolean', example: true },
                        recipientCount: { type: 'number', example: 2 },
                        notifiedUsers: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'michael.thompson@loro.co.za',
                                'hr-notifications@loro.co.za'
                            ]
                        }
                    }
                },
                tracking: {
                    type: 'object',
                    properties: {
                        slaStartTime: { type: 'string', format: 'date-time', example: '2024-03-15T10:30:00Z' },
                        expectedResponseBy: { type: 'string', format: 'date-time', example: '2024-03-19T17:00:00Z' },
                        urgencyLevel: { type: 'string', example: 'STANDARD' },
                        escalationTrigger: { type: 'string', format: 'date-time', example: '2024-03-20T09:00:00Z' }
                    }
                },
                compliance: {
                    type: 'object',
                    properties: {
                        auditTrailId: { type: 'string', example: 'AUDIT-2024-03-15-10-30-12345' },
                        complianceLevel: { type: 'string', example: 'STANDARD' },
                        retentionPeriod: { type: 'string', example: '7 years' },
                        digitalSignatureRequired: { type: 'boolean', example: false }
                    }
                },
                message: { type: 'string', example: 'Approval submitted for review successfully' }
            }
        }
    })
    @ApiBadRequestResponse({
        description: '❌ Invalid submission - Requirements not met',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot submit approval due to validation errors' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Only draft approvals can be submitted for review',
                        'Approval title is required and cannot be empty',
                        'Supporting documents are required for this approval type',
                        'Designated approver is not available or unauthorized',
                        'Amount exceeds organizational approval limits'
                    ]
                },
                currentStatus: { type: 'string', example: 'PENDING' },
                requiredFields: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['title', 'description', 'supportingDocuments']
                },
                missingDocuments: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['budget_justification.pdf', 'manager_pre_approval.pdf']
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Cannot submit this approval',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Only the original requester can submit this approval for review' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'User is not the original requester or lacks submission permissions' },
                requesterUid: { type: 'number', example: 89 },
                currentUserUid: { type: 'number', example: 123 }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ Approval not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval with ID 12345 not found' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiServiceUnavailableResponse({
        description: '🚫 Service temporarily unavailable',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval submission service temporarily unavailable' },
                error: { type: 'string', example: 'Service Unavailable' },
                statusCode: { type: 'number', example: 503 },
                reason: { type: 'string', example: 'Notification service down or approver directory unavailable' },
                retryAfter: { type: 'number', example: 300, description: 'Seconds until service availability' }
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
        summary: '⚡ Perform action on approval',
        description: `
# Approval Action Center

Perform various decision-making actions on approval requests including approve, reject, request additional information, delegate, or escalate to higher authority.

## 🎯 **Primary Use Cases**
- **Decision Making**: Make final approval or rejection decisions on pending requests
- **Information Gathering**: Request additional information when details are insufficient
- **Workload Management**: Delegate approvals to other authorized personnel
- **Escalation Handling**: Escalate complex or high-value approvals to senior management
- **Conditional Approval**: Approve with specific conditions or requirements

## ⚡ **Available Actions**
- **APPROVE**: Grant final approval and authorize the requested action
- **REJECT**: Deny the request with detailed reasoning and feedback
- **REQUEST_INFO**: Request additional information or documentation from requester
- **DELEGATE**: Transfer approval authority to another qualified approver
- **ESCALATE**: Escalate to higher authority for complex or high-value decisions
- **CONDITIONAL_APPROVE**: Approve with specific conditions that must be met

## 🔐 **Authorization & Security**
- **Permission Validation**: Verify user has authority to perform requested action
- **Role-based Access**: Actions limited based on user role and approval hierarchy
- **Organization Scoping**: Ensure actions respect organizational boundaries
- **Approval Limits**: Validate financial approval limits and authorization levels
- **Audit Logging**: Complete logging of all actions for compliance and tracking

## 📋 **Action Requirements**
- **APPROVE/REJECT**: Comments recommended, required for high-value approvals
- **REQUEST_INFO**: Specific information requirements must be detailed
- **DELEGATE**: Target approver must be specified and authorized
- **ESCALATE**: Escalation reason and target authority must be provided
- **CONDITIONS**: Clear, measurable conditions must be specified for conditional approvals

## 🔄 **Workflow Impact**
- **Status Changes**: Automatic status transitions based on action taken
- **Notification Dispatch**: Immediate notifications to all relevant stakeholders
- **SLA Tracking**: Action timestamps recorded for performance measurement
- **History Recording**: Complete action history maintained for audit trail
- **Integration Triggers**: External system integrations activated as needed
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier to act upon', 
        type: 'number',
        example: 12345
    })
    @ApiBody({ 
        type: ApprovalActionDto,
        description: 'Action to perform with supporting details',
        examples: {
            approve: {
                summary: '✅ Approve Request',
                description: 'Grant approval with comments',
                value: {
                    action: 'APPROVE',
                    comments: 'Approved - all requirements met and budget verified. Please proceed with implementation.',
                    sendNotification: true,
                    metadata: {
                        approvalLocation: 'Head Office',
                        reviewDuration: '45 minutes',
                        budgetVerified: true
                    }
                }
            },
            reject: {
                summary: '❌ Reject Request',
                description: 'Reject with detailed reasoning',
                value: {
                    action: 'REJECT',
                    reason: 'Insufficient budget allocation for Q1. Please resubmit with reduced scope or alternative funding source.',
                    comments: 'The requested amount exceeds available Q1 budget. Consider phased implementation or alternative vendors.',
                    sendNotification: true,
                    notificationMessage: 'Your approval request has been reviewed and requires modifications before resubmission.'
                }
            },
            requestInfo: {
                summary: '📝 Request Additional Information',
                description: 'Request more details before decision',
                value: {
                    action: 'REQUEST_INFO',
                    comments: 'Please provide additional documentation before approval can be granted.',
                    conditions: [
                        'Provide detailed budget breakdown with itemized costs',
                        'Submit three vendor quotes for comparison',
                        'Include implementation timeline with key milestones',
                        'Obtain pre-approval from IT security team'
                    ],
                    sendNotification: true
                }
            },
            delegate: {
                summary: '🔄 Delegate Approval',
                description: 'Transfer approval authority to another user',
                value: {
                    action: 'DELEGATE',
                    delegateToClerkUserId: 'user_2abc123',
                    comments: 'Delegating to Department Head due to specialized knowledge requirement in this area.',
                    reason: 'Technical expertise required outside my domain',
                    sendNotification: true,
                    metadata: {
                        delegationReason: 'Subject matter expertise',
                        originalApprover: 45,
                        urgencyFlag: false
                    }
                }
            },
            escalate: {
                summary: '⬆️ Escalate to Higher Authority',
                description: 'Escalate to senior management',
                value: {
                    action: 'ESCALATE',
                    escalateToClerkUserId: 'user_2def456',
                    reason: 'Amount exceeds my approval authority limit. Requires director-level approval.',
                    comments: 'Request appears valid but exceeds my $50,000 approval limit. Recommending approval at director level.',
                    sendNotification: true,
                    metadata: {
                        escalationTrigger: 'approval_limit_exceeded',
                        originalLimit: 50000,
                        requestedAmount: 125000,
                        recommendationLevel: 'positive'
                    }
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Action performed successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                approvalReference: { type: 'string', example: 'PUR-9XR2L-M8K' },
                status: { type: 'string', example: 'APPROVED' },
                action: { type: 'string', example: 'APPROVE' },
                actionBy: { type: 'number', example: 45 },
                actionByUser: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 45 },
                        name: { type: 'string', example: 'Michael Thompson' },
                        email: { type: 'string', example: 'michael.thompson@loro.co.za' },
                        title: { type: 'string', example: 'Finance Manager' }
                    }
                },
                actionAt: { type: 'string', format: 'date-time', example: '2024-03-18T14:30:00Z' },
                fromStatus: { type: 'string', example: 'PENDING' },
                toStatus: { type: 'string', example: 'APPROVED' },
                comments: { type: 'string', example: 'Approved - all requirements met and budget verified' },
                processingTime: {
                    type: 'object',
                    properties: {
                        totalDays: { type: 'number', example: 3.2 },
                        businessDays: { type: 'number', example: 2.8 },
                        totalHours: { type: 'number', example: 76.5 }
                    }
                },
                notifications: {
                    type: 'object',
                    properties: {
                        sent: { type: 'boolean', example: true },
                        recipientCount: { type: 'number', example: 3 },
                        channels: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['email', 'push', 'sms']
                        },
                        notifiedUsers: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'jennifer.martinez@loro.co.za',
                                'accounting@loro.co.za',
                                'procurement@loro.co.za'
                            ]
                        }
                    }
                },
                nextSteps: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Requester notified of approval decision',
                        'Purchase order can now be processed',
                        'Implementation can begin as per approved timeline'
                    ]
                },
                compliance: {
                    type: 'object',
                    properties: {
                        auditTrailUpdated: { type: 'boolean', example: true },
                        signatureRequired: { type: 'boolean', example: false },
                        complianceLevel: { type: 'string', example: 'STANDARD' },
                        retentionApplied: { type: 'boolean', example: true }
                    }
                },
                performance: {
                    type: 'object',
                    properties: {
                        slaStatus: { type: 'string', example: 'WITHIN_SLA' },
                        slaTarget: { type: 'number', example: 5, description: 'Days' },
                        actualTime: { type: 'number', example: 3.2, description: 'Days' },
                        efficiency: { type: 'number', example: 1.56, description: 'Ratio of target to actual' }
                    }
                },
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
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Action APPROVE not allowed on approval with status DRAFT',
                        'Comments are required for rejection actions',
                        'Delegate user ID must be specified for delegation actions',
                        'Escalation target must have higher authority level',
                        'Action conflicts with existing approval state'
                    ]
                },
                currentStatus: { type: 'string', example: 'DRAFT' },
                allowedActions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['SUBMIT_FOR_REVIEW', 'WITHDRAW']
                },
                userPermissions: {
                    type: 'object',
                    properties: {
                        canApprove: { type: 'boolean', example: false },
                        canReject: { type: 'boolean', example: false },
                        canDelegate: { type: 'boolean', example: true },
                        maxApprovalLimit: { type: 'number', example: 25000 }
                    }
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Insufficient permissions for this action',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'You are not authorized to perform this action on this approval' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'User is not assigned as approver or lacks necessary permissions' },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['APPROVAL_AUTHORITY', 'FINANCIAL_APPROVAL_50K']
                },
                assignedApprover: { type: 'number', example: 89 },
                currentUser: { type: 'number', example: 123 }
            }
        }
    })
    @ApiConflictResponse({
        description: '⚠️ Conflict - Action conflicts with current approval state',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Another user has already taken action on this approval' },
                error: { type: 'string', example: 'Conflict' },
                statusCode: { type: 'number', example: 409 },
                conflictReason: { type: 'string', example: 'Approval status changed during processing' },
                currentStatus: { type: 'string', example: 'APPROVED' },
                lastActionBy: { type: 'number', example: 67 },
                lastActionAt: { type: 'string', format: 'date-time', example: '2024-03-18T13:45:00Z' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Action processing failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to process approval action due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                actionRequested: { type: 'string', example: 'APPROVE' },
                rollbackStatus: { type: 'string', example: 'COMPLETED' }
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
        summary: '✍️ Apply digital signature to approval',
        description: `
# Digital Signature Application

Apply a legally binding digital signature to an approved request, providing authentication, integrity, and non-repudiation for critical business decisions.

## 🎯 **Primary Use Cases**
- **Legal Compliance**: Meet regulatory requirements for digital signatures on financial approvals
- **Authentication**: Verify the identity of the person authorizing the approval
- **Integrity Protection**: Ensure the approval content hasn't been tampered with after signing
- **Non-repudiation**: Provide legal proof that the signer cannot deny their authorization
- **Audit Trail**: Create comprehensive records for compliance and legal proceedings

## 🔐 **Signature Types Supported**
- **ELECTRONIC**: Basic electronic signature with timestamp and user verification
- **DIGITAL**: Advanced digital signature with PKI certificate validation
- **BIOMETRIC**: Biometric-based signature using fingerprint or facial recognition
- **QUALIFIED**: Highest level qualified signature meeting eIDAS/ESIGN standards
- **WITNESSED**: Signature requiring additional witness verification for legal compliance

## 📋 **Security Features**
- **Certificate Validation**: Automatic validation of digital certificates and their validity
- **Timestamp Authority**: Secure timestamping from trusted time authority services
- **Cryptographic Integrity**: Hash-based verification ensuring document integrity
- **Revocation Checking**: Real-time certificate revocation status verification
- **Audit Logging**: Complete logging of signature events for forensic analysis

## 🌍 **Compliance Standards**
- **eIDAS Regulation**: European digital signature standards compliance
- **ESIGN Act**: US Electronic Signatures in Global and National Commerce Act
- **UETA**: Uniform Electronic Transactions Act compliance
- **Common Criteria**: International security evaluation standards
- **ISO 27001**: Information security management system requirements

## ⚖️ **Legal Considerations**
- **Legal Validity**: Signatures carry same legal weight as handwritten signatures
- **Evidence Value**: Admissible in court proceedings with proper documentation
- **Regulatory Compliance**: Meet industry-specific signature requirements
- **Cross-border Recognition**: International recognition under various legal frameworks
- **Long-term Preservation**: Signature validity maintained over extended periods
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier requiring signature', 
        type: 'number',
        example: 12345
    })
    @ApiBody({ 
        type: SignApprovalDto,
        description: 'Digital signature application payload',
        examples: {
            electronicSignature: {
                summary: '📝 Electronic Signature',
                description: 'Basic electronic signature with user verification',
                value: {
                    signatureType: 'ELECTRONIC',
                    signatureUrl: 'https://signatures.loro.co.za/electronic/user123-approval12345.png',
                    signatureData: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                    comments: 'Electronic signature applied with full authorization and understanding of approval terms.'
                }
            },
            digitalSignature: {
                summary: '🔐 Digital Certificate Signature',
                description: 'Advanced digital signature with PKI certificate',
                value: {
                    signatureType: 'DIGITAL',
                    signatureUrl: 'https://signatures.loro.co.za/digital/cert-12345-approval.p7s',
                    signatureData: 'MIIB8jCCAVsCAQAwDQYJKoZIhvcNAQEFBQA...',
                    comments: 'Digital signature applied using company-issued PKI certificate.',
                    certificateInfo: {
                        certificateId: 'CERT-2024-USER123',
                        issuer: 'Loro Certificate Authority',
                        subject: 'CN=John Doe, O=Loro Technologies, C=ZA',
                        validFrom: '2024-01-01T00:00:00Z',
                        validTo: '2025-01-01T00:00:00Z',
                        fingerprint: 'SHA256:1234567890ABCDEF...',
                        algorithm: 'SHA256withRSA'
                    },
                    legalInfo: {
                        framework: 'eIDAS',
                        complianceLevel: 'Advanced',
                        requiresWitness: false
                    }
                }
            },
            biometricSignature: {
                summary: '👤 Biometric Signature',
                description: 'Biometric-based signature with fingerprint verification',
                value: {
                    signatureType: 'BIOMETRIC',
                    signatureUrl: 'https://signatures.loro.co.za/biometric/fingerprint-12345.bio',
                    signatureData: 'BIO:FP:SHA256:ABCDEF1234567890...',
                    comments: 'Biometric signature using registered fingerprint template.',
                    biometricData: {
                        fingerprintHash: 'SHA256:ABCDEF1234567890...',
                        faceRecognitionHash: 'SHA256:1234567890ABCDEF...'
                    },
                    legalInfo: {
                        framework: 'ESIGN',
                        complianceLevel: 'Advanced',
                        requiresWitness: false
                    }
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✍️ Approval signed successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                approvalReference: { type: 'string', example: 'PUR-9XR2L-M8K' },
                isSigned: { type: 'boolean', example: true },
                signedAt: { type: 'string', format: 'date-time', example: '2024-03-20T15:30:00Z' },
                signatureId: { type: 'number', example: 789 },
                signatureType: { type: 'string', example: 'DIGITAL' },
                signerInfo: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 45 },
                        name: { type: 'string', example: 'Michael Thompson' },
                        email: { type: 'string', example: 'michael.thompson@loro.co.za' },
                        title: { type: 'string', example: 'Finance Director' }
                    }
                },
                signatureValidation: {
                    type: 'object',
                    properties: {
                        isValid: { type: 'boolean', example: true },
                        validatedAt: { type: 'string', format: 'date-time', example: '2024-03-20T15:30:05Z' },
                        validationMethod: { type: 'string', example: 'PKI_CERTIFICATE_CHAIN' },
                        certificateChainValid: { type: 'boolean', example: true },
                        timestampValid: { type: 'boolean', example: true },
                        integrityVerified: { type: 'boolean', example: true }
                    }
                },
                legalCompliance: {
                    type: 'object',
                    properties: {
                        framework: { type: 'string', example: 'eIDAS' },
                        complianceLevel: { type: 'string', example: 'Advanced' },
                        legallyBinding: { type: 'boolean', example: true },
                        admissibleInCourt: { type: 'boolean', example: true },
                        retentionPeriod: { type: 'string', example: '10 years' }
                    }
                },
                auditTrail: {
                    type: 'object',
                    properties: {
                        signatureHash: { type: 'string', example: 'SHA256:9876543210FEDCBA...' },
                        timestampToken: { type: 'string', example: 'TST:2024032015300000Z...' },
                        ipAddress: { type: 'string', example: '192.168.1.100' },
                        deviceFingerprint: { type: 'string', example: 'DEV:LAPTOP:CHROME:WIN11' },
                        geolocation: {
                            type: 'object',
                            properties: {
                                latitude: { type: 'number', example: -26.2041 },
                                longitude: { type: 'number', example: 28.0473 },
                                accuracy: { type: 'number', example: 10 }
                            }
                        }
                    }
                },
                nextSteps: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Approval process completed with digital signature',
                        'Implementation can proceed as authorized',
                        'Signed approval archived for compliance retention'
                    ]
                },
                message: { type: 'string', example: 'Approval signed successfully with advanced digital signature' }
            }
        }
    })
    @ApiBadRequestResponse({
        description: '❌ Invalid signature data or approval cannot be signed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot apply signature to approval in current status' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Only approved requests can be signed',
                        'This approval does not require a digital signature',
                        'Invalid signature type for this approval level',
                        'Signature certificate has expired',
                        'Biometric data validation failed'
                    ]
                },
                currentStatus: { type: 'string', example: 'PENDING' },
                requiresSignature: { type: 'boolean', example: false },
                allowedSignatureTypes: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['ELECTRONIC', 'DIGITAL']
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Cannot sign this approval',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'You are not authorized to sign this approval' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'Only designated approvers can apply digital signatures' },
                requiredRole: { type: 'string', example: 'APPROVER' },
                signatureAuthority: { type: 'boolean', example: false }
            }
        }
    })
    @ApiUnprocessableEntityResponse({
        description: '📝 Signature validation failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Digital signature validation failed' },
                error: { type: 'string', example: 'Unprocessable Entity' },
                statusCode: { type: 'number', example: 422 },
                signatureErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Certificate validation failed - certificate revoked',
                        'Timestamp validation failed - clock skew detected',
                        'Signature integrity check failed',
                        'Certificate chain incomplete or invalid',
                        'Biometric template mismatch'
                    ]
                },
                certificateStatus: { type: 'string', example: 'REVOKED' },
                validationTimestamp: { type: 'string', format: 'date-time', example: '2024-03-20T15:30:00Z' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Signature service failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to apply digital signature due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                serviceError: { type: 'string', example: 'Certificate authority service unavailable' }
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
        summary: '🔄 Perform bulk actions on multiple approvals',
        description: `
# Bulk Approval Processing

Perform the same action on multiple approval requests simultaneously, enabling efficient mass processing for managers and administrators.

## 🎯 **Primary Use Cases**
- **Mass Approval**: Approve multiple similar requests in a single operation
- **Batch Processing**: Process large volumes of approvals during busy periods
- **Administrative Actions**: Perform administrative tasks across multiple approvals
- **Emergency Response**: Quickly reject or escalate multiple approvals during emergencies
- **Workflow Optimization**: Streamline repetitive approval processes

## ⚡ **Supported Bulk Actions**
- **APPROVE**: Mass approval of multiple requests with optional bulk comments
- **REJECT**: Bulk rejection with standardized rejection reasons
- **DELEGATE**: Transfer multiple approvals to another approver simultaneously
- **ESCALATE**: Escalate multiple approvals to higher authority levels
- **REQUEST_INFO**: Request additional information from multiple requesters
- **WITHDRAW**: Bulk withdrawal of pending requests (admin only)

## 🔐 **Security & Authorization**
- **Manager+ Required**: Only managers, admins, and owners can perform bulk actions
- **Permission Validation**: Each approval checked individually for user permissions
- **Scope Limitations**: Actions limited to user's organizational and branch scope
- **Approval Limits**: Financial limits validated for each individual approval
- **Audit Trail**: Complete logging of all bulk actions for compliance

## 📊 **Processing Intelligence**
- **Atomic Operations**: Each approval processed independently to prevent cascade failures
- **Error Isolation**: Failures on individual approvals don't affect others
- **Progress Tracking**: Real-time feedback on processing progress
- **Rollback Protection**: Failed operations don't affect successfully processed approvals
- **Performance Optimization**: Efficient batch processing with minimal database load

## ⚠️ **Important Limitations**
- **Maximum Batch Size**: Limited to 100 approvals per bulk operation
- **Status Requirements**: Only certain approval statuses can be bulk processed
- **Permission Scope**: Cannot process approvals outside user's authority
- **Action Compatibility**: Some actions may not be available for certain approval types
- **Concurrency Protection**: Prevents conflicts with simultaneous individual actions
        `
    })
    @ApiBody({ 
        type: BulkApprovalActionDto,
        description: 'Bulk action configuration and target approvals',
        examples: {
            bulkApprove: {
                summary: '✅ Bulk Approve Multiple Requests',
                description: 'Approve multiple leave requests in one operation',
                value: {
                    approvalUids: [12345, 12346, 12347, 12348, 12349],
                    action: 'APPROVE',
                    comments: 'Bulk approval of annual leave requests for Q2 planning period. All requests have been verified and approved.',
                    sendNotifications: true
                }
            },
            bulkReject: {
                summary: '❌ Bulk Reject with Standardized Reason',
                description: 'Reject multiple purchase orders due to budget constraints',
                value: {
                    approvalUids: [23456, 23457, 23458, 23459],
                    action: 'REJECT',
                    comments: 'Bulk rejection due to Q4 budget freeze. Please resubmit in Q1 2025 with updated budget justification.',
                    sendNotifications: true
                }
            },
            bulkDelegate: {
                summary: '🔄 Bulk Delegate to Another Manager',
                description: 'Delegate multiple approvals during vacation period',
                value: {
                    approvalUids: [34567, 34568, 34569, 34570, 34571],
                    action: 'DELEGATE',
                    comments: 'Delegating to Deputy Manager during scheduled vacation period (March 20-27).',
                    sendNotifications: true
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Bulk action completed successfully',
        schema: {
            type: 'object',
            properties: {
                processed: { type: 'number', example: 25, description: 'Total number of approvals processed' },
                successful: { type: 'number', example: 22, description: 'Successfully processed approvals' },
                failed: { type: 'number', example: 3, description: 'Failed processing attempts' },
                executionTime: { type: 'number', example: 4.7, description: 'Processing time in seconds' },
                results: { 
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 12345 },
                            approvalReference: { type: 'string', example: 'LEA-8XQ2K-L7M' },
                            success: { type: 'boolean', example: true },
                            action: { type: 'string', example: 'APPROVE' },
                            fromStatus: { type: 'string', example: 'PENDING' },
                            toStatus: { type: 'string', example: 'APPROVED' },
                            processingTime: { type: 'number', example: 0.12, description: 'Individual processing time in seconds' },
                            message: { type: 'string', example: 'Approval processed successfully' },
                            errorCode: { type: 'string', example: null },
                            errorDetails: { type: 'string', example: null }
                        }
                    }
                },
                failureDetails: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 12348 },
                            approvalReference: { type: 'string', example: 'LEA-9YR3M-N8K' },
                            error: { type: 'string', example: 'Cannot approve - approval already processed by another user' },
                            errorCode: { type: 'string', example: 'APPROVAL_CONFLICT' },
                            currentStatus: { type: 'string', example: 'APPROVED' },
                            lastActionBy: { type: 'number', example: 67 }
                        }
                    }
                },
                summary: {
                    type: 'object',
                    properties: {
                        byStatus: {
                            type: 'object',
                            properties: {
                                approved: { type: 'number', example: 22 },
                                failed: { type: 'number', example: 3 }
                            }
                        },
                        byErrorType: {
                            type: 'object',
                            properties: {
                                permission_denied: { type: 'number', example: 1 },
                                approval_conflict: { type: 'number', example: 2 }
                            }
                        },
                        totalValue: { type: 'number', example: 156700.50, description: 'Total monetary value processed' },
                        notificationsSent: { type: 'number', example: 44, description: 'Total notifications dispatched' }
                    }
                },
                performance: {
                    type: 'object',
                    properties: {
                        successRate: { type: 'number', example: 0.88, description: 'Success rate as decimal' },
                        averageProcessingTime: { type: 'number', example: 0.19, description: 'Average time per approval in seconds' },
                        throughput: { type: 'number', example: 5.3, description: 'Approvals processed per second' }
                    }
                },
                auditInfo: {
                    type: 'object',
                    properties: {
                        batchId: { type: 'string', example: 'BULK-2024-03-20-15-30-12345' },
                        processedBy: { type: 'number', example: 45 },
                        processedAt: { type: 'string', format: 'date-time', example: '2024-03-20T15:30:00Z' },
                        organizationRef: { type: 'string', example: 'ORG123' },
                        ipAddress: { type: 'string', example: '192.168.1.100' }
                    }
                },
                message: { type: 'string', example: 'Bulk action completed successfully - 22 of 25 approvals processed' }
            }
        }
    })
    @ApiBadRequestResponse({
        description: '❌ Invalid bulk action request',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Invalid bulk action configuration' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Approval UIDs array cannot be empty',
                        'Maximum 100 approvals allowed per bulk operation',
                        'Invalid action type specified',
                        'Comments required for bulk rejection actions',
                        'Duplicate approval UIDs detected in request'
                    ]
                },
                configuration: {
                    type: 'object',
                    properties: {
                        maxBatchSize: { type: 'number', example: 100 },
                        allowedActions: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['APPROVE', 'REJECT', 'DELEGATE', 'ESCALATE', 'REQUEST_INFO']
                        },
                        requiredFieldsByAction: {
                            type: 'object',
                            properties: {
                                REJECT: { type: 'array', items: { type: 'string' }, example: ['comments'] },
                                DELEGATE: { type: 'array', items: { type: 'string' }, example: ['delegateToClerkUserId'] },
                                ESCALATE: { type: 'array', items: { type: 'string' }, example: ['escalateToClerkUserId', 'reason'] }
                            }
                        }
                    }
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Insufficient permissions for bulk operations',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Manager role or higher required for bulk approval operations' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                requiredRole: { type: 'string', example: 'MANAGER' },
                currentRole: { type: 'string', example: 'USER' },
                bulkPermissions: {
                    type: 'object',
                    properties: {
                        canBulkApprove: { type: 'boolean', example: false },
                        canBulkReject: { type: 'boolean', example: false },
                        canBulkDelegate: { type: 'boolean', example: false },
                        maxBulkSize: { type: 'number', example: 0 }
                    }
                }
            }
        }
    })
    @ApiUnprocessableEntityResponse({
        description: '📝 Bulk processing contains unprocessable approvals',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Some approvals cannot be processed with the requested action' },
                error: { type: 'string', example: 'Unprocessable Entity' },
                statusCode: { type: 'number', example: 422 },
                unprocessableApprovals: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 12347 },
                            reason: { type: 'string', example: 'Approval status DRAFT cannot be approved directly' },
                            currentStatus: { type: 'string', example: 'DRAFT' },
                            allowedActions: { type: 'array', items: { type: 'string' }, example: ['SUBMIT'] }
                        }
                    }
                },
                recommendation: { type: 'string', example: 'Remove unprocessable approvals and retry, or submit draft approvals first' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Bulk processing system failure',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Bulk approval processing system encountered an error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                batchId: { type: 'string', example: 'BULK-2024-03-20-15-30-12345' },
                failurePoint: { type: 'string', example: 'notification_dispatch' },
                partialResults: {
                    type: 'object',
                    properties: {
                        processed: { type: 'number', example: 8 },
                        remaining: { type: 'number', example: 17 },
                        rollbackRequired: { type: 'boolean', example: false }
                    }
                }
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
        summary: '📜 Get comprehensive approval history',
        description: `
# Approval History & Audit Trail

Retrieve the complete chronological history of actions, status changes, and decisions for a specific approval request, providing full transparency and audit compliance.

## 🎯 **Primary Use Cases**
- **Audit Compliance**: Complete audit trail for regulatory and compliance requirements
- **Dispute Resolution**: Detailed history for resolving approval-related disputes
- **Process Analysis**: Analyze approval workflows and identify improvement opportunities
- **Performance Tracking**: Monitor approval processing times and bottlenecks
- **Legal Documentation**: Evidence for legal proceedings and contractual disputes

## 📋 **Complete Activity Tracking**
- **Status Changes**: Every status transition with timestamps and responsible parties
- **Action Details**: All approval actions (approve, reject, delegate, escalate) with reasoning
- **User Information**: Complete details of users who performed each action
- **Comments & Decisions**: All comments, rejection reasons, and approval conditions
- **System Events**: Automated actions, notifications, and system-generated events

## 🔍 **Detailed Information Capture**
- **Chronological Order**: Events listed in precise chronological sequence
- **User Context**: Full user details including roles and departments at time of action
- **Technical Metadata**: IP addresses, user agents, and device information
- **Business Context**: Related entity data and organizational information
- **Performance Metrics**: Processing times and efficiency measurements

## 🛡️ **Security & Privacy**
- **Access Control**: History visibility based on user permissions and relationship to approval
- **Data Masking**: Sensitive information masked based on user authorization level
- **Audit Logging**: All history access attempts logged for security monitoring
- **Retention Compliance**: History maintained according to regulatory requirements
- **Immutable Records**: History entries cannot be modified after creation

## 📊 **Analytics & Insights**
- **Processing Patterns**: Identify common approval paths and decision patterns
- **Performance Metrics**: Track individual and organizational approval efficiency
- **Bottleneck Identification**: Pinpoint stages where approvals commonly delay
- **User Behavior**: Understand how different users interact with approval processes
- **Trend Analysis**: Historical data for process improvement and optimization
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier for history retrieval', 
        type: 'number',
        example: 12345
    })
    @ApiOkResponse({ 
        description: '📜 Approval history retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 567 },
                            approvalUid: { type: 'number', example: 12345 },
                            action: { type: 'string', example: 'APPROVE' },
                            fromStatus: { type: 'string', example: 'PENDING' },
                            toStatus: { type: 'string', example: 'APPROVED' },
                            actionBy: { type: 'number', example: 45 },
                            actionByUser: {
                                type: 'object',
                                properties: {
                                    uid: { type: 'number', example: 45 },
                                    name: { type: 'string', example: 'Michael Thompson' },
                                    surname: { type: 'string', example: 'Thompson' },
                                    email: { type: 'string', example: 'michael.thompson@loro.co.za' },
                                    accessLevel: { type: 'string', example: 'ADMIN' },
                                    department: { type: 'string', example: 'Finance' },
                                    title: { type: 'string', example: 'Finance Director' }
                                }
                            },
                            comments: { type: 'string', example: 'Approved after thorough budget verification and compliance review' },
                            reason: { type: 'string', example: null },
                            createdAt: { type: 'string', format: 'date-time', example: '2024-03-18T14:30:00Z' },
                            ipAddress: { type: 'string', example: '192.168.1.100' },
                            userAgent: { type: 'string', example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' },
                            source: { type: 'string', example: 'web' },
                            isSystemAction: { type: 'boolean', example: false },
                            escalationLevel: { type: 'number', example: null },
                            delegatedFrom: { type: 'number', example: null },
                            geolocation: {
                                type: 'object',
                                properties: {
                                    latitude: { type: 'number', example: -26.2041 },
                                    longitude: { type: 'number', example: 28.0473 },
                                    accuracy: { type: 'number', example: 10 }
                                }
                            },
                            metadata: {
                                type: 'object',
                                properties: {
                                    browserFingerprint: { type: 'string', example: 'fp_1234567890abcdef' },
                                    sessionId: { type: 'string', example: 'sess_abcdef1234567890' },
                                    processingTime: { type: 'number', example: 2.5, description: 'Seconds' },
                                    notificationsSent: { type: 'number', example: 3 }
                                }
                            },
                            attachments: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        filename: { type: 'string', example: 'approval-decision-notes.pdf' },
                                        url: { type: 'string', example: 'https://docs.loro.co.za/decisions/approval-12345-notes.pdf' },
                                        fileSize: { type: 'number', example: 245760 },
                                        mimeType: { type: 'string', example: 'application/pdf' }
                                    }
                                }
                            }
                        }
                    }
                },
                count: { type: 'number', example: 8, description: 'Total number of history entries' },
                timeline: {
                    type: 'object',
                    properties: {
                        totalDuration: { type: 'number', example: 6.2, description: 'Total processing time in days' },
                        createdAt: { type: 'string', format: 'date-time', example: '2024-03-10T09:00:00Z' },
                        submittedAt: { type: 'string', format: 'date-time', example: '2024-03-10T09:15:00Z' },
                        firstActionAt: { type: 'string', format: 'date-time', example: '2024-03-12T11:30:00Z' },
                        lastActionAt: { type: 'string', format: 'date-time', example: '2024-03-18T14:30:00Z' },
                        completedAt: { type: 'string', format: 'date-time', example: '2024-03-18T14:30:00Z' },
                        averageActionInterval: { type: 'number', example: 1.8, description: 'Average days between actions' }
                    }
                },
                statistics: {
                    type: 'object',
                    properties: {
                        totalActions: { type: 'number', example: 8 },
                        userActions: { type: 'number', example: 6 },
                        systemActions: { type: 'number', example: 2 },
                        statusChanges: { type: 'number', example: 4 },
                        participantCount: { type: 'number', example: 3 },
                        escalations: { type: 'number', example: 0 },
                        delegations: { type: 'number', example: 1 }
                    }
                },
                participants: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 45 },
                            name: { type: 'string', example: 'Michael Thompson' },
                            email: { type: 'string', example: 'michael.thompson@loro.co.za' },
                            role: { type: 'string', example: 'APPROVER' },
                            actionCount: { type: 'number', example: 3 },
                            lastActionAt: { type: 'string', format: 'date-time', example: '2024-03-18T14:30:00Z' }
                        }
                    }
                },
                performance: {
                    type: 'object',
                    properties: {
                        slaCompliance: { type: 'boolean', example: true },
                        slaTarget: { type: 'number', example: 7, description: 'Days' },
                        actualTime: { type: 'number', example: 6.2, description: 'Days' },
                        efficiency: { type: 'number', example: 1.13, description: 'SLA ratio (target/actual)' },
                        bottlenecks: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['Delayed manager review (2.1 days)']
                        }
                    }
                },
                compliance: {
                    type: 'object',
                    properties: {
                        auditCompliant: { type: 'boolean', example: true },
                        retentionPeriod: { type: 'string', example: '7 years' },
                        lastAuditAt: { type: 'string', format: 'date-time', example: '2024-03-01T00:00:00Z' },
                        complianceFramework: { type: 'string', example: 'SOX' },
                        immutableRecords: { type: 'boolean', example: true }
                    }
                },
                message: { type: 'string', example: 'Approval history retrieved successfully' }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ Approval not found or access denied',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval with ID 12345 not found or access denied' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Cannot view approval history',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'You do not have permission to view this approval history' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'History access requires involvement in approval process or elevated permissions' },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['APPROVAL_HISTORY_VIEW', 'AUDIT_ACCESS']
                }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - History retrieval failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to retrieve approval history due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 }
            }
        }
    })
    getHistory(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.getHistory(id, req.user);
    }

    // Get approval signatures
    @Get(':id/signatures')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: '✍️ Get approval digital signatures',
        description: `
# Digital Signature Registry

Retrieve all digital signatures associated with a specific approval, providing complete signature verification, legal compliance status, and authentication details.

## 🎯 **Primary Use Cases**
- **Legal Verification**: Verify the authenticity and legal validity of digital signatures
- **Compliance Auditing**: Ensure signature compliance with regulatory standards
- **Forensic Analysis**: Investigate signature integrity for dispute resolution
- **Authentication Tracking**: Monitor who signed what and when
- **Certificate Management**: Track certificate validity and expiration status

## 🔐 **Signature Information Included**
- **Signature Details**: Type, timestamp, and validity status of each signature
- **Signer Information**: Complete details of users who applied signatures
- **Certificate Data**: Digital certificate information and validation status
- **Verification Results**: Real-time signature integrity and authenticity checks
- **Legal Compliance**: Compliance status with applicable signature regulations

## 📋 **Comprehensive Signature Types**
- **ELECTRONIC**: Basic electronic signatures with user authentication
- **DIGITAL**: Advanced digital signatures with PKI certificate validation
- **BIOMETRIC**: Biometric-based signatures using fingerprint or facial recognition
- **QUALIFIED**: Highest level qualified signatures meeting eIDAS/ESIGN standards
- **WITNESSED**: Signatures with additional witness verification

## 🔍 **Verification & Validation**
- **Certificate Chain**: Complete PKI certificate chain validation
- **Timestamp Verification**: Secure timestamp authority validation
- **Integrity Checks**: Hash-based document integrity verification
- **Revocation Status**: Real-time certificate revocation list checking
- **Legal Framework**: Compliance with applicable signature regulations

## ⚖️ **Legal & Compliance Features**
- **Regulatory Compliance**: Adherence to eIDAS, ESIGN, UETA standards
- **Evidence Quality**: Legally admissible signature evidence
- **Long-term Validation**: Signature validity preservation over time
- **Cross-border Recognition**: International signature recognition status
- **Audit Trail**: Complete signature audit trail for legal proceedings
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier for signature retrieval', 
        type: 'number',
        example: 12345
    })
    @ApiOkResponse({ 
        description: '✍️ Approval signatures retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uid: { type: 'number', example: 789 },
                            approvalUid: { type: 'number', example: 12345 },
                            signerUid: { type: 'number', example: 45 },
                            signer: {
                                type: 'object',
                                properties: {
                                    uid: { type: 'number', example: 45 },
                                    name: { type: 'string', example: 'Michael Thompson' },
                                    surname: { type: 'string', example: 'Thompson' },
                                    email: { type: 'string', example: 'michael.thompson@loro.co.za' },
                                    accessLevel: { type: 'string', example: 'ADMIN' },
                                    title: { type: 'string', example: 'Finance Director' },
                                    department: { type: 'string', example: 'Finance' }
                                }
                            },
                            signatureType: { type: 'string', example: 'DIGITAL' },
                            signatureUrl: { type: 'string', example: 'https://signatures.loro.co.za/digital/cert-12345-approval.p7s' },
                            signatureData: { type: 'string', example: 'MIIB8jCCAVsCAQAwDQYJKoZIhvcNAQEFBQA...' },
                            createdAt: { type: 'string', format: 'date-time', example: '2024-03-20T15:30:00Z' },
                            signedAt: { type: 'string', format: 'date-time', example: '2024-03-20T15:30:00Z' },
                            isValid: { type: 'boolean', example: true },
                            validatedAt: { type: 'string', format: 'date-time', example: '2024-03-20T15:30:05Z' },
                            validationMethod: { type: 'string', example: 'PKI_CERTIFICATE_CHAIN' },
                            validationNotes: { type: 'string', example: 'Certificate chain validated successfully against trusted CA' },
                            isRevoked: { type: 'boolean', example: false },
                            revokedAt: { type: 'string', format: 'date-time', example: null },
                            revocationReason: { type: 'string', example: null },
                            certificateInfo: {
                                type: 'object',
                                properties: {
                                    certificateId: { type: 'string', example: 'CERT-2024-USER123' },
                                    issuer: { type: 'string', example: 'Loro Certificate Authority' },
                                    subject: { type: 'string', example: 'CN=Michael Thompson, O=Loro Technologies, C=ZA' },
                                    validFrom: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00Z' },
                                    validTo: { type: 'string', format: 'date-time', example: '2025-01-01T00:00:00Z' },
                                    fingerprint: { type: 'string', example: 'SHA256:1234567890ABCDEF...' },
                                    algorithm: { type: 'string', example: 'SHA256withRSA' },
                                    serialNumber: { type: 'string', example: '1234567890ABCDEF' },
                                    keyUsage: { type: 'array', items: { type: 'string' }, example: ['digitalSignature', 'nonRepudiation'] }
                                }
                            },
                            auditTrail: {
                                type: 'object',
                                properties: {
                                    ipAddress: { type: 'string', example: '192.168.1.100' },
                                    userAgent: { type: 'string', example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' },
                                    deviceId: { type: 'string', example: 'DEV-WIN-LAPTOP-001' },
                                    deviceType: { type: 'string', example: 'desktop' },
                                    browserFingerprint: { type: 'string', example: 'fp_1234567890abcdef' },
                                    geolocation: {
                                        type: 'object',
                                        properties: {
                                            latitude: { type: 'number', example: -26.2041 },
                                            longitude: { type: 'number', example: 28.0473 },
                                            accuracy: { type: 'number', example: 10 },
                                            address: { type: 'string', example: 'Johannesburg, South Africa' }
                                        }
                                    }
                                }
                            },
                            biometricData: {
                                type: 'object',
                                properties: {
                                    fingerprintHash: { type: 'string', example: 'SHA256:ABCDEF1234567890...' },
                                    faceRecognitionHash: { type: 'string', example: 'SHA256:1234567890ABCDEF...' },
                                    voicePrintHash: { type: 'string', example: null },
                                    retinaScanHash: { type: 'string', example: null },
                                    timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime(undefined, undefined, 15, 30) }
                                }
                            },
                            legalCompliance: {
                                type: 'object',
                                properties: {
                                    framework: { type: 'string', example: 'eIDAS' },
                                    complianceLevel: { type: 'string', example: 'Advanced' },
                                    legallyBinding: { type: 'boolean', example: true },
                                    admissibleInCourt: { type: 'boolean', example: true },
                                    requiresWitness: { type: 'boolean', example: false },
                                    witnessUid: { type: 'number', example: null },
                                    witnessedAt: { type: 'string', format: 'date-time', example: null },
                                    jurisdictionCompliant: { type: 'boolean', example: true },
                                    retentionPeriod: { type: 'string', example: '10 years' }
                                }
                            },
                            technicalMetadata: {
                                type: 'object',
                                properties: {
                                    documentHash: { type: 'string', example: 'SHA256:9876543210FEDCBA...' },
                                    timestampToken: { type: 'string', example: 'TST:2024032015300000Z...' },
                                    nonRepudiationProof: { type: 'string', example: 'NRP:ABCDEF1234567890...' },
                                    signaturePolicy: { type: 'string', example: 'LORO-SIG-POLICY-2024-v1.0' },
                                    externalSignatureId: { type: 'string', example: 'DOCUSIGN-ENV-12345678' },
                                    signatureProvider: { type: 'string', example: 'Internal Certificate Authority' }
                                }
                            }
                        }
                    }
                },
                count: { type: 'number', example: 2, description: 'Total number of signatures' },
                summary: {
                    type: 'object',
                    properties: {
                        totalSignatures: { type: 'number', example: 2 },
                        validSignatures: { type: 'number', example: 2 },
                        revokedSignatures: { type: 'number', example: 0 },
                        expiredCertificates: { type: 'number', example: 0 },
                        signatureTypes: {
                            type: 'object',
                            properties: {
                                DIGITAL: { type: 'number', example: 1 },
                                ELECTRONIC: { type: 'number', example: 1 },
                                BIOMETRIC: { type: 'number', example: 0 }
                            }
                        },
                        complianceLevel: { type: 'string', example: 'Advanced' },
                        overallValidity: { type: 'boolean', example: true }
                    }
                },
                validation: {
                    type: 'object',
                    properties: {
                        lastValidationAt: { type: 'string', format: 'date-time', example: '2024-03-20T15:30:10Z' },
                        validationStatus: { type: 'string', example: 'VALID' },
                        validationErrors: { type: 'array', items: { type: 'string' }, example: [] },
                        validationWarnings: { 
                            type: 'array', 
                            items: { type: 'string' }, 
                            example: ['Certificate expires in 8 months'] 
                        },
                        validationResults: {
                            type: 'object',
                            properties: {
                                certificateChain: { type: 'boolean', example: true },
                                timestampValidity: { type: 'boolean', example: true },
                                signatureIntegrity: { type: 'boolean', example: true },
                                revocationStatus: { type: 'boolean', example: true },
                                algorithmStrength: { type: 'boolean', example: true }
                            }
                        }
                    }
                },
                legal: {
                    type: 'object',
                    properties: {
                        overallCompliance: { type: 'string', example: 'FULLY_COMPLIANT' },
                        applicableFrameworks: { 
                            type: 'array', 
                            items: { type: 'string' }, 
                            example: ['eIDAS', 'ESIGN', 'Common Law'] 
                        },
                        evidenceQuality: { type: 'string', example: 'HIGH' },
                        longTermValidity: { type: 'boolean', example: true },
                        crossBorderRecognition: { type: 'boolean', example: true },
                        regulatoryCompliance: { type: 'boolean', example: true }
                    }
                },
                message: { type: 'string', example: 'Approval signatures retrieved successfully' }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ Approval not found or access denied',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval with ID 12345 not found or access denied' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Cannot view approval signatures',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'You do not have permission to view signatures for this approval' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'Signature access requires approval involvement or administrative permissions' },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['SIGNATURE_VIEW', 'AUDIT_ACCESS', 'LEGAL_REVIEW']
                }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Signature retrieval failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to retrieve approval signatures due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                serviceError: { type: 'string', example: 'Certificate validation service unavailable' }
            }
        }
    })
    getSignatures(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.getSignatures(id, req.user);
    }

    // Withdraw approval (by requester)
    @Post(':id/withdraw')
    @Roles(AccessLevel.USER)
    @ApiOperation({ 
        summary: '🔙 Withdraw approval request',
        description: `
# Approval Withdrawal

Cancel a pending approval request before final decision, removing it from approver queues and stopping the approval workflow.

## 🎯 **Primary Use Cases**
- **Request Cancellation**: Cancel requests that are no longer needed or relevant
- **Error Correction**: Withdraw requests with errors before creating corrected versions
- **Business Changes**: Cancel approvals due to changed business requirements
- **Emergency Situations**: Quickly remove urgent requests that become obsolete
- **Process Optimization**: Clear pending queues of outdated or superseded requests

## 📋 **Withdrawal Conditions**
- **Requester Authority**: Only original requesters can withdraw their own submissions
- **Status Requirements**: Can only withdraw pending, under review, or info-required approvals
- **Timing Restrictions**: Cannot withdraw approvals that have already been decided
- **Dependency Checks**: Validates no dependent processes are relying on the approval
- **Administrative Override**: Admins can withdraw approvals for emergency situations

## 🔄 **Withdrawal Process**
- **Immediate Cancellation**: Approval immediately removed from all pending queues
- **Notification Dispatch**: Automatic notifications sent to all involved parties
- **History Recording**: Withdrawal action recorded in approval history for audit
- **Status Change**: Approval status permanently changed to WITHDRAWN
- **Workflow Termination**: All associated timers and escalations cancelled

## ⚠️ **Important Considerations**
- **Irreversible Action**: Withdrawal cannot be undone - requires new submission
- **Notification Impact**: All stakeholders notified of withdrawal immediately
- **SLA Effects**: Withdrawal stops SLA timers and performance metrics
- **Audit Trail**: Withdrawal reason and timestamp permanently recorded
- **Business Impact**: May affect dependent processes and timelines

## 🔐 **Security & Validation**
- **Identity Verification**: Strict validation of requester identity and ownership
- **Status Validation**: Ensures withdrawal is appropriate for current approval state
- **Business Rules**: Validates withdrawal doesn't violate organizational policies
- **Access Control**: Respects organizational and branch-level permissions
- **Audit Logging**: Complete logging of withdrawal events for compliance
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier to withdraw', 
        type: 'number',
        example: 12345
    })
    @ApiOkResponse({ 
        description: '🔙 Approval withdrawn successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                approvalReference: { type: 'string', example: 'LEA-8XQ2K-L7M' },
                title: { type: 'string', example: 'Annual Leave Request - Sarah Johnson' },
                status: { type: 'string', example: 'WITHDRAWN' },
                previousStatus: { type: 'string', example: 'PENDING' },
                withdrawnAt: { type: 'string', format: 'date-time', example: '2024-03-25T11:30:00Z' },
                withdrawnBy: { type: 'number', example: 89 },
                requester: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 89 },
                        name: { type: 'string', example: 'Sarah Johnson' },
                        email: { type: 'string', example: 'sarah.johnson@loro.co.za' }
                    }
                },
                approver: {
                    type: 'object',
                    properties: {
                        uid: { type: 'number', example: 45 },
                        name: { type: 'string', example: 'Michael Thompson' },
                        email: { type: 'string', example: 'michael.thompson@loro.co.za' },
                        wasNotified: { type: 'boolean', example: true }
                    }
                },
                timeline: {
                    type: 'object',
                    properties: {
                        createdAt: { type: 'string', format: 'date-time', example: '2024-03-20T09:00:00Z' },
                        submittedAt: { type: 'string', format: 'date-time', example: '2024-03-20T09:15:00Z' },
                        withdrawnAt: { type: 'string', format: 'date-time', example: '2024-03-25T11:30:00Z' },
                        pendingDuration: { type: 'number', example: 5.1, description: 'Days in pending status' },
                        totalLifetime: { type: 'number', example: 5.1, description: 'Total days from creation to withdrawal' }
                    }
                },
                notifications: {
                    type: 'object',
                    properties: {
                        sent: { type: 'boolean', example: true },
                        recipientCount: { type: 'number', example: 3 },
                        channels: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['email', 'push']
                        },
                        notifiedUsers: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'michael.thompson@loro.co.za',
                                'hr-notifications@loro.co.za',
                                'admin@loro.co.za'
                            ]
                        }
                    }
                },
                impact: {
                    type: 'object',
                    properties: {
                        removedFromQueues: { type: 'number', example: 2 },
                        cancelledTimers: { type: 'number', example: 1 },
                        affectedWorkflows: { type: 'number', example: 0 },
                        slaImpact: { type: 'string', example: 'TIMER_STOPPED' },
                        performanceImpact: { type: 'string', example: 'EXCLUDED_FROM_METRICS' }
                    }
                },
                nextSteps: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Approval removed from all pending queues',
                        'Stakeholders notified of withdrawal',
                        'SLA timers stopped and excluded from metrics',
                        'New request can be submitted if needed'
                    ]
                },
                resubmission: {
                    type: 'object',
                    properties: {
                        canResubmit: { type: 'boolean', example: true },
                        resubmissionAllowed: { type: 'boolean', example: true },
                        cooldownPeriod: { type: 'string', example: 'No restrictions' },
                        recommendedChanges: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'Consider updating request details',
                                'Ensure all supporting documents are included',
                                'Verify approval amounts and dates'
                            ]
                        }
                    }
                },
                auditInfo: {
                    type: 'object',
                    properties: {
                        withdrawalReason: { type: 'string', example: 'Request no longer needed due to changed business priorities' },
                        ipAddress: { type: 'string', example: '192.168.1.100' },
                        userAgent: { type: 'string', example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' },
                        geolocation: {
                            type: 'object',
                            properties: {
                                latitude: { type: 'number', example: -26.2041 },
                                longitude: { type: 'number', example: 28.0473 },
                                accuracy: { type: 'number', example: 10 }
                            }
                        }
                    }
                },
                message: { type: 'string', example: 'Approval withdrawn successfully - all stakeholders have been notified' }
            }
        }
    })
    @ApiBadRequestResponse({
        description: '❌ Cannot withdraw approval in current status',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot withdraw approval in current status' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Approval has already been decided and cannot be withdrawn',
                        'Only pending or under-review approvals can be withdrawn',
                        'Approval is currently being processed by approver',
                        'Cannot withdraw signed approvals'
                    ]
                },
                currentStatus: { type: 'string', example: 'APPROVED' },
                withdrawableStatuses: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['PENDING', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED']
                },
                lastActionAt: { type: 'string', format: 'date-time', example: '2024-03-24T14:30:00Z' },
                lastActionBy: { type: 'number', example: 45 }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Cannot withdraw this approval',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Only the original requester can withdraw this approval' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                reason: { type: 'string', example: 'Withdrawal restricted to original requester or authorized administrators' },
                requesterUid: { type: 'number', example: 89 },
                currentUserUid: { type: 'number', example: 123 },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['APPROVAL_REQUESTER', 'ADMIN_OVERRIDE']
                },
                alternativeActions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['Contact original requester to request withdrawal', 'Escalate to administrator if urgent']
                }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ Approval not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval with ID 12345 not found' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiConflictResponse({
        description: '⚠️ Conflict - Approval state changed during processing',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval state changed during withdrawal processing' },
                error: { type: 'string', example: 'Conflict' },
                statusCode: { type: 'number', example: 409 },
                conflictReason: { type: 'string', example: 'Approval was processed by approver while withdrawal was being attempted' },
                currentStatus: { type: 'string', example: 'APPROVED' },
                lastActionBy: { type: 'number', example: 45 },
                lastActionAt: { type: 'string', format: 'date-time', example: '2024-03-25T11:29:45Z' },
                recommendation: { type: 'string', example: 'Approval has been processed and cannot be withdrawn' }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Withdrawal processing failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to withdraw approval due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                rollbackStatus: { type: 'string', example: 'COMPLETED' },
                partialWithdrawal: { type: 'boolean', example: false }
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
        summary: '📦 Archive completed approval',
        description: `
# Approval Archival System

Move completed approval requests to long-term archival storage, maintaining compliance requirements while optimizing active system performance.

## 🎯 **Primary Use Cases**
- **Compliance Retention**: Maintain regulatory-required approval records for specified retention periods
- **Performance Optimization**: Remove old records from active queries while preserving audit trails
- **Storage Management**: Efficiently manage database storage by archiving historical data
- **Legal Preservation**: Ensure legal documents remain accessible for litigation and audits
- **Regulatory Compliance**: Meet industry-specific record retention requirements

## 📋 **Archival Eligibility**
- **Status Requirements**: Only completed, approved, rejected, or cancelled approvals can be archived
- **Time Constraints**: Approvals must be older than minimum retention period in active storage
- **Legal Clearance**: No pending legal holds or active investigations involving the approval
- **Dependency Checks**: Ensure no active processes depend on the approval data
- **Compliance Validation**: Confirm archival meets regulatory retention requirements

## 🔐 **Archive Security & Integrity**
- **Admin-Only Access**: Only administrators can initiate archival processes
- **Audit Trail Preservation**: Complete audit trail maintained in archived state
- **Data Integrity**: Cryptographic checksums ensure archived data integrity
- **Access Logging**: All archive access attempts logged for security monitoring
- **Encryption**: Archived data encrypted according to organizational security policies

## 📁 **Archive Storage Features**
- **Compressed Storage**: Efficient compression reduces storage footprint
- **Metadata Preservation**: All approval metadata maintained for search and retrieval
- **Signature Preservation**: Digital signatures remain valid and verifiable
- **Immutable Records**: Archived approvals cannot be modified, only retrieved
- **Redundant Backup**: Multiple backup copies in geographically distributed locations

## 🔍 **Retrieval & Access**
- **On-Demand Retrieval**: Archived approvals can be retrieved when needed
- **Search Capability**: Search archived approvals by various criteria
- **Legal Discovery**: Support for legal discovery and subpoena requests
- **Audit Access**: Auditors can access archived records with proper authorization
- **Compliance Reporting**: Generate compliance reports from archived data
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier to archive', 
        type: 'number',
        example: 12345
    })
    @ApiOkResponse({ 
        description: '📦 Approval archived successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                approvalReference: { type: 'string', example: 'PUR-8XQ2K-L7M' },
                title: { type: 'string', example: 'Office Equipment Purchase - Marketing Department' },
                status: { type: 'string', example: 'APPROVED' },
                isArchived: { type: 'boolean', example: true },
                archivedAt: { type: 'string', format: 'date-time', example: '2024-03-25T16:30:00Z' },
                archivedBy: { type: 'number', example: 23 },
                archiveInfo: {
                    type: 'object',
                    properties: {
                        archivedByUser: {
                            type: 'object',
                            properties: {
                                uid: { type: 'number', example: 23 },
                                name: { type: 'string', example: 'David Chen' },
                                email: { type: 'string', example: 'david.chen@loro.co.za' },
                                title: { type: 'string', example: 'System Administrator' }
                            }
                        },
                        archiveLocation: { type: 'string', example: 'PRIMARY-ARCHIVE-VAULT-001' },
                        archiveChecksum: { type: 'string', example: 'SHA256:1234567890ABCDEF...' },
                        compressionRatio: { type: 'number', example: 0.65, description: 'Compression ratio achieved' },
                        archiveSize: { type: 'number', example: 245760, description: 'Archive size in bytes' },
                        retentionPolicy: { type: 'string', example: 'LEGAL-7Y-FINANCIAL' }
                    }
                },
                compliance: {
                    type: 'object',
                    properties: {
                        retentionPeriod: { type: 'string', example: '7 years' },
                        complianceFramework: { type: 'string', example: 'SOX' },
                        legalHold: { type: 'boolean', example: false },
                        auditRequirement: { type: 'boolean', example: true },
                        destructionDate: { type: 'string', format: 'date', example: '2031-03-25' },
                        regulatoryCompliance: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['SOX', 'GDPR', 'POPIA']
                        }
                    }
                },
                timeline: {
                    type: 'object',
                    properties: {
                        createdAt: { type: 'string', format: 'date-time', example: '2024-01-10T08:30:00Z' },
                        completedAt: { type: 'string', format: 'date-time', example: '2024-01-20T16:45:00Z' },
                        archivedAt: { type: 'string', format: 'date-time', example: '2024-03-25T16:30:00Z' },
                        activeLifetime: { type: 'number', example: 74.3, description: 'Days in active storage' },
                        processingTime: { type: 'number', example: 10.3, description: 'Days from creation to completion' }
                    }
                },
                preservation: {
                    type: 'object',
                    properties: {
                        dataIntegrity: { type: 'boolean', example: true },
                        signatureValidity: { type: 'boolean', example: true },
                        metadataComplete: { type: 'boolean', example: true },
                        historyPreserved: { type: 'boolean', example: true },
                        documentsArchived: { type: 'boolean', example: true },
                        encryptionApplied: { type: 'boolean', example: true },
                        backupCopies: { type: 'number', example: 3 }
                    }
                },
                access: {
                    type: 'object',
                    properties: {
                        retrievalMethod: { type: 'string', example: 'ON_DEMAND_API' },
                        averageRetrievalTime: { type: 'string', example: '30-60 seconds' },
                        searchable: { type: 'boolean', example: true },
                        authorizedRoles: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['ADMIN', 'AUDITOR', 'LEGAL']
                        },
                        accessLogging: { type: 'boolean', example: true }
                    }
                },
                performance: {
                    type: 'object',
                    properties: {
                        removedFromActiveStorage: { type: 'boolean', example: true },
                        queryPerformanceImpact: { type: 'string', example: 'IMPROVED' },
                        storageSpaceFreed: { type: 'number', example: 1048576, description: 'Bytes freed in active storage' },
                        indexingOptimized: { type: 'boolean', example: true }
                    }
                },
                recovery: {
                    type: 'object',
                    properties: {
                        canRetrieve: { type: 'boolean', example: true },
                        retrievalRequiresApproval: { type: 'boolean', example: true },
                        emergencyRetrieval: { type: 'boolean', example: true },
                        legalDiscoverySupport: { type: 'boolean', example: true },
                        auditTrailMaintained: { type: 'boolean', example: true }
                    }
                },
                message: { type: 'string', example: 'Approval archived successfully - moved to long-term storage with 7-year retention' }
            }
        }
    })
    @ApiBadRequestResponse({
        description: '❌ Cannot archive approval in current state',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot archive approval in current state' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Only completed, approved, rejected, or cancelled approvals can be archived',
                        'Approval is not old enough to meet minimum retention period',
                        'Approval has active legal hold preventing archival',
                        'Related processes still depend on this approval'
                    ]
                },
                currentStatus: { type: 'string', example: 'PENDING' },
                archivableStatuses: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED']
                },
                minimumAge: { type: 'number', example: 30, description: 'Days before archival eligibility' },
                currentAge: { type: 'number', example: 15, description: 'Days since completion' },
                eligibilityDate: { type: 'string', format: 'date', example: '2024-04-10' }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Admin privileges required',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Administrator privileges required for approval archival operations' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                requiredRole: { type: 'string', example: 'ADMIN' },
                currentRole: { type: 'string', example: 'MANAGER' },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['ARCHIVE_APPROVALS', 'DATA_MANAGEMENT', 'COMPLIANCE_ADMIN']
                },
                alternativeActions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Contact system administrator to request archival',
                        'Submit archival request through proper channels',
                        'Wait for automatic archival based on retention policies'
                    ]
                }
            }
        }
    })
    @ApiNotFoundResponse({
        description: '❌ Approval not found',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval with ID 12345 not found' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 }
            }
        }
    })
    @ApiConflictResponse({
        description: '⚠️ Conflict - Archive operation conflict',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval is already archived or archival in progress' },
                error: { type: 'string', example: 'Conflict' },
                statusCode: { type: 'number', example: 409 },
                conflictReason: { type: 'string', example: 'Approval already archived by another administrator' },
                archivedAt: { type: 'string', format: 'date-time', example: '2024-03-25T15:20:00Z' },
                archivedBy: { type: 'number', example: 67 },
                archiveLocation: { type: 'string', example: 'PRIMARY-ARCHIVE-VAULT-001' }
            }
        }
    })
    @ApiServiceUnavailableResponse({
        description: '🚫 Archive service temporarily unavailable',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Archive service temporarily unavailable' },
                error: { type: 'string', example: 'Service Unavailable' },
                statusCode: { type: 'number', example: 503 },
                reason: { type: 'string', example: 'Archive storage system maintenance in progress' },
                retryAfter: { type: 'number', example: 1800, description: 'Seconds until service availability' },
                maintenanceWindow: {
                    type: 'object',
                    properties: {
                        startTime: { type: 'string', format: 'date-time', example: '2024-03-25T16:00:00Z' },
                        endTime: { type: 'string', format: 'date-time', example: '2024-03-25T18:00:00Z' },
                        reason: { type: 'string', example: 'Scheduled archive system upgrade' }
                    }
                }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Archive operation failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to archive approval due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                archiveError: { type: 'string', example: 'Archive storage system error' },
                rollbackStatus: { type: 'string', example: 'COMPLETED' },
                dataIntegrity: { type: 'boolean', example: true }
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
        summary: '🗑️ Soft delete approval request',
        description: `
# Approval Soft Deletion

Safely remove approval requests from active use while preserving complete audit trails and compliance records for regulatory and legal requirements.

## 🎯 **Primary Use Cases**
- **Data Privacy Compliance**: Remove approvals containing sensitive personal information per GDPR/POPIA requests
- **Error Correction**: Remove incorrectly created or duplicate approval requests
- **Security Incidents**: Immediately remove compromised or fraudulent approval requests
- **Regulatory Compliance**: Meet legal requirements for data removal while maintaining audit trails
- **System Cleanup**: Remove test or development data from production systems

## 🔐 **Soft Delete Features**
- **Audit Preservation**: Complete audit trail and history maintained for compliance
- **Reversible Operation**: Deleted approvals can be restored by administrators if needed
- **Data Masking**: Sensitive information masked while preserving approval structure
- **Access Restriction**: Deleted approvals excluded from normal queries and operations
- **Compliance Tracking**: Deletion events logged for regulatory reporting

## 📋 **Deletion Requirements**
- **Admin Authorization**: Only administrators can perform approval deletion operations
- **Status Validation**: Validates deletion is appropriate for current approval state
- **Dependency Checks**: Ensures deletion won't break system integrity or workflows
- **Legal Compliance**: Confirms deletion meets regulatory requirements
- **Audit Logging**: Complete logging of deletion events and justifications

## 🛡️ **Data Protection & Security**
- **Audit Trail Preservation**: History, signatures, and metadata preserved for compliance
- **Reversible Process**: Soft deletion allows recovery if deletion was performed in error
- **Access Control**: Strict permissions prevent unauthorized deletions
- **Compliance Framework**: Meets GDPR, POPIA, and other data protection requirements
- **Security Logging**: All deletion attempts logged for security monitoring

## 🔄 **Recovery & Restoration**
- **Admin Recovery**: Administrators can restore soft-deleted approvals if needed
- **Audit Restoration**: Complete approval history restored during recovery
- **Timeline Preservation**: Original timestamps and sequences maintained
- **Integrity Verification**: Data integrity checks performed during restoration
- **Access Restoration**: Normal access permissions restored upon recovery

## ⚠️ **Important Considerations**
- **Irreversible After Archival**: Once archived, soft-deleted approvals cannot be easily restored
- **Performance Impact**: Soft deletion may leave data in system affecting storage
- **Compliance Requirements**: Must balance deletion with audit retention requirements
- **Legal Holds**: Cannot delete approvals under legal hold or investigation
- **System Dependencies**: May affect reporting and analytics until data cleanup
        `
    })
    @ApiParam({ 
        name: 'id', 
        description: 'Approval unique identifier to delete', 
        type: 'number',
        example: 12345
    })
    @ApiOkResponse({ 
        description: '🗑️ Approval deleted successfully',
        schema: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 12345 },
                approvalReference: { type: 'string', example: 'LEA-8XQ2K-L7M' },
                title: { type: 'string', example: 'Annual Leave Request - Test User' },
                status: { type: 'string', example: 'APPROVED' },
                isDeleted: { type: 'boolean', example: true },
                deletedAt: { type: 'string', format: 'date-time', example: '2024-03-25T17:45:00Z' },
                deletedBy: { type: 'number', example: 23 },
                deletionInfo: {
                    type: 'object',
                    properties: {
                        deletedByUser: {
                            type: 'object',
                            properties: {
                                uid: { type: 'number', example: 23 },
                                name: { type: 'string', example: 'David Chen' },
                                email: { type: 'string', example: 'david.chen@loro.co.za' },
                                title: { type: 'string', example: 'System Administrator' }
                            }
                        },
                        deletionReason: { type: 'string', example: 'GDPR data subject request for personal data removal' },
                        deletionCategory: { type: 'string', example: 'DATA_PRIVACY_REQUEST' },
                        legalBasis: { type: 'string', example: 'Article 17 GDPR - Right to Erasure' },
                        retentionOverride: { type: 'boolean', example: true },
                        complianceTicket: { type: 'string', example: 'GDPR-2024-03-001' }
                    }
                },
                preservedData: {
                    type: 'object',
                    properties: {
                        auditTrailPreserved: { type: 'boolean', example: true },
                        historyMaintained: { type: 'boolean', example: true },
                        signatureDataRetained: { type: 'boolean', example: true },
                        metadataPreserved: { type: 'boolean', example: true },
                        personalDataMasked: { type: 'boolean', example: true },
                        businessDataRetained: { type: 'boolean', example: true }
                    }
                },
                impact: {
                    type: 'object',
                    properties: {
                        removedFromActiveQueries: { type: 'boolean', example: true },
                        excludedFromReporting: { type: 'boolean', example: true },
                        workflowsUnaffected: { type: 'boolean', example: true },
                        dependenciesValidated: { type: 'boolean', example: true },
                        systemIntegrityMaintained: { type: 'boolean', example: true }
                    }
                },
                compliance: {
                    type: 'object',
                    properties: {
                        gdprCompliant: { type: 'boolean', example: true },
                        popiaCompliant: { type: 'boolean', example: true },
                        auditRequirementsMet: { type: 'boolean', example: true },
                        legalHoldChecked: { type: 'boolean', example: true },
                        retentionPolicyApplied: { type: 'boolean', example: true },
                        deletionEventLogged: { type: 'boolean', example: true }
                    }
                },
                recovery: {
                    type: 'object',
                    properties: {
                        canRestore: { type: 'boolean', example: true },
                        restoreTimeLimit: { type: 'string', example: '30 days' },
                        restoreRequiresApproval: { type: 'boolean', example: true },
                        restoreRequiredRole: { type: 'string', example: 'ADMIN' },
                        dataIntegrityGuaranteed: { type: 'boolean', example: true }
                    }
                },
                timeline: {
                    type: 'object',
                    properties: {
                        createdAt: { type: 'string', format: 'date-time', example: '2024-02-10T09:00:00Z' },
                        completedAt: { type: 'string', format: 'date-time', example: '2024-02-15T16:30:00Z' },
                        deletedAt: { type: 'string', format: 'date-time', example: '2024-03-25T17:45:00Z' },
                        totalLifetime: { type: 'number', example: 43.4, description: 'Days from creation to deletion' },
                        activeLifetime: { type: 'number', example: 5.3, description: 'Days in active status' }
                    }
                },
                notifications: {
                    type: 'object',
                    properties: {
                        stakeholdersNotified: { type: 'boolean', example: true },
                        complianceTeamNotified: { type: 'boolean', example: true },
                        dataSubjectNotified: { type: 'boolean', example: true },
                        auditorsNotified: { type: 'boolean', example: false },
                        notificationChannels: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['email', 'compliance_log']
                        }
                    }
                },
                message: { type: 'string', example: 'Approval soft deleted successfully - audit trail preserved for compliance' }
            }
        }
    })
    @ApiBadRequestResponse({
        description: '❌ Cannot delete approval in current state',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot delete approval due to business rule violations' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Approval is under active legal hold and cannot be deleted',
                        'Active dependent processes prevent deletion',
                        'Approval is required for compliance reporting period',
                        'Deletion would violate audit retention requirements'
                    ]
                },
                blockers: {
                    type: 'object',
                    properties: {
                        legalHold: { type: 'boolean', example: true },
                        activeDependencies: { type: 'number', example: 3 },
                        complianceReporting: { type: 'boolean', example: false },
                        auditPeriod: { type: 'boolean', example: false }
                    }
                },
                alternatives: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Archive approval instead of deletion',
                        'Wait until legal hold is released',
                        'Contact legal team to clarify deletion requirements'
                    ]
                }
            }
        }
    })
    @ApiForbiddenResponse({
        description: '🚫 Access denied - Admin privileges required',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Administrator privileges required for approval deletion operations' },
                error: { type: 'string', example: 'Forbidden' },
                statusCode: { type: 'number', example: 403 },
                requiredRole: { type: 'string', example: 'ADMIN' },
                currentRole: { type: 'string', example: 'MANAGER' },
                requiredPermissions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['DELETE_APPROVALS', 'DATA_MANAGEMENT', 'COMPLIANCE_ADMIN']
                },
                securityNote: { type: 'string', example: 'Approval deletion is a sensitive operation requiring administrative oversight' },
                alternativeActions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Request approval deletion through administrative channels',
                        'Submit data privacy request if deletion is for GDPR compliance',
                        'Contact system administrator for emergency deletion needs'
                    ]
                }
            }
        }
    })
    @ApiNotFoundResponse({ 
        description: '❌ Approval not found or already deleted',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Approval with ID 12345 not found or already deleted' },
                error: { type: 'string', example: 'Not Found' },
                statusCode: { type: 'number', example: 404 },
                possibleReasons: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Approval ID does not exist',
                        'Approval was previously deleted',
                        'Approval was archived and moved to long-term storage',
                        'Access denied due to organizational boundaries'
                    ]
                }
            }
        }
    })
    @ApiConflictResponse({
        description: '⚠️ Conflict - Deletion conflicts with system state',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Cannot delete approval due to active system dependencies' },
                error: { type: 'string', example: 'Conflict' },
                statusCode: { type: 'number', example: 409 },
                conflictType: { type: 'string', example: 'ACTIVE_DEPENDENCIES' },
                dependencies: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', example: 'PAYMENT_PROCESS' },
                            id: { type: 'string', example: 'PAY-2024-001' },
                            description: { type: 'string', example: 'Active payment processing depends on this approval' }
                        }
                    }
                },
                resolution: {
                    type: 'object',
                    properties: {
                        canForceDelete: { type: 'boolean', example: false },
                        requiresManualResolution: { type: 'boolean', example: true },
                        estimatedResolutionTime: { type: 'string', example: '24-48 hours' },
                        contactTeam: { type: 'string', example: 'System Integration Team' }
                    }
                }
            }
        }
    })
    @ApiInternalServerErrorResponse({
        description: '💥 Internal Server Error - Deletion operation failed',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Failed to delete approval due to system error' },
                error: { type: 'string', example: 'Internal Server Error' },
                statusCode: { type: 'number', example: 500 },
                deletionPhase: { type: 'string', example: 'AUDIT_PRESERVATION' },
                rollbackStatus: { type: 'string', example: 'COMPLETED' },
                dataIntegrity: { type: 'boolean', example: true },
                partialDeletion: { type: 'boolean', example: false },
                recoveryRequired: { type: 'boolean', example: false }
            }
        }
    })
    remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
        return this.approvalsService.remove(id, req.user);
    }
}

