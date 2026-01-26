import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { ClientLoyaltyProfile } from './client-loyalty-profile.entity';
import { Client } from '../../clients/entities/client.entity';

@Entity('loyalty_points_conversion')
export class LoyaltyPointsConversion {
	@PrimaryGeneratedColumn()
	uid: number;

	@ManyToOne(() => ClientLoyaltyProfile, { nullable: false })
	@JoinColumn({ name: 'loyaltyProfileUid' })
	loyaltyProfile: ClientLoyaltyProfile;

	@Column({ nullable: false })
	loyaltyProfileUid: number;

	@ManyToOne(() => Client, { nullable: false })
	@JoinColumn({ name: 'clientUid' })
	client: Client;

	@Column({ nullable: false })
	clientUid: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: false })
	pointsConverted: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: false })
	creditAmount: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: false })
	conversionRate: number; // Points per currency unit (e.g., 100 points = 1 ZAR)

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
	creditLimitBefore: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
	creditLimitAfter: number;

	@Column({ type: 'varchar', nullable: true })
	reason: string;

	@Column({ type: 'varchar', nullable: true })
	status: string; // 'pending', 'approved', 'rejected', 'completed'

	@Column({ type: 'varchar', nullable: true })
	approvedBy: string;

	@Column({ type: 'timestamptz', nullable: true })
	approvedAt: Date;

	@Column('json')
	metadata: {
		originalPoints?: number;
		pointsAfterConversion?: number;
		conversionType?: string;
		[key: string]: any;
	};

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;
}
