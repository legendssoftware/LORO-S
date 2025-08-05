import { GeneralStatus } from '../../lib/enums/status.enums';
import { Branch } from '../../branch/entities/branch.entity';
import { Column, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn, Index } from 'typeorm';
import { Asset } from 'src/assets/entities/asset.entity';
import { Client } from 'src/clients/entities/client.entity';
import { Product } from 'src/products/entities/product.entity';
import { User } from 'src/user/entities/user.entity';
import { Reseller } from 'src/resellers/entities/reseller.entity';
import { Banners } from 'src/shop/entities/banners.entity';
import { News } from 'src/news/entities/news.entity';
import { Journal } from 'src/journal/entities/journal.entity';
import { Doc } from 'src/docs/entities/doc.entity';
import { Attendance } from 'src/attendance/entities/attendance.entity';
import { Claim } from 'src/claims/entities/claim.entity';
import { Report } from 'src/reports/entities/report.entity';
import { Quotation } from 'src/shop/entities/quotation.entity';
import { Task } from 'src/tasks/entities/task.entity';
import { Notification } from 'src/notifications/entities/notification.entity';
import { Tracking } from 'src/tracking/entities/tracking.entity';
import { CommunicationLog } from 'src/communication/entities/communication-log.entity';
import { OrganisationSettings } from './organisation-settings.entity';
import { OrganisationAppearance } from './organisation-appearance.entity';
import { OrganisationHours } from './organisation-hours.entity';
import { Order } from 'src/shop/entities/order.entity';
import { Project } from 'src/shop/entities/project.entity';
import { Leave } from 'src/leave/entities/leave.entity';

@Entity('organisation')
@Index(['name']) // Organisation lookup
@Index(['email']) // Contact lookups
@Index(['phone']) // Contact lookups
@Index(['ref']) // Reference lookups
@Index(['status', 'isDeleted']) // Active organisation filtering
@Index(['createdAt']) // Date-based sorting
export class Organisation {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false, unique: true })
	name: string;

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
	email: string;

	@Column({ nullable: false, unique: true })
	phone: string;

	@Column({ nullable: false, unique: true })
	website: string;

	@Column({ nullable: false })
	logo: string;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;

	@Column({ nullable: false, default: GeneralStatus.ACTIVE })
	status: GeneralStatus;

	@Column({ nullable: false, default: false })
	isDeleted: boolean;

	@Column({ nullable: false, unique: true })
	ref: string;

	// Settings Relations
	@OneToOne(() => OrganisationSettings, (settings) => settings.organisation)
	settings: OrganisationSettings;

	@OneToOne(() => OrganisationAppearance, (appearance) => appearance.organisation)
	appearance: OrganisationAppearance;

	@OneToMany(() => OrganisationHours, (hours) => hours.organisation)
	hours: OrganisationHours[];

	// Other Relations
	@OneToMany(() => Branch, (branch) => branch?.organisation, { nullable: true })
	branches: Branch[];

	@OneToMany(() => Asset, (asset) => asset?.owner, { nullable: true })
	assets: Asset[];

	@OneToMany(() => Product, (product) => product?.organisation, { nullable: true })
	products: Product[];

	@OneToMany(() => Client, (client) => client?.organisation, { nullable: true })
	clients: Client[];

	@OneToMany(() => User, (user) => user?.organisation, { nullable: true })
	users: User[];

	@OneToMany(() => Reseller, (reseller) => reseller?.organisation, { nullable: true })
	resellers: Reseller[];

	@OneToMany(() => Banners, (banner) => banner?.organisation, { nullable: true })
	banners: Banners[];

	@OneToMany(() => News, (news) => news?.organisation, { nullable: true })
	news: News[];

	@OneToMany(() => Journal, (journal) => journal?.organisation, { nullable: true })
	journals: Journal[];

	@OneToMany(() => Doc, (doc) => doc?.organisation, { nullable: true })
	docs: Doc[];

	@OneToMany(() => Claim, (claim) => claim?.organisation, { nullable: true })
	claims: Claim[];

	@OneToMany(() => Attendance, (attendance) => attendance?.organisation, { nullable: true })
	attendances: Attendance[];

	@OneToMany(() => Report, (report) => report?.organisation, { nullable: true })
	reports: Report[];

	@OneToMany(() => Quotation, (quotation) => quotation?.organisation, { nullable: true })
	quotations: Quotation[];

	@OneToMany(() => Order, (order) => order?.organisation, { nullable: true })
	orders: Order[];

	@OneToMany(() => Task, (task) => task?.organisation, { nullable: true })
	tasks: Task[];

	@OneToMany(() => Notification, (notification) => notification?.organisation, { nullable: true })
	notifications: Notification[];

	@OneToMany(() => Tracking, (tracking) => tracking?.organisation, { nullable: true })
	trackings: Tracking[];

	@OneToMany(() => CommunicationLog, (communicationLog) => communicationLog?.organisation, { nullable: true })
	communicationLogs: CommunicationLog[];

	@OneToMany(() => Leave, (leave) => leave?.organisation, { nullable: true })
	leaves: Leave[];

	@OneToMany(() => Project, (project) => project?.organisation, { nullable: true })
	projects: Project[];
}
