import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    OneToMany,
    JoinColumn,
    BeforeInsert,
    BeforeUpdate
} from 'typeorm';
import { 
    ApprovalType, 
    ApprovalStatus, 
    ApprovalPriority, 
    ApprovalFlow,
    SignatureType,
    NotificationFrequency 
} from '../../lib/enums/approval.enums';
import { User } from '../../user/entities/user.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';

import { GeneralStatus } from '../../lib/enums/status.enums';
import { ApprovalHistory } from './approval-history.entity';
import { ApprovalSignature } from './approval-signature.entity';

@Entity('approvals')
export class Approval {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ type: 'varchar', length: 255, nullable: false })
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ type: 'enum', enum: ApprovalType })
    type: ApprovalType;

    @Column({ type: 'enum', enum: ApprovalStatus, default: ApprovalStatus.DRAFT })
    status: ApprovalStatus;

    @Column({ type: 'enum', enum: ApprovalPriority, default: ApprovalPriority.MEDIUM })
    priority: ApprovalPriority;

    @Column({ type: 'enum', enum: ApprovalFlow, default: ApprovalFlow.SINGLE_APPROVER })
    flowType: ApprovalFlow;

    // Entity Relations - what this approval is for
    @Column({ type: 'varchar', length: 100, nullable: true })
    entityType: string; // 'invoice', 'leave_request', 'expense_claim', etc.

    @Column({ type: 'int', nullable: true })
    entityId: number; // ID of the related entity

    @Column({ type: 'json', nullable: true })
    entityData: Record<string, any>; // Snapshot of entity data at time of approval request

    // User Relations
    @ManyToOne(() => User, { nullable: false })
    @JoinColumn({ name: 'requesterUid' })
    requester: User;

    @Column({ type: 'int', nullable: false })
    requesterUid: number;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'approverUid' })
    approver: User;

    @Column({ type: 'int', nullable: true })
    approverUid: number;

    // Delegation support
    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'delegatedFromUid' })
    delegatedFrom: User;

    @Column({ type: 'int', nullable: true })
    delegatedFromUid: number;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'delegatedToUid' })
    delegatedTo: User;

    @Column({ type: 'int', nullable: true })
    delegatedToUid: number;

    // Escalation support
    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'escalatedToUid' })
    escalatedTo: User;

    // Organization & Branch Relations
    @ManyToOne(() => Organisation, { nullable: false })
    @JoinColumn({ name: 'organisationRef' })
    organisation: Organisation;

    @Column({ type: 'varchar', nullable: false })
    organisationRef: string;

    @ManyToOne(() => Branch, { nullable: true })
    @JoinColumn({ name: 'branchUid' })
    branch: Branch;

    @Column({ type: 'int', nullable: true })
    branchUid: number;

    // Approval Workflow Configuration
    @Column({ type: 'json', nullable: true })
    approverChain: Array<{ uid: number; order: number; required: boolean; role?: string }>; // For sequential/parallel workflows

    @Column({ type: 'int', default: 1 })
    currentStep: number; // Current step in approval chain

    @Column({ type: 'int', default: 1 })
    totalSteps: number; // Total steps required

    @Column({ type: 'boolean', default: false })
    requiresAllApprovers: boolean; // For unanimous approval

    @Column({ type: 'int', nullable: true })
    requiredApprovers: number; // Number of approvers needed (for majority vote)

    @Column({ type: 'int', default: 0 })
    approvedCount: number; // Current number of approvals

    @Column({ type: 'int', default: 0 })
    rejectedCount: number; // Current number of rejections

    // Timing & Deadlines
    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    submittedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    deadline: Date;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    rejectedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    completedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    signedAt: Date;

    @Column({ type: 'boolean', default: false })
    isOverdue: boolean;

    @Column({ type: 'boolean', default: false })
    isUrgent: boolean;

    // Approval Details
    @Column({ type: 'text', nullable: true })
    approvalComments: string;

    @Column({ type: 'text', nullable: true })
    rejectionReason: string;

    @Column({ type: 'json', nullable: true })
    conditions: string[]; // Conditions for conditional approval

    @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
    amount: number; // Monetary amount if applicable

    @Column({ type: 'varchar', length: 10, nullable: true })
    currency: string; // Currency code (USD, EUR, ZAR, etc.)

    // Document & Attachment Support
    @Column({ type: 'json', nullable: true })
    attachments: Array<{
        filename: string;
        url: string;
        uploadedAt: Date;
        uploadedBy: number;
        fileSize: number;
        mimeType: string;
    }>;

    @Column({ type: 'json', nullable: true })
    supportingDocuments: string[]; // URLs to supporting documents

    // Digital Signature Support
    @Column({ type: 'boolean', default: false })
    requiresSignature: boolean;

    @Column({ type: 'boolean', default: false })
    isSigned: boolean;

    @Column({ type: 'enum', enum: SignatureType, nullable: true })
    signatureType: SignatureType;

    @Column({ type: 'varchar', length: 500, nullable: true })
    signatureUrl: string; // URL to signature image/document

    @Column({ type: 'json', nullable: true })
    signatureMetadata: {
        ipAddress?: string;
        userAgent?: string;
        location?: { latitude: number; longitude: number };
        timestamp?: Date;
        certificateInfo?: Record<string, any>;
    };

    // Notification & Communication
    @Column({ type: 'enum', enum: NotificationFrequency, default: NotificationFrequency.IMMEDIATE })
    notificationFrequency: NotificationFrequency;

    @Column({ type: 'timestamp', nullable: true })
    lastNotificationSent: Date;

    @Column({ type: 'int', default: 0 })
    notificationCount: number;

    @Column({ type: 'boolean', default: true })
    emailNotificationsEnabled: boolean;

    @Column({ type: 'boolean', default: true })
    pushNotificationsEnabled: boolean;

    // Escalation Management
    @Column({ type: 'boolean', default: false })
    isEscalated: boolean;

    @Column({ type: 'timestamp', nullable: true })
    escalatedAt: Date;

    @Column({ type: 'int', nullable: true })
    escalatedToUid: number;

    @Column({ type: 'varchar', length: 255, nullable: true })
    escalationReason: string;

    @Column({ type: 'int', default: 0 })
    escalationLevel: number; // 0 = no escalation, 1+ = escalation levels

    // Audit & Tracking
    @Column({ type: 'varchar', length: 50, nullable: true })
    requestSource: string; // 'web', 'mobile', 'api', 'system'

    @Column({ type: 'varchar', length: 255, nullable: true })
    userAgent: string;

    @Column({ type: 'varchar', length: 45, nullable: true })
    ipAddress: string;

    @Column({ type: 'json', nullable: true })
    geolocation: { latitude: number; longitude: number; accuracy?: number };

    @Column({ type: 'json', nullable: true })
    customFields: Record<string, any>; // Flexible custom data

    @Column({ type: 'json', nullable: true })
    metadata: Record<string, any>; // Additional metadata

    // Administrative
    @Column({ type: 'enum', enum: GeneralStatus, default: GeneralStatus.ACTIVE })
    recordStatus: GeneralStatus;

    @Column({ type: 'boolean', default: false })
    isDeleted: boolean;

    @Column({ type: 'boolean', default: false })
    isArchived: boolean;

    @Column({ type: 'timestamp', nullable: true })
    archivedAt: Date;

    @Column({ type: 'int', nullable: true })
    archivedBy: number;

    @Column({ type: 'varchar', length: 50, nullable: true })
    approvalReference: string; // Unique reference number

    @Column({ type: 'int', default: 1 })
    version: number; // Version for revision tracking

    // Relations to child entities - will be added later to avoid circular dependencies
    @OneToMany(() => ApprovalHistory, (history) => history.approval, { cascade: true })
    history: ApprovalHistory[];

    @OneToMany(() => ApprovalSignature, (signature) => signature.approval, { cascade: true })
    signatures: ApprovalSignature[];

    // Lifecycle hooks
    @BeforeInsert()
    generateReference() {
        if (!this.approvalReference) {
            const prefix = this.type.toUpperCase().substring(0, 3);
            const timestamp = Date.now().toString(36).toUpperCase();
            const random = Math.random().toString(36).substring(2, 5).toUpperCase();
            this.approvalReference = `${prefix}-${timestamp}-${random}`;
        }
    }

    @BeforeUpdate()
    updateOverdueStatus() {
        if (this.deadline && new Date() > this.deadline && 
            ![ApprovalStatus.APPROVED, ApprovalStatus.REJECTED, ApprovalStatus.COMPLETED, ApprovalStatus.CANCELLED].includes(this.status)) {
            this.isOverdue = true;
        }
    }
}
