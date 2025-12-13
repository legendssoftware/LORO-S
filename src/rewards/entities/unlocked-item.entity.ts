import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserRewards } from './user-rewards.entity';
import { ItemRarity } from '../../lib/enums/rewards.enum';
import { ItemType } from '../../lib/enums/rewards.enum';

@Entity('unlocked_item')
export class UnlockedItem {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column()
    name: string;

    @Column()
    description: string;

    @Column({
        type: 'enum',
        enum: ItemType
    })
    type: ItemType;

    @Column({
        type: 'enum',
        enum: ItemRarity,
        default: ItemRarity.COMMON
    })
    rarity: ItemRarity;

    @Column()
    icon: string;

    @Column()
    requiredLevel: number;

    @Column()
    requiredXP: number;

    @ManyToOne(() => UserRewards, userRewards => userRewards.inventory)
    userRewards: UserRewards;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    unlockedAt: Date;
} 