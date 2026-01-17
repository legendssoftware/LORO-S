import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { ClientLoyaltyProfile } from './client-loyalty-profile.entity';
import { LoyaltyReward } from './loyalty-reward.entity';
import { LoyaltyRewardClaimStatus } from '../../lib/enums/loyalty.enums';

@Entity('loyalty_reward_claim')
export class LoyaltyRewardClaim {
	@PrimaryGeneratedColumn()
	uid: number;

	@ManyToOne(() => ClientLoyaltyProfile, profile => profile.rewardClaims, { nullable: false })
	loyaltyProfile: ClientLoyaltyProfile;

	@Column({ nullable: false })
	loyaltyProfileUid: number;

	@ManyToOne(() => LoyaltyReward, reward => reward.claims, { nullable: false })
	reward: LoyaltyReward;

	@Column({ nullable: false })
	rewardUid: number;

	@Column({
		type: 'enum',
		enum: LoyaltyRewardClaimStatus,
		default: LoyaltyRewardClaimStatus.PENDING
	})
	status: LoyaltyRewardClaimStatus;

	@Column({ type: 'varchar', length: 100, unique: true, nullable: false })
	claimCode: string;

	@Column({ type: 'varchar', nullable: true })
	voucherCode: string;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: false })
	pointsSpent: number;

	@Column({ type: 'timestamptz', nullable: true })
	redeemedAt: Date;

	@Column({ type: 'varchar', nullable: true })
	redeemedBy: string;

	@Column({ type: 'varchar', nullable: true })
	orderId: string;

	@Column({ type: 'timestamptz', nullable: true })
	expiresAt: Date;

	@Column('json')
	metadata: {
		discountCode?: string;
		originalPoints?: number;
		discountAmount?: number;
		details?: any;
	};

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;
}
