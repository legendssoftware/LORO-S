import { Request } from 'express';
import { LicensingService } from '../licensing/licensing.service';
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';

/**
 * LicenseGuard - Clerk Token Only
 * Works with user object from ClerkAuthGuard. Legacy JWT tokens are no longer supported.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
	private readonly logger = new Logger(LicenseGuard.name);

	constructor(private readonly licensingService: LicensingService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<Request>();
		const path = `${request.method} ${request.path ?? request.url}`;
		this.logger.log(`[LicenseGuard] canActivate: path=${path}, licenseValidated=${request['licenseValidated'] === true}`);

		// If license validation was already performed and cached in the request
		if (request['licenseValidated'] === true) {
			return true;
		}

		// Get user from request (set by ClerkAuthGuard)
		const user = request['user'] as any;

		if (!user) {
			this.logger.warn(`[LicenseGuard] No user object found in request`);
			throw new UnauthorizedException({
				statusCode: 401,
				message: 'Authentication required. User information is missing',
				error: 'Unauthorized',
				action: 'Please ensure you are properly authenticated. The ClerkAuthGuard should attach a user object to your request',
				cause: 'No user object was found in the request, which is required for license validation',
			});
		}

		// Check for licenseId in the user object
		if (!user.licenseId) {
			this.logger.warn(`[LicenseGuard] No license ID found for user ${user.clerkUserId || user.uid}`);
			throw new ForbiddenException({
				statusCode: 403,
				message: 'No license found for your account',
				error: 'Forbidden',
				action: 'Please contact your administrator to ensure your organization has an active license configured',
				cause: 'License ID was not attached to your user account during authentication. This may occur if your organization does not have an active license',
			});
		}

		try {
			const isValid = await this.licensingService.validateLicense(user.licenseId);

			if (!isValid) {
				this.logger.warn(`[LicenseGuard] License validation failed for license ID: ${user.licenseId}`);
				throw new ForbiddenException({
					statusCode: 403,
					message: 'Your license is invalid or has expired',
					error: 'Forbidden',
					action: 'Please contact your administrator to renew or activate your license',
					cause: `License validation failed for license ID: ${user.licenseId}. The license may be expired, suspended, or invalid`,
				});
			}

			// If valid, attach license info to the request
			if (isValid && user.licensePlan) {
				request['license'] = {
					id: user.licenseId,
					plan: user.licensePlan,
				};

				// Cache the validation result for this request
				request['licenseValidated'] = true;
				this.logger.debug(`[LicenseGuard] License validated successfully for license ID: ${user.licenseId}, plan: ${user.licensePlan}`);
			}

			return isValid;
		} catch (error) {
			// If it's already a properly formatted exception, re-throw it
			if (error instanceof ForbiddenException || error instanceof UnauthorizedException) {
				throw error;
			}

			// For unexpected errors during license validation
			this.logger.error(`[LicenseGuard] Error validating license ${user.licenseId}:`, error instanceof Error ? error.message : 'Unknown error');
			throw new ForbiddenException({
				statusCode: 403,
				message: 'An error occurred while validating your license',
				error: 'Forbidden',
				action: 'Please try again later or contact support if the problem persists',
				cause: error instanceof Error ? error.message : 'Unknown error during license validation',
			});
		}
	}
}
