import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { Request } from 'express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { User } from '../user/entities/user.entity';
import { Organisation } from '../organisation/entities/organisation.entity';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { UserProfile } from '../user/entities/user.profile.entity';
import { UserEmployeementProfile } from '../user/entities/user.employeement.profile.entity';
import { LicensingService } from '../licensing/licensing.service';
import { AccessLevel } from '../lib/enums/user.enums';
import { GeneralStatus } from '../lib/enums/status.enums';

@Injectable()
export class ClerkService {
	private readonly logger = new Logger(ClerkService.name);
	private readonly clerkClientInstance;
	// Lock mechanism to prevent concurrent syncs for the same user
	private readonly syncLocks = new Map<string, Promise<User | null>>();
	// Lock mechanism to prevent concurrent organization creation
	private readonly orgLocks = new Map<string, Promise<Organisation | null>>();
	// Cache TTL for organization lookups (5 minutes)
	private readonly ORG_CACHE_TTL = 300000;
	private readonly ORG_CACHE_PREFIX = 'org:';
	// Cache TTL for user lookups (30 seconds, matching UserService)
	private readonly USER_CACHE_TTL = 30000;
	private readonly USER_CACHE_PREFIX = 'users:';

	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		@InjectRepository(Organisation)
		private readonly organisationRepository: Repository<Organisation>,
		@InjectRepository(ClientAuth)
		private readonly clientAuthRepository: Repository<ClientAuth>,
		@InjectRepository(UserProfile)
		private readonly userProfileRepository: Repository<UserProfile>,
		@InjectRepository(UserEmployeementProfile)
		private readonly userEmployeementProfileRepository: Repository<UserEmployeementProfile>,
		private readonly configService: ConfigService,
		private readonly licensingService: LicensingService,
		@Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
	) {
		const secretKey = this.configService.get<string>('CLERK_SECRET_KEY');
		const publishableKey = this.configService.get<string>('CLERK_PUBLISHABLE_KEY');
		if (!secretKey) {
			this.logger.warn('CLERK_SECRET_KEY not configured - Clerk features will be disabled');
			this.clerkClientInstance = null;
		} else {
			this.clerkClientInstance = createClerkClient({ 
				secretKey,
				publishableKey,
			});
		}
	}

	/**
	 * Authenticate request using Clerk's authenticateRequest() function
	 * This is the recommended way to authenticate requests per Clerk documentation
	 * Supports CSRF protection via authorizedParties and multiple token types
	 */
	async authenticateRequest(
		request: Request,
		options?: {
			acceptsToken?: ('session_token' | 'api_key')[];
			authorizedParties?: string[];
		}
	): Promise<{
		isAuthenticated: boolean;
		userId?: string;
		sessionId?: string;
	}> {
		const operationId = `AUTHENTICATE_REQUEST_${Date.now()}`;
		
		const secretKey = this.configService.get<string>('CLERK_SECRET_KEY');
		if (!secretKey) {
			this.logger.error(`[ClerkService] [${operationId}] ❌ Clerk secret key not configured - CLERK_SECRET_KEY missing`);
			throw new Error('Clerk authentication not configured');
		}

		if (!this.clerkClientInstance) {
			this.logger.error(`[ClerkService] [${operationId}] ❌ Clerk client not initialized`);
			throw new Error('Clerk client not initialized');
		}

		try {
			// Extract token from headers
			const authHeader = request.headers.authorization;
			const tokenHeader = request.headers.token as string;
			const tokenFromAuth = authHeader ? authHeader.split(' ')[1] : undefined;
			const tokenFromHeader = tokenHeader || tokenFromAuth;

			// Get authorized parties from environment variable or options
			const authorizedPartiesEnv = this.configService.get<string>('CLERK_AUTHORIZED_PARTIES');
			const authorizedParties = options?.authorizedParties || 
				(authorizedPartiesEnv ? authorizedPartiesEnv.split(',').map(p => p.trim()).filter(p => p.length > 0) : undefined);

			// Convert Express Request to Web API Request format
			const protocol = request.protocol || 'http';
			const host = request.get('host') || 'localhost';
			const url = `${protocol}://${host}${request.originalUrl || request.url}`;
			
			const headers = new Headers();
			Object.keys(request.headers).forEach(key => {
				const value = request.headers[key];
				if (value) {
					if (Array.isArray(value)) {
						value.forEach(v => headers.append(key, v));
					} else {
						headers.set(key, value);
					}
				}
			});
			
			// CRITICAL FIX: If Authorization header is missing but token header exists, add it
			if (!headers.has('authorization') && tokenFromHeader) {
				headers.set('authorization', `Bearer ${tokenFromHeader}`);
			}

			// Create Web API Request
			const webRequest = new Request(url, {
				method: request.method,
				headers,
				body: request.method !== 'GET' && request.method !== 'HEAD' && request.body 
					? JSON.stringify(request.body) 
					: undefined,
			});

			// Call Clerk's authenticateRequest via client instance
			const requestState = await this.clerkClientInstance.authenticateRequest(webRequest, {
				authorizedParties,
				acceptsToken: options?.acceptsToken || ['session_token'],
			});

			if (!requestState.isAuthenticated || !requestState.userId) {
				// Only log failures at warning level, not every unauthenticated request
				return {
					isAuthenticated: false,
				};
			}

			return {
				isAuthenticated: true,
				userId: requestState.userId,
				sessionId: requestState.sessionId,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			this.logger.warn(`[ClerkService] Request authentication failed: ${errorMessage}`);
			
			// Provide more specific error messages
			if (errorMessage.includes('expired') || errorMessage.includes('ExpiredTokenError')) {
				throw new Error('Token has expired. Please sign in again.');
			} else if (errorMessage.includes('invalid') || errorMessage.includes('InvalidTokenError')) {
				throw new Error('Invalid token. Please sign in again.');
			} else if (errorMessage.includes('signature') || errorMessage.includes('SignatureVerificationError')) {
				throw new Error('Token signature verification failed.');
			} else if (errorMessage.includes('CSRF') || errorMessage.includes('authorized')) {
				throw new Error('Request origin not authorized.');
			}
			
			throw new Error(`Request authentication failed: ${errorMessage}`);
		}
	}

	/**
	 * Verify Clerk session token and extract user ID
	 * Critical path - synchronous operation
	 * @deprecated Use authenticateRequest() instead for better CSRF protection
	 */
	async verifyToken(token: string): Promise<{ userId: string; sessionId?: string }> {
		const operationId = `VERIFY_TOKEN_${Date.now()}`;
		
		const secretKey = this.configService.get<string>('CLERK_SECRET_KEY');
		if (!secretKey) {
			this.logger.error(`[${operationId}] Clerk secret key not configured - CLERK_SECRET_KEY missing`);
			throw new Error('Clerk authentication not configured');
		}

		try {
			// verifyToken is a standalone function from @clerk/backend
			const verification = await verifyToken(token, {
				secretKey,
			});
			
			// Extract user ID from 'sub' claim and session ID from 'sid' claim
			const userId = verification.sub;
			const sessionId = verification.sid;
			
			if (!userId) {
				this.logger.warn(`[${operationId}] Token verification failed - missing user ID (sub claim)`);
				throw new Error('Invalid token: missing user ID');
			}

			this.logger.debug(`[${operationId}] Token verified successfully`);

			return {
				userId,
				sessionId,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			this.logger.error(`[${operationId}] Token verification failed:`, errorMessage);
			
			// Provide more specific error messages
			if (errorMessage.includes('expired') || errorMessage.includes('ExpiredTokenError')) {
				throw new Error('Token has expired. Please sign in again.');
			} else if (errorMessage.includes('invalid') || errorMessage.includes('InvalidTokenError')) {
				throw new Error('Invalid token. Please sign in again.');
			} else if (errorMessage.includes('signature') || errorMessage.includes('SignatureVerificationError')) {
				throw new Error('Token signature verification failed.');
			}
			
			throw new Error(`Token verification failed: ${errorMessage}`);
		}
	}

	/**
	 * Get user from Clerk API by Clerk user ID
	 * Returns full Clerk user object with metadata
	 */
	async getClerkUser(clerkUserId: string): Promise<any | null> {
		const operationId = `GET_CLERK_USER_${clerkUserId}_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.warn(`[${operationId}] Clerk client not initialized - CLERK_SECRET_KEY missing`);
			return null;
		}

		try {
			const clerkUser = await this.clerkClientInstance.users.getUser(clerkUserId);
			return clerkUser;
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to get Clerk user:`, error instanceof Error ? error.message : 'Unknown error');
			return null;
		}
	}

	/**
	 * Update user metadata in Clerk
	 * Async operation - non-blocking
	 */
	async updateClerkUserMetadata(
		clerkUserId: string,
		updates: {
			publicMetadata?: Record<string, any>;
			privateMetadata?: Record<string, any>;
		}
	): Promise<void> {
		const operationId = `UPDATE_METADATA_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.warn(`[${operationId}] Clerk client not initialized - skipping metadata update`);
			return;
		}

		setImmediate(async () => {
			try {
				await this.clerkClientInstance.users.updateUser(clerkUserId, updates);
				this.logger.log(`[${operationId}] User metadata updated successfully`);
			} catch (error) {
				this.logger.error(`[${operationId}] Failed to update user metadata:`, error instanceof Error ? error.message : 'Unknown error');
			}
		});
	}

	/**
	 * Update user profile in Clerk (firstName, lastName, email, phoneNumber, imageUrl, password)
	 * Synchronous operation - should be awaited
	 * @param clerkUserId - Clerk user ID
	 * @param updates - Profile fields to update
	 * @returns Promise<boolean> - true if update was successful, false otherwise
	 */
	async updateClerkUserProfile(
		clerkUserId: string,
		updates: {
			firstName?: string;
			lastName?: string;
			email?: string;
			phoneNumber?: string;
			imageUrl?: string;
			password?: string;
		}
	): Promise<boolean> {
		const operationId = `UPDATE_PROFILE_${clerkUserId}_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.warn(`[${operationId}] Clerk client not initialized - skipping profile update`);
			return false;
		}

		try {
			// Build update payload for Clerk API
			const clerkUpdatePayload: any = {};

			// Direct field mappings
			if (updates.firstName !== undefined) {
				clerkUpdatePayload.firstName = updates.firstName;
			}
			if (updates.lastName !== undefined) {
				clerkUpdatePayload.lastName = updates.lastName;
			}
			if (updates.imageUrl !== undefined) {
				clerkUpdatePayload.imageUrl = updates.imageUrl;
			}
			if (updates.password !== undefined && updates.password.trim().length > 0) {
				clerkUpdatePayload.password = updates.password;
			}

			// Handle email update - Clerk requires creating/updating email address first
			if (updates.email !== undefined) {
				try {
					// Get current user to check existing emails
					const clerkUser = await this.clerkClientInstance.users.getUser(clerkUserId);
					const existingEmails = clerkUser.emailAddresses || [];
					
					// Check if email already exists
					const existingEmail = existingEmails.find(
						(e: any) => e.emailAddress === updates.email
					);

					if (existingEmail) {
						// Email exists, set as primary if not already
						if (!existingEmail.id) {
							// Create email if it doesn't have an ID (shouldn't happen, but safety check)
							await this.clerkClientInstance.users.createEmailAddress({
								userId: clerkUserId,
								emailAddress: updates.email,
							});
						} else {
							// Set existing email as primary
							clerkUpdatePayload.primaryEmailAddressId = existingEmail.id;
						}
					} else {
						// Create new email address
						const newEmail = await this.clerkClientInstance.users.createEmailAddress({
							userId: clerkUserId,
							emailAddress: updates.email,
						});
						clerkUpdatePayload.primaryEmailAddressId = newEmail.id;
					}
				} catch (emailError) {
					this.logger.warn(`[${operationId}] Failed to handle email update:`, emailError instanceof Error ? emailError.message : 'Unknown error');
					// Continue with other updates even if email fails
				}
			}

			// Handle phone number update - Clerk requires creating/updating phone number first
			if (updates.phoneNumber !== undefined && updates.phoneNumber.trim().length > 0) {
				try {
					// Get current user to check existing phone numbers
					const clerkUser = await this.clerkClientInstance.users.getUser(clerkUserId);
					const existingPhones = clerkUser.phoneNumbers || [];
					
					// Check if phone already exists
					const existingPhone = existingPhones.find(
						(p: any) => p.phoneNumber === updates.phoneNumber
					);

					if (existingPhone) {
						// Phone exists, set as primary if not already
						if (existingPhone.id) {
							clerkUpdatePayload.primaryPhoneNumberId = existingPhone.id;
						}
					} else {
						// Create new phone number
						const newPhone = await this.clerkClientInstance.users.createPhoneNumber({
							userId: clerkUserId,
							phoneNumber: updates.phoneNumber,
						});
						clerkUpdatePayload.primaryPhoneNumberId = newPhone.id;
					}
				} catch (phoneError) {
					this.logger.warn(`[${operationId}] Failed to handle phone update:`, phoneError instanceof Error ? phoneError.message : 'Unknown error');
					// Continue with other updates even if phone fails
				}
			}

			// Only call updateUser if there are fields to update
			if (Object.keys(clerkUpdatePayload).length > 0) {
				await this.clerkClientInstance.users.updateUser(clerkUserId, clerkUpdatePayload);
				this.logger.log(`[${operationId}] User profile updated successfully in Clerk`);
				return true;
			} else {
				this.logger.debug(`[${operationId}] No valid fields to update in Clerk`);
				return true; // Return true as there's nothing to update
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			this.logger.error(`[${operationId}] Failed to update user profile in Clerk:`, errorMessage);
			return false;
		}
	}

	/**
	 * List users from Clerk API with pagination
	 * Useful for admin operations and bulk sync
	 */
	async listClerkUsers(options?: {
		limit?: number;
		offset?: number;
		orderBy?: string;
	}): Promise<{ users: any[]; totalCount: number }> {
		const operationId = `LIST_USERS_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.warn(`[${operationId}] Clerk client not initialized - CLERK_SECRET_KEY missing`);
			return { users: [], totalCount: 0 };
		}

		try {
			const result = await this.clerkClientInstance.users.getUserList({
				limit: options?.limit || 10,
				offset: options?.offset || 0,
				orderBy: options?.orderBy || '-created_at',
			});

			return {
				users: result.data || [],
				totalCount: result.totalCount || 0,
			};
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to list Clerk users:`, error instanceof Error ? error.message : 'Unknown error');
			return { users: [], totalCount: 0 };
		}
	}

	/**
	 * Get user from database by Clerk user ID
	 * Critical path - synchronous operation
	 * @param clerkUserId - Clerk user ID
	 * @param relations - Optional array of relations to load (defaults to all needed relations)
	 */
	async getUserByClerkId(clerkUserId: string, relations?: string[]): Promise<User | null> {
		const operationId = `GET_USER_${clerkUserId}_${Date.now()}`;
		
		try {
			// Default relations needed for sync operations
			const defaultRelations = relations || ['organisation', 'branch', 'userProfile', 'userEmployeementProfile'];
			
			const user = await this.userRepository.findOne({
				where: { clerkUserId },
				relations: defaultRelations,
			});

			return user;
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to lookup user:`, error instanceof Error ? error.message : 'Unknown error');
			throw error;
		}
	}

	/**
	 * Cache user data after successful sync operations
	 * Uses same cache key format as UserService for consistency
	 * @param user - User entity to cache
	 */
	async cacheUserAfterSync(user: User): Promise<void> {
		try {
			if (!user?.uid) {
				return;
			}

			const cacheKey = `${this.USER_CACHE_PREFIX}${user.uid}`;
			await this.cacheManager.set(cacheKey, user, this.USER_CACHE_TTL);
			this.logger.debug(`Cached user ${user.uid} after sync`);
		} catch (error) {
			// Don't throw - caching failure shouldn't prevent sync
			this.logger.warn(`Failed to cache user after sync:`, error instanceof Error ? error.message : 'Unknown error');
		}
	}

	/**
	 * Fetch organization memberships for a Clerk user
	 */
	async getUserOrganizationMemberships(clerkUserId: string): Promise<any[]> {
		const operationId = `GET_ORG_MEMBERSHIPS_${clerkUserId}_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.warn(`[${operationId}] Clerk client not initialized - skipping`);
			return [];
		}

		try {
			const result = await this.clerkClientInstance.users.getOrganizationMembershipList({
				userId: clerkUserId,
				limit: 10,
			});

			return result.data || [];
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to fetch organization memberships:`, error instanceof Error ? error.message : 'Unknown error');
			return [];
		}
	}

	/**
	 * Find or create organization by Clerk org ID
	 * Returns Organisation entity with internal uid or null
	 */
	private async findOrCreateOrganizationByClerkId(clerkOrgId: string): Promise<Organisation | null> {
		const operationId = `FIND_OR_CREATE_ORG_${clerkOrgId}_${Date.now()}`;
		
		try {
			// Check cache first
			const cacheKey = `${this.ORG_CACHE_PREFIX}${clerkOrgId}`;
			const cachedOrg = await this.cacheManager.get<Organisation>(cacheKey);
			if (cachedOrg) {
				this.logger.debug(`[${operationId}] Organization found in cache`);
				return cachedOrg;
			}

			// Check if organization exists in DB by matching either clerkOrgId or ref
			// This ensures we find organizations regardless of which field was used during creation
			let org = await this.organisationRepository.findOne({
				where: [
					{ clerkOrgId },
					{ ref: clerkOrgId }
				],
			});

			if (org) {
				this.logger.debug(`[${operationId}] Organization found (matched by ${org.clerkOrgId === clerkOrgId ? 'clerkOrgId' : 'ref'})`);
				// Cache the organization
				await this.cacheManager.set(cacheKey, org, this.ORG_CACHE_TTL);
				return org;
			}

			// Organization doesn't exist, fetch from Clerk and create
			this.logger.debug(`[${operationId}] Organization not found, fetching from Clerk API...`);
			
			if (!this.clerkClientInstance) {
				this.logger.warn(`[${operationId}] Clerk client not initialized - cannot fetch org`);
				return null;
			}

			try {
				const clerkOrg = await this.clerkClientInstance.organizations.getOrganization({
					organizationId: clerkOrgId,
				});

				if (clerkOrg) {
					// Create organization using existing handler
					await this.handleOrganizationCreated(clerkOrgId, {
						name: clerkOrg.name,
						slug: clerkOrg.slug,
					});

					// Fetch the newly created organization by matching either clerkOrgId or ref
					org = await this.organisationRepository.findOne({
						where: [
							{ clerkOrgId },
							{ ref: clerkOrgId }
						],
					});

					if (org) {
						this.logger.log(`[${operationId}] Organization created successfully`);
						// Cache the newly created organization
						await this.cacheManager.set(cacheKey, org, this.ORG_CACHE_TTL);
						return org;
					}
				}
			} catch (clerkError) {
				this.logger.warn(`[${operationId}] Failed to fetch organization from Clerk API:`, {
					error: clerkError instanceof Error ? clerkError.message : 'Unknown error',
				});
			}

			return null;
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to find or create organization:`, error instanceof Error ? error.message : 'Unknown error');
			return null;
		}
	}

	/**
	 * Public method to sync user's organization membership from Clerk
	 * Links user to organization using Clerk org ID
	 * @param user - User entity to sync organization membership for
	 * @param clerkUserId - Clerk user ID
	 * @returns Promise<User | null> - Updated user object if sync was successful, null otherwise
	 */
	async syncUserOrganizationForUser(user: User, clerkUserId: string): Promise<User | null> {
		const operationId = `SYNC_ORG_MEMBERSHIP_${clerkUserId}_${Date.now()}`;
		return this.syncUserOrganizationMembership(user, clerkUserId, operationId);
	}

	/**
	 * Public method to ensure user profiles exist (create if they don't)
	 * This allows for smoother sync between users and the app
	 * @param user - User entity to ensure profiles for
	 * @param clerkUserId - Clerk user ID
	 */
	async ensureUserProfilesForUser(user: User, clerkUserId: string): Promise<void> {
		const operationId = `ENSURE_PROFILES_${clerkUserId}_${Date.now()}`;
		return this.ensureUserProfilesExist(user, clerkUserId, operationId);
	}

	/**
	 * Sync user's organization membership from Clerk
	 * Links user to organization using Clerk org ID
	 * @returns Promise<User | null> - Updated user object if sync was successful, null otherwise
	 */
	private async syncUserOrganizationMembership(user: User, clerkUserId: string, operationId: string): Promise<User | null> {
		try {
			this.logger.debug(`[${operationId}] Starting organization membership sync for user ${user.uid} (Clerk ID: ${clerkUserId})`);
			
			const memberships = await this.getUserOrganizationMemberships(clerkUserId);

			if (memberships.length === 0) {
				this.logger.debug(`[${operationId}] User has no organization memberships - skipping sync`);
				return null;
			}

			if (memberships.length > 1) {
				this.logger.log(`[${operationId}] User has ${memberships.length} organization memberships, using first one`);
			}

			const clerkOrgId = memberships[0]?.organization?.id;
			if (!clerkOrgId) {
				this.logger.warn(`[${operationId}] Invalid organization membership data - missing organization.id`);
				return null;
			}

			this.logger.debug(`[${operationId}] Found organization membership - Clerk Org ID: ${clerkOrgId}`);

			const org = await this.findOrCreateOrganizationByClerkId(clerkOrgId);
			if (!org) {
				this.logger.warn(`[${operationId}] Could not find or create organization (Clerk Org ID: ${clerkOrgId}) - user not linked to org`);
				return null;
			}

			// Link user to organization using the Clerk org ID
			// This ensures organisationRef matches both the ref and clerkOrgId columns
			// (For Clerk-created orgs, ref === clerkOrgId, but we use clerkOrgId explicitly)
			// Fallback to ref if clerkOrgId is null (for legacy orgs)
			const orgRefToUse = org.clerkOrgId || org.ref;
			if (!orgRefToUse) {
				this.logger.error(`[${operationId}] Organization has neither clerkOrgId nor ref set - cannot link user`);
				return null;
			}

			const previousOrgRef = user.organisationRef;
			user.organisationRef = orgRefToUse;
			// Set the relation object for TypeORM (it will resolve via the JoinColumn)
			user.organisation = org;

			this.logger.log(`[${operationId}] ✅ Successfully linked user ${user.uid} to organization (organisationRef: ${orgRefToUse}, clerkOrgId: ${org.clerkOrgId || 'null'}, ref: ${org.ref}, previousOrgRef: ${previousOrgRef || 'null'})`);
			return user;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`[${operationId}] ❌ Failed to sync organization membership:`, {
				error: errorMessage,
				stack: errorStack,
				userId: user.uid,
				clerkUserId,
			});
			// Don't throw - org sync failure shouldn't prevent user creation/update
			return null;
		}
	}

	/**
	 * Ensure user profiles exist (create if they don't)
	 * This allows for smoother sync between users and the app
	 * @param user - User entity to ensure profiles for
	 * @param clerkUserId - Clerk user ID
	 * @param operationId - Operation ID for logging
	 */
	private async ensureUserProfilesExist(user: User, clerkUserId: string, operationId: string): Promise<void> {
		try {
			// Check if userProfile exists - use loaded relation first to avoid DB query
			if (!user.userProfile) {
				// Only query DB if relation wasn't loaded
				const existingProfile = await this.userProfileRepository.findOne({
					where: { ownerClerkUserId: clerkUserId },
				});

				if (!existingProfile) {
					this.logger.debug(`[${operationId}] Creating user profile for user ${user.uid}`);
					const userProfile = this.userProfileRepository.create({
						ownerClerkUserId: clerkUserId,
					});
					await this.userProfileRepository.save(userProfile);
					// Update user relation to avoid reload
					user.userProfile = userProfile;
					this.logger.log(`[${operationId}] ✅ User profile created successfully`);
				} else {
					// Update user relation to avoid reload
					user.userProfile = existingProfile;
					this.logger.debug(`[${operationId}] User profile already exists, skipping creation`);
				}
			} else {
				this.logger.debug(`[${operationId}] User profile already linked, skipping creation`);
			}

			// Check if userEmployeementProfile exists - use loaded relation first to avoid DB query
			if (!user.userEmployeementProfile) {
				// Only query DB if relation wasn't loaded
				const existingEmploymentProfile = await this.userEmployeementProfileRepository.findOne({
					where: { ownerClerkUserId: clerkUserId },
				});

				if (!existingEmploymentProfile) {
					this.logger.debug(`[${operationId}] Creating user employment profile for user ${user.uid}`);
					const employmentProfile = this.userEmployeementProfileRepository.create({
						ownerClerkUserId: clerkUserId,
						isCurrentlyEmployed: true,
					});
					await this.userEmployeementProfileRepository.save(employmentProfile);
					// Update user relation to avoid reload
					user.userEmployeementProfile = employmentProfile;
					this.logger.log(`[${operationId}] ✅ User employment profile created successfully`);
				} else {
					// Update user relation to avoid reload
					user.userEmployeementProfile = existingEmploymentProfile;
					this.logger.debug(`[${operationId}] User employment profile already exists, skipping creation`);
				}
			} else {
				this.logger.debug(`[${operationId}] User employment profile already linked, skipping creation`);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`[${operationId}] ❌ Failed to ensure user profiles exist:`, {
				error: errorMessage,
				stack: errorStack,
				userId: user.uid,
				clerkUserId,
			});
			// Don't throw - profile creation failure shouldn't prevent user sync
		}
	}

	/**
	 * Get default user preferences
	 */
	private getDefaultUserPreferences(): any {
		return {
			theme: 'light',
			language: 'en',
			notifications: true,
			shiftAutoEnd: false,
			timezone: 'Africa/Johannesburg',
			dateFormat: 'DD/MM/YYYY',
			timeFormat: '24h',
			biometricAuth: false,
			advancedFeatures: false,
			smsNotifications: false,
			emailNotifications: true,
			notificationFrequency: 'real_time',
		};
	}

	/**
	 * Map string access level to AccessLevel enum
	 */
	private mapToAccessLevel(level: string): AccessLevel {
		if (!level || typeof level !== 'string') {
			return AccessLevel.USER;
		}

		const normalizedLevel = level.toLowerCase().trim();
		
		// Map common variations to enum values
		const levelMap: Record<string, AccessLevel> = {
			'owner': AccessLevel.OWNER,
			'admin': AccessLevel.ADMIN,
			'administrator': AccessLevel.ADMIN,
			'manager': AccessLevel.MANAGER,
			'supervisor': AccessLevel.SUPERVISOR,
			'user': AccessLevel.USER,
			'developer': AccessLevel.DEVELOPER,
			'support': AccessLevel.SUPPORT,
			'analyst': AccessLevel.ANALYST,
			'accountant': AccessLevel.ACCOUNTANT,
			'auditor': AccessLevel.AUDITOR,
			'consultant': AccessLevel.CONSULTANT,
			'coordinator': AccessLevel.COORDINATOR,
			'specialist': AccessLevel.SPECIALIST,
			'technician': AccessLevel.TECHNICIAN,
			'trainer': AccessLevel.TRAINER,
			'researcher': AccessLevel.RESEARCHER,
			'officer': AccessLevel.OFFICER,
			'executive': AccessLevel.EXECUTIVE,
			'cashier': AccessLevel.CASHIER,
			'receptionist': AccessLevel.RECEPTIONIST,
			'secretary': AccessLevel.SECRETARY,
			'security': AccessLevel.SECURITY,
			'cleaner': AccessLevel.CLEANER,
			'maintenance': AccessLevel.MAINTENANCE,
			'event planner': AccessLevel.EVENT_PLANNER,
			'marketing': AccessLevel.MARKETING,
			'hr': AccessLevel.HR,
			'client': AccessLevel.CLIENT,
			'finance': AccessLevel.FINANCE,
			'accounting': AccessLevel.ACCOUNTING,
			'legal': AccessLevel.LEGAL,
			'operations': AccessLevel.OPERATIONS,
			'it': AccessLevel.IT,
			'development': AccessLevel.DEVELOPMENT,
			'design': AccessLevel.DESIGN,
		};

		return levelMap[normalizedLevel] || AccessLevel.USER;
	}

	/**
	 * Sync user from Clerk API to database
	 * Async operation - non-blocking
	 * Uses lock mechanism to prevent concurrent syncs for the same user
	 */
	async syncUserFromClerk(clerkUserId: string): Promise<User | null> {
		// Check if sync already in progress for this user
		const existingLock = this.syncLocks.get(clerkUserId);
		if (existingLock) {
			// Return existing promise to prevent duplicate syncs
			return existingLock;
		}

		// Create new sync promise
		const syncPromise = this.performUserSync(clerkUserId);
		this.syncLocks.set(clerkUserId, syncPromise);

		try {
			const result = await syncPromise;
			return result;
		} finally {
			// Always remove lock when done
			this.syncLocks.delete(clerkUserId);
		}
	}

	/**
	 * Internal method that performs the actual user sync
	 * Called by syncUserFromClerk with lock protection
	 */
	private async performUserSync(clerkUserId: string): Promise<User | null> {
		const operationId = `SYNC_USER_${Date.now()}`;
		
		if (!this.clerkClientInstance) {
			this.logger.warn(`[${operationId}] Clerk client not initialized - skipping sync`);
			return null;
		}

		try {
			// Check if user already exists (may have been created by concurrent request)
			let user = await this.userRepository.findOne({
				where: { clerkUserId },
			});

			if (user) {
				// User already exists, fetch latest from Clerk and update
				this.logger.debug(`[${operationId}] User exists, fetching latest data from Clerk API`);
				const clerkUser = await this.clerkClientInstance.users.getUser(clerkUserId);
				
				if (!clerkUser) {
					this.logger.warn(`[${operationId}] User not found in Clerk`);
					return user; // Return existing user
				}

				// Update existing user with latest Clerk data
				const email = clerkUser.emailAddresses?.[0]?.emailAddress;
				const firstName = clerkUser.firstName || '';
				const lastName = clerkUser.lastName || '';
				const username = clerkUser.username || null;
				const phone = clerkUser.phoneNumbers?.[0]?.phoneNumber || null;
				const DEFAULT_PROFILE_PICTURE_URL = 'https://cdn-icons-png.flaticon.com/128/1144/1144709.png';
				const rawPhotoURL = clerkUser.imageUrl || null;
				const photoURL = (!rawPhotoURL || rawPhotoURL.includes('example.com')) 
					? DEFAULT_PROFILE_PICTURE_URL 
					: rawPhotoURL;
				const avatar = photoURL;
				const role = clerkUser.publicMetadata?.role || 
				            clerkUser.privateMetadata?.role || 
				            'user';
				const accessLevelStr = clerkUser.publicMetadata?.accessLevel || 
				                      clerkUser.privateMetadata?.accessLevel || 
				                      'user';
				const accessLevel = this.mapToAccessLevel(accessLevelStr);

				user.email = email || user.email;
				user.name = firstName || user.name;
				user.surname = lastName || user.surname;
				if (username) {
					user.username = username;
				}
				user.photoURL = photoURL;
				user.avatar = avatar;
				if (phone) {
					user.phone = phone;
				}
				if (role && role !== 'user') {
					user.role = role;
				}
				if (accessLevel !== AccessLevel.USER) {
					user.accessLevel = accessLevel;
				}
				user.clerkLastSyncedAt = new Date();

			user = await this.userRepository.save(user);
			// Parallelize org sync and profile creation for better performance
			await Promise.all([
				this.syncUserOrganizationMembership(user, clerkUserId, operationId),
				this.ensureUserProfilesExist(user, clerkUserId, operationId)
			]);
				this.updateClerkUserMetadata(clerkUserId, {
					publicMetadata: {
						role: user.role,
						internalId: user.uid,
						accessLevel: user.accessLevel,
					},
					privateMetadata: {
						syncStatus: 'synced',
						lastSyncedAt: new Date().toISOString(),
					},
				});

				return user;
			}

			// User doesn't exist, fetch from Clerk and create
			this.logger.debug(`[${operationId}] Fetching user from Clerk API...`);
			const clerkUser = await this.clerkClientInstance.users.getUser(clerkUserId);
			
			if (!clerkUser) {
				this.logger.warn(`[${operationId}] User not found in Clerk`);
				return null;
			}

			// Extract user data from Clerk user
			const email = clerkUser.emailAddresses?.[0]?.emailAddress;
			const firstName = clerkUser.firstName || '';
			const lastName = clerkUser.lastName || '';
			const username = clerkUser.username || null;
			const phone = clerkUser.phoneNumbers?.[0]?.phoneNumber || null;
			const DEFAULT_PROFILE_PICTURE_URL = 'https://cdn-icons-png.flaticon.com/128/1144/1144709.png';
			const rawPhotoURL = clerkUser.imageUrl || null;
			const photoURL = (!rawPhotoURL || rawPhotoURL.includes('example.com')) 
				? DEFAULT_PROFILE_PICTURE_URL 
				: rawPhotoURL;
			const avatar = photoURL;
			const role = clerkUser.publicMetadata?.role || 
			            clerkUser.privateMetadata?.role || 
			            'user';
			const accessLevelStr = clerkUser.publicMetadata?.accessLevel || 
			                      clerkUser.privateMetadata?.accessLevel || 
			                      'user';
			const accessLevel = this.mapToAccessLevel(accessLevelStr);

			// Validate required fields
			if (!email) {
				this.logger.error(`[${operationId}] Clerk user missing email - cannot sync`);
				return null;
			}

			// Check if user exists by email (for migration)
			const existingUser = await this.userRepository.findOne({
				where: { email },
			});

			if (existingUser) {
				// Link existing user to Clerk
				this.logger.debug(`[${operationId}] Linking existing user to Clerk`);
				existingUser.clerkUserId = clerkUserId;
				existingUser.clerkLastSyncedAt = new Date();
				user = await this.userRepository.save(existingUser);
				await this.syncUserOrganizationMembership(user, clerkUserId, operationId);
				await this.ensureUserProfilesExist(user, clerkUserId, operationId);
				this.updateClerkUserMetadata(clerkUserId, {
					publicMetadata: {
						role: user.role,
						internalId: user.uid,
						accessLevel: user.accessLevel,
					},
					privateMetadata: {
						syncStatus: 'synced',
						lastSyncedAt: new Date().toISOString(),
					},
				});
				return user;
			}

			// Username is optional - only set if provided by Clerk and ensure uniqueness
			let finalUsername: string | null = null;
			if (username) {
				let usernameAttempts = 0;
				const maxUsernameAttempts = 10;
				finalUsername = username;
				
				while (usernameAttempts < maxUsernameAttempts) {
					const existingUsername = await this.userRepository.findOne({
						where: { username: finalUsername },
						select: ['uid'],
					});
					
					if (!existingUsername) {
						break;
					}
					
					usernameAttempts++;
					finalUsername = `${username}_${usernameAttempts}`;
				}

				if (usernameAttempts >= maxUsernameAttempts) {
					this.logger.warn(`[${operationId}] Failed to generate unique username after ${maxUsernameAttempts} attempts - setting to null`);
					finalUsername = null;
				}
			}

			// Create new user with all required fields
			this.logger.debug(`[${operationId}] Creating new user`);
			user = this.userRepository.create({
				clerkUserId,
				email,
				name: firstName || 'User',
				surname: lastName || '',
				username: finalUsername,
				phone,
				photoURL,
				avatar,
				role,
				status: 'active',
				accessLevel,
				userref: null,
				preferences: this.getDefaultUserPreferences(),
				clerkLastSyncedAt: new Date(),
				isDeleted: false,
			});

			// Save user - handle duplicate key errors gracefully
			try {
				user = await this.userRepository.save(user);
			} catch (saveError) {
				const errorMessage = saveError instanceof Error ? saveError.message : 'Unknown error';
				
				// If duplicate key error, user was created by concurrent request
				if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
					this.logger.debug(`[${operationId}] User created by concurrent request, fetching existing user`);
					// Fetch the user that was created by the concurrent request
					user = await this.userRepository.findOne({
						where: { clerkUserId },
					});
					
					if (user) {
						// Parallelize org sync and profile creation
						await Promise.all([
							this.syncUserOrganizationMembership(user, clerkUserId, operationId),
							this.ensureUserProfilesExist(user, clerkUserId, operationId)
						]);
						return user;
					}
				}
				
				// Re-throw if not a duplicate key error
				throw saveError;
			}

			// Parallelize org sync and profile creation for better performance
			await Promise.all([
				this.syncUserOrganizationMembership(user, clerkUserId, operationId),
				this.ensureUserProfilesExist(user, clerkUserId, operationId)
			]);

			// Update Clerk metadata with internal user ID (async, non-blocking)
			this.updateClerkUserMetadata(clerkUserId, {
				publicMetadata: {
					role: user.role,
					internalId: user.uid,
					accessLevel: user.accessLevel,
					userref: user.userref,
				},
				privateMetadata: {
					syncStatus: 'synced',
					lastSyncedAt: new Date().toISOString(),
				},
			});

			return user;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			
			// Handle duplicate key errors gracefully
			if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
				this.logger.debug(`[${operationId}] Database constraint violation - fetching existing user`);
				// Try to fetch the user that was created
				const existingUser = await this.userRepository.findOne({
					where: { clerkUserId },
				});
				if (existingUser) {
					return existingUser;
				}
			}
			
			// Log error but don't throw - this is async operation
			this.logger.error(`[${operationId}] Failed to sync user from Clerk: ${errorMessage}`);
			return null;
		}
	}

	/**
	 * Handle webhook user.created event
	 * Async operation - non-blocking
	 */
	async handleUserCreated(clerkUserId: string, clerkUserData: any): Promise<void> {
		const operationId = `WEBHOOK_USER_CREATED_${clerkUserId}_${Date.now()}`;
		
		this.logger.log(`[${operationId}] Received user.created webhook`);

		setImmediate(async () => {
			try {
				const user = await this.syncUserFromClerk(clerkUserId);
				
				if (user) {
					this.logger.log(`[${operationId}] User created webhook processed successfully`);
				} else {
					this.logger.warn(`[${operationId}] User sync returned null - user may not have been created`);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				const errorStack = error instanceof Error ? error.stack : undefined;
				
				this.logger.error(`[${operationId}] Failed to process user.created webhook:`, {
					error: errorMessage,
					stack: errorStack,
				});
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
		
		this.logger.debug(`[${operationId}] Received user.updated webhook`);

		setImmediate(async () => {
			try {
				const user = await this.syncUserFromClerk(clerkUserId);
				
				if (user) {
					this.logger.log(`[${operationId}] User updated webhook processed successfully`);
				} else {
					this.logger.warn(`[${operationId}] User sync returned null`);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				const errorStack = error instanceof Error ? error.stack : undefined;
				
				this.logger.error(`[${operationId}] Failed to process user.updated webhook:`, {
					error: errorMessage,
					stack: errorStack,
					clerkUserId,
				});
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
		
		this.logger.log(`[${operationId}] Received user.deleted webhook`);

		setImmediate(async () => {
			try {
				const user = await this.userRepository.findOne({
					where: { clerkUserId },
				});

				if (user) {
					user.isDeleted = true;
					user.clerkUserId = null; // Remove Clerk link
					await this.userRepository.save(user);
					this.logger.log(`[${operationId}] User marked as deleted`);
				} else {
					this.logger.warn(`[${operationId}] User not found for deletion`);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				const errorStack = error instanceof Error ? error.stack : undefined;
				
				this.logger.error(`[${operationId}] Failed to process user.deleted webhook:`, {
					error: errorMessage,
					stack: errorStack,
					clerkUserId,
				});
				// Don't throw - webhook already acknowledged
			}
		});
	}

	/**
	 * Handle webhook organization.created event
	 * Async operation - non-blocking
	 */
	async handleOrganizationCreated(clerkOrgId: string, orgData: any): Promise<void> {
		// Check if organization creation already in progress
		const existingLock = this.orgLocks.get(clerkOrgId);
		if (existingLock) {
			// Return existing promise to prevent duplicate creation
			return existingLock.then(() => undefined);
		}

		// Create new organization creation promise
		const orgPromise = this.performOrganizationCreation(clerkOrgId, orgData);
		this.orgLocks.set(clerkOrgId, orgPromise);

		// Execute asynchronously (non-blocking)
		setImmediate(async () => {
			try {
				await orgPromise;
			} catch (error) {
				// Error already logged in performOrganizationCreation
			} finally {
				// Always remove lock when done
				this.orgLocks.delete(clerkOrgId);
			}
		});
	}

	/**
	 * Internal method that performs the actual organization creation
	 * Called by handleOrganizationCreated with lock protection
	 */
	private async performOrganizationCreation(clerkOrgId: string, orgData: any): Promise<Organisation | null> {
		const operationId = `WEBHOOK_ORG_CREATED_${Date.now()}`;
		
		this.logger.log(`[${operationId}] Received organization.created webhook`);

		try {
			// Check if organization already exists by clerkOrgId
			let organisation = await this.organisationRepository.findOne({
				where: { clerkOrgId },
			});

			if (organisation) {
				// Update existing organization
				this.logger.debug(`[${operationId}] Updating existing organization`);
				organisation.name = orgData.name || organisation.name;
				organisation = await this.organisationRepository.save(organisation);
				this.logger.log(`[${operationId}] Organization updated successfully`);
				return organisation;
			}

			// Create new organization with required fields
			const orgName = orgData.name || `Organization ${clerkOrgId.substring(0, 8)}`;
			const orgEmail = `org-${clerkOrgId.substring(0, 8)}@placeholder.com`;
			const orgPhone = '+0000000000';
			const orgWebsite = orgData.slug ? `https://${orgData.slug}.placeholder.com` : 'https://placeholder.com';
			const orgLogo = 'https://cdn-icons-png.flaticon.com/128/1144/1144709.png';

			organisation = this.organisationRepository.create({
				clerkOrgId,
				name: orgName,
				email: orgEmail,
				phone: orgPhone,
				website: orgWebsite,
				logo: orgLogo,
				ref: clerkOrgId,
				address: {
					street: '',
					suburb: '',
					city: '',
					state: '',
					country: '',
					postalCode: '',
				},
				status: GeneralStatus.ACTIVE,
				isDeleted: false,
			});

			// Save organization - handle duplicate key errors gracefully
			try {
				organisation = await this.organisationRepository.save(organisation);
			} catch (saveError) {
				const errorMessage = saveError instanceof Error ? saveError.message : 'Unknown error';
				
				// If duplicate key error, organization was created by concurrent request
				if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
					this.logger.debug(`[${operationId}] Organization created by concurrent request, fetching existing organization`);
					organisation = await this.organisationRepository.findOne({
						where: { clerkOrgId },
					});
					
					if (organisation) {
						this.logger.log(`[${operationId}] Organization already exists`);
						return organisation;
					}
				}
				
				// Re-throw if not a duplicate key error
				throw saveError;
			}

			this.logger.log(`[${operationId}] Organization created successfully`);
			return organisation;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			
			// Handle duplicate key errors gracefully
			if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
				this.logger.debug(`[${operationId}] Database constraint violation - fetching existing organization`);
				const existingOrg = await this.organisationRepository.findOne({
					where: { clerkOrgId },
				});
				if (existingOrg) {
					return existingOrg;
				}
			}
			
			this.logger.error(`[${operationId}] Failed to process organization.created webhook: ${errorMessage}`);
			return null;
		}
	}

	/**
	 * Handle webhook organizationMembership.created event
	 * Async operation - non-blocking
	 */
	async handleOrganizationMembershipCreated(clerkOrgId: string, clerkUserId: string, role: string): Promise<void> {
		const operationId = `WEBHOOK_ORG_MEMBERSHIP_CREATED_${clerkOrgId}_${clerkUserId}_${Date.now()}`;
		
		this.logger.log(`[${operationId}] Received organizationMembership.created webhook`, {
			clerkOrgId,
			clerkUserId,
			role,
		});

		setImmediate(async () => {
			try {
				// Find user
				const user = await this.userRepository.findOne({
					where: { clerkUserId },
					relations: ['organisation'],
				});

				if (!user) {
					this.logger.warn(`[${operationId}] User not found - skipping organization membership sync`);
					return;
				}

				// Find or create organization by Clerk org ID (search by both clerkOrgId and ref)
				let organisation = await this.organisationRepository.findOne({
					where: [
						{ clerkOrgId },
						{ ref: clerkOrgId }
					],
				});

				if (!organisation) {
					// Organization doesn't exist, try to fetch from Clerk API and create it
					this.logger.debug(`[${operationId}] Organization not found, attempting to fetch from Clerk API...`);
					
					if (this.clerkClientInstance) {
						try {
							const clerkOrg = await this.clerkClientInstance.organizations.getOrganization({
								organizationId: clerkOrgId,
							});

							if (clerkOrg) {
								// Create organization from Clerk data
								await this.handleOrganizationCreated(clerkOrgId, {
									name: clerkOrg.name,
									slug: clerkOrg.slug,
								});

								// Fetch the newly created organization (search by both clerkOrgId and ref)
								organisation = await this.organisationRepository.findOne({
									where: [
										{ clerkOrgId },
										{ ref: clerkOrgId }
									],
								});
							}
						} catch (clerkError) {
							this.logger.warn(`[${operationId}] Failed to fetch organization from Clerk API:`, {
								error: clerkError instanceof Error ? clerkError.message : 'Unknown error',
							});
						}
					}
				}

				if (organisation) {
					// Use the Clerk org ID to ensure organisationRef matches both ref and clerkOrgId
					// (For Clerk-created orgs, ref === clerkOrgId, but we use clerkOrgId explicitly)
					user.organisationRef = organisation.clerkOrgId;
					await this.userRepository.save(user);
					this.logger.log(`[${operationId}] User linked to organization`, {
						clerkOrgId,
						clerkUserId,
						internalUserId: user.uid,
						orgClerkOrgId: organisation.clerkOrgId,
						orgRef: organisation.ref,
						orgName: organisation.name,
					});
				} else {
					this.logger.warn(`[${operationId}] Organization not found and could not be created - user not linked`, {
						clerkOrgId,
						clerkUserId,
					});
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				const errorStack = error instanceof Error ? error.stack : undefined;
				
				this.logger.error(`[${operationId}] Failed to process organizationMembership.created webhook:`, {
					error: errorMessage,
					stack: errorStack,
					clerkOrgId,
					clerkUserId,
				});
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
					this.logger.log(`[${operationId}] User unlinked from organization`);
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
			this.logger.debug(`[${operationId}] Client auth synced successfully`);

			return clientAuth;
		} catch (error) {
			this.logger.error(`[${operationId}] Failed to sync client auth from Clerk:`, error instanceof Error ? error.message : 'Unknown error');
			// Don't throw - this is async operation
			return null;
		}
	}
}
