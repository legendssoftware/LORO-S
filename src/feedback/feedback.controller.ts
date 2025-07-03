import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, ParseIntPipe } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FeedbackType, FeedbackStatus } from '../lib/enums/feedback.enums';

@ApiTags('📝 Feedback')
@Controller('feedback')
export class FeedbackController {
	constructor(private readonly feedbackService: FeedbackService) {}

	@Post()
	@ApiOperation({ summary: 'Submit new feedback' })
	@ApiBody({
		description: 'Feedback data with optional attachments',
		type: CreateFeedbackDto,
	})
	async create(@Body() createFeedbackDto: CreateFeedbackDto) {
		// No file handling needed as attachments are already URLs
		return this.feedbackService.create(createFeedbackDto);
	}

	@Post('submit-with-token')
	@ApiOperation({ summary: 'Submit feedback using a token' })
	@ApiBody({
		description: 'Feedback data with token',
		type: CreateFeedbackDto,
	})
	@ApiQuery({ name: 'token', required: true, type: String })
	@ApiQuery({ name: 'type', required: true, enum: FeedbackType })
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
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Get all feedback with pagination and filters' })
	@ApiQuery({ name: 'page', required: false, type: Number })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	@ApiQuery({ name: 'type', required: false, enum: FeedbackType })
	@ApiQuery({ name: 'status', required: false, enum: FeedbackStatus })
	@ApiQuery({ name: 'clientId', required: false, type: Number })
	@ApiQuery({ name: 'organisationId', required: false, type: Number })
	@ApiQuery({ name: 'branchId', required: false, type: Number })
	@ApiQuery({ name: 'startDate', required: false, type: Date })
	@ApiQuery({ name: 'endDate', required: false, type: Date })
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
	@ApiOperation({ summary: 'Validate a feedback token' })
	@ApiQuery({ name: 'token', required: true, type: String })
	async validateToken(@Query('token') token: string) {
		return this.feedbackService.validateToken(token);
	}

	@Get('stats')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Get feedback statistics' })
	@ApiQuery({ name: 'organisationId', required: true, type: Number })
	@ApiQuery({ name: 'branchId', required: false, type: Number })
	@ApiQuery({ name: 'startDate', required: false, type: Date })
	@ApiQuery({ name: 'endDate', required: false, type: Date })
	async getStats(
		@Query('organisationId', ParseIntPipe) organisationId: number,
		@Query('branchId') branchId?: number,
		@Query('startDate') startDate?: Date,
		@Query('endDate') endDate?: Date,
	) {
		return this.feedbackService.getFeedbackStats(organisationId, branchId, startDate, endDate);
	}

	@Get(':id')
	@UseGuards(AuthGuard)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Get a single feedback by ID' })
	@ApiParam({ name: 'id', type: Number })
	async findOne(@Param('id', ParseIntPipe) id: number) {
		return this.feedbackService.findOne(id);
	}

	@Patch(':id')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Update a feedback' })
	@ApiParam({ name: 'id', type: Number })
	async update(@Param('id', ParseIntPipe) id: number, @Body() updateFeedbackDto: UpdateFeedbackDto, @Req() req) {
		return this.feedbackService.update(id, updateFeedbackDto, req.user.uid);
	}

	@Delete(':id')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Delete a feedback' })
	@ApiParam({ name: 'id', type: Number })
	async remove(@Param('id', ParseIntPipe) id: number) {
		return this.feedbackService.remove(id);
	}
}
