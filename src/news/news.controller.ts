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
		description: 'Creates a new news article with the provided details',
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
						createdAt: { type: 'string', format: 'date-time' },
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
		summary: 'Get all articles',
		description: 'Retrieves a list of all news articles',
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
							createdAt: { type: 'string', format: 'date-time' },
							updatedAt: { type: 'string', format: 'date-time' },
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
		summary: 'Get an article by reference code',
		description: 'Retrieves detailed information about a specific news article',
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
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
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
		summary: 'Update an article by reference code',
		description: 'Updates an existing news article with the provided information',
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
		summary: 'Soft delete an article by reference code',
		description: 'Marks a news article as deleted without removing it from the database',
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
