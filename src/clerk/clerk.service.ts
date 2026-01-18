import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { LicensingService } from '../licensing/licensing.service';

@Injectable()
export class ClerkService {
	private readonly logger = new Logger(ClerkService.name);
	private readonly clerkClientInstance;

	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private readonly organisationRepository: Repository<Organisation>,
		@InjectRepository(ClientAuth)
		private readonly clientAuthRepository: Repository<ClientAuth>,
		private readonly configService: ConfigService,
		private readonly licensingService: LicensingService,
	) {
		const secretKey = this.configService.get<string>('CLERK_SECRET_KEY');
		if (!secretKey) {
			this.logger.warn('CLERK_SECRET_KEY not configured - Clerk features will be disabled');
			this.clerkClientInstance = null;
		} else {
			this.clerkClientInstance = createClerkClient({ secretKey });
		}
	}

	/**
	 * Verify Clerk session token and extract user ID
	 * Critical path - synchronous operation
	 */
	async verifyToken(token: string): Promise<{ userId: string; sessionId?: string }> {
		const operationId = `VERIFY_TOKEN_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.error(`[${operationId}] Clerk client not initialized - CLERK_SECRET_KEY missing`);
			throw new Error('Clerk authentication not configured');
		}

		try {
			const verification = await this.clerkClientInstance.verifyToken(token);
			
			if (!verification || !verification.sub) {
				this.logger.warn(`[${operationId}] Token verification failed - invalid token structure`);
				throw new Error('Invalid token');
			}

			return {
				userId: verification.sub,
				sessionId: verification.sid,
			};
		} catch (error) {
			this.logger.error(`[${operationId}] Token verification failed:`, error instanceof Error ? error.message : 'Unknown error');
			throw error;
		}
	}

	/**
	 * Get user from database by Clerk user ID
	 * Critical path - synchronous operation
	 */
	async getUserByClerkId(clerkUserId: string): Promise<User | null> {
		const operationId = `GET_USER_${clerkUserId}_${Date.now()}`;
		
		try {
			const user = await this.userRepository.findOne({
				where: { clerkUserId },
				relations: ['organisation', 'branch'],
			});

			return user;
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to lookup user:`, error instanceof Error ? error.message : 'Unknown error');
			throw error;
		}
	}

	/**
	 * Sync user from Clerk API to database
	 * Async operation - non-blocking
	 */
	async syncUserFromClerk(clerkUserId: string): Promise<User | null> {
		const operationId = `SYNC_USER_${clerkUserId}_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.warn(`[${operationId}] Clerk client not initialized - skipping sync`);
			return null;
		}

		try {
			const clerkUser = await this.clerkClientInstance.users.getUser(clerkUserId);
			
			if (!clerkUser) {
				this.logger.warn(`[${operationId}] User not found in Clerk`);
				return null;
			}

			// Extract user data from Clerk user
			const email = clerkUser.emailAddresses?.[0]?.emailAddress;
			const firstName = clerkUser.firstName || '';
			const lastName = clerkUser.lastName || '';
			const username = clerkUser.username || email?.split('@')[0] || `user_${clerkUserId.substring(0, 8)}`;
			const photoURL = clerkUser.imageUrl || null;

			if (!email) {
				this.logger.warn(`[${operationId}] Clerk user missing email - cannot sync`);
				return null;
			}

			// Check if user already exists
			let user = await this.userRepository.findOne({
				where: { clerkUserId },
			});

			if (user) {
				// Update existing user
				user.email = email;
				user.name = firstName;
				user.surname = lastName;
				user.username = username;
				user.photoURL = photoURL;
				user.clerkLastSyncedAt = new Date();
			} else {
				// Check if user exists by email (for migration)
				const existingUser = await this.userRepository.findOne({
					where: { email },
				});

				if (existingUser) {
					// Link existing user to Clerk
					existingUser.clerkUserId = clerkUserId;
					existingUser.clerkLastSyncedAt = new Date();
					user = existingUser;
				} else {
					// Create new user
					user = this.userRepository.create({
						clerkUserId,
						email,
						name: firstName,
						surname: lastName,
						username,
						password: '', // Password managed by Clerk
						photoURL,
						role: 'user',
						status: 'active',
						accessLevel: 'user' as any,
						clerkLastSyncedAt: new Date(),
					});
				}
			}

			user = await this.userRepository.save(user);
			this.logger.log(`[${operationId}] User synced successfully - uid: ${user.uid}, email: ${user.email}`);

			return user;
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to sync user from Clerk:`, error instanceof Error ? error.message : 'Unknown error');
			// Don't throw - this is async operation
			return null;
		}
	}

	/**
	 * Handle webhook user.created event
	 * Async operation - non-blocking
	 */
	async handleUserCreated(clerkUserId: string, clerkUserData: any): Promise<void> {
		const operationId = `WEBHOOK_USER_CREATED_${clerkUserId}_${Date.now()}`;
		
		setImmediate(async () => {
			try {
				await this.syncUserFromClerk(clerkUserId);
				
				this.logger.log(`[${operationId}] User created webhook processed successfully`);
			} catch (error) {
				this.logger.error(`[${operationId}] Failed to process user.created webhook:`, error instanceof Error ? error.message : 'Unknown error');
				// Don't throw - webhook already acknowledged
			}
		});
	}

	/**
	 * Handle webhook user.updated event
	 * Async operation - non-blocking
	 */
	async handleUserUpdated(clerkUserId: string, clerkUserData: any): Promise<void> {
		const operationId = `WEBHOOK_USER_UPDATED_${clerkUserId}_${Date.now()}`;
		
		setImmediate(async () => {
			try {
				await this.syncUserFromClerk(clerkUserId);
				
				this.logger.log(`[${operationId}] User updated webhook processed successfully`);
			} catch (error) {
				this.logger.error(`[${operationId}] Failed to process user.updated webhook:`, error instanceof Error ? error.message : 'Unknown error');
				// Don't throw - webhook already acknowledged
			}
		});
	}

	/**
	 * Handle webhook user.deleted event
	 * Async operation - non-blocking
	 */
	async handleUserDeleted(clerkUserId: string): Promise<void> {
		const operationId = `WEBHOOK_USER_DELETED_${clerkUserId}_${Date.now()}`;
		
		setImmediate(async () => {
			try {
				const user = await this.userRepository.findOne({
					where: { clerkUserId },
				});

				if (user) {
					user.isDeleted = true;
					user.clerkUserId = null; // Remove Clerk link
					await this.userRepository.save(user);
					this.logger.log(`[${operationId}] User marked as deleted - uid: ${user.uid}`);
				}
			} catch (error) {
				this.logger.error(`[${operationId}] Failed to process user.deleted webhook:`, error instanceof Error ? error.message : 'Unknown error');
				// Don't throw - webhook already acknowledged
			}
		});
	}

	/**
	 * Handle webhook organizationMembership.created event
	 * Async operation - non-blocking
	 */
	async handleOrganizationMembershipCreated(clerkOrgId: string, clerkUserId: string, role: string): Promise<void> {
		const operationId = `WEBHOOK_ORG_MEMBERSHIP_CREATED_${clerkOrgId}_${clerkUserId}_${Date.now()}`;
		
		setImmediate(async () => {
			try {
				// Find user and organization
				const user = await this.userRepository.findOne({
					where: { clerkUserId },
					relations: ['organisation'],
				});

				if (!user) {
					this.logger.warn(`[${operationId}] User not found - skipping organization membership sync`);
					return;
				}

				// Find organization by Clerk org ID (if using Clerk Organizations)
				const organisation = await this.organisationRepository.findOne({
					where: { clerkOrgId },
				});

				if (organisation) {
					user.organisationRef = organisation.ref;
					await this.userRepository.save(user);
					this.logger.log(`[${operationId}] User linked to organization - uid: ${user.uid}, orgRef: ${organisation.ref}`);
				}
			} catch (error) {
				this.logger.error(`[${operationId}] Failed to process organizationMembership.created webhook:`, error instanceof Error ? error.message : 'Unknown error');
				// Don't throw - webhook already acknowledged
			}
		});
	}

	/**
	 * Handle webhook organizationMembership.deleted event
	 * Async operation - non-blocking
	 */
	async handleOrganizationMembershipDeleted(clerkOrgId: string, clerkUserId: string): Promise<void> {
		const operationId = `WEBHOOK_ORG_MEMBERSHIP_DELETED_${clerkOrgId}_${clerkUserId}_${Date.now()}`;
		
		setImmediate(async () => {
			try {
				const user = await this.userRepository.findOne({
					where: { clerkUserId },
				});

				if (user) {
					user.organisationRef = null;
					await this.userRepository.save(user);
					this.logger.log(`[${operationId}] User unlinked from organization - uid: ${user.uid}`);
				}
			} catch (error) {
				this.logger.error(`[${operationId}] Failed to process organizationMembership.deleted webhook:`, error instanceof Error ? error.message : 'Unknown error');
				// Don't throw - webhook already acknowledged
			}
		});
	}

	/**
	 * Update user's last sync timestamp
	 * Async operation - non-blocking
	 */
	async updateSyncTimestamp(user: User): Promise<void> {
		const operationId = `UPDATE_SYNC_TS_${user.uid}_${Date.now()}`;
		
		setImmediate(async () => {
			try {
				user.clerkLastSyncedAt = new Date();
				await this.userRepository.save(user);
			} catch (error) {
				// Silent fail - this is background operation
			}
		});
	}

	/**
	 * Get client auth from database by Clerk user ID
	 * Critical path - synchronous operation
	 */
	async getClientAuthByClerkId(clerkUserId: string): Promise<ClientAuth | null> {
		const operationId = `GET_CLIENT_AUTH_${clerkUserId}_${Date.now()}`;
		
		try {
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { clerkUserId },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

			return clientAuth;
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to lookup client auth:`, error instanceof Error ? error.message : 'Unknown error');
			throw error;
		}
	}

	/**
	 * Sync client auth from Clerk API to database
	 * Async operation - non-blocking
	 */
	async syncClientAuthFromClerk(clerkUserId: string): Promise<ClientAuth | null> {
		const operationId = `SYNC_CLIENT_AUTH_${clerkUserId}_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.warn(`[${operationId}] Clerk client not initialized - skipping sync`);
			return null;
		}

		try {
			const clerkUser = await this.clerkClientInstance.users.getUser(clerkUserId);
			
			if (!clerkUser) {
				this.logger.warn(`[${operationId}] Client not found in Clerk`);
				return null;
			}

			// Extract client data from Clerk user
			const email = clerkUser.emailAddresses?.[0]?.emailAddress;

			if (!email) {
				this.logger.warn(`[${operationId}] Clerk user missing email - cannot sync`);
				return null;
			}

			// Check if client auth already exists
			let clientAuth = await this.clientAuthRepository.findOne({
				where: { clerkUserId },
				relations: ['client'],
			});

			if (clientAuth) {
				// Update existing client auth
				clientAuth.email = email;
				clientAuth.clerkLastSyncedAt = new Date();
			} else {
				// Check if client auth exists by email (for migration)
				const existingClientAuth = await this.clientAuthRepository.findOne({
					where: { email },
					relations: ['client'],
				});

				if (existingClientAuth) {
					// Link existing client auth to Clerk
					existingClientAuth.clerkUserId = clerkUserId;
					existingClientAuth.clerkLastSyncedAt = new Date();
					clientAuth = existingClientAuth;
				} else {
					this.logger.warn(`[${operationId}] Client auth not found by email - cannot create without client record`);
					return null;
				}
			}

			clientAuth = await this.clientAuthRepository.save(clientAuth);
			this.logger.log(`[${operationId}] Client auth synced successfully - uid: ${clientAuth.uid}, email: ${clientAuth.email}`);

			return clientAuth;
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to sync client auth from Clerk:`, error instanceof Error ? error.message : 'Unknown error');
			// Don't throw - this is async operation
			return null;
		}
	}
}
