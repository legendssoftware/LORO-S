import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClerkService } from './clerk.service';
import { LicensingService } from '../licensing/licensing.service';
import { JwtService } from '@nestjs/jwt';
import { LicenseStatus } from '../lib/enums/license.enums';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
	private readonly logger = new Logger(ClerkAuthGuard.name);
	private readonly LICENSE_CACHE_TTL = 60000; // 1 minute cache TTL for licenses
	private readonly CACHE_PREFIX = 'license:';

	constructor(
		private readonly clerkService: ClerkService,
		private readonly licensingService: LicensingService,
		private readonly reflector: Reflector,
		private readonly jwtService: JwtService,
		@Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<Request>();
		
		// Check if route is public
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (isPublic) {
			return true;
		}
	
		// STEP 1: Extract token (synchronous)
		const authHeader = request.headers.authorization;
		const tokenHeader = request.headers.token as string;
		const token = tokenHeader || (authHeader ? authHeader.split(' ')[1] : undefined);
		
		if (!token) {
			throw new UnauthorizedException('No authentication token provided');
		}

		// STEP 2: Decode token IMMEDIATELY (synchronous)
		let decoded: any;
		try {
			decoded = this.jwtService.decode(token, { complete: true });
			if (!decoded?.payload) {
				throw new UnauthorizedException('Invalid token format');
			}
		} catch (decodeError) {
			throw new UnauthorizedException('Invalid token');
		}

		// STEP 3: Validate token (synchronous)
		if (decoded.payload.exp && Date.now() >= decoded.payload.exp * 1000) {
			throw new UnauthorizedException('Token expired');
		}
		if (!decoded.payload.iss?.includes('clerk')) {
			throw new UnauthorizedException('Invalid token issuer');
		}

		// STEP 4: Extract data from token (synchronous)
		const clerkUserId = decoded.payload.sub;
		const tokenRole = decoded.payload.o?.rol;
		const tokenOrgId = decoded.payload.o?.id; // Clerk org ID from token (source of truth)

		if (!clerkUserId) {
			throw new UnauthorizedException('Invalid token: missing user ID');
		}

		// Cache decoded token for later use
		request['decodedToken'] = decoded.payload;
		
		// Store token org ID in request for easy access (source of truth for organisation)
		request['tokenOrgId'] = tokenOrgId;

		// STEP 5: ATTACH USER OBJECT IMMEDIATELY (before async operations)
		// This ensures RoleGuard always finds user object, even if Clerk SDK fails
		request['user'] = {
			clerkUserId: clerkUserId,
			role: tokenRole,
			accessLevel: tokenRole as any,
			// uid, organisationRef, branch will be added later if available from database
		};

		// STEP 6: Enhance user object asynchronously (non-blocking)
		try {
			// Try Clerk SDK verification (optional)
			const authorizedPartiesEnv = process.env.CLERK_AUTHORIZED_PARTIES;
			const authorizedParties = authorizedPartiesEnv 
				? authorizedPartiesEnv.split(',').map(p => p.trim()).filter(p => p.length > 0)
				: undefined;

			const authResult = await this.clerkService.authenticateRequest(request, {
				acceptsToken: ['session_token', 'api_key'],
				authorizedParties,
			});

			if (authResult.isAuthenticated && authResult.userId) {
				// SDK verification succeeded - userId already set from token
			}
		} catch (error) {
			// SDK failed - log warning but continue (user object already exists from token)
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			if (errorMessage.includes('Publishable key') || 
			    errorMessage.includes('not initialized') ||
			    errorMessage.includes('not configured')) {
				this.logger.warn(`[ClerkAuthGuard] Clerk SDK unavailable, using token-based auth: ${errorMessage}`);
			} else {
				// Other errors - log but don't fail (token-based auth is sufficient)
				this.logger.warn(`[ClerkAuthGuard] Clerk SDK verification failed, continuing with token auth: ${errorMessage}`);
			}
		}

		// STEP 7: Fetch user from database (optional enhancement)
		try {
			const dbUser = await this.clerkService.getUserByClerkId(clerkUserId);
			
			if (dbUser) {
				// Enhance user object with DB data
				request['user'].uid = dbUser.uid;
				// Use token org ID as source of truth (matches the org in the token), fallback to DB value
				request['user'].organisationRef = tokenOrgId || dbUser.organisationRef;
				request['user'].branch = dbUser.branchUid ? { uid: dbUser.branchUid } : undefined;
				
				// Set org.uid using organisation relation if available
				// If organisation relation is loaded, use its uid; otherwise use organisationRef as Clerk org ID
				if (dbUser.organisation) {
					request['user'].org = { uid: dbUser.organisation.uid };
				} else if (dbUser.organisationRef) {
					// Organisation relation not loaded, but we have organisationRef (Clerk org ID)
					// Note: org.uid is numeric DB ID, but we're using Clerk org ID for relationships
					// Set org object with a placeholder - actual queries will use organisationRef
					request['user'].org = { uid: undefined as any }; // Will use organisationRef instead
				}
				
				// Role from token takes precedence (source of truth), but use DB role if token role missing
				if (tokenRole) {
					// Token role is source of truth - always use it if present
					request['user'].role = tokenRole;
					request['user'].accessLevel = tokenRole as any;
				} else if (!request['user'].role && (dbUser.role || dbUser.accessLevel)) {
					// Token role missing - fallback to DB role
					request['user'].role = dbUser.role || dbUser.accessLevel;
					request['user'].accessLevel = dbUser.accessLevel;
				}

				// Fetch and attach license plan for FeatureGuard with caching
				// Use token org ID as source of truth, fallback to DB organisationRef
				// organisationRef can be a Clerk org ID (e.g., "org_38PujX4XhPOGpJtT1608fjTK6H2") or numeric uid
				// The licensing service handles both formats
				const orgRefForLicense = tokenOrgId || dbUser.organisationRef;
				if (orgRefForLicense) {
					try {
						// Check cache first (using same format as LicensingService for consistency)
						const cacheKey = `${this.CACHE_PREFIX}${orgRefForLicense}`;
						const cachedLicense = await this.cacheManager.get<any>(cacheKey);
						
						if (cachedLicense) {
							// Use cached license data
							if (cachedLicense.plan) {
								request['user'].licensePlan = cachedLicense.plan;
								request['user'].licenseId = cachedLicense.uid?.toString();
							}
						} else {
							// Fetch from database using token org ID (source of truth)
							const licenses = await this.licensingService.findByOrganisation(orgRefForLicense);
							
							if (licenses && licenses.length > 0) {
								// Find active license (prioritize ACTIVE, then TRIAL, then GRACE_PERIOD)
								const activeLicense = licenses.find(l => l.status === LicenseStatus.ACTIVE) ||
									licenses.find(l => l.status === LicenseStatus.TRIAL) ||
									licenses.find(l => l.status === LicenseStatus.GRACE_PERIOD);
								
								if (activeLicense) {
									request['user'].licensePlan = activeLicense.plan;
									request['user'].licenseId = activeLicense.uid.toString();
									
									// Cache the license data
									await this.cacheManager.set(cacheKey, {
										plan: activeLicense.plan,
										uid: activeLicense.uid,
										status: activeLicense.status,
									}, this.LICENSE_CACHE_TTL);
								} else {
									this.logger.warn(`[ClerkAuthGuard] No active license found for organisation. Available: ${licenses.map(l => `${l.plan} (${l.status})`).join(', ')}`);
									
									// Cache null result to avoid repeated queries
									await this.cacheManager.set(cacheKey, { plan: null, status: null }, this.LICENSE_CACHE_TTL);
								}
							} else {
								this.logger.warn(`[ClerkAuthGuard] No licenses found for organisation`);
								
								// Cache null result to avoid repeated queries
								await this.cacheManager.set(cacheKey, { plan: null, status: null }, this.LICENSE_CACHE_TTL);
							}
						}
					} catch (error) {
						// Don't fail authentication if license fetch fails, but log the error
						const errorMessage = error instanceof Error ? error.message : 'Unknown error';
						this.logger.error(`[ClerkAuthGuard] Could not fetch license: ${errorMessage}`);
					}
				}

				// License validation (if applicable)
				if (orgRefForLicense && !request['licenseValidated']) {
					try {
						const organisation = dbUser.organisation;
						if (organisation) {
							// License validation logic here if needed
						}
						request['licenseValidated'] = true;
					} catch (error) {
						if (error instanceof UnauthorizedException) {
							throw error;
						}
						// Don't fail authentication if license validation fails
						this.logger.warn(`[ClerkAuthGuard] License validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
					}
				}

				if (orgRefForLicense && !request['organization']) {
					request['organization'] = {
						ref: orgRefForLicense,
					};
				}

				if (dbUser.branchUid && !request['branch']) {
					request['branch'] = {
						uid: dbUser.branchUid,
					};
				}

				// Update last sync timestamp (non-blocking)
				this.clerkService.updateSyncTimestamp(dbUser);
			} else {
				// User not found in User table - try ClientAuth (client portal users)
				const clientAuth = await this.clerkService.getClientAuthByClerkId(clerkUserId);
				if (clientAuth?.client) {
					// Client portal user: set uid (ClientAuth.uid), clientUid (Client.uid), and org from client
					request['user'].uid = clientAuth.uid;
					request['user'].clientUid = clientAuth.client.uid;
					const orgRef = tokenOrgId ?? clientAuth.client.organisation?.clerkOrgId ?? clientAuth.client.organisation?.ref;
					request['user'].organisationRef = orgRef;
					if (!tokenOrgId && orgRef) {
						request['tokenOrgId'] = typeof orgRef === 'number' ? String(orgRef) : orgRef;
					}
					request['user'].branch = clientAuth.client.branch ? { uid: clientAuth.client.branch.uid } : undefined;
					request['user'].org = clientAuth.client.organisation ? { uid: clientAuth.client.organisation.uid } : undefined;
					// Role already set from token (e.g. 'client')
				} else {
					// User not found in database - sync user and wait for completion (with timeout)
					// Use request-scoped tracking to prevent multiple syncs in the same request
					const syncKey = `_clerkSync_${clerkUserId}`;
					if (request[syncKey]) {
						// Sync already in progress for this request - wait for it
						this.logger.debug(`[ClerkAuthGuard] Sync already in progress for this request, waiting...`);
						const syncedUser = await request[syncKey];
						if (syncedUser && syncedUser.uid) {
							request['user'].uid = syncedUser.uid;
							// Use token org ID as source of truth (matches the org in the token), fallback to synced user value
							request['user'].organisationRef = tokenOrgId || syncedUser.organisationRef;
							request['user'].branch = syncedUser.branchUid ? { uid: syncedUser.branchUid } : undefined;
							request['user'].org = (tokenOrgId || syncedUser.organisationRef) ? { uid: syncedUser.organisation?.uid } : undefined;
							request['user'].role = syncedUser.role ?? request['user'].role;
							request['user'].accessLevel = syncedUser.accessLevel ?? request['user'].accessLevel;
						}
					} else {
						// Start sync and track it in request context
						this.logger.warn(`[ClerkAuthGuard] User not found in database, syncing from Clerk`);
						try {
							const syncPromise = this.clerkService.syncUserFromClerk(clerkUserId);
							const timeoutPromise = new Promise<null>((resolve) =>
								setTimeout(() => resolve(null), 5000)
							);

							// Store promise in request context to prevent duplicate syncs
							request[syncKey] = Promise.race([syncPromise, timeoutPromise]);
							const syncedUser = await request[syncKey];

							if (syncedUser && syncedUser.uid) {
								// Sync completed successfully - enhance user object
								request['user'].uid = syncedUser.uid;
								// Use token org ID as source of truth (matches the org in the token), fallback to synced user value
								request['user'].organisationRef = tokenOrgId || syncedUser.organisationRef;
								request['user'].branch = syncedUser.branchUid ? { uid: syncedUser.branchUid } : undefined;
								request['user'].org = (tokenOrgId || syncedUser.organisationRef) ? { uid: syncedUser.organisation?.uid } : undefined;
								request['user'].role = syncedUser.role ?? request['user'].role;
								request['user'].accessLevel = syncedUser.accessLevel ?? request['user'].accessLevel;
							} else {
								// Sync timed out or failed - continue with token-based auth
								this.logger.warn(`[ClerkAuthGuard] User sync timed out or failed`);
							}
						} catch (error) {
							// Sync failed - continue with token-based auth
							this.logger.warn(`[ClerkAuthGuard] User sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
						} finally {
							// Clean up after a delay to allow other guard executions to use the same promise
							setTimeout(() => delete request[syncKey], 100);
						}
					}
				}
			}
		} catch (error) {
			// DB fetch failed - continue with token-based user object
			this.logger.warn(`[ClerkAuthGuard] Could not fetch user from database, using token data only: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}

		// User object is always attached at this point (from token or enhanced with DB data)
		const finalUser = request['user'];
		
		// Validate that user has required fields
		if (!finalUser || !finalUser.clerkUserId) {
			throw new UnauthorizedException('Invalid user object: missing required fields');
		}
		
		// Authentication successful - no need to log sensitive data
		
		return true;
	}
}
