#!/usr/bin/env node

/**
 * Database Migration Script - Essential Setup Data Only
 * 
 * Migrates ONLY key configuration data needed to set up the app:
 * - Organisations (with settings, appearance, work hours)
 * - Branches
 * - Users (with profiles, employment, targets, managedDoors, managedBranches, managedStaff)
 * - Devices (IoT - no historical records/logs)
 * - Licenses
 * 
 * NO historical data (attendance, tracking, claims, tasks, device_records, etc.)
 * 
 * Usage:
 *   # MySQL → Local PostgreSQL (remote-to-local)
 *   npm run migrate:legacy-db -- --step remote-to-local
 *   
 *   # Local PostgreSQL → Remote PostgreSQL (local-to-remote)
 *   npm run migrate:legacy-db -- --step local-to-remote
 *   npm run migrate:legacy-db -- --step local-to-remote --pg-url postgresql://user:pass@host:port/dbname
 *   
 *   # Dry run (preview only)
 *   npm run migrate:legacy-db -- --step remote-to-local --dry-run
 *   
 *   # Migrate specific entities only
 *   npm run migrate:legacy-db -- --step local-to-remote --only orgs,users,devices
 */

import * as mysql from 'mysql2/promise';
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
	step: 'local-to-remote' | 'remote-to-local';
}

interface MigrationStat {
	entity: string;
	source: number;
	migrated: number;
	errors: number;
	duration: number;
}

interface TableConfig {
	key: string;
	mysql: string;
	pg: string;
	name: string;
	pk: string;
	optional?: boolean; // Table may not exist in MySQL
}

// Entity config for PostgreSQL migrations
const PG_ENTITIES = [
	{ key: 'orgs', entity: Organisation, name: 'Organisations', table: 'organisation', pk: 'uid' },
	{ key: 'orgs', entity: OrganisationSettings, name: 'Org Settings', table: 'organisation_settings', pk: 'uid' },
	{ key: 'orgs', entity: OrganisationAppearance, name: 'Org Appearance', table: 'organisation_appearance', pk: 'uid' },
	{ key: 'orgs', entity: OrganisationHours, name: 'Org Hours', table: 'organisation_hours', pk: 'uid' },
	{ key: 'branches', entity: Branch, name: 'Branches', table: 'branch', pk: 'uid' },
	{ key: 'users', entity: User, name: 'Users', table: 'users', pk: 'uid' },
	{ key: 'users', entity: UserProfile, name: 'User Profiles', table: 'user_profile', pk: 'uid' },
	{ key: 'users', entity: UserEmployeementProfile, name: 'Employment Profiles', table: 'user_employeement_profile', pk: 'uid' },
	{ key: 'users', entity: UserTarget, name: 'User Targets', table: 'user_target', pk: 'uid' },
	{ key: 'devices', entity: Device, name: 'Devices', table: 'device', pk: 'id' },
	{ key: 'licenses', entity: License, name: 'Licenses', table: 'licenses', pk: 'uid' },
];

// MySQL table mappings for remote-to-local
const MYSQL_TABLES: TableConfig[] = [
	{ key: 'orgs', mysql: 'organisation', pg: 'organisation', name: 'Organisations', pk: 'uid' },
	{ key: 'orgs', mysql: 'organisation_settings', pg: 'organisation_settings', name: 'Org Settings', pk: 'uid' },
	{ key: 'orgs', mysql: 'organisation_appearance', pg: 'organisation_appearance', name: 'Org Appearance', pk: 'uid' },
	{ key: 'orgs', mysql: 'organisation_hours', pg: 'organisation_hours', name: 'Org Hours', pk: 'uid' },
	{ key: 'branches', mysql: 'branch', pg: 'branch', name: 'Branches', pk: 'uid' },
	{ key: 'users', mysql: 'users', pg: 'users', name: 'Users', pk: 'uid' },
	{ key: 'users', mysql: 'user_profile', pg: 'user_profile', name: 'User Profiles', pk: 'uid', optional: true },
	{ key: 'users', mysql: 'user_employeement_profile', pg: 'user_employeement_profile', name: 'Employment Profiles', pk: 'uid', optional: true },
	{ key: 'users', mysql: 'user_target', pg: 'user_target', name: 'User Targets', pk: 'uid', optional: true },
	{ key: 'devices', mysql: 'device', pg: 'device', name: 'Devices', pk: 'id' },
	{ key: 'licenses', mysql: 'licenses', pg: 'licenses', name: 'Licenses', pk: 'uid', optional: false },
];

