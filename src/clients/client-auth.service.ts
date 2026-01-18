import { Injectable, Logger, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientAuth } from './entities/client.auth.entity';
import { Client } from './entities/client.entity';
import { ClientSyncClerkDto } from './dto/client-sync-clerk.dto';
import { ClerkService } from '../clerk/clerk.service';

@Injectable()
export class ClientAuthService {
	private readonly logger = new Logger(ClientAuthService.name);

	constructor(
		@InjectRepository(ClientAuth)
		private readonly clientAuthRepository: Repository<ClientAuth>,
		@InjectRepository(Client)
		private readonly clientRepository: Repository<Client>,
		private readonly clerkService: ClerkService,
	) {}

	/**
	 * Sync client session with Clerk token
	 * Validates Clerk token and returns client profile data
	 */
	async syncClerkSession(syncDto: ClientSyncClerkDto) {
		const operationId = `SYNC_CLERK_${Date.now()}`;
		this.logger.log(`[${operationId}] Processing Clerk sync for client`);

		try {
			// Verify Clerk token
			const verification = await this.clerkService.verifyToken(syncDto.clerkToken);
			const clerkUserId = verification.userId;

			// Get or sync client auth from Clerk
			let clientAuth = await this.clerkService.getClientAuthByClerkId(clerkUserId);

			// If not found, try to sync from Clerk
			if (!clientAuth) {
				this.logger.debug(`[${operationId}] Client auth not found, syncing from Clerk...`);
				clientAuth = await this.clerkService.syncClientAuthFromClerk(clerkUserId);
			}

			if (!clientAuth || !clientAuth.client) {
				this.logger.warn(`[${operationId}] Client auth not found for Clerk user: ${clerkUserId}`);
				throw new NotFoundException('Client account not found. Please contact support.');
			}

			// Ensure client auth is active
			if (!clientAuth.isActive || clientAuth.isDeleted) {
				this.logger.warn(`[${operationId}] Client auth inactive or deleted: ${clientAuth.uid}`);
				throw new UnauthorizedException('Your account has been deactivated. Please contact support.');
			}

			// Update device info if provided
			if (syncDto.expoPushToken || syncDto.deviceId || syncDto.platform) {
				if (syncDto.expoPushToken) clientAuth.expoPushToken = syncDto.expoPushToken;
				if (syncDto.deviceId) clientAuth.deviceId = syncDto.deviceId;
				if (syncDto.platform) clientAuth.platform = syncDto.platform;
				clientAuth.pushTokenUpdatedAt = new Date();
				await this.clientAuthRepository.save(clientAuth);
			}

			// Update last login
			clientAuth.lastLogin = new Date();
			clientAuth.clerkLastSyncedAt = new Date();
			await this.clientAuthRepository.save(clientAuth);

			// Build profile data
			const profileData = {
				uid: clientAuth.uid,
				email: clientAuth.email,
				name: clientAuth.client.name || clientAuth.client.contactPerson || '',
				accessLevel: 'client' as const,
				client: {
					uid: clientAuth.client.uid,
					name: clientAuth.client.name,
					contactPerson: clientAuth.client.contactPerson,
					phone: clientAuth.client.phone,
					organisationRef: clientAuth.client.organisation?.ref || null,
					branchUid: clientAuth.client.branch?.uid || null,
				},
			};

			this.logger.log(`[${operationId}] Client session synced successfully - uid: ${clientAuth.uid}`);

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
