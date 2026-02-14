#!/usr/bin/env node

/**
 * Populate Database with Clerk User Profiles
 *
 * Fetches all users from the Clerk API (paginated) and syncs each into the DB
 * using the same logic as the APK session sync: create/update User, sync
 * organisation membership, and ensure UserProfile and UserEmployeementProfile exist.
 *
 * Usage:
 *   npm run populate:clerk-users
 *   npm run populate:clerk-users -- --dry-run
 *   npm run populate:clerk-users -- --limit=10
 *   ts-node -r tsconfig-paths/register src/scripts/populate-clerk-users.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ClerkService } from '../clerk/clerk.service';

const PAGE_SIZE = 100;

function parseArgs(): { dryRun: boolean; limit: number | null } {
	let dryRun = false;
	let limit: number | null = null;
	for (const arg of process.argv.slice(2)) {
		if (arg === '--dry-run') dryRun = true;
		if (arg.startsWith('--limit=')) {
			const n = parseInt(arg.slice('--limit='.length), 10);
			if (!Number.isNaN(n) && n > 0) limit = n;
		}
	}
	return { dryRun, limit };
}

async function main() {
	const { dryRun, limit } = parseArgs();

	console.log('🔧 Initializing NestJS application...\n');
	const app = await NestFactory.createApplicationContext(AppModule);
	const clerkService = app.get(ClerkService);

	const clerkUserIds: string[] = [];
	let offset = 0;
	let totalCount = 0;

	try {
		console.log('📥 Fetching users from Clerk API (paginated)...\n');

		// Paginate until no more users
		while (true) {
			const result = await clerkService.listClerkUsers({
				limit: PAGE_SIZE,
				offset,
				orderBy: '-created_at',
			});

			totalCount = result.totalCount;
			const users = result.users || [];

			for (const u of users) {
				const id = (u as { id?: string }).id;
				if (id) clerkUserIds.push(id);
			}

			if (users.length === 0 || offset + users.length >= totalCount) break;
			offset += PAGE_SIZE;
		}

		console.log(`   Total Clerk users: ${totalCount}`);
		console.log(`   IDs collected: ${clerkUserIds.length}\n`);

		if (clerkUserIds.length === 0) {
			console.log('   No users to sync.');
			return;
		}

		const toProcess = limit != null ? clerkUserIds.slice(0, limit) : clerkUserIds;
		if (limit != null) {
			console.log(`   --limit=${limit}: processing ${toProcess.length} user(s)\n`);
		}

		if (dryRun) {
			console.log('   --dry-run: skipping sync. Clerk user IDs:');
			toProcess.forEach((id, i) => console.log(`     ${i + 1}. ${id}`));
			console.log('\n✅ Dry run complete.');
			return;
		}

		let synced = 0;
		let failed = 0;

		for (let i = 0; i < toProcess.length; i++) {
			const clerkUserId = toProcess[i];
			const label = `Syncing user ${i + 1}/${toProcess.length}: ${clerkUserId}`;
			try {
				const user = await clerkService.syncUserFromClerk(clerkUserId);
				if (user) {
					synced++;
					console.log(`   ✅ ${label} → uid ${user.uid}`);
				} else {
					failed++;
					console.log(`   ❌ ${label} → sync returned null`);
				}
			} catch (error) {
				failed++;
				const msg = error instanceof Error ? error.message : String(error);
				console.error(`   ❌ ${label} → ${msg}`);
			}
		}

		console.log('\n📊 Summary:');
		console.log(`   Total fetched: ${clerkUserIds.length}`);
		console.log(`   Processed: ${toProcess.length}`);
		console.log(`   Synced: ${synced}`);
		console.log(`   Failed: ${failed}`);

		if (failed > 0) {
			console.log('\n⚠️  Some users failed to sync.');
			process.exit(1);
		}

		console.log('\n✅ All users synced successfully.');
	} catch (error) {
		console.error('❌ Script failed:', error instanceof Error ? error.message : error);
		process.exit(1);
	} finally {
		try {
			await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]);
		} catch {
			console.log('\n👋 Application closed.');
		}
	}
}

if (require.main === module) {
	main().catch((error) => {
		console.error('Fatal error:', error);
		process.exit(1);
	});
}
