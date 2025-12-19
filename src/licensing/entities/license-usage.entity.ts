import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { License } from './license.entity';
import { MetricType } from '../../lib/enums/licenses';

@Entity('license_usage')
export class LicenseUsage {
    @PrimaryGeneratedColumn('uuid')
    uid: string;

    @ManyToOne(() => License, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'licenseId' })
    license: License;

    @Column()
    licenseId: string;

    @Column({ type: 'enum', enum: MetricType })
    metricType: MetricType;

    @Column({ type: 'int', })
    currentValue: number;

    @Column({ type: 'int' })
    limit: number;

    @Column({ type: 'float' })
    utilizationPercentage: number;

    @Column({ type: 'json', nullable: true })
    metadata: Record<string, any>;

    @Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    timestamp: Date;
} 