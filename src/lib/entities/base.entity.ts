import {
    DeleteDateColumn,
    PrimaryGeneratedColumn,
    BeforeUpdate,
    Column,
} from 'typeorm';

export abstract class BaseEntity {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ type: 'timestamp', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'timestamp', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    updatedAt: Date;

    @DeleteDateColumn({
        type: 'timestamp',
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