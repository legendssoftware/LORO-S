#!/usr/bin/env node

/**
 * Populate Database with Clerk Organization Data
 *
 * Seeds two organisations (Bit Drywall, Legend Systems) with:
 * - Organisation (from Clerk JSON)
 * - Organisation settings, hours, and appearance
 * - One branch per org (BitDenver, Denver)
 * - One enterprise license per org
 * - 5 clients per org (varied types, tiers, channels)
 * - 10 products per org (varied categories, statuses, brands)
 *
 * Configured organizations:
 * - Bit Drywall (org_38PulS5p5hmhjH14SW4YGi8JlFM) → branch BitDenver
 * - Legend Systems (org_38PujX4XhPOGpJtT1608fjTK6H2) → branch Denver
 *
 * Usage:
 *   npm run populate:clerk-org
 *   ts-node -r tsconfig-paths/register src/scripts/populate-clerk-org.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource, Repository } from 'typeorm';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { License } from '../licensing/entities/license.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { OrganisationHours } from '../organisation/entities/organisation-hours.entity';
import { OrganisationAppearance } from '../organisation/entities/organisation-appearance.entity';
import { Client } from '../clients/entities/client.entity';
import { Product } from '../products/entities/product.entity';
import { CheckIn } from '../check-ins/entities/check-in.entity';
import { Quotation } from '../shop/entities/quotation.entity';
import { QuotationItem } from '../shop/entities/quotation-item.entity';
import { Project } from '../shop/entities/project.entity';
import { User } from '../user/entities/user.entity';
import { SubscriptionPlan, LicenseType, LicenseStatus, BillingCycle } from '../lib/enums/license.enums';
import { PLAN_FEATURES } from '../lib/constants/license-features';
import { GeneralStatus } from '../lib/enums/status.enums';
import {
	ClientType,
	PriceTier,
	ClientContactPreference,
	AcquisitionChannel,
	ClientRiskLevel,
	PaymentMethod,
} from '../lib/enums/client.enums';
import { ProductStatus } from '../lib/enums/product.enums';
import { OrderStatus } from '../lib/enums/status.enums';
import { DocumentType } from '../lib/enums/document.enums';
import { ProjectType, ProjectStatus, ProjectPriority } from '../lib/enums/project.enums';
import { LicensingService } from '../licensing/licensing.service';
import * as crypto from 'crypto';

const CLIENT_SEED_COUNT = 5;
const PRODUCT_SEED_COUNT = 10;

/** Default product image URL for cards/display */
const PRODUCT_IMAGE_URL = 'https://cdn-icons-png.flaticon.com/512/7603/7603321.png';

/** Clerk organization payload shape (from Clerk API / provided JSON) */
interface ClerkOrgPayload {
	object: string;
	id: string;
	name: string;
	slug: string;
	image_url: string;
	has_image: boolean;
	members_count: number;
	max_allowed_memberships: number;
	admin_delete_enabled: boolean;
	role_set_key: string;
	public_metadata: Record<string, unknown>;
	private_metadata: Record<string, unknown>;
	created_by: string;
	created_at: number;
	updated_at: number;
}

/** Seed item: Clerk org JSON + branch names to create for that org */
export interface ClerkOrgSeedItem {
	clerkOrg: ClerkOrgPayload;
	branchNames: string[];
}

/** Two orgs linked to Clerk, each with one branch (BitDenver, Denver) */
const CLERK_ORG_SEED_ARRAY: ClerkOrgSeedItem[] = [
	{
		clerkOrg: {
			object: 'organization',
			id: 'org_38PulS5p5hmhjH14SW4YGi8JlFM',
			name: 'Bit Drywall',
			slug: 'bit-drywall-1768713677',
			image_url: 'https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCIsImlpZCI6Imluc18zOE5ldnlrdmlwclJtQUNsT1VKazlGa3RCRm0iLCJyaWQiOiJvcmdfMzhQdWxTNXA1aG1oakgxNFNXNFlHaThKbEZNIiwiaW5pdGlhbHMiOiJCIn0',
			has_image: false,
			members_count: 87,
			max_allowed_memberships: 500,
			admin_delete_enabled: true,
			role_set_key: 'role_set:default',
			public_metadata: {},
			private_metadata: {},
			created_by: '',
			created_at: 1768713677356,
			updated_at: 1769422781164,
		},
		branchNames: ['BitDenver'],
	},
	{
		clerkOrg: {
			object: 'organization',
			id: 'org_38PujX4XhPOGpJtT1608fjTK6H2',
			name: 'Legend Systems',
			slug: 'legend-systems-1768713662',
			image_url: 'https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCIsImlpZCI6Imluc18zOE5ldnlrdmlwclJtQUNsT1VKazlGa3RCRm0iLCJyaWQiOiJvcmdfMzhQdWpYNFhoUE9HcEp0VDE2MDhmalRLNkgyIiwiaW5pdGlhbHMiOiJMIn0',
			has_image: false,
			members_count: 9,
			max_allowed_memberships: 500,
			admin_delete_enabled: true,
			role_set_key: 'role_set:default',
			public_metadata: {},
			private_metadata: {},
			created_by: '',
			created_at: 1768713662419,
			updated_at: 1769751138513,
		},
		branchNames: ['Denver'],
	},
];

// Johannesburg, South Africa address details
const JHB_ADDRESS = {
	street: '123 Main Street',
	suburb: 'Sandton',
	city: 'Johannesburg',
	state: 'Gauteng',
	country: 'South Africa',
	postalCode: '2196',
};

class ClerkOrgPopulator {
	private dataSource: DataSource;
	private orgRepo: Repository<Organisation>;
	private branchRepo: Repository<Branch>;
	private licenseRepo: Repository<License>;
	private orgSettingsRepo: Repository<OrganisationSettings>;
	private orgHoursRepo: Repository<OrganisationHours>;
	private orgAppearanceRepo: Repository<OrganisationAppearance>;
	private clientRepo: Repository<Client>;
	private productRepo: Repository<Product>;
	private checkInRepo: Repository<CheckIn>;
	private quotationRepo: Repository<Quotation>;
	private quotationItemRepo: Repository<QuotationItem>;
	private projectRepo: Repository<Project>;
	private userRepo: Repository<User>;
	private licensingService: LicensingService;
	private clerkOrgId: string;
	private clerkOrgData: ClerkOrgPayload;
	private branchNames: string[];

	constructor(
		dataSource: DataSource,
		licensingService: LicensingService,
		seedItem: ClerkOrgSeedItem
	) {
		this.dataSource = dataSource;
		this.orgRepo = dataSource.getRepository(Organisation);
		this.branchRepo = dataSource.getRepository(Branch);
		this.licenseRepo = dataSource.getRepository(License);
		this.orgSettingsRepo = dataSource.getRepository(OrganisationSettings);
		this.orgHoursRepo = dataSource.getRepository(OrganisationHours);
		this.orgAppearanceRepo = dataSource.getRepository(OrganisationAppearance);
		this.clientRepo = dataSource.getRepository(Client);
		this.productRepo = dataSource.getRepository(Product);
		this.checkInRepo = dataSource.getRepository(CheckIn);
		this.quotationRepo = dataSource.getRepository(Quotation);
		this.quotationItemRepo = dataSource.getRepository(QuotationItem);
		this.projectRepo = dataSource.getRepository(Project);
		this.userRepo = dataSource.getRepository(User);
		this.licensingService = licensingService;
		this.clerkOrgData = seedItem.clerkOrg;
		this.clerkOrgId = seedItem.clerkOrg.id;
		this.branchNames = seedItem.branchNames;
	}

