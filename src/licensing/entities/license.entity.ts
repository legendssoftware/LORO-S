import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../lib/entities/base.entity';
import { LicenseType, SubscriptionPlan, LicenseStatus, BillingCycle } from '../../lib/enums/license.enums';
import { Organisation } from '../../organisation/entities/organisation.entity';

@Entity('licenses')
export class License extends BaseEntity {
    @Column({ unique: true, nullable: false })
    licenseKey: string;

    @Column({
        type: 'enum',
        enum: LicenseType,
        default: LicenseType.PERPETUAL,
    })
    type: LicenseType;

    @Column({
        type: 'enum',
        enum: SubscriptionPlan,
        default: SubscriptionPlan.STARTER,
    })
    plan: SubscriptionPlan;

    @Column({
        type: 'enum',
        enum: LicenseStatus,
        default: LicenseStatus.ACTIVE,
    })
    status: LicenseStatus;

    @Column({
        type: 'enum',
        enum: BillingCycle,
        default: BillingCycle.MONTHLY,
    })
    billingCycle: BillingCycle;

    @Column({ type: 'timestamptz' })
    validUntil: Date;

    @Column({ type: 'timestamptz', nullable: true })
    lastValidated?: Date;

    @Column()
    maxUsers: number;

    @Column()
    maxBranches: number;

    @Column()
    storageLimit: number;

    @Column()
    apiCallLimit: number;

    @Column()
    integrationLimit: number;

    @Column('json')
    features: Record<string, boolean>;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    price: number;

    @Column({ type: 'int' })
    organisationRef: number;

    @Column({ default: false })
    hasPendingPayments: boolean;

    @ManyToOne(() => Organisation)
    @JoinColumn({ name: 'organisationRef' })
    organisation: Organisation;
} 