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
		this.logger.log(`[${operationId}] Processing Clerk sync for user`);

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
				this.logger.warn(`[${operationId}] User not found for Clerk user: ${clerkUserId}`);
				throw new NotFoundException('User account not found. Please contact support.');
			}

			// Ensure user is active
			if (user.isDeleted || user.status !== AccountStatus.ACTIVE) {
				this.logger.warn(`[${operationId}] User inactive or deleted: ${user.uid}`);
				throw new UnauthorizedException('Your account has been deactivated. Please contact support.');
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

			// Reload user with relations if not already loaded
			if (!user.organisation || !user.branch) {
				user = await this.userRepository.findOne({
					where: { uid: user.uid },
					relations: ['organisation', 'branch'],
				});
			}

			// Build profile data
			const profileData = {
				uid: user.uid,
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

			this.logger.log(`[${operationId}] User session synced successfully - uid: ${user.uid}`);

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
