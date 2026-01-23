import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoyaltyApiKeyGuard implements CanActivate {
	constructor(private readonly configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest();
		const apiKey = request.headers['x-loyalty-api-key'] || request.headers['X-LOYALTY-API-Key'];

		if (!apiKey) {
			throw new UnauthorizedException('X-LOYALTY-API-Key header is required');
		}

		const validApiKey = this.configService.get<string>('LOYALTY_API_KEY');

		if (!validApiKey) {
			throw new UnauthorizedException('Loyalty API is not properly configured');
		}

		if (apiKey !== validApiKey) {
			throw new UnauthorizedException('Invalid API key');
		}

		return true;
	}
}
