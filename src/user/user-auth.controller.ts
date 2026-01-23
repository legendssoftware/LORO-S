import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiOkResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiConsumes, ApiProduces } from '@nestjs/swagger';
import { UserAuthService } from './user-auth.service';
import { UserSyncClerkDto } from './dto/user-sync-clerk.dto';
import { isPublic } from '../decorators/public.decorator';

@ApiTags('🔐 User Authentication')
@Controller('auth')
@ApiConsumes('application/json')
@ApiProduces('application/json')
export class UserAuthController {
	private readonly logger = new Logger(UserAuthController.name);

	constructor(private readonly userAuthService: UserAuthService) {}

	@Post('sync-clerk')
	@isPublic()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: '🔄 Sync User Session with Clerk',
		description: 'Syncs Clerk authentication token with user profile. Validates Clerk token and returns user profile data.',
	})
	@ApiBody({ type: UserSyncClerkDto })
	@ApiOkResponse({
		description: 'User session synced successfully',
		schema: {
			type: 'object',
			properties: {
				profileData: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						email: { type: 'string' },
						name: { type: 'string' },
						accessLevel: { type: 'string' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid request data' })
	@ApiUnauthorizedResponse({ description: 'Invalid or expired Clerk token' })
	async syncClerk(@Body() syncDto: UserSyncClerkDto) {
		const operationId = `USER_SYNC_CLERK_${Date.now()}`;
		this.logger.debug(`[${operationId}] User sync request`);

		try {
			const result = await this.userAuthService.syncClerkSession(syncDto);
			return result;
		} catch (error) {
			this.logger.error(`[${operationId}] Sync failed:`, error instanceof Error ? error.message : 'Unknown error');
			throw error;
		}
	}
}
