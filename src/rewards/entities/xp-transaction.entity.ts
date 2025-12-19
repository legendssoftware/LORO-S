import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserRewards } from './user-rewards.entity';

@Entity('xp_transaction')
export class XPTransaction {
    @PrimaryGeneratedColumn()
    uid: number;

    @ManyToOne(() => UserRewards, userRewards => userRewards.xpTransactions)
    userRewards: UserRewards;

    @Column()
    action: string;

    @Column()
    xpAmount: number;

    @Column('json')
    metadata: {
        sourceId: string;
        sourceType: string;
        details: any;
    };

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    timestamp: Date;
} 