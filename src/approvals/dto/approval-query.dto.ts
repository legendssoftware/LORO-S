import { ApiPropertyOptional } from '@nestjs/swagger';
import { 
    IsOptional, 
    IsEnum, 
    IsString, 
    IsBoolean,
    IsInt,
    Min,
    Max,
    IsDateString,
    IsArray,
    ArrayMaxSize
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { 
    ApprovalType, 
    ApprovalStatus, 
    ApprovalPriority, 
    ApprovalFlow 
} from '../../lib/enums/approval.enums';

export class ApprovalQueryDto {
    // Pagination
    @ApiPropertyOptional({
        description: 'Page number (1-based)',
        example: 1,
        minimum: 1,
        default: 1
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({
        description: 'Number of items per page',
        example: 20,
        minimum: 1,
        maximum: 100,
        default: 20
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    // Search
    @ApiPropertyOptional({
        description: 'Search term for title, description, or reference',
        example: 'leave request'
    })
    @IsOptional()
    @IsString()
    search?: string;

    // Filters
    @ApiPropertyOptional({
        description: 'Filter by approval type',
        enum: ApprovalType,
        example: ApprovalType.LEAVE_REQUEST
    })
    @IsOptional()
    @IsEnum(ApprovalType)
    type?: ApprovalType;

    @ApiPropertyOptional({
        description: 'Filter by approval status',
        enum: ApprovalStatus,
        example: ApprovalStatus.PENDING
    })
    @IsOptional()
    @IsEnum(ApprovalStatus)
    status?: ApprovalStatus;

    @ApiPropertyOptional({
        description: 'Filter by priority',
        enum: ApprovalPriority,
        example: ApprovalPriority.HIGH
    })
    @IsOptional()
    @IsEnum(ApprovalPriority)
    priority?: ApprovalPriority;

    @ApiPropertyOptional({
        description: 'Filter by workflow type',
        enum: ApprovalFlow,
        example: ApprovalFlow.SEQUENTIAL
    })
    @IsOptional()
    @IsEnum(ApprovalFlow)
    flowType?: ApprovalFlow;

    // User Filters
    @ApiPropertyOptional({
        description: 'Filter by requester user ID',
        example: 123,
        minimum: 1
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    requesterUid?: number;

    @ApiPropertyOptional({
        description: 'Filter by approver user ID',
        example: 456,
        minimum: 1
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    approverUid?: number;

    // Organization Filters
    @ApiPropertyOptional({
        description: 'Filter by organization reference',
        example: 'ORG123'
    })
    @IsOptional()
    @IsString()
    organisationRef?: string;

    // Date Filters
    @ApiPropertyOptional({
        description: 'Filter by created date from (ISO 8601)',
        example: '2024-03-01T00:00:00.000Z'
    })
    @IsOptional()
    @IsDateString()
    createdFrom?: string;

    @ApiPropertyOptional({
        description: 'Filter by created date to (ISO 8601)',
        example: '2024-03-31T23:59:59.999Z'
    })
    @IsOptional()
    @IsDateString()
    createdTo?: string;

    @ApiPropertyOptional({
        description: 'Filter by deadline from (ISO 8601)',
        example: '2024-03-15T00:00:00.000Z'
    })
    @IsOptional()
    @IsDateString()
    deadlineFrom?: string;

    @ApiPropertyOptional({
        description: 'Filter by deadline to (ISO 8601)',
        example: '2024-03-20T23:59:59.999Z'
    })
    @IsOptional()
    @IsDateString()
    deadlineTo?: string;

    // Boolean Filters
    @ApiPropertyOptional({
        description: 'Filter by overdue status',
        example: true
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    isOverdue?: boolean;

    @ApiPropertyOptional({
        description: 'Filter by urgent status',
        example: true
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    isUrgent?: boolean;

    @ApiPropertyOptional({
        description: 'Filter by signature requirement',
        example: true
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    requiresSignature?: boolean;

    @ApiPropertyOptional({
        description: 'Filter by signed status',
        example: false
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    isSigned?: boolean;

    @ApiPropertyOptional({
        description: 'Filter by escalation status',
        example: false
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    isEscalated?: boolean;

    @ApiPropertyOptional({
        description: 'Include deleted approvals',
        example: false,
        default: false
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    includeDeleted?: boolean = false;

    // Sorting
    @ApiPropertyOptional({
        description: 'Sort field',
        example: 'createdAt',
        enum: [
            'createdAt',
            'updatedAt',
            'submittedAt',
            'deadline',
            'priority',
            'status',
            'title',
            'approvalReference'
        ]
    })
    @IsOptional()
    @IsString()
    sortBy?: string = 'createdAt';

    @ApiPropertyOptional({
        description: 'Sort order',
        example: 'DESC',
        enum: ['ASC', 'DESC']
    })
    @IsOptional()
    @IsString()
    sortOrder?: 'ASC' | 'DESC' = 'DESC';

    // Advanced Filters
    @ApiPropertyOptional({
        description: 'Filter by multiple approval types',
        type: 'array',
        items: { enum: Object.values(ApprovalType) }
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsEnum(ApprovalType, { each: true })
    types?: ApprovalType[];

    @ApiPropertyOptional({
        description: 'Filter by multiple statuses',
        type: 'array',
        items: { enum: Object.values(ApprovalStatus) }
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsEnum(ApprovalStatus, { each: true })
    statuses?: ApprovalStatus[];

    @ApiPropertyOptional({
        description: 'Filter by entity type',
        example: 'leave_request'
    })
    @IsOptional()
    @IsString()
    entityType?: string;

    @ApiPropertyOptional({
        description: 'Filter by minimum amount',
        example: 100.00,
        minimum: 0
    })
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    minAmount?: number;

    @ApiPropertyOptional({
        description: 'Filter by maximum amount',
        example: 5000.00,
        minimum: 0
    })
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    maxAmount?: number;

    @ApiPropertyOptional({
        description: 'Filter by currency',
        example: 'USD'
    })
    @IsOptional()
    @IsString()
    currency?: string;

    // View Options
    @ApiPropertyOptional({
        description: 'Include approval history in results',
        example: false,
        default: false
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    includeHistory?: boolean = false;

    @ApiPropertyOptional({
        description: 'Include signatures in results',
        example: false,
        default: false
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    includeSignatures?: boolean = false;

    @ApiPropertyOptional({
        description: 'Include user details in results',
        example: true,
        default: true
    })
    @IsOptional()
    @Transform(({ value }) => value === 'true')
    @IsBoolean()
    includeUserDetails?: boolean = true;
} 