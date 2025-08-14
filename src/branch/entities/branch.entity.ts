import { Organisation } from '../../organisation/entities/organisation.entity';
import { GeneralStatus } from '../../lib/enums/status.enums';
import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn, Index } from 'typeorm';
import { Tracking } from '../../tracking/entities/tracking.entity';
import { News } from '../../news/entities/news.entity';
import { Lead } from '../../leads/entities/lead.entity';
import { Journal } from '../../journal/entities/journal.entity';
import { Doc } from '../../docs/entities/doc.entity';
import { Claim } from '../../claims/entities/claim.entity';
import { Attendance } from '../../attendance/entities/attendance.entity';
import { Asset } from '../../assets/entities/asset.entity';
import { User } from '../../user/entities/user.entity';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { Report } from '../../reports/entities/report.entity';
import { Product } from 'src/products/entities/product.entity';
import { Client } from 'src/clients/entities/client.entity';
import { Reseller } from 'src/resellers/entities/reseller.entity';
import { Banners } from 'src/shop/entities/banners.entity';
import { Task } from 'src/tasks/entities/task.entity';
import { Quotation } from 'src/shop/entities/quotation.entity';
import { Notification } from 'src/notifications/entities/notification.entity';
import { CommunicationLog } from 'src/communication/entities/communication-log.entity';
import { Route } from 'src/tasks/entities/route.entity';
import { Order } from 'src/shop/entities/order.entity';
import { Leave } from 'src/leave/entities/leave.entity';
import { Project } from 'src/shop/entities/project.entity';

@Entity('branch')
@Index(['organisation', 'status']) // Organisation branch queries
@Index(['name', 'organisation']) // Branch lookup within org
@Index(['email']) // Contact lookups
@Index(['phone']) // Contact lookups
@Index(['ref']) // Reference lookups
@Index(['status', 'isDeleted']) // Active branch filtering
@Index(['createdAt']) // Date-based sorting
export class Branch {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false })
	name: string;

	@Column({ nullable: false, unique: true })
	email: string;

	@Column({ nullable: false, unique: true })
	phone: string;

	@Column({ nullable: false })
	contactPerson: string;

	@Column({ nullable: false, unique: true })
	ref: string;

	@Column({ type: 'json', nullable: false })
	address: {
		street: string;
		suburb: string;
		city: string;
		state: string;
		country: string;
		postalCode: string;
	};

	@Column({ nullable: false, unique: true })
	website: string;

	@Column({ nullable: false, default: GeneralStatus.ACTIVE })
	status: GeneralStatus;

	@Column({ nullable: false, default: false })
	isDeleted: boolean;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;

	@Column({ type: 'varchar', nullable: true })
	alias: string;

	// Relations
	@ManyToOne(() => Organisation, (organisation) => organisation?.branches, { nullable: true })
	organisation: Organisation;

	@OneToMany(() => Tracking, (tracking) => tracking?.branch, { nullable: true })
	trackings: Tracking[];

	@OneToMany(() => Banners, (banner) => banner?.branch, { nullable: true })
	banners: Banners[];

	@OneToMany(() => News, (news) => news?.branch, { nullable: true })
	news: News[];

	@OneToMany(() => Lead, (lead) => lead?.branch, { nullable: true })
	leads: Lead[];

	@OneToMany(() => Journal, (journal) => journal?.branch, { nullable: true })
	journals: Journal[];

	@OneToMany(() => Doc, (doc) => doc?.branch, { nullable: true })
	docs: Doc[];

	@OneToMany(() => Claim, (claim) => claim?.branch, { nullable: true })
	claims: Claim[];

	@OneToMany(() => Attendance, (attendance) => attendance?.branch, { nullable: true })
	attendances: Attendance[];

	@OneToMany(() => Asset, (asset) => asset?.branch, { nullable: true })
	assets: Asset[];

	@OneToMany(() => User, (user) => user?.branch, { nullable: true })
	users: User[];

	@OneToMany(() => CheckIn, (checkIn) => checkIn?.branch, { nullable: true })
	checkIns: CheckIn[];

	@OneToMany(() => Report, (report) => report?.branch, { nullable: true })
	reports: Report[];

	@OneToMany(() => Product, (product) => product?.branch, { nullable: true })
	products: Product[];

	@OneToMany(() => Client, (client) => client?.branch, { nullable: true })
	clients: Client[];

	@OneToMany(() => Reseller, (reseller) => reseller?.branch, { nullable: true })
	resellers: Reseller[];

	@OneToMany(() => Task, (task) => task.branch)
	tasks: Task[];

	@OneToMany(() => Route, (route) => route.branch)
	routes: Route[];

	@OneToMany(() => Quotation, (quotation) => quotation?.branch, { nullable: true })
	quotations: Quotation[];

	@OneToMany(() => Order, (order) => order.branch)
	orders: Order[];

	@OneToMany(() => Notification, (notification) => notification?.branch, { nullable: true })
	notifications: Notification[];

	@OneToMany(() => CommunicationLog, (communicationLog) => communicationLog?.branch, { nullable: true })
	communicationLogs: CommunicationLog[];

	@OneToMany(() => Leave, (leave) => leave?.branch, { nullable: true })
	leaves: Leave[];

	@OneToMany(() => Project, (project) => project?.branch, { nullable: true })
	projects: Project[];
}
