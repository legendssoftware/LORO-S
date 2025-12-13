import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Achievement } from './achievement.entity';
import { UnlockedItem } from './unlocked-item.entity';
import { XPTransaction } from './xp-transaction.entity';

@Entity()
export class UserRewards {
    @PrimaryGeneratedColumn()
    uid: number;

    @ManyToOne(() => User, user => user?.rewards)
    owner: User;

    @Column({ default: 0 })
    currentXP: number;

    @Column({ default: 0 })
    totalXP: number;

    @Column({ default: 1 })
    level: number;

    @Column({ default: 'ROOKIE' })
    rank: string;

    @OneToMany(() => Achievement, achievement => achievement.userRewards)
    achievements: Achievement[];

    @OneToMany(() => UnlockedItem, item => item.userRewards)
    inventory: UnlockedItem[];

    @OneToMany(() => XPTransaction, transaction => transaction.userRewards)
    xpTransactions: XPTransaction[];

    @Column('json')
    xpBreakdown: {
        tasks: number;
        leads: number;
        sales: number;
        attendance: number;
        collaboration: number;
        login: number;
        other: number;
    };

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    lastAction: Date;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    updatedAt: Date;
} 