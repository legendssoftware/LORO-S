import { Request } from 'express';
import { AccessLevel } from '../enums/user.enums';

/**
 * Enhanced request interface for authenticated requests with Clerk integration
 * 
 * The Clerk org ID from the token is stored in request['tokenOrgId'] and should be used
 * as the source of truth for organisation references. Use getClerkOrgId() helper function
 * to retrieve it easily.
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
