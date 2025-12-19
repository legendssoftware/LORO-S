import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { License } from './license.entity';

export enum LicenseEventType {
    CREATED = 'created',
    RENEWED = 'renewed',
    EXPIRED = 'expired',
    SUSPENDED = 'suspended',
    ACTIVATED = 'activated',
    PLAN_CHANGED = 'plan_changed',
    LIMIT_EXCEEDED = 'limit_exceeded',
    GRACE_PERIOD_ENTERED = 'grace_period_entered',
    GRACE_PERIOD_EXPIRED = 'grace_period_expired',
    VALIDATION_FAILED = 'validation_failed',
    FEATURE_ACCESS_DENIED = 'feature_access_denied'
}

@Entity('license_events')
export class LicenseEvent {
    @PrimaryGeneratedColumn('uuid')
    uid: string;

    @ManyToOne(() => License, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'licenseId' })
    license: License;

    @Column()
    licenseId: string;

    @Column({ type: 'enum', enum: LicenseEventType })
    eventType: LicenseEventType;

    @Column({ type: 'json' })
    details: Record<string, any>;

    @Column({ nullable: true })
    userId: string;

    @Column({ nullable: true })
    userIp: string;

    @Column({ nullable: true })
    userAgent: string;

    @CreateDateColumn({ type: 'timestamptz' })
    timestamp: Date;
} 