/**
 * Cleanup Script: Remove Duplicate Push Tokens
 * 
 * This script identifies and cleans up duplicate push tokens in the database.
 * When multiple users share the same device (common in testing), they end up
 * with the same push token, causing notifications to be sent to wrong users.
 * 
 * This script:
 * 1. Finds all duplicate tokens
 * 2. Keeps the most recently updated token
 * 3. Clears duplicates from other users
 * 4. Logs all changes for audit purposes
 * 
 * Usage:
 *   npm run cleanup:tokens
 * 
 * Or run directly:
 *   ts-node src/scripts/cleanup-duplicate-tokens.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

interface DuplicateTokenInfo {
	token: string;
	users: Array<{
		uid: number;
		email: string;
		name: string;
		surname: string;
		pushTokenUpdatedAt: Date | null;
	}>;
	keepUserId: number;
	clearUserIds: number[];
}

async function cleanupDuplicateTokens() {
	console.log('🚀 Starting duplicate push token cleanup...\n');

	// Create NestJS application context
	const app = await NestFactory.createApplicationContext(AppModule);
	const userRepository = app.get<Repository<User>>(getRepositoryToken(User));

	try {
		// Step 1: Find all users with push tokens
		console.log('📊 Step 1: Analyzing database for duplicate tokens...');
		const usersWithTokens = await userRepository.find({
			where: {},
			select: ['uid', 'email', 'name', 'surname', 'expoPushToken', 'pushTokenUpdatedAt'],
		});

		// Filter out users without tokens
		const validUsers = usersWithTokens.filter(u => u.expoPushToken && u.expoPushToken.trim() !== '');
		console.log(`   Found ${validUsers.length} users with push tokens\n`);

		// Step 2: Group users by token to find duplicates
		console.log('🔍 Step 2: Identifying duplicate tokens...');
		const tokenGroups = new Map<string, typeof validUsers>();
		
		validUsers.forEach(user => {
			if (!user.expoPushToken) return;
			
			const token = user.expoPushToken;
			if (!tokenGroups.has(token)) {
				tokenGroups.set(token, []);
			}
			tokenGroups.get(token)!.push(user);
		});

		// Filter to only duplicates (2 or more users with same token)
		const duplicates: DuplicateTokenInfo[] = [];
		tokenGroups.forEach((users, token) => {
			if (users.length > 1) {
				// Sort by most recently updated first
				const sortedUsers = users.sort((a, b) => {
					const timeA = a.pushTokenUpdatedAt ? new Date(a.pushTokenUpdatedAt).getTime() : 0;
					const timeB = b.pushTokenUpdatedAt ? new Date(b.pushTokenUpdatedAt).getTime() : 0;
					return timeB - timeA; // Descending order
				});

				const keepUser = sortedUsers[0];
				const clearUsers = sortedUsers.slice(1);

				duplicates.push({
					token: token.substring(0, 30) + '...',
					users: sortedUsers.map(u => ({
						uid: u.uid,
						email: u.email,
						name: u.name || '',
						surname: u.surname || '',
						pushTokenUpdatedAt: u.pushTokenUpdatedAt
					})),
					keepUserId: keepUser.uid,
					clearUserIds: clearUsers.map(u => u.uid)
				});
			}
		});

		if (duplicates.length === 0) {
			console.log('✅ No duplicate tokens found! Database is clean.\n');
			await app.close();
			return;
		}

		console.log(`   Found ${duplicates.length} duplicate tokens affecting ${duplicates.reduce((sum, d) => sum + d.users.length, 0)} users\n`);

		// Step 3: Display duplicates for review
		console.log('📋 Step 3: Duplicate tokens found:');
		console.log('═══════════════════════════════════════════════════════════════\n');
		
		duplicates.forEach((duplicate, index) => {
			console.log(`Duplicate #${index + 1}:`);
			console.log(`  Token: ${duplicate.token}`);
			console.log(`  Affected Users (${duplicate.users.length}):`);
			duplicate.users.forEach((user, userIndex) => {
				const isKeep = user.uid === duplicate.keepUserId;
				const marker = isKeep ? '✅ KEEP' : '❌ CLEAR';
				const lastUpdated = user.pushTokenUpdatedAt 
					? new Date(user.pushTokenUpdatedAt).toISOString()
					: 'Never';
				console.log(`    ${marker} User ${user.uid}: ${user.email}`);
				console.log(`         Name: ${user.name} ${user.surname}`);
				console.log(`         Last Updated: ${lastUpdated}`);
			});
			console.log('');
		});
		console.log('═══════════════════════════════════════════════════════════════\n');

		// Step 4: Confirm cleanup (in production, you'd want user confirmation)
		const shouldCleanup = process.env.AUTO_CLEANUP === 'true' || process.argv.includes('--auto');
		
		if (!shouldCleanup) {
			console.log('⚠️  DRY RUN MODE - No changes will be made');
			console.log('   To execute cleanup, run with --auto flag or set AUTO_CLEANUP=true\n');
			console.log('   Example: npm run cleanup:tokens -- --auto\n');
			
			const totalToClear = duplicates.reduce((sum, d) => sum + d.clearUserIds.length, 0);
			console.log(`📊 Summary:`);
			console.log(`   - Total duplicate tokens: ${duplicates.length}`);
			console.log(`   - Total users affected: ${duplicates.reduce((sum, d) => sum + d.users.length, 0)}`);
			console.log(`   - Tokens to keep: ${duplicates.length}`);
			console.log(`   - Tokens to clear: ${totalToClear}`);
			
			await app.close();
			return;
		}

		// Step 5: Execute cleanup
		console.log('🔧 Step 4: Cleaning up duplicate tokens...\n');
		
		let clearedCount = 0;
		for (const duplicate of duplicates) {
			try {
				// Clear tokens from users who shouldn't have them
				const result = await userRepository.update(
					duplicate.clearUserIds,
					{
						expoPushToken: null,
						deviceId: null,
						platform: null,
						pushTokenUpdatedAt: null
					}
				);

				console.log(`   ✅ Cleared token from ${result.affected} users (${duplicate.clearUserIds.join(', ')})`);
				console.log(`      Kept token for user ${duplicate.keepUserId}`);
				clearedCount += result.affected || 0;
			} catch (error) {
				console.error(`   ❌ Failed to clear duplicate token:`, error.message);
			}
		}

		console.log('\n═══════════════════════════════════════════════════════════════');
		console.log('✅ Cleanup completed successfully!');
		console.log(`   - Tokens cleared from ${clearedCount} users`);
		console.log(`   - Tokens preserved for ${duplicates.length} users`);
		console.log('═══════════════════════════════════════════════════════════════\n');

	} catch (error) {
		console.error('❌ Cleanup failed:', error);
		throw error;
	} finally {
		await app.close();
	}
}

// Run the cleanup
cleanupDuplicateTokens()
	.then(() => {
		console.log('Script completed successfully');
		process.exit(0);
	})
	.catch((error) => {
		console.error('Script failed:', error);
		process.exit(1);
	});

