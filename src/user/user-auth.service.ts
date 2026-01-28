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

			const shouldSyncOrg = timeSinceLastSync > recentSyncThreshold || !user.organisationRef;
			const shouldCheckProfiles = timeSinceLastSync > recentSyncThreshold || !user.userProfile || !user.userEmployeementProfile;

			// Parallelize org sync and profile checks for better performance
			const syncPromises: Promise<any>[] = [];

			if (shouldSyncOrg) {
				this.logger.debug(`[${operationId}] Syncing organization membership for user`);
				syncPromises.push(
					this.clerkService.syncUserOrganizationForUser(user, clerkUserId)
						.then((updatedUser) => {
							if (updatedUser) {
								// Update user object with org changes
								user.organisationRef = updatedUser.organisationRef;
								user.organisation = updatedUser.organisation;
								this.logger.debug(`[${operationId}] Organization membership synced successfully`);
							} else {
								this.logger.debug(`[${operationId}] Organization membership sync completed (user may not have org membership)`);
							}
							return updatedUser;
						})
				);
			} else {
				this.logger.debug(`[${operationId}] Skipping org sync - recently synced (${Math.round(timeSinceLastSync)}ms ago)`);
			}

			if (shouldCheckProfiles) {
				this.logger.debug(`[${operationId}] Ensuring user profiles exist`);
				syncPromises.push(this.clerkService.ensureUserProfilesForUser(user, clerkUserId));
			} else {
				this.logger.debug(`[${operationId}] Skipping profile check - recently synced`);
			}

			// Wait for all sync operations to complete in parallel
			await Promise.all(syncPromises);

			// Batch all user updates into single save operation
			const hasDeviceUpdates = syncDto.expoPushToken || syncDto.deviceId || syncDto.platform;
			if (hasDeviceUpdates) {
				if (syncDto.expoPushToken) user.expoPushToken = syncDto.expoPushToken;
				if (syncDto.deviceId) user.deviceId = syncDto.deviceId;
				if (syncDto.platform) user.platform = syncDto.platform;
				user.pushTokenUpdatedAt = new Date();
			}

			// Update sync timestamp
			user.clerkLastSyncedAt = new Date();

			// Single save operation for all updates (device info, sync timestamp, org link)
			// Always save to update sync timestamp, even if no other changes
			await this.userRepository.save(user);

			// Cache user after successful sync for faster subsequent lookups
			await this.clerkService.cacheUserAfterSync(user);

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
