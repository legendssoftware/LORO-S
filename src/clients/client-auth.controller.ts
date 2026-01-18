import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiOkResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiConsumes, ApiProduces } from '@nestjs/swagger';
import { ClientAuthService } from './client-auth.service';
import { ClientSyncClerkDto } from './dto/client-sync-clerk.dto';
import { isPublic } from '../decorators/public.decorator';

@ApiTags('🔐 Client Authentication')
@Controller('client-auth')
@ApiConsumes('application/json')
@ApiProduces('application/json')
export class ClientAuthController {
	private readonly logger = new Logger(ClientAuthController.name);

	constructor(private readonly clientAuthService: ClientAuthService) {}

	@Post('sync-clerk')
	@isPublic()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: '🔄 Sync Client Session with Clerk',
		description: 'Syncs Clerk authentication token with client profile. Validates Clerk token and returns client profile data.',
	})
	@ApiBody({ type: ClientSyncClerkDto })
	@ApiOkResponse({
		description: 'Client session synced successfully',
		schema: {
			type: 'object',
			properties: {
				profileData: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						email: { type: 'string' },
						name: { type: 'string' },
						accessLevel: { type: 'string', example: 'client' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid request data' })
	@ApiUnauthorizedResponse({ description: 'Invalid or expired Clerk token' })
	async syncClerk(@Body() syncDto: ClientSyncClerkDto) {
		const operationId = `CLIENT_SYNC_CLERK_${Date.now()}`;
		this.logger.log(`[${operationId}] Client Clerk sync request`);

		try {
			const result = await this.clientAuthService.syncClerkSession(syncDto);
			return result;
		} catch (error) {
			this.logger.error(`[${operationId}] Sync failed:`, error instanceof Error ? error.message : 'Unknown error');
			throw error;
		}
	}
}
