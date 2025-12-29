#!/usr/bin/env node

/**
 * Fetch Remote Data Script
 * 
 * Connects to the remote PostgreSQL database and fetches essential setup data:
 * - Organisations (with settings, appearance, work hours)
 * - Branches
 * - Users (with profiles, employment, targets)
 * - Devices (IoT - no historical records/logs)
 * - Licenses
 * 
 * Usage:
 *   # Fetch from remote to local PostgreSQL
 *   npm run fetch:remote-data
 *   
 *   # Dry run (preview only)
 *   npm run fetch:remote-data -- --dry-run
 *   
 *   # Fetch specific entities only
 *   npm run fetch:remote-data -- --only orgs,users,devices
 *   
 *   # Override remote connection with URL
 *   npm run fetch:remote-data -- --pg-url postgresql://user:pass@host:port/dbname
 *   
 *   # Verbose output
 *   npm run fetch:remote-data -- --verbose
 * 
 * Environment Variables:
 *   Local (destination):
 *     PG_DB_HOST, PG_DB_PORT, PG_DB_USERNAME, PG_DB_PASSWORD, PG_DB_NAME
 *   
 *   Remote (source):
 *     REMOTE_PG_DB_HOST (can be full connection string or hostname)
 *     REMOTE_PG_DB_PORT, REMOTE_PG_DB_USERNAME, REMOTE_PG_DB_PASSWORD, REMOTE_PG_DB_NAME
 */

import * as yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';

// Entity imports
import { Organisation } from '../organisation/entities/organisation.entity';
import { OrganisationSettings } from '../organisation/entities/organisation-settings.entity';
import { OrganisationAppearance } from '../organisation/entities/organisation-appearance.entity';
import { OrganisationHours } from '../organisation/entities/organisation-hours.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { UserProfile } from '../user/entities/user.profile.entity';
import { UserEmployeementProfile } from '../user/entities/user.employeement.profile.entity';
import { UserTarget } from '../user/entities/user-target.entity';
import { Device } from '../iot/entities/iot.entity';
import { License } from '../licensing/entities/license.entity';

// ============================================================================
// Types & Configuration
// ============================================================================

interface ScriptArguments {
	'pg-url'?: string;
	'dry-run'?: boolean;
	only?: string;
	verbose?: boolean;
}

interface FetchStat {
	entity: string;
	remote: number;
	fetched: number;
	errors: number;
	duration: number;
}

interface TableConfig {
	key: string;
	table: string;
	name: string;
	pk: string;
	entity: any;
	dependsOn?: string[]; // Tables this depends on (for proper ordering)
}

// Entity config for PostgreSQL tables - ordered by dependencies
const PG_TABLES: TableConfig[] = [
	// Organisation tables first (no dependencies)
	{ key: 'orgs', table: 'organisation', name: 'Organisations', pk: 'uid', entity: Organisation },
	{ key: 'orgs', table: 'organisation_settings', name: 'Org Settings', pk: 'uid', entity: OrganisationSettings, dependsOn: ['organisation'] },
	{ key: 'orgs', table: 'organisation_appearance', name: 'Org Appearance', pk: 'uid', entity: OrganisationAppearance, dependsOn: ['organisation'] },
	{ key: 'orgs', table: 'organisation_hours', name: 'Org Hours', pk: 'uid', entity: OrganisationHours, dependsOn: ['organisation'] },
	
	// Branches (depends on organisation)
	{ key: 'branches', table: 'branch', name: 'Branches', pk: 'uid', entity: Branch, dependsOn: ['organisation'] },
	
	// Licenses (might depend on organisation)
	{ key: 'licenses', table: 'licenses', name: 'Licenses', pk: 'uid', entity: License, dependsOn: ['organisation'] },
	
	// Users (depends on organisation and branch)
	{ key: 'users', table: 'users', name: 'Users', pk: 'uid', entity: User, dependsOn: ['organisation', 'branch'] },
	{ key: 'users', table: 'user_profile', name: 'User Profiles', pk: 'uid', entity: UserProfile, dependsOn: ['users'] },
	{ key: 'users', table: 'user_employeement_profile', name: 'Employment Profiles', pk: 'uid', entity: UserEmployeementProfile, dependsOn: ['users'] },
	{ key: 'users', table: 'user_target', name: 'User Targets', pk: 'uid', entity: UserTarget, dependsOn: ['users'] },
	
	// Devices (depends on organisation and branch)
	{ key: 'devices', table: 'device', name: 'Devices', pk: 'id', entity: Device, dependsOn: ['organisation', 'branch'] },
];

