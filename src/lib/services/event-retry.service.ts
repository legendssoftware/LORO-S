import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventQueueService, EventPriority } from './event-queue.service';

export interface RetryConfig {
	maxAttempts?: number;
	baseDelay?: number;
	maxDelay?: number;
	exponentialBackoff?: boolean;
	onFailure?: (error: Error, attempt: number) => void;
}

@Injectable()
export class EventRetryService {
	private readonly logger = new Logger(EventRetryService.name);

	constructor(
		private readonly eventEmitter: EventEmitter2,
		private readonly eventQueue: EventQueueService,
	) {}

	/**
	 * Emit event with automatic retry on failure
	 */
	async emitWithRetry(
		event: string,
		data: any,
		priority: EventPriority = EventPriority.NORMAL,
		config?: RetryConfig,
	): Promise<void> {
		const maxAttempts = config?.maxAttempts || 3;
		const baseDelay = config?.baseDelay || 1000;
		const maxDelay = config?.maxDelay || 60000;
		const exponentialBackoff = config?.exponentialBackoff !== false;

		// Queue the event with retry configuration
		await this.eventQueue.queueEvent(event, data, priority, {
			maxAttempts,
			retryDelay: baseDelay,
		});
	}

	/**
	 * Wrap an async function with retry logic
	 */
	async executeWithRetry<T>(
		fn: () => Promise<T>,
		config?: RetryConfig,
	): Promise<T> {
		const maxAttempts = config?.maxAttempts || 3;
		const baseDelay = config?.baseDelay || 1000;
		const maxDelay = config?.maxDelay || 60000;
		const exponentialBackoff = config?.exponentialBackoff !== false;

		let lastError: Error;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error as Error;
				this.logger.warn(
					`Attempt ${attempt}/${maxAttempts} failed: ${error.message}`,
					error.stack,
				);

				if (config?.onFailure) {
					config.onFailure(lastError, attempt);
				}

				if (attempt < maxAttempts) {
					const delay = exponentialBackoff
						? Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
						: baseDelay;

					await this.sleep(delay);
				}
			}
		}

		throw lastError!;
	}

	/**
	 * Sleep utility
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
