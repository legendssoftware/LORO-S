import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LicensingService } from '../licensing/licensing.service';
import { BaseGuard } from './base.guard';

@Injectable()
export class AuthGuard extends BaseGuard implements CanActivate {
	private readonly logger = new Logger(AuthGuard.name);

	constructor(jwtService: JwtService, private readonly licensingService: LicensingService) {
		super(jwtService);
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();
		const { method, url, path } = request;

		let decodedToken;
		try {
			decodedToken = this.extractAndValidateToken(request);
		} catch (error) {
			this.logger.error(`[AuthGuard] Token extraction/validation failed for ${method} ${path || url}:`, error);
			throw error;
		}

		// Check license if user belongs to an organization
		if (decodedToken.organisationRef && decodedToken.licenseId) {
			// Check if license validation is cached in the request object first
			// This prevents multiple validations within the same request
			if (!request['licenseValidated']) {
				try {
					const isLicenseValid = await this.licensingService.validateLicense(decodedToken.licenseId);
					
					if (!isLicenseValid) {
						this.logger.warn(`[AuthGuard] License validation failed - userId: ${decodedToken.uid}`);
						throw new UnauthorizedException("Your organization's license has expired or is invalid. Please contact your administrator.");
					}

					// Cache the license validation result
					request['licenseValidated'] = true;

					// Attach organization info to the request
					if (!request['organization']) {
						request['organization'] = {
							ref: decodedToken.organisationRef,
						};
					}
				} catch (error) {
					// If it's already an UnauthorizedException, rethrow it
					if (error instanceof UnauthorizedException) {
						this.logger.error(`[AuthGuard] UnauthorizedException during license validation - userId: ${decodedToken.uid}, error: ${error.message}`);
						throw error;
					}
					// For other errors, log and throw a generic error
					this.logger.error(`[AuthGuard] Unexpected error validating license - userId: ${decodedToken.uid}:`, error instanceof Error ? error.message : 'Unknown error');
					throw new UnauthorizedException("Unable to validate license. Please contact your administrator.");
				}
			}
		} else {
			this.logger.warn(`[AuthGuard] Token missing organization or license info for ${method} ${path || url}:`, {
				hasOrgRef: !!decodedToken.organisationRef,
				hasLicenseId: !!decodedToken.licenseId,
				userId: decodedToken.uid,
				role: decodedToken.role,
			});
		}

		// Attach branch info to the request if available
		if (decodedToken.branch && !request['branch']) {
			request['branch'] = decodedToken.branch;
		}

		// Attach user info to request if not already attached
		if (!request['user']) {
			request['user'] = decodedToken;
		}

		return true;
	}
}