	/**
	 * Truncate/clear existing data for this Clerk org
	 */
	async truncateExistingData(): Promise<void> {
		console.log('🗑️  Clearing existing data...');

		// Find organisation by clerkOrgId
		const existingOrg = await this.orgRepo.findOne({
			where: { clerkOrgId: this.clerkOrgId },
		});

		if (!existingOrg) {
			console.log('   No existing organisation found, proceeding with creation...');
			return;
		}

		console.log(`   Found existing organisation: ${existingOrg.name} (UID: ${existingOrg.uid})`);

		// Delete quotations and projects (FK to client/org) before clients
		const quotRepo = this.dataSource.getRepository(Quotation);
		const projRepo = this.dataSource.getRepository(Project);
		const delQuot = await quotRepo.delete({ organisationUid: existingOrg.uid });
		const delProj = await projRepo.delete({ organisationUid: existingOrg.uid });
		console.log(`   Deleted ${delQuot.affected || 0} quotation(s), ${delProj.affected || 0} project(s)`);

		// Delete clients (FK to org and branch) - client.organisationUid is Clerk org ID string
		const clerkOrgId = existingOrg.clerkOrgId ?? existingOrg.ref;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const deletedClients = await this.clientRepo.delete({ organisationUid: clerkOrgId } as any);
		console.log(`   Deleted ${deletedClients.affected || 0} client(s)`);

		// Delete products (FK to org and branch)
		const deletedProducts = await this.productRepo.delete({
			organisationUid: existingOrg.uid,
		});
		console.log(`   Deleted ${deletedProducts.affected || 0} product(s)`);

		// Delete check-ins (FK to org via clerkOrgId)
		const deletedCheckIns = await this.checkInRepo.delete({
			organisationUid: existingOrg.clerkOrgId,
		});
		console.log(`   Deleted ${deletedCheckIns.affected || 0} check-in(s)`);

		// Delete licenses (foreign key constraint)
		const deletedLicenses = await this.licenseRepo.delete({
			organisationRef: existingOrg.ref,
		});
		console.log(`   Deleted ${deletedLicenses.affected || 0} license(s)`);

		// Delete branches - use organisationUid (Clerk org ID string) not numeric uid
		const deletedBranches = await this.branchRepo.delete({
			organisationUid: existingOrg.clerkOrgId,
		});
		console.log(`   Deleted ${deletedBranches.affected || 0} branch(es)`);

		// Delete organisation settings - uses numeric organisationUid
		const deletedSettings = await this.orgSettingsRepo.delete({
			organisationUid: existingOrg.uid,
		});
		console.log(`   Deleted ${deletedSettings.affected || 0} organisation setting(s)`);

		// Delete organisation hours - foreign key uses numeric organisationUid, but ref uses Clerk org ID
		const deletedHours = await this.orgHoursRepo.delete({
			organisationUid: existingOrg.uid,
		});
		console.log(`   Deleted ${deletedHours.affected || 0} organisation hour(s)`);

		// Delete organisation appearance - foreign key uses numeric organisationUid, but ref uses Clerk org ID
		const deletedAppearance = await this.orgAppearanceRepo.delete({
			organisationUid: existingOrg.uid,
		});
		console.log(`   Deleted ${deletedAppearance.affected || 0} organisation appearance(s)`);

		// Delete organisation
		await this.orgRepo.delete({
			uid: existingOrg.uid,
		});
		console.log(`   Deleted organisation`);

		console.log('✅ Existing data cleared\n');
	}

	/**
	 * Generate unique license key
	 */
	private generateLicenseKey(): string {
		return crypto.randomBytes(16).toString('hex').toUpperCase();
	}

	/**
	 * Create organisation with Clerk data
	 * Uses Clerk org ID as the ref for consistency
	 */
	async createOrganisation(): Promise<Organisation> {
		console.log('📦 Creating organisation...');
		console.log(`   Expected Clerk Org ID: ${this.clerkOrgId}`);

		// Use Clerk org ID as the ref
		const orgRef = this.clerkOrgId;
		// Use slug for email to ensure uniqueness (slug is guaranteed unique by Clerk)
		const orgEmail = `${this.clerkOrgData.slug}@legendsystems.co.za`;
		// Generate unique phone number using last 4 digits of org ID timestamp (from slug)
		// Extract numeric part from slug (e.g., "bit-drywall-1768713677" -> "1768713677" -> last 4: "3677")
		const slugNumericPart = this.clerkOrgData.slug.match(/\d+$/)?.[0] || this.clerkOrgId.substring(this.clerkOrgId.length - 4);
		const phoneSuffix = slugNumericPart.slice(-4).padStart(4, '0');
		const orgPhone = `+2712345${phoneSuffix}`;
		const orgWebsite = `https://${this.clerkOrgData.slug}.legendsystems.co.za`;

		const organisation = this.orgRepo.create({
			name: this.clerkOrgData.name,
			ref: orgRef, // Use Clerk org ID as ref
			clerkOrgId: this.clerkOrgId,
			email: orgEmail,
			phone: orgPhone,
			website: orgWebsite,
			logo: this.clerkOrgData.image_url || 'https://cdn-icons-png.flaticon.com/128/1144/1144709.png',
			address: JHB_ADDRESS,
			status: GeneralStatus.ACTIVE,
			isDeleted: false,
		});

		const savedOrg = await this.orgRepo.save(organisation);
		
		// Verify the organisation has the correct Clerk org ID
		if (savedOrg.clerkOrgId !== this.clerkOrgId) {
			throw new Error(
				`❌ Organisation Clerk Org ID mismatch! Expected: ${this.clerkOrgId}, Got: ${savedOrg.clerkOrgId}`
			);
		}

		if (savedOrg.ref !== this.clerkOrgId) {
			throw new Error(
				`❌ Organisation ref mismatch! Expected: ${this.clerkOrgId}, Got: ${savedOrg.ref}`
			);
		}

		console.log(`✅ Organisation created: ${savedOrg.name}`);
		console.log(`   - Internal UID: ${savedOrg.uid}`);
		console.log(`   - Ref: ${savedOrg.ref}`);
		console.log(`   - Clerk Org ID: ${savedOrg.clerkOrgId}`);
		console.log(`   ✓ Verification: Clerk Org ID matches expected value`);

		return savedOrg;
	}

	/**
	 * Create organisation settings (contact, regional, branding, business, notifications, preferences).
	 */
	async createOrganisationSettings(organisation: Organisation): Promise<OrganisationSettings> {
		console.log('⚙️  Creating organisation settings...');
		const settings = this.orgSettingsRepo.create({
			organisationUid: organisation.uid,
			contact: {
				email: organisation.email,
				phone: { code: '+27', number: organisation.phone.replace(/\D/g, '').slice(-9) },
				website: organisation.website,
				address: { ...organisation.address },
			},
			regional: {
				language: 'en',
				timezone: 'Africa/Johannesburg',
				currency: 'ZAR',
				dateFormat: 'YYYY-MM-DD',
				timeFormat: '24h',
			},
			branding: {
				logo: organisation.logo,
				logoAltText: `${organisation.name} logo`,
				favicon: organisation.logo,
				primaryColor: '#2563eb',
				secondaryColor: '#1e40af',
				accentColor: '#3b82f6',
			},
			business: {
				name: organisation.name,
				registrationNumber: '',
				taxId: '',
				industry: 'Construction',
				size: 'medium',
			},
			notifications: { email: true, sms: true, push: true, whatsapp: false },
			preferences: { defaultView: 'dashboard', itemsPerPage: 20, theme: 'system', menuCollapsed: false },
			geofenceDefaultRadius: 500,
			geofenceEnabledByDefault: false,
			sendTaskNotifications: true,
			feedbackTokenExpiryDays: 30,
		});
		const saved = await this.orgSettingsRepo.save(settings);
		console.log(`✅ Organisation settings created (UID: ${saved.uid})`);
		return saved;
	}

