import {
	Controller,
	Post,
	Body,
	Param,
	Get,
	UseGuards,
	Request,
	BadRequestException,
	NotFoundException,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../../clerk/clerk.guard';
import { RoleGuard } from '../../guards/role.guard';
import { Roles } from '../../decorators/role.decorator';
import { AccessLevel } from '../../lib/enums/user.enums';
import {
	ApiTags,
	ApiOperation,
	ApiParam,
	ApiBody,
	ApiResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QuotationConversionService } from '../services/quotation-conversion.service';
import { QuotationConversionDto } from '../dto/quotation-conversion.dto';
import { AuthenticatedRequest, getClerkOrgId } from '../../lib/interfaces/authenticated-request.interface';
import { UserService } from '../../user/user.service';
import { OrganisationService } from '../../organisation/organisation.service';

@ApiTags('🔄 Quotation Conversion')
@Controller('quotations')
@UseGuards(ClerkAuthGuard, RoleGuard)
export class QuotationConversionController {
	constructor(
		private readonly quotationConversionService: QuotationConversionService,
		private readonly userService: UserService,
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

	@Post(':id/convert')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: 'Convert quotation to order',
		description: 'Converts a quotation to a paid order, updating user targets for both quotations and orders tracking. This process moves the sales amount from quotation targets to order targets, contributing to separate performance metrics.'
	})
	@ApiParam({ name: 'id', description: 'Quotation ID' })
	@ApiBody({ type: QuotationConversionDto })
	@ApiResponse({ status: 200, description: 'Quotation successfully converted to order' })
	@ApiBadRequestResponse({ description: 'Invalid quotation state or data' })
	@ApiNotFoundResponse({ description: 'Quotation not found' })
	@ApiUnauthorizedResponse({ description: 'Unauthorized' })
	async convertToOrder(
		@Param('id') id: string,
		@Body() conversionData: QuotationConversionDto,
		@Request() req: AuthenticatedRequest,
	) {
		if (!id || isNaN(Number(id))) {
			throw new BadRequestException('Invalid quotation ID');
		}

		const quotationId = Number(id);
		const userResult = await this.userService.findOne(req.user.uid);
		if (!userResult.user) {
			throw new NotFoundException('User not found');
		}
		const user = userResult.user;
		const orgId = await this.resolveOrgUid(req);
		const branchId = req.user?.branch?.uid;

		return this.quotationConversionService.convertToOrder(quotationId, conversionData, user, orgId, branchId);
	}

	@Get(':ref/conversion-status')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPERVISOR)
	@ApiOperation({ summary: 'Get quotation conversion status' })
	@ApiParam({ name: 'ref', description: 'Quotation reference' })
	@ApiResponse({ status: 200, description: 'Returns conversion status' })
	@ApiNotFoundResponse({ description: 'Quotation not found' })
	@ApiUnauthorizedResponse({ description: 'Unauthorized' })
	async getConversionStatus(@Param('ref') ref: string) {
		if (!ref) {
			throw new BadRequestException('Invalid quotation reference');
		}

		const quotationRef = Number(ref);
		return this.quotationConversionService.getConversionStatus(quotationRef);
	}

	@Post(':ref/conversion/rollback')
	@Roles(AccessLevel.ADMIN)
	@ApiOperation({ summary: 'Rollback a conversion' })
	@ApiParam({ name: 'ref', description: 'Quotation reference' })
	@ApiResponse({ status: 200, description: 'Conversion successfully rolled back' })
	@ApiBadRequestResponse({ description: 'Invalid request' })
	@ApiNotFoundResponse({ description: 'Quotation not found' })
	@ApiUnauthorizedResponse({ description: 'Unauthorized' })
	async rollbackConversion(@Param('ref') ref: string, @Request() req: AuthenticatedRequest) {
		if (!ref) {
			throw new BadRequestException('Invalid quotation reference');
		}

		const quotationRef = Number(ref);
		const userResult = await this.userService.findOne(req.user.uid);
		if (!userResult.user) {
			throw new NotFoundException('User not found');
		}
		const user = userResult.user;
		return this.quotationConversionService.rollbackConversion(quotationRef, user);
	}
}
