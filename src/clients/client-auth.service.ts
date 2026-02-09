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

			// Load client with assignedSalesRep for profile (sanitized for client portal)
			const clientWithRep = await this.clientRepository.findOne({
				where: { uid: clientAuth.client.uid },
				relations: ['assignedSalesRep'],
			});
			const client = clientWithRep ?? clientAuth.client;
			const assignedSalesRep = client.assignedSalesRep
				? {
						name: [client.assignedSalesRep.name, client.assignedSalesRep.surname].filter(Boolean).join(' ') || client.assignedSalesRep.name,
						email: client.assignedSalesRep.email ?? null,
						phone: client.assignedSalesRep.phone ?? null,
					}
				: null;

			// Build profile data (linkedClientUid so APK can resolve client for tabs)
			const profileData = {
				linkedClientUid: client.uid,
				uid: clientAuth.uid,
				email: clientAuth.email,
				name: client.name || client.contactPerson || '',
				accessLevel: 'client' as const,
				client: {
					uid: client.uid,
					name: client.name,
					contactPerson: client.contactPerson,
					phone: client.phone,
					organisationRef: client.organisation?.ref ?? clientAuth.client.organisation?.ref ?? null,
					branchUid: client.branch?.uid ?? clientAuth.client.branch?.uid ?? null,
					assignedSalesRep,
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

	/**
	 * Get current client profile by Clerk user ID (for authenticated client portal).
	 * Returns client profile with sanitized assignedSalesRep (name, email, phone only).
	 */
	async getMe(clerkUserId: string): Promise<{ profileData: { uid: number; email: string; name: string; accessLevel: 'client'; client: { uid: number; name: string; contactPerson: string; phone: string; organisationRef: string | null; branchUid: number | null; assignedSalesRep: { name: string; email: string | null; phone: string | null } | null } } }> {
		const clientAuth = await this.clerkService.getClientAuthByClerkId(clerkUserId);
		if (!clientAuth?.client) {
			throw new NotFoundException('Client account not found.');
		}
		if (!clientAuth.isActive || clientAuth.isDeleted) {
			throw new UnauthorizedException('Your account has been deactivated. Please contact support.');
		}
		const clientWithRep = await this.clientRepository.findOne({
			where: { uid: clientAuth.client.uid },
			relations: ['assignedSalesRep', 'organisation', 'branch'],
		});
		const client = clientWithRep ?? clientAuth.client;
		const assignedSalesRep = client.assignedSalesRep
			? {
					name: [client.assignedSalesRep.name, client.assignedSalesRep.surname].filter(Boolean).join(' ') || client.assignedSalesRep.name,
					email: client.assignedSalesRep.email ?? null,
					phone: client.assignedSalesRep.phone ?? null,
				}
			: null;
		const profileData = {
			uid: clientAuth.uid,
			email: clientAuth.email,
			name: client.name || client.contactPerson || '',
			accessLevel: 'client' as const,
			client: {
				uid: client.uid,
				name: client.name,
				contactPerson: client.contactPerson,
				phone: client.phone,
				organisationRef: client.organisation?.ref ?? clientAuth.client.organisation?.ref ?? null,
				branchUid: client.branch?.uid ?? clientAuth.client.branch?.uid ?? null,
				assignedSalesRep,
			},
		};
		return { profileData };
	}
}
