import { Injectable, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

@Injectable()
export class LicenseRateLimitGuard extends ThrottlerGuard {
    protected getTracker(req: Record<string, any>): Promise<string> {
        return Promise.resolve(req.ip);
    }

    protected getLimit(context: ExecutionContext): Promise<number> {
        const { route } = context.switchToHttp().getRequest();
        const customLimits = {
            '/licensing/validate': 100,
            '/licensing': 30,
            default: 50,
        };
        return Promise.resolve(customLimits[route?.path] || customLimits.default);
    }

    protected getTtl(context: ExecutionContext): Promise<number> {
        return Promise.resolve(60); // 60 seconds
    }

    protected async throwThrottlingException(
        context: ExecutionContext,
        detail: ThrottlerLimitDetail,
    ): Promise<void> {
        const request = context.switchToHttp().getRequest();
        const route = request.route?.path || 'this endpoint';
        const timeToExpireSeconds = Math.ceil(detail.timeToExpire / 1000);
        const ttlSeconds = Math.ceil(detail.ttl / 1000);

        throw new HttpException(
            {
                statusCode: 429,
                message: `Rate limit exceeded for ${route}`,
                error: 'Too Many Requests',
                action: `Please wait ${timeToExpireSeconds} second(s) before making another request. The rate limit is ${detail.limit} requests per ${ttlSeconds} second(s)`,
                cause: `You have exceeded the rate limit of ${detail.limit} requests per ${ttlSeconds} second(s) for ${route}. Rate limiting helps protect the system from abuse`,
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
} 