	/**
	 * Create organisation hours (weekly schedule, timezone).
	 */
	async createOrganisationHours(organisation: Organisation): Promise<OrganisationHours> {
		console.log('🕐 Creating organisation hours...');
		const ref = `${organisation.ref}-HOURS`;
		const hours = this.orgHoursRepo.create({
			ref,
			organisationUid: organisation.uid,
			weeklySchedule: {
				monday: true,
				tuesday: true,
				wednesday: true,
				thursday: true,
				friday: true,
				saturday: false,
				sunday: false,
			},
			schedule: {
				monday: { start: '08:00', end: '17:00', closed: false },
				tuesday: { start: '08:00', end: '17:00', closed: false },
				wednesday: { start: '08:00', end: '17:00', closed: false },
				thursday: { start: '08:00', end: '17:00', closed: false },
				friday: { start: '08:00', end: '17:00', closed: false },
				saturday: { start: '09:00', end: '13:00', closed: true },
				sunday: { start: '09:00', end: '13:00', closed: true },
			},
			timezone: 'Africa/Johannesburg',
			holidayMode: false,
			isDeleted: false,
		});
		const saved = await this.orgHoursRepo.save(hours);
		console.log(`✅ Organisation hours created (UID: ${saved.uid}, ref: ${saved.ref})`);
		return saved;
	}

	/**
	 * Create organisation appearance (colors, logo).
	 */
	async createOrganisationAppearance(organisation: Organisation): Promise<OrganisationAppearance> {
		console.log('🎨 Creating organisation appearance...');
		const ref = `${organisation.ref}-APPEARANCE`;
		const appearance = this.orgAppearanceRepo.create({
			ref,
			organisationUid: organisation.uid,
			primaryColor: '#2563eb',
			secondaryColor: '#1e40af',
			accentColor: '#3b82f6',
			errorColor: '#dc2626',
			successColor: '#16a34a',
			logoUrl: organisation.logo,
			logoAltText: `${organisation.name} logo`,
			isDeleted: false,
		});
		const saved = await this.orgAppearanceRepo.save(appearance);
		console.log(`✅ Organisation appearance created (UID: ${saved.uid}, ref: ${saved.ref})`);
		return saved;
	}

	/**
	 * Create branch. Branch ref links to org ref (Clerk org ID).
	 * @param branchName - When provided, used as branch name; otherwise "${organisation.name} - Branch ${branchNumber}"
	 */
	async createBranch(organisation: Organisation, branchNumber: number, branchName?: string): Promise<Branch> {
		const displayName = branchName ?? `${organisation.name} - Branch ${branchNumber}`;
		console.log(`🏢 Creating branch ${branchNumber}${branchName ? ` (${branchName})` : ''}...`);

		// Generate branch ref that links to org ref
		const branchRef = `${organisation.ref}-BRN${branchNumber.toString().padStart(2, '0')}`;
		const branchEmail = `branch${branchNumber}-${organisation.ref.toLowerCase()}@legendsystems.co.za`;
		// Generate unique phone number using slug's numeric part to ensure uniqueness across organizations
		const slugNumericPart = this.clerkOrgData.slug.match(/\d+$/)?.[0] || this.clerkOrgId.substring(this.clerkOrgId.length - 4);
		const phoneSuffix = `${slugNumericPart.slice(-3)}${branchNumber}`.padStart(4, '0');
		const branchPhone = `+2712345${phoneSuffix}`;
		const branchWebsite = `https://branch${branchNumber}.${this.clerkOrgData.slug}.legendsystems.co.za`;

		const branch = this.branchRepo.create({
			name: displayName,
			ref: branchRef,
			email: branchEmail,
			phone: branchPhone,
			website: branchWebsite,
			contactPerson: branchName ? `${branchName} Manager` : `Branch ${branchNumber} Manager`,
			address: {
				...JHB_ADDRESS,
				street: `${100 + branchNumber} Branch Street`,
				suburb: branchNumber === 1 ? 'Sandton' : 'Rosebank',
			},
			organisation: organisation,
			organisationUid: organisation.clerkOrgId || organisation.ref,
			status: GeneralStatus.ACTIVE,
			isDeleted: false,
			country: 'ZA',
		});

		const savedBranch = await this.branchRepo.save(branch);
		console.log(`✅ Branch created: ${savedBranch.name} (UID: ${savedBranch.uid}, Ref: ${savedBranch.ref})`);
		console.log(`   Linked to org ref: ${organisation.ref}, organisationUid: ${savedBranch.organisationUid}`);

		return savedBranch;
	}

