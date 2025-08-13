import { GeneralStatus } from '../../lib/enums/status.enums';
import { Lead } from '../../leads/entities/lead.entity';
import { User } from '../../user/entities/user.entity';
import { Quotation } from '../../shop/entities/quotation.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Column, Entity, OneToMany, ManyToOne, PrimaryGeneratedColumn, OneToOne, Index } from 'typeorm';
import { CheckIn } from '../../check-ins/entities/check-in.entity';
import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from 'src/branch/entities/branch.entity';
import { Interaction } from 'src/interactions/entities/interaction.entity';
import {
	ClientType,
	ClientContactPreference,
	PriceTier,
	AcquisitionChannel,
	ClientRiskLevel,
	PaymentMethod,
	GeofenceType,
} from 'src/lib/enums/client.enums';
import { ClientAuth } from './client.auth.entity';
import { ClientCommunicationSchedule } from './client-communication-schedule.entity';
import { Project } from '../../shop/entities/project.entity';

@Entity('client')
@Index(['email']) // Unique customer lookups
@Index(['phone']) // Contact-based searches
@Index(['name']) // Name-based searches
@Index(['status', 'isDeleted']) // Active client filtering
@Index(['priceTier', 'status']) // Pricing tier management
@Index(['lastVisitDate']) // Visit scheduling
@Index(['nextContactDate']) // Contact scheduling
@Index(['acquisitionChannel', 'acquisitionDate']) // Marketing analysis
@Index(['industry', 'companySize']) // Market segmentation
@Index(['latitude', 'longitude', 'enableGeofence']) // Location-based queries
@Index(['createdAt']) // Date-based reporting
export class Client {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false, unique: true })
	name: string;

	@Column({ nullable: false })
	contactPerson: string;

	@Column({ nullable: false, default: 'contract' })
	category: string;

	@Column({ nullable: false, unique: true })
	email: string;

	@Column({ nullable: false, unique: true })
	phone: string;

	@Column({ nullable: true, unique: true })
	alternativePhone: string;

	@Column({ nullable: true, unique: true })
	website: string;

	@Column({ type: 'varchar', length: 255, nullable: true })
	landingPage: string;

	@Column({ nullable: true, unique: true })
	logo: string;

	@Column({ type: 'text', nullable: true })
	description: string;

	@Column({ type: 'json', nullable: false })
	address: {
		street: string;
		suburb: string;
		city: string;
		state: string;
		country: string;
		postalCode: string;
		googleMapsUrl?: string;
	};

	@Column({ type: 'varchar', nullable: true })
	gpsCoordinates: string;

	@Column({ type: 'timestamp', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamp', nullable: false, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;

	@Column({ nullable: false, default: GeneralStatus.ACTIVE })
	status: GeneralStatus;

	@Column({ default: false })
	isDeleted: boolean;

	// CRM Enhancement: Credit limit
	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, default: 0 })
	creditLimit: number;

	// CRM Enhancement: Current balance/outstanding amount
	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, default: 0 })
	outstandingBalance: number;

	// CRM Enhancement: Price tier - determines pricing structure for this client
	@Column({ type: 'enum', enum: PriceTier, default: PriceTier.STANDARD })
	priceTier: PriceTier;

	// CRM Enhancement: Preferred contact method
	@Column({ type: 'enum', enum: ClientContactPreference, default: ClientContactPreference.EMAIL })
	preferredContactMethod: ClientContactPreference;

	// CRM Enhancement: Last visit/interaction date
	@Column({ type: 'timestamp', nullable: true })
	lastVisitDate: Date;

	// CRM Enhancement: Next scheduled contact date
	@Column({ type: 'timestamp', nullable: true })
	nextContactDate: Date;

	// CRM Enhancement: Store/Product categories this client can access
	@Column({ type: 'json', nullable: true })
	visibleCategories: string[];

	// CRM Enhancement: Client tags for better categorization
	@Column({ type: 'json', nullable: true })
	tags: string[];

	// CRM Enhancement: Birthday for sending special offers
	@Column({ type: 'date', nullable: true })
	birthday: Date;

	// CRM Enhancement: Anniversary date (like client since date)
	@Column({ type: 'date', nullable: true })
	anniversaryDate: Date;

	// CRM Enhancement: Lifetime value
	@Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, default: 0 })
	lifetimeValue: number;

	// CRM Enhancement: Discount percentage (if client has a specific discount)
	@Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, default: 0 })
	discountPercentage: number;

	// CRM Enhancement: Payment terms (net 30, etc.)
	@Column({ nullable: true, default: 'Net 30' })
	paymentTerms: string;

	// CRM Enhancement: Acquisition channel - how the client was acquired
	@Column({ type: 'enum', enum: AcquisitionChannel, nullable: true })
	acquisitionChannel: AcquisitionChannel;

	// CRM Enhancement: Acquisition date - when the client was acquired
	@Column({ type: 'date', nullable: true })
	acquisitionDate: Date;

	// CRM Enhancement: Client risk level - for financial assessment
	@Column({ type: 'enum', enum: ClientRiskLevel, default: ClientRiskLevel.LOW })
	riskLevel: ClientRiskLevel;

	// CRM Enhancement: Preferred payment method
	@Column({ type: 'enum', enum: PaymentMethod, nullable: true })
	preferredPaymentMethod: PaymentMethod;

	// CRM Enhancement: Preferred language
	@Column({ nullable: true, default: 'English' })
	preferredLanguage: string;

	// CRM Enhancement: Industry
	@Column({ nullable: true })
	industry: string;

	// CRM Enhancement: Company size (number of employees)
	@Column({ type: 'integer', nullable: true })
	companySize: number;

	// CRM Enhancement: Annual revenue
	@Column({ type: 'decimal', precision: 16, scale: 2, nullable: true })
	annualRevenue: number;

	// CRM Enhancement: Customer satisfaction score (CSAT)
	@Column({ type: 'decimal', precision: 3, scale: 1, nullable: true })
	satisfactionScore: number;

	// CRM Enhancement: Net Promoter Score (NPS)
	@Column({ type: 'integer', nullable: true })
	npsScore: number;

	// CRM Enhancement: Custom fields for client-specific data
	@Column({ type: 'json', nullable: true })
	customFields: Record<string, any>;

	@Column({ type: 'simple-json', nullable: true })
	socialMedia: {
		linkedin?: string;
		twitter?: string;
		facebook?: string;
		instagram?: string;
		tiktok?: string;
		youtube?: string;
		snapchat?: string;
		reddit?: string;
		telegram?: string;
		discord?: string;
		twitch?: string;
		pinterest?: string;
		medium?: string;
		github?: string;
		stackoverflow?: string;
		gitlab?: string;
		bitbucket?: string;
		devto?: string;
	};
	// Relations
	@ManyToOne(() => User, (user) => user?.clients, { nullable: true })
	assignedSalesRep: User;

	@OneToMany(() => Lead, (lead) => lead?.client, { nullable: true })
	leads: Lead[];

	@OneToMany(() => Quotation, (quotation) => quotation?.client, { nullable: true })
	quotations: Quotation[];

	@OneToMany(() => Task, (task) => task?.clients, { nullable: true })
	tasks: Task[];

	@OneToMany(() => CheckIn, (checkIn) => checkIn?.client, { nullable: true })
	checkIns: CheckIn[];

	@Column({ type: 'enum', enum: ClientType, default: ClientType.STANDARD })
	type: ClientType;

	@ManyToOne(() => Organisation, (organisation) => organisation?.clients, { nullable: true })
	organisation: Organisation;

	@ManyToOne(() => Branch, (branch) => branch?.clients, { nullable: true })
	branch: Branch;

	@Column({ type: 'enum', enum: GeofenceType, default: GeofenceType.NONE })
	geofenceType: GeofenceType;

	@Column({ type: 'int', default: 500, nullable: true })
	geofenceRadius: number;

	@Column({ type: 'boolean', default: false })
	enableGeofence: boolean;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	latitude: number;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	longitude: number;

	@Column({ type: 'boolean', default: false })
	hasPortalAccess: boolean;

	@OneToOne(() => ClientAuth, (clientAuth) => clientAuth.client, { nullable: true })
	portalCredentials: ClientAuth;

	// Add the interactions relationship
	@OneToMany(() => Interaction, (interaction) => interaction.client)
	interactions: Interaction[];

	// Communication schedules relationship
	@OneToMany(() => ClientCommunicationSchedule, (schedule) => schedule.client)
	communicationSchedules: ClientCommunicationSchedule[];

	// Projects relationship
	@OneToMany(() => Project, (project) => project.client)
	projects: Project[];

	@Column({ type: 'varchar', nullable: true })
	LegalEntity: string;

	@Column({ type: 'varchar', nullable: true })
	TradingName: string;

	@Column({ type: 'varchar', nullable: true })
	MemberLevel: string;

	@Column({ type: 'varchar', nullable: true })
	MemberShips: string;

	@Column({ type: 'simple-json', nullable: true })
	owners: {
		fullName: string;
		email: string;
		phone: string;
	};

	@Column({ type: 'simple-json', nullable: true })
	managers: {
		fullName: string;
		email: string;
		phone: string;
	};

	@Column({ type: 'simple-json', nullable: true })
	purchaseManagers: {
		fullName: string;
		email: string;
		phone: string;
	};

	@Column({ type: 'simple-json', nullable: true })
	accountManagers: {
		fullName: string;
		email: string;
		phone: string;
	};

	@Column({ type: 'varchar', nullable: true })
	franchiseEmail: string;

	@Column({ type: 'varchar', nullable: true })
	franchisePhone: string;

	@Column({ type: 'varchar', nullable: true })
	franchiseHoneyPot: {
		firstName: string;
		username: string;
		email: string;
		phone: string;
		password: string;
		url: string;
		pvtFolderLinked: boolean;
		pvtFolderName?: string;
		pvtFolderPassword?: string;
		pvtFolderUsername?: string;
		pvtFolderUrl?: string;
		activity?: {
			lastLogin?: Date;
			lastActivity?: Date;
			lastActivityType?: string;
			lastActivityDetails?: string;
		};
	};

	@Column({ type: 'int', default: 0 })
	onlineVisibilityMKTG: number;

	@Column({ type: 'int', default: 0 })
	onlineVisibilitySEO: number;

	@Column({ type: 'int', default: 0 })
	onlineVisibilitySocial: number;

	@Column({ type: 'boolean', default: false })
	hasLoyaltyProgram: boolean;

	@Column({ type: 'boolean', default: false })
	hasRewardsProgram: boolean;

	@Column({ type: 'boolean', default: false })
	hasReferralProgram: boolean;
}
