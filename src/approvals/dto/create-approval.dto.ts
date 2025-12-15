import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { 
    IsString, 
    IsOptional, 
    IsEnum, 
    IsNumber, 
    IsBoolean, 
    IsArray, 
    IsDateString, 
    IsObject, 
    ValidateNested,
    IsNotEmpty,
    MaxLength,
    Min,
    Max,
    IsDecimal,
    ArrayMinSize,
    ArrayMaxSize,
    IsUrl,
    IsEmail,
    IsInt,
    IsPositive
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { 
    ApprovalType, 
    ApprovalPriority, 
    ApprovalFlow,
    SignatureType,
    NotificationFrequency 
} from '../../lib/enums/approval.enums';

export class SupportingDocumentDto {
    @IsString()
    @IsNotEmpty()
    filename: string;

    @IsUrl({}, { message: 'Document URL must be a valid URL' })
    url: string;

    @IsOptional()
    @IsNumber()
    fileSize?: number;

    @IsOptional()
    @IsString()
    mimeType?: string;

    @IsOptional()
    @IsString()
    description?: string;
}

export class CreateApprovalDto {
    @ApiProperty({
        description: 'Title of the approval request',
        example: 'Leave Request - John Doe - Annual Leave',
        maxLength: 255
    })
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    title: string;

    @ApiPropertyOptional({
        description: 'Detailed description of what needs approval',
        example: 'Request for 5 days annual leave from 2024-03-15 to 2024-03-20 for family vacation.',
        type: 'string'
    })
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    description?: string;

    @ApiProperty({
        description: 'Type of approval being requested',
        enum: ApprovalType,
        example: ApprovalType.LEAVE_REQUEST
    })
    @IsEnum(ApprovalType)
    type: ApprovalType;

    @ApiPropertyOptional({
        description: 'Priority level of the approval',
        enum: ApprovalPriority,
        default: ApprovalPriority.MEDIUM,
        example: ApprovalPriority.HIGH
    })
    @IsOptional()
    @IsEnum(ApprovalPriority)
    priority?: ApprovalPriority;

    @ApiPropertyOptional({
        description: 'Approval workflow type',
        enum: ApprovalFlow,
        default: ApprovalFlow.SINGLE_APPROVER,
        example: ApprovalFlow.SEQUENTIAL
    })
    @IsOptional()
    @IsEnum(ApprovalFlow)
    flowType?: ApprovalFlow;

    // Entity Relations
    @ApiPropertyOptional({
        description: 'Type of entity this approval relates to',
        example: 'leave_request',
        maxLength: 100
    })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    entityType?: string;

    @ApiPropertyOptional({
        description: 'ID of the related entity',
        example: 123,
        minimum: 1
    })
    @IsOptional()
    @IsInt()
    @IsPositive()
    entityId?: number;

    @ApiPropertyOptional({
        description: 'Snapshot of entity data at time of approval request',
        example: { leaveType: 'annual', days: 5, startDate: '2024-03-15' }
    })
    @IsOptional()
    @IsObject()
    entityData?: Record<string, any>;

    // Approver Information
    @ApiPropertyOptional({
        description: 'Specific approver user ID (if known)',
        example: 456,
        minimum: 1
    })
    @IsOptional()
    @IsInt()
    @IsPositive()
    approverUid?: number;

    @ApiPropertyOptional({
        description: 'Organization reference',
        example: 'ORG123'
    })
    @IsOptional()
    @IsString()
    organisationRef?: string;

    @ApiPropertyOptional({
        description: 'Branch ID for branch-specific approvals',
        example: 789,
        minimum: 1
    })
    @IsOptional()
    @IsInt()
    @IsPositive()
    branchUid?: number;

    // Workflow Configuration
    @ApiPropertyOptional({
        description: 'Approval chain for multi-step workflows',
        type: 'array',
        items: {
            type: 'object',
            properties: {
                uid: { type: 'number', example: 123 },
                order: { type: 'number', example: 1 },
                required: { type: 'boolean', example: true },
                role: { type: 'string', example: 'manager' }
            }
        }
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    approverChain?: Array<{ uid: number; order: number; required: boolean; role?: string }>;

    @ApiPropertyOptional({
        description: 'Whether all approvers must approve (for unanimous workflows)',
        default: false
    })
    @IsOptional()
    @IsBoolean()
    requiresAllApprovers?: boolean;

    @ApiPropertyOptional({
        description: 'Number of approvers required (for majority workflows)',
        minimum: 1,
        maximum: 50
    })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(50)
    requiredApprovers?: number;

    // Timing
    @ApiPropertyOptional({
        description: 'Deadline for approval decision (ISO 8601 format)',
        example: '2024-03-25T17:00:00.000Z'
    })
    @IsOptional()
    @IsDateString()
    deadline?: string;

    @ApiPropertyOptional({
        description: 'Mark as urgent',
        default: false
    })
    @IsOptional()
    @IsBoolean()
    isUrgent?: boolean;

    // Financial Information
    @ApiPropertyOptional({
        description: 'Monetary amount if applicable',
        example: 1500.00,
        minimum: 0
    })
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    amount?: number;

    @ApiPropertyOptional({
        description: 'Currency code (ISO 4217)',
        example: 'USD',
        maxLength: 10
    })
    @IsOptional()
    @IsString()
    @MaxLength(10)
    currency?: string;

    // Documents & Attachments
    @ApiPropertyOptional({
        description: 'Attached files',
        type: 'array',
        items: {
            type: 'object',
            properties: {
                filename: { type: 'string', example: 'leave-form.pdf' },
                url: { type: 'string', example: 'https://example.com/files/leave-form.pdf' },
                uploadedAt: { type: 'string', format: 'date-time' },
                uploadedBy: { type: 'number', example: 123 },
                fileSize: { type: 'number', example: 1024 },
                mimeType: { type: 'string', example: 'application/pdf' }
            }
        }
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    attachments?: Array<{
        filename: string;
        url: string;
        uploadedAt: Date;
        uploadedBy: number;
        fileSize: number;
        mimeType: string;
    }>;

    @ApiPropertyOptional({
        description: 'URLs to supporting documents',
        type: 'array',
        items: { type: 'string', format: 'url' }
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    supportingDocuments?: SupportingDocumentDto[];

    @ApiPropertyOptional({
        description: 'URLs to supporting documents',
        type: 'array',
        items: { type: 'string', format: 'url' }
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    supportingDocumentUrls?: string[];

    // Digital Signatures
    @ApiPropertyOptional({
        description: 'Whether this approval requires a digital signature',
        default: false
    })
    @IsOptional()
    @IsBoolean()
    requiresSignature?: boolean;

    @ApiPropertyOptional({
        description: 'Type of signature required',
        enum: SignatureType,
        example: SignatureType.ELECTRONIC
    })
    @IsOptional()
    @IsEnum(SignatureType)
    signatureType?: SignatureType;

    // Notifications
    @ApiPropertyOptional({
        description: 'How frequently to send reminder notifications',
        enum: NotificationFrequency,
        default: NotificationFrequency.IMMEDIATE
    })
    @IsOptional()
    @IsEnum(NotificationFrequency)
    notificationFrequency?: NotificationFrequency;

    @ApiPropertyOptional({
        description: 'Enable email notifications',
        default: true
    })
    @IsOptional()
    @IsBoolean()
    emailNotificationsEnabled?: boolean;

    @ApiPropertyOptional({
        description: 'Enable push notifications',
        default: true
    })
    @IsOptional()
    @IsBoolean()
    pushNotificationsEnabled?: boolean;

    // Escalation
    @ApiPropertyOptional({
        description: 'User ID to escalate to if not approved in time',
        minimum: 1
    })
    @IsOptional()
    @IsInt()
    @IsPositive()
    escalatedToUid?: number;

    @ApiPropertyOptional({
        description: 'Reason for potential escalation',
        maxLength: 255
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    escalationReason?: string;

    // Custom Fields
    @ApiPropertyOptional({
        description: 'Custom fields for approval-specific data',
        example: { 
            department: 'Engineering',
            projectCode: 'PROJ-123',
            costCenter: 'CC-456'
        }
    })
    @IsOptional()
    @IsObject()
    customFields?: Record<string, any>;

    @ApiPropertyOptional({
        description: 'Additional metadata',
        example: {
            submissionMethod: 'web',
            formVersion: '2.1',
            requesterComments: 'Urgent due to family emergency'
        }
    })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;

    // Audit Fields (typically set by the system)
    @ApiPropertyOptional({
        description: 'Source of the request',
        example: 'web',
        maxLength: 50
    })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    requestSource?: string;

    @ApiPropertyOptional({
        description: 'Geolocation where request was made',
        type: 'object',
        properties: {
            latitude: { type: 'number', example: 40.7128 },
            longitude: { type: 'number', example: -74.0060 },
            accuracy: { type: 'number', example: 10 }
        }
    })
    @IsOptional()
    @IsObject()
    geolocation?: { latitude: number; longitude: number; accuracy?: number };

    @ApiPropertyOptional({
        description: 'Automatically submit approval as PENDING instead of creating as DRAFT. Used when approvals are created from other services (leave, claims, etc.)',
        default: false
    })
    @IsOptional()
    @IsBoolean()
    autoSubmit?: boolean;
}
