import { Column, Entity, OneToMany, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { LoyaltyRewardType, LoyaltyTier } from '../../lib/enums/loyalty.enums';
import { LoyaltyRewardClaim } from './loyalty-reward-claim.entity';

@Entity('loyalty_reward')
export class LoyaltyReward {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ type: 'varchar', nullable: false })
	name: string;

	@Column({ type: 'text', nullable: true })
	description: string;

	@Column({
		type: 'enum',
		enum: LoyaltyRewardType,
		nullable: false
	})
	rewardType: LoyaltyRewardType;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: false })
	pointsRequired: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
	discountPercentage: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
	discountAmount: number;

	@Column({ type: 'varchar', nullable: true })
	freeItemName: string;

	@Column({ type: 'varchar', nullable: true })
	freeItemSku: string;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
	cashbackAmount: number;

	@Column({
		type: 'enum',
		enum: LoyaltyTier,
		nullable: true
	})
	minimumTier: LoyaltyTier;

	@Column({ type: 'varchar', nullable: true })
	icon: string;

	@Column({ type: 'varchar', nullable: true })
	imageUrl: string;

	@Column({ type: 'boolean', default: true })
	isActive: boolean;

	@Column({ type: 'int', nullable: true })
	usageLimit: number;

	@Column({ type: 'int', default: 0 })
	timesRedeemed: number;

	@Column({ type: 'timestamptz', nullable: true })
	validFrom: Date;

	@Column({ type: 'timestamptz', nullable: true })
	validUntil: Date;

	@Column({ type: 'int', nullable: true })
	maxRedemptionsPerClient: number;

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

	@OneToMany(() => LoyaltyRewardClaim, claim => claim.reward)
	claims: LoyaltyRewardClaim[];

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;
}
