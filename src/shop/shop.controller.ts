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
import { CreateBlankQuotationDto } from './dto/create-blank-quotation.dto';
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
		summary: '🏆 Get top performing products',
		description: `
# Best Selling Products

Retrieves a curated list of top-performing products based on comprehensive sales analytics and performance metrics.

## 📊 **Analytics-Driven Selection**
- **Sales Volume**: Products with highest total sales quantities
- **Revenue Generation**: Items contributing most to total revenue
- **Conversion Rates**: Products with best view-to-purchase ratios
- **Customer Satisfaction**: High-rated products with positive reviews
- **Inventory Turnover**: Fast-moving products with healthy stock rotation

## 🎯 **Business Intelligence**
- **Performance Metrics**: Real-time sales data and analytics
- **Trend Analysis**: Historical performance patterns and seasonality
- **Market Positioning**: Competitive analysis and market share data
- **Customer Insights**: Buyer behavior and preference patterns
- **Revenue Impact**: Contribution to overall business performance

## 📈 **Use Cases**
- **Homepage Display**: Feature top products for maximum visibility
- **Marketing Campaigns**: Promote proven bestsellers
- **Inventory Planning**: Prioritize stock for high-demand items
- **Sales Training**: Highlight products with highest success rates
- **Customer Recommendations**: Suggest popular items to new customers
		`,
	})
	@ApiOkResponse({
		description: '✅ Best selling products retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				products: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 123, description: 'Product unique identifier' },
							name: { type: 'string', example: 'Premium Wireless Headphones', description: 'Product name' },
							description: { type: 'string', example: 'High-quality wireless headphones with noise cancellation', description: 'Product description' },
							price: { type: 'number', example: 299.99, description: 'Current selling price' },
							salePrice: { type: 'number', example: 249.99, description: 'Sale price if on promotion' },
							imageUrl: { type: 'string', example: 'https://example.com/headphones.jpg', description: 'Product image URL' },
							salesCount: { type: 'number', example: 1547, description: 'Total units sold' },
							rating: { type: 'number', example: 4.8, description: 'Average customer rating' },
							reviewCount: { type: 'number', example: 342, description: 'Total customer reviews' },
							category: { type: 'string', example: 'Electronics', description: 'Product category' },
							brand: { type: 'string', example: 'AudioTech', description: 'Product brand' },
							stockQuantity: { type: 'number', example: 87, description: 'Current stock level' },
							isOnSale: { type: 'boolean', example: true, description: 'Whether product is on sale' },
							discount: { type: 'number', example: 16.67, description: 'Discount percentage' },
							salesRank: { type: 'number', example: 1, description: 'Sales performance rank' },
							lastSoldAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Last sale timestamp' }
						},
					},
					description: 'Array of best-selling products'
				},
				message: { type: 'string', example: 'Best selling products retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						totalProducts: { type: 'number', example: 25, description: 'Total number of bestsellers' },
						rankingPeriod: { type: 'string', example: 'Last 30 days', description: 'Period used for ranking' },
						lastUpdated: { type: 'string', format: 'date-time', example: '2024-01-15T09:00:00Z', description: 'Last analytics update' },
						averageRating: { type: 'number', example: 4.6, description: 'Average rating of bestsellers' },
						totalRevenue: { type: 'number', example: 245670.89, description: 'Total revenue from bestsellers' }
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid query parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid bestseller query parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
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
		summary: '🆕 Get latest product arrivals',
		description: `
# New Arrivals Showcase

Displays the latest products added to the inventory with enhanced freshness indicators and early-access features.

## 🚀 **Fresh Product Features**
- **Chronological Ordering**: Products sorted by most recent addition
- **Freshness Indicators**: Visual badges showing how recently items were added
- **Early Access**: Priority access to newest inventory before general availability
- **Launch Tracking**: Monitor initial performance of new product introductions
- **Trend Detection**: Identify emerging product categories and market trends

## 📊 **Advanced Analytics**
- **Launch Performance**: Track how new products perform in their first weeks
- **Customer Reception**: Monitor ratings and reviews for new items
- **Inventory Velocity**: Measure how quickly new products sell
- **Market Validation**: Assess market demand for new offerings
- **Competitive Analysis**: Compare new arrivals to market alternatives

## 🎯 **Business Intelligence**
- **Product Lifecycle**: Track products from introduction to maturity
- **Customer Preferences**: Understand appetite for new products
- **Inventory Planning**: Optimize new product introduction timing
- **Marketing Insights**: Identify products for launch campaigns
- **Sales Training**: Highlight newest products for sales team focus

## 🔧 **Use Cases**
- **Product Discovery**: Help customers find latest offerings
- **Marketing Campaigns**: Feature new arrivals in promotions
- **Inventory Management**: Monitor new product reception
- **Customer Engagement**: Keep customers informed about latest additions
- **Sales Strategy**: Focus sales efforts on new product launches
		`,
	})
	@ApiOkResponse({
		description: '✅ New arrivals retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				products: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 456, description: 'Product unique identifier' },
							name: { type: 'string', example: 'Smart Home Security Camera', description: 'Product name' },
							description: { type: 'string', example: 'AI-powered security camera with 4K resolution and night vision', description: 'Product description' },
							price: { type: 'number', example: 199.99, description: 'Current selling price' },
							imageUrl: { type: 'string', example: 'https://example.com/security-camera.jpg', description: 'Product image URL' },
							category: { type: 'string', example: 'Electronics', description: 'Product category' },
							brand: { type: 'string', example: 'SecureTech', description: 'Product brand' },
							stockQuantity: { type: 'number', example: 50, description: 'Current stock level' },
							isNew: { type: 'boolean', example: true, description: 'Whether product is flagged as new' },
							rating: { type: 'number', example: 4.5, description: 'Average customer rating' },
							reviewCount: { type: 'number', example: 23, description: 'Total customer reviews' },
							createdAt: { type: 'string', format: 'date-time', example: '2024-01-12T14:30:00Z', description: 'Product creation date' },
							daysOld: { type: 'number', example: 3, description: 'Days since product was added' },
							launchStatus: { type: 'string', example: 'Recently Added', description: 'Product launch status' }
						},
					},
					description: 'Array of newly arrived products'
				},
				message: { type: 'string', example: 'New arrivals retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						totalNewProducts: { type: 'number', example: 12, description: 'Total number of new arrivals' },
						newestProductDate: { type: 'string', format: 'date-time', example: '2024-01-15T10:00:00Z', description: 'Date of newest product' },
						averageRating: { type: 'number', example: 4.3, description: 'Average rating of new arrivals' },
						categoriesRepresented: { type: 'array', items: { type: 'string' }, example: ['Electronics', 'Home', 'Fashion'], description: 'Categories with new arrivals' }
					}
				}
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
		summary: '📋 Create customer quotation',
		description: `
# Quotation Management System

Creates comprehensive quotations from shopping cart data with advanced pricing, tracking, and conversion capabilities.

## 📊 **Quotation Features**
- **Shopping Cart Integration**: Seamlessly convert cart items to formal quotations
- **Dynamic Pricing**: Support for multiple price lists and customer-specific pricing
- **Tax Calculation**: Automatic tax computation based on customer location
- **Currency Support**: Multi-currency quotations for international customers
- **Expiration Management**: Configurable quotation validity periods

## 🎯 **Sales Pipeline Integration**
- **Lead Generation**: Quotations contribute to sales pipeline metrics
- **Conversion Tracking**: Monitor quotation-to-order conversion rates
- **Target Contributions**: Automatically count toward quotation targets
- **Sales Analytics**: Comprehensive tracking of quotation performance
- **Customer Journey**: Track progression from quote to purchase

## 📈 **Advanced Features**
- **Approval Workflows**: Multi-level approval for high-value quotations
- **Document Generation**: Professional PDF quotation documents
- **Email Integration**: Automated quotation delivery and follow-up
- **Version Control**: Track quotation revisions and amendments
- **Competitive Analysis**: Compare quotations to market standards

## 🔧 **Business Intelligence**
- **Performance Metrics**: Track quotation success rates and trends
- **Customer Insights**: Analyze quotation patterns and preferences
- **Pricing Optimization**: Data-driven pricing strategy recommendations
- **Sales Forecasting**: Predict sales based on quotation pipeline
- **Territory Analysis**: Regional quotation performance tracking

## 🎪 **Use Cases**
- **B2B Sales**: Formal quotations for business customers
- **Complex Orders**: Multi-item quotations with custom pricing
- **Bulk Purchases**: Volume-based pricing and discounts
- **International Sales**: Cross-border quotations with appropriate pricing
- **Customer Onboarding**: Initial quotations for new customers
		`,
	})
	@ApiBody({ 
		type: CheckoutDto,
		description: 'Quotation creation data with cart items and customer information',
		examples: {
			standardQuotation: {
				summary: 'Standard customer quotation',
				description: 'Regular quotation with multiple items and standard pricing',
				value: {
					items: [
						{
							productId: 123,
							quantity: 2,
							price: 299.99,
							notes: 'Customer requested expedited delivery'
						},
						{
							productId: 456,
							quantity: 1,
							price: 149.99,
							notes: 'Include extended warranty'
						}
					],
					customerInfo: {
						name: 'John Smith',
						email: 'john@example.com',
						phone: '+1234567890',
						company: 'ABC Corp'
					},
					billingAddress: {
						street: '123 Main St',
						city: 'Anytown',
						state: 'CA',
						zipCode: '12345',
						country: 'USA'
					},
					shippingAddress: {
						street: '456 Business Ave',
						city: 'Corporate City',
						state: 'CA',
						zipCode: '12346',
						country: 'USA'
					},
					priceListType: 'standard',
					currency: 'USD',
					validityDays: 30,
					notes: 'Please include installation service quote'
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Quotation created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Quotation created successfully' },
				quotationId: { type: 'string', example: 'QT-2024-001234', description: 'Unique quotation identifier' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1234, description: 'Quotation database ID' },
						quotationNumber: { type: 'string', example: 'QT-2024-001234', description: 'Human-readable quotation number' },
						status: { type: 'string', example: 'PENDING', description: 'Current quotation status' },
						totalAmount: { type: 'number', example: 749.97, description: 'Total quotation amount' },
						taxAmount: { type: 'number', example: 62.50, description: 'Tax amount' },
						subtotal: { type: 'number', example: 687.47, description: 'Subtotal before tax' },
						currency: { type: 'string', example: 'USD', description: 'Quotation currency' },
						validUntil: { type: 'string', format: 'date-time', example: '2024-02-14T23:59:59Z', description: 'Quotation expiry date' },
						createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Creation timestamp' },
						customerInfo: {
							type: 'object',
							properties: {
								name: { type: 'string', example: 'John Smith' },
								email: { type: 'string', example: 'john@example.com' },
								company: { type: 'string', example: 'ABC Corp' }
							}
						},
						itemCount: { type: 'number', example: 3, description: 'Number of items in quotation' },
						downloadUrl: { type: 'string', example: 'https://example.com/quotations/QT-2024-001234.pdf', description: 'PDF download URL' }
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid quotation data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid quotation data provided' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Customer information is required',
						'At least one item must be included',
						'Invalid price format',
						'Currency code must be valid ISO 4217'
					]
				}
			}
		}
	})
	createQuotation(@Body() quotationData: CheckoutDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.shopService.createQuotation(quotationData, orgId, branchId);
	}

	@Post('blank-quotation')
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
		summary: 'Create a blank quotation with specific price list',
		description: 'Creates a blank quotation using selected products with pricing based on the specified price list type (premium, new, local, foreign, etc.). This allows for pre-defined pricing structures and can be sent to any email address.',
	})
	@ApiBody({ type: CreateBlankQuotationDto })
	@ApiCreatedResponse({
		description: 'Blank quotation created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
				quotationId: { type: 'string', example: 'BLQ-1704067200000' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Blank quotation items are required' },
			},
		},
	})
	createBlankQuotation(@Body() blankQuotationData: CreateBlankQuotationDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		const userId = req.user?.uid;
		
		console.log(`[ShopController] Blank quotation request from user ${userId} (org: ${orgId}, branch: ${branchId}):`, {
			itemCount: blankQuotationData?.items?.length,
			priceListType: blankQuotationData?.priceListType,
			title: blankQuotationData?.title,
			owner: blankQuotationData?.owner?.uid,
			client: blankQuotationData?.client?.uid,
			recipientEmail: blankQuotationData?.recipientEmail,
		});
		
		return this.shopService.createBlankQuotation(blankQuotationData, orgId, branchId);
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
		summary: '📋 Get all quotations',
		description: `
# Quotation Management Dashboard

Retrieves comprehensive quotation listings with advanced filtering, sorting, and analytics capabilities.

## 📊 **Quotation Overview**
- **Status Tracking**: Monitor quotations across all lifecycle stages
- **Performance Metrics**: Track conversion rates and success metrics
- **Customer Analysis**: Understand quotation patterns by customer segment
- **Revenue Pipeline**: Visualize potential revenue from active quotations
- **Timeline Management**: Track quotation aging and expiration

## 🎯 **Business Intelligence**
- **Conversion Analytics**: Track quotation-to-order conversion rates
- **Sales Pipeline**: Monitor quotation progress through sales stages
- **Customer Insights**: Analyze quotation behavior and preferences
- **Territory Performance**: Regional quotation success tracking
- **Forecasting**: Predict sales based on quotation pipeline

## 🔧 **Advanced Features**
- **Role-based Access**: Quotation visibility based on user permissions
- **Multi-currency Support**: Handle international quotations
- **Status Management**: Track quotation lifecycle stages
- **Batch Operations**: Bulk quotation management capabilities
- **Export Capabilities**: Generate quotation reports and analytics
		`,
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
		const userId = req.user?.uid;
		const userRole = req.user?.accessLevel;
		return this.shopService.getAllQuotations(orgId, branchId, userId, userRole);
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
		summary: '📧 Send quotation to client for review',
		description: `
# Client Quotation Review System

Initiates the client review process by sending professional quotations with secure review links and automated tracking.

## 📧 **Email Integration**
- **Professional Templates**: Branded email templates with company styling
- **Secure Review Links**: Time-limited, tokenized links for client actions
- **PDF Attachments**: Professional quotation documents attached to emails
- **Delivery Tracking**: Monitor email delivery and open rates
- **Automated Reminders**: Follow-up emails for pending reviews

## 🔐 **Security Features**
- **Token-based Authentication**: Secure, time-limited access tokens
- **Email Verification**: Validate recipient email addresses
- **Audit Trail**: Complete logging of all review activities
- **Access Control**: Role-based permissions for sending quotations
- **Anti-fraud Protection**: Prevent unauthorized quotation modifications

## 📊 **Tracking & Analytics**
- **Status Transitions**: Automatic status updates to "PENDING_CLIENT_REVIEW"
- **Response Tracking**: Monitor client engagement and response times
- **Conversion Metrics**: Track review-to-approval conversion rates
- **Performance Analytics**: Measure quotation success rates
- **Client Behavior**: Analyze client interaction patterns

## 🎯 **Business Process**
- **Workflow Integration**: Seamless integration with existing sales processes
- **Approval Chains**: Support for multi-level approval workflows
- **Notification System**: Real-time alerts for status changes
- **CRM Integration**: Synchronize with customer relationship management
- **Sales Pipeline**: Automatic progression through sales stages

## 🔧 **Advanced Features**
- **Multi-format Support**: PDF, HTML, and mobile-optimized formats
- **Language Localization**: Support for multiple languages
- **Custom Branding**: Company-specific templates and styling
- **Integration APIs**: Connect with external systems and tools
- **Bulk Operations**: Send multiple quotations simultaneously
		`,
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
