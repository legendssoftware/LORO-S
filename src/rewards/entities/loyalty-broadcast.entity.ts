import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('loyalty_broadcast')
export class LoyaltyBroadcast {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ type: 'varchar', nullable: false })
	type: string; // 'email' or 'sms'

	@Column({ type: 'varchar', nullable: false })
	subject: string; // For email, or title for SMS

	@Column({ type: 'text', nullable: false })
	message: string;

	@Column({ type: 'varchar', nullable: true })
	filterTier: string; // Filter by tier (Bronze, Silver, Gold, Platinum)

	@Column({ nullable: true })
	organisationUid: number;

	@Column({ nullable: true })
	branchUid: number;

	@Column({ type: 'int', default: 0 })
	totalRecipients: number;

	@Column({ type: 'int', default: 0 })
	sentCount: number;

	@Column({ type: 'int', default: 0 })
	failedCount: number;

	@Column({ type: 'varchar', default: 'pending' })
	status: string; // 'pending', 'processing', 'completed', 'failed'

	@Column('json')
	metadata: {
		templateId?: string;
		filters?: {
			tier?: string[];
			organisationUid?: number;
			branchUid?: number;
		};
		deliveryResults?: {
			successful: string[];
			failed: Array<{ recipient: string; error: string }>;
		};
		[key: string]: any;
	};

	@Column({ type: 'varchar', nullable: true })
	createdBy: string;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', nullable: true })
	completedAt: Date;
}
