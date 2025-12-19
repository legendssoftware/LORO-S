import { Branch } from '../../branch/entities/branch.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { User } from '../../user/entities/user.entity';
import {
	Column,
	Entity,
	PrimaryGeneratedColumn,
	ManyToOne,
	CreateDateColumn,
	UpdateDateColumn,
	DeleteDateColumn,
} from 'typeorm';
import { LeaveType, LeaveStatus, HalfDayPeriod } from '../../lib/enums/leave.enums';

@Entity('leave')
export class Leave {
	@PrimaryGeneratedColumn()
	uid: number;

	@ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
	owner?: User;

	@Column({
		type: 'enum',
		enum: LeaveType,
	})
	leaveType: LeaveType;

	@Column({ type: 'date' })
	startDate: Date;

	@Column({ type: 'date' })
	endDate: Date;

	@Column({ type: 'float' })
	duration: number;

	@Column({ type: 'text', nullable: true })
	motivation?: string;

	@Column({
		type: 'enum',
		enum: LeaveStatus,
		default: LeaveStatus.PENDING,
	})
	status: LeaveStatus;

	@ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
	approvedBy?: User;

	@Column({ type: 'text', nullable: true })
	comments?: string;

	@Column({ type: 'boolean', default: false })
	isHalfDay: boolean;

	@Column({
		type: 'enum',
		enum: HalfDayPeriod,
		nullable: true,
	})
	halfDayPeriod?: HalfDayPeriod;

	@Column({ type: 'simple-json', nullable: true })
	attachments?: string[];

	@ManyToOne(() => Organisation, { nullable: true, onDelete: 'SET NULL' })
	organisation?: Organisation;

	@ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
	branch?: Branch;

	@Column({ type: 'timestamptz', nullable: true })
	approvedAt?: Date;

	@Column({ type: 'timestamptz', nullable: true })
	rejectedAt?: Date;

	@Column({ type: 'text', nullable: true })
	rejectionReason?: string;

	@Column({ type: 'boolean', default: false })
	isPublicHoliday: boolean;

	@Column({ type: 'timestamptz', nullable: true })
	cancelledAt?: Date;

	@Column({ type: 'text', nullable: true })
	cancellationReason?: string;

	@Column({ type: 'boolean', default: false })
	isPaid: boolean;

	@Column({ type: 'float', nullable: true })
	paidAmount?: number;

	@Column({ type: 'simple-array', nullable: true })
	tags?: string[];

	@Column({ type: 'int', nullable: true })
	delegatedToUid?: number;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;

	@DeleteDateColumn({ type: 'timestamptz', nullable: true })
	deletedAt?: Date;
}