	/**
	 * Create enterprise license (ENTERPRISE plan) with all features and columns filled
	 */
	async createLicense(organisation: Organisation): Promise<License> {
		console.log('🎫 Creating enterprise license with all features...');

		// Verify organisation has correct Clerk org ID before creating license
		if (organisation.clerkOrgId !== this.clerkOrgId) {
			throw new Error(
				`❌ Cannot create license: Organisation Clerk Org ID mismatch! Expected: ${this.clerkOrgId}, Got: ${organisation.clerkOrgId}`
			);
		}

		console.log(`   - Organisation UID (for foreign key): ${organisation.uid}`);
		console.log(`   - Organisation Clerk Org ID: ${organisation.clerkOrgId}`);
		console.log(`   - Organisation Ref: ${organisation.ref}`);

		// Get enterprise features - ensure all features are included
		const planDefaults = PLAN_FEATURES[SubscriptionPlan.ENTERPRISE];
		if (!planDefaults || Object.keys(planDefaults).length === 0) {
			throw new Error('❌ Enterprise plan features not found!');
		}

		// Verify enterprise-only features are included
		const enterpriseOnlyFeatures = [
			'approvals.access',
			'assets.access',
			'claims.access',
			'clients.access',
			'communication.access',
			'docs.access',
			'journal.access',
			'leads.access',
			'licensing.access',
			'news.access',
			'notifications.access',
			'organisation.access',
			'products.access',
			'reports.access',
			'resellers.access',
			'rewards.access',
			'shop.access',
			'tasks.access',
			'tracking.access',
			'users.access',
			'warnings.access',
			'payslips.access',
		];

		const missingFeatures = enterpriseOnlyFeatures.filter(feature => !planDefaults[feature]);
		if (missingFeatures.length > 0) {
			console.warn(`⚠️  Warning: Missing enterprise-only features: ${missingFeatures.join(', ')}`);
		} else {
			console.log(`   ✓ All ${enterpriseOnlyFeatures.length} enterprise-only access features are enabled`);
		}

		console.log(`   - Total features enabled: ${Object.keys(planDefaults).length}`);

		// Enterprise tier: maximum limits (effectively unlimited)
		const licenseConfig = {
			maxUsers: 10000, // Enterprise: very high limit
			maxBranches: 1000, // Enterprise: very high limit
			storageLimit: 1048576, // 1TB in MB (1024GB)
			apiCallLimit: 10000000, // 10M API calls per month
			integrationLimit: 100, // Enterprise: high integration limit
			price: 999, // Enterprise pricing
		};

		// Set validUntil to 1 year from now for annual subscription
		const now = new Date();
		const validUntil = new Date(now);
		validUntil.setFullYear(validUntil.getFullYear() + 1);

		const license = this.licenseRepo.create({
			licenseKey: this.generateLicenseKey(),
			type: LicenseType.SUBSCRIPTION,
			plan: SubscriptionPlan.ENTERPRISE,
			status: LicenseStatus.ACTIVE,
			billingCycle: BillingCycle.ANNUAL,
			validUntil: validUntil, // Set to 1 year from now
			lastValidated: now, // Set to current date
			maxUsers: licenseConfig.maxUsers,
			maxBranches: licenseConfig.maxBranches,
			storageLimit: licenseConfig.storageLimit,
			apiCallLimit: licenseConfig.apiCallLimit,
			integrationLimit: licenseConfig.integrationLimit,
			features: planDefaults, // All enterprise features enabled
			price: licenseConfig.price,
			organisationRef: organisation.ref, // Links to org ref (Clerk org ID) - must be string
			hasPendingPayments: false,
		});

		const savedLicense = await this.licenseRepo.save(license);
		
		// Verify the license was created with correct organisationRef
		if (savedLicense.organisationRef !== organisation.ref) {
			throw new Error(
				`❌ License organisationRef mismatch! Expected: ${organisation.ref}, Got: ${savedLicense.organisationRef}`
			);
		}

		console.log(`✅ Enterprise license created: ${savedLicense.licenseKey} (Plan: ${savedLicense.plan})`);
		console.log(`   - License UID: ${savedLicense.uid}`);
		console.log(`   - Max Users: ${savedLicense.maxUsers.toLocaleString()}`);
		console.log(`   - Max Branches: ${savedLicense.maxBranches.toLocaleString()}`);
		console.log(`   - Storage Limit: ${savedLicense.storageLimit.toLocaleString()} MB (${(savedLicense.storageLimit / 1024).toFixed(0)}GB)`);
		console.log(`   - API Call Limit: ${savedLicense.apiCallLimit.toLocaleString()}`);
		console.log(`   - Integration Limit: ${savedLicense.integrationLimit}`);
		console.log(`   - Features: ${Object.keys(savedLicense.features).length} enabled (includes all enterprise-only features)`);
		console.log(`   - Valid Until: ${savedLicense.validUntil?.toISOString()}`);
		console.log(`   - Last Validated: ${savedLicense.lastValidated?.toISOString()}`);
		console.log(`   - Organisation Ref: ${savedLicense.organisationRef}`);
		console.log(`   ✓ Verification: License linked to organisation ref ${organisation.ref} (Clerk Org ID: ${organisation.clerkOrgId})`);

		return savedLicense;
	}

	/** Client seed template (varied type, tier, channel, etc.) */
	private static readonly CLIENT_SEED_TEMPLATES: Array<{
		nameSuffix: string;
		contactPerson: string;
		type: ClientType;
		priceTier: PriceTier;
		acquisitionChannel: AcquisitionChannel;
		contactPreference: ClientContactPreference;
		riskLevel: ClientRiskLevel;
		paymentMethod: PaymentMethod;
	}> = [
		{ nameSuffix: 'Contractor Co', contactPerson: 'Jan Smith', type: ClientType.CONTRACT, priceTier: PriceTier.STANDARD, acquisitionChannel: AcquisitionChannel.REFERRAL, contactPreference: ClientContactPreference.EMAIL, riskLevel: ClientRiskLevel.LOW, paymentMethod: PaymentMethod.BANK_TRANSFER },
		{ nameSuffix: 'Wholesale Build', contactPerson: 'Sarah Jones', type: ClientType.WHOLESALE, priceTier: PriceTier.WHOLESALE, acquisitionChannel: AcquisitionChannel.DIRECT, contactPreference: ClientContactPreference.PHONE, riskLevel: ClientRiskLevel.LOW, paymentMethod: PaymentMethod.INVOICE },
		{ nameSuffix: 'Retail Outlet', contactPerson: 'Mike Brown', type: ClientType.RETAIL, priceTier: PriceTier.PREMIUM, acquisitionChannel: AcquisitionChannel.SOCIAL_MEDIA, contactPreference: ClientContactPreference.WHATSAPP, riskLevel: ClientRiskLevel.MEDIUM, paymentMethod: PaymentMethod.CREDIT_CARD },
		{ nameSuffix: 'Enterprise Ltd', contactPerson: 'Lisa Wilson', type: ClientType.ENTERPRISE, priceTier: PriceTier.ENTERPRISE, acquisitionChannel: AcquisitionChannel.TRADE_SHOW, contactPreference: ClientContactPreference.VIDEO_CALL, riskLevel: ClientRiskLevel.LOW, paymentMethod: PaymentMethod.BANK_TRANSFER },
		{ nameSuffix: 'Standard Trade', contactPerson: 'Tom Davis', type: ClientType.STANDARD, priceTier: PriceTier.DISCOUNT, acquisitionChannel: AcquisitionChannel.EMAIL_CAMPAIGN, contactPreference: ClientContactPreference.IN_PERSON, riskLevel: ClientRiskLevel.HIGH, paymentMethod: PaymentMethod.MOBILE_PAYMENT },
	];

	/**
	 * Create 5 clients per org (varied types, tiers, channels); unique name/email/phone per org.
	 */
	async createClients(organisation: Organisation, branch: Branch): Promise<Client[]> {
		console.log(`👥 Creating ${CLIENT_SEED_COUNT} clients...`);
		const slug = this.clerkOrgData.slug;
		const slugNum = this.clerkOrgData.slug.match(/\d+$/)?.[0]?.slice(-4) ?? '0000';
		const clients: Client[] = [];
		for (let i = 0; i < CLIENT_SEED_COUNT; i++) {
			const t = ClerkOrgPopulator.CLIENT_SEED_TEMPLATES[i];
			const name = `Seed ${t.nameSuffix} (${organisation.name})`;
			const email = `client-${i + 1}-${slug}@seed.legendsystems.co.za`;
			const phone = `+27 11 2${slugNum.slice(-2)} ${String(i + 1).padStart(2, '0')}${slugNum.slice(-2)}`;
			const creditLimit = [100000, 50000, 200000, 75000, 150000][i];
			const outstandingBalance = [0, 10000, 50000, 25000, 12000][i];
			// organisationUid is Clerk org ID string (client entity links by clerkOrgId)
			const client = this.clientRepo.create({
				name,
				contactPerson: t.contactPerson,
				email,
				phone,
				category: 'contract',
				address: { ...JHB_ADDRESS, street: `${200 + i} Client Street` },
				organisationUid: (organisation.clerkOrgId ?? organisation.ref) as any,
				branchUid: branch.uid,
				status: GeneralStatus.ACTIVE,
				isDeleted: false,
				type: t.type,
				priceTier: t.priceTier,
				preferredContactMethod: t.contactPreference,
				acquisitionChannel: t.acquisitionChannel,
				riskLevel: t.riskLevel,
				preferredPaymentMethod: t.paymentMethod,
				paymentTerms: 'Net 30',
				creditLimit,
				outstandingBalance,
			});
			clients.push(await this.clientRepo.save(client));
		}
		console.log(`✅ Created ${clients.length} clients`);
		return clients;
	}

