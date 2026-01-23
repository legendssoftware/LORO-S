import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, ParseIntPipe } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiCreatedResponse, ApiOkResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse, ApiForbiddenResponse } from '@nestjs/swagger';
import { FeedbackType, FeedbackStatus } from '../lib/enums/feedback.enums';
import { getDynamicDate, getDynamicDateTime, getPastDate, getFutureDateTime, createApiDescription } from '../lib/utils/swagger-helpers';

@ApiTags('💬 Feedback') 
@Controller('feedback')
export class FeedbackController {
	constructor(private readonly feedbackService: FeedbackService) {}

	@Post()
	@ApiOperation({
		summary: '💬 Submit new feedback',
		description: createApiDescription(
			'Submits new feedback from clients or users with optional attachments and categorization.',
			'The service method `FeedbackService.create()` processes feedback submission, validates data, categorizes feedback type, stores attachments, sends notifications to relevant stakeholders, and returns the created feedback record.',
			'FeedbackService',
			'create',
			'creates a feedback record, validates data, stores attachments, and sends notifications',
			'an object containing the created feedback data, feedback ID, and submission confirmation',
			['Data validation', 'Attachment handling', 'Notification sending', 'Categorization']
		),
	})
	@ApiBody({
		description: 'Feedback data with optional attachments',
		type: CreateFeedbackDto,
		examples: {
			'Client Feedback': {
				summary: 'Submit client feedback',
				value: {
					message: 'Great service! Very satisfied with the support team.',
					type: 'CLIENT_FEEDBACK',
					clientId: 123,
					rating: 5,
					attachments: []
				}
			},
			'Bug Report': {
				summary: 'Submit bug report',
				value: {
					message: 'Found an issue with the login page on mobile devices',
					type: 'BUG_REPORT',
					attachments: ['https://example.com/screenshot.png']
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Feedback submitted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Feedback submitted successfully' },
				feedback: {
					type: 'object',
					properties: {
						id: { type: 'number', example: 456 },
						message: { type: 'string', example: 'Great service!' },
						type: { type: 'string', enum: Object.values(FeedbackType) },
						status: { type: 'string', enum: Object.values(FeedbackStatus), example: 'PENDING' },
						createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid feedback data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed: Message is required' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	async create(@Body() createFeedbackDto: CreateFeedbackDto) {
		// No file handling needed as attachments are already URLs
		return this.feedbackService.create(createFeedbackDto);
	}

	@Post('submit-with-token')
	@ApiOperation({
		summary: '🔐 Submit feedback using a token',
		description: createApiDescription(
			'Submits feedback using a secure token for public or external submissions without authentication.',
			'The service method `FeedbackService.create()` validates the token, processes feedback submission, associates it with the token context, and returns the created feedback record.',
			'FeedbackService',
			'create',
			'validates token, creates feedback record, and associates with token context',
			'an object containing the created feedback data and submission confirmation',
			['Token validation', 'Public submission handling', 'Context association']
		),
	})
	@ApiBody({
		description: 'Feedback data with token',
		type: CreateFeedbackDto,
	})
	@ApiQuery({ name: 'token', required: true, type: String, description: 'Secure feedback token for public submission' })
	@ApiQuery({ name: 'type', required: true, enum: FeedbackType, description: 'Type of feedback being submitted' })
	@ApiCreatedResponse({
		description: '✅ Feedback submitted successfully with token',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Feedback submitted successfully' },
				feedback: {
					type: 'object',
					properties: {
						id: { type: 'number', example: 456 },
						type: { type: 'string', enum: Object.values(FeedbackType) },
						status: { type: 'string', enum: Object.values(FeedbackStatus), example: 'PENDING' }
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid token or feedback data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid or expired token' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	async submitWithToken(
		@Body() createFeedbackDto: CreateFeedbackDto,
		@Query('token') token: string,
		@Query('type') type: FeedbackType,
	) {
		// Add token and type to the DTO
		createFeedbackDto.token = token;
		createFeedbackDto.type = type;

		return this.feedbackService.create(createFeedbackDto);
	}

	@Get()
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiBearerAuth()
	@ApiOperation({
		summary: '📋 Get all feedback with pagination and filters',
		description: createApiDescription(
			'Retrieves a paginated list of feedback entries with advanced filtering capabilities.',
			'The service method `FeedbackService.findAll()` processes filtering criteria, applies pagination, filters by organization and branch context, and returns paginated feedback results.',
			'FeedbackService',
			'findAll',
			'retrieves feedback entries with filtering, pagination, and organization scoping',
			'a paginated response containing feedback entries, total count, and pagination metadata',
			['Filtering', 'Pagination', 'Organization scoping', 'Date range queries']
		),
	})
	@ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)', example: 1 })
	@ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 25)', example: 25 })
	@ApiQuery({ name: 'type', required: false, enum: FeedbackType, description: 'Filter by feedback type' })
	@ApiQuery({ name: 'status', required: false, enum: FeedbackStatus, description: 'Filter by feedback status' })
	@ApiQuery({ name: 'clientId', required: false, type: Number, description: 'Filter by client ID' })
	@ApiQuery({ name: 'organisationId', required: false, type: Number, description: 'Filter by organization ID' })
	@ApiQuery({ name: 'branchId', required: false, type: Number, description: 'Filter by branch ID' })
	@ApiQuery({ name: 'startDate', required: false, type: Date, description: 'Filter by start date', example: getPastDate(30) })
	@ApiQuery({ name: 'endDate', required: false, type: Date, description: 'Filter by end date', example: getDynamicDate() })
	@ApiOkResponse({
		description: '✅ Feedback retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'number', example: 456 },
							message: { type: 'string', example: 'Great service!' },
							type: { type: 'string', enum: Object.values(FeedbackType) },
							status: { type: 'string', enum: Object.values(FeedbackStatus) },
							createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
						}
					}
				},
				total: { type: 'number', example: 150 },
				page: { type: 'number', example: 1 },
				limit: { type: 'number', example: 25 },
				totalPages: { type: 'number', example: 6 }
			}
		}
	})
	@ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - Admin or Manager access required' })
	async findAll(
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('type') type?: FeedbackType,
		@Query('status') status?: FeedbackStatus,
		@Query('clientId') clientId?: number,
		@Query('organisationId') organisationId?: number,
		@Query('branchId') branchId?: number,
		@Query('startDate') startDate?: Date,
		@Query('endDate') endDate?: Date,
	) {
		return this.feedbackService.findAll(
			{
				type,
				status,
				clientId,
				organisationId,
				branchId,
				startDate,
				endDate,
			},
			page,
			limit,
		);
	}

	@Get('validate-token')
	@ApiOperation({
		summary: '✅ Validate a feedback token',
		description: createApiDescription(
			'Validates a feedback submission token to verify its authenticity and expiration status.',
			'The service method `FeedbackService.validateToken()` checks token validity, verifies expiration, and returns token status information.',
			'FeedbackService',
			'validateToken',
			'validates token authenticity and checks expiration status',
			'an object containing token validation status, expiration information, and associated context',
			['Token validation', 'Expiration checking', 'Security verification']
		),
	})
	@ApiQuery({ name: 'token', required: true, type: String, description: 'Feedback token to validate' })
	@ApiOkResponse({
		description: '✅ Token validation result',
		schema: {
			type: 'object',
			properties: {
				valid: { type: 'boolean', example: true },
				expired: { type: 'boolean', example: false },
				expiresAt: { type: 'string', format: 'date-time', example: getFutureDateTime(7) },
				organisationId: { type: 'number', example: 1 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid token format',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid token format' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	async validateToken(@Query('token') token: string) {
		return this.feedbackService.validateToken(token);
	}

	@Get('stats')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiBearerAuth()
	@ApiOperation({
		summary: '📊 Get feedback statistics',
		description: createApiDescription(
			'Retrieves comprehensive feedback statistics and analytics for an organization.',
			'The service method `FeedbackService.getFeedbackStats()` aggregates feedback data, calculates statistics by type and status, analyzes trends, and returns comprehensive analytics.',
			'FeedbackService',
			'getFeedbackStats',
			'aggregates feedback data, calculates statistics, and analyzes trends',
			'an object containing feedback statistics, type distribution, status breakdown, and trend analysis',
			['Data aggregation', 'Statistical analysis', 'Trend calculation', 'Organization scoping']
		),
	})
	@ApiQuery({ name: 'organisationId', required: true, type: Number, description: 'Organization ID for statistics', example: 1 })
	@ApiQuery({ name: 'branchId', required: false, type: Number, description: 'Optional branch ID filter' })
	@ApiQuery({ name: 'startDate', required: false, type: Date, description: 'Start date for statistics range', example: getPastDate(30) })
	@ApiQuery({ name: 'endDate', required: false, type: Date, description: 'End date for statistics range', example: getDynamicDate() })
	@ApiOkResponse({
		description: '✅ Feedback statistics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				total: { type: 'number', example: 150 },
				byType: {
					type: 'object',
					additionalProperties: { type: 'number' },
					example: { CLIENT_FEEDBACK: 80, BUG_REPORT: 50, FEATURE_REQUEST: 20 }
				},
				byStatus: {
					type: 'object',
					additionalProperties: { type: 'number' },
					example: { PENDING: 30, REVIEWED: 100, RESOLVED: 20 }
				},
				averageRating: { type: 'number', example: 4.5 },
				period: {
					type: 'object',
					properties: {
						startDate: { type: 'string', format: 'date', example: getPastDate(30) },
						endDate: { type: 'string', format: 'date', example: getDynamicDate() }
					}
				}
			}
		}
	})
	@ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - Admin or Manager access required' })
	async getStats(
		@Query('organisationId', ParseIntPipe) organisationId: number,
		@Query('branchId') branchId?: number,
		@Query('startDate') startDate?: Date,
		@Query('endDate') endDate?: Date,
	) {
		return this.feedbackService.getFeedbackStats(organisationId, branchId, startDate, endDate);
	}

	@Get(':id')
	@UseGuards(ClerkAuthGuard)
	@ApiBearerAuth()
	@ApiOperation({
		summary: '🔍 Get a single feedback by ID',
		description: createApiDescription(
			'Retrieves detailed information about a specific feedback entry by its ID.',
			'The service method `FeedbackService.findOne()` locates the feedback record, validates access permissions, loads related data, and returns the complete feedback information.',
			'FeedbackService',
			'findOne',
			'retrieves a feedback record by ID and validates access permissions',
			'an object containing the complete feedback data, attachments, and related information',
			['Record retrieval', 'Access validation', 'Related data loading']
		),
	})
	@ApiParam({ name: 'id', type: Number, description: 'Feedback ID', example: 456 })
	@ApiOkResponse({
		description: '✅ Feedback retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				id: { type: 'number', example: 456 },
				message: { type: 'string', example: 'Great service!' },
				type: { type: 'string', enum: Object.values(FeedbackType) },
				status: { type: 'string', enum: Object.values(FeedbackStatus) },
				rating: { type: 'number', example: 5 },
				attachments: { type: 'array', items: { type: 'string' } },
				createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Feedback not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Feedback not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
	async findOne(@Param('id', ParseIntPipe) id: number) {
		return this.feedbackService.findOne(id);
	}

	@Patch(':id')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiBearerAuth()
	@ApiOperation({
		summary: '✏️ Update a feedback',
		description: createApiDescription(
			'Updates an existing feedback entry with new information or status changes.',
			'The service method `FeedbackService.update()` validates update permissions, processes status changes, updates feedback data, sends notifications for status changes, and returns the updated feedback record.',
			'FeedbackService',
			'update',
			'updates feedback data, validates permissions, and handles status transitions',
			'an object containing the updated feedback data and change confirmation',
			['Permission validation', 'Status updates', 'Notification sending', 'Data validation']
		),
	})
	@ApiParam({ name: 'id', type: Number, description: 'Feedback ID to update', example: 456 })
	@ApiBody({
		type: UpdateFeedbackDto,
		description: 'Feedback update data',
		examples: {
			'Status Update': {
				summary: 'Update feedback status',
				value: {
					status: 'REVIEWED',
					notes: 'Reviewed and acknowledged'
				}
			},
			'Add Response': {
				summary: 'Add response to feedback',
				value: {
					response: 'Thank you for your feedback. We will address this issue.',
					status: 'RESOLVED'
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Feedback updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Feedback updated successfully' },
				feedback: {
					type: 'object',
					properties: {
						id: { type: 'number', example: 456 },
						status: { type: 'string', enum: Object.values(FeedbackStatus) },
						updatedAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({ description: '🔍 Feedback not found' })
	@ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - Admin or Manager access required' })
	async update(@Param('id', ParseIntPipe) id: number, @Body() updateFeedbackDto: UpdateFeedbackDto, @Req() req) {
		return this.feedbackService.update(id, updateFeedbackDto, req.user.uid);
	}

	@Delete(':id')
	@UseGuards(ClerkAuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiBearerAuth()
	@ApiOperation({
		summary: '🗑️ Delete a feedback',
		description: createApiDescription(
			'Permanently deletes a feedback entry from the system.',
			'The service method `FeedbackService.remove()` validates deletion permissions, removes the feedback record, cleans up associated attachments, and returns deletion confirmation.',
			'FeedbackService',
			'remove',
			'deletes feedback record, validates permissions, and cleans up associated data',
			'a confirmation object indicating successful deletion',
			['Permission validation', 'Record deletion', 'Attachment cleanup']
		),
	})
	@ApiParam({ name: 'id', type: Number, description: 'Feedback ID to delete', example: 456 })
	@ApiOkResponse({
		description: '✅ Feedback deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Feedback deleted successfully' },
				id: { type: 'number', example: 456 }
			}
		}
	})
	@ApiNotFoundResponse({ description: '🔍 Feedback not found' })
	@ApiUnauthorizedResponse({ description: '🔒 Unauthorized - Authentication required' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - Admin or Manager access required' })
	async remove(@Param('id', ParseIntPipe) id: number) {
		return this.feedbackService.remove(id);
	}
}
