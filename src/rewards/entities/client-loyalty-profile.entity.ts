import { Column, Entity, JoinColumn, OneToOne, OneToMany, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { LoyaltyTier, LoyaltyProfileStatus } from '../../lib/enums/loyalty.enums';
import { LoyaltyPointsTransaction } from './loyalty-points-transaction.entity';
import { LoyaltyRewardClaim } from './loyalty-reward-claim.entity';
import { VirtualLoyaltyCard } from './virtual-loyalty-card.entity';

@Entity('client_loyalty_profile')
export class ClientLoyaltyProfile {
	@PrimaryGeneratedColumn()
	uid: number;

	@OneToOne(() => Client, { nullable: false })
	@JoinColumn({ name: 'clientUid' })
	client: Client;

	@Column({ nullable: false })
	clientUid: number;

	@Column({ type: 'varchar', length: 50, unique: true, nullable: false })
	loyaltyCardNumber: string;

	@Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
	currentPoints: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
	totalPointsEarned: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
	totalPointsSpent: number;

	@Column({
		type: 'enum',
		enum: LoyaltyTier,
		default: LoyaltyTier.BRONZE
	})
	tier: LoyaltyTier;

	@Column({
		type: 'enum',
		enum: LoyaltyProfileStatus,
		default: LoyaltyProfileStatus.ACTIVE
	})
	status: LoyaltyProfileStatus;

	@Column({ default: false })
	isProfileComplete: boolean;

	@Column({ type: 'varchar', nullable: true })
	profileCompletionToken: string;

	@Column({ type: 'timestamptz', nullable: true })
	profileCompletionTokenExpiry: Date;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	enrolledAt: Date;

	@Column({ type: 'timestamptz', nullable: true })
	lastActivityAt: Date;

	@Column({ type: 'timestamptz', nullable: true })
	tierUpgradedAt: Date;

	@ManyToOne(() => Organisation, { nullable: true })
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

	@ManyToOne(() => Branch, { nullable: true })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	@OneToMany(() => LoyaltyPointsTransaction, transaction => transaction.loyaltyProfile)
	transactions: LoyaltyPointsTransaction[];

	@OneToMany(() => LoyaltyRewardClaim, claim => claim.loyaltyProfile)
	rewardClaims: LoyaltyRewardClaim[];

	@OneToOne(() => VirtualLoyaltyCard, card => card.loyaltyProfile, { nullable: true })
	virtualCard: VirtualLoyaltyCard;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;
}
