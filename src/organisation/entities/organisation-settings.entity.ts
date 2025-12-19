import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Organisation } from './organisation.entity';

@Entity()
export class OrganisationSettings {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ type: 'json', nullable: true })
	contact: {
		email: string;
		phone: {
			code: string;
			number: string;
		};
		website: string;
		address: {
			street: string;
			suburb?: string;
			city: string;
			state: string;
			country: string;
			postalCode: string;
		};
	};

	@Column({ type: 'json', nullable: true })
	regional: {
		language: string;
		timezone: string;
		currency: string;
		dateFormat: string;
		timeFormat: string;
	};

	@Column({ type: 'json', nullable: true })
	branding: {
		logo: string;
		logoAltText: string;
		favicon: string;
		primaryColor: string;
		secondaryColor: string;
		accentColor: string;
	};

	@Column({ type: 'json', nullable: true })
	business: {
		name: string;
		registrationNumber: string;
		taxId: string;
		industry: string;
		size: 'small' | 'medium' | 'large' | 'enterprise';
	};

	@Column({ type: 'json', nullable: true })
	notifications: {
		email: boolean;
		sms: boolean;
		push: boolean;
		whatsapp: boolean;
	};

	@Column({ type: 'json', nullable: true })
	preferences: {
		defaultView: string;
		itemsPerPage: number;
		theme: 'light' | 'dark' | 'system';
		menuCollapsed: boolean;
	};

	@Column({ type: 'int', default: 500 })
	geofenceDefaultRadius: number;

	@Column({ type: 'boolean', default: false })
	geofenceEnabledByDefault: boolean;

	@Column({ type: 'varchar', length: 50, default: 'NOTIFY' })
	geofenceDefaultNotificationType: string;

	@Column({ type: 'int', default: 5000 })
	geofenceMaxRadius: number;

	@Column({ type: 'int', default: 100 })
	geofenceMinRadius: number;

	@Column({ default: false })
	isDeleted: boolean;

	@Column({ default: false })
	sendTaskNotifications: boolean;

	@Column({ default: 30 })
	feedbackTokenExpiryDays: number;

	@Column({ type: 'json', nullable: true })
	socialLinks: {
		facebook?: string;
		twitter?: string;
		instagram?: string;
		linkedin?: string;
		youtube?: string;
		website?: string;
		custom?: Array<{
			name: string;
			url: string;
			icon?: string;
		}>;
	};

	@Column({ type: 'json', nullable: true })
	performance: {
		dailyRevenueTarget?: number; // Daily revenue target in organization currency (default: 500000)
		weeklyRevenueTarget?: number; // Weekly revenue target
		monthlyRevenueTarget?: number; // Monthly revenue target
		yearlyRevenueTarget?: number; // Yearly revenue target
		targetCalculationMethod?: 'fixed' | 'dynamic' | 'historical'; // How targets are calculated
		historicalPeriodDays?: number; // Number of days to use for historical average (default: 30)
		growthTargetPercentage?: number; // Target growth percentage over historical average (default: 20)
	};

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;

	@OneToOne(() => Organisation, (organisation) => organisation.settings)
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column()
	organisationUid: number;
}
