import { Controller, Post, Get, Body, HttpCode, HttpStatus, Logger, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiOkResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiConsumes, ApiProduces, ApiBearerAuth } from '@nestjs/swagger';
import { ClientAuthService } from './client-auth.service';
import { ClientSyncClerkDto } from './dto/client-sync-clerk.dto';
import { isPublic } from '../decorators/public.decorator';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthenticatedRequest, getClerkUserId } from '../lib/interfaces/authenticated-request.interface';

@ApiTags('🔐 Client Authentication')
@Controller('client-auth')
@ApiConsumes('application/json')
@ApiProduces('application/json')
export class ClientAuthController {
	private readonly logger = new Logger(ClientAuthController.name);

	constructor(private readonly clientAuthService: ClientAuthService) {}

	@Get('me')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.CLIENT)
	@ApiBearerAuth('JWT-auth')
	@ApiOperation({
		summary: '📋 Get my profile (current client)',
		description: 'Returns the authenticated client profile including assigned sales rep (name, email, phone).',
	})
	@ApiOkResponse({
		description: 'Current client profile with assignedSalesRep',
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
						client: {
							type: 'object',
							properties: {
								uid: { type: 'number' },
								name: { type: 'string' },
								contactPerson: { type: 'string' },
								phone: { type: 'string' },
								organisationRef: { type: 'string', nullable: true },
								branchUid: { type: 'number', nullable: true },
								assignedSalesRep: {
									type: 'object',
									nullable: true,
									properties: {
										name: { type: 'string' },
										email: { type: 'string', nullable: true },
										phone: { type: 'string', nullable: true },
									},
								},
							},
						},
					},
				},
			},
		},
	})
	@ApiUnauthorizedResponse({ description: 'Unauthorized or not a client user' })
	async getMe(@Req() req: AuthenticatedRequest) {
		const clerkUserId = getClerkUserId(req);
		if (!clerkUserId) {
			throw new UnauthorizedException('Authentication required');
		}
		return this.clientAuthService.getMe(clerkUserId);
	}

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