	/** Product seed template with rich fields: price cuts, discounts, promo, stock variance */
	private static readonly PRODUCT_SEED_TEMPLATES: Array<{
		name: string;
		category: string;
		status: ProductStatus;
		brand: string;
		packageUnit: string;
		price: number;
		description: string;
		salePrice?: number;
		discount?: number;
		isOnPromotion: boolean;
		stockQuantity: number;
		warehouseLocation: string;
		packageDetails: string;
		manufacturer: string;
		dimensions: string;
		material: string;
		origin: string;
		rating: number;
		reviewCount: number;
		warrantyPeriod: number;
		specifications: string;
		features: string;
		isFragile: boolean;
		minimumOrderQuantity: number;
		bulkDiscountPercentage?: number;
		bulkDiscountMinQty?: number;
		palletAvailable: boolean;
		packPrice?: number;
		palletPrice?: number;
		palletSalePrice?: number;
		palletDiscount?: number;
		palletOnPromotion: boolean;
		itemsPerPack: number;
		packsPerPallet: number;
		reorderPoint: number;
		palletStockQuantity: number;
	}> = [
		{
			name: 'Drywall Board 12mm',
			category: 'CONSTRUCTION',
			status: ProductStatus.ACTIVE,
			brand: 'BuildPro',
			packageUnit: 'sheet',
			price: 245,
			description: 'Standard 12mm drywall board. Fire-resistant, easy to cut and install.',
			salePrice: 219,
			discount: 10.61,
			isOnPromotion: true,
			stockQuantity: 340,
			warehouseLocation: 'A-01-02',
			packageDetails: '10 sheets per bundle',
			manufacturer: 'BuildPro Industries',
			dimensions: '2400x1200x12mm',
			material: 'Gypsum',
			origin: 'South Africa',
			rating: 4.6,
			reviewCount: 128,
			warrantyPeriod: 12,
			specifications: 'Density 650kg/m³, Moisture resistant',
			features: 'Fire-rated, Low VOC',
			isFragile: true,
			minimumOrderQuantity: 5,
			bulkDiscountPercentage: 5,
			bulkDiscountMinQty: 50,
			palletAvailable: true,
			packPrice: 2190,
			palletPrice: 10950,
			palletSalePrice: 9855,
			palletDiscount: 10,
			palletOnPromotion: true,
			itemsPerPack: 10,
			packsPerPallet: 5,
			reorderPoint: 50,
			palletStockQuantity: 12,
		},
		{
			name: 'Joint Compound 5L',
			category: 'CONSTRUCTION',
			status: ProductStatus.BEST_SELLER,
			brand: 'SmoothCoat',
			packageUnit: 'bucket',
			price: 189,
			description: 'All-purpose joint compound for taping and finishing.',
			salePrice: 169,
			discount: 10.58,
			isOnPromotion: true,
			stockQuantity: 88,
			warehouseLocation: 'B-02-01',
			packageDetails: '5L plastic bucket',
			manufacturer: 'SmoothCoat Ltd',
			dimensions: '280mm dia x 320mm',
			material: 'Gypsum compound',
			origin: 'South Africa',
			rating: 4.8,
			reviewCount: 256,
			warrantyPeriod: 24,
			specifications: 'Coverage ~15m² per 5L',
			features: 'Low dust, Easy sanding',
			isFragile: false,
			minimumOrderQuantity: 1,
			bulkDiscountPercentage: 8,
			bulkDiscountMinQty: 20,
			palletAvailable: true,
			packPrice: 1690,
			palletPrice: 6760,
			palletSalePrice: undefined,
			palletDiscount: undefined,
			palletOnPromotion: false,
			itemsPerPack: 10,
			packsPerPallet: 4,
			reorderPoint: 15,
			palletStockQuantity: 3,
		},
		{
			name: 'Metal Stud 92mm',
			category: 'METAL_PRODUCTS',
			status: ProductStatus.ACTIVE,
			brand: 'SteelFrame',
			packageUnit: 'unit',
			price: 85,
			description: '92mm galvanised metal stud for partition systems.',
			salePrice: undefined,
			discount: undefined,
			isOnPromotion: false,
			stockQuantity: 1200,
			warehouseLocation: 'C-01-05',
			packageDetails: 'Single 3m length',
			manufacturer: 'SteelFrame SA',
			dimensions: '3000x92x50mm',
			material: 'Galvanised steel',
			origin: 'South Africa',
			rating: 4.5,
			reviewCount: 89,
			warrantyPeriod: 60,
			specifications: '0.6mm gauge, 50mm flange',
			features: 'Lightweight, Corrosion resistant',
			isFragile: false,
			minimumOrderQuantity: 10,
			bulkDiscountPercentage: 12,
			bulkDiscountMinQty: 100,
			palletAvailable: true,
			packPrice: 850,
			palletPrice: 7650,
			palletSalePrice: 6885,
			palletDiscount: 10,
			palletOnPromotion: true,
			itemsPerPack: 10,
			packsPerPallet: 9,
			reorderPoint: 200,
			palletStockQuantity: 25,
		},
		{
			name: 'Screw Pack 200',
			category: 'HARDWARE',
			status: ProductStatus.NEW,
			brand: 'FixIt',
			packageUnit: 'box',
			price: 120,
			description: '200 drywall screws, Phillips head, 32mm.',
			salePrice: 99,
			discount: 17.5,
			isOnPromotion: true,
			stockQuantity: 450,
			warehouseLocation: 'D-03-02',
			packageDetails: '200 screws per box',
			manufacturer: 'FixIt Hardware',
			dimensions: 'Box 120x80x40mm',
			material: 'Steel, zinc plated',
			origin: 'China',
			rating: 4.4,
			reviewCount: 312,
			warrantyPeriod: 12,
			specifications: '32mm length, 3.5mm head',
			features: 'Self-drilling, Anti-corrosion',
			isFragile: false,
			minimumOrderQuantity: 1,
			bulkDiscountPercentage: 15,
			bulkDiscountMinQty: 50,
			palletAvailable: false,
			packPrice: undefined,
			palletPrice: undefined,
			palletSalePrice: undefined,
			palletDiscount: undefined,
			palletOnPromotion: false,
			itemsPerPack: 1,
			packsPerPallet: 1,
			reorderPoint: 80,
			palletStockQuantity: 0,
		},
		{
			name: 'Tape Roll 90m',
			category: 'CONSTRUCTION',
			status: ProductStatus.ACTIVE,
			brand: 'SmoothCoat',
			packageUnit: 'roll',
			price: 65,
			description: 'Paper joint tape 90m for drywall seams.',
			salePrice: 55,
			discount: 15.38,
			isOnPromotion: true,
			stockQuantity: 220,
			warehouseLocation: 'B-02-03',
			packageDetails: '90m per roll, 50mm width',
			manufacturer: 'SmoothCoat Ltd',
			dimensions: '90m x 50mm',
			material: 'Paper',
			origin: 'South Africa',
			rating: 4.7,
			reviewCount: 167,
			warrantyPeriod: 0,
			specifications: '50mm width, Reinforced',
			features: 'Easy tear, Crease-resistant',
			isFragile: false,
			minimumOrderQuantity: 5,
			bulkDiscountPercentage: 10,
			bulkDiscountMinQty: 30,
			palletAvailable: false,
			packPrice: undefined,
			palletPrice: undefined,
			palletSalePrice: undefined,
			palletDiscount: undefined,
			palletOnPromotion: false,
			itemsPerPack: 1,
			packsPerPallet: 1,
			reorderPoint: 40,
			palletStockQuantity: 0,
		},
		{
			name: 'Primer 10L',
			category: 'PAINT_SUPPLIES',
			status: ProductStatus.HOTDEALS,
			brand: 'PrimePlus',
			packageUnit: 'drum',
			price: 420,
			description: 'Interior primer 10L, low odour, fast dry.',
			salePrice: 336,
			discount: 20,
			isOnPromotion: true,
			stockQuantity: 42,
			warehouseLocation: 'E-01-01',
			packageDetails: '10L plastic drum',
			manufacturer: 'PrimePlus Paints',
			dimensions: '320mm dia x 380mm',
			material: 'Acrylic',
			origin: 'South Africa',
			rating: 4.9,
			reviewCount: 98,
			warrantyPeriod: 36,
			specifications: 'Coverage ~80m² per 10L',
			features: 'Low VOC, Mold resistant',
			isFragile: false,
			minimumOrderQuantity: 1,
			bulkDiscountPercentage: 5,
			bulkDiscountMinQty: 10,
			palletAvailable: true,
			packPrice: 3360,
			palletPrice: 15120,
			palletSalePrice: 13608,
			palletDiscount: 10,
			palletOnPromotion: true,
			itemsPerPack: 10,
			packsPerPallet: 4,
			reorderPoint: 10,
			palletStockQuantity: 2,
		},
		{
			name: 'Insulation Batts',
			category: 'INSULATION',
			status: ProductStatus.SPECIAL,
			brand: 'ThermoSave',
			packageUnit: 'pack',
			price: 380,
			description: 'Ceiling insulation batts, R3.5, 430mm width.',
			salePrice: 342,
			discount: 10,
			isOnPromotion: true,
			stockQuantity: 18,
			warehouseLocation: 'F-02-02',
			packageDetails: '6 batts per pack, 1.2m² coverage',
			manufacturer: 'ThermoSave Insulation',
			dimensions: '1200x430x135mm per batt',
			material: 'Glass wool',
			origin: 'South Africa',
			rating: 4.6,
			reviewCount: 74,
			warrantyPeriod: 120,
			specifications: 'R-value 3.5, Non-combustible',
			features: 'Easy fit, Sound dampening',
			isFragile: false,
			minimumOrderQuantity: 2,
			bulkDiscountPercentage: 12,
			bulkDiscountMinQty: 20,
			palletAvailable: true,
			packPrice: 3420,
			palletPrice: 13680,
			palletSalePrice: 12312,
			palletDiscount: 10,
			palletOnPromotion: true,
			itemsPerPack: 10,
			packsPerPallet: 4,
			reorderPoint: 5,
			palletStockQuantity: 1,
		},
		{
			name: 'Angle Bead 3m',
			category: 'METAL_PRODUCTS',
			status: ProductStatus.ACTIVE,
			brand: 'SteelFrame',
			packageUnit: 'length',
			price: 45,
			description: '3m angle bead for external corners.',
			salePrice: undefined,
			discount: undefined,
			isOnPromotion: false,
			stockQuantity: 560,
			warehouseLocation: 'C-01-08',
			packageDetails: 'Single 3m length',
			manufacturer: 'SteelFrame SA',
			dimensions: '3000x25x25mm',
			material: 'Galvanised steel',
			origin: 'South Africa',
			rating: 4.3,
			reviewCount: 201,
			warrantyPeriod: 24,
			specifications: '0.4mm gauge',
			features: 'Straight edge, Rust resistant',
			isFragile: false,
			minimumOrderQuantity: 5,
			bulkDiscountPercentage: 8,
			bulkDiscountMinQty: 50,
			palletAvailable: false,
			packPrice: undefined,
			palletPrice: undefined,
			palletSalePrice: undefined,
			palletDiscount: undefined,
			palletOnPromotion: false,
			itemsPerPack: 1,
			packsPerPallet: 1,
			reorderPoint: 100,
			palletStockQuantity: 0,
		},
		{
			name: 'Dust Mask 50pk',
			category: 'SAFETY',
			status: ProductStatus.ACTIVE,
			brand: 'SafeWork',
			packageUnit: 'box',
			price: 95,
			description: 'Disposable dust masks, FFP2, 50 per box.',
			salePrice: 76,
			discount: 20,
			isOnPromotion: true,
			stockQuantity: 72,
			warehouseLocation: 'G-01-01',
			packageDetails: '50 masks per box',
			manufacturer: 'SafeWork PPE',
			dimensions: '300x200x150mm',
			material: 'Non-woven polypropylene',
			origin: 'South Africa',
			rating: 4.5,
			reviewCount: 445,
			warrantyPeriod: 0,
			specifications: 'FFP2, EN 149:2001',
			features: 'Comfortable, Adjustable nose clip',
			isFragile: false,
			minimumOrderQuantity: 1,
			bulkDiscountPercentage: 15,
			bulkDiscountMinQty: 20,
			palletAvailable: false,
			packPrice: undefined,
			palletPrice: undefined,
			palletSalePrice: undefined,
			palletDiscount: undefined,
			palletOnPromotion: false,
			itemsPerPack: 1,
			packsPerPallet: 1,
			reorderPoint: 20,
			palletStockQuantity: 0,
		},
		{
			name: 'Adhesive 5kg',
			category: 'ADHESIVES',
			status: ProductStatus.OUTOFSTOCK,
			brand: 'StickFast',
			packageUnit: 'tub',
			price: 165,
			description: 'Construction adhesive 5kg, multi-purpose.',
			salePrice: undefined,
			discount: undefined,
			isOnPromotion: false,
			stockQuantity: 0,
			warehouseLocation: 'H-02-01',
			packageDetails: '5kg tub with nozzle',
			manufacturer: 'StickFast Adhesives',
			dimensions: '200mm dia x 280mm',
			material: 'Synthetic polymer',
			origin: 'South Africa',
			rating: 4.4,
			reviewCount: 133,
			warrantyPeriod: 12,
			specifications: 'Gap fill up to 12mm',
			features: 'Water resistant, Fast grab',
			isFragile: false,
			minimumOrderQuantity: 1,
			bulkDiscountPercentage: undefined,
			bulkDiscountMinQty: undefined,
			palletAvailable: false,
			packPrice: undefined,
			palletPrice: undefined,
			palletSalePrice: undefined,
			palletDiscount: undefined,
			palletOnPromotion: false,
			itemsPerPack: 1,
			packsPerPallet: 1,
			reorderPoint: 15,
			palletStockQuantity: 0,
		},
	];