const BATCH_SIZE = 100;

// ============================================================================
// Fetcher Class
// ============================================================================

class RemoteDataFetcher {
	private localPgDS: DataSource | null = null;
	private remotePgDS: DataSource | null = null;
	private app: any = null;
	private dryRun = false;
	private verbose = false;
	private onlyKeys: Set<string> = new Set();
	private stats: FetchStat[] = [];

	async initialize(pgUrl?: string): Promise<void> {
		console.log('\n🔧 Initializing connections...\n');

		// Initialize NestJS app for local PostgreSQL
		this.app = await NestFactory.createApplicationContext(AppModule, { logger: false });
		this.localPgDS = this.app.get(DataSource);
		console.log('✅ Local PostgreSQL connected (via NestJS)');

		// Connect to remote PostgreSQL
		this.remotePgDS = await this.connectRemotePg(pgUrl);
		console.log('\n📥 Direction: Remote PostgreSQL → Local PostgreSQL\n');
	}

	private async connectRemotePg(pgUrl?: string): Promise<DataSource> {
		let host: string, port: number, username: string, password: string, database: string;

		if (pgUrl) {
			// Use provided URL
			const url = new URL(pgUrl);
			host = url.hostname;
			port = parseInt(url.port || '5432', 10);
			username = url.username;
			password = url.password;
			database = url.pathname.slice(1);
		} else {
			// Use environment variables
			const envHost = process.env.REMOTE_PG_DB_HOST || '';
			
			// Check if envHost is a full connection string
			if (envHost.startsWith('postgresql://') || envHost.startsWith('postgres://')) {
				const url = new URL(envHost);
				host = url.hostname;
				port = url.port ? parseInt(url.port, 10) : 5432;
				username = url.username || process.env.REMOTE_PG_DB_USERNAME || '';
				password = url.password || process.env.REMOTE_PG_DB_PASSWORD || '';
				database = url.pathname?.slice(1) || process.env.REMOTE_PG_DB_NAME || '';
			} else {
				host = envHost;
				port = parseInt(process.env.REMOTE_PG_DB_PORT || '5432', 10);
				username = process.env.REMOTE_PG_DB_USERNAME || '';
				password = process.env.REMOTE_PG_DB_PASSWORD || '';
				database = process.env.REMOTE_PG_DB_NAME || '';
			}
		}

		if (!host || !username || !password || !database) {
			console.error('\n❌ Missing remote PostgreSQL configuration.');
			console.error('   Use --pg-url or set the following environment variables:');
			console.error('   REMOTE_PG_DB_HOST (can be full connection string or hostname)');
			console.error('   REMOTE_PG_DB_PORT, REMOTE_PG_DB_USERNAME, REMOTE_PG_DB_PASSWORD, REMOTE_PG_DB_NAME');
			throw new Error('Missing remote PG config');
		}

		// Determine if SSL should be enabled
		const isLocal = host === 'localhost' || host === '127.0.0.1' || 
			host.startsWith('192.168.') || host.startsWith('10.');
		const isRender = host.includes('dpg-') || host.includes('render.com') || host.includes('oregon');
		const enableSSL = isRender && !isLocal;

		console.log(`🔗 Connecting to remote PG: ${host}:${port}/${database}`);
		console.log(`   SSL: ${enableSSL ? 'enabled' : 'disabled'}`);

		const ds = new DataSource({
			type: 'postgres',
			host,
			port,
			username,
			password,
			database,
			entities: [], // No entities needed - using raw SQL queries
			synchronize: false,
			logging: false,
			extra: { 
				ssl: enableSSL ? { rejectUnauthorized: false } : false,
				max: 10, // Connection pool size
			},
		});

		await ds.initialize();
		console.log('✅ Remote PostgreSQL connected');
		return ds;
	}

	async fetch(options: ScriptArguments): Promise<void> {
		this.dryRun = options['dry-run'] || false;
		this.verbose = options.verbose || false;
		
		if (options.only) {
			this.onlyKeys = new Set(options.only.split(',').map(e => e.trim().toLowerCase()));
		}

		console.log('═'.repeat(60));
		console.log('  FETCHING DATA FROM REMOTE DATABASE');
		console.log('  (Orgs, Branches, Users, Devices, Licenses)');
		console.log('═'.repeat(60));
		
		if (this.dryRun) {
			console.log('\n🔍 DRY RUN - No data will be written\n');
		}

		const startTime = Date.now();

		// Fetch tables in order (respecting dependencies)
		for (const config of PG_TABLES) {
			if (this.onlyKeys.size > 0 && !this.onlyKeys.has(config.key)) {
				if (this.verbose) console.log(`⏭️  Skipping ${config.name}`);
				continue;
			}
			await this.fetchTable(config);
		}

		this.printSummary(((Date.now() - startTime) / 1000).toFixed(2));
	}

