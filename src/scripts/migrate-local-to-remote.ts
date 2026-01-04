#!/usr/bin/env node

/**
 * Local to Remote PostgreSQL Migration Script
 * Migrates: orgs, org settings/appearance/hours, branches, devices, users, licenses
 * 
 * Usage:
 *   npm run migrate:local-to-remote -- --dry-run
 *   npm run migrate:local-to-remote -- --pg-url postgresql://user:pass@host:port/dbname
 *   npm run migrate:local-to-remote -- --only orgs,branches,users,devices,licenses
 */

import * as yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { UserProfile } from '../user/entities/user.profile.entity';
import { UserEmployeementProfile } from '../user/entities/user.employeement.profile.entity';
import { UserTarget } from '../user/entities/user-target.entity';
import { Device } from '../iot/entities/iot.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { OrganisationAppearance } from '../organisation/entities/organisation-appearance.entity';
import { OrganisationHours } from '../organisation/entities/organisation-hours.entity';
import { License } from '../licensing/entities/license.entity';

interface ScriptArguments {
	'pg-url'?: string;
	'dry-run'?: boolean;
	only?: string;
	verbose?: boolean;
}

interface UidMapping {
	[oldUid: number]: number;
}

interface IdMapping {
	[oldId: number]: number;
}

class MigrationStats {
	organisations = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	branches = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	users = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	userProfiles = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	userEmploymentProfiles = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	userTargets = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	devices = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	licenses = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	orgSettings = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	orgAppearance = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
	orgHours = { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0, created: 0 };
}

class LocalToRemoteMigrator {
	private pgSourceDataSource: DataSource | null = null;
	private pgTargetDataSource: DataSource | null = null;
	private app: any = null;
	private originalDataSource: DataSource | null = null;
	
	// Repositories
	private orgRepo: Repository<Organisation> | null = null;
	private branchRepo: Repository<Branch> | null = null;
	private userRepo: Repository<User> | null = null;
	private userProfileRepo: Repository<UserProfile> | null = null;
	private userEmploymentRepo: Repository<UserEmployeementProfile> | null = null;
	private userTargetRepo: Repository<UserTarget> | null = null;
	private deviceRepo: Repository<Device> | null = null;
	private licenseRepo: Repository<License> | null = null;
	private orgSettingsRepo: Repository<OrganisationSettings> | null = null;
	private orgAppearanceRepo: Repository<OrganisationAppearance> | null = null;
	private orgHoursRepo: Repository<OrganisationHours> | null = null;
	
	private orgSourceRepo: Repository<Organisation> | null = null;
	private branchSourceRepo: Repository<Branch> | null = null;
	private userSourceRepo: Repository<User> | null = null;
	private userProfileSourceRepo: Repository<UserProfile> | null = null;
	private userEmploymentSourceRepo: Repository<UserEmployeementProfile> | null = null;
	private userTargetSourceRepo: Repository<UserTarget> | null = null;
	private deviceSourceRepo: Repository<Device> | null = null;
	private licenseSourceRepo: Repository<License> | null = null;
	private orgSettingsSourceRepo: Repository<OrganisationSettings> | null = null;
	private orgAppearanceSourceRepo: Repository<OrganisationAppearance> | null = null;
	private orgHoursSourceRepo: Repository<OrganisationHours> | null = null;
	
	private orgMapping: UidMapping = {};
	private branchMapping: UidMapping = {};
	private userMapping: UidMapping = {};
	private deviceMapping: IdMapping = {};
	
	private stats = new MigrationStats();
	private dryRun = false;
	private onlyEntities: string[] = [];
	private verbose = false;

	async initialize(pgUrl?: string) {
		console.log('🔧 Initializing connections...\n');
		await this.initPostgreSQLTarget(pgUrl);
		await this.initPostgreSQLSource();
		console.log('✅ All connections initialized\n');
	}

