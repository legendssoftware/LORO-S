import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	ManyToOne,
	JoinColumn,
	CreateDateColumn,
	UpdateDateColumn,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Task } from '../../tasks/entities/task.entity';
import { FeedbackStatus, FeedbackType } from '../../lib/enums/feedback.enums';

@Entity('feedback')
export class Feedback {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ type: 'enum', enum: FeedbackType })
	type: FeedbackType;

	@Column()
	title: string;

	@Column({ type: 'text' })
	comments: string;

	@Column({ type: 'simple-array', nullable: true })
	attachments: string[];

	@Column({ type: 'int', nullable: true })
	rating: number;

	@Column({ type: 'enum', enum: FeedbackStatus, default: FeedbackStatus.NEW })
	status: FeedbackStatus;

	@Column({ nullable: true })
	token: string;

	@ManyToOne(() => Client, { nullable: true })
	@JoinColumn({ name: 'client_uid' })
	client: Client;

	@ManyToOne(() => Organisation)
	@JoinColumn({ name: 'organisation_uid' })
	organisation: Organisation;

	@ManyToOne(() => Branch, { nullable: true })
	@JoinColumn({ name: 'branch_uid' })
	branch: Branch;

	@ManyToOne(() => Task, { nullable: true })
	@JoinColumn({ name: 'task_uid' })
	task: Task;

	@Column({ nullable: true })
	responseText: string;

	@Column({ nullable: true })
	respondedBy: number;

	@Column({ nullable: true })
	respondedAt: Date;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@Column({ default: false })
	isDeleted: boolean;
}
