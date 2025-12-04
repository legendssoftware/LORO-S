import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LicensingService } from '../licensing/licensing.service';
import { BaseGuard } from './base.guard';

@Injectable()
export class AuthGuard extends BaseGuard implements CanActivate {
	constructor(jwtService: JwtService, private readonly licensingService: LicensingService) {
		super(jwtService);
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();
		const decodedToken = this.extractAndValidateToken(request);

		// Check license if user belongs to an organization
		if (decodedToken.organisationRef && decodedToken.licenseId) {
			// Check if license validation is cached in the request object first
			// This prevents multiple validations within the same request
			if (!request['licenseValidated']) {
				const isLicenseValid = await this.licensingService.validateLicense(decodedToken.licenseId);
				if (!isLicenseValid) {
					throw new UnauthorizedException("Your organization's license has expired");
				}

				// Cache the license validation result
				request['licenseValidated'] = true;

				// Attach organization info to the request
				if (!request['organization']) {
					request['organization'] = {
						ref: decodedToken.organisationRef,
					};
				}
			}
		} else {
			console.warn('⚠️ [AuthGuard] Token missing organization or license info:', {
				hasOrgRef: !!decodedToken.organisationRef,
				hasLicenseId: !!decodedToken.licenseId,
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
