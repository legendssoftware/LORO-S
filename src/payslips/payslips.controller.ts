import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	UseGuards,
	Req,
	Query,
	ParseIntPipe,
	Logger,
} from '@nestjs/common';
import { PayslipsService } from './payslips.service';
import { CreatePayslipDto } from './dto/create-payslip.dto';
import { UpdatePayslipDto } from './dto/update-payslip.dto';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { FeatureGuard } from '../guards/feature.guard';
import { Roles } from '../decorators/role.decorator';
import { RequireFeature } from '../decorators/require-feature.decorator';
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
	ApiForbiddenResponse,
	ApiQuery,
	ApiBearerAuth,
	ApiConsumes,
	ApiProduces,
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, createApiDescription } from '../lib/utils/swagger-helpers';

@ApiBearerAuth('JWT-auth')
@ApiTags('💰 Payslips')
@Controller('payslips')
@UseGuards(AuthGuard, RoleGuard, FeatureGuard)
@RequireFeature('payslips.basic')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({
	description: '🔒 Unauthorized - Authentication required',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Authentication token is required' },
			error: { type: 'string', example: 'Unauthorized' },
			statusCode: { type: 'number', example: 401 },
		},
	},
})
export class PayslipsController {
	private readonly logger = new Logger(PayslipsController.name);

	constructor(private readonly payslipsService: PayslipsService) {}

	/**
	 * Determines access scope for the authenticated user
	 * @param user - Authenticated user object
	 * @returns Access scope with orgId and branchId (null for org-wide access)
	 */
	private getAccessScope(user: any) {
		const isElevatedUser = [
			AccessLevel.ADMIN,
			AccessLevel.OWNER,
			AccessLevel.MANAGER,
			AccessLevel.DEVELOPER,
			AccessLevel.SUPPORT,
		].includes(user?.role);

		const orgId = user?.org?.uid || user?.organisationRef;
		const branchId = isElevatedUser ? null : user?.branch?.uid;

		return {
			orgId,
			branchId,
			isElevated: isElevatedUser,
		};
	}

