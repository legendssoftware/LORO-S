import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoyaltyApiKeyGuard implements CanActivate {
	private readonly logger = new Logger(LoyaltyApiKeyGuard.name);

	constructor(private readonly configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest();
		const apiKey = request.headers['x-loyalty-api-key'] || request.headers['X-LOYALTY-API-Key'];

		if (!apiKey) {
			this.logger.warn('Loyalty API request missing API key');
			throw new UnauthorizedException('X-LOYALTY-API-Key header is required');
		}

		const validApiKey = this.configService.get<string>('LOYALTY_API_KEY');

		if (!validApiKey) {
			this.logger.error('LOYALTY_API_KEY not configured in environment');
			throw new UnauthorizedException('Loyalty API is not properly configured');
		}

		if (apiKey !== validApiKey) {
			this.logger.warn(`Invalid loyalty API key attempted: ${apiKey.substring(0, 10)}...`);
			throw new UnauthorizedException('Invalid API key');
		}

		return true;
	}
}
