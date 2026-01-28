#!/usr/bin/env node

/**
 * Populate Database with Clerk Organization Data
 * 
 * Populates data for Legend Systems Clerk organization. Creates:
 * - Organisation with Clerk org data
 * - Organisation settings with Africa/Johannesburg timezone and preferences
 * - Organisation hours with weekly schedule and timezone
 * - Organisation appearance with branding colors and logo
 * - 2 branches with Africa/Johannesburg settings
 * - Full enterprise license (ENTERPRISE plan) with all features for the organisation
 * 
 * Currently configured organization:
 * - Legend Systems (org_38PujX4XhPOGpJtT1608fjTK6H2)
 * 
 * Usage:
 *   npm run populate:clerk-org
 *   ts-node -r tsconfig-paths/register src/scripts/populate-clerk-org.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { License } from '../licensing/entities/license.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { OrganisationHours } from '../organisation/entities/organisation-hours.entity';
import { OrganisationAppearance } from '../organisation/entities/organisation-appearance.entity';
import { SubscriptionPlan, LicenseType, LicenseStatus, BillingCycle } from '../lib/enums/license.enums';
import { PLAN_FEATURES } from '../lib/constants/license-features';
import { GeneralStatus } from '../lib/enums/status.enums';
import { LicensingService } from '../licensing/licensing.service';
import * as crypto from 'crypto';

// Clerk Organization Data Array - Legend Systems only
const CLERK_ORG_DATA_ARRAY = [
	{
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
		updated_at: 1769416233096,
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
	private licensingService: LicensingService;
	private clerkOrgId: string;
	private clerkOrgData: typeof CLERK_ORG_DATA_ARRAY[0];

	constructor(dataSource: DataSource, licensingService: LicensingService, clerkOrgData: typeof CLERK_ORG_DATA_ARRAY[0]) {
		this.dataSource = dataSource;
		this.orgRepo = dataSource.getRepository(Organisation);
		this.branchRepo = dataSource.getRepository(Branch);
		this.licenseRepo = dataSource.getRepository(License);
		this.orgSettingsRepo = dataSource.getRepository(OrganisationSettings);
		this.orgHoursRepo = dataSource.getRepository(OrganisationHours);
		this.orgAppearanceRepo = dataSource.getRepository(OrganisationAppearance);
		this.licensingService = licensingService;
		this.clerkOrgData = clerkOrgData;
		this.clerkOrgId = clerkOrgData.id;
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

		// Delete licenses first (foreign key constraint)
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
	 * Create organisation settings with Africa/Johannesburg configuration
	 * Matches database format: socialLinks and performance are NULL, notifications doesn't include taskNotifications/feedbackTokenExpiryDays
	 */
	async createOrganisationSettings(organisation: Organisation): Promise<OrganisationSettings> {
		console.log('⚙️  Creating organisation settings...');

		const settings = this.orgSettingsRepo.create({
			organisationUid: organisation.uid,
			contact: {
				email: organisation.email,
				phone: {
					code: '+27',
					number: organisation.phone.replace('+27', '').trim(),
				},
				website: organisation.website,
				address: {
					street: JHB_ADDRESS.street,
					suburb: JHB_ADDRESS.suburb,
					city: JHB_ADDRESS.city,
					state: JHB_ADDRESS.state,
					country: JHB_ADDRESS.country,
					postalCode: JHB_ADDRESS.postalCode,
				},
			},
			regional: {
				language: 'en-US', // Match CSV format
				timezone: 'Africa/Johannesburg',
				currency: 'ZAR',
				dateFormat: 'DD/MM/YYYY',
				timeFormat: '24h',
			},
			branding: {
				logo: organisation.logo,
				logoAltText: organisation.name, // Match CSV format
				favicon: organisation.logo,
				primaryColor: '#059669', // Match CSV format from settings
				secondaryColor: '#6b7280', // Match CSV format
				accentColor: '#34d399', // Match CSV format
			},
			business: {
				name: organisation.name,
				registrationNumber: '', // Empty string, not null
				taxId: '', // Empty string, not null
				industry: 'technology', // Lowercase to match CSV
				size: 'medium', // Match CSV format
			},
			notifications: {
				email: true,
				sms: true,
				push: true,
				whatsapp: false,
				// Note: taskNotifications and feedbackTokenExpiryDays are separate fields, not in notifications JSON
			},
			preferences: {
				defaultView: 'grid', // Match CSV format
				itemsPerPage: 25,
				theme: 'light', // Match CSV format
				menuCollapsed: false,
			},
			geofenceDefaultRadius: 500,
			geofenceEnabledByDefault: false,
			geofenceDefaultNotificationType: 'NOTIFY',
			geofenceMaxRadius: 5000,
			geofenceMinRadius: 100,
			sendTaskNotifications: false, // Match CSV format
			feedbackTokenExpiryDays: 30,
			socialLinks: null, // NULL in database (CSV shows NULL)
			performance: null, // NULL in database (CSV shows NULL)
			isDeleted: false,
		});

		const savedSettings = await this.orgSettingsRepo.save(settings);
		console.log(`✅ Organisation settings created for: ${organisation.name}`);
		console.log(`   - Contact email: ${savedSettings.contact?.email}`);
		console.log(`   - Timezone: ${savedSettings.regional?.timezone}`);
		console.log(`   - Business size: ${savedSettings.business?.size}`);
		console.log(`   - Social links: ${savedSettings.socialLinks ? 'Set' : 'NULL'}`);
		console.log(`   - Performance: ${savedSettings.performance ? 'Set' : 'NULL'}`);

		return savedSettings;
	}

	/**
	 * Create organisation hours with weekly schedule and timezone
	 * Linked via Clerk org ID: ref uses Clerk org ID, foreign key uses organisationUid
	 */
	async createOrganisationHours(organisation: Organisation): Promise<OrganisationHours> {
		console.log('🕐 Creating organisation hours...');

		// Ref uses Clerk org ID for referencing (matches the linking requirement)
		const hoursRef = organisation.clerkOrgId || organisation.ref;

		// Parse openTime and closeTime as timestamptz matching CSV format
		// CSV shows: "1970-01-01 07:00:00+00" and "1970-01-01 16:30:00+00"
		// These are stored as timestamptz in the database
		const openTime = new Date('1970-01-01T07:00:00.000Z');
		const closeTime = new Date('1970-01-01T16:30:00.000Z');

		const hours = this.orgHoursRepo.create({
			ref: hoursRef, // Ref uses Clerk org ID
			organisationUid: organisation.uid, // Foreign key still uses numeric UID (required by DB schema)
			weeklySchedule: {
				monday: true,
				tuesday: true,
				wednesday: true,
				thursday: true,
				friday: true,
				saturday: false,
				sunday: false,
			},
			schedule: null, // NULL in database
			timezone: 'Africa/Johannesburg',
			holidayMode: false, // Boolean false, not string
			specialHours: null, // NULL in database
			openTime: openTime, // timestamptz
			closeTime: closeTime, // timestamptz
			holidayUntil: null, // NULL in database
			isDeleted: false,
		});

		const savedHours = await this.orgHoursRepo.save(hours);
		console.log(`✅ Organisation hours created for: ${organisation.name}`);
		console.log(`   - Ref: ${savedHours.ref} (Clerk Org ID: ${organisation.clerkOrgId})`);
		console.log(`   - Linked via organisationUid: ${savedHours.organisationUid}`);
		console.log(`   - Timezone: ${savedHours.timezone}`);
		console.log(`   - Open Time: ${savedHours.openTime?.toISOString()}`);
		console.log(`   - Close Time: ${savedHours.closeTime?.toISOString()}`);
		console.log(`   - Weekly Schedule: Mon-Fri enabled`);

		return savedHours;
	}

	/**
	 * Create organisation appearance with branding colors and logo
	 * Linked via Clerk org ID: ref uses Clerk org ID, foreign key uses organisationUid
	 */
	async createOrganisationAppearance(organisation: Organisation): Promise<OrganisationAppearance> {
		console.log('🎨 Creating organisation appearance...');

		// Ref uses Clerk org ID for referencing (matches the linking requirement)
		const appearanceRef = organisation.clerkOrgId || organisation.ref;

		// Match CSV format: logoUrl is NULL, logoAltText is the logo URL string
		const appearance = this.orgAppearanceRepo.create({
			ref: appearanceRef, // Ref uses Clerk org ID
			organisationUid: organisation.uid, // Foreign key still uses numeric UID (required by DB schema)
			primaryColor: '#7c2d92', // Default purple from CSV
			secondaryColor: '#4f46e5', // Default indigo from CSV
			accentColor: '#ec4899', // Default pink from CSV
			errorColor: '#ef4444', // Default red from CSV
			successColor: '#10b981', // Default green from CSV
			logoUrl: null, // NULL in database (CSV shows NULL)
			logoAltText: organisation.logo || '', // Logo URL string in logoAltText field (matches CSV format)
			isDeleted: false,
		});

		const savedAppearance = await this.orgAppearanceRepo.save(appearance);
		console.log(`✅ Organisation appearance created for: ${organisation.name}`);
		console.log(`   - Ref: ${savedAppearance.ref} (Clerk Org ID: ${organisation.clerkOrgId})`);
		console.log(`   - Linked via organisationUid: ${savedAppearance.organisationUid}`);
		console.log(`   - Primary Color: ${savedAppearance.primaryColor}`);
		console.log(`   - Secondary Color: ${savedAppearance.secondaryColor}`);
		console.log(`   - Accent Color: ${savedAppearance.accentColor}`);
		console.log(`   - Logo URL: ${savedAppearance.logoUrl || 'NULL'}`);
		console.log(`   - Logo Alt Text: ${savedAppearance.logoAltText ? 'Set' : 'Not set'}`);

		return savedAppearance;
	}

	/**
	 * Create branch
	 * Branch ref links to org ref (Clerk org ID)
	 */
	async createBranch(organisation: Organisation, branchNumber: number): Promise<Branch> {
		console.log(`🏢 Creating branch ${branchNumber}...`);

		// Generate branch ref that links to org ref
		const branchRef = `${organisation.ref}-BRN${branchNumber.toString().padStart(2, '0')}`;
		const branchName = `${organisation.name} - Branch ${branchNumber}`;
		const branchEmail = `branch${branchNumber}-${organisation.ref.toLowerCase()}@legendsystems.co.za`;
		// Generate unique phone number using slug's numeric part to ensure uniqueness across organizations
		// Extract numeric part from slug (e.g., "bit-drywall-1768713677" -> "1768713677")
		const slugNumericPart = this.clerkOrgData.slug.match(/\d+$/)?.[0] || this.clerkOrgId.substring(this.clerkOrgId.length - 4);
		// Use last 3 digits of numeric part + branch number to create unique phone
		const phoneSuffix = `${slugNumericPart.slice(-3)}${branchNumber}`.padStart(4, '0');
		const branchPhone = `+2712345${phoneSuffix}`;
		const branchWebsite = `https://branch${branchNumber}.${this.clerkOrgData.slug}.legendsystems.co.za`;

		const branch = this.branchRepo.create({
			name: branchName,
			ref: branchRef, // Links to org ref
			email: branchEmail,
			phone: branchPhone,
			website: branchWebsite,
			contactPerson: `Branch ${branchNumber} Manager`,
			address: {
				...JHB_ADDRESS,
				street: `${100 + branchNumber} Branch Street`,
				suburb: branchNumber === 1 ? 'Sandton' : 'Rosebank',
			},
			organisation: organisation, // Links to org via relation
			organisationUid: organisation.clerkOrgId || organisation.ref, // Set Clerk org ID
			status: GeneralStatus.ACTIVE,
			isDeleted: false,
			country: 'ZA',
		});

		const savedBranch = await this.branchRepo.save(branch);
		console.log(`✅ Branch created: ${savedBranch.name} (UID: ${savedBranch.uid}, Ref: ${savedBranch.ref})`);
		console.log(`   Linked to org ref: ${organisation.ref}`);

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

			// Step 3: Create organisation settings
			await this.createOrganisationSettings(organisation);

			// Step 4: Create organisation hours (linked via Clerk org ID in ref field)
			const orgHours = await this.createOrganisationHours(organisation);

			// Step 5: Create organisation appearance (linked via Clerk org ID in ref field)
			const orgAppearance = await this.createOrganisationAppearance(organisation);

			// Step 6: Create 2 branches (linked to org ref)
			const branch1 = await this.createBranch(organisation, 1);
			const branch2 = await this.createBranch(organisation, 2);

			// Step 7: Create enterprise license (with all features and columns filled)
			const license = await this.createLicense(organisation);

			// Step 8: Verify license can be retrieved using Clerk org ID
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
			console.log(`   - Organisation Settings: Created with Africa/Johannesburg timezone`);
			console.log(`     • Linked via organisationUid: ${organisation.uid}`);
			console.log(`   - Organisation Hours: Created with Mon-Fri schedule`);
			console.log(`     • Ref: ${orgHours.ref} (uses Clerk Org ID for referencing)`);
			console.log(`     • Linked via organisationUid: ${orgHours.organisationUid}`);
			console.log(`   - Organisation Appearance: Created with branding colors`);
			console.log(`     • Ref: ${orgAppearance.ref} (uses Clerk Org ID for referencing)`);
			console.log(`     • Linked via organisationUid: ${orgAppearance.organisationUid}`);
			console.log(`   - Branches: 2 created`);
			console.log(`     • ${branch1.name} (Ref: ${branch1.ref})`);
			console.log(`     • ${branch2.name} (Ref: ${branch2.ref})`);
			console.log(`   - License: Enterprise (ENTERPRISE plan) - All features enabled`);
			console.log(`     • License UID: ${license.uid}`);
			console.log(`     • Linked to Organisation Ref: ${license.organisationRef} (Clerk Org ID)`);
			console.log(`     • Features: ${Object.keys(license.features).length} enabled`);
			console.log(`     • Verified: Can be retrieved using Clerk org ID`);
			console.log(`   - Timezone: Africa/Johannesburg`);
			console.log(`   - Location: Johannesburg, South Africa`);
			console.log(`\n🔗 Linking Strategy:`);
			console.log(`   - All entities use Clerk Org ID (${organisation.clerkOrgId}) for referencing via 'ref' field`);
			console.log(`   - Foreign key relationships use numeric organisationUid (${organisation.uid}) for database integrity`);
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
		console.log(`📋 Processing ${CLERK_ORG_DATA_ARRAY.length} organization(s)...\n`);

		for (let i = 0; i < CLERK_ORG_DATA_ARRAY.length; i++) {
			const orgData = CLERK_ORG_DATA_ARRAY[i];
			console.log(`\n${'='.repeat(80)}`);
			console.log(`📋 Processing organization ${i + 1}/${CLERK_ORG_DATA_ARRAY.length}: ${orgData.name} (${orgData.id})`);
			console.log(`${'='.repeat(80)}\n`);

			try {
				const populator = new ClerkOrgPopulator(dataSource, licensingService, orgData);
				await populator.populate();
				successCount++;
				console.log(`\n✅ Successfully populated data for ${orgData.name}\n`);
			} catch (error) {
				failureCount++;
				const errorMessage = error instanceof Error ? error : new Error(String(error));
				errors.push({ org: orgData.name, error: errorMessage });
				console.error(`\n❌ Failed to populate data for ${orgData.name}:`, errorMessage.message);
				console.error(`   Continuing with remaining organizations...\n`);
			}
		}

		// Summary
		console.log(`\n${'='.repeat(80)}`);
		console.log('📊 Population Summary');
		console.log(`${'='.repeat(80)}`);
		console.log(`   Total organizations: ${CLERK_ORG_DATA_ARRAY.length}`);
		console.log(`   ✅ Successful: ${successCount}`);
		console.log(`   ❌ Failed: ${failureCount}`);

		if (errors.length > 0) {
			console.log(`\n❌ Errors encountered:`);
			errors.forEach(({ org, error }) => {
				console.log(`   - ${org}: ${error.message}`);
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
