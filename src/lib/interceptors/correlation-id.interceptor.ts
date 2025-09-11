import {
	Injectable,
	NestInterceptor,
	ExecutionContext,
	CallHandler,
	Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CorrelationIdUtil } from '../utils/correlation-id.util';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
	private readonly logger = new Logger(CorrelationIdInterceptor.name);

	intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
		const request = context.switchToHttp().getRequest();
		const response = context.switchToHttp().getResponse();
		
		// Generate or extract correlation ID
		const correlationId = CorrelationIdUtil.getOrGenerate(request.headers);
		
		// Add correlation ID to request object for use in services
		request.correlationId = correlationId;
		
		// Add correlation ID to response headers
		response.setHeader('X-Correlation-ID', correlationId);
		
		// Log the incoming request with correlation ID
		const startTime = Date.now();
		const { method, url, ip, headers } = request;
		const userAgent = headers['user-agent'] || 'Unknown';
		
		this.logger.log(
			CorrelationIdUtil.formatMessage(
				correlationId,
				`Incoming ${method} ${url} from ${ip}`
			),
			CorrelationIdUtil.createLogContext(correlationId, {
				method,
				url,
				ip,
				userAgent,
				startTime,
			})
		);

		return next.handle().pipe(
			tap({
				next: (data) => {
					const duration = Date.now() - startTime;
					this.logger.log(
						CorrelationIdUtil.formatMessage(
							correlationId,
							`Request completed in ${duration}ms - Status: ${response.statusCode}`
						),
						CorrelationIdUtil.createLogContext(correlationId, {
							method,
							url,
							statusCode: response.statusCode,
							duration,
							responseSize: data ? JSON.stringify(data).length : 0,
						})
					);
				},
				error: (error) => {
					const duration = Date.now() - startTime;
					this.logger.error(
						CorrelationIdUtil.formatMessage(
							correlationId,
							`Request failed in ${duration}ms - Error: ${error.message}`
						),
						CorrelationIdUtil.createLogContext(correlationId, {
							method,
							url,
							error: error.message,
							stack: error.stack,
							duration,
						})
					);
				},
			})
		);
	}
}