const BATCH_SIZE = 100; // Smaller batch for better error isolation

// ============================================================================
// Migrator Class
// ============================================================================

class SetupDataMigrator {
	private mysqlConn: mysql.Connection | null = null;
	private localPgDS: DataSource | null = null;
	private remotePgDS: DataSource | null = null;
	private app: any = null;
	private dryRun = false;
	private verbose = false;
	private onlyKeys: Set<string> = new Set();
	private stats: MigrationStat[] = [];
	private pgColumnCache: Map<string, Set<string>> = new Map();

	async initialize(step: 'local-to-remote' | 'remote-to-local', pgUrl?: string): Promise<void> {
		console.log('\n🔧 Initializing connections...\n');

		// Always init NestJS app for local PostgreSQL
		this.app = await NestFactory.createApplicationContext(AppModule, { logger: false });
		this.localPgDS = this.app.get(DataSource);

		if (step === 'remote-to-local') {
			// MySQL → Local PostgreSQL
			await this.connectMySQL();
			await this.loadPgSchema(); // Load PostgreSQL column info
			console.log('📥 Direction: MySQL (remote) → PostgreSQL (local)\n');
		} else {
			// Local PostgreSQL → Remote PostgreSQL
			this.remotePgDS = await this.connectRemotePg(pgUrl);
			console.log('📤 Direction: PostgreSQL (local) → PostgreSQL (remote)\n');
		}
	}

	private async loadPgSchema(): Promise<void> {
		console.log('📋 Loading PostgreSQL schema...');
		const tables = MYSQL_TABLES.map(t => t.pg);
		
		for (const table of tables) {
			try {
				const result = await this.localPgDS!.query(`
					SELECT column_name 
					FROM information_schema.columns 
					WHERE table_name = $1 AND table_schema = 'public'
				`, [table]);
				
				const columns = new Set<string>(result.map((r: any) => r.column_name));
				this.pgColumnCache.set(table, columns);
				if (this.verbose) {
					console.log(`  ${table}: ${columns.size} columns`);
				}
			} catch (e) {
				console.log(`  ⚠️ Could not load schema for ${table}`);
			}
		}
		console.log('✅ Schema loaded\n');
	}

	private async connectMySQL(): Promise<void> {
		const host = process.env.DATABASE_HOST;
		const port = parseInt(process.env.DATABASE_PORT || '3306', 10);
		const user = process.env.DATABASE_USER;
		const password = process.env.DATABASE_PASSWORD;
		const database = process.env.DATABASE_NAME;

		if (!host || !user || !password || !database) {
			throw new Error('Missing MySQL config. Set DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME');
		}

		console.log(`🔗 Connecting to MySQL: ${host}:${port}/${database}`);
		this.mysqlConn = await mysql.createConnection({
			host, port, user, password, database,
			connectTimeout: 60000,
		});
		console.log('✅ MySQL connected');
	}

	private async connectRemotePg(pgUrl?: string): Promise<DataSource> {
		let host: string, port: number, username: string, password: string, database: string;

		if (pgUrl) {
			const url = new URL(pgUrl);
			host = url.hostname;
			port = parseInt(url.port || '5432', 10);
			username = url.username;
			password = url.password;
			database = url.pathname.slice(1);
		} else {
			const envHost = process.env.REMOTE_PG_DB_HOST || '';
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
			throw new Error('Missing remote PG config. Use --pg-url or set REMOTE_PG_DB_* env vars');
		}

		const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.');
		console.log(`🔗 Connecting to remote PG: ${host}:${port}/${database} (SSL: ${!isLocal})`);

		const ds = new DataSource({
			type: 'postgres',
			host, port, username, password, database,
			entities: PG_ENTITIES.map(e => e.entity),
			synchronize: false,
			logging: false,
			extra: { ssl: isLocal ? false : { rejectUnauthorized: false } },
		});

		await ds.initialize();
		console.log('✅ Remote PostgreSQL connected');
		return ds;
	}

