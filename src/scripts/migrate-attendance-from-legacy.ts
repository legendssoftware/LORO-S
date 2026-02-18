#!/usr/bin/env node

/**
 * Migrate attendance from legacy (old) DB to new DB for a single user.
 * Run one user at a time by --clerk-user-id. Never runs all users.
 *
 * Legacy org ref mapping (old DB): ref "1" = Legend org in new DB, ref "2" = Bit.
 * Optional env: OLD_ORG_REF_1_CLERK_ORG_ID, OLD_ORG_REF_2_CLERK_ORG_ID to override name-based lookup.
 *
 * Usage:
 *   npm run migrate:attendance-from-legacy -- --clerk-user-id=user_2abc...
 *   npm run migrate:attendance-from-legacy -- --clerk-user-id=user_2abc... --dry-run
 *   npm run migrate:attendance-from-legacy -- --clerk-user-id=user_2abc... --verbose
 *
 * Env (new DB = app default PG_* / DATABASE_*):
 *   PG_DB_HOST, PG_DB_PORT, PG_DB_USERNAME, PG_DB_PASSWORD, PG_DB_NAME
 *
 * Env (old/legacy DB) — use one of:
 *   OLD_PG_DB_URL = postgresql://user:pass@host:port/dbname   (recommended; full URL)
 *   Or OLD_PG_DB_HOST=... & OLD_PG_DB_PORT=5432 & OLD_PG_DB_USERNAME=... & OLD_PG_DB_PASSWORD=... & OLD_PG_DB_NAME=...
 *   If OLD_PG_DB_HOST is set to a full postgresql:// URL, it is parsed automatically.
 */

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { Attendance } from '../attendance/entities/attendance.entity';
import { AttendanceStatus } from '../lib/enums/attendance.enums';

const LEGACY_ORG_REF_LEGEND = '1';
const LEGACY_ORG_REF_BIT = '2';

interface CliArgs {
	clerkUserId: string;
	dryRun: boolean;
	batchSize: number;
	verbose: boolean;
}

interface OldDbUser {
	uid: number;
	username: string | null;
	name: string;
	surname: string;
	email: string;
	organisationRef: string | null;
	branchUid: number | null;
}

interface OldDbOrganisation {
	uid: number;
	ref: string;
}

interface OldDbAttendanceRow {
	uid: number;
	status: string;
	checkIn: Date;
	checkOut: Date | null;
	duration: string | null;
	overtime: string | null;
	earlyMinutes: number | null;
	lateMinutes: number | null;
	checkInLatitude: number | null;
	checkInLongitude: number | null;
	checkOutLatitude: number | null;
	checkOutLongitude: number | null;
	placesOfInterest: unknown;
	checkInNotes: string | null;
	checkOutNotes: string | null;
	breakStartTime: Date | null;
	breakEndTime: Date | null;
	totalBreakTime: string | null;
	breakCount: number | null;
	breakDetails: unknown;
	breakLatitude: number | null;
	breakLongitude: number | null;
	breakNotes: string | null;
	distanceTravelledKm: number | null;
	createdAt: Date;
	updatedAt: Date;
	verifiedAt: Date | null;
	ownerUid: number;
	verifiedByUid: number | null;
	organisationUid: number | null;
	branchUid: number | null;
}

async function closeApp(app: { close: () => Promise<void> }): Promise<void> {
	try {
		await app.close();
	} catch {
		// Ignore Nest shutdown errors (e.g. DataSource not in context)
	}
}

function parseArgs(): CliArgs {
	let clerkUserId = '';
	let dryRun = false;
	let batchSize = 300;
	let verbose = false;
	const args = process.argv.slice(2);
	for (const arg of args) {
		if (arg === '--dry-run') dryRun = true;
		else if (arg === '--verbose') verbose = true;
		else if (arg.startsWith('--clerk-user-id=')) clerkUserId = arg.slice('--clerk-user-id='.length).trim();
		else if (arg.startsWith('--batch-size=')) batchSize = parseInt(arg.slice('--batch-size='.length), 10) || 300;
	}
	return { clerkUserId, dryRun, batchSize, verbose };
}

