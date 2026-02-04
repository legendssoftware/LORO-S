#!/usr/bin/env node

/**
 * Populate Database with Clerk Organization Data
 *
 * Creates only orgs, branches, and licenses for Bit Drywall and Legend Systems.
 * - Organisation (from Clerk JSON)
 * - One branch per configured branchNames (BitDenver for Bit Drywall, Denver for Legend Systems)
 * - One enterprise license per organisation
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
import { SubscriptionPlan, LicenseType, LicenseStatus, BillingCycle } from '../lib/enums/license.enums';
import { PLAN_FEATURES } from '../lib/constants/license-features';
import { GeneralStatus } from '../lib/enums/status.enums';
import { LicensingService } from '../licensing/licensing.service';
import * as crypto from 'crypto';

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

			// Step 3: Create one branch per configured branchNames (linked to org ref)
			if (this.branchNames.length === 0) {
				throw new Error('At least one branch name is required for the organisation');
			}
			const branches: Branch[] = [];
			for (let i = 0; i < this.branchNames.length; i++) {
				const branch = await this.createBranch(organisation, i + 1, this.branchNames[i]);
				branches.push(branch);
			}

			// Step 4: Create enterprise license (with all features and columns filled)
			const license = await this.createLicense(organisation);

			// Step 5: Verify license can be retrieved using Clerk org ID
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
			console.log(`   - Branches: ${branches.length} created`);
			branches.forEach((b) => {
				console.log(`     • ${b.name} (UID: ${b.uid}, Ref: ${b.ref}, organisationUid: ${b.organisationUid})`);
			});
			console.log(`   - License: Enterprise (ENTERPRISE plan) - All features enabled`);
			console.log(`     • License UID: ${license.uid}`);
			console.log(`     • Linked to Organisation Ref: ${license.organisationRef} (Clerk Org ID)`);
			console.log(`     • Features: ${Object.keys(license.features).length} enabled`);
			console.log(`     • Verified: Can be retrieved using Clerk org ID`);
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