	async migrate(options: ScriptArguments): Promise<void> {
		this.dryRun = options['dry-run'] || false;
		this.verbose = options.verbose || false;
		if (options.only) {
			this.onlyKeys = new Set(options.only.split(',').map(e => e.trim().toLowerCase()));
		}

		console.log('═'.repeat(60));
		console.log('  MIGRATING ESSENTIAL SETUP DATA');
		console.log('  (Orgs, Users, Devices, Licenses - NO historical data)');
		console.log('═'.repeat(60));
		if (this.dryRun) console.log('\n🔍 DRY RUN - No data will be written\n');

		const startTime = Date.now();

		if (options.step === 'remote-to-local') {
			await this.migrateFromMySQL();
		} else {
			await this.migratePostgres();
		}

		this.printSummary(((Date.now() - startTime) / 1000).toFixed(2));
	}

	// =========================================================================
	// MySQL → PostgreSQL Migration
	// =========================================================================

	private async migrateFromMySQL(): Promise<void> {
		for (const config of MYSQL_TABLES) {
			if (this.onlyKeys.size > 0 && !this.onlyKeys.has(config.key)) {
				if (this.verbose) console.log(`⏭️  Skipping ${config.name}`);
				continue;
			}
			await this.migrateTableFromMySQL(config);
		}
	}

	private async migrateTableFromMySQL(config: TableConfig): Promise<void> {
		const start = Date.now();
		console.log(`\n📦 ${config.name}`);

		// Tables that need foreign key checks disabled (have FK constraints)
		const tablesNeedingFKDisable = new Set(['users', 'user_profile', 'user_employeement_profile', 'user_target']);

		try {
			// Check if MySQL table exists
			let sourceCount = 0;
			try {
				const [countRows] = await this.mysqlConn!.query(`SELECT COUNT(*) as count FROM \`${config.mysql}\``) as any[];
				sourceCount = countRows[0]?.count || 0;
			} catch (e: any) {
				if (e.code === 'ER_NO_SUCH_TABLE' || e.message?.includes("doesn't exist")) {
					console.log(`  ⏭️  MySQL table doesn't exist - skipping`);
					this.stats.push({ entity: config.name, source: 0, migrated: 0, errors: 0, duration: 0 });
					return;
				}
				throw e;
			}

			console.log(`  📊 MySQL source: ${sourceCount} records`);

			if (sourceCount === 0 || this.dryRun) {
				this.stats.push({ entity: config.name, source: sourceCount, migrated: 0, errors: 0, duration: 0 });
				return;
			}

			// Get target PostgreSQL columns
			const pgColumns = this.pgColumnCache.get(config.pg);
			if (!pgColumns || pgColumns.size === 0) {
				console.log(`  ⚠️  No PostgreSQL columns found for ${config.pg}`);
				this.stats.push({ entity: config.name, source: sourceCount, migrated: 0, errors: 1, duration: 0 });
				return;
			}

			// Clear target PostgreSQL table
			await this.clearPgTable(config.pg);

			// Disable FK checks for tables that have foreign key constraints
			const shouldDisableFK = tablesNeedingFKDisable.has(config.pg);
			if (shouldDisableFK) {
				await this.disableForeignKeyChecks();
			}

			// Fetch from MySQL
			const [records] = await this.mysqlConn!.query(`SELECT * FROM \`${config.mysql}\``) as any[];
			let migrated = 0, errors = 0;

			// Insert one by one for better error handling
			for (let i = 0; i < records.length; i++) {
				try {
					const record = records[i];
					const mapped = this.mapMySQLToPg(record, pgColumns, config);
					await this.insertRecordToPg(config.pg, mapped);
					migrated++;
				} catch (e: any) {
					errors++;
					if (this.verbose || errors <= 3) {
						console.error(`  ❌ Row ${i + 1}: ${e.message}`);
					}
				}
			}

			// Re-enable FK checks if we disabled them
			if (shouldDisableFK) {
				await this.enableForeignKeyChecks();
			}

			// Reset sequence
			await this.resetSequence(config.pg, config.pk);

			const duration = Date.now() - start;
			console.log(`  ✅ Migrated: ${migrated} | Errors: ${errors} | ${duration}ms`);
			this.stats.push({ entity: config.name, source: sourceCount, migrated, errors, duration });

		} catch (e: any) {
			// Make sure to re-enable FK checks on error
			await this.enableForeignKeyChecks();
			console.error(`  ❌ Failed: ${e.message}`);
			this.stats.push({ entity: config.name, source: 0, migrated: 0, errors: 1, duration: Date.now() - start });
		}
	}