function parsePostgresUrl(url: string): { host: string; port: number; username: string; password: string; database: string } | null {
	if (!url || (!url.startsWith('postgresql://') && !url.startsWith('postgres://'))) return null;
	try {
		const u = new URL(url);
		return {
			host: u.hostname,
			port: parseInt(u.port || '5432', 10),
			username: decodeURIComponent(u.username || ''),
			password: decodeURIComponent(u.password || ''),
			database: u.pathname ? u.pathname.slice(1).replace(/^\/+/, '') : '',
		};
	} catch {
		return null;
	}
}

function getOldDbConfig(): { host: string; port: number; username: string; password: string; database: string } {
	const urlFromEnv = process.env.OLD_PG_DB_URL || process.env.OLD_PG_DB_HOST;
	const parsed = urlFromEnv ? parsePostgresUrl(urlFromEnv) : null;
	if (parsed) return parsed;
	const host = process.env.OLD_PG_DB_HOST || process.env.PG_DB_HOST || 'localhost';
	const port = parseInt(process.env.OLD_PG_DB_PORT || process.env.PG_DB_PORT || '5432', 10);
	const username = process.env.OLD_PG_DB_USERNAME || process.env.PG_DB_USERNAME || '';
	const password = process.env.OLD_PG_DB_PASSWORD || process.env.PG_DB_PASSWORD || '';
	const database = process.env.OLD_PG_DB_NAME || process.env.PG_DB_NAME || '';
	return { host, port, username, password, database };
}

async function createOldDataSource(): Promise<DataSource> {
	const config = getOldDbConfig();
	const isRemote = config.host.includes('render.com') || config.host.includes('dpg-');
	const ds = new DataSource({
		type: 'postgres',
		host: config.host,
		port: config.port,
		username: config.username,
		password: config.password,
		database: config.database,
		entities: [],
		synchronize: false,
		logging: false,
		...(isRemote && { ssl: { rejectUnauthorized: false } }),
	});
	await ds.initialize();
	return ds;
}

/** Resolve Legend and Bit orgs in new DB: ref "1" = Legend, ref "2" = Bit (legacy ref style). Uses name match or env override. */
async function buildLegacyOrgRefToClerkOrgId(
	newDataSource: DataSource,
	verbose: boolean,
): Promise<Map<string, string>> {
	const refToClerk = new Map<string, string>();
	const envRef1 = process.env.OLD_ORG_REF_1_CLERK_ORG_ID;
	const envRef2 = process.env.OLD_ORG_REF_2_CLERK_ORG_ID;
	if (envRef1) refToClerk.set(LEGACY_ORG_REF_LEGEND, envRef1);
	if (envRef2) refToClerk.set(LEGACY_ORG_REF_BIT, envRef2);
	if (refToClerk.size === 2) {
		if (verbose) console.log('  Legacy org mapping from env: ref 1 ->', envRef1, ', ref 2 ->', envRef2);
		return refToClerk;
	}
	const orgRepo = newDataSource.getRepository(Organisation);
	const legend = envRef1 ? null : await orgRepo.createQueryBuilder('o').where('LOWER(o.name) LIKE :name', { name: '%legend%' }).getOne();
	const bit = envRef2 ? null : await orgRepo.createQueryBuilder('o').where('LOWER(o.name) LIKE :name', { name: '%bit%' }).getOne();
	if (legend?.clerkOrgId) refToClerk.set(LEGACY_ORG_REF_LEGEND, legend.clerkOrgId);
	if (bit?.clerkOrgId) refToClerk.set(LEGACY_ORG_REF_BIT, bit.clerkOrgId);
	if (verbose) {
		if (refToClerk.has(LEGACY_ORG_REF_LEGEND)) console.log('  Legacy ref "1" -> Legend:', refToClerk.get(LEGACY_ORG_REF_LEGEND));
		if (refToClerk.has(LEGACY_ORG_REF_BIT)) console.log('  Legacy ref "2" -> Bit:', refToClerk.get(LEGACY_ORG_REF_BIT));
	}
	if (!refToClerk.size) {
		console.warn('  No Legend/Bit orgs found. Set OLD_ORG_REF_1_CLERK_ORG_ID and OLD_ORG_REF_2_CLERK_ORG_ID or ensure org names contain "Legend" and "Bit".');
	}
	return refToClerk;
}

