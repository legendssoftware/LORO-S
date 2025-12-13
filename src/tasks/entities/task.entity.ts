import { SubTask } from './subtask.entity';
import { TaskStatus, TaskPriority, RepetitionType, TaskType, JobStatus } from '../../lib/enums/task.enums';
import { SubTaskStatus } from '../../lib/enums/status.enums';
import {
	Column,
	Entity,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	BeforeInsert,
	BeforeUpdate,
	ManyToOne,
	OneToMany,
} from 'typeorm';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { User } from 'src/user/entities/user.entity';
import { Route } from './route.entity';
import { TaskFlag } from './task-flag.entity';

@Entity('tasks')
export class Task {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ type: 'varchar', length: 255 })
	title: string;

	@Column({ type: 'varchar', length: 255 })
	description: string;

	@Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.PENDING })
	status: TaskStatus;

	@Column({ type: 'enum', enum: TaskType, default: TaskType.OTHER })
	taskType: TaskType;

	@Column({ type: 'enum', enum: TaskPriority, default: TaskPriority.MEDIUM })
	priority: TaskPriority;

	@Column({ type: 'enum', enum: RepetitionType, default: RepetitionType.NONE })
	repetitionType: RepetitionType;

	@Column({ type: 'int', default: 0 })
	progress: number;

	@Column({ type: 'timestamp', nullable: true })
	deadline: Date;

	@Column({ type: 'timestamp', nullable: true })
	repetitionDeadline: Date;

	@Column({ type: 'timestamp', nullable: true })
	completionDate: Date;

	@Column({ type: 'boolean', default: false })
	isOverdue: boolean;

	@Column({ type: 'varchar', length: 255, nullable: true })
	targetCategory: string;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@Column({ type: 'boolean', default: false })
	isDeleted: boolean;

	@Column({ type: 'json', nullable: true })
	attachments?: string[];

	@Column({ type: 'timestamp', nullable: true })
	jobStartTime?: Date;

	@Column({ type: 'timestamp', nullable: true })
	jobEndTime?: Date;

	@Column({ type: 'int', nullable: true })
	jobDuration?: number;

	@Column({ type: 'enum', enum: JobStatus, default: JobStatus.QUEUED })
	jobStatus?: JobStatus;

	// Relations
	@ManyToOne(() => User, (user) => user?.tasks)
	creator: User;

	@Column({ type: 'json', nullable: true })
	assignees: { uid: number }[];

	@Column({ type: 'json', nullable: true })
	clients: { uid: number }[];

	@OneToMany(() => SubTask, (subtask) => subtask.task)
	subtasks: SubTask[];

	@OneToMany(() => Route, (route) => route.task)
	routes: Route[];

	@OneToMany(() => TaskFlag, (flag) => flag.task)
	flags: TaskFlag[]; 

	@ManyToOne(() => Organisation, (organisation) => organisation.tasks)
	organisation: Organisation;

	@ManyToOne(() => Branch, (branch) => branch.tasks)
	branch: Branch;

	@BeforeInsert()
	setInitialStatus() {
		this.status = TaskStatus.PENDING;
		this.progress = 0;
		this.jobStatus = JobStatus.QUEUED;
	}

	@BeforeUpdate()
	updateStatus() {
		const now = new Date();

		// Calculate job duration if both start and end times are set but duration is not
		if (this.jobStartTime && this.jobEndTime && !this.jobDuration) {
			const durationMs = this.jobEndTime.getTime() - this.jobStartTime.getTime();
			this.jobDuration = Math.round(durationMs / (1000 * 60));
		}

		// Update job status based on times
		if (this.jobStartTime && !this.jobEndTime && this.jobStatus !== JobStatus.COMPLETED) {
			this.jobStatus = JobStatus.RUNNING;
		} else if (this.jobStartTime && this.jobEndTime) {
			this.jobStatus = JobStatus.COMPLETED;
		}

		// Calculate progress based on subtasks if they exist
		if (this.subtasks?.length > 0) {
			const completedSubtasks = this.subtasks.filter(
				(subtask) => !subtask.isDeleted && subtask.status === SubTaskStatus.COMPLETED,
			).length;
			const totalSubtasks = this.subtasks.filter((subtask) => !subtask.isDeleted).length;
			this.progress = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : this.progress;
		}

		// Check for overdue
		if (this.deadline && now > this.deadline && this.status !== TaskStatus.COMPLETED) {
			this.status = TaskStatus.OVERDUE;
			this.isOverdue = true;
		}

		// Update task status based on progress and job status
		if (this.progress === 100 && this.status !== TaskStatus.COMPLETED) {
			this.status = TaskStatus.COMPLETED;
			this.completionDate = now;
		} else if (this.progress > 0 && this.progress < 100 && this.status === TaskStatus.PENDING) {
			this.status = TaskStatus.IN_PROGRESS;
		} else if (this.jobStatus === JobStatus.RUNNING && this.status === TaskStatus.PENDING) {
			this.status = TaskStatus.IN_PROGRESS;
		} else if (
			this.jobStatus === JobStatus.COMPLETED &&
			this.status !== TaskStatus.COMPLETED &&
			!this.subtasks?.length
		) {
			this.status = TaskStatus.COMPLETED;
			this.completionDate = this.jobEndTime || now;
		}

		// Reset overdue flag if task is completed
		if (this.status === TaskStatus.COMPLETED) {
			this.isOverdue = false;
		}
	}
}
