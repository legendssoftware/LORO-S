import { Organisation } from 'src/organisation/entities/organisation.entity';
import { User } from 'src/user/entities/user.entity';
import { Branch } from 'src/branch/entities/branch.entity';
import { CompetitorStatus, GeofenceType } from 'src/lib/enums/competitor.enums';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('competitor')
export class Competitor {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ type: 'varchar', length: 255 })
	@Index()
	name: string;

	@Column({ type: 'text', nullable: true })
	description: string;

	@Column({ type: 'varchar', length: 255, nullable: true })
	website: string;

	@Column({ type: 'varchar', length: 255, nullable: true })
	landingPage: string;

	@Column({ type: 'varchar', length: 255, nullable: true })
	contactEmail: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	contactPhone: string;

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

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	latitude: number;

	@Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
	longitude: number;

	@Column({ type: 'varchar', length: 255, nullable: true })
	logoUrl: string;

	@Column({ type: 'enum', enum: CompetitorStatus, default: CompetitorStatus.ACTIVE })
	@Index()
	status: CompetitorStatus;

	@Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
	marketSharePercentage: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
	estimatedAnnualRevenue: number;

	@Column({ type: 'varchar', length: 100, nullable: true })
	@Index()
	industry: string;

	@Column({ type: 'simple-array', nullable: true })
	keyProducts: string[];

	@Column({ type: 'simple-array', nullable: true })
	keyStrengths: string[];

	@Column({ type: 'simple-array', nullable: true })
	keyWeaknesses: string[];

	@Column({ type: 'int', nullable: true })
	estimatedEmployeeCount: number;

	@Column({ type: 'int', default: 0 })
	@Index()
	threatLevel: number;

	@Column({ type: 'int', default: 0 })
	competitiveAdvantage: number;

	@Column({ type: 'simple-json', nullable: true })
	pricingData: {
		lowEndPricing: number;
		midRangePricing: number;
		highEndPricing: number;
		pricingModel: string;
	};

	@Column({ type: 'text', nullable: true })
	businessStrategy: string;

	@Column({ type: 'text', nullable: true })
	marketingStrategy: string;

	@Column({ type: 'boolean', default: false })
	@Index()
	isDirect: boolean;

	@Column({ type: 'date', nullable: true })
	foundedDate: Date;

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

	@Column({ default: false })
	@Index()
	isDeleted: boolean;

	@Column({ nullable: true, unique: true })
	@Index()
	competitorRef: string;

	@Column({ type: 'enum', enum: GeofenceType, default: GeofenceType.NONE })
	geofenceType: GeofenceType;

	@Column({ type: 'int', default: 500, nullable: true })
	geofenceRadius: number;

	@Column({ type: 'boolean', default: false })
	enableGeofence: boolean;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	// Relations
	@ManyToOne(() => Organisation, { nullable: true })
	@Index()
	organisation: Organisation;

	@ManyToOne(() => Branch, { nullable: true })
	@Index()
	branch: Branch;

	@ManyToOne(() => User, { nullable: true })
	createdBy: User;

	//update fields
	@Column({ type: 'varchar', nullable: true })
	accountName: string;

	@Column({ type: 'varchar', nullable: true })
	BDM: string;

	@Column({ type: 'varchar', nullable: true })
	LegalEntity: string;

	@Column({ type: 'varchar', nullable: true })
	TradingName: string;

	@Column({ type: 'varchar', nullable: true })
	MemberLevel: string;

	@Column({ type: 'varchar', nullable: true })
	MemberShips: string;

	@Column({ type: 'varchar', nullable: true })
	brandStatus: string;

	@Column({ type: 'varchar', nullable: true })
	bank: string;

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
	companyRegNumber: string;

	@Column({ type: 'varchar', nullable: true })
	vatNumber: string;

	@Column({ type: 'varchar', nullable: true })
	CRO: string;

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