	/**
	 * Create 10 products per org with rich data: image, price cuts, discounts, promos, varied stock.
	 */
	async createProducts(organisation: Organisation, branch: Branch): Promise<Product[]> {
		console.log(`📦 Creating ${PRODUCT_SEED_COUNT} products...`);
		const now = new Date();
		const promoEnd = new Date(now);
		promoEnd.setDate(promoEnd.getDate() + 30);
		const products: Product[] = [];
		for (let i = 0; i < PRODUCT_SEED_COUNT; i++) {
			const t = ClerkOrgPopulator.PRODUCT_SEED_TEMPLATES[i];
			const productRef = `${organisation.ref}-PRD-${String(i + 1).padStart(2, '0')}`;
			const sku = `${t.category.slice(0, 3).toUpperCase()}-${organisation.ref.slice(-6)}-${String(i + 1).padStart(2, '0')}`;
			const barcode = `8${organisation.uid.toString().padStart(5, '0')}${(i + 1).toString().padStart(4, '0')}`;
			const palletSku = t.palletAvailable ? `${sku}-PLT` : undefined;
			const palletBarcode = t.palletAvailable ? `9${organisation.uid.toString().padStart(5, '0')}${(i + 1).toString().padStart(4, '0')}` : undefined;
			const unitWeight = t.price < 100 ? 0.5 : t.price < 300 ? 2.5 : 8;
			const product = this.productRepo.create({
				name: t.name,
				description: t.description,
				category: t.category,
				status: t.status,
				price: t.price,
				salePrice: t.salePrice,
				discount: t.discount,
				imageUrl: PRODUCT_IMAGE_URL,
				productRef,
				productReferenceCode: `${t.brand}-${sku}`,
				sku,
				barcode,
				brand: t.brand,
				packageUnit: t.packageUnit,
				packageQuantity: 1,
				weight: unitWeight,
				stockQuantity: t.stockQuantity,
				reorderPoint: t.reorderPoint,
				warehouseLocation: t.warehouseLocation,
				packageDetails: t.packageDetails,
				isOnPromotion: t.isOnPromotion,
				promotionStartDate: t.isOnPromotion ? now : undefined,
				promotionEndDate: t.isOnPromotion ? promoEnd : undefined,
				itemsPerPack: t.itemsPerPack,
				packsPerPallet: t.packsPerPallet,
				packPrice: t.packPrice,
				palletPrice: t.palletPrice,
				packWeight: t.itemsPerPack > 1 ? unitWeight * t.itemsPerPack : undefined,
				palletWeight: t.palletAvailable && t.packsPerPallet > 0 ? unitWeight * t.itemsPerPack * t.packsPerPallet : undefined,
				palletAvailable: t.palletAvailable,
				palletStockQuantity: t.palletStockQuantity,
				palletReorderPoint: t.palletAvailable ? 2 : 1,
				palletDiscount: t.palletDiscount,
				palletSku,
				palletBarcode,
				palletSalePrice: t.palletSalePrice,
				palletOnPromotion: t.palletOnPromotion,
				palletPromotionStartDate: t.palletOnPromotion ? now : undefined,
				palletPromotionEndDate: t.palletOnPromotion ? promoEnd : undefined,
				palletImageUrl: t.palletAvailable ? PRODUCT_IMAGE_URL : undefined,
				palletDescription: t.palletAvailable ? `Pallet of ${t.itemsPerPack * t.packsPerPallet} ${t.packageUnit}(s)` : undefined,
				minimumPalletOrderQuantity: t.palletAvailable ? 1 : undefined,
				palletBulkDiscountPercentage: t.palletAvailable ? 5 : undefined,
				palletBulkDiscountMinQty: t.palletAvailable ? 5 : undefined,
				dimensions: t.dimensions,
				packDimensions: t.dimensions ? `Pack: ${t.dimensions}` : undefined,
				palletDimensions: t.palletAvailable && t.dimensions ? `Pallet: 1200x1000mm` : undefined,
				manufacturer: t.manufacturer,
				material: t.material,
				origin: t.origin,
				rating: t.rating,
				reviewCount: t.reviewCount,
				warrantyPeriod: t.warrantyPeriod,
				warrantyUnit: 'months',
				specifications: t.specifications,
				features: t.features,
				isFragile: t.isFragile,
				requiresSpecialHandling: t.isFragile,
				storageConditions: t.category === 'PAINT_SUPPLIES' ? 'Cool, dry place' : undefined,
				minimumOrderQuantity: t.minimumOrderQuantity,
				bulkDiscountPercentage: t.bulkDiscountPercentage,
				bulkDiscountMinQty: t.bulkDiscountMinQty,
				organisationUid: organisation.uid,
				branchUid: branch.uid,
				isDeleted: false,
			});
			products.push(await this.productRepo.save(product));
		}
		console.log(`✅ Created ${products.length} products`);
		return products;
	}