	/**
	 * Map MySQL record to PostgreSQL columns, filtering out non-existent columns
	 */
	private mapMySQLToPg(record: any, pgColumns: Set<string>, config: TableConfig): Record<string, any> {
		const mapped: Record<string, any> = {};

		// Known JSON columns that need special handling
		const jsonColumns = new Set([
			'managedBranches', 'managedStaff', 'assignedClientIds', 
			'preferences', 'managedDoors', 'features', 'metadata',
			'settings', 'config', 'data', 'options'
		]);

		for (const [key, value] of Object.entries(record)) {
			// Check if column exists in PostgreSQL (case-insensitive check)
			const pgCol = Array.from(pgColumns).find(c => c.toLowerCase() === key.toLowerCase());
			
			if (pgCol) {
				let finalValue = value;

				// Handle JSON columns - MySQL might return strings or invalid values
				const isJsonColumn = jsonColumns.has(key) || jsonColumns.has(pgCol);
				
				if (isJsonColumn) {
					finalValue = this.sanitizeJsonValue(value, key);
				} else if (value !== null && value !== undefined) {
					// Check if the value looks like it should be JSON
					if (typeof value === 'string') {
						const trimmed = value.trim();
						if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
							finalValue = this.sanitizeJsonValue(value, key);
						}
					} else if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
						// Objects that aren't dates or buffers - sanitize as JSON
						finalValue = this.sanitizeJsonValue(value, key);
					}
				}

				// Handle time-only values for timestamp columns (e.g., "07:30:00" -> full timestamp)
				// These come from MySQL TIME columns being inserted into PostgreSQL timestamptz
				if (typeof value === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(value)) {
					// Convert time-only to a full timestamp using today's date
					const today = new Date().toISOString().split('T')[0];
					finalValue = new Date(`${today}T${value}`);
				}

				// Handle dates
				if (value instanceof Date) {
					finalValue = value;
				}

				// Handle Buffer objects (MySQL binary data) - convert to null or appropriate format
				if (Buffer.isBuffer(value)) {
					// For JSON columns, set to null; for other columns, try to convert to string
					finalValue = isJsonColumn ? null : value.toString('utf8');
				}

				mapped[pgCol] = finalValue;
			}
		}

		return mapped;
	}

	/**
	 * Sanitize a value for JSON column insertion in PostgreSQL
	 */
	private sanitizeJsonValue(value: any, columnName: string): any {
		// Handle null/undefined
		if (value === null || value === undefined) {
			return null;
		}

		// Handle string values
		if (typeof value === 'string') {
			const trimmed = value.trim();
			
			// Handle empty strings, "null", or whitespace-only strings
			if (trimmed === '' || trimmed.toLowerCase() === 'null') {
				return null;
			}
			
			// Handle empty arrays/objects
			if (trimmed === '[]') return [];
			if (trimmed === '{}') return {};
			
			// Try to parse JSON strings
			if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
				try {
					return JSON.parse(trimmed);
				} catch {
					if (this.verbose) {
						console.log(`    ⚠️ Invalid JSON in ${columnName}, setting to null`);
					}
					return null;
				}
			}
			
			// For non-JSON strings in a JSON column, set to null
			if (this.verbose) {
				console.log(`    ⚠️ Non-JSON value in JSON column ${columnName}, setting to null`);
			}
			return null;
		}

		// Handle objects (including arrays)
		if (typeof value === 'object') {
			// Already an object/array, but validate it's proper JSON by round-tripping
			try {
				JSON.stringify(value);
				return value;
			} catch {
				if (this.verbose) {
					console.log(`    ⚠️ Non-serializable object in ${columnName}, setting to null`);
				}
				return null;
			}
		}

		// Handle numbers, booleans - wrap in JSON-compatible format or set to null
		if (typeof value === 'number' || typeof value === 'boolean') {
			// These are valid JSON values, but as column values they might cause issues
			// Return as-is and let PostgreSQL handle it
			return value;
		}

		// Fallback - unknown type, set to null
		return null;
	}

	private async insertRecordToPg(table: string, record: Record<string, any>): Promise<void> {
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

	// =========================================================================
	// PostgreSQL → PostgreSQL Migration
	// =========================================================================

	private async migratePostgres(): Promise<void> {
		for (const config of PG_ENTITIES) {
			if (this.onlyKeys.size > 0 && !this.onlyKeys.has(config.key)) {
				if (this.verbose) console.log(`⏭️  Skipping ${config.name}`);
				continue;
			}
			await this.migrateTablePostgres(config);
		}
	}

	private async migrateTablePostgres(config: typeof PG_ENTITIES[0]): Promise<void> {
		const start = Date.now();
		console.log(`\n📦 ${config.name}`);

		try {
			// Get source count
			let sourceCount = 0;
			try {
				const countResult = await this.localPgDS!.query(`SELECT COUNT(*) as count FROM "${config.table}"`);
				sourceCount = parseInt(countResult[0]?.count || '0', 10);
			} catch {
				console.log(`  ⚠️  Table not found in source`);
				this.stats.push({ entity: config.name, source: 0, migrated: 0, errors: 0, duration: 0 });
				return;
			}

			console.log(`  📊 Local PG source: ${sourceCount} records`);

			if (sourceCount === 0 || this.dryRun) {
				this.stats.push({ entity: config.name, source: sourceCount, migrated: 0, errors: 0, duration: 0 });
				return;
			}

			// Clear target (remote) table
			await this.clearRemotePgTable(config.table);

			// Fetch and insert in batches
			const records = await this.localPgDS!.query(`SELECT * FROM "${config.table}"`);
			let migrated = 0, errors = 0;

			for (let i = 0; i < records.length; i += BATCH_SIZE) {
				const batch = records.slice(i, i + BATCH_SIZE);
				try {
					await this.insertBatchToRemotePg(config.table, batch);
					migrated += batch.length;
				} catch (e: any) {
					errors += batch.length;
					if (this.verbose) console.error(`  ❌ Batch error: ${e.message}`);
				}
			}

			// Reset sequence on remote
			await this.resetRemoteSequence(config.table, config.pk);

			const duration = Date.now() - start;
			console.log(`  ✅ Migrated: ${migrated} | Errors: ${errors} | ${duration}ms`);
			this.stats.push({ entity: config.name, source: sourceCount, migrated, errors, duration });

		} catch (e: any) {
			console.error(`  ❌ Failed: ${e.message}`);
			this.stats.push({ entity: config.name, source: 0, migrated: 0, errors: 1, duration: Date.now() - start });
		}
	}

	// =========================================================================
	// Helper Methods
	// =========================================================================

	private async clearPgTable(table: string): Promise<void> {
		try {
			await this.localPgDS!.query('SET session_replication_role = replica');
			await this.localPgDS!.query(`TRUNCATE TABLE "${table}" CASCADE`);
			await this.localPgDS!.query('SET session_replication_role = DEFAULT');
		} catch {
			try { await this.localPgDS!.query(`DELETE FROM "${table}"`); } catch {}
		}
	}

	/**
	 * Disable foreign key checks for the current session
	 */
	private async disableForeignKeyChecks(): Promise<void> {
		try {
			await this.localPgDS!.query('SET session_replication_role = replica');
			if (this.verbose) console.log('  🔓 Foreign key checks disabled');
		} catch (e: any) {
			console.log(`  ⚠️ Could not disable FK checks: ${e.message}`);
		}
	}

	/**
	 * Re-enable foreign key checks
	 */
	private async enableForeignKeyChecks(): Promise<void> {
		try {
			await this.localPgDS!.query('SET session_replication_role = DEFAULT');
			if (this.verbose) console.log('  🔒 Foreign key checks re-enabled');
		} catch (e: any) {
			console.log(`  ⚠️ Could not re-enable FK checks: ${e.message}`);
		}
	}

	private async clearRemotePgTable(table: string): Promise<void> {
		try {
			await this.remotePgDS!.query('SET session_replication_role = replica');
			await this.remotePgDS!.query(`TRUNCATE TABLE "${table}" CASCADE`);
			await this.remotePgDS!.query('SET session_replication_role = DEFAULT');
		} catch {
			try { await this.remotePgDS!.query(`DELETE FROM "${table}"`); } catch {}
		}
	}

	private async insertBatchToRemotePg(table: string, records: any[]): Promise<void> {
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

		await this.remotePgDS!.query(
			`INSERT INTO "${table}" (${columnList}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
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

	private async resetRemoteSequence(table: string, pk: string): Promise<void> {
		try {
			await this.remotePgDS!.query(`
				SELECT setval(pg_get_serial_sequence('"${table}"', '${pk}'), 
				COALESCE((SELECT MAX("${pk}") FROM "${table}"), 1))
			`);
		} catch {}
	}

	private printSummary(duration: string): void {
		console.log('\n' + '═'.repeat(60));
		console.log('  MIGRATION SUMMARY');
		console.log('═'.repeat(60) + '\n');

		let total = { source: 0, migrated: 0, errors: 0 };
		console.log('Entity                    Source    Migrated    Errors');
		console.log('─'.repeat(55));

		for (const s of this.stats) {
			console.log(`${s.entity.padEnd(24)} ${String(s.source).padStart(6)}    ${String(s.migrated).padStart(8)}    ${String(s.errors).padStart(6)}`);
			total.source += s.source;
			total.migrated += s.migrated;
			total.errors += s.errors;
		}

		console.log('─'.repeat(55));
		console.log(`${'TOTAL'.padEnd(24)} ${String(total.source).padStart(6)}    ${String(total.migrated).padStart(8)}    ${String(total.errors).padStart(6)}`);
		console.log(`\n⏱️  Duration: ${duration}s`);
		console.log(total.errors > 0 ? `\n⚠️  ${total.errors} errors occurred` : '\n✅ Migration completed successfully!');
	}

	async cleanup(): Promise<void> {
		if (this.mysqlConn) {
			try { await this.mysqlConn.end(); } catch {}
		}
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
			'pg-url': { type: 'string', describe: 'Remote PostgreSQL URL (for local-to-remote)' },
			step: {
				type: 'string',
				choices: ['local-to-remote', 'remote-to-local'] as const,
				demandOption: true,
				describe: 'remote-to-local: MySQL→PG | local-to-remote: PG→PG',
			},
			'dry-run': { type: 'boolean', default: false, describe: 'Preview without writing' },
			only: { type: 'string', describe: 'Only migrate: orgs,users,devices,licenses,branches' },
			verbose: { type: 'boolean', default: false, describe: 'Detailed output' },
		})
		.help()
		.parseSync() as ScriptArguments;

	const migrator = new SetupDataMigrator();

	try {
		await migrator.initialize(argv.step, argv['pg-url']);
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