	private async initPostgreSQLSource() {
		const host = process.env.PG_DB_HOST || 'localhost';
		const port = parseInt(process.env.PG_DB_PORT || '5432', 10);
		const username = process.env.PG_DB_USERNAME || 'brandonnkawu';
		const password = process.env.PG_DB_PASSWORD || 'Umzingeli@2026';
		const database = process.env.PG_DB_NAME || 'sana';

		let finalHost = host, finalPort = port, finalUsername = username, finalPassword = password, finalDatabase = database;

		if (host && (host.startsWith('postgresql://') || host.startsWith('postgres://'))) {
			const url = new URL(host);
			finalHost = url.hostname;
			finalPort = url.port ? parseInt(url.port, 10) : 5432;
			finalUsername = url.username || username;
			finalPassword = url.password || password;
			finalDatabase = url.pathname ? url.pathname.slice(1) : database;
		}

		const entities = this.pgTargetDataSource?.options.entities || [Organisation, Branch, User, UserProfile, UserEmployeementProfile, UserTarget, Device, License, OrganisationSettings, OrganisationAppearance, OrganisationHours];

		this.pgSourceDataSource = new DataSource({
			type: 'postgres',
			host: finalHost,
			port: finalPort,
			username: finalUsername,
			password: finalPassword,
			database: finalDatabase,
			entities: entities,
			synchronize: false,
			logging: false,
		});

		await this.pgSourceDataSource.initialize();
		console.log(`✅ Connected to local PostgreSQL: ${finalHost}:${finalPort}/${finalDatabase}\n`);

		this.orgSourceRepo = this.pgSourceDataSource.getRepository(Organisation);
		this.branchSourceRepo = this.pgSourceDataSource.getRepository(Branch);
		this.userSourceRepo = this.pgSourceDataSource.getRepository(User);
		this.userProfileSourceRepo = this.pgSourceDataSource.getRepository(UserProfile);
		this.userEmploymentSourceRepo = this.pgSourceDataSource.getRepository(UserEmployeementProfile);
		this.userTargetSourceRepo = this.pgSourceDataSource.getRepository(UserTarget);
		this.deviceSourceRepo = this.pgSourceDataSource.getRepository(Device);
		this.licenseSourceRepo = this.pgSourceDataSource.getRepository(License);
		this.orgSettingsSourceRepo = this.pgSourceDataSource.getRepository(OrganisationSettings);
		this.orgAppearanceSourceRepo = this.pgSourceDataSource.getRepository(OrganisationAppearance);
		this.orgHoursSourceRepo = this.pgSourceDataSource.getRepository(OrganisationHours);
	}

	private async initPostgreSQLTarget(pgUrl?: string) {
		this.app = await NestFactory.createApplicationContext(AppModule, { logger: false });
		this.originalDataSource = this.app.get(DataSource);
		this.pgTargetDataSource = this.originalDataSource;

		if (pgUrl) {
			const url = new URL(pgUrl);
			const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname?.startsWith('192.168.') || url.hostname?.startsWith('10.');
			const isRender = url.hostname?.includes('dpg-') || url.hostname?.includes('render.com');
			const enableSSL = !isLocalhost || isRender;

			const newDataSource = new DataSource({
				type: 'postgres',
				host: url.hostname,
				port: parseInt(url.port || '5432', 10),
				username: url.username,
				password: url.password,
				database: url.pathname.slice(1),
				entities: this.pgTargetDataSource.options.entities,
				synchronize: false,
				logging: false,
				extra: { ssl: enableSSL ? { rejectUnauthorized: false } : false },
			});

			await newDataSource.initialize();
			this.pgTargetDataSource = newDataSource;
		} else {
			const host = process.env.REMOTE_PG_DB_HOST || '';
			const port = parseInt(process.env.REMOTE_PG_DB_PORT || '5432', 10);
			const username = process.env.REMOTE_PG_DB_USERNAME || '';
			const password = process.env.REMOTE_PG_DB_PASSWORD || '';
			const database = process.env.REMOTE_PG_DB_NAME || '';

			let finalHost = host, finalPort = port, finalUsername = username, finalPassword = password, finalDatabase = database;

			if (host && (host.startsWith('postgresql://') || host.startsWith('postgres://'))) {
				const url = new URL(host);
				finalHost = url.hostname;
				finalPort = url.port ? parseInt(url.port, 10) : 5432;
				finalUsername = url.username || username;
				finalPassword = url.password || password;
				finalDatabase = url.pathname ? url.pathname.slice(1) : database;
			}

			if (!finalHost || !finalUsername || !finalPassword || !finalDatabase) {
				throw new Error('Missing REMOTE_PG_DB_HOST environment variables');
			}

			const isLocalhost = finalHost === 'localhost' || finalHost === '127.0.0.1' || finalHost?.startsWith('192.168.') || finalHost?.startsWith('10.');
			const enableSSL = !isLocalhost;

			const newDataSource = new DataSource({
				type: 'postgres',
				host: finalHost,
				port: finalPort,
				username: finalUsername,
				password: finalPassword,
				database: finalDatabase,
				entities: this.pgTargetDataSource.options.entities,
				synchronize: false,
				logging: false,
				extra: { ssl: enableSSL ? { rejectUnauthorized: false } : false },
			});

			await newDataSource.initialize();
			this.pgTargetDataSource = newDataSource;
			console.log(`✅ Connected to remote PostgreSQL: ${finalHost}:${finalPort}/${finalDatabase}\n`);
		}

		this.orgRepo = this.pgTargetDataSource.getRepository(Organisation);
		this.branchRepo = this.pgTargetDataSource.getRepository(Branch);
		this.userRepo = this.pgTargetDataSource.getRepository(User);
		this.userProfileRepo = this.pgTargetDataSource.getRepository(UserProfile);
		this.userEmploymentRepo = this.pgTargetDataSource.getRepository(UserEmployeementProfile);
		this.userTargetRepo = this.pgTargetDataSource.getRepository(UserTarget);
		this.deviceRepo = this.pgTargetDataSource.getRepository(Device);
		this.licenseRepo = this.pgTargetDataSource.getRepository(License);
		this.orgSettingsRepo = this.pgTargetDataSource.getRepository(OrganisationSettings);
		this.orgAppearanceRepo = this.pgTargetDataSource.getRepository(OrganisationAppearance);
		this.orgHoursRepo = this.pgTargetDataSource.getRepository(OrganisationHours);
	}