	/** Create 1–2 past quotations per client with items from products. */
	async createQuotations(
		organisation: Organisation,
		branch: Branch,
		clients: Client[],
		products: Product[],
	): Promise<Quotation[]> {
		const created: Quotation[] = [];
		const slug = this.clerkOrgData.slug;
		const statuses: OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.PENDING_CLIENT, OrderStatus.APPROVED];
		let qNum = 1;
		for (const client of clients) {
			const numQuot = 2;
			for (let q = 0; q < numQuot; q++) {
				const prod = products[q % products.length];
				const qty = 1 + (qNum % 3);
				const unitPrice = Number(prod.salePrice ?? prod.price ?? 100);
				const totalPrice = unitPrice * qty;
				const quotationNumber = `Q-${slug}-${Date.now().toString(36)}-${qNum}`;
				const quot = this.quotationRepo.create({
					quotationNumber,
					totalAmount: totalPrice,
					totalItems: qty,
					status: statuses[qNum % statuses.length],
					documentType: DocumentType.QUOTATION,
					quotationDate: new Date(Date.now() - (qNum * 7 + 1) * 86400000),
					client,
					branchUid: branch.uid,
					organisationUid: organisation.uid,
					branch,
					organisation,
					currency: 'ZAR',
				});
				const saved = await this.quotationRepo.save(quot);
				const item = this.quotationItemRepo.create({
					quantity: qty,
					unitPrice,
					totalPrice,
					product: prod,
					quotation: saved,
				});
				await this.quotationItemRepo.save(item);
				created.push(saved);
				qNum++;
			}
		}
		console.log(`✅ Created ${created.length} quotations`);
		return created;
	}

	/** Create one project per client; skip if no user in org to assign. */
	async createProjects(
		organisation: Organisation,
		branch: Branch,
		clients: Client[],
	): Promise<Project[]> {
		const orgUser = await this.userRepo.findOne({
			where: { organisationRef: organisation.clerkOrgId ?? organisation.ref, isDeleted: false },
		});
		if (!orgUser?.clerkUserId) {
			console.log(`   ⏭ Skipping projects (no user in org to assign)`);
			return [];
		}
		const created: Project[] = [];
		for (let i = 0; i < clients.length; i++) {
			const client = clients[i];
			const proj = this.projectRepo.create({
				name: `Seed project ${i + 1} – ${client.name}`,
				description: `Seeded project for ${client.contactPerson}`,
				type: ProjectType.RENOVATION,
				status: ProjectStatus.PLANNING,
				priority: ProjectPriority.MEDIUM,
				budget: 50000,
				currentSpent: 0,
				contactPerson: client.contactPerson,
				contactEmail: client.email,
				contactPhone: client.phone,
				startDate: new Date(),
				currency: 'ZAR',
				clientUid: client.uid,
				client,
				assignedUserClerkUserId: orgUser.clerkUserId,
				assignedUser: orgUser,
				organisationUid: organisation.uid,
				organisation,
				branchUid: branch.uid,
				branch,
			});
			created.push(await this.projectRepo.save(proj));
		}
		console.log(`✅ Created ${created.length} projects`);
		return created;
	}

	/**
	 * Run the complete population process
	 */
	async populate(): Promise<void> {
		console.log('🚀 Starting Clerk Organisation Population Script...\n');
		console.log(`📋 Clerk Org ID: ${this.clerkOrgId}\n`);

		try {
			// Step 1: Truncate existing data
			await this.truncateExistingData();

			// Step 2: Create organisation (uses Clerk org ID as ref)
			const organisation = await this.createOrganisation();

			// Step 3: Create organisation settings, hours, and appearance
			await this.createOrganisationSettings(organisation);
			await this.createOrganisationHours(organisation);
			await this.createOrganisationAppearance(organisation);

			// Step 4: Create one branch per configured branchNames (linked to org ref)
			if (this.branchNames.length === 0) {
				throw new Error('At least one branch name is required for the organisation');
			}
			const branches: Branch[] = [];
			for (let i = 0; i < this.branchNames.length; i++) {
				const branch = await this.createBranch(organisation, i + 1, this.branchNames[i]);
				branches.push(branch);
			}

			// Step 5: Create enterprise license (with all features and columns filled)
			const license = await this.createLicense(organisation);

			// Step 6: Create clients and products (5 clients, 10 products per org)
			const primaryBranch = branches[0];
			const clients = await this.createClients(organisation, primaryBranch);
			const products = await this.createProducts(organisation, primaryBranch);

			// Step 6b: Past quotations (linked to clients + products) and one project per client
			const quotations = await this.createQuotations(organisation, primaryBranch, clients, products);
			const projects = await this.createProjects(organisation, primaryBranch, clients);

			// Step 7: Verify license can be retrieved using Clerk org ID
			console.log('\n🔍 Verifying license retrieval using Clerk org ID...');
			const retrievedLicenses = await this.licensingService.findByOrganisation(this.clerkOrgId);
			
			if (!retrievedLicenses || retrievedLicenses.length === 0) {
				throw new Error(
					`❌ License verification failed! Could not retrieve license using Clerk org ID: ${this.clerkOrgId}`
				);
			}

			const foundLicense = retrievedLicenses.find(l => l.uid === license.uid);
			if (!foundLicense) {
				throw new Error(
					`❌ License verification failed! Created license (UID: ${license.uid}) not found when querying by Clerk org ID: ${this.clerkOrgId}`
				);
			}

			console.log(`✅ License verification successful!`);
			console.log(`   - Found ${retrievedLicenses.length} license(s) for organisation`);
			console.log(`   - License UID: ${foundLicense.uid}`);
			console.log(`   - License Plan: ${foundLicense.plan}`);
			console.log(`   - License Status: ${foundLicense.status}`);
			console.log(`   - Organisation Ref: ${foundLicense.organisationRef}`);
			console.log(`   ✓ Verification: License can be retrieved using Clerk org ID: ${this.clerkOrgId}`);

			console.log('\n✅ Population completed successfully!');
			console.log('\n📊 Summary:');
			console.log(`   - Organisation: ${organisation.name} (UID: ${organisation.uid})`);
			console.log(`   - Organisation Ref: ${organisation.ref} (Clerk Org ID)`);
			console.log(`   - Clerk Org ID: ${organisation.clerkOrgId}`);
			console.log(`   - Organisation settings, hours, and appearance: created`);
			console.log(`   - Branches: ${branches.length} created`);
			branches.forEach((b) => {
				console.log(`     • ${b.name} (UID: ${b.uid}, Ref: ${b.ref}, organisationUid: ${b.organisationUid})`);
			});
			console.log(`   - License: Enterprise (ENTERPRISE plan) - All features enabled`);
			console.log(`     • License UID: ${license.uid}`);
			console.log(`     • Linked to Organisation Ref: ${license.organisationRef} (Clerk Org ID)`);
			console.log(`     • Features: ${Object.keys(license.features).length} enabled`);
			console.log(`     • Verified: Can be retrieved using Clerk org ID`);
			console.log(`   - Clients: ${clients.length} created`);
			clients.forEach((c) => console.log(`     • ${c.name} (${c.email})`));
			console.log(`   - Products: ${products.length} created`);
			products.forEach((p) => console.log(`     • ${p.name} [${p.category}] (${p.productRef})`));
			if (quotations.length) console.log(`   - Quotations: ${quotations.length} created`);
			if (projects.length) console.log(`   - Projects: ${projects.length} created`);
		} catch (error) {
			console.error('\n❌ Error during population:', error);
			throw error;
		}
	}
}

