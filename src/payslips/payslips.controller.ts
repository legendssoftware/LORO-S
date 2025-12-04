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
		description: `
# Payslip Creation

Creates a new payslip record for an employee with comprehensive payroll information and document management.

## 📋 **Core Features**
- **Employee Payroll**: Complete salary breakdown including gross pay, deductions, and net pay
- **Period Management**: Pay period tracking with start and end dates
- **Document Integration**: PDF generation and document reference management
- **Status Tracking**: Payslip status workflow (GENERATED, SENT, VIEWED)
- **Audit Trail**: Complete logging of payslip creation and modifications

## 🎯 **Use Cases**
- **Payroll Processing**: Generate payslips during payroll runs
- **Employee Compensation**: Document employee salary and benefits
- **HR Management**: Maintain payroll records for compliance
- **Financial Reporting**: Track payroll expenses and deductions
- **Employee Self-Service**: Provide payslip access to employees
		`,
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
		description: `
# Payslip Directory

Retrieves a comprehensive list of all payslips with advanced filtering and pagination capabilities.

## 📊 **Response Features**
- **Payslip Records**: Complete payslip information including payroll details
- **Employee Information**: User details associated with each payslip
- **Period Filtering**: Filter by pay period dates
- **Status Tracking**: Filter by payslip status (GENERATED, SENT, VIEWED)
- **Document Access**: Document references and download URLs
		`,
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
		description: `
# User Payslip Retrieval

Retrieves all payslips for a specific user with comprehensive payroll information and document access.

## 🔒 **Access Control**
- **Self-Service**: Users can view their own payslips
- **Management Access**: Managers can view payslips for their team members
- **HR Access**: HR and administrators can view all payslips
- **Organization Boundaries**: Payslips are filtered by organization/branch
		`,
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
		description: `
# Payslip Detail Retrieval

Retrieves detailed information about a specific payslip by its unique identifier.
		`,
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
		description: `
# Payslip Update

Updates an existing payslip's information with comprehensive validation and audit trail maintenance.
		`,
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
		description: `
# Payslip Deletion

Safely removes a payslip record with comprehensive cleanup and data preservation.
		`,
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
		description: `
# Payslip Document Download

Retrieves a secure download URL for a payslip PDF document. The URL is signed and time-limited for security.

## 🔒 **Security Features**
- **Signed URLs**: Time-limited download links for enhanced security
- **Access Control**: Users can only download payslips they have permission to view
- **Document Validation**: Ensures payslip document exists and is accessible
- **Audit Trail**: All download requests are logged for compliance

## 📋 **Response**
Returns a signed download URL that can be used to download the payslip PDF directly.
		`,
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