	private async fetchTable(config: TableConfig): Promise<void> {
		const start = Date.now();
		console.log(`\n📦 ${config.name}`);

		try {
			// Check if table exists in remote and get count
			let remoteCount = 0;
			try {
				const countResult = await this.remotePgDS!.query(
					`SELECT COUNT(*) as count FROM "${config.table}"`
				);
				remoteCount = parseInt(countResult[0]?.count || '0', 10);
			} catch (e: any) {
				if (e.message?.includes('does not exist') || e.message?.includes('relation')) {
					console.log(`  ⏭️  Remote table doesn't exist - skipping`);
					this.stats.push({ entity: config.name, remote: 0, fetched: 0, errors: 0, duration: 0 });
					return;
				}
				throw e;
			}

			console.log(`  📊 Remote source: ${remoteCount} records`);

			if (remoteCount === 0) {
				this.stats.push({ entity: config.name, remote: remoteCount, fetched: 0, errors: 0, duration: 0 });
				return;
			}

			if (this.dryRun) {
				console.log(`  🔍 Would fetch ${remoteCount} records`);
				this.stats.push({ entity: config.name, remote: remoteCount, fetched: 0, errors: 0, duration: 0 });
				return;
			}

			// Clear local table
			await this.clearLocalTable(config.table);

			// Disable foreign key checks for user-related tables
			const tablesNeedingFKDisable = new Set([
				'users', 'user_profile', 'user_employeement_profile', 'user_target',
				'branch', 'device', 'licenses'
			]);
			const shouldDisableFK = tablesNeedingFKDisable.has(config.table);
			
			if (shouldDisableFK) {
				await this.disableForeignKeyChecks();
			}

			// Fetch all records from remote
			const records = await this.remotePgDS!.query(`SELECT * FROM "${config.table}"`);
			let fetched = 0;
			let errors = 0;

			// Insert records in batches
			for (let i = 0; i < records.length; i += BATCH_SIZE) {
				const batch = records.slice(i, i + BATCH_SIZE);
				try {
					await this.insertBatch(config.table, batch);
					fetched += batch.length;
					
					// Progress indicator for large datasets
					if (records.length > 100 && (i + BATCH_SIZE) % 500 === 0) {
						console.log(`  📥 Progress: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
					}
				} catch (e: any) {
					// Try inserting one by one on batch failure
					for (const record of batch) {
						try {
							await this.insertRecord(config.table, record);
							fetched++;
						} catch (recError: any) {
							errors++;
							if (this.verbose || errors <= 3) {
								console.error(`  ❌ Record error: ${recError.message?.substring(0, 100)}`);
							}
						}
					}
				}
			}

			// Re-enable foreign key checks
			if (shouldDisableFK) {
				await this.enableForeignKeyChecks();
			}

			// Reset sequence
			await this.resetSequence(config.table, config.pk);

			const duration = Date.now() - start;
			console.log(`  ✅ Fetched: ${fetched} | Errors: ${errors} | ${duration}ms`);
			this.stats.push({ entity: config.name, remote: remoteCount, fetched, errors, duration });

		} catch (e: any) {
			await this.enableForeignKeyChecks();
			console.error(`  ❌ Failed: ${e.message}`);
			this.stats.push({ entity: config.name, remote: 0, fetched: 0, errors: 1, duration: Date.now() - start });
		}
	}

	private async clearLocalTable(table: string): Promise<void> {
		try {
			await this.localPgDS!.query('SET session_replication_role = replica');
			await this.localPgDS!.query(`TRUNCATE TABLE "${table}" CASCADE`);
			await this.localPgDS!.query('SET session_replication_role = DEFAULT');
			if (this.verbose) console.log(`  🗑️  Cleared local table`);
		} catch {
			try {
				await this.localPgDS!.query(`DELETE FROM "${table}"`);
			} catch {}
		}
	}

	private async disableForeignKeyChecks(): Promise<void> {
		try {
			await this.localPgDS!.query('SET session_replication_role = replica');
			if (this.verbose) console.log('  🔓 Foreign key checks disabled');
		} catch (e: any) {
			if (this.verbose) console.log(`  ⚠️ Could not disable FK checks: ${e.message}`);
		}
	}

	private async enableForeignKeyChecks(): Promise<void> {
		try {
			await this.localPgDS!.query('SET session_replication_role = DEFAULT');
			if (this.verbose) console.log('  🔒 Foreign key checks re-enabled');
		} catch (e: any) {
			if (this.verbose) console.log(`  ⚠️ Could not re-enable FK checks: ${e.message}`);
		}
	}

	private async insertBatch(table: string, records: any[]): Promise<void> {
		if (records.length === 0) return;

		const columns = Object.keys(records[0]);
		const columnList = columns.map(c => `"${c}"`).join(', ');
		const values: any[] = [];
		const placeholders: string[] = [];

		records.forEach((record, ri) => {
			const row: string[] = [];
			columns.forEach((col, ci) => {
				row.push(`$${ri * columns.length + ci + 1}`);
				values.push(record[col]);
			});
			placeholders.push(`(${row.join(', ')})`);
		});

		await this.localPgDS!.query(
			`INSERT INTO "${table}" (${columnList}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
			values
		);
	}

	private async insertRecord(table: string, record: any): Promise<void> {
		const columns = Object.keys(record);
		if (columns.length === 0) return;

		const columnList = columns.map(c => `"${c}"`).join(', ');
		const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
		const values = columns.map(c => record[c]);

		await this.localPgDS!.query(
			`INSERT INTO "${table}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
			values
		);
	}

	private async resetSequence(table: string, pk: string): Promise<void> {
		try {
			await this.localPgDS!.query(`
				SELECT setval(pg_get_serial_sequence('"${table}"', '${pk}'), 
				COALESCE((SELECT MAX("${pk}") FROM "${table}"), 1))
			`);
		} catch {}
	}

	private printSummary(duration: string): void {
		console.log('\n' + '═'.repeat(60));
		console.log('  FETCH SUMMARY');
		console.log('═'.repeat(60) + '\n');

		let total = { remote: 0, fetched: 0, errors: 0 };
		console.log('Entity                    Remote    Fetched     Errors');
		console.log('─'.repeat(55));

		for (const s of this.stats) {
			console.log(
				`${s.entity.padEnd(24)} ${String(s.remote).padStart(6)}    ${String(s.fetched).padStart(7)}    ${String(s.errors).padStart(6)}`
			);
			total.remote += s.remote;
			total.fetched += s.fetched;
			total.errors += s.errors;
		}

		console.log('─'.repeat(55));
		console.log(
			`${'TOTAL'.padEnd(24)} ${String(total.remote).padStart(6)}    ${String(total.fetched).padStart(7)}    ${String(total.errors).padStart(6)}`
		);
		console.log(`\n⏱️  Duration: ${duration}s`);
		
		if (this.dryRun) {
			console.log('\n🔍 This was a DRY RUN - no data was written');
		} else if (total.errors > 0) {
			console.log(`\n⚠️  ${total.errors} errors occurred`);
		} else {
			console.log('\n✅ Fetch completed successfully!');
		}
	}

	async cleanup(): Promise<void> {
		if (this.remotePgDS?.isInitialized) {
			try { await this.remotePgDS.destroy(); } catch {}
		}
		if (this.app) {
			try { await this.app.close(); } catch {}
		}
	}
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const argv = yargs(hideBin(process.argv))
		.options({
			'pg-url': { 
				type: 'string', 
				describe: 'Remote PostgreSQL URL (overrides env vars)' 
			},
			'dry-run': { 
				type: 'boolean', 
				default: false, 
				describe: 'Preview without writing data' 
			},
			only: { 
				type: 'string', 
				describe: 'Only fetch: orgs,users,devices,licenses,branches' 
			},
			verbose: { 
				type: 'boolean', 
				default: false, 
				describe: 'Detailed output' 
			},
		})
		.example('$0', 'Fetch all tables from remote')
		.example('$0 --dry-run', 'Preview what would be fetched')
		.example('$0 --only orgs,users', 'Fetch only orgs and users')
		.example('$0 --pg-url postgresql://user:pass@host:5432/db', 'Use custom connection')
		.help()
		.parseSync() as ScriptArguments;

	const fetcher = new RemoteDataFetcher();

	try {
		await fetcher.initialize(argv['pg-url']);
		await fetcher.fetch(argv);
	} catch (error) {
		console.error('\n❌ Fetch failed:', error);
		process.exit(1);
	} finally {
		await fetcher.cleanup();
	}
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