	async migrate(options: ScriptArguments) {
		this.dryRun = options['dry-run'] || false;
		this.verbose = options.verbose || false;
		this.onlyEntities = options.only ? options.only.split(',').map(e => e.trim()) : [];

		if (this.dryRun) console.log('🔍 DRY RUN MODE - No data will be written\n');
		if (!this.pgSourceDataSource || !this.pgTargetDataSource) throw new Error('Connections must be initialized');

		await this.printPreMigrationSummary();
		await this.validateMappings();

		console.log('🚀 Starting migration (local to remote)...\n');
		const startTime = Date.now();

		try {
			if (this.shouldImport('orgs')) {
				await this.migrateOrganisations();
				await this.migrateOrganisationSettings();
				await this.migrateOrganisationAppearance();
				await this.migrateOrganisationHours();
				await this.createDefaultOrgHours();
			}
			if (this.shouldImport('branches')) await this.migrateBranches();
			if (this.shouldImport('devices')) await this.migrateDevices();
			if (this.shouldImport('licenses')) await this.migrateLicenses();
			if (this.shouldImport('users')) {
				await this.migrateUsers();
				await this.migrateUserProfiles();
				await this.migrateUserEmploymentProfiles();
				await this.migrateUserTargets();
			}

			this.printStats(((Date.now() - startTime) / 1000).toFixed(2));
		} catch (error) {
			console.error('\n❌ Migration failed:', error);
			throw error;
		}
	}

	private async printPreMigrationSummary() {
		console.log('\n📋 PRE-MIGRATION SUMMARY\n');
		
		const orgs = await this.orgSourceRepo!.count({ where: { isDeleted: false } });
		const branches = await this.branchSourceRepo!.count({ where: { isDeleted: false } });
		const users = await this.userSourceRepo!.count({ where: { isDeleted: false } });
		const devices = await this.deviceSourceRepo!.count({ where: { isDeleted: false } });
		const licenses = await this.licenseSourceRepo!.count();
		
		console.log(`Source Database:`);
		console.log(`  Organisations: ${orgs}`);
		console.log(`  Branches: ${branches}`);
		console.log(`  Users: ${users}`);
		console.log(`  Devices: ${devices}`);
		console.log(`  Licenses: ${licenses}`);
		console.log('');
	}

	private async validateMappings() {
		const sourceOrgCount = await this.orgSourceRepo!.count({ where: { isDeleted: false } });
		if (sourceOrgCount > 0 && Object.keys(this.orgMapping).length === 0 && !this.dryRun) {
			console.warn('⚠️  Warning: No organisations mapped yet. This will be populated during migration.');
		}
	}

	private shouldImport(entity: string): boolean {
		return this.onlyEntities.length === 0 || this.onlyEntities.includes(entity);
	}

	private async migrateOrganisations() {
		console.log('\n📦 Migrating Organisations...');
		const sourceOrgs = await this.orgSourceRepo!.find({ where: { isDeleted: false } });
		this.stats.organisations.total = sourceOrgs.length;
		console.log(`Found ${sourceOrgs.length} organisations`);

		for (const sourceOrg of sourceOrgs) {
			try {
				if (this.dryRun) {
					this.stats.organisations.imported++;
					this.orgMapping[sourceOrg.uid] = sourceOrg.uid; // Simulate mapping for dry-run
					continue;
				}

				const existing = await this.orgRepo!.findOne({ where: { ref: sourceOrg.ref } });
				if (existing) {
					if (this.verbose) console.log(`  🔄 Duplicate org ${sourceOrg.ref} - UPDATING with local data`);
					Object.assign(existing, { ...sourceOrg, updatedAt: new Date() });
					await this.orgRepo!.save(existing);
					this.orgMapping[sourceOrg.uid] = existing.uid;
					this.stats.organisations.updated++;
				} else {
					const saved = await this.orgRepo!.save(this.orgRepo!.create({ ...sourceOrg }));
					this.orgMapping[sourceOrg.uid] = saved.uid;
					this.stats.organisations.imported++;
					if (this.verbose) console.log(`  ✅ Imported: ${saved.name} (${saved.ref})`);
				}
			} catch (error: any) {
				this.stats.organisations.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ Organisations: ${this.stats.organisations.imported} imported, ${this.stats.organisations.updated} updated, ${this.stats.organisations.errors} errors\n`);
	}

	private async migrateOrganisationSettings() {
		console.log('\n📦 Migrating Organisation Settings...');
		const sourceSettings = await this.orgSettingsSourceRepo!.find({ 
			relations: ['organisation'],
			where: { isDeleted: false }
		});
		this.stats.orgSettings.total = sourceSettings.length;
		console.log(`Found ${sourceSettings.length} organisation settings`);

		for (const sourceSetting of sourceSettings) {
			try {
				const orgUid = sourceSetting.organisation?.uid || sourceSetting.organisationUid;
				const mappedOrgUid = orgUid ? this.orgMapping[orgUid] : null;
				if (!mappedOrgUid) {
					this.stats.orgSettings.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped settings: org ${orgUid} not found in mapping (available: ${Object.keys(this.orgMapping).length} orgs)`);
					}
					continue;
				}
				if (this.dryRun) { this.stats.orgSettings.imported++; continue; }

