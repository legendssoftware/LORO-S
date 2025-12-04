import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { FeatureGuard } from '../guards/feature.guard';
import { RequireFeature } from './require-feature.decorator';

type ModuleName =
	| 'approvals'
	| 'assets'
	| 'claims'
	| 'clients'
	| 'communication'
	| 'competitors'
	| 'docs'
	| 'journal'
	| 'leads'
	| 'leave'
	| 'licensing'
	| 'news'
	| 'notifications'
	| 'organisation'
	| 'payslips'
	| 'products'
	| 'reports'
	| 'resellers'
	| 'rewards'
	| 'shop'
	| 'tasks'
	| 'tracking'
	| 'warnings';

/**
 * Decorator to protect routes with enterprise-only access
 * @param module The module name to protect (e.g., 'assets', 'claims', etc.)
 */
export function EnterpriseOnly(module: ModuleName) {
	return applyDecorators(UseGuards(AuthGuard, FeatureGuard), RequireFeature(`${module}.access` as const));
}
