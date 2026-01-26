import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { 
    IsString, 
    IsOptional, 
    IsEnum, 
    IsBoolean,
    IsNotEmpty,
    MaxLength,
    IsObject,
    IsArray,
    ArrayMaxSize,
    IsInt,
    Min
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApprovalAction, ApprovalStatus, SignatureType } from '../../lib/enums/approval.enums';

export class ApprovalActionDto {
    @ApiProperty({
        description: 'Action to perform on the approval',
        enum: ApprovalAction,
        example: ApprovalAction.APPROVE
    })
    @IsEnum(ApprovalAction)
    action: ApprovalAction;

    @ApiPropertyOptional({
        description: 'Comments or notes for the action',
        example: 'Approved - all requirements met',
        maxLength: 2000
    })
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    comments?: string;

    @ApiPropertyOptional({
        description: 'Reason for rejection (required if action is REJECT)',
        example: 'Insufficient documentation provided',
        maxLength: 1000
    })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    reason?: string;

    @ApiPropertyOptional({
        description: 'Conditions for conditional approval',
        type: 'array',
        items: { type: 'string' },
        example: ['Must provide medical certificate', 'Must notify team lead']
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @IsString({ each: true })
    conditions?: string[];

    @ApiPropertyOptional({
        description: 'Whether to send notification to requester',
        default: true
    })
    @IsOptional()
    @IsBoolean()
    sendNotification?: boolean;

    @ApiPropertyOptional({
        description: 'Custom notification message',
        maxLength: 500
    })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    notificationMessage?: string;

    @ApiPropertyOptional({
        description: 'Clerk User ID to delegate to (for DELEGATE action)',
        type: 'string'
    })
    @IsOptional()
    @IsString()
    delegateToClerkUserId?: string;

    @ApiPropertyOptional({
        description: 'Clerk User ID to escalate to (for ESCALATE action)',
        type: 'string'
    })
    @IsOptional()
    @IsString()
    escalateToClerkUserId?: string;

    @ApiPropertyOptional({
        description: 'Additional metadata for the action',
        example: { location: 'Head Office', timestamp: '2024-03-15T10:30:00Z' }
    })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

export class SignApprovalDto {
    @ApiProperty({
        description: 'Type of signature being applied',
        enum: SignatureType,
        example: SignatureType.ELECTRONIC
    })
    @IsEnum(SignatureType)
    signatureType: SignatureType;

    @ApiProperty({
        description: 'URL or path to the signature data',
        example: 'https://example.com/signatures/user123-approval456.png'
    })
    @IsString()
    @IsNotEmpty()
    signatureUrl: string;

    @ApiPropertyOptional({
        description: 'Base64 encoded signature data or hash',
        maxLength: 1000
    })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    signatureData?: string;

    @ApiPropertyOptional({
        description: 'Comments for the signature',
        maxLength: 500
    })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    comments?: string;

    @ApiPropertyOptional({
        description: 'Certificate information for digital signatures'
    })
    @IsOptional()
    @IsObject()
    certificateInfo?: {
        certificateId?: string;
        issuer?: string;
        subject?: string;
        validFrom?: string;
        validTo?: string;
        fingerprint?: string;
        algorithm?: string;
    };

    @ApiPropertyOptional({
        description: 'Biometric data for advanced signatures'
    })
    @IsOptional()
    @IsObject()
    biometricData?: {
        fingerprintHash?: string;
        retinaScanHash?: string;
        faceRecognitionHash?: string;
        voicePrintHash?: string;
    };

    @ApiPropertyOptional({
        description: 'Legal compliance information'
    })
    @IsOptional()
    @IsObject()
    legalInfo?: {
        framework?: string; // 'eIDAS', 'ESIGN', 'UETA'
        complianceLevel?: string; // 'Basic', 'Advanced', 'Qualified'
        requiresWitness?: boolean;
        witnessUid?: number;
    };
}

export class BulkApprovalActionDto {
    @ApiProperty({
        description: 'Array of approval UIDs to act on',
        type: 'array',
        items: { type: 'number' },
        example: [123, 456, 789]
    })
    @IsArray()
    @ArrayMaxSize(100)
    approvalUids: number[];

    @ApiProperty({
        description: 'Action to perform on all approvals',
        enum: ApprovalAction,
        example: ApprovalAction.APPROVE
    })
    @IsEnum(ApprovalAction)
    action: ApprovalAction;

    @ApiPropertyOptional({
        description: 'Comments for the bulk action',
        maxLength: 1000
    })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    comments?: string;

    @ApiPropertyOptional({
        description: 'Whether to send notifications',
        default: true
    })
    @IsOptional()
    @IsBoolean()
    sendNotifications?: boolean;
} 