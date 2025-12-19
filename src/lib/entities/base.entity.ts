import {
    DeleteDateColumn,
    PrimaryGeneratedColumn,
    BeforeUpdate,
    Column,
} from 'typeorm';

export abstract class BaseEntity {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    updatedAt: Date;

    @DeleteDateColumn({
        type: 'timestamptz',
        nullable: true,
    })
    deletedAt?: Date;

    @Column({ default: false })
    isDeleted: boolean;

    @BeforeUpdate()
    updateTimestamp() {
        this.updatedAt = new Date();
    }
} 