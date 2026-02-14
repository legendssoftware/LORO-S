#!/usr/bin/env node

/**
 * Sync users from readnew.csv into Clerk
 *
 * Reads CSV rows from uid 243 onward, creates each user in Clerk with
 * generic password (securePass@2026) and username/email/name from the file,
 * then adds them all to the Bit Drywall Clerk organization so that
 * populate-clerk-users can later sync them to the DB.
 *
 * Usage:
 *   npm run sync:csv-to-clerk
 *   npm run sync:csv-to-clerk -- --dry-run
 *   npm run sync:csv-to-clerk -- --from-uid=243 --path=../readnew.csv
 *   npm run sync:csv-to-clerk -- --retry-failed --path=../readnew.csv
 *   npm run sync:csv-to-clerk -- --uids=247,248,249 --path=../readnew.csv
 *   ts-node -r tsconfig-paths/register src/scripts/sync-csv-users-to-clerk.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';

const DEFAULT_PASSWORD = 'securePass@2026';

/** All users from the CSV (from the named line onward) are added to Bit Drywall. */
const BIT_DRYWALL_CLERK_ORG_ID = 'org_38PulS5p5hmhjH14SW4YGi8JlFM';

const FAILED_FILE_NAME = 'sync-csv-failed.json';

function getFailedFilePath(): string {
	return path.resolve(process.cwd(), FAILED_FILE_NAME);
}

interface FailedEntry {
	uid: string;
	email: string;
	reason: string;
}

function parseArgs(): {
	dryRun: boolean;
	fromUid: number;
	csvPath: string;
	retryFailed: boolean;
	uids: number[] | null;
} {
	let dryRun = false;
	let fromUid = 243;
	let csvPath = path.resolve(process.cwd(), '..', 'readnew.csv');
	let retryFailed = false;
	let uids: number[] | null = null;
	for (const arg of process.argv.slice(2)) {
		if (arg === '--dry-run') dryRun = true;
		if (arg === '--retry-failed') retryFailed = true;
		if (arg.startsWith('--from-uid=')) {
			const n = parseInt(arg.slice('--from-uid='.length), 10);
			if (!Number.isNaN(n) && n >= 0) fromUid = n;
		}
		if (arg.startsWith('--path=')) {
			csvPath = path.resolve(process.cwd(), arg.slice('--path='.length));
		}
		if (arg.startsWith('--uids=')) {
			const list = arg.slice('--uids='.length).split(',').map((s) => parseInt(s.trim(), 10));
			uids = list.filter((n) => !Number.isNaN(n));
		}
	}
	return { dryRun, fromUid, csvPath, retryFailed, uids };
}

interface CsvRow {
	uid: string;
	username: string;
	name: string;
	surname: string;
	email: string;
	phone: string;
	role: string;
	accessLevel: string;
	organisationRef: string;
	[key: string]: string;
}

function parseCsv(filePath: string): CsvRow[] {
	const content = fs.readFileSync(filePath, 'utf-8');
	const records = parse(content, {
		columns: true,
		skip_empty_lines: true,
		relax_column_count: true,
	});
	return records as CsvRow[];
}

/**
 * Derives a Clerk-safe username from name + surname and uid.
 * Uses Latin-safe chars, no @, and appends _uid for uniqueness.
 */
function deriveUsername(row: CsvRow): string {
	const name = (row.name ?? '').trim() || 'User';
	const surname = (row.surname ?? '').trim();
	const combined = [name, surname].filter(Boolean).join(' ');
	// Normalize: lowercase, replace non-alphanumeric (and non-Latin) with underscore, collapse
	const normalized = combined
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '')
		.slice(0, 40) || 'user';
	const base = normalized || 'user';
	return `${base}_${row.uid}`;
}

/** Resolves the username to send to Clerk: use CSV if valid, else derived from name/surname. */
function resolveUsername(row: CsvRow): string {
	const raw = (row.username ?? '').trim();
	if (raw && !raw.includes('@')) return raw;
	return deriveUsername(row);
}

