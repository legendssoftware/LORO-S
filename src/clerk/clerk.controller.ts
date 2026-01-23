import { Controller, Post, Req, Headers, RawBodyRequest, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { Request } from 'express';
import { ClerkService } from './clerk.service';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { ConfigService } from '@nestjs/config';

@Controller('clerk')
export class ClerkController {
	private readonly logger = new Logger(ClerkController.name);
	private readonly webhookSecret: string | null;

	constructor(
		private readonly clerkService: ClerkService,
		private readonly configService: ConfigService,
	) {
		const webhookSecret = this.configService.get<string>('CLERK_WEBHOOK_SIGNING_SECRET');
		if (webhookSecret) {
			this.webhookSecret = webhookSecret;
		} else {
			this.logger.warn('CLERK_WEBHOOK_SIGNING_SECRET not configured - webhook verification disabled');
			this.webhookSecret = null;
		}
	}

	@Post('webhook')
	@HttpCode(HttpStatus.OK)
	async handleWebhook(
		@Req() req: RawBodyRequest<Request>,
		@Headers('svix-id') svixId: string,
		@Headers('svix-timestamp') svixTimestamp: string,
		@Headers('svix-signature') svixSignature: string,
	): Promise<{ received: boolean }> {
		const operationId = `WEBHOOK_${svixId || Date.now()}`;

		// Critical Path: Validate webhook signature
		if (!this.webhookSecret) {
			this.logger.error(`[${operationId}] Webhook secret not configured - rejecting webhook`);
			return { received: false };
		}

		let payload: any;
		try {
			this.logger.debug(`[${operationId}] Verifying webhook signature...`);

			// Get raw body as Buffer or string
			const rawBody = req.rawBody instanceof Buffer 
				? req.rawBody 
				: Buffer.from(req.rawBody?.toString() || '');

			// Create a Web API Request object for verifyWebhook
			// Clerk's verifyWebhook expects a Web API Request, so we need to adapt Express request
			const webhookRequest = new Request('http://localhost/clerk/webhook', {
				method: 'POST',
				headers: {
					'svix-id': svixId || '',
					'svix-timestamp': svixTimestamp || '',
					'svix-signature': svixSignature || '',
				},
				body: rawBody,
			});

			// verifyWebhook can read from CLERK_WEBHOOK_SIGNING_SECRET env var or accept signingSecret option
			payload = await verifyWebhook(webhookRequest, {
				signingSecret: this.webhookSecret,
			});

			this.logger.debug(`[${operationId}] Webhook signature verified - type: ${payload.type}`);
		} catch (error) {
			this.logger.error(`[${operationId}] Webhook signature verification failed:`, error instanceof Error ? error.message : 'Unknown error');
			return { received: false };
		}

		// Critical Path: Acknowledge webhook immediately
		this.logger.log(`[${operationId}] Webhook received and verified - type: ${payload.type}`);

		// Async Processing: Process webhook event (non-blocking)
		setImmediate(async () => {
			try {
				await this.processWebhookEvent(payload, operationId);
			} catch (error) {
				this.logger.error(`[${operationId}] Failed to process webhook event:`, error instanceof Error ? error.message : 'Unknown error');
				// Don't throw - webhook already acknowledged
			}
		});

		return { received: true };
	}

	private async processWebhookEvent(payload: any, operationId: string): Promise<void> {
		const eventType = payload.type;
		const data = payload.data;

		this.logger.debug(`[${operationId}] Processing webhook event - type: ${eventType}`);

		try {
			switch (eventType) {
				case 'user.created':
					// Validate required data for user.created event
					if (!data || !data.id) {
						this.logger.error(`[${operationId}] Invalid user.created event - missing user ID`, {
							eventId: payload.id,
							data: JSON.stringify(data),
						});
						return;
					}

					this.logger.log(`[${operationId}] Processing user.created event`);

					await this.clerkService.handleUserCreated(data.id, data);
					this.logger.log(`[${operationId}] User created event processed successfully`);
					break;

				case 'user.updated':
					await this.clerkService.handleUserUpdated(data.id, data);
					this.logger.log(`[${operationId}] User updated event processed`);
					break;

				case 'user.deleted':
					await this.clerkService.handleUserDeleted(data.id);
					this.logger.log(`[${operationId}] User deleted event processed`);
					break;

				case 'organization.created':
					// Validate required data for organization.created event
					if (!data || !data.id) {
						this.logger.error(`[${operationId}] Invalid organization.created event - missing organization ID`, {
							eventId: payload.id,
							data: JSON.stringify(data),
						});
						return;
					}

					this.logger.log(`[${operationId}] Processing organization.created event`);

					await this.clerkService.handleOrganizationCreated(data.id, data);
					this.logger.log(`[${operationId}] Organization created event processed successfully`);
					break;

				case 'organization.updated':
					// Handle organization updates if needed
					this.logger.log(`[${operationId}] Organization updated event received`);
					// You can add organization sync logic here if needed
					break;

				case 'organizationMembership.created':
					await this.clerkService.handleOrganizationMembershipCreated(
						data.organization.id,
						data.public_user_data.user_id,
						data.role,
					);
					this.logger.log(`[${operationId}] Organization membership created`);
					break;

				case 'organizationMembership.deleted':
					await this.clerkService.handleOrganizationMembershipDeleted(
						data.organization.id,
						data.public_user_data.user_id,
					);
					this.logger.log(`[${operationId}] Organization membership deleted`);
					break;

				case 'session.created':
					// Handle session creation if needed (for analytics, etc.)
					this.logger.debug(`[${operationId}] Session created event received - sessionId: ${data.id}`);
					break;

				case 'session.ended':
					// Handle session end if needed (for analytics, etc.)
					this.logger.debug(`[${operationId}] Session ended event received - sessionId: ${data.id}`);
					break;

				default:
					this.logger.debug(`[${operationId}] Unhandled webhook event type: ${eventType}`);
			}
		} catch (error) {
			this.logger.error(`[${operationId}] Error processing webhook event ${eventType}:`, {
				error: error instanceof Error ? error.message : 'Unknown error',
				stack: error instanceof Error ? error.stack : undefined,
				eventType,
				eventId: payload.id,
			});
			// Don't throw - webhook already acknowledged
		}
	}
}