				const existing = await this.orgSettingsRepo!.findOne({ where: { organisationUid: mappedOrgUid } });
				if (existing) {
					if (this.verbose) console.log(`  🔄 Duplicate settings for org ${mappedOrgUid} - UPDATING`);
					Object.assign(existing, { ...sourceSetting, organisationUid: mappedOrgUid, updatedAt: new Date() });
					await this.orgSettingsRepo!.save(existing);
					this.stats.orgSettings.updated++;
				} else {
					await this.orgSettingsRepo!.save(this.orgSettingsRepo!.create({ ...sourceSetting, organisationUid: mappedOrgUid, organisation: { uid: mappedOrgUid } as Organisation }));
					this.stats.orgSettings.imported++;
				}
			} catch (error: any) {
				this.stats.orgSettings.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ Settings: ${this.stats.orgSettings.imported} imported, ${this.stats.orgSettings.updated} updated, ${this.stats.orgSettings.skipped} skipped\n`);
	}

	private async migrateOrganisationAppearance() {
		console.log('\n📦 Migrating Organisation Appearance...');
		const sourceAppearances = await this.orgAppearanceSourceRepo!.find({ 
			relations: ['organisation'],
			where: { isDeleted: false }
		});
		this.stats.orgAppearance.total = sourceAppearances.length;
		console.log(`Found ${sourceAppearances.length} organisation appearances`);

		for (const sourceAppearance of sourceAppearances) {
			try {
				const orgUid = sourceAppearance.organisation?.uid || sourceAppearance.organisationUid;
				const mappedOrgUid = orgUid ? this.orgMapping[orgUid] : null;
				if (!mappedOrgUid) {
					this.stats.orgAppearance.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped appearance: org ${orgUid} not found in mapping`);
					}
					continue;
				}
				if (this.dryRun) { this.stats.orgAppearance.imported++; continue; }

				const existing = await this.orgAppearanceRepo!.findOne({ where: { organisationUid: mappedOrgUid } });
				if (existing) {
					if (this.verbose) console.log(`  🔄 Duplicate appearance for org ${mappedOrgUid} - UPDATING`);
					Object.assign(existing, { ...sourceAppearance, updatedAt: new Date() });
					await this.orgAppearanceRepo!.save(existing);
					this.stats.orgAppearance.updated++;
				} else {
					await this.orgAppearanceRepo!.save(this.orgAppearanceRepo!.create({ ...sourceAppearance, organisationUid: mappedOrgUid, organisation: { uid: mappedOrgUid } as Organisation }));
					this.stats.orgAppearance.imported++;
				}
			} catch (error: any) {
				this.stats.orgAppearance.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ Appearance: ${this.stats.orgAppearance.imported} imported, ${this.stats.orgAppearance.updated} updated, ${this.stats.orgAppearance.skipped} skipped\n`);
	}

	private async migrateOrganisationHours() {
		console.log('\n📦 Migrating Organisation Hours...');
		const sourceHours = await this.orgHoursSourceRepo!.find({ 
			relations: ['organisation'],
			where: { isDeleted: false }
		});
		this.stats.orgHours.total = sourceHours.length;
		console.log(`Found ${sourceHours.length} organisation hours records`);

		for (const sourceHour of sourceHours) {
			try {
				const orgUid = sourceHour.organisation?.uid || sourceHour.organisationUid;
				const mappedOrgUid = orgUid ? this.orgMapping[orgUid] : null;
				if (!mappedOrgUid) {
					this.stats.orgHours.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped hours: org ${orgUid} not found in mapping`);
					}
					continue;
				}
				if (this.dryRun) { this.stats.orgHours.imported++; continue; }

				const existing = await this.orgHoursRepo!.findOne({ where: { organisationUid: mappedOrgUid } });
				if (existing) {
					if (this.verbose) console.log(`  🔄 Duplicate hours for org ${mappedOrgUid} - UPDATING`);
					Object.assign(existing, { ...sourceHour, updatedAt: new Date() });
					await this.orgHoursRepo!.save(existing);
					this.stats.orgHours.updated++;
				} else {
					await this.orgHoursRepo!.save(this.orgHoursRepo!.create({ ...sourceHour, organisationUid: mappedOrgUid, organisation: { uid: mappedOrgUid } as Organisation }));
					this.stats.orgHours.imported++;
				}
			} catch (error: any) {
				this.stats.orgHours.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ Hours: ${this.stats.orgHours.imported} imported, ${this.stats.orgHours.updated} updated, ${this.stats.orgHours.skipped} skipped\n`);
	}

	private async createDefaultOrgHours() {
		if (this.dryRun) {
			const orgsWithoutHours = Object.values(this.orgMapping).length;
			console.log(`\n📦 Would create default hours for ${orgsWithoutHours} organisations\n`);
			return;
		}

		console.log('\n📦 Creating default Organisation Hours for orgs without hours...');
		
		for (const [sourceUid, targetUid] of Object.entries(this.orgMapping)) {
			try {
				const existing = await this.orgHoursRepo!.findOne({ where: { organisationUid: targetUid } });
				if (existing) continue;

				const defaultHours = this.orgHoursRepo!.create({
					ref: `ORG-${targetUid}`,
					openTime: new Date('1970-01-01T07:00:00.000Z'),
					closeTime: new Date('1970-01-01T16:30:00.000Z'),
					weeklySchedule: {
						monday: true,
						tuesday: true,
						wednesday: true,
						thursday: true,
						friday: true,
						saturday: false,
						sunday: false,
					},
					timezone: 'Africa/Johannesburg',
					holidayMode: false,
					isDeleted: false,
					organisationUid: targetUid,
					organisation: { uid: targetUid } as Organisation,
				});

				await this.orgHoursRepo!.save(defaultHours);
				this.stats.orgHours.created++;
				if (this.verbose) console.log(`  ✅ Created default hours for org ${targetUid}`);
			} catch (error: any) {
				this.stats.orgHours.errors++;
				console.error(`  ❌ Error creating default hours for org ${targetUid}: ${error.message}`);
			}
		}
		console.log(`✅ Created ${this.stats.orgHours.created} default org hours\n`);
	}

	private async migrateBranches() {
		console.log('\n📦 Migrating Branches...');
		const sourceBranches = await this.branchSourceRepo!.find({ 
			where: { isDeleted: false }, 
			relations: ['organisation'] 
		});
		this.stats.branches.total = sourceBranches.length;
		console.log(`Found ${sourceBranches.length} branches`);

		for (let i = 0; i < sourceBranches.length; i++) {
			const sourceBranch = sourceBranches[i];
			try {
				const orgUid = sourceBranch.organisation?.uid || (typeof sourceBranch.organisation === 'number' ? sourceBranch.organisation : null);
				const mappedOrgUid = orgUid ? this.orgMapping[orgUid] : null;
				if (!mappedOrgUid) {
					this.stats.branches.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped branch ${sourceBranch.ref}: org ${orgUid} not found in mapping`);
					}
					continue;
				}
				if (this.dryRun) {
					this.stats.branches.imported++;
					this.branchMapping[sourceBranch.uid] = sourceBranch.uid; // Simulate mapping
					continue;
				}

				const existing = await this.branchRepo!.findOne({ where: { ref: sourceBranch.ref } });
				if (existing) {
					if (this.verbose) console.log(`  🔄 Duplicate branch ${sourceBranch.ref} - UPDATING`);
					Object.assign(existing, { ...sourceBranch, organisation: { uid: mappedOrgUid } as Organisation, updatedAt: new Date() });
					await this.branchRepo!.save(existing);
					this.branchMapping[sourceBranch.uid] = existing.uid;
					this.stats.branches.updated++;
				} else {
					const saved = await this.branchRepo!.save(this.branchRepo!.create({ ...sourceBranch, organisation: { uid: mappedOrgUid } as Organisation }));
					this.branchMapping[sourceBranch.uid] = saved.uid;
					this.stats.branches.imported++;
					if (this.verbose && (i + 1) % 10 === 0) {
						process.stdout.write(`\r  Progress: ${i + 1}/${sourceBranches.length}`);
					}
				}
			} catch (error: any) {
				this.stats.branches.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		if (this.stats.branches.total > 0) console.log(`\r  Progress: ${sourceBranches.length}/${sourceBranches.length}`);
		console.log(`✅ Branches: ${this.stats.branches.imported} imported, ${this.stats.branches.updated} updated, ${this.stats.branches.skipped} skipped\n`);
	}

	private async migrateDevices() {
		console.log('\n📦 Migrating Devices...');
		const sourceDevices = await this.deviceSourceRepo!.find({ 
			where: { isDeleted: false }, 
			relations: ['organisation', 'branch'] 
		});
		this.stats.devices.total = sourceDevices.length;
		console.log(`Found ${sourceDevices.length} devices`);

		for (const sourceDevice of sourceDevices) {
			try {
				const mappedOrgUid = this.orgMapping[sourceDevice.orgID];
				const mappedBranchUid = this.branchMapping[sourceDevice.branchID];
				if (!mappedOrgUid || !mappedBranchUid) {
					this.stats.devices.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped device ${sourceDevice.deviceID}: org ${sourceDevice.orgID} or branch ${sourceDevice.branchID} not found`);
					}
					continue;
				}
				if (this.dryRun) { this.stats.devices.imported++; continue; }

				const existing = await this.deviceRepo!.findOne({ where: { deviceID: sourceDevice.deviceID, isDeleted: false } });
				if (existing) {
					if (this.verbose) console.log(`  🔄 Duplicate device ${sourceDevice.deviceID} - UPDATING`);
					Object.assign(existing, { ...sourceDevice, orgID: mappedOrgUid, branchID: mappedBranchUid, branchUid: mappedBranchUid, organisation: { uid: mappedOrgUid } as Organisation, branch: { uid: mappedBranchUid } as Branch, updatedAt: new Date() });
					await this.deviceRepo!.save(existing);
					this.deviceMapping[sourceDevice.id] = existing.id;
					this.stats.devices.updated++;
				} else {
					const saved = await this.deviceRepo!.save(this.deviceRepo!.create({ ...sourceDevice, orgID: mappedOrgUid, branchID: mappedBranchUid, branchUid: mappedBranchUid, organisation: { uid: mappedOrgUid } as Organisation, branch: { uid: mappedBranchUid } as Branch }));
					this.deviceMapping[sourceDevice.id] = saved.id;
					this.stats.devices.imported++;
				}
			} catch (error: any) {
				this.stats.devices.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ Devices: ${this.stats.devices.imported} imported, ${this.stats.devices.updated} updated, ${this.stats.devices.skipped} skipped\n`);
	}

	private async migrateLicenses() {
		console.log('\n📦 Migrating Licenses...');
		const sourceLicenses = await this.licenseSourceRepo!.find({ 
			relations: ['organisation'] 
		});
		this.stats.licenses.total = sourceLicenses.length;
		console.log(`Found ${sourceLicenses.length} licenses`);

		for (const sourceLicense of sourceLicenses) {
			try {
				const orgUid = sourceLicense.organisation?.uid || sourceLicense.organisationRef;
				const mappedOrgUid = orgUid ? this.orgMapping[orgUid] : null;
				if (!mappedOrgUid) {
					this.stats.licenses.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped license ${sourceLicense.licenseKey}: org ${orgUid} not found in mapping`);
					}
					continue;
				}
				if (this.dryRun) { this.stats.licenses.imported++; continue; }

				const existing = await this.licenseRepo!.findOne({ where: { licenseKey: sourceLicense.licenseKey } });
				if (existing) {
					if (this.verbose) console.log(`  🔄 Duplicate license ${sourceLicense.licenseKey} - UPDATING`);
					Object.assign(existing, { ...sourceLicense, organisationRef: mappedOrgUid, organisation: { uid: mappedOrgUid } as Organisation, updatedAt: new Date() });
					await this.licenseRepo!.save(existing);
					this.stats.licenses.updated++;
				} else {
					await this.licenseRepo!.save(this.licenseRepo!.create({ ...sourceLicense, organisationRef: mappedOrgUid, organisation: { uid: mappedOrgUid } as Organisation }));
					this.stats.licenses.imported++;
				}
			} catch (error: any) {
				this.stats.licenses.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ Licenses: ${this.stats.licenses.imported} imported, ${this.stats.licenses.updated} updated, ${this.stats.licenses.skipped} skipped\n`);
	}

	private async migrateUsers() {
		console.log('\n📦 Migrating Users...');
		const sourceUsers = await this.userSourceRepo!.find({ 
			where: { isDeleted: false }, 
			relations: ['organisation', 'branch'] 
		});
		this.stats.users.total = sourceUsers.length;
		console.log(`Found ${sourceUsers.length} users`);

		for (let i = 0; i < sourceUsers.length; i++) {
			const sourceUser = sourceUsers[i];
			try {
				const mappedOrgUid = sourceUser.organisationRef ? this.orgMapping[parseInt(sourceUser.organisationRef, 10)] : (sourceUser.organisation ? this.orgMapping[sourceUser.organisation.uid] : null);
				const mappedBranchUid = sourceUser.branch ? this.branchMapping[sourceUser.branch.uid] : null;
				if (this.dryRun) {
					this.stats.users.imported++;
					this.userMapping[sourceUser.uid] = sourceUser.uid; // Simulate mapping
					if ((i + 1) % 10 === 0 || i === sourceUsers.length - 1) {
						process.stdout.write(`\r  Processing: ${i + 1}/${sourceUsers.length}`);
					}
					continue;
				}

				const existing = await this.userRepo!.findOne({ where: { email: sourceUser.email } });
				if (existing) {
					if (this.verbose && (i + 1) % 10 === 0) {
						console.log(`  🔄 Duplicate user ${sourceUser.email} - UPDATING`);
					}
					Object.assign(existing, { ...sourceUser, organisationRef: mappedOrgUid ? String(mappedOrgUid) : null, organisation: mappedOrgUid ? { uid: mappedOrgUid } as Organisation : undefined, branch: mappedBranchUid ? { uid: mappedBranchUid } as Branch : undefined, updatedAt: new Date() });
					await this.userRepo!.save(existing);
					this.userMapping[sourceUser.uid] = existing.uid;
					this.stats.users.updated++;
				} else {
					const saved = await this.userRepo!.save(this.userRepo!.create({ ...sourceUser, organisationRef: mappedOrgUid ? String(mappedOrgUid) : null, organisation: mappedOrgUid ? { uid: mappedOrgUid } as Organisation : undefined, branch: mappedBranchUid ? { uid: mappedBranchUid } as Branch : undefined }));
					this.userMapping[sourceUser.uid] = saved.uid;
					this.stats.users.imported++;
				}
				if ((i + 1) % 10 === 0 || i === sourceUsers.length - 1) {
					process.stdout.write(`\r  Processing: ${i + 1}/${sourceUsers.length}`);
				}
			} catch (error: any) {
				this.stats.users.errors++;
				console.error(`\n  ❌ Error: ${error.message}`);
			}
		}
		console.log(`\n✅ Users: ${this.stats.users.imported} imported, ${this.stats.users.updated} updated, ${this.stats.users.errors} errors\n`);
	}

	private async migrateUserProfiles() {
		console.log('\n📦 Migrating User Profiles...');
		const sourceProfiles = await this.userProfileSourceRepo!.find({ relations: ['owner'] });
		this.stats.userProfiles.total = sourceProfiles.length;
		console.log(`Found ${sourceProfiles.length} user profiles`);

		for (const sourceProfile of sourceProfiles) {
			try {
				const userId = sourceProfile.owner?.uid || (typeof sourceProfile.owner === 'number' ? sourceProfile.owner : null);
				const mappedUserId = userId ? this.userMapping[userId] : null;
				if (!mappedUserId) {
					this.stats.userProfiles.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped profile: user ${userId} not found in mapping`);
					}
					continue;
				}
				if (this.dryRun) { this.stats.userProfiles.imported++; continue; }

				const existing = await this.userProfileRepo!.findOne({ where: { owner: { uid: mappedUserId } as User } });
				if (existing) {
					Object.assign(existing, { ...sourceProfile, updatedAt: new Date() });
					await this.userProfileRepo!.save(existing);
					this.stats.userProfiles.updated++;
				} else {
					await this.userProfileRepo!.save(this.userProfileRepo!.create({ ...sourceProfile, owner: { uid: mappedUserId } as User }));
					this.stats.userProfiles.imported++;
				}
			} catch (error: any) {
				this.stats.userProfiles.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ User Profiles: ${this.stats.userProfiles.imported} imported, ${this.stats.userProfiles.updated} updated, ${this.stats.userProfiles.skipped} skipped\n`);
	}

	private async migrateUserEmploymentProfiles() {
		console.log('\n📦 Migrating User Employment Profiles...');
		const sourceProfiles = await this.userEmploymentSourceRepo!.find({ relations: ['owner'] });
		this.stats.userEmploymentProfiles.total = sourceProfiles.length;

		for (const sourceProfile of sourceProfiles) {
			try {
				const userId = sourceProfile.owner?.uid || (typeof sourceProfile.owner === 'number' ? sourceProfile.owner : null);
				const mappedUserId = userId ? this.userMapping[userId] : null;
				if (!mappedUserId) {
					this.stats.userEmploymentProfiles.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped employment profile: user ${userId} not found in mapping`);
					}
					continue;
				}
				if (this.dryRun) { this.stats.userEmploymentProfiles.imported++; continue; }

				const existing = await this.userEmploymentRepo!.findOne({ where: { owner: { uid: mappedUserId } as User } });
				if (existing) {
					Object.assign(existing, { ...sourceProfile, updatedAt: new Date() });
					await this.userEmploymentRepo!.save(existing);
					this.stats.userEmploymentProfiles.updated++;
				} else {
					await this.userEmploymentRepo!.save(this.userEmploymentRepo!.create({ ...sourceProfile, owner: { uid: mappedUserId } as User }));
					this.stats.userEmploymentProfiles.imported++;
				}
			} catch (error: any) {
				this.stats.userEmploymentProfiles.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ Employment Profiles: ${this.stats.userEmploymentProfiles.imported} imported, ${this.stats.userEmploymentProfiles.updated} updated, ${this.stats.userEmploymentProfiles.skipped} skipped\n`);
	}

	private async migrateUserTargets() {
		console.log('\n📦 Migrating User Targets...');
		const sourceTargets = await this.userTargetSourceRepo!.find({ relations: ['user'] });
		this.stats.userTargets.total = sourceTargets.length;

		for (const sourceTarget of sourceTargets) {
			try {
				const userId = sourceTarget.user?.uid || (typeof sourceTarget.user === 'number' ? sourceTarget.user : null);
				const mappedUserId = userId ? this.userMapping[userId] : null;
				if (!mappedUserId) {
					this.stats.userTargets.skipped++;
					if (this.verbose) {
						console.log(`  ⏭️  Skipped target: user ${userId} not found in mapping`);
					}
					continue;
				}
				if (this.dryRun) { this.stats.userTargets.imported++; continue; }

				const existing = await this.userTargetRepo!.findOne({ where: { user: { uid: mappedUserId } as User } });
				if (existing) {
					Object.assign(existing, { ...sourceTarget, updatedAt: new Date() });
					await this.userTargetRepo!.save(existing);
					this.stats.userTargets.updated++;
				} else {
					await this.userTargetRepo!.save(this.userTargetRepo!.create({ ...sourceTarget, user: { uid: mappedUserId } as User }));
					this.stats.userTargets.imported++;
				}
			} catch (error: any) {
				this.stats.userTargets.errors++;
				console.error(`  ❌ Error: ${error.message}`);
			}
		}
		console.log(`✅ User Targets: ${this.stats.userTargets.imported} imported, ${this.stats.userTargets.updated} updated, ${this.stats.userTargets.skipped} skipped\n`);
	}

	private printStats(duration: string) {
		console.log('\n' + '='.repeat(60));
		console.log('📊 MIGRATION SUMMARY');
		console.log('='.repeat(60));
		console.log(`⏱️  Duration: ${duration}s\n`);
		
		const print = (name: string, stats: any) => {
			const created = stats.created ? `, Created: ${stats.created}` : '';
			console.log(`${name}: Total: ${stats.total}, Imported: ${stats.imported}, Updated: ${stats.updated}, Skipped: ${stats.skipped}, Errors: ${stats.errors}${created}`);
		};
		
		print('Organisations', this.stats.organisations);
		print('Org Settings', this.stats.orgSettings);
		print('Org Appearance', this.stats.orgAppearance);
		print('Org Hours', this.stats.orgHours);
		print('Branches', this.stats.branches);
		print('Devices', this.stats.devices);
		print('Licenses', this.stats.licenses);
		print('Users', this.stats.users);
		print('User Profiles', this.stats.userProfiles);
		print('Employment Profiles', this.stats.userEmploymentProfiles);
		print('User Targets', this.stats.userTargets);
		console.log('\n' + '='.repeat(60));
	}

	async cleanup() {
		console.log('\n🧹 Cleaning up...');
		try {
			if (this.pgSourceDataSource?.isInitialized) {
				await this.pgSourceDataSource.destroy();
				console.log('✅ Source PostgreSQL connection closed');
			}
		} catch (error: any) {
			console.warn('⚠️  Source cleanup warning:', error.message);
		}
		
		try {
			if (this.pgTargetDataSource?.isInitialized && this.pgTargetDataSource !== this.originalDataSource) {
				await this.pgTargetDataSource.destroy();
				console.log('✅ Target PostgreSQL connection closed');
			}
		} catch (error: any) {
			console.warn('⚠️  Target cleanup warning:', error.message);
		}
		
		if (this.app) {
			try {
				await this.app.close();
				console.log('✅ NestJS app closed');
			} catch (error: any) {
				if (!error.message?.includes('DataSource')) {
					console.warn('⚠️  App cleanup warning:', error.message);
				}
			}
		}
		console.log('✅ Cleanup complete');
	}
}

async function main() {
	const argv = yargs(hideBin(process.argv))
		.options({
			'pg-url': { type: 'string', describe: 'PostgreSQL connection URL' },
			'dry-run': { type: 'boolean', default: false, describe: 'Preview without writing' },
			only: { type: 'string', describe: 'Import only specific entities (comma-separated)' },
			verbose: { type: 'boolean', default: false, describe: 'Show detailed progress' },
		})
		.help()
		.parseSync() as ScriptArguments;

	const migrator = new LocalToRemoteMigrator();
	try {
		await migrator.initialize(argv['pg-url']);
		await migrator.migrate(argv);
	} catch (error) {
		console.error('\n❌ Migration failed:', error);
		process.exit(1);
	} finally {
		await migrator.cleanup();
	}
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