async function main() {
	const { dryRun, fromUid, csvPath, retryFailed, uids } = parseArgs();

	console.log('🔧 Initializing NestJS application...\n');
	let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null = null;

	try {
		app = await NestFactory.createApplicationContext(AppModule);
		const configService = app.get(ConfigService);
		const secretKey = configService.get<string>('CLERK_SECRET_KEY');
		const publishableKey = configService.get<string>('CLERK_PUBLISHABLE_KEY');

		if (!secretKey) {
			console.error('❌ CLERK_SECRET_KEY is not set.');
			process.exit(1);
		}

		const clerkClient = createClerkClient({ secretKey, publishableKey: publishableKey ?? undefined });

		if (!fs.existsSync(csvPath)) {
			console.error(`❌ CSV file not found: ${csvPath}`);
			process.exit(1);
		}

		const rows = parseCsv(csvPath);
		let filtered = rows.filter((r) => {
			const uid = parseInt(r.uid, 10);
			return !Number.isNaN(uid) && uid >= fromUid && r.email && r.email.trim() !== '';
		});

		if (retryFailed) {
			const failedPath = getFailedFilePath();
			if (!fs.existsSync(failedPath)) {
				console.error(`❌ --retry-failed: ${failedPath} not found. Run a full sync first.`);
				process.exit(1);
			}
			const raw = fs.readFileSync(failedPath, 'utf-8');
			let failedList: FailedEntry[];
			try {
				failedList = JSON.parse(raw) as FailedEntry[];
			} catch {
				console.error(`❌ --retry-failed: ${failedPath} is not valid JSON.`);
				process.exit(1);
			}
			const failedUids = new Set(failedList.map((e) => e.uid));
			filtered = filtered.filter((r) => failedUids.has(r.uid));
			if (filtered.length === 0) {
				console.log('   No rows to retry (failed list empty or no matching UIDs in CSV).');
				return;
			}
			console.log(`   Retrying ${filtered.length} failed row(s) from ${failedPath}\n`);
		}

		if (uids && uids.length > 0) {
			const uidSet = new Set(uids.map(String));
			filtered = filtered.filter((r) => uidSet.has(r.uid));
			if (filtered.length === 0) {
				console.log('   No rows match --uids. Nothing to process.');
				return;
			}
		}

		console.log(`📄 CSV: ${csvPath}`);
		console.log(`   Rows with uid >= ${fromUid} and non-empty email: ${filtered.length}\n`);

		if (filtered.length === 0) {
			console.log('   No rows to process.');
			return;
		}

		if (dryRun) {
			console.log('   --dry-run: would create the following users in Clerk (all → Bit Drywall):\n');
			filtered.forEach((r, i) => {
				console.log(`   ${i + 1}. uid=${r.uid} username=${resolveUsername(r)} email=${r.email} -> Bit Drywall (${BIT_DRYWALL_CLERK_ORG_ID})`);
			});
			console.log('\n✅ Dry run complete.');
			return;
		}

		let created = 0;
		let membershipAdded = 0;
		let skipped = 0;
		let failed = 0;
		const failedEntries: FailedEntry[] = [];

		function shortReason(msg: string): string {
			if (msg.includes('Forbidden')) return 'Forbidden';
			if (msg.includes('Unprocessable Entity') || msg.includes('422')) return 'Unprocessable Entity';
			return msg.slice(0, 200);
		}

		for (let i = 0; i < filtered.length; i++) {
			const row = filtered[i];
			const label = `[${i + 1}/${filtered.length}] uid=${row.uid} ${row.email}`;
			try {
				const email = row.email.trim().toLowerCase();
				const firstName = (row.name ?? '').trim() || 'User';
				const lastName = (row.surname ?? '').trim();
				const username = resolveUsername(row);
				const role = (row.accessLevel ?? row.role ?? 'user').toLowerCase() === 'admin' ? 'org:admin' : 'org:member';

				const existing = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
				if (existing.data && existing.data.length > 0) {
					const existingUser = existing.data[0];
					console.log(`   ⏭️  ${label} -> already in Clerk (${(existingUser as { id?: string }).id}), adding to Bit Drywall if needed`);
					skipped++;
					try {
						await clerkClient.organizations.createOrganizationMembership({
							organizationId: BIT_DRYWALL_CLERK_ORG_ID,
							userId: (existingUser as { id: string }).id,
							role,
						});
						membershipAdded++;
						console.log(`   ✅ ${label} -> added to Bit Drywall`);
					} catch (memErr: unknown) {
						const msg = memErr instanceof Error ? memErr.message : String(memErr);
						if (msg.includes('already a member') || msg.includes('already exists')) {
							console.log(`   ⏭️  ${label} -> already in Bit Drywall`);
						} else {
							console.error(`   ❌ ${label} -> org membership failed: ${msg}`);
							failed++;
							failedEntries.push({ uid: row.uid, email: row.email.trim(), reason: shortReason(msg) });
						}
					}
					continue;
				}

				const user = await clerkClient.users.createUser({
					emailAddress: [email],
					password: DEFAULT_PASSWORD,
					firstName,
					lastName,
					username,
					skipPasswordChecks: true,
					publicMetadata: {
						role: row.role ?? 'user',
						accessLevel: row.accessLevel ?? 'user',
						internalUid: parseInt(row.uid, 10),
					},
				});
				created++;
				const clerkUserId = (user as { id: string }).id;
				console.log(`   ✅ ${label} -> created in Clerk (${clerkUserId})`);

				try {
					await clerkClient.organizations.createOrganizationMembership({
						organizationId: BIT_DRYWALL_CLERK_ORG_ID,
						userId: clerkUserId,
						role,
					});
					membershipAdded++;
					console.log(`   ✅ ${label} -> added to Bit Drywall`);
				} catch (memErr: unknown) {
					const msg = memErr instanceof Error ? memErr.message : String(memErr);
					console.error(`   ❌ ${label} -> org membership failed: ${msg}`);
					failed++;
					failedEntries.push({ uid: row.uid, email: row.email.trim(), reason: shortReason(msg) });
				}
			} catch (err: unknown) {
				failed++;
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`   ❌ ${label} -> ${msg}`);
				failedEntries.push({ uid: row.uid, email: row.email.trim(), reason: shortReason(msg) });
			}
		}

		console.log('\n📊 Summary:');
		console.log(`   Created in Clerk: ${created}`);
		console.log(`   Already in Clerk (skipped create): ${skipped}`);
		console.log(`   Org membership added: ${membershipAdded}`);
		console.log(`   Failed: ${failed}`);
		if (failedEntries.length > 0) {
			console.log(`   Failed UIDs: ${failedEntries.map((e) => e.uid).join(', ')}`);
			if (!retryFailed) {
				const failedPath = getFailedFilePath();
				fs.writeFileSync(failedPath, JSON.stringify(failedEntries, null, 2), 'utf-8');
				console.log(`\n   Failed rows written to ${failedPath}. Re-run with --retry-failed to retry only these rows.`);
			}
		}
		if (failed > 0) process.exit(1);
		console.log('\n✅ Done. Run npm run populate:clerk-users to sync these users to the DB.');
	} catch (error) {
		console.error('❌ Script failed:', error instanceof Error ? error.message : error);
		process.exit(1);
	} finally {
		if (app) {
			try {
				await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]);
			} catch {
				console.log('\n👋 Application closed.');
			}
		}
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error('Fatal error:', err);
		process.exit(1);
	});
}
