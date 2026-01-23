import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BaseGuard } from './base.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';

/**
 * RoleGuard - Clerk Token Only
 * This guard only works with Clerk tokens. Role must come from user object set by ClerkAuthGuard.
 * Legacy JWT tokens are no longer supported.
 */
@Injectable()
export class RoleGuard extends BaseGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		jwtService: JwtService,
	) {
		super(jwtService);
		this.logger = new Logger(RoleGuard.name);
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();

		const isPublic = this.reflector.getAllAndOverride<boolean>(
			'isPublic',
			[context.getHandler(), context.getClass()]
		);

		if (isPublic) {
			return true;
		}

		// Extract token for logging and role extraction
		const authHeader = request.headers.authorization;
		const tokenHeader = request.headers.token as string;
		const token = tokenHeader || (authHeader ? authHeader.split(' ')[1] : undefined);

		// Try to get user object from request (set by ClerkAuthGuard)
		let user = request['user'];
		let role: string | undefined;

		if (user) {
			// User object exists - use role from user object
			role = user.role || user.accessLevel;
		} else if (token) {
			// User object not found - extract role from token as fallback
			try {
				const decoded = this.jwtService.decode(token, { complete: true }) as any;
				if (decoded?.payload) {
					// Extract role from token payload (organization role: o.rol)
					if (decoded.payload.o?.rol) {
						role = decoded.payload.o.rol;
						
						// Create minimal user object from token for compatibility
						request['user'] = {
							clerkUserId: decoded.payload.sub,
							role: role,
							accessLevel: role as any,
						};
					}
				}
			} catch (error) {
				// Ignore decode errors
			}
		}
		
		if (!user && !role) {
			throw new UnauthorizedException({
				statusCode: 401,
				message: 'Authentication required. User object with role information is missing',
				error: 'Unauthorized',
				action: 'Please ensure you are properly authenticated. The ClerkAuthGuard should attach a user object with role information to your request',
				cause: 'No user object was found in the request, and no role could be extracted from the authentication token',
			});
		}

		if (!role) {
			throw new UnauthorizedException({
				statusCode: 401,
				message: 'User role not found. Your account must have a role assigned',
				error: 'Unauthorized',
				action: 'Please contact your administrator to assign a role to your account, or ensure your authentication token includes role information',
				cause: 'The user object exists but does not contain a role or accessLevel property, and no role could be extracted from the authentication token',
			});
		}

		const requiredRoles = this.reflector.getAllAndOverride<AccessLevel[]>('roles', [
			context.getHandler(),
			context.getClass(),
		]);

		if (!requiredRoles) {
			return true; // No specific roles required
		}

		// Convert role to uppercase to match enum
		const normalizedRole = role.toUpperCase();
		const hasRequiredRole = requiredRoles.some(requiredRole =>
			requiredRole.toLowerCase() === normalizedRole.toLowerCase()
		);

		if (!hasRequiredRole) {
			throw new UnauthorizedException({
				statusCode: 401,
				message: `You do not have sufficient permissions to access this resource`,
				error: 'Unauthorized',
				action: `This resource requires one of the following roles: ${requiredRoles.join(', ')}. Your current role is: ${normalizedRole}. Please contact your administrator if you believe you should have access`,
				cause: `Your current role (${normalizedRole}) does not match any of the required roles: ${requiredRoles.join(', ')}`,
			});
		}

		return true;
	}
}