/** Old DB: uid -> ref from organisation table */
async function loadOldOrgUidToRef(oldDataSource: DataSource): Promise<Map<number, string>> {
	const rows = await oldDataSource.query<OldDbOrganisation[]>('SELECT uid, ref FROM organisation');
	const map = new Map<number, string>();
	for (const r of rows) {
		if (r?.ref != null) map.set(Number(r.uid), String(r.ref));
	}
	return map;
}

async function main(): Promise<void> {
	const { clerkUserId, dryRun, batchSize, verbose } = parseArgs();

	if (!clerkUserId) {
		console.error('Missing required --clerk-user-id. Run one user at a time. Example: --clerk-user-id=user_2abc...');
		process.exit(1);
	}

	console.log('Migrate attendance from legacy (single user only)');
	console.log('  clerk-user-id:', clerkUserId);
	console.log('  dry-run:', dryRun);
	console.log('  batch-size:', batchSize);
	console.log('');

	const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
	const newDataSource = app.get(DataSource);

	const newUser = await newDataSource.getRepository(User).findOne({
		where: { clerkUserId, isDeleted: false },
		select: ['uid', 'clerkUserId', 'username', 'name', 'surname', 'email'],
		relations: ['organisation'],
	});
	if (!newUser) {
		console.error('User not found in new DB for clerkUserId:', clerkUserId);
		await closeApp(app);
		process.exit(1);
	}
	const username = (newUser.username ?? '').trim();
	const name = (newUser.name ?? '').trim();
	const surname = (newUser.surname ?? '').trim();
	console.log('New DB user:', newUser.email, name, surname, 'clerkUserId:', newUser.clerkUserId);

	let oldDataSource: DataSource;
	try {
		oldDataSource = await createOldDataSource();
	} catch (e) {
		console.error('Failed to connect to old DB. Set OLD_PG_DB_URL (or OLD_PG_DB_HOST, etc.).', e);
		await closeApp(app);
		process.exit(1);
	}

	const oldUsers = await oldDataSource.query<OldDbUser[]>(
		'SELECT uid, username, name, surname, email, "organisationRef", "branchUid" FROM users WHERE "isDeleted" = false AND LOWER(TRIM(COALESCE(name,\'\'))) = LOWER(TRIM($1)) AND LOWER(TRIM(COALESCE(surname,\'\'))) = LOWER(TRIM($2)) AND (TRIM(COALESCE(username,\'\')) = TRIM(COALESCE($3,\'\')) OR (TRIM(COALESCE(username,\'\')) = \'\' AND TRIM(COALESCE($3,\'\')) = \'\'))',
		[name ?? '', surname ?? '', username ?? ''],
	);
	if (!oldUsers?.length) {
		console.error('No matching user in old DB for name/surname/username:', name, surname, username);
		await oldDataSource.destroy();
		await closeApp(app);
		process.exit(1);
	}
	if (oldUsers.length > 1 && verbose) {
		console.warn('Multiple old users match; using first. uid:', oldUsers[0].uid);
	}
	const oldUser = oldUsers[0];
	const oldUserUid = Number(oldUser.uid);
	console.log('Old DB user matched: uid', oldUserUid, oldUser.email);

	const [refToClerkOrgId, oldOrgUidToRef] = await Promise.all([
		buildLegacyOrgRefToClerkOrgId(newDataSource, verbose),
		loadOldOrgUidToRef(oldDataSource),
	]);
	const oldOrgUidToClerkOrgId = new Map<number, string>();
	for (const [uid, ref] of oldOrgUidToRef) {
		const clerkOrgId = refToClerkOrgId.get(ref);
		if (clerkOrgId) oldOrgUidToClerkOrgId.set(uid, clerkOrgId);
	}

	const oldRows = await oldDataSource.query<OldDbAttendanceRow[]>(
		'SELECT * FROM attendance WHERE "ownerUid" = $1 ORDER BY "checkIn"',
		[oldUserUid],
	);
	console.log('Old attendance rows for this user:', oldRows?.length ?? 0);
	await oldDataSource.destroy();

	if (!oldRows?.length) {
		console.log('Nothing to migrate.');
		await closeApp(app);
		process.exit(0);
	}

	const existingKeys = new Set<string>();
	if (!dryRun) {
		const existing = await newDataSource
			.getRepository(Attendance)
			.find({ where: { ownerClerkUserId: newUser.clerkUserId }, select: ['checkIn'] });
		for (const e of existing) {
			if (e.checkIn) existingKeys.add(`${newUser.clerkUserId}:${new Date(e.checkIn).toISOString()}`);
		}
	}

	const toInsert: Partial<Attendance>[] = [];
	for (const row of oldRows) {
		const checkIn = row.checkIn ? new Date(row.checkIn) : undefined;
		if (!checkIn) continue;
		const key = `${newUser.clerkUserId}:${checkIn.toISOString()}`;
		if (existingKeys.has(key)) continue;

		const orgUid = row.organisationUid != null ? Number(row.organisationUid) : null;
		const organisationUid = orgUid != null ? oldOrgUidToClerkOrgId.get(orgUid) ?? null : null;
		if (!organisationUid) {
			if (verbose) console.warn('  Skip row uid', row.uid, ': no org mapping for old organisationUid', orgUid);
			continue;
		}

		const status =
			row.status === 'present'
				? AttendanceStatus.PRESENT
				: row.status === 'completed'
					? AttendanceStatus.COMPLETED
					: row.status === 'absent'
						? AttendanceStatus.ABSENT
						: row.status === 'on break'
							? AttendanceStatus.ON_BREAK
							: row.status === 'missed'
								? AttendanceStatus.MISSED
								: AttendanceStatus.PRESENT;

		toInsert.push({
			status,
			checkIn,
			checkOut: row.checkOut ? new Date(row.checkOut) : null,
			duration: row.duration ?? null,
			overtime: row.overtime ?? null,
			earlyMinutes: row.earlyMinutes ?? 0,
			lateMinutes: row.lateMinutes ?? 0,
			checkInLatitude: row.checkInLatitude ?? null,
			checkInLongitude: row.checkInLongitude ?? null,
			checkOutLatitude: row.checkOutLatitude ?? null,
			checkOutLongitude: row.checkOutLongitude ?? null,
			placesOfInterest: (row.placesOfInterest ?? null) as Attendance['placesOfInterest'],
			checkInNotes: row.checkInNotes ?? null,
			checkOutNotes: row.checkOutNotes ?? null,
			breakStartTime: row.breakStartTime ? new Date(row.breakStartTime) : null,
			breakEndTime: row.breakEndTime ? new Date(row.breakEndTime) : null,
			totalBreakTime: row.totalBreakTime ?? null,
			breakCount: row.breakCount ?? 0,
			breakDetails: (row.breakDetails ?? null) as Attendance['breakDetails'],
			breakLatitude: row.breakLatitude ?? null,
			breakLongitude: row.breakLongitude ?? null,
			breakNotes: row.breakNotes ?? null,
			distanceTravelledKm: row.distanceTravelledKm ?? 0,
			createdAt: new Date(row.createdAt),
			updatedAt: new Date(row.updatedAt),
			verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : null,
			ownerClerkUserId: newUser.clerkUserId,
			verifiedByClerkUserId: null,
			organisationUid,
			branchUid: null,
		});
	}

	console.log('Rows to insert (after skip-existing):', toInsert.length);

	if (dryRun) {
		console.log('Dry run: no writes.');
		if (verbose && toInsert.length) {
			console.log('Sample (first 3):', JSON.stringify(toInsert.slice(0, 3), null, 2));
		}
		await closeApp(app);
		process.exit(0);
	}

	const repo = newDataSource.getRepository(Attendance);
	let inserted = 0;
	for (let i = 0; i < toInsert.length; i += batchSize) {
		const batch = toInsert.slice(i, i + batchSize);
		for (const row of batch) {
			try {
				await repo.insert(repo.create(row as Record<string, unknown>));
				inserted++;
			} catch (err) {
				if (String(err).includes('duplicate') || String(err).includes('unique')) {
					// skip duplicate
				} else {
					console.error('Insert error:', err);
				}
			}
		}
		if (verbose) console.log('  Batch', Math.floor(i / batchSize) + 1, 'done.');
	}
	console.log('Inserted:', inserted);
	await closeApp(app);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
