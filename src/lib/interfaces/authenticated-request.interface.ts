import { Request } from 'express';
import { AccessLevel } from '../enums/user.enums';

/**
 * Enhanced request interface for authenticated requests with Clerk integration
 *
 * The Clerk org ID from the token is stored in request['tokenOrgId'] and should be used
 * as the source of truth for organisation references. Use getClerkOrgId() helper function
 * to retrieve it easily.
 *
 * For "current user" identity (e.g. attendance self-service): clerkUserId comes from the
 * token (decoded.payload.sub); uid (numeric DB primary key) is set by ClerkAuthGuard after
 * DB lookup. Both are the source of truth—never use client-supplied profile/owner ID.
 */
export interface AuthenticatedRequest extends Request {
	user: {
		clerkUserId: string;
		uid?: number; // Kept for backward compatibility
		accessLevel: AccessLevel;
		role: AccessLevel;
		branch?: {
			uid: number;
		};
		org?: {
			uid: number;
		};
		/**
		 * Organisation reference - should be the Clerk org ID (string like "org_...") from the token.
		 * This is set by ClerkAuthGuard using the token org ID as the source of truth.
		 * Falls back to database value if token org ID is not available.
		 */
		organisationRef?: string | number; // Clerk org ID (string) or numeric uid (number) for backward compatibility
		licensePlan?: string; // License plan name (e.g., 'starter', 'enterprise')
		licenseId?: string; // License ID for validation
	};
	/**
	 * Clerk organisation ID extracted from the token (source of truth).
	 * Set by ClerkAuthGuard from decoded.payload.o?.id
	 */
	tokenOrgId?: string;
}

/**
 * Helper function to get the Clerk org ID from an authenticated request.
 * Returns only the Clerk org ID from the token (source of truth).
 * There is no fallback - if the token does not contain an org ID, this returns undefined.
 * Callers must reject the request when this returns undefined.
 *
 * @param req - Authenticated request object
 * @returns Clerk org ID string or undefined if not available in token
 */
export function getClerkOrgId(req: AuthenticatedRequest): string | undefined {
	return req.tokenOrgId;
}

/**
 * Returns the Clerk user ID (token sub) from an authenticated request.
 * Source of truth for current user identity; use for attendance and other self-service flows.
 *
 * @param req - Authenticated request object
 * @returns Clerk user ID string or undefined
 */
export function getClerkUserId(req: AuthenticatedRequest): string | undefined {
	return req.user?.clerkUserId;
}

/**
 * Returns the numeric DB user uid set by ClerkAuthGuard after DB lookup.
 * Use with getClerkUserId for "current user" resolution in queries and relations.
 *
 * @param req - Authenticated request object
 * @returns Numeric user uid or undefined
 */
export function getRequestingUserUid(req: AuthenticatedRequest): number | undefined {
	const uid = req.user?.uid;
	return uid != null && typeof uid === 'number' ? uid : undefined;
}
