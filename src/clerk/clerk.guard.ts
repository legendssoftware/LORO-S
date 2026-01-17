import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClerkService } from './clerk.service';
import { LicensingService } from '../licensing/licensing.service';

const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
	private readonly logger = new Logger(ClerkAuthGuard.name);

	constructor(
		private readonly clerkService: ClerkService,
		private readonly licensingService: LicensingService,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<Request>();
		const { method, url, path } = request;

		// Check if route is public
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (isPublic) {
			return true;
		}

		const operationId = `CLERK_AUTH_${method}_${Date.now()}`;

		// Critical Path: Extract and verify token
		let clerkUserId: string;
		try {
			const token = this.extractTokenFromHeader(request);

			if (!token) {
				this.logger.warn(`[${operationId}] No token provided for ${method} ${path || url}`);
				throw new UnauthorizedException('Missing authentication token');
			}

			this.logger.debug(`[${operationId}] Verifying Clerk token...`);
			const verification = await this.clerkService.verifyToken(token);
			clerkUserId = verification.userId;
			this.logger.debug(`[${operationId}] Token verified - userId: ${clerkUserId}`);
		} catch (error) {
			this.logger.error(`[${operationId}] Token verification failed:`, error instanceof Error ? error.message : 'Unknown error');
			throw new UnauthorizedException('Invalid or expired token');
		}

		// Critical Path: Lookup user in database
		let user = await this.clerkService.getUserByClerkId(clerkUserId);

		// Async Processing: If user doesn't exist, trigger sync (non-blocking)
		if (!user) {
			this.logger.warn(`[${operationId}] User not found in database - triggering async sync`);
			
			// Trigger async sync but don't wait for it
			setImmediate(async () => {
				try {
					await this.clerkService.syncUserFromClerk(clerkUserId);
					this.logger.log(`[${operationId}] User sync completed in background`);
				} catch (error) {
					this.logger.error(`[${operationId}] Background user sync failed:`, error instanceof Error ? error.message : 'Unknown error');
					// Don't throw - this is background operation
				}
			});

			// Return unauthorized - user must exist for authentication
			throw new UnauthorizedException('User not found. Please contact support.');
		}

		// Critical Path: License validation (if applicable)
		if (user.organisationRef) {
			// Check if license validation is cached
			if (!request['licenseValidated']) {
				try {
					// Get license ID from user's organization
					const organisation = user.organisation;
					if (organisation) {
						// Note: License validation logic would need to be adapted based on your license structure
						// For now, we'll skip detailed license validation in Clerk guard
						// You can add it here if needed
					}

					request['licenseValidated'] = true;
				} catch (error) {
					if (error instanceof UnauthorizedException) {
						throw error;
					}
					this.logger.error(`[${operationId}] License validation error:`, error instanceof Error ? error.message : 'Unknown error');
					throw new UnauthorizedException('Unable to validate license');
				}
			}
		}

		// Critical Path: Attach user and organization info to request
		if (!request['user']) {
			request['user'] = {
				uid: user.uid,
				accessLevel: user.accessLevel,
				role: user.role as any,
				organisationRef: user.organisationRef,
				branch: user.branchUid ? { uid: user.branchUid } : undefined,
			};
		}

		if (user.organisationRef && !request['organization']) {
			request['organization'] = {
				ref: user.organisationRef,
			};
		}

		if (user.branchUid && !request['branch']) {
			request['branch'] = {
				uid: user.branchUid,
			};
		}

		// Async Processing: Update last sync timestamp (non-blocking)
		this.clerkService.updateSyncTimestamp(user);

		this.logger.debug(`[${operationId}] Authentication successful - userId: ${user.uid}, email: ${user.email}`);
		return true;
	}

	private extractTokenFromHeader(request: Request): string | undefined {
		const authHeader = request.headers.authorization;
		if (!authHeader) {
			return undefined;
		}

		const [type, token] = authHeader.split(' ');
		if (type !== 'Bearer' || !token) {
			return undefined;
		}

		return token;
	}
}
