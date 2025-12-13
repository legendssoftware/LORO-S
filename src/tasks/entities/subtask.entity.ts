import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Task } from './task.entity';
import { SubTaskStatus } from '../../lib/enums/status.enums';

@Entity('subtask')
export class SubTask {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ nullable: false })
    title: string;

    @Column({ nullable: false, type: 'varchar', length: 5000 })
    description: string;

    @Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
    updatedAt: Date;

    @Column({ nullable: false, default: SubTaskStatus.PENDING })
    status: SubTaskStatus;

    @Column({ nullable: false, default: false })
    isDeleted: boolean;

    @ManyToOne(() => Task, (task) => task?.subtasks)
    task: Task;
} 