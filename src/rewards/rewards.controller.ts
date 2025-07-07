import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { CreateRewardDto } from './dto/create-reward.dto';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import {
	ApiOperation,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('🏆 Rewards')
@Controller('rewards')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('rewards')
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class RewardsController {
	constructor(private readonly rewardsService: RewardsService) {}

	@Post('award-xp')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Award XP to a user',
		description: 'Awards experience points to a specific user. Requires ADMIN or MANAGER role.',
	})
	@ApiBody({ type: CreateRewardDto })
	@ApiCreatedResponse({
		description: 'XP awarded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						xp: { type: 'number', example: 100 },
						reason: { type: 'string', example: 'Completed project ahead of schedule' },
						createdAt: { type: 'string', format: 'date-time' },
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'John Doe' },
							},
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid input data provided' })
	@ApiNotFoundResponse({ description: 'User not found' })
	awardXP(@Body() createRewardDto: CreateRewardDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.rewardsService.awardXP(createRewardDto, orgId, branchId);
	}

	@Get('user-stats/:reference')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get user rewards',
		description:
			'Retrieves all rewards and statistics for a specific user. Accessible by ADMIN, MANAGER, and the user themselves.',
	})
	@ApiParam({
		name: 'reference',
		description: 'User reference code',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: 'User rewards retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						totalXP: { type: 'number', example: 1250 },
						level: { type: 'number', example: 5 },
						nextLevelXP: { type: 'number', example: 2000 },
						rewards: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1 },
									xp: { type: 'number', example: 100 },
									reason: { type: 'string', example: 'Completed project ahead of schedule' },
									createdAt: { type: 'string', format: 'date-time' },
								},
							},
						},
						badges: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1 },
									name: { type: 'string', example: 'Early Bird' },
									description: { type: 'string', example: 'Completed 10 tasks before deadline' },
									icon: { type: 'string', example: 'https://example.com/badges/early-bird.png' },
								},
							},
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({ description: 'User not found' })
	getUserRewards(@Param('reference') reference: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const requestingUserId = req.user?.uid;
		return this.rewardsService.getUserRewards(reference, orgId, branchId, requestingUserId);
	}

	@Get('leaderboard')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Get rewards leaderboard',
		description:
			'Retrieves the leaderboard showing users ranked by their XP. Accessible by ADMIN, MANAGER, and USER roles.',
	})
	@ApiOkResponse({
		description: 'Leaderboard retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							rank: { type: 'number', example: 1 },
							user: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1 },
									name: { type: 'string', example: 'John Doe' },
									avatar: { type: 'string', example: 'https://example.com/avatars/john.jpg' },
								},
							},
							totalXP: { type: 'number', example: 3500 },
							level: { type: 'number', example: 7 },
							badges: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 1 },
										name: { type: 'string', example: 'Early Bird' },
										icon: { type: 'string', example: 'https://example.com/badges/early-bird.png' },
									},
								},
							},
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	getLeaderboard(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.rewardsService.getLeaderboard(orgId, branchId);
	}
}
