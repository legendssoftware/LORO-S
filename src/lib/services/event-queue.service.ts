import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';

export enum EventPriority {
	CRITICAL = 'critical',
	HIGH = 'high',
	NORMAL = 'normal',
	LOW = 'low',
}

export interface QueuedEvent {
	id: string;
	event: string;
	data: any;
	priority: EventPriority;
	attempts: number;
	maxAttempts: number;
	createdAt: Date;
	scheduledFor?: Date;
	retryDelay?: number;
}

@Injectable()
export class EventQueueService {
	private readonly logger = new Logger(EventQueueService.name);
	private readonly QUEUE_PREFIX = 'event_queue:';
	private readonly PROCESSING_PREFIX = 'event_processing:';
	private readonly MAX_RETRY_ATTEMPTS = 5;
	private readonly BASE_RETRY_DELAY = 1000; // 1 second
	private readonly MAX_RETRY_DELAY = 60000; // 60 seconds
	private readonly BATCH_SIZE = 10;
	private readonly PROCESSING_TIMEOUT = 300000; // 5 minutes

	// In-memory fallback queue if Redis is not available
	private inMemoryQueue: Map<string, QueuedEvent[]> = new Map();
	private isProcessing = false;

	constructor(
		@Inject(CACHE_MANAGER)
		private readonly cacheManager: Cache,
		private readonly eventEmitter: EventEmitter2,
		private readonly configService: ConfigService,
	) {
		// Start processing queue
		this.startQueueProcessor();
	}

