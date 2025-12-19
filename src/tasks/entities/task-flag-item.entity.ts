import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TaskFlag } from './task-flag.entity';
import { TaskFlagItemStatus } from '../../lib/enums/task.enums';

@Entity('task_flag_items')
export class TaskFlagItem {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ type: 'varchar', length: 255 })
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ type: 'enum', enum: TaskFlagItemStatus, default: TaskFlagItemStatus.PENDING })
    status: TaskFlagItemStatus;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date;

    @Column({ type: 'boolean', default: false })
    isDeleted: boolean;

    @ManyToOne(() => TaskFlag, (taskFlag) => taskFlag.items)
    taskFlag: TaskFlag;
} 