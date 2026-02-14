import { AccessLevel } from '../enums/user.enums';

const ELEVATED_BRANCH_ROLES: AccessLevel[] = [
	AccessLevel.ADMIN,
	AccessLevel.OWNER,
	AccessLevel.DEVELOPER,
	AccessLevel.TECHNICIAN,
];

/**
 * Check if user should see all branches (admin, owner, developer, technician).
 */
export function shouldSeeAllBranches(userAccessLevel?: string): boolean {
	if (!userAccessLevel) return false;
	return ELEVATED_BRANCH_ROLES.includes(userAccessLevel.toLowerCase() as AccessLevel);
}

/**
 * Get effective branch ID for filtering. Returns undefined for elevated roles (show all).
 */
export function getEffectiveBranchId(branchId?: number, userAccessLevel?: string): number | undefined {
	if (shouldSeeAllBranches(userAccessLevel)) return undefined;
	return branchId;
}
