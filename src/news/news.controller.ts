import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { NewsService } from './news.service';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import {
	ApiTags,
	ApiOperation,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('📰 News')
@Controller('news')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('news')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class NewsController {
	constructor(private readonly newsService: NewsService) {}

	@Post()
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
		summary: 'Create a new article',
		description: createApiDescription(
			'Creates a new news article with the provided details.',
			'The service method `NewsService.create()` processes article creation, validates data, sets publication status, and returns the created article with its reference.',
			'NewsService',
			'create',
			'creates a new news article, validates data, and sets publication status',
			'an object containing the created article data and reference',
			['Data validation', 'Publication status', 'Content formatting'],
		),
	})
	@ApiBody({ type: CreateNewsDto })
	@ApiCreatedResponse({
		description: 'Article created successfully',
		schema: {
			type: 'object',
			properties: {
				article: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						title: { type: 'string' },
						content: { type: 'string' },
						author: { type: 'string' },
						imageUrl: { type: 'string' },
						createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error creating article' },
			},
		},
	})
	create(@Body() createNewsDto: CreateNewsDto) {
		return this.newsService.create(createNewsDto);
	}

	@Get()
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '📋 Get all articles',
		description: createApiDescription(
			'Retrieves a list of all news articles in the system, ordered by publication date.',
			'The service method `NewsService.findAll()` queries all articles from the database, orders by creation date, and returns the complete list.',
			'NewsService',
			'findAll',
			'retrieves all news articles from the database',
			'an array of news article objects',
			['Database query', 'Article retrieval']
		),
	})
	@ApiOkResponse({
		description: 'Articles retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				articles: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							title: { type: 'string' },
							content: { type: 'string' },
							author: { type: 'string' },
							imageUrl: { type: 'string' },
						createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
						updatedAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	findAll() {
		return this.newsService.findAll();
	}

	@Get(':ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '🔍 Get an article by reference code',
		description: createApiDescription(
			'Retrieves detailed information about a specific news article by its reference ID.',
			'The service method `NewsService.findOne()` queries the database for the article by reference, validates existence, and returns complete article details.',
			'NewsService',
			'findOne',
			'retrieves a news article by reference ID',
			'a news article object with complete details',
			['Article lookup', 'Reference validation']
		),
	})
	@ApiParam({ name: 'ref', description: 'Article reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Article retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				article: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						title: { type: 'string' },
						content: { type: 'string' },
						author: { type: 'string' },
						imageUrl: { type: 'string' },
						createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
						updatedAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Article not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Article not found' },
				article: { type: 'null' },
			},
		},
	})
	findOne(@Param('ref') ref: number) {
		return this.newsService.findOne(ref);
	}

	@Patch(':ref')
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
		summary: '✏️ Update an article by reference code',
		description: createApiDescription(
			'Updates an existing news article with new content, title, or other fields.',
			'The service method `NewsService.update()` validates the article exists, applies updates, updates modification timestamp, and returns the updated article.',
			'NewsService',
			'update',
			'updates an existing news article with new information',
			'the updated news article object',
			['Article validation', 'Data update', 'Timestamp update']
		),
	})
	@ApiParam({ name: 'ref', description: 'Article reference code or ID', type: 'number' })
	@ApiBody({ type: UpdateNewsDto })
	@ApiOkResponse({
		description: 'Article updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Article not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Article not found' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error updating article' },
			},
		},
	})
	update(@Param('ref') ref: number, @Body() updateNewsDto: UpdateNewsDto) {
		return this.newsService.update(ref, updateNewsDto);
	}

	@Delete(':ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '🗑️ Soft delete an article by reference code',
		description: createApiDescription(
			'Marks a news article as deleted without removing it from the database, preserving data for audit purposes.',
			'The service method `NewsService.remove()` validates the article exists, marks it as deleted (soft delete), preserves data, and returns deletion confirmation.',
			'NewsService',
			'remove',
			'soft deletes a news article by marking it as deleted',
			'a confirmation object indicating successful deletion',
			['Soft delete', 'Data preservation', 'Audit trail']
		),
	})
	@ApiParam({ name: 'ref', description: 'Article reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Article deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Article not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Article not found' },
			},
		},
	})
	remove(@Param('ref') ref: number) {
		return this.newsService.remove(ref);
	}
}
