import { randomBytes } from 'crypto';

export class CorrelationIdUtil {
	/**
	 * Generate a unique correlation ID for request tracing
	 */
	static generate(): string {
		const timestamp = Date.now().toString(36);
		const random = randomBytes(4).toString('hex');
		return `${timestamp}-${random}`;
	}

	/**
	 * Extract correlation ID from headers or generate a new one
	 */
	static getOrGenerate(headers?: Record<string, any>): string {
		const existingId = headers?.['x-correlation-id'] || headers?.['X-Correlation-ID'];
		return existingId || this.generate();
	}

	/**
	 * Create a log context object with correlation ID and other metadata
	 */
	static createLogContext(correlationId: string, additionalContext?: Record<string, any>): Record<string, any> {
		return {
			correlationId,
			timestamp: new Date().toISOString(),
			...additionalContext,
		};
	}

	/**
	 * Format log message with correlation ID prefix
	 */
	static formatMessage(correlationId: string, message: string): string {
		return `[${correlationId}] ${message}`;
	}
}
