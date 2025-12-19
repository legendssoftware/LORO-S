import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserRewards } from './user-rewards.entity';
import { AchievementCategory } from '../../lib/enums/rewards.enum';

@Entity('achievement')
export class Achievement {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column()
    name: string;

    @Column()
    description: string;

    @Column()
    xpValue: number;

    @Column()
    icon: string;

    @Column('json')
    requirements: any;

    @Column({
        type: 'enum',
        enum: AchievementCategory,
        default: AchievementCategory.SPECIAL
    })
    category: AchievementCategory;

    @Column({ default: false })
    isRepeatable: boolean;

    @ManyToOne(() => UserRewards, userRewards => userRewards.achievements)
    userRewards: UserRewards;

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    updatedAt: Date;
} 