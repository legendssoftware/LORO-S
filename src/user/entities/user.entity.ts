import { AccessLevel } from '../../lib/enums/user.enums';
import { UserProfile } from './user.profile.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Claim } from '../../claims/entities/claim.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { Doc } from '../../docs/entities/doc.entity';
import { News } from '../../news/entities/news.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Client } from '../../clients/entities/client.entity';
import { Quotation } from '../../shop/entities/quotation.entity';
import { Project } from '../../shop/entities/project.entity';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { Tracking } from '../../tracking/entities/tracking.entity';
import { Asset } from '../../assets/entities/asset.entity';
import { Report } from '../../reports/entities/report.entity';
import { UserRewards } from '../../rewards/entities/user-rewards.entity';
import { Attendance } from '../../attendance/entities/attendance.entity';
import { UserEmployeementProfile } from './user.employeement.profile.entity';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Notification } from '../../notifications/entities/notification.entity';
import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	ManyToOne,
	JoinColumn,
	OneToOne,
	OneToMany,
	Index,
} from 'typeorm';
import { Journal } from 'src/journal/entities/journal.entity';
import { Route } from 'src/tasks/entities/route.entity';
import { TaskFlag } from '../../tasks/entities/task-flag.entity';
import { UserTarget } from './user-target.entity';
import { Warning } from 'src/warnings/entities/warning.entity';
import { ClientCommunicationSchedule } from '../../clients/entities/client-communication-schedule.entity';

@Entity('users')
@Index(['email']) // Login & unique lookups
@Index(['username']) // Login & unique lookups
@Index(['status', 'isDeleted']) // Active user filtering
@Index(['role', 'status']) // Role-based access queries
@Index(['organisationRef', 'status']) // Organization filtering
@Index(['accessLevel', 'isDeleted']) // Permission-based queries
@Index(['resetToken']) // Password reset lookups
@Index(['verificationToken']) // Email verification
@Index(['createdAt']) // Date-based sorting/reporting
export class User {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ unique: true, nullable: false })
	username: string;

	@Column({ nullable: false })
	password: string;

	@Column({ nullable: false })
	name: string;

	@Column({ nullable: false })
	surname: string;

	@Column({ unique: true, nullable: false })
	email: string;

	@Column({ nullable: true, })
	phone: string;

	@Column({ nullable: true })
	photoURL: string;

	@Column({ nullable: true })
	avatar: string;

	@Column({ default: 'user' })
	role: string;

	@Column({ default: 'active' })
	status: string;

	@Column({ nullable: true })
	businesscardURL: string;

	@Column({ nullable: true })
	departmentId: number;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@Column({ type: 'enum', enum: AccessLevel })
	accessLevel: AccessLevel;

	@ManyToOne(() => Organisation, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'organisationRef' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationRef: string;

	@Column({ type: 'int', nullable: true })
	hrID: number;

	@Column({ nullable: true })
	verificationToken: string;

	@Column({ nullable: true })
	resetToken: string;

	@Column({ type: 'timestamp', nullable: true })
	tokenExpires: Date;

	@Column({ type: 'json', nullable: true })
	managedBranches: number[];

	@Column({ type: 'json', nullable: true })
	managedStaff: number[];

	@OneToOne(() => UserProfile, (userProfile) => userProfile?.owner, { nullable: true })
	@JoinColumn()
	userProfile: UserProfile;

	@OneToOne(() => UserEmployeementProfile, (userEmployeementProfile) => userEmployeementProfile?.owner, {
		nullable: true,
	})
	@JoinColumn()
	userEmployeementProfile: UserEmployeementProfile;

	@OneToMany(() => Attendance, (attendance) => attendance.owner)
	attendance: Attendance[];

	@OneToMany(() => Report, (report) => report.owner)
	reports: Report[];

	@OneToMany(() => Claim, (claim) => claim?.owner, { nullable: true })
	userClaims: Claim[];

	@OneToMany(() => Doc, (doc) => doc?.owner, { nullable: true })
	userDocs: Doc[];

	@OneToMany(() => Lead, (lead) => lead?.owner, { nullable: true })
	leads: Lead[];

	@OneToMany(() => News, (news) => news?.author, { nullable: true })
	articles: News[];

	@OneToMany(() => Asset, (asset) => asset?.owner, { nullable: true })
	assets: Asset[];

	@OneToMany(() => Tracking, (tracking) => tracking?.owner, { nullable: true })
	trackings: Tracking[];

	@OneToMany(() => Quotation, (quotation) => quotation?.placedBy, { nullable: true })
	quotations: Quotation[];

	@OneToMany(() => Notification, (notification) => notification?.owner, { nullable: true })
	notifications: Notification[];

	@ManyToOne(() => Branch, (branch) => branch?.users)
	branch: Branch;

	@OneToMany(() => Client, (client) => client?.assignedSalesRep, { nullable: true })
	clients: Client[];

	// Array of client UIDs that this user has access to
	@Column({ type: 'json', nullable: true })
	assignedClientIds: number[];

	@OneToMany(() => CheckIn, (checkIn) => checkIn?.owner, { nullable: true })
	checkIns: CheckIn[];

	@OneToOne(() => UserRewards, (userRewards) => userRewards?.owner, { nullable: true })
	rewards: UserRewards;

	@OneToOne(() => UserTarget, (userTarget) => userTarget.user, { nullable: true, cascade: true })
	@JoinColumn()
	userTarget: UserTarget;

	@OneToMany(() => Journal, (journal) => journal.owner)
	journals: Journal[];

	@Column({ default: false })
	isDeleted: boolean;

	@OneToMany(() => Task, (task) => task?.creator)
	tasks: Task[];

	@OneToMany(() => Route, (route) => route?.assignee)
	routes: Route[];

	@OneToMany(() => TaskFlag, (taskFlag) => taskFlag.createdBy)
	taskFlags: TaskFlag[];

	@OneToMany(() => Warning, (warning) => warning.owner)
	warnings: Warning[];

	@OneToMany(() => Warning, (warning) => warning.issuedBy)
	issuedWarnings: Warning[];

	@Column({ nullable: true })
	expoPushToken: string;

	@Column({ nullable: true })
	deviceId: string;

	@Column({ nullable: true })
	platform: string; // 'ios' | 'android'

	@Column({ type: 'timestamp', nullable: true })
	pushTokenUpdatedAt: Date;

	@OneToMany(() => ClientCommunicationSchedule, (schedule) => schedule.assignedTo, { nullable: true })
	clientCommunicationSchedules: ClientCommunicationSchedule[];

	@OneToMany(() => Project, (project) => project.assignedUser, { nullable: true })
	projects: Project[];

	@Column({ type: 'json', nullable: true })
	preferences: {
		theme?: 'light' | 'dark';
		language?: string;
		notifications?: boolean;
		shiftAutoEnd?: boolean;
		[key: string]: any;
	} | null;

	@Column({ type: 'json', nullable: true })
	managedDoors: number[] | null;
}
