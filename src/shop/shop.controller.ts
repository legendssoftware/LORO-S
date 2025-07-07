import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, Req, Query } from '@nestjs/common';
import { ShopService } from './shop.service';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
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
	ApiQuery,
} from '@nestjs/swagger';
import { Roles } from '../decorators/role.decorator';
import { Product } from '../products/entities/product.entity';
import { CheckoutDto } from './dto/checkout.dto';
import { AccessLevel } from '../lib/enums/user.enums';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { OrderStatus } from '../lib/enums/status.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { isPublic } from '../decorators/public.decorator';

@ApiTags('🛒 Shop')
@Controller('shop')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('shop')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class ShopController {
	constructor(private readonly shopService: ShopService) {}

	//shopping
	@Get('best-sellers')
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
		summary: 'Get a list of best selling products',
		description: 'Retrieves a list of products that have the highest sales volume',
	})
	@ApiOkResponse({
		description: 'Best selling products retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				products: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							description: { type: 'string' },
							price: { type: 'number' },
							imageUrl: { type: 'string' },
							salesCount: { type: 'number' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	getBestSellers(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.getBestSellers(orgId, branchId);
	}

	@Get('new-arrivals')
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
		summary: 'Get a list of newly arrived products',
		description: 'Retrieves a list of products that were recently added to the inventory',
	})
	@ApiOkResponse({
		description: 'New arrivals retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				products: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							description: { type: 'string' },
							price: { type: 'number' },
							imageUrl: { type: 'string' },
							createdAt: { type: 'string', format: 'date-time' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	getNewArrivals(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.getNewArrivals(orgId, branchId);
	}

	@Get('hot-deals')
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
		summary: 'Get a list of hot deals',
		description: 'Retrieves a list of products that are currently on sale or have special discounts',
	})
	@ApiOkResponse({
		description: 'Hot deals retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				products: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							description: { type: 'string' },
							price: { type: 'number' },
							discountedPrice: { type: 'number' },
							imageUrl: { type: 'string' },
							discount: { type: 'number' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	getHotDeals(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.getHotDeals(orgId, branchId);
	}

	@Get('categories')
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
		summary: 'Get a list of product categories',
		description: 'Retrieves all available product categories for filtering',
	})
	@ApiOkResponse({
		description: 'Categories retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				categories: {
					type: 'array',
					items: {
						type: 'string',
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	categories(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.categories(orgId, branchId);
	}

	@Get('specials')
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
		summary: 'Get a list of special offers',
		description: 'Retrieves products that are marked as special offers',
	})
	@ApiOkResponse({
		description: 'Special offers retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				products: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							description: { type: 'string' },
							price: { type: 'number' },
							imageUrl: { type: 'string' },
							specialDetails: { type: 'string' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	specials(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.specials(orgId, branchId);
	}

	@Post('quotation')
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
		summary: 'Create a new quotation',
		description: 'Creates a new quotation request from a shopping cart. Quotations are preliminary sales documents that track potential sales but are not yet converted to paid orders. This contributes to quotation targets tracking.',
	})
	@ApiBody({ type: CheckoutDto })
	@ApiCreatedResponse({
		description: 'Quotation created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
	})
	createQuotation(@Body() quotationData: CheckoutDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.createQuotation(quotationData, orgId, branchId);
	}

	@Get('quotations')
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
		summary: 'Get all quotations',
		description: 'Retrieves a list of all quotations. Quotations are preliminary sales documents that have not yet been converted to paid orders. Use the quotation conversion endpoint to convert quotations to orders.',
	})
	@ApiOkResponse({
		description: 'Quotations retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				quotations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							status: { type: 'string' },
							total: { type: 'number' },
							items: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										product: { type: 'object' },
										quantity: { type: 'number' },
										price: { type: 'number' },
									},
								},
							},
							client: { type: 'object' },
							createdAt: { type: 'string', format: 'date-time' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	getQuotations(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.getAllQuotations(orgId, branchId);
	}

	@Get('quotation/:ref')
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
		summary: 'Get a quotation by reference code',
		description: 'Retrieves detailed information about a specific quotation. Quotations are preliminary sales documents that can be converted to orders through the quotation conversion process.',
	})
	@ApiParam({ name: 'ref', description: 'Quotation reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Quotation retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				quotation: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						status: { type: 'string' },
						total: { type: 'number' },
						items: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									product: { type: 'object' },
									quantity: { type: 'number' },
									price: { type: 'number' },
								},
							},
						},
						client: { type: 'object' },
						billingAddress: { type: 'string' },
						shippingAddress: { type: 'string' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Quotation not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Quotation not found' },
			},
		},
	})
	getQuotationByRef(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.getQuotationByRef(ref, orgId, branchId);
	}

	@Get('quotations/user/:ref')
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
		summary: 'Get quotations by user',
		description: 'Retrieves all quotations placed by a specific user. This endpoint helps track user quotation performance and contributes to user quotation targets tracking.',
	})
	@ApiParam({ name: 'ref', description: 'User reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'User quotations retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				quotations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							status: { type: 'string' },
							total: { type: 'number' },
							items: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										product: { type: 'object' },
										quantity: { type: 'number' },
										price: { type: 'number' },
									},
								},
							},
							createdAt: { type: 'string', format: 'date-time' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'No quotations found for this user',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No quotations found for this user' },
				quotations: { type: 'array', items: {}, example: [] },
			},
		},
	})
	getQuotationsByUser(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.getQuotationsByUser(ref, orgId, branchId);
	}

	@Patch('quotation/:ref/status')
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
		summary: 'Update quotation status',
		description: 'Updates the status of a quotation or order',
	})
	@ApiParam({ name: 'ref', description: 'Quotation reference ID', type: 'number' })
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				status: {
					type: 'string',
					enum: Object.values(OrderStatus),
					example: OrderStatus.APPROVED,
				},
			},
			required: ['status'],
		},
	})
	@ApiOkResponse({
		description: 'Quotation status updated successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'Quotation status updated successfully' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Invalid status transition',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Invalid status transition' },
			},
		},
	})
	async updateQuotationStatus(
		@Param('ref') ref: number,
		@Body('status') status: OrderStatus,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.updateQuotationStatus(ref, status, orgId, branchId);
	}

	//banners
	@Get('banners')
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
		summary: 'Get all banners',
		description: 'Retrieves all banner images and information for the shop',
	})
	@ApiOkResponse({
		description: 'Banners retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				banners: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							title: { type: 'string' },
							subtitle: { type: 'string' },
							imageUrl: { type: 'string' },
							link: { type: 'string' },
							active: { type: 'boolean' },
						},
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	getBanner(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.getBanner(orgId, branchId);
	}

	@Post('banner')
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
		summary: 'Create a new banner',
		description: 'Creates a new banner image for the shop',
	})
	@ApiBody({ type: CreateBannerDto })
	@ApiCreatedResponse({
		description: 'Banner created successfully',
		schema: {
			type: 'object',
			properties: {
				banner: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						title: { type: 'string' },
						subtitle: { type: 'string' },
						imageUrl: { type: 'string' },
						link: { type: 'string' },
						active: { type: 'boolean' },
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
				message: { type: 'string', example: 'Error creating banner' },
			},
		},
	})
	createBanner(@Body() bannerData: CreateBannerDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.createBanner(bannerData, orgId, branchId);
	}

	@Patch('banner/:ref')
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
		summary: 'Update a banner',
		description: 'Updates an existing banner with new information',
	})
	@ApiParam({ name: 'ref', description: 'Banner reference code or ID', type: 'number' })
	@ApiBody({ type: UpdateBannerDto })
	@ApiOkResponse({
		description: 'Banner updated successfully',
		schema: {
			type: 'object',
			properties: {
				banner: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						title: { type: 'string' },
						subtitle: { type: 'string' },
						imageUrl: { type: 'string' },
						link: { type: 'string' },
						active: { type: 'boolean' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Banner not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Banner not found' },
				banner: { type: 'null' },
			},
		},
	})
	updateBanner(@Param('ref') ref: number, @Body() bannerData: UpdateBannerDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.updateBanner(ref, bannerData, orgId, branchId);
	}

	@Delete('banner/:ref')
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
		summary: 'Delete a banner',
		description: 'Removes a banner from the system',
	})
	@ApiParam({ name: 'ref', description: 'Banner reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Banner deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Banner not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Banner not found' },
			},
		},
	})
	deleteBanner(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.deleteBanner(ref, orgId, branchId);
	}

	// Product maintenance
	@Post('generate-missing-skus')
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
		summary: 'Generate missing SKUs',
		description: "Generates SKUs for products that don't have them",
	})
	async generateMissingSKUs(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.generateSKUsForExistingProducts(orgId, branchId);
	}

	@Post('regenerate-all-skus')
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
		summary: 'Regenerate all SKUs',
		description: 'Regenerates SKUs for all products in the system',
	})
	async regenerateAllSKUs(@Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.regenerateAllSKUs(orgId, branchId);
	}

	@Get('quotation/validate-review-token')
	@isPublic() // This makes the endpoint public (no authentication required)
	@ApiOperation({
		summary: 'Validate a quotation review token',
		description: 'Checks if a quotation review token is valid and returns the quotation details',
	})
	@ApiQuery({ name: 'token', required: true, type: 'string' })
	@ApiQuery({
		name: 'action',
		required: false,
		enum: ['approve', 'decline'],
		description: 'Optional action to perform',
	})
	@ApiOkResponse({
		description: 'Token is valid',
		schema: {
			type: 'object',
			properties: {
				valid: { type: 'boolean', example: true },
				quotation: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						quotationNumber: { type: 'string' },
						status: { type: 'string' },
						// Additional quotation properties as needed
					},
				},
				message: { type: 'string', example: 'Token is valid' },
				actionPerformed: { type: 'boolean', example: false },
				actionResult: {
					type: 'object',
					properties: {
						success: { type: 'boolean', example: true },
						message: { type: 'string', example: 'Quotation approved successfully' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Token is invalid',
		schema: {
			type: 'object',
			properties: {
				valid: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Token is invalid or expired' },
			},
		},
	})
	async validateReviewToken(@Query('token') token: string, @Query('action') action?: 'approve' | 'decline') {
		// First validate the token
		const validationResult = await this.shopService.validateReviewToken(token);

		// If token is valid and an action is specified, perform the action
		if (validationResult.valid && action && ['approve', 'decline'].includes(action)) {
			const status = action === 'approve' ? OrderStatus.APPROVED : OrderStatus.REJECTED;

			const actionResult = await this.shopService.updateQuotationStatusByToken(
				token,
				status,
				action === 'approve' ? 'Approved via email link' : 'Declined via email link',
			);

			return {
				...validationResult,
				actionPerformed: true,
				actionResult,
			};
		}

		return validationResult;
	}

	@Patch('quotation/update-status-by-token')
	@isPublic()
	@ApiOperation({
		summary: 'Update quotation status using a token',
		description: 'Updates the status of a quotation using a review token',
	})
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				token: {
					type: 'string',
					example: 'abc123...',
				},
				status: {
					type: 'string',
					enum: [OrderStatus.APPROVED, OrderStatus.REJECTED],
					example: OrderStatus.APPROVED,
				},
				comments: {
					type: 'string',
					example: 'Looks good, please proceed.',
				},
			},
			required: ['token', 'status'],
		},
	})
	@ApiOkResponse({
		description: 'Quotation status updated successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'Quotation status updated successfully' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Invalid token or status',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Invalid token or status' },
			},
		},
	})
	async updateQuotationStatusByToken(
		@Body('token') token: string,
		@Body('status') status: OrderStatus,
		@Body('comments') comments?: string,
	) {
		return this.shopService.updateQuotationStatusByToken(token, status, comments);
	}

	@Post('quotation/:ref/send-to-client')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Send a quotation to the client for review',
		description: 'Updates quotation status to pending client review and sends email with review link',
	})
	@ApiParam({ name: 'ref', description: 'Quotation reference ID', type: 'number' })
	@ApiOkResponse({
		description: 'Quotation sent successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'Quotation has been sent to the client for review.' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid status transition',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Cannot send quotation to client. Current status is invalid.' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Quotation not found',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Quotation not found' },
			},
		},
	})
	async sendQuotationToClient(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.sendQuotationToClient(ref, orgId, branchId);
	}
}
