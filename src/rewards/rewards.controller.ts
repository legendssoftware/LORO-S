import { Controller, Get, Post, Body, Param, Query, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { CreateRewardDto } from './dto/create-reward.dto';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthenticatedRequest, getClerkOrgId } from '../lib/interfaces/authenticated-request.interface';
import { OrganisationService } from '../organisation/organisation.service';
import {
	ApiOperation,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiQuery,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('🏆 Rewards')
@Controller('rewards')
@UseGuards(ClerkAuthGuard, RoleGuard)
@EnterpriseOnly('rewards')
@ApiUnauthorizedResponse({ description: 'Unauthorized access due to invalid credentials or missing token' })
export class RewardsController {
	constructor(
		private readonly rewardsService: RewardsService,
		private readonly organisationService: OrganisationService,
	) {}

	private async resolveOrgUid(req: AuthenticatedRequest): Promise<number> {
		const clerkOrgId = getClerkOrgId(req);
		if (!clerkOrgId) {
			throw new BadRequestException('Organization context required');
		}
		const uid = await this.organisationService.findUidByClerkId(clerkOrgId);
		if (uid == null) {
			throw new BadRequestException('Organization not found');
		}
		return uid;
	}

	/**
	 * Safely converts a value to a number
	 * @param value - Value to convert (string, number, or undefined)
	 * @returns Number or undefined if conversion fails
	 */
	private toNumber(value: string | number | undefined): number | undefined {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}
		const numValue = Number(value);
		return isNaN(numValue) || !isFinite(numValue) ? undefined : numValue;
	}

	@Post('award-xp')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: 'Award XP to a user',
		description: createApiDescription(
			'Awards experience points to a specific user. Requires ADMIN or MANAGER role.',
			'The service method `RewardsService.awardXP()` processes XP award, validates user, updates user XP total, checks for level ups, and returns the updated reward information.',
			'RewardsService',
			'awardXP',
			'awards XP to a user, validates data, updates totals, and checks for level ups',
			'an object containing the updated XP total, level information, and reward details',
			['XP calculation', 'Level up detection', 'User validation', 'Reward tracking'],
		),
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
	async awardXP(@Body() createRewardDto: CreateRewardDto, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.rewardsService.awardXP(createRewardDto, orgId, branchId);
	}

	@Get('user-stats/:reference')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '📊 Get user rewards statistics',
		description: createApiDescription(
			'Retrieves comprehensive rewards statistics and XP information for a specific user including XP totals, level information, reward history, and statistics.',
			'The service method `RewardsService.getUserStats()` processes user reference, calculates XP totals, determines current level, retrieves reward history, and returns comprehensive statistics.',
			'RewardsService',
			'getUserStats',
			'retrieves user reward statistics, calculates XP totals, and determines level',
			'an object containing XP totals, level information, reward history, and statistics',
			['XP calculation', 'Level determination', 'History retrieval', 'Statistics aggregation']
		),
	})
	@ApiParam({
		name: 'reference',
		description: 'User Clerk ID (string identifier)',
		type: 'string',
		example: 'user_38Q1H1gVq5AdRomEFRmOS7zhTNo',
	})
	@ApiOkResponse({
		description: 'User rewards retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				rewards: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						currentXP: { type: 'number', example: 1250 },
						totalXP: { type: 'number', example: 1250 },
						level: { type: 'number', example: 5 },
						rank: { type: 'string', example: 'ROOKIE' },
						xpBreakdown: {
							type: 'object',
							properties: {
								tasks: { type: 'number', example: 500 },
								leads: { type: 'number', example: 300 },
								sales: { type: 'number', example: 200 },
								attendance: { type: 'number', example: 150 },
								collaboration: { type: 'number', example: 100 },
								login: { type: 'number', example: 0 },
								other: { type: 'number', example: 0 },
							},
						},
						owner: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 1 },
								clerkUserId: { type: 'string', example: 'user_38Q1H1gVq5AdRomEFRmOS7zhTNo' },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
							},
						},
						xpTransactions: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1 },
									xpAmount: { type: 'number', example: 100 },
									action: { type: 'string', example: 'task_completed' },
									createdAt: { type: 'string', format: 'date-time' },
								},
							},
						},
						achievements: {
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
			},
		},
	})
	@ApiNotFoundResponse({ description: 'User not found' })
	getUserRewards(@Param('reference') reference: string, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
		const requestingUserClerkId = req.user?.clerkUserId;
		return this.rewardsService.getUserRewards(reference, orgId, branchId, requestingUserClerkId);
	}

	@Get('rankings')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '🏆 Get position-only rankings (by XP or sales)',
		description: 'Returns top 3 rankings of users/salespeople by XP or sales. Rankings array is limited to top 3. currentUserPosition is the requester\'s actual rank (1-based), or null if they are not in the rankings.',
		operationId: 'getRankings',
	})
	@ApiQuery({ name: 'by', required: true, enum: ['xp', 'sales'], description: 'Rank by XP or sales' })
	@ApiQuery({ name: 'branchId', required: false, type: Number, description: 'Optional branch filter' })
	@ApiOkResponse({
		description: 'Rankings retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				data: {
					type: 'object',
					properties: {
						rankings: {
							type: 'array',
							maxItems: 3,
							description: 'Top 3 ranked users',
							items: {
								type: 'object',
								properties: {
									position: { type: 'number' },
									points: { type: 'number', nullable: true, description: 'XP points when by=xp; null when by=sales (position-only display)' },
									user: {
										type: 'object',
										properties: {
											uid: { type: 'number' },
											name: { type: 'string' },
											surname: { type: 'string' },
											photoURL: { type: 'string', nullable: true },
											branch: {
												type: 'object',
												nullable: true,
												properties: { uid: { type: 'number' }, name: { type: 'string' } },
											},
										},
									},
								},
							},
						},
						currentUserPosition: { type: 'number', nullable: true, description: 'Requester\'s actual rank (1-based); null if not in rankings' },
						metadata: {
							type: 'object',
							properties: {
								criteria: { type: 'string', enum: ['xp', 'sales'] },
								totalParticipants: { type: 'number' },
								generatedAt: { type: 'string', format: 'date-time' },
							},
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Missing org, invalid "by", or unauthenticated' })
	async getRankings(
		@Req() req: AuthenticatedRequest,
		@Query('by') by: string,
		@Query('branchId') branchIdParam?: string | number,
	) {
		const clerkOrgId = getClerkOrgId(req);
		if (!clerkOrgId) {
			throw new BadRequestException('Organization context required');
		}
		const byNorm = (by ?? '').toLowerCase() === 'sales' ? 'sales' : 'xp';
		const branchId = this.toNumber(branchIdParam);
		const requestingUserClerkId = req.user?.clerkUserId;
		if (!requestingUserClerkId) {
			throw new BadRequestException('User identity required');
		}
		return this.rewardsService.getRankings(clerkOrgId, branchId, byNorm, requestingUserClerkId);
	}

	@Get('leaderboard')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.MEMBER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '🏆 Get Organization XP Leaderboard',
		description: `
# 🏆 Organization XP Leaderboard

Retrieves the organization-wide leaderboard ranking users by their total experience points (XP). This endpoint provides comprehensive ranking data for gamification and performance tracking.

## 🎯 **Key Features**
- **Organization-Scoped**: Shows only users within the authenticated user's organization
- **Branch Filtering**: Optional filtering by specific branch location
- **XP-Based Ranking**: Users ranked by total accumulated XP points
- **Real-time Data**: Live ranking updates as users earn XP
- **Top 10 Results**: Returns the top 10 performers for performance
- **Rich User Data**: Includes user profiles, levels, and ranking information

## 📊 **Ranking System**
- **Primary Sort**: Total XP points in descending order
- **Secondary Sort**: Users with same XP ranked by most recent activity
- **Level Calculation**: Automatic level computation based on XP thresholds
- **Rank Titles**: Dynamic rank assignment based on user levels

## 🔒 **Access Control**
- **Role-Based Access**: Available to all authenticated users
- **Organization Isolation**: Users can only see leaderboard for their organization
- **Branch Visibility**: Branch filtering respects user permissions

## 📈 **XP Categories Tracked**
- **Tasks & Projects**: XP earned from task completion
- **Sales Performance**: XP from sales achievements and targets
- **Lead Generation**: XP from lead creation and conversion
- **Attendance & Activity**: XP from daily activity and engagement
- **Collaboration**: XP from team collaboration and knowledge sharing
- **Login Streaks**: XP from consistent platform usage

## 🎮 **Gamification Elements**
- **Level Progression**: Users advance through levels as they earn XP
- **Rank System**: Dynamic rank titles based on performance tiers
- **Visual Indicators**: Profile badges and achievement indicators
- **Progress Tracking**: Clear visibility of ranking and progress

## 📋 **Use Cases**
- **Team Motivation**: Encourage friendly competition and engagement
- **Performance Recognition**: Highlight top performers and their achievements
- **Goal Setting**: Help users understand ranking requirements
- **Team Building**: Foster collaboration through shared objectives
- **Recognition Programs**: Support employee recognition initiatives

## 🔄 **Data Updates**
- **Real-time Updates**: Leaderboard refreshes as users earn XP
- **Batch Processing**: Handles high-volume XP transactions efficiently
- **Caching Strategy**: Optimized for frequent leaderboard queries
- **Performance Optimized**: Efficient database queries for large organizations

## 📊 **Response Structure**
Returns comprehensive user ranking data including:
- Current ranking position
- User profile information
- Total XP accumulated
- Current level and rank
- XP breakdown by category
- Recent achievements and badges
		`,
		operationId: 'getOrganizationLeaderboard',
	})
	@ApiOkResponse({
		description: '✅ Organization leaderboard retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable'
				},
				data: {
						type: 'object',
						properties: {
						leaderboard: {
							type: 'array',
							description: 'Array of top-ranked users with their XP and profile data',
							items: {
								type: 'object',
								properties: {
									rank: {
										type: 'number',
										example: 1,
										description: 'User\'s current ranking position (1-based)'
									},
									user: {
										type: 'object',
										description: 'User profile information',
										properties: {
											uid: {
												type: 'number',
												example: 123,
												description: 'Unique user identifier'
											},
											username: {
												type: 'string',
												example: 'john.doe',
												description: 'User\'s username for login'
											},
											name: {
												type: 'string',
												example: 'John Doe',
												description: 'User\'s full display name'
											},
											surname: {
												type: 'string',
												example: 'Doe',
												description: 'User\'s last name'
											},
											photoURL: {
												type: 'string',
												example: 'https://example.com/avatars/john.jpg',
												description: 'User\'s profile picture URL',
												nullable: true
											},
											branch: {
												type: 'object',
												description: 'User\'s branch information',
												properties: {
													uid: {
														type: 'number',
														example: 456,
														description: 'Branch unique identifier'
													},
													name: {
														type: 'string',
														example: 'Pretoria South Africa',
														description: 'Branch location name'
													}
												},
												nullable: true
											}
										}
									},
									xp: {
										type: 'object',
										description: 'Comprehensive XP information',
										properties: {
											totalXP: {
												type: 'number',
												example: 3500,
												description: 'Total accumulated XP points across all categories'
											},
											currentXP: {
												type: 'number',
												example: 420,
												description: 'Current session XP (resets periodically)'
											},
											level: {
												type: 'number',
												example: 7,
												description: 'User\'s current level based on total XP'
											},
											rank: {
												type: 'string',
												example: 'EXPERT',
												description: 'User\'s rank title based on level'
											},
											nextLevelXP: {
												type: 'number',
												example: 4000,
												description: 'XP required to reach the next level'
											},
											levelProgress: {
												type: 'number',
												example: 87.5,
												description: 'Percentage progress towards next level (0-100)'
											},
											breakdown: {
												type: 'object',
												description: 'XP breakdown by activity category',
												properties: {
													tasks: {
														type: 'number',
														example: 1200,
														description: 'XP earned from task completion'
													},
													leads: {
														type: 'number',
														example: 850,
														description: 'XP earned from lead generation'
													},
													sales: {
														type: 'number',
														example: 950,
														description: 'XP earned from sales achievements'
													},
													attendance: {
														type: 'number',
														example: 300,
														description: 'XP earned from attendance and activity'
													},
													collaboration: {
														type: 'number',
														example: 150,
														description: 'XP earned from team collaboration'
													},
													login: {
														type: 'number',
														example: 50,
														description: 'XP earned from login streaks'
													},
													other: {
														type: 'number',
														example: 100,
														description: 'XP from miscellaneous activities'
													}
												}
											}
										}
									},
									statistics: {
										type: 'object',
										description: 'Performance statistics and metrics',
										properties: {
											xpThisMonth: {
												type: 'number',
												example: 450,
												description: 'XP earned in the current month'
											},
											xpLastMonth: {
												type: 'number',
												example: 380,
												description: 'XP earned in the previous month'
											},
											rankChange: {
												type: 'number',
												example: 2,
												description: 'Change in ranking position (positive = moved up)'
											},
											consistencyStreak: {
												type: 'number',
												example: 15,
												description: 'Number of consecutive days with XP activity'
											}
										}
									},
									achievements: {
								type: 'array',
										description: 'Recent achievements and badges earned',
								items: {
									type: 'object',
									properties: {
												uid: {
													type: 'number',
													example: 1,
													description: 'Achievement unique identifier'
												},
												name: {
													type: 'string',
													example: 'Early Bird',
													description: 'Achievement name/title'
												},
												description: {
													type: 'string',
													example: 'Completed 10 tasks before deadline',
													description: 'Achievement description'
												},
												icon: {
													type: 'string',
													example: 'https://example.com/badges/early-bird.png',
													description: 'Achievement icon URL'
												},
												earnedAt: {
													type: 'string',
													format: 'date-time',
													example: '2024-01-15T10:30:00Z',
													description: 'When the achievement was earned'
												}
											}
										}
									}
								}
							}
						},
						metadata: {
							type: 'object',
							description: 'Leaderboard metadata and summary statistics',
							properties: {
								totalParticipants: {
									type: 'number',
									example: 125,
									description: 'Total number of users with XP in the organization'
								},
								organizationId: {
									type: 'number',
									example: 789,
									description: 'Organization identifier'
								},
								branchId: {
									type: 'number',
									example: 456,
									description: 'Branch identifier (if filtered)',
									nullable: true
								},
								generatedAt: {
									type: 'string',
									format: 'date-time',
									example: '2024-01-15T14:30:00Z',
									description: 'When the leaderboard was generated'
								},
								period: {
									type: 'string',
									example: 'all-time',
									description: 'Time period for the leaderboard'
								}
							}
						}
					}
				}
			},
			required: ['message', 'data']
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 No users found with XP in the organization',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'No users with XP found in your organization'
				},
				data: {
					type: 'object',
					properties: {
						leaderboard: {
							type: 'array',
							description: 'Empty array when no users have earned XP',
							example: []
						}
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid request parameters',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Organization ID is required'
				},
				error: {
					type: 'string',
					example: 'Bad Request'
				},
				statusCode: {
					type: 'number',
					example: 400
				}
			}
		}
	})
	@ApiUnauthorizedResponse({
		description: '🔒 User not authenticated or lacks organization context',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Authentication required to access leaderboard'
				},
				error: {
					type: 'string',
					example: 'Unauthorized'
				},
				statusCode: {
					type: 'number',
					example: 401
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 System error while generating leaderboard',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Failed to generate leaderboard due to system error'
				},
				error: {
					type: 'string',
					example: 'Internal Server Error'
				},
				statusCode: {
					type: 'number',
					example: 500
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: '2024-01-15T14:30:00Z'
				}
			}
		}
	})
	async getLeaderboard(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.rewardsService.getLeaderboard(orgId, branchId);
	}
}
