import { Injectable, ExecutionContext, UnauthorizedException, CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { AccessLevel } from '../lib/enums/user.enums';
import { LicensingService } from '../licensing/licensing.service';

@Injectable()
export class ClientJwtAuthGuard implements CanActivate {
	constructor(
		private reflector: Reflector, 
		private jwtService: JwtService,
		private licensingService: LicensingService
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (isPublic) {
			return true;
		}

		const request = context.switchToHttp().getRequest();
		const token = this.extractTokenFromHeader(request);

		if (!token) {
			throw new UnauthorizedException('Missing authentication token');
		}

		try {
			const payload = await this.jwtService.verifyAsync(token);

			// Ensure the token is for a client
			if (payload.role !== AccessLevel.CLIENT) {
				throw new UnauthorizedException('Invalid access token');
			}

			// Check license if client belongs to an organization
			if (payload.organisationRef && payload.licenseId) {
				// Check if license validation is cached in the request object first
				if (!request['licenseValidated']) {
					const isLicenseValid = await this.licensingService.validateLicense(payload.licenseId);
					if (!isLicenseValid) {
						throw new UnauthorizedException("Your organization's license has expired");
					}
					
					// Cache the license validation result
					request['licenseValidated'] = true;
					
					// Attach organization info to the request
					if (!request['organization']) {
						request['organization'] = {
							ref: payload.organisationRef,
						};
					}
				}
			}

			// Attach branch info to the request if available
			if (payload.branch && !request['branch']) {
				request['branch'] = payload.branch;
			}

			request.user = payload;
			return true;
		} catch (error) {
			// Check if it's a token expiration error
			if (error?.name === 'TokenExpiredError') {
				throw new UnauthorizedException('Token has expired');
			}
			throw new UnauthorizedException('Invalid access token');
		}
	}

	private extractTokenFromHeader(request: any): string | undefined {
		const [type, token] = request.headers.authorization?.split(' ') ?? [];
		return type === 'Bearer' ? token : undefined;
	}
}