	/**
	 * Queue an event with priority
	 */
	async queueEvent(
		event: string,
		data: any,
		priority: EventPriority = EventPriority.NORMAL,
		options?: {
			maxAttempts?: number;
			scheduledFor?: Date;
			retryDelay?: number;
		},
	): Promise<string> {
		const eventId = `${event}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const queuedEvent: QueuedEvent = {
			id: eventId,
			event,
			data,
			priority,
			attempts: 0,
			maxAttempts: options?.maxAttempts || this.MAX_RETRY_ATTEMPTS,
			createdAt: new Date(),
			scheduledFor: options?.scheduledFor,
			retryDelay: options?.retryDelay || this.BASE_RETRY_DELAY,
		};

		try {
			// Try Redis first
			const queueKey = this.getQueueKey(priority);
			const existingQueue = await this.cacheManager.get<QueuedEvent[]>(queueKey) || [];
			existingQueue.push(queuedEvent);
			await this.cacheManager.set(queueKey, existingQueue, 3600000); // 1 hour TTL
			this.logger.debug(`Queued event ${eventId} with priority ${priority}`);
			return eventId;
		} catch (error) {
			// Fallback to in-memory queue
			this.logger.warn(`Redis unavailable, using in-memory queue for event ${eventId}`);
			if (!this.inMemoryQueue.has(priority)) {
				this.inMemoryQueue.set(priority, []);
			}
			this.inMemoryQueue.get(priority)!.push(queuedEvent);
			return eventId;
		}
	}

	/**
	 * Batch queue multiple events
	 */
	async queueBatch(
		events: Array<{ event: string; data: any; priority?: EventPriority }>,
	): Promise<string[]> {
		const eventIds: string[] = [];
		for (const { event, data, priority = EventPriority.NORMAL } of events) {
			const id = await this.queueEvent(event, data, priority);
			eventIds.push(id);
		}
		return eventIds;
	}

	/**
	 * Start processing the queue
	 */
	private async startQueueProcessor(): Promise<void> {
		if (this.isProcessing) return;
		this.isProcessing = true;

		setInterval(async () => {
			try {
				await this.processQueue();
			} catch (error) {
				this.logger.error(`Error processing queue: ${error.message}`, error.stack);
			}
		}, 1000); // Process every second
	}

	/**
	 * Process events from the queue
	 */
	private async processQueue(): Promise<void> {
		// Process in priority order: critical -> high -> normal -> low
		const priorities = [
			EventPriority.CRITICAL,
			EventPriority.HIGH,
			EventPriority.NORMAL,
			EventPriority.LOW,
		];

		for (const priority of priorities) {
			await this.processPriorityQueue(priority);
		}
	}

	/**
	 * Process events for a specific priority
	 */
	private async processPriorityQueue(priority: EventPriority): Promise<void> {
		try {
			const queueKey = this.getQueueKey(priority);
			let queue: QueuedEvent[];

			// Try Redis first
			try {
				queue = (await this.cacheManager.get<QueuedEvent[]>(queueKey)) || [];
			} catch (error) {
				// Fallback to in-memory
				queue = this.inMemoryQueue.get(priority) || [];
			}

			if (queue.length === 0) return;

			// Process batch
			const batch = queue.splice(0, this.BATCH_SIZE);

			// Update queue
			try {
				await this.cacheManager.set(queueKey, queue, 3600000);
			} catch (error) {
				this.inMemoryQueue.set(priority, queue);
			}

			// Process each event
			for (const event of batch) {
				await this.processEvent(event, priority);
			}
		} catch (error) {
			this.logger.error(`Error processing ${priority} queue: ${error.message}`, error.stack);
		}
	}

	/**
	 * Process a single event
	 */
	private async processEvent(event: QueuedEvent, priority: EventPriority): Promise<void> {
		// Check if scheduled for future
		if (event.scheduledFor && event.scheduledFor > new Date()) {
			// Re-queue for later
			await this.queueEvent(event.event, event.data, priority, {
				maxAttempts: event.maxAttempts,
				scheduledFor: event.scheduledFor,
				retryDelay: event.retryDelay,
			});
			return;
		}

		// Check processing timeout
		const processingKey = `${this.PROCESSING_PREFIX}${event.id}`;
		try {
			const processingSince = await this.cacheManager.get<Date>(processingKey);
			if (processingSince) {
				const processingTime = Date.now() - processingSince.getTime();
				if (processingTime > this.PROCESSING_TIMEOUT) {
					this.logger.warn(`Event ${event.id} exceeded processing timeout, retrying`);
					await this.cacheManager.del(processingKey);
					await this.retryEvent(event, priority);
					return;
				}
			}
		} catch (error) {
			// Ignore cache errors
		}

		// Mark as processing
		try {
			await this.cacheManager.set(processingKey, new Date(), this.PROCESSING_TIMEOUT);
		} catch (error) {
			// Ignore cache errors
		}

		try {
			// Emit the event
			this.eventEmitter.emit(event.event, event.data);

			// Remove from processing
			try {
				await this.cacheManager.del(processingKey);
			} catch (error) {
				// Ignore cache errors
			}

			this.logger.debug(`Successfully processed event ${event.id}`);
		} catch (error) {
			this.logger.error(`Error processing event ${event.id}: ${error.message}`, error.stack);

			// Remove from processing
			try {
				await this.cacheManager.del(processingKey);
			} catch (error) {
				// Ignore cache errors
			}

			// Retry if attempts remaining
			await this.retryEvent(event, priority);
		}
	}

	/**
	 * Retry an event with exponential backoff
	 */
	private async retryEvent(event: QueuedEvent, priority: EventPriority): Promise<void> {
		event.attempts++;

		if (event.attempts >= event.maxAttempts) {
			this.logger.error(
				`Event ${event.id} exceeded max attempts (${event.maxAttempts}), moving to dead letter queue`,
			);
			await this.moveToDeadLetterQueue(event);
			return;
		}

		// Calculate exponential backoff delay
		const delay = Math.min(
			event.retryDelay! * Math.pow(2, event.attempts - 1),
			this.MAX_RETRY_DELAY,
		);

		const scheduledFor = new Date(Date.now() + delay);

		this.logger.debug(
			`Retrying event ${event.id} (attempt ${event.attempts}/${event.maxAttempts}) in ${delay}ms`,
		);

		// Re-queue with delay
		await this.queueEvent(event.event, event.data, priority, {
			maxAttempts: event.maxAttempts,
			scheduledFor,
			retryDelay: event.retryDelay,
		});
	}

	/**
	 * Move event to dead letter queue
	 */
	private async moveToDeadLetterQueue(event: QueuedEvent): Promise<void> {
		const dlqKey = `${this.QUEUE_PREFIX}dead_letter`;
		try {
			const dlq = (await this.cacheManager.get<QueuedEvent[]>(dlqKey)) || [];
			dlq.push(event);
			await this.cacheManager.set(dlqKey, dlq, 86400000); // 24 hours TTL
		} catch (error) {
			this.logger.error(`Failed to move event ${event.id} to dead letter queue: ${error.message}`);
		}
	}

	/**
	 * Get queue key for priority
	 */
	private getQueueKey(priority: EventPriority): string {
		return `${this.QUEUE_PREFIX}${priority}`;
	}

	/**
	 * Get queue statistics
	 */
	async getQueueStats(): Promise<{
		[priority: string]: number;
		deadLetter: number;
	}> {
		const stats: { [priority: string]: number; deadLetter: number } = {
			deadLetter: 0,
		};

		for (const priority of Object.values(EventPriority)) {
			try {
				const queue = (await this.cacheManager.get<QueuedEvent[]>(this.getQueueKey(priority))) || [];
				stats[priority] = queue.length;
			} catch (error) {
				// Fallback to in-memory
				stats[priority] = this.inMemoryQueue.get(priority)?.length || 0;
			}
		}

		try {
			const dlq = (await this.cacheManager.get<QueuedEvent[]>(`${this.QUEUE_PREFIX}dead_letter`)) || [];
			stats.deadLetter = dlq.length;
		} catch (error) {
			// Ignore
		}

		return stats;
	}
}
