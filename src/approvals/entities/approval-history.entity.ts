import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    ManyToOne,
    JoinColumn
} from 'typeorm';
import { Approval } from './approval.entity';
import { User } from '../../user/entities/user.entity';
import { ApprovalAction, ApprovalStatus } from '../../lib/enums/approval.enums';

@Entity('approval_history')
export class ApprovalHistory {
    @PrimaryGeneratedColumn()
    uid: number;

    @ManyToOne(() => Approval, (approval) => approval.history, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'approvalUid' })
    approval: Approval;

    @Column({ type: 'int', nullable: false })
    approvalUid: number;

    @Column({ type: 'enum', enum: ApprovalAction })
    action: ApprovalAction;

    @Column({ type: 'enum', enum: ApprovalStatus, nullable: true })
    fromStatus: ApprovalStatus;

    @Column({ type: 'enum', enum: ApprovalStatus })
    toStatus: ApprovalStatus;

    @ManyToOne(() => User, { nullable: false })
    @JoinColumn({ name: 'actionByClerkUserId', referencedColumnName: 'clerkUserId' })
    actionByUser: User;

    @Column({ type: 'varchar', nullable: false })
    actionByClerkUserId: string;

    @Column({ type: 'text', nullable: true })
    comments: string;

    @Column({ type: 'text', nullable: true })
    reason: string;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    // Audit information
    @Column({ type: 'varchar', length: 45, nullable: true })
    ipAddress: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    userAgent: string;

    @Column({ type: 'json', nullable: true })
    geolocation: { latitude: number; longitude: number; accuracy?: number };

    @Column({ type: 'varchar', length: 50, nullable: true })
    source: string; // 'web', 'mobile', 'api', 'system'

    @Column({ type: 'json', nullable: true })
    metadata: Record<string, any>; // Additional action metadata

    @Column({ type: 'json', nullable: true })
    attachments: Array<{
        filename: string;
        url: string;
        fileSize: number;
        mimeType: string;
    }>;

    @Column({ type: 'boolean', default: false })
    isSystemAction: boolean; // True for automated actions

    @Column({ type: 'int', nullable: true })
    escalationLevel: number; // If this was an escalation action

    @Column({ type: 'timestamptz', nullable: true })
    scheduledFor: Date; // If this was a scheduled action

    @Column({ type: 'varchar', nullable: true })
    delegatedFromClerkUserId: string; // If action was taken by delegate
} 