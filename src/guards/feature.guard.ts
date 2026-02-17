import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from '../decorators/require-feature.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PLAN_FEATURES } from '../lib/constants/license-features';

@Injectable()
export class FeatureGuard implements CanActivate {
	private readonly logger = new Logger(FeatureGuard.name);

	constructor(private reflector: Reflector) { }

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest();
		const path = `${request.method} ${request.path ?? request.url}`;
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		const requiredFeatures = this.reflector.getAllAndOverride<string[]>(FEATURE_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		this.logger.log(`[FeatureGuard] canActivate: path=${path}, isPublic=${isPublic}, requiredFeatures=${requiredFeatures?.length ? requiredFeatures.join(',') : 'none'}, user.role=${request['user']?.role ?? 'n/a'}`);

		if (!requiredFeatures) {
			return true;
		}

		// Skip license/feature check for public routes (e.g. public metrics endpoints that accept x-org-id)
		if (isPublic) {
			return true;
		}

		const user = request['user'];

		// Check if user has license info
		if (!user?.licensePlan) {
			throw new ForbiddenException({
				statusCode: 403,
				message: 'No license information found for your account',
				error: 'Forbidden',
				action: 'Please contact your administrator to ensure your organization has an active license plan configured',
				cause: 'License plan was not attached to your user account during authentication. This may occur if your organization does not have an active license or if license information could not be retrieved',
			});
		}

		// Get features available for the user's plan
		const planFeatures = PLAN_FEATURES[user.licensePlan];
		if (!planFeatures) {
			throw new ForbiddenException({
				statusCode: 403,
				message: `Invalid or unrecognized license plan: ${user.licensePlan}`,
				error: 'Forbidden',
				action: 'Please contact support to verify your license plan configuration',
				cause: `The license plan "${user.licensePlan}" is not recognized in the system. This may indicate a configuration issue or an unsupported plan type`,
			});
		}

		// Check if user has all required features
		const hasAccess = requiredFeatures?.every(feature => planFeatures[feature] === true);

		if (!hasAccess) {
			const missingFeatures = requiredFeatures.filter(feature => planFeatures[feature] !== true);
			throw new ForbiddenException({
				statusCode: 403,
				message: `Your current plan (${user.licensePlan}) does not include access to the required feature(s)`,
				error: 'Forbidden',
				action: `Please upgrade to a plan that includes: ${missingFeatures.join(', ')}. Contact your administrator or upgrade your subscription`,
				cause: `The following features are required but not available in your ${user.licensePlan} plan: ${missingFeatures.join(', ')}`,
			});
		}

		return true;
	}
}
