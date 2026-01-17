import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ClientLoyaltyProfile } from './client-loyalty-profile.entity';
import { LoyaltyPointsTransactionType } from '../../lib/enums/loyalty.enums';

@Entity('loyalty_points_transaction')
export class LoyaltyPointsTransaction {
	@PrimaryGeneratedColumn()
	uid: number;

	@ManyToOne(() => ClientLoyaltyProfile, profile => profile.transactions, { nullable: false })
	loyaltyProfile: ClientLoyaltyProfile;

	@Column({ nullable: false })
	loyaltyProfileUid: number;

	@Column({
		type: 'enum',
		enum: LoyaltyPointsTransactionType,
		nullable: false
	})
	transactionType: LoyaltyPointsTransactionType;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: false })
	pointsAmount: number;

	@Column({ type: 'varchar', nullable: false })
	action: string;

	@Column({ type: 'varchar', nullable: true })
	description: string;

	@Column('json')
	metadata: {
		sourceId?: string;
		sourceType?: string;
		orderId?: string;
		purchaseAmount?: number;
		pointsMultiplier?: number;
		tierMultiplier?: number;
		details?: any;
	};

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
	balanceBefore: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
	balanceAfter: number;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;
}
