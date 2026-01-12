import { Request } from 'express';
import { LicensingService } from '../licensing/licensing.service';
import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Token } from '../lib/types/token';

@Injectable()
export class LicenseGuard implements CanActivate {
	private readonly logger = new Logger(LicenseGuard.name);

	constructor(private readonly licensingService: LicensingService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<Request>();
		const { method, url, path } = request;
		
		this.logger.debug(`[LicenseGuard] Guard activated for ${method} ${path || url}`);

		try {
			// If license validation was already performed by the AuthGuard and cached in the request
			if (request['licenseValidated'] === true) {
				this.logger.debug(`[LicenseGuard] License already validated by AuthGuard, skipping validation for ${method} ${path || url}`);
				// If we already validated the license in this request, use that result
				return true;
			}

			const user = request['user'] as Token;

			if (!user) {
				this.logger.warn(`[LicenseGuard] No user found in request for ${method} ${path || url}`);
				return false;
			}

			this.logger.debug(`[LicenseGuard] User found - userId: ${user.uid}, role: ${user.role}, hasLicenseId: ${!!user.licenseId}, hasLicensePlan: ${!!user.licensePlan}`);

			// Check for licenseId in the token
			if (user.licenseId) {
				this.logger.debug(`[LicenseGuard] Validating license`);
				
				const validationStartTime = Date.now();
				const isValid = await this.licensingService.validateLicense(user.licenseId);
				const validationDuration = Date.now() - validationStartTime;
				
				this.logger.debug(`[LicenseGuard] License validation completed in ${validationDuration}ms - valid: ${isValid}`);

				// If valid, attach license info to the request
				if (isValid && user.licensePlan) {
					request['license'] = {
						id: user.licenseId,
						plan: user.licensePlan,
					};
					this.logger.debug(`[LicenseGuard] License info attached to request`);

					// Cache the validation result for this request
					request['licenseValidated'] = true;
					this.logger.debug(`[LicenseGuard] License validation cached for request`);
				} else {
					if (!isValid) {
						this.logger.warn(`[LicenseGuard] License validation failed - userId: ${user.uid}`);
					}
					if (!user.licensePlan) {
						this.logger.warn(`[LicenseGuard] License plan missing in token - userId: ${user.uid}`);
					}
				}

				this.logger.debug(`[LicenseGuard] Guard activation ${isValid ? 'successful' : 'failed'} for ${method} ${path || url}`);
				return isValid;
			}

			// No valid license found
			this.logger.warn(`[LicenseGuard] No licenseId found in user token for ${method} ${path || url} - userId: ${user.uid}`);
			return false;
		} catch (error) {
			this.logger.error(`[LicenseGuard] Unexpected error during guard activation for ${method} ${path || url}:`, error instanceof Error ? error.message : 'Unknown error');
			return false;
		}
	}
}
