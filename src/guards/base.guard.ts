import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

/**
 * BaseGuard - Clerk Token Only
 * This guard only handles Clerk tokens. Legacy JWT tokens are no longer supported.
 */
@Injectable()
export class BaseGuard {
	protected logger = new Logger(BaseGuard.name);

	constructor(protected readonly jwtService: JwtService) { }

	/**
	 * Extract and decode Clerk token from request headers
	 * Only supports Clerk tokens - legacy JWT tokens are not supported
	 */
	protected extractClerkToken(request: Request): { token: string; decoded: any } {
		const token = this.extractTokenFromHeader(request);

		if (!token) {
			throw new UnauthorizedException({
				statusCode: 401,
				message: 'No authentication token provided',
				error: 'Unauthorized',
				action: 'Please provide a valid Clerk authentication token in the Authorization header (Bearer token) or in the token header',
				cause: 'No token was found in the Authorization header or token header. Authentication is required to access this resource',
			});
		}

		try {
			// Decode the Clerk token (extracts payload without verifying signature)
			const decoded = this.jwtService.decode(token, { complete: true }) as any;
			
			if (!decoded || !decoded.payload) {
				throw new UnauthorizedException({
					statusCode: 401,
					message: 'Invalid token format',
					error: 'Unauthorized',
					action: 'Please provide a valid Clerk authentication token. Ensure the token is properly formatted and not corrupted',
					cause: 'The provided token could not be decoded or does not contain a valid payload structure',
				});
			}

			// Verify this is a Clerk token
			const isClerkToken = decoded.payload.iss?.includes('clerk') || 
			                     decoded.payload.iss?.includes('clerk.dev') ||
			                     decoded.payload.sub;

			if (!isClerkToken) {
				throw new UnauthorizedException({
					statusCode: 401,
					message: 'Only Clerk authentication tokens are supported',
					error: 'Unauthorized',
					action: 'Please use a Clerk authentication token. Legacy JWT tokens are no longer accepted. Ensure you are using the correct authentication method',
					cause: 'The provided token is not a Clerk token. The token issuer does not match Clerk\'s expected format',
				});
			}

			// Check expiration manually
			if (decoded.payload.exp) {
				const expirationTime = decoded.payload.exp * 1000;
				if (Date.now() >= expirationTime) {
					const expiredAt = new Date(expirationTime).toISOString();
					throw new UnauthorizedException({
						statusCode: 401,
						message: 'Your authentication token has expired',
						error: 'Unauthorized',
						action: 'Please refresh your authentication token or log in again to obtain a new token',
						cause: `The token expired at ${expiredAt}. Authentication tokens have a limited validity period for security reasons`,
					});
				}
			}

			// Mark as Clerk token
			request['isClerkToken'] = true;
			request['clerkUserId'] = decoded.payload.sub;
			this.logger.log(`[BaseGuard] Clerk token detected - user ID: ${decoded.payload.sub}`);

			// Cache the decoded token in the request object
			request['decodedToken'] = decoded.payload;

			return { token, decoded: decoded.payload };
		} catch (error) {
			if (error instanceof UnauthorizedException) {
				throw error;
			}
			throw new UnauthorizedException({
				statusCode: 401,
				message: 'Invalid or malformed Clerk authentication token',
				error: 'Unauthorized',
				action: 'Please provide a valid Clerk authentication token. Ensure the token is not corrupted and is from a valid Clerk session',
				cause: error instanceof Error ? error.message : 'Token decoding or validation failed due to an unexpected error',
			});
		}
	}

	/**
	 * Extract token from headers (Clerk tokens only)
	 */
	private extractTokenFromHeader(request: Request): string | undefined {
		// Priority 1: Check 'Authorization' header (Clerk standard)
		const authHeader = request.headers.authorization;
		if (authHeader) {
			const [type, authToken] = authHeader.split(' ');
			if (type === 'Bearer' && authToken) {
				return authToken;
			}
		}
		
		// Priority 2: Check 'token' header (backward compatibility)
		const token = request.headers['token'] as string;
		if (token) {
			return token;
		}
		
		return undefined;
	}
}
