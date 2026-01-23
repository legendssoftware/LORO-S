import { Injectable, Logger, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserSyncClerkDto } from './dto/user-sync-clerk.dto';
import { ClerkService } from '../clerk/clerk.service';
import { AccountStatus } from '../lib/enums/status.enums';

@Injectable()
export class UserAuthService {
	private readonly logger = new Logger(UserAuthService.name);

	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly clerkService: ClerkService,
	) {}

	/**
	 * Sync user session with Clerk token
	 * Validates Clerk token and returns user profile data
	 */
	async syncClerkSession(syncDto: UserSyncClerkDto) {
		const operationId = `SYNC_CLERK_${Date.now()}`;
		this.logger.debug(`[${operationId}] Processing Clerk sync`);

		try {
			// Verify Clerk token
			const verification = await this.clerkService.verifyToken(syncDto.clerkToken);
			const clerkUserId = verification.userId;

			// Get or sync user from Clerk
			let user = await this.clerkService.getUserByClerkId(clerkUserId);

			// If not found, try to sync from Clerk
			if (!user) {
				this.logger.debug(`[${operationId}] User not found, syncing from Clerk...`);
				user = await this.clerkService.syncUserFromClerk(clerkUserId);
			}

			if (!user) {
				this.logger.warn(`[${operationId}] User not found`);
				throw new NotFoundException('User account not found. Please contact support.');
			}

			// Ensure user is active
			if (user.isDeleted || user.status !== AccountStatus.ACTIVE) {
				this.logger.warn(`[${operationId}] User inactive or deleted`);
				throw new UnauthorizedException('Your account has been deactivated. Please contact support.');
			}

			// Check if org was recently synced (within last 5 seconds) to avoid redundant syncs
			const recentSyncThreshold = 5000; // 5 seconds
			const timeSinceLastSync = user.clerkLastSyncedAt 
				? Date.now() - new Date(user.clerkLastSyncedAt).getTime()
				: Infinity;

			// Only sync organization membership if not recently synced or if user has no organisationRef
			if (timeSinceLastSync > recentSyncThreshold || !user.organisationRef) {
				this.logger.debug(`[${operationId}] Syncing organization membership for user`);
				const orgSyncSuccess = await this.clerkService.syncUserOrganizationForUser(user, clerkUserId);
				if (orgSyncSuccess) {
					this.logger.debug(`[${operationId}] Organization membership synced successfully`);
				} else {
					this.logger.debug(`[${operationId}] Organization membership sync completed (user may not have org membership)`);
				}
			} else {
				this.logger.debug(`[${operationId}] Skipping org sync - recently synced (${Math.round(timeSinceLastSync)}ms ago)`);
			}

			// Only check profiles if user was just created (no profiles exist yet)
			// If user was recently synced, profiles likely already exist
			if (timeSinceLastSync > recentSyncThreshold || !user.userProfile || !user.userEmployeementProfile) {
				this.logger.debug(`[${operationId}] Ensuring user profiles exist`);
				await this.clerkService.ensureUserProfilesForUser(user, clerkUserId);
			} else {
				this.logger.debug(`[${operationId}] Skipping profile check - recently synced`);
			}

			// Update device info if provided
			if (syncDto.expoPushToken || syncDto.deviceId || syncDto.platform) {
				if (syncDto.expoPushToken) user.expoPushToken = syncDto.expoPushToken;
				if (syncDto.deviceId) user.deviceId = syncDto.deviceId;
				if (syncDto.platform) user.platform = syncDto.platform;
				user.pushTokenUpdatedAt = new Date();
				await this.userRepository.save(user);
			}

			// Update sync timestamp
			user.clerkLastSyncedAt = new Date();
			await this.userRepository.save(user);

			// Reload user with relations to ensure organisationRef is properly loaded after sync
			user = await this.userRepository.findOne({
				where: { clerkUserId: user.clerkUserId },
				relations: ['organisation', 'branch'],
			});

			// Build profile data
			const profileData = {
				clerkUserId: user.clerkUserId,
				uid: user.uid, // Kept for backward compatibility
				email: user.email,
				name: user.name,
				surname: user.surname,
				username: user.username,
				accessLevel: user.accessLevel,
				role: user.role,
				organisationRef: user.organisationRef,
				branchUid: user.branchUid,
				organisation: user.organisation ? {
					ref: user.organisation.ref,
					name: user.organisation.name,
				} : null,
				branch: user.branch ? {
					uid: user.branch.uid,
					name: user.branch.name,
				} : null,
			};

			this.logger.log(`[${operationId}] User synced successfully`);

			return {
				profileData,
			};
		} catch (error) {
			if (error instanceof UnauthorizedException || error instanceof NotFoundException) {
				throw error;
			}
			this.logger.error(`[${operationId}] Sync error:`, error instanceof Error ? error.message : 'Unknown error');
			throw new UnauthorizedException('Session sync failed. Please try again.');
		}
	}
}