async function main() {
	console.log('🔧 Initializing NestJS application...\n');

	const app = await NestFactory.createApplicationContext(AppModule);
	const dataSource = app.get(DataSource);
	const licensingService = app.get(LicensingService);

	let successCount = 0;
	let failureCount = 0;
	const errors: Array<{ org: string; error: Error }> = [];

	try {
		console.log(`📋 Processing ${CLERK_ORG_SEED_ARRAY.length} organization(s)...\n`);

		for (let i = 0; i < CLERK_ORG_SEED_ARRAY.length; i++) {
			const seedItem = CLERK_ORG_SEED_ARRAY[i];
			const { clerkOrg } = seedItem;
			console.log(`\n${'='.repeat(80)}`);
			console.log(`📋 Processing organization ${i + 1}/${CLERK_ORG_SEED_ARRAY.length}: ${clerkOrg.name} (${clerkOrg.id})`);
			console.log(`${'='.repeat(80)}\n`);

			try {
				const populator = new ClerkOrgPopulator(dataSource, licensingService, seedItem);
				await populator.populate();
				successCount++;
				console.log(`\n✅ Successfully populated data for ${clerkOrg.name}\n`);
			} catch (error) {
				failureCount++;
				const errorMessage = error instanceof Error ? error : new Error(String(error));
				errors.push({ org: clerkOrg.name, error: errorMessage });
				console.error(`\n❌ Failed to populate data for ${clerkOrg.name}:`, errorMessage.message);
				console.error(`   Continuing with remaining organizations...\n`);
			}
		}

		// Summary
		console.log(`\n${'='.repeat(80)}`);
		console.log('📊 Population Summary');
		console.log(`${'='.repeat(80)}`);
		console.log(`   Total organizations: ${CLERK_ORG_SEED_ARRAY.length}`);
		console.log(`   ✅ Successful: ${successCount}`);
		console.log(`   ❌ Failed: ${failureCount}`);

		if (errors.length > 0) {
			console.log(`\n❌ Errors encountered:`);
			errors.forEach(({ org, error }) => {
				console.log(`   - ${org}: ${(error as Error).message}`);
			});
		}

		if (failureCount > 0) {
			console.log(`\n⚠️  Some organizations failed to populate. Check errors above.`);
			process.exit(1);
		} else {
			console.log(`\n✅ All organizations populated successfully!`);
		}
	} catch (error) {
		console.error('❌ Script failed:', error);
		process.exit(1);
	} finally {
		try {
			// Close the application context gracefully
			await Promise.race([
				app.close(),
				new Promise((resolve) => setTimeout(resolve, 5000)), // 5 second timeout
			]);
		} catch (closeError) {
			// Ignore shutdown errors - they're often related to DataSource cleanup
			console.log('\n👋 Application closed.');
		}
	}
}

// Run the script
if (require.main === module) {
	main().catch((error) => {
		console.error('Fatal error:', error);
		process.exit(1);
	});
}

export { ClerkOrgPopulator };