	@Post()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '➕ Create a new payslip',
		description: createApiDescription(
			'Creates a new payslip record for an employee with comprehensive payroll information and document management.',
			'The service method `PayslipsService.create()` validates employee data, calculates payroll amounts, generates document references, sets initial status, and returns the created payslip.',
			'PayslipsService',
			'create',
			'creates a new payslip, validates employee data, calculates payroll amounts, and generates document references',
			'a payslip object with complete payroll information and document reference',
			['Employee validation', 'Payroll calculation', 'Document generation', 'Status management']
		),
	})
	@ApiBody({ type: CreatePayslipDto, description: 'Payslip creation payload with employee payroll information' })
	@ApiCreatedResponse({
		description: '✅ Payslip created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				payslip: { type: 'object' },
			},
		},
	})
	@ApiBadRequestResponse({ description: '❌ Bad Request - Invalid or missing required data' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
	create(@Body() createPayslipDto: CreatePayslipDto, @Req() req: AuthenticatedRequest) {
		this.logger.log(`Creating payslip for user ${createPayslipDto.user?.uid}`);
		const accessScope = this.getAccessScope(req.user);
		return this.payslipsService.create(createPayslipDto, accessScope.orgId, accessScope.branchId);
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
	)
	@ApiOperation({
		summary: '📋 Get all payslips',
		description: createApiDescription(
			'Retrieves a comprehensive list of all payslips with advanced filtering and pagination capabilities.',
			'The service method `PayslipsService.findAll()` queries payslips from the database with filters, applies access control, paginates results, and returns the payslip list.',
			'PayslipsService',
			'findAll',
			'queries payslips with filters, applies access control, and paginates results',
			'a paginated list of payslip objects with employee information',
			['Database query', 'Access control', 'Filtering', 'Pagination']
		),
	})
	@ApiQuery({ name: 'page', description: 'Page number for pagination', required: false, type: Number })
	@ApiQuery({ name: 'limit', description: 'Number of items per page', required: false, type: Number })
	@ApiQuery({ name: 'userId', description: 'Filter by user ID', required: false, type: Number })
	@ApiQuery({ name: 'startDate', description: 'Filter by period start date', required: false, type: String })
	@ApiQuery({ name: 'endDate', description: 'Filter by period end date', required: false, type: String })
	@ApiQuery({ name: 'status', description: 'Filter by payslip status', required: false, enum: ['GENERATED', 'SENT', 'VIEWED'] })
	@ApiOkResponse({ description: '✅ Payslips retrieved successfully' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions to view payslips' })
	findAll(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('userId') userId?: number,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('status') status?: string,
	) {
		this.logger.debug(`Finding all payslips with filters: page=${page}, limit=${limit}, userId=${userId}`);
		const accessScope = this.getAccessScope(req.user);
		return this.payslipsService.findAll(
			{
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				userId,
				startDate,
				endDate,
				status,
			},
			page ? Number(page) : 1,
			limit ? Number(limit) : Number(process.env.DEFAULT_PAGE_LIMIT || 10),
		);
	}

	@Get('user/:ref')
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
		summary: '👤 Get payslips for a specific user',
		description: createApiDescription(
			'Retrieves all payslips for a specific user with comprehensive payroll information and document access.',
			'The service method `PayslipsService.findByUser()` queries payslips for the user, validates access permissions, filters by organization/branch, and returns user payslips.',
			'PayslipsService',
			'findByUser',
			'queries payslips for a specific user, validates access permissions, and filters by organization',
			'an array of payslip objects for the user',
			['User filtering', 'Access validation', 'Organization filtering']
		),
	})
	@ApiParam({ name: 'ref', description: 'User reference code or unique identifier', type: 'number' })
	@ApiOkResponse({ description: '✅ User payslips retrieved successfully' })
	@ApiNotFoundResponse({ description: '❌ User not found or no payslips available' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions' })
	findByUser(@Param('ref', ParseIntPipe) ref: number, @Req() req: AuthenticatedRequest) {
		this.logger.log(`Finding payslips for user ${ref}`);
		const accessScope = this.getAccessScope(req.user);

		this.logger.debug('🔍 DEBUG findByUser route:', {
			gettingPayslipsForUser: ref,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.payslipsService.findByUser(ref, accessScope.orgId, accessScope.branchId);
	}

	@Get(':id')
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
		summary: '📄 Get payslip by ID',
		description: createApiDescription(
			'Retrieves detailed information about a specific payslip by its unique identifier.',
			'The service method `PayslipsService.findOne()` queries the payslip by ID, validates access permissions, checks organization/branch boundaries, and returns complete payslip details.',
			'PayslipsService',
			'findOne',
			'retrieves a payslip by ID, validates access permissions, and checks organization boundaries',
			'a payslip object with complete details',
			['ID lookup', 'Access validation', 'Organization filtering']
		),
	})
	@ApiParam({ name: 'id', description: 'Payslip unique identifier', type: 'number' })
	@ApiOkResponse({ description: '✅ Payslip retrieved successfully' })
	@ApiNotFoundResponse({ description: '❌ Payslip not found' })
	findOne(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
		this.logger.log(`Finding payslip ${id}`);
		const accessScope = this.getAccessScope(req.user);
		return this.payslipsService.findOne(id, accessScope.orgId, accessScope.branchId);
	}

	@Patch(':id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '✏️ Update payslip information',
		description: createApiDescription(
			'Updates an existing payslip\'s information with comprehensive validation and audit trail maintenance.',
			'The service method `PayslipsService.update()` validates the payslip exists, applies updates, maintains audit trail, updates modification timestamp, and returns the updated payslip.',
			'PayslipsService',
			'update',
			'updates payslip information, validates changes, and maintains audit trail',
			'the updated payslip object',
			['Payslip validation', 'Data update', 'Audit trail', 'Timestamp update']
		),
	})
	@ApiParam({ name: 'id', description: 'Payslip unique identifier', type: 'number' })
	@ApiBody({ type: UpdatePayslipDto, description: 'Payslip update payload - supports partial updates' })
	@ApiOkResponse({ description: '✅ Payslip updated successfully' })
	@ApiNotFoundResponse({ description: '🔍 Payslip not found for update' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - No permission to update payslip' })
	update(
		@Param('id', ParseIntPipe) id: number,
		@Body() updatePayslipDto: UpdatePayslipDto,
		@Req() req: AuthenticatedRequest,
	) {
		this.logger.log(`Updating payslip ${id}`);
		const accessScope = this.getAccessScope(req.user);

		this.logger.debug('🔍 DEBUG update route:', {
			updatingPayslip: id,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.payslipsService.update(id, updatePayslipDto, accessScope.orgId, accessScope.branchId);
	}

	@Delete(':id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🗑️ Delete a payslip',
		description: createApiDescription(
			'Safely removes a payslip record with comprehensive cleanup and data preservation.',
			'The service method `PayslipsService.remove()` validates the payslip exists, checks permissions, performs soft delete, preserves audit trail, and returns deletion confirmation.',
			'PayslipsService',
			'remove',
			'removes a payslip, performs soft delete, and preserves audit trail',
			'a confirmation object indicating successful deletion',
			['Soft delete', 'Permission check', 'Audit trail preservation']
		),
	})
	@ApiParam({ name: 'id', description: 'Payslip unique identifier', type: 'number' })
	@ApiOkResponse({ description: '✅ Payslip deleted successfully' })
	@ApiNotFoundResponse({ description: '🔍 Payslip not found for deletion' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - No permission to delete payslip' })
	remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
		this.logger.log(`Deleting payslip ${id}`);
		const accessScope = this.getAccessScope(req.user);

		this.logger.debug('🔍 DEBUG remove route:', {
			removingPayslip: id,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.payslipsService.remove(id, accessScope.orgId, accessScope.branchId);
	}

	@Get(':id/document')
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
		summary: '📥 Download payslip document',
		description: createApiDescription(
			'Retrieves a secure download URL for a payslip PDF document. The URL is signed and time-limited for security.',
			'The service method `PayslipsService.getDocumentDownloadUrl()` validates payslip exists, checks access permissions, generates signed URL with expiration, logs download request, and returns the download URL.',
			'PayslipsService',
			'getDocumentDownloadUrl',
			'generates a signed download URL for payslip document with access validation',
			'an object containing the signed download URL, filename, and mime type',
			['Access validation', 'Signed URL generation', 'Download logging']
		),
	})
	@ApiParam({ name: 'id', description: 'Payslip unique identifier', type: 'number' })
	@ApiOkResponse({
		description: '✅ Download URL generated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Download URL generated successfully' },
				url: { type: 'string', example: 'https://storage.example.com/payslips/12345.pdf?signature=...' },
				fileName: { type: 'string', example: 'payslip-2024-01.pdf' },
				mimeType: { type: 'string', example: 'application/pdf' },
			},
		},
	})
	@ApiNotFoundResponse({ description: '❌ Payslip not found or document not available' })
	@ApiForbiddenResponse({ description: '🚫 Forbidden - Insufficient permissions to download payslip' })
	async getDocument(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
		this.logger.log(`Getting document download URL for payslip ${id}`);
		const accessScope = this.getAccessScope(req.user);

		this.logger.debug('🔍 DEBUG getDocument route:', {
			payslipId: id,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.payslipsService.getDocumentDownloadUrl(id, accessScope.orgId, accessScope.branchId);
	}
}
