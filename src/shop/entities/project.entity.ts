import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	OneToMany,
	JoinColumn,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { User } from '../../user/entities/user.entity';
import { Quotation } from './quotation.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { ProjectType, ProjectStatus, ProjectPriority } from '../../lib/enums/project.enums';

@Entity('project')
export class Project {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false })
	name: string;

	@Column({ type: 'text', nullable: true })
	description: string;

	@Column({ type: 'enum', enum: ProjectType, nullable: false })
	type: ProjectType;

	@Column({ type: 'enum', enum: ProjectStatus, default: ProjectStatus.PLANNING })
	status: ProjectStatus;

	@Column({ type: 'enum', enum: ProjectPriority, default: ProjectPriority.MEDIUM })
	priority: ProjectPriority;

	// Budget information
	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: false, default: 0 })
	budget: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: false, default: 0 })
	currentSpent: number;

	// Contact information
	@Column({ nullable: false })
	contactPerson: string;

	@Column({ nullable: true })
	contactEmail: string;

	@Column({ nullable: true })
	contactPhone: string;

	// Project timeline
	@Column({ type: 'date', nullable: true })
	startDate: Date;

	@Column({ type: 'date', nullable: true })
	endDate: Date;

	@Column({ type: 'date', nullable: true })
	expectedCompletionDate: Date;

	// Location information
	@Column({ type: 'json', nullable: true })
	address: {
		street: string;
		suburb: string;
		city: string;
		state: string;
		country: string;
		postalCode: string;
	};

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	latitude: number;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	longitude: number;

	// Additional project details
	@Column({ type: 'json', nullable: true })
	requirements: string[];

	@Column({ type: 'json', nullable: true })
	tags: string[];

	@Column({ type: 'text', nullable: true })
	notes: string;

	// Currency information
	@Column({ nullable: true, length: 6, default: 'ZAR' })
	currency: string;

	// Progress tracking
	@Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
	progressPercentage: number;

	// Timestamps
	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;

	@Column({ default: false })
	isDeleted: boolean;

	// Relations
	@ManyToOne(() => Client, (client) => client.projects, { nullable: false, eager: true })
	@JoinColumn({ name: 'clientUid' })
	client: Client;

	@Column({ nullable: false })
	clientUid: number;

	@ManyToOne(() => User, (user) => user.projects, { nullable: false, eager: true })
	@JoinColumn({ name: 'assignedUserClerkUserId', referencedColumnName: 'clerkUserId' })
	assignedUser: User;

	@Column({ nullable: false })
	assignedUserClerkUserId: string;

	@OneToMany(() => Quotation, (quotation) => quotation.project, { nullable: true })
	quotations: Quotation[];

	@ManyToOne(() => Organisation, (organisation) => organisation.projects, { nullable: true })
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;

	@ManyToOne(() => Branch, (branch) => branch.projects, { nullable: true })
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;
} 