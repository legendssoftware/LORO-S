import { Column, Entity, JoinColumn, OneToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Achievement } from './achievement.entity';
import { UnlockedItem } from './unlocked-item.entity';
import { XPTransaction } from './xp-transaction.entity';

@Entity()
export class UserRewards {
    @PrimaryGeneratedColumn()
    uid: number;

    @OneToOne(() => User, user => user?.rewards)
    @JoinColumn({ name: 'ownerClerkUserId', referencedColumnName: 'clerkUserId' })
    owner: User;

    @Column({ nullable: true })
    ownerClerkUserId: string;

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

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    lastAction: Date;

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    updatedAt: Date;
} 