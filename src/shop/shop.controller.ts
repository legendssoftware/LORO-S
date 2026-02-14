import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards, Req, Query, UnauthorizedException, Logger, BadRequestException } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ProjectsService } from './projects.service';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
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
	ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, getFutureDate, getPastDate, createApiDescription } from '../lib/utils/swagger-helpers';
import { Roles } from '../decorators/role.decorator';
import { Product } from '../products/entities/product.entity';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateBlankQuotationDto } from './dto/create-blank-quotation.dto';
import { AccessLevel } from '../lib/enums/user.enums';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignQuotationToProjectDto, UnassignQuotationFromProjectDto } from './dto/assign-quotation-to-project.dto';
import { ProjectStatus, ProjectPriority, ProjectType } from '../lib/enums/project.enums';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { OrderStatus } from '../lib/enums/status.enums';
import { isPublic } from '../decorators/public.decorator';
import { AuthenticatedRequest, getClerkOrgId, getClerkUserId } from '../lib/interfaces/authenticated-request.interface';
import { OrganisationService } from '../organisation/organisation.service';

@ApiTags('🛒 Shop')
@Controller('shop')
@UseGuards(ClerkAuthGuard, RoleGuard)
@EnterpriseOnly('shop')
@ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid credentials or missing token' })
export class ShopController {
	private readonly logger = new Logger(ShopController.name);

	constructor(
		private readonly shopService: ShopService,
		private readonly projectsService: ProjectsService,
		private readonly organisationService: OrganisationService,
	) {}

	private async resolveOrgUid(req: AuthenticatedRequest): Promise<string> {
		const clerkOrgId = getClerkOrgId(req);
		if (!clerkOrgId) {
			throw new BadRequestException('Organization context required');
		}
		return clerkOrgId;
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
		AccessLevel.MEMBER,
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
	async getBestSellers(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		AccessLevel.MEMBER,
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
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '🔥 Get hot deals and promotions',
		description: `
# Hot Deals & Promotions Hub

Discovers and retrieves high-value promotional products with exceptional discounts and limited-time offers.

## 🔥 **Deal Discovery Engine**
- **Discount Detection**: Automatically identifies products with significant price reductions
- **Promotion Tracking**: Real-time monitoring of active promotional campaigns
- **Time-sensitive Deals**: Highlights deals with expiration dates and urgency indicators
- **Value Analysis**: Calculates savings potential and value propositions for customers
- **Stock Awareness**: Prioritizes deals with available inventory

## 📊 **Advanced Deal Analytics**
- **Popularity Metrics**: Track deal performance and customer engagement
- **Conversion Tracking**: Monitor deal-to-purchase conversion rates
- **Revenue Impact**: Measure promotional effectiveness on sales performance
- **Customer Behavior**: Analyze how customers interact with promotional offers
- **Market Trends**: Identify trending products and seasonal opportunities

## 🎯 **Business Intelligence**
- **Promotional ROI**: Calculate return on investment for promotional campaigns
- **Inventory Management**: Optimize stock levels for promotional products
- **Pricing Strategy**: Data-driven insights for promotional pricing decisions
- **Customer Segmentation**: Identify customer segments most responsive to deals
- **Competitive Analysis**: Compare promotional strategies to market standards

## 🔧 **Smart Deal Features**
- **Dynamic Pricing**: Real-time price adjustments based on demand and inventory
- **Personalization**: Customized deal recommendations based on customer history
- **Bundle Opportunities**: Identify complementary products for cross-selling
- **Urgency Indicators**: Create scarcity and time-pressure for increased conversions
- **Mobile Optimization**: Responsive design for mobile shopping experiences

## 📈 **Marketing Integration**
- **Campaign Tracking**: Monitor performance of marketing-driven promotions
- **Social Sharing**: Enable easy sharing of hot deals on social platforms
- **Email Marketing**: Integration with email campaign systems for deal notifications
- **Push Notifications**: Real-time alerts for new and expiring deals
- **Affiliate Programs**: Support for affiliate-driven promotional campaigns

## 🎪 **Use Cases**
- **Seasonal Sales**: Holiday and seasonal promotional campaigns
- **Inventory Clearance**: Move slow-moving or excess inventory
- **Customer Acquisition**: Attract new customers with compelling offers
- **Loyalty Programs**: Reward repeat customers with exclusive deals
- **Market Penetration**: Competitive pricing for market share growth
- **Revenue Optimization**: Maximize revenue through strategic promotions
		`,
	})
	@ApiOkResponse({
		description: '✅ Hot deals retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				products: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 789, description: 'Product unique identifier' },
							name: { type: 'string', example: 'Gaming Laptop RTX 4070', description: 'Product name' },
							description: { type: 'string', example: 'High-performance gaming laptop with RTX 4070 graphics card', description: 'Product description' },
							price: { type: 'number', example: 1299.99, description: 'Original price' },
							discountedPrice: { type: 'number', example: 999.99, description: 'Discounted sale price' },
							salePrice: { type: 'number', example: 999.99, description: 'Current sale price' },
							imageUrl: { type: 'string', example: 'https://example.com/gaming-laptop.jpg', description: 'Product image URL' },
							discount: { type: 'number', example: 23.08, description: 'Discount percentage' },
							savings: { type: 'number', example: 300.00, description: 'Total savings amount' },
							category: { type: 'string', example: 'Electronics', description: 'Product category' },
							brand: { type: 'string', example: 'TechGaming', description: 'Product brand' },
							stockQuantity: { type: 'number', example: 15, description: 'Current stock level' },
							rating: { type: 'number', example: 4.7, description: 'Average customer rating' },
							reviewCount: { type: 'number', example: 189, description: 'Total customer reviews' },
							isOnPromotion: { type: 'boolean', example: true, description: 'Whether product is on promotion' },
							promotionType: { type: 'string', example: 'Flash Sale', description: 'Type of promotion' },
							promotionStartDate: { type: 'string', format: 'date-time', example: '2024-01-15T00:00:00Z', description: 'Promotion start date' },
							promotionEndDate: { type: 'string', format: 'date-time', example: '2024-01-20T23:59:59Z', description: 'Promotion end date' },
							timeRemaining: { type: 'string', example: '2 days, 14 hours', description: 'Time remaining for deal' },
							urgencyLevel: { type: 'string', example: 'HIGH', description: 'Deal urgency level' },
							dealScore: { type: 'number', example: 8.5, description: 'Deal value score (1-10)' },
							limitedQuantity: { type: 'boolean', example: true, description: 'Whether deal has limited quantity' },
							maxQuantityPerCustomer: { type: 'number', example: 2, description: 'Maximum quantity per customer' }
						},
					},
					description: 'Array of hot deals and promotional products'
				},
				message: { type: 'string', example: 'Hot deals retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						totalDeals: { type: 'number', example: 25, description: 'Total number of hot deals' },
						averageDiscount: { type: 'number', example: 32.5, description: 'Average discount percentage' },
						totalSavings: { type: 'number', example: 15420.75, description: 'Total potential savings' },
						activePromotions: { type: 'number', example: 8, description: 'Number of active promotions' },
						endingSoon: { type: 'number', example: 3, description: 'Number of deals ending soon' },
						lastUpdated: { type: 'string', format: 'date-time', example: '2024-01-15T09:30:00Z', description: 'Last update timestamp' }
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
				message: { type: 'string', example: 'Invalid hot deals query parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve hot deals',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve hot deals due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async getHotDeals(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '📂 Get comprehensive product categories',
		description: `
# Product Categories Management

Retrieves a comprehensive list of all available product categories with hierarchical structure and metadata for advanced filtering and navigation.

## 📋 **Category Intelligence**
- **Hierarchical Structure**: Main categories with subcategories and nested levels
- **Product Counts**: Real-time count of products in each category
- **Availability Status**: Active/inactive status for each category
- **Performance Metrics**: Sales data and popularity rankings per category
- **Seasonal Indicators**: Categories with seasonal availability patterns

## 🎯 **Advanced Features**
- **Smart Filtering**: Categories with filtering capabilities and search optimization
- **Localization Support**: Multi-language category names and descriptions
- **SEO Optimization**: SEO-friendly category URLs and metadata
- **Dynamic Categorization**: Auto-categorization based on product attributes
- **Merchandising Support**: Featured categories and promotional groupings

## 📊 **Business Intelligence**
- **Category Performance**: Revenue and sales analytics per category
- **Trend Analysis**: Category popularity trends and seasonal patterns
- **Inventory Distribution**: Stock levels and distribution across categories
- **Customer Preferences**: Most viewed and purchased categories
- **Market Analysis**: Category performance compared to industry standards

## 🔧 **Use Cases**
- **Product Navigation**: Primary navigation for e-commerce frontend
- **Inventory Management**: Organize and manage product catalogs
- **Analytics & Reporting**: Category-based performance analysis
- **Marketing Campaigns**: Target specific product categories
- **Search & Discovery**: Enhanced product discovery and filtering
- **Admin Management**: Category management and organization

## 🎪 **Integration Features**
- **Search Integration**: Category-based search enhancement
- **Recommendation Engine**: Category-aware product recommendations
- **Inventory Sync**: Real-time category inventory updates
- **Marketing Automation**: Category-based marketing campaigns
- **Analytics Platform**: Category performance tracking and insights
		`,
	})
	@ApiOkResponse({
		description: '✅ Product categories retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				categories: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string', example: 'ELECTRONICS', description: 'Category unique identifier' },
							name: { type: 'string', example: 'Electronics', description: 'Category display name' },
							slug: { type: 'string', example: 'electronics', description: 'SEO-friendly category URL slug' },
							description: { type: 'string', example: 'Electronic devices and gadgets', description: 'Category description' },
							parentId: { type: 'string', example: null, description: 'Parent category ID for hierarchical structure' },
							level: { type: 'number', example: 1, description: 'Category hierarchy level' },
							productCount: { type: 'number', example: 156, description: 'Number of active products in category' },
							isActive: { type: 'boolean', example: true, description: 'Whether category is active' },
							isFeatured: { type: 'boolean', example: true, description: 'Whether category is featured' },
							sortOrder: { type: 'number', example: 1, description: 'Display order for category' },
							imageUrl: { type: 'string', example: 'https://example.com/categories/electronics.jpg', description: 'Category image URL' },
							iconUrl: { type: 'string', example: 'https://example.com/icons/electronics.svg', description: 'Category icon URL' },
							seoTitle: { type: 'string', example: 'Electronics - Premium Gadgets & Devices', description: 'SEO title' },
							seoDescription: { type: 'string', example: 'Discover premium electronics including smartphones, laptops, and smart home devices', description: 'SEO description' },
							createdAt: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00Z', description: 'Category creation date' },
							updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Last update timestamp' },
							subcategories: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										id: { type: 'string', example: 'SMARTPHONES', description: 'Subcategory ID' },
										name: { type: 'string', example: 'Smartphones', description: 'Subcategory name' },
										productCount: { type: 'number', example: 45, description: 'Products in subcategory' },
										isActive: { type: 'boolean', example: true, description: 'Subcategory active status' }
									}
								},
								description: 'Nested subcategories'
							},
							analytics: {
								type: 'object',
								properties: {
									totalRevenue: { type: 'number', example: 125000.50, description: 'Total revenue from category' },
									averageOrderValue: { type: 'number', example: 299.99, description: 'Average order value' },
									conversionRate: { type: 'number', example: 3.2, description: 'Category conversion rate (%)' },
									popularityRank: { type: 'number', example: 2, description: 'Popularity ranking' },
									seasonalTrend: { type: 'string', example: 'STABLE', description: 'Seasonal trend indicator' },
									lastSaleDate: { type: 'string', format: 'date-time', example: '2024-01-15T09:45:00Z', description: 'Last sale timestamp' }
								},
								description: 'Category performance analytics'
							}
						}
					},
					description: 'Comprehensive list of product categories with metadata'
				},
				message: { type: 'string', example: 'Product categories retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						totalCategories: { type: 'number', example: 24, description: 'Total number of categories' },
						activeCategories: { type: 'number', example: 22, description: 'Number of active categories' },
						featuredCategories: { type: 'number', example: 8, description: 'Number of featured categories' },
						hierarchyLevels: { type: 'number', example: 3, description: 'Maximum hierarchy depth' },
						totalProducts: { type: 'number', example: 1247, description: 'Total products across all categories' },
						lastUpdated: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Last category update' },
						organizationId: { type: 'number', example: 123, description: 'Organization ID' },
						branchId: { type: 'number', example: 456, description: 'Branch ID' }
					},
					description: 'Category metadata and statistics'
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid category request',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid category request parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						organizationId: { type: 'number', example: 123 },
						branchId: { type: 'number', example: 456 },
						reason: { type: 'string', example: 'Invalid organization or branch specified' }
					}
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve categories',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve categories due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
				path: { type: 'string', example: '/shop/categories' }
			}
		}
	})
	async categories(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		// Omit branch filter so categories always show org-wide; improves display consistency
		this.logger.log(`📦 [ShopController] categories endpoint called - orgId: ${orgId}`);
		const result = await this.shopService.categories(orgId, undefined);
		this.logger.log(`📦 [ShopController] categories response prepared - categories count: ${result?.categories?.length ?? 0}`);
		return result;
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
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '⭐ Get premium special offers & promotions',
		description: `
# Special Offers & Promotions Hub

Discovers and retrieves premium special offers, limited-time promotions, and exclusive deals with comprehensive promotional analytics and customer targeting.

## 🎯 **Special Offers Engine**
- **Curated Selections**: Hand-picked special offers and premium promotions
- **Tiered Promotions**: Multiple discount levels from basic to premium offers
- **Temporal Targeting**: Time-sensitive offers with countdown timers
- **Inventory-Based**: Special pricing based on stock levels and turnover
- **Customer Segmentation**: Personalized special offers based on customer profiles

## 🏆 **Promotional Intelligence**
- **Dynamic Pricing**: Real-time price adjustments based on demand and inventory
- **Competitive Analysis**: Market-aware pricing and promotional strategies
- **Customer Behavior**: Personalized offers based on purchase history
- **Seasonal Optimization**: Holiday and seasonal promotional campaigns
- **A/B Testing**: Promotional effectiveness testing and optimization

## 📊 **Advanced Analytics**
- **Promotion Performance**: Track effectiveness of special offers and campaigns
- **Customer Engagement**: Monitor customer interaction with promotional content
- **Conversion Tracking**: Measure special offer to purchase conversion rates
- **ROI Analysis**: Calculate return on investment for promotional campaigns
- **Trend Analysis**: Identify successful promotional patterns and strategies

## 🔧 **Business Features**
- **Inventory Management**: Special offers to move slow-moving inventory
- **Customer Retention**: Exclusive offers for loyalty program members
- **Market Penetration**: Competitive pricing for new market segments
- **Revenue Optimization**: Strategic pricing to maximize profitability
- **Brand Building**: Premium offers to enhance brand perception

## 🎪 **Use Cases**
- **Clearance Sales**: Move excess inventory with attractive pricing
- **Customer Acquisition**: Special offers to attract new customers
- **Loyalty Programs**: Exclusive special offers for VIP customers
- **Seasonal Campaigns**: Holiday and event-based promotional offerings
- **Market Competition**: Competitive special offers to gain market share
- **Revenue Boost**: Strategic promotions to increase short-term revenue

## 🚀 **Integration Features**
- **Email Marketing**: Automated special offer email campaigns
- **Social Media**: Social media promotional content and campaigns
- **Customer Notifications**: Push notifications for time-sensitive offers
- **Analytics Platform**: Special offer performance tracking and insights
- **Inventory Systems**: Real-time inventory integration for offer management
		`,
	})
	@ApiOkResponse({
		description: '✅ Special offers retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				products: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 789, description: 'Product unique identifier' },
							name: { type: 'string', example: 'Premium Wireless Headphones', description: 'Product name' },
							description: { type: 'string', example: 'High-quality wireless headphones with active noise cancellation', description: 'Product description' },
							price: { type: 'number', example: 299.99, description: 'Current selling price' },
							originalPrice: { type: 'number', example: 399.99, description: 'Original price before special offer' },
							specialPrice: { type: 'number', example: 199.99, description: 'Special offer price' },
							discount: { type: 'number', example: 33.33, description: 'Discount percentage' },
							savingsAmount: { type: 'number', example: 100.00, description: 'Total savings amount' },
							imageUrl: { type: 'string', example: 'https://example.com/headphones.jpg', description: 'Product image URL' },
							specialDetails: { type: 'string', example: 'Limited time offer - 48 hours only!', description: 'Special offer details' },
							category: { type: 'string', example: 'Electronics', description: 'Product category' },
							brand: { type: 'string', example: 'AudioTech', description: 'Product brand' },
							rating: { type: 'number', example: 4.8, description: 'Customer rating' },
							reviewCount: { type: 'number', example: 245, description: 'Number of customer reviews' },
							stockQuantity: { type: 'number', example: 15, description: 'Available stock quantity' },
							isLimitedStock: { type: 'boolean', example: true, description: 'Whether stock is limited' },
							urgencyLevel: { type: 'string', example: 'HIGH', description: 'Urgency level indicator' },
							timeRemaining: { type: 'string', example: '47h 32m', description: 'Time remaining for special offer' },
							expiresAt: { type: 'string', format: 'date-time', example: '2024-01-17T23:59:59Z', description: 'Special offer expiration date' },
							specialType: { type: 'string', example: 'FLASH_SALE', description: 'Type of special offer' },
							badgeText: { type: 'string', example: 'FLASH SALE', description: 'Promotional badge text' },
							minQuantity: { type: 'number', example: 1, description: 'Minimum quantity for special price' },
							maxQuantity: { type: 'number', example: 3, description: 'Maximum quantity per customer' },
							customerEligible: { type: 'boolean', example: true, description: 'Whether current customer is eligible' },
							popularityRank: { type: 'number', example: 3, description: 'Popularity ranking among specials' },
							conversionRate: { type: 'number', example: 8.5, description: 'Special offer conversion rate (%)' },
							viewCount: { type: 'number', example: 1250, description: 'Number of views for this special' },
							purchaseCount: { type: 'number', example: 89, description: 'Number of purchases during special offer' }
						},
					},
					description: 'Array of special offer products with comprehensive promotional data'
				},
				message: { type: 'string', example: 'Special offers retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						totalSpecials: { type: 'number', example: 18, description: 'Total number of special offers' },
						activePromotions: { type: 'number', example: 12, description: 'Number of active promotions' },
						expiringSoon: { type: 'number', example: 5, description: 'Number of offers expiring within 24 hours' },
						averageDiscount: { type: 'number', example: 28.5, description: 'Average discount percentage' },
						totalSavings: { type: 'number', example: 5670.50, description: 'Total potential savings across all specials' },
						flashSaleActive: { type: 'boolean', example: true, description: 'Whether flash sale is currently active' },
						nextSpecialStart: { type: 'string', format: 'date-time', example: '2024-01-18T00:00:00Z', description: 'Next special offer start time' },
						lastUpdated: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Last special offers update' },
						organizationId: { type: 'number', example: 123, description: 'Organization ID' },
						branchId: { type: 'number', example: 456, description: 'Branch ID' }
					},
					description: 'Special offers metadata and statistics'
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid special offers request',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid special offers request parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						organizationId: { type: 'number', example: 123 },
						branchId: { type: 'number', example: 456 },
						reason: { type: 'string', example: 'Invalid organization or branch specified' }
					}
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve special offers',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve special offers due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
				path: { type: 'string', example: '/shop/specials' }
			}
		}
	})
	async specials(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		AccessLevel.MEMBER,
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
	async createQuotation(@Body() quotationData: CheckoutDto, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const clerkUserId = getClerkUserId(req);
		return this.shopService.createQuotation(quotationData, orgId, branchId, clerkUserId);
	}

	@Put('quotation/:id/client')
	@Roles(
		AccessLevel.CLIENT,
		AccessLevel.MEMBER,
	)
	@ApiOperation({
		summary: '✏️ Update quotation for client',
		description: 'Allows clients to edit their quotations before major stages (SOURCING/PACKING/IN_FULFILLMENT)',
	})
	@ApiParam({
		name: 'id',
		description: 'Quotation ID',
		type: Number,
	})
	@ApiOkResponse({
		description: '✅ Quotation updated successfully',
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Cannot edit quotation in current status',
	})
	async updateQuotationForClient(
		@Param('id') quotationId: number,
		@Body() quotationData: CheckoutDto,
		@Req() req: AuthenticatedRequest,
	) {
		// Client portal users have clientUid (Client.uid); staff use uid where applicable
		const clientId = req.user?.clientUid ?? req.user?.uid;
		if (clientId == null) {
			throw new UnauthorizedException('Client ID not found');
		}
		return this.shopService.updateQuotationForClient(quotationId, quotationData, clientId);
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
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '📄 Create custom blank quotation',
		description: `
# Custom Blank Quotation Generator

Creates sophisticated blank quotations with advanced pricing structures and customizable templates for professional sales presentations.

## 🎯 **Advanced Pricing Engine**
- **Multi-tier Pricing**: Support for premium, standard, local, and foreign price lists
- **Dynamic Pricing**: Real-time price calculations based on selected price list type
- **Volume Discounts**: Automatic application of quantity-based pricing tiers
- **Customer-specific Pricing**: Personalized pricing based on customer segments
- **Currency Flexibility**: Multi-currency support for international quotations

## 📊 **Professional Features**
- **Template Customization**: Branded quotation templates with company styling
- **Product Selection**: Curated product selection with detailed specifications
- **Pricing Transparency**: Clear breakdown of pricing components and calculations
- **Delivery Integration**: Flexible delivery options and cost calculations
- **Terms & Conditions**: Customizable terms and payment options

## 🔧 **Business Intelligence**
- **Price List Analytics**: Track performance across different pricing tiers
- **Conversion Tracking**: Monitor blank quotation to order conversion rates
- **Customer Insights**: Analyze customer response to different pricing structures
- **Sales Performance**: Measure effectiveness of pricing strategies
- **Market Analysis**: Compare pricing competitiveness across markets

## 🎪 **Use Cases**
- **B2B Sales**: Professional quotations for business customers
- **International Markets**: Multi-currency quotations for global sales
- **Volume Sales**: Bulk pricing for large orders
- **Customer Onboarding**: Initial pricing presentations for new customers
- **Competitive Bidding**: Structured quotations for tender processes
		`,
	})
	@ApiBody({ 
		type: CreateBlankQuotationDto,
		description: 'Blank quotation configuration with products and pricing details',
		examples: {
			premiumQuotation: {
				summary: 'Premium price list quotation',
				description: 'High-end quotation with premium pricing structure',
				value: {
					items: [
						{
							productId: 123,
							quantity: 5,
							customPrice: 999.99,
							notes: 'Premium quality with extended warranty'
						}
					],
					priceListType: 'premium',
					title: 'Premium Product Quotation',
					recipientEmail: 'customer@example.com',
					owner: { uid: 456 },
					client: { uid: 789 },
					notes: 'Custom quotation for premium customer segment',
					validityDays: 30
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Blank quotation created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Blank quotation created successfully' },
				quotationId: { type: 'string', example: 'BLQ-1704067200000', description: 'Unique blank quotation identifier' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1234, description: 'Quotation database ID' },
						title: { type: 'string', example: 'Premium Product Quotation', description: 'Quotation title' },
						priceListType: { type: 'string', example: 'premium', description: 'Applied price list type' },
						totalAmount: { type: 'number', example: 4999.95, description: 'Total quotation amount' },
						itemCount: { type: 'number', example: 5, description: 'Number of items' },
						recipientEmail: { type: 'string', example: 'customer@example.com', description: 'Recipient email address' },
						validUntil: { type: 'string', format: 'date-time', example: '2024-02-14T23:59:59Z', description: 'Quotation validity period' },
						createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Creation timestamp' },
						downloadUrl: { type: 'string', example: 'https://example.com/quotations/BLQ-1704067200000.pdf', description: 'PDF download link' }
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid blank quotation data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid blank quotation data provided' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Blank quotation items are required',
						'Price list type must be specified',
						'Recipient email format is invalid',
						'At least one product must be selected'
					]
				}
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to create blank quotation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to create blank quotation due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async createBlankQuotation(@Body() blankQuotationData: CreateBlankQuotationDto, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const clerkUserId = getClerkUserId(req);
		this.logger.log(`[ShopController] Blank quotation request from user ${clerkUserId} (org: ${orgId}, branch: ${branchId}): itemCount=${blankQuotationData?.items?.length}, priceListType=${blankQuotationData?.priceListType}, title=${blankQuotationData?.title}`);
		return this.shopService.createBlankQuotation(blankQuotationData, orgId, branchId, clerkUserId);
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
		AccessLevel.MEMBER,
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
		description: '✅ Quotations retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				quotations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1234, description: 'Quotation unique identifier' },
							quotationNumber: { type: 'string', example: 'QT-2024-001234', description: 'Human-readable quotation number' },
							status: { type: 'string', example: 'PENDING', description: 'Current quotation status' },
							total: { type: 'number', example: 1249.99, description: 'Total quotation amount' },
							subtotal: { type: 'number', example: 1149.99, description: 'Subtotal before tax' },
							taxAmount: { type: 'number', example: 100.00, description: 'Tax amount' },
							currency: { type: 'string', example: 'USD', description: 'Quotation currency' },
							itemCount: { type: 'number', example: 3, description: 'Number of items in quotation' },
							validUntil: { type: 'string', format: 'date-time', example: '2024-02-14T23:59:59Z', description: 'Quotation expiry date' },
							isExpired: { type: 'boolean', example: false, description: 'Whether quotation has expired' },
							priority: { type: 'string', example: 'HIGH', description: 'Quotation priority level' },
							items: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 456, description: 'Item unique identifier' },
										product: {
											type: 'object',
											properties: {
												uid: { type: 'number', example: 789, description: 'Product ID' },
												name: { type: 'string', example: 'Premium Wireless Headphones', description: 'Product name' },
												sku: { type: 'string', example: 'PWH-2024-001', description: 'Product SKU' },
												category: { type: 'string', example: 'Electronics', description: 'Product category' },
												imageUrl: { type: 'string', example: 'https://example.com/product.jpg', description: 'Product image URL' }
											}
										},
										quantity: { type: 'number', example: 2, description: 'Item quantity' },
										unitPrice: { type: 'number', example: 299.99, description: 'Price per unit' },
										totalPrice: { type: 'number', example: 599.98, description: 'Total price for this item' },
										discount: { type: 'number', example: 10.0, description: 'Discount percentage' },
										notes: { type: 'string', example: 'Customer requested expedited delivery', description: 'Item-specific notes' }
									},
								},
								description: 'Array of quotation items'
							},
							client: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 321, description: 'Client unique identifier' },
									name: { type: 'string', example: 'John Smith', description: 'Client name' },
									email: { type: 'string', example: 'john@example.com', description: 'Client email' },
									company: { type: 'string', example: 'ABC Corp', description: 'Client company' },
									phone: { type: 'string', example: '+1234567890', description: 'Client phone number' },
									isVIP: { type: 'boolean', example: true, description: 'Whether client is VIP' }
								},
								description: 'Client information'
							},
							owner: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 654, description: 'Owner user ID' },
									name: { type: 'string', example: 'Jane Doe', description: 'Owner name' },
									email: { type: 'string', example: 'jane@company.com', description: 'Owner email' },
									role: { type: 'string', example: 'Sales Manager', description: 'Owner role' }
								},
								description: 'Quotation owner information'
							},
							billingAddress: { type: 'string', example: '123 Main St, Anytown, CA 12345', description: 'Billing address' },
							shippingAddress: { type: 'string', example: '456 Business Ave, Corporate City, CA 12346', description: 'Shipping address' },
							paymentTerms: { type: 'string', example: 'Net 30', description: 'Payment terms' },
							deliveryDate: { type: 'string', format: 'date', example: '2024-02-01', description: 'Expected delivery date' },
							notes: { type: 'string', example: 'Rush order - customer needs by end of month', description: 'Quotation notes' },
							createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Creation timestamp' },
							updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:45:00Z', description: 'Last update timestamp' },
							lastActivityAt: { type: 'string', format: 'date-time', example: '2024-01-15T16:20:00Z', description: 'Last activity timestamp' },
							conversionProbability: { type: 'number', example: 78.5, description: 'Conversion probability percentage' },
							tags: {
								type: 'array',
								items: { type: 'string' },
								example: ['urgent', 'vip-customer', 'high-value'],
								description: 'Quotation tags'
							}
						},
					},
					description: 'Array of quotations with comprehensive details'
				},
				message: { type: 'string', example: 'Quotations retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						totalQuotations: { type: 'number', example: 47, description: 'Total number of quotations' },
						pendingQuotations: { type: 'number', example: 23, description: 'Number of pending quotations' },
						approvedQuotations: { type: 'number', example: 15, description: 'Number of approved quotations' },
						rejectedQuotations: { type: 'number', example: 9, description: 'Number of rejected quotations' },
						totalValue: { type: 'number', example: 58750.25, description: 'Total value of all quotations' },
						averageValue: { type: 'number', example: 1250.00, description: 'Average quotation value' },
						conversionRate: { type: 'number', example: 68.1, description: 'Overall conversion rate percentage' },
						expiringWithin7Days: { type: 'number', example: 5, description: 'Number of quotations expiring within 7 days' },
						lastQuotationDate: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Date of last quotation' },
						organizationId: { type: 'number', example: 123, description: 'Organization ID' },
						branchId: { type: 'number', example: 456, description: 'Branch ID' },
						userId: { type: 'number', example: 789, description: 'User ID (for filtered results)' },
						userRole: { type: 'string', example: 'MANAGER', description: 'User role (affects visibility)' }
					},
					description: 'Quotation metadata and statistics'
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid quotation request',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid quotation request parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						organizationId: { type: 'number', example: 123 },
						branchId: { type: 'number', example: 456 },
						userId: { type: 'number', example: 789 },
						reason: { type: 'string', example: 'Invalid organization or branch access' }
					}
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve quotations',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve quotations due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
				path: { type: 'string', example: '/shop/quotations' }
			}
		}
	})
	async getQuotations(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const userId = req.user?.uid;
		const userRole = req.user?.accessLevel;
		const clientUid = req.user?.clientUid != null ? Number(req.user.clientUid) : undefined;
		return this.shopService.getAllQuotations(orgId, userId, userRole, clientUid);
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
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '🔍 Get detailed quotation by reference',
		description: `
# Quotation Detail Retrieval System

Provides comprehensive access to detailed quotation information with complete item breakdown and customer data.

## 📊 **Comprehensive Data Access**
- **Complete Quotation Details**: Full quotation information with all associated data
- **Item Breakdown**: Detailed product information, quantities, and pricing
- **Customer Information**: Complete client details and contact information
- **Address Details**: Billing and shipping addresses with validation
- **Status Tracking**: Current quotation status and lifecycle information

## 🎯 **Advanced Features**
- **Role-based Access**: Quotation visibility based on user permissions
- **Version History**: Track quotation modifications and amendments
- **Audit Trail**: Complete logging of quotation access and modifications
- **Document Links**: Associated documents and attachments
- **Conversion Tracking**: Monitor quotation progress through sales pipeline

## 🔧 **Business Intelligence**
- **Performance Metrics**: Track quotation view patterns and engagement
- **Customer Insights**: Analyze customer interaction with quotations
- **Sales Analytics**: Monitor quotation success rates and conversion patterns
- **Territory Analysis**: Regional quotation performance tracking
- **Product Performance**: Track product popularity in quotations

## 🎪 **Use Cases**
- **Sales Management**: Detailed quotation review and analysis
- **Customer Service**: Complete quotation information for support queries
- **Order Processing**: Quotation details for order conversion
- **Financial Review**: Pricing and cost analysis
- **Compliance**: Audit trail and documentation requirements
		`,
	})
	@ApiParam({ name: 'ref', description: 'Quotation reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ Quotation retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				quotation: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1234, description: 'Quotation unique identifier' },
						quotationNumber: { type: 'string', example: 'QT-2024-001234', description: 'Human-readable quotation number' },
						status: { type: 'string', example: 'PENDING', description: 'Current quotation status' },
						total: { type: 'number', example: 1249.99, description: 'Total quotation amount' },
						subtotal: { type: 'number', example: 1149.99, description: 'Subtotal before tax' },
						taxAmount: { type: 'number', example: 100.00, description: 'Tax amount' },
						currency: { type: 'string', example: 'USD', description: 'Quotation currency' },
						validUntil: { type: 'string', format: 'date-time', example: '2024-02-14T23:59:59Z', description: 'Quotation expiry date' },
						isExpired: { type: 'boolean', example: false, description: 'Whether quotation has expired' },
						items: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 456, description: 'Item unique identifier' },
									product: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 789, description: 'Product ID' },
											name: { type: 'string', example: 'Premium Wireless Headphones', description: 'Product name' },
											sku: { type: 'string', example: 'PWH-2024-001', description: 'Product SKU' },
											description: { type: 'string', example: 'High-quality wireless headphones', description: 'Product description' },
											category: { type: 'string', example: 'Electronics', description: 'Product category' },
											brand: { type: 'string', example: 'AudioTech', description: 'Product brand' },
											imageUrl: { type: 'string', example: 'https://example.com/product.jpg', description: 'Product image URL' }
										}
									},
									quantity: { type: 'number', example: 2, description: 'Item quantity' },
									unitPrice: { type: 'number', example: 299.99, description: 'Price per unit' },
									totalPrice: { type: 'number', example: 599.98, description: 'Total price for this item' },
									discount: { type: 'number', example: 10.0, description: 'Discount percentage' },
									notes: { type: 'string', example: 'Customer requested expedited delivery', description: 'Item-specific notes' }
								},
							},
							description: 'Array of quotation items with detailed product information'
						},
						client: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 321, description: 'Client unique identifier' },
								name: { type: 'string', example: 'John Smith', description: 'Client name' },
								email: { type: 'string', example: 'john@example.com', description: 'Client email' },
								phone: { type: 'string', example: '+1234567890', description: 'Client phone number' },
								company: { type: 'string', example: 'ABC Corp', description: 'Client company' },
								isVIP: { type: 'boolean', example: true, description: 'Whether client is VIP' },
								customerType: { type: 'string', example: 'CORPORATE', description: 'Customer type classification' }
							},
							description: 'Complete client information'
						},
						billingAddress: { type: 'string', example: '123 Main St, Anytown, CA 12345', description: 'Billing address' },
						shippingAddress: { type: 'string', example: '456 Business Ave, Corporate City, CA 12346', description: 'Shipping address' },
						paymentTerms: { type: 'string', example: 'Net 30', description: 'Payment terms' },
						deliveryDate: { type: 'string', format: 'date', example: '2024-02-01', description: 'Expected delivery date' },
						notes: { type: 'string', example: 'Rush order - customer needs by end of month', description: 'Quotation notes' },
						createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Creation timestamp' },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:45:00Z', description: 'Last update timestamp' },
						lastActivityAt: { type: 'string', format: 'date-time', example: '2024-01-15T16:20:00Z', description: 'Last activity timestamp' },
						owner: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 654, description: 'Owner user ID' },
								name: { type: 'string', example: 'Jane Doe', description: 'Owner name' },
								email: { type: 'string', example: 'jane@company.com', description: 'Owner email' },
								role: { type: 'string', example: 'Sales Manager', description: 'Owner role' }
							},
							description: 'Quotation owner information'
						}
					},
					description: 'Complete quotation details with all associated data'
				},
				message: { type: 'string', example: 'Quotation retrieved successfully' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Quotation not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Quotation not found or access denied' },
				statusCode: { type: 'number', example: 404 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid quotation reference',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid quotation reference format' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve quotation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve quotation due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async getQuotationByRef(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '👤 Get user quotation history',
		description: `
# User Quotation Performance Tracking

Retrieves comprehensive quotation history for specific users with performance analytics and target tracking capabilities.

## 📊 **Performance Analytics**
- **Quotation Volume**: Track total quotations created by user
- **Conversion Rates**: Monitor quotation-to-order conversion success
- **Revenue Contribution**: Calculate user's contribution to quotation pipeline
- **Time Analysis**: Track quotation creation patterns and frequency
- **Success Metrics**: Analyze quotation approval rates and outcomes

## 🎯 **Target Tracking**
- **Quotation Targets**: Compare performance against quotation targets
- **Period Analysis**: Track performance across different time periods
- **Trend Identification**: Identify performance trends and patterns
- **Benchmark Comparison**: Compare user performance to team averages
- **Goal Achievement**: Monitor progress toward quotation objectives

## 🔧 **Advanced Features**
- **Role-based Access**: Filter results based on user permissions
- **Status Filtering**: View quotations by status (pending, approved, rejected)
- **Date Range Support**: Analyze quotations within specific time periods
- **Customer Breakdown**: Analyze quotation distribution by customer
- **Product Analysis**: Track most quoted products by user

## 🎪 **Use Cases**
- **Sales Management**: Monitor individual sales representative performance
- **Performance Reviews**: Comprehensive quotation activity analysis
- **Territory Management**: Track quotation activity by territory
- **Training Needs**: Identify areas for sales training and improvement
- **Compensation Planning**: Performance-based compensation calculations
		`,
	})
	@ApiParam({ name: 'ref', description: 'User reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ User quotations retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				quotations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1234, description: 'Quotation unique identifier' },
							quotationNumber: { type: 'string', example: 'QT-2024-001234', description: 'Human-readable quotation number' },
							status: { type: 'string', example: 'PENDING', description: 'Current quotation status' },
							total: { type: 'number', example: 1249.99, description: 'Total quotation amount' },
							subtotal: { type: 'number', example: 1149.99, description: 'Subtotal before tax' },
							taxAmount: { type: 'number', example: 100.00, description: 'Tax amount' },
							currency: { type: 'string', example: 'USD', description: 'Quotation currency' },
							itemCount: { type: 'number', example: 3, description: 'Number of items in quotation' },
							validUntil: { type: 'string', format: 'date-time', example: '2024-02-14T23:59:59Z', description: 'Quotation expiry date' },
							isExpired: { type: 'boolean', example: false, description: 'Whether quotation has expired' },
							client: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 321, description: 'Client unique identifier' },
									name: { type: 'string', example: 'John Smith', description: 'Client name' },
									email: { type: 'string', example: 'john@example.com', description: 'Client email' },
									company: { type: 'string', example: 'ABC Corp', description: 'Client company' },
									isVIP: { type: 'boolean', example: true, description: 'Whether client is VIP' }
								},
								description: 'Client information'
							},
							items: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 456, description: 'Item unique identifier' },
										product: {
											type: 'object',
											properties: {
												uid: { type: 'number', example: 789, description: 'Product ID' },
												name: { type: 'string', example: 'Premium Wireless Headphones', description: 'Product name' },
												sku: { type: 'string', example: 'PWH-2024-001', description: 'Product SKU' },
												category: { type: 'string', example: 'Electronics', description: 'Product category' },
												imageUrl: { type: 'string', example: 'https://example.com/product.jpg', description: 'Product image URL' }
											}
										},
										quantity: { type: 'number', example: 2, description: 'Item quantity' },
										unitPrice: { type: 'number', example: 299.99, description: 'Price per unit' },
										totalPrice: { type: 'number', example: 599.98, description: 'Total price for this item' }
									},
								},
								description: 'Array of quotation items'
							},
							createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Creation timestamp' },
							updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:45:00Z', description: 'Last update timestamp' },
							conversionProbability: { type: 'number', example: 78.5, description: 'Conversion probability percentage' },
							priority: { type: 'string', example: 'HIGH', description: 'Quotation priority level' }
						},
					},
					description: 'Array of user quotations with comprehensive details'
				},
				message: { type: 'string', example: 'User quotations retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						userId: { type: 'number', example: 123, description: 'User ID' },
						totalQuotations: { type: 'number', example: 47, description: 'Total number of quotations by user' },
						pendingQuotations: { type: 'number', example: 23, description: 'Number of pending quotations' },
						approvedQuotations: { type: 'number', example: 15, description: 'Number of approved quotations' },
						rejectedQuotations: { type: 'number', example: 9, description: 'Number of rejected quotations' },
						totalValue: { type: 'number', example: 58750.25, description: 'Total value of user quotations' },
						averageValue: { type: 'number', example: 1250.00, description: 'Average quotation value' },
						conversionRate: { type: 'number', example: 68.1, description: 'User conversion rate percentage' },
						lastQuotationDate: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Date of last quotation' },
						performanceRank: { type: 'number', example: 3, description: 'User performance ranking' },
						targetProgress: { type: 'number', example: 85.7, description: 'Progress toward quotation target (%)' }
					},
					description: 'User quotation performance metadata'
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ No quotations found for this user',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No quotations found for this user' },
				quotations: { type: 'array', items: {}, example: [] },
				meta: {
					type: 'object',
					properties: {
						userId: { type: 'number', example: 123 },
						totalQuotations: { type: 'number', example: 0 },
						reason: { type: 'string', example: 'User has not created any quotations yet' }
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid user reference',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid user reference format' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve user quotations',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve user quotations due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async getQuotationsByUser(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		return this.shopService.getQuotationsByUser(ref, orgId);
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
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '📝 Update quotation status',
		description: `
# Quotation Status Management System

Manages comprehensive quotation status transitions with workflow validation and automated business process triggers.

## 🔄 **Status Workflow Management**
- **Valid Transitions**: Enforces business rules for status changes
- **Automated Triggers**: Initiates follow-up actions based on status updates
- **Workflow Validation**: Ensures proper quotation lifecycle progression
- **Role-based Permissions**: Status change permissions based on user roles
- **Audit Trail**: Complete logging of all status changes with timestamps

## 📊 **Business Process Integration**
- **Sales Pipeline**: Automatic pipeline stage updates based on status
- **Customer Notifications**: Email alerts for status changes
- **Inventory Management**: Stock reservation based on quotation status
- **Financial Integration**: Accounting system updates for approved quotations
- **Reporting**: Real-time status reporting and analytics

## 🎯 **Status Categories**
- **PENDING**: Initial quotation state awaiting review
- **APPROVED**: Quotation approved and ready for order conversion
- **REJECTED**: Quotation declined or cancelled
- **EXPIRED**: Quotation exceeded validity period
- **CONVERTED**: Quotation successfully converted to order
- **DRAFT**: Quotation in preparation, not yet finalized

## 🔧 **Advanced Features**
- **Bulk Status Updates**: Update multiple quotations simultaneously
- **Conditional Logic**: Status-dependent business rule execution
- **Integration Hooks**: Custom triggers for external system integration
- **Version Control**: Track status change history and revisions
- **Approval Chains**: Multi-level approval workflows for high-value quotations

## 🎪 **Use Cases**
- **Sales Management**: Track quotation progression through sales pipeline
- **Customer Service**: Update quotation status based on customer feedback
- **Order Processing**: Convert approved quotations to orders
- **Inventory Control**: Manage stock based on quotation status
- **Performance Tracking**: Monitor quotation success rates and conversion metrics
		`,
	})
	@ApiParam({ name: 'ref', description: 'Quotation reference ID', type: 'number' })
	@ApiBody({
		description: 'Status update information with optional metadata',
		schema: {
			type: 'object',
			properties: {
				status: {
					type: 'string',
					enum: Object.values(OrderStatus),
					example: OrderStatus.APPROVED,
					description: 'New quotation status'
				},
				comments: {
					type: 'string',
					example: 'Approved by management - proceed with order processing',
					description: 'Optional comments for status change'
				},
				notifyCustomer: {
					type: 'boolean',
					example: true,
					description: 'Whether to notify customer of status change'
				},
				priority: {
					type: 'string',
					enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
					example: 'HIGH',
					description: 'Priority level for the quotation'
				}
			},
			required: ['status'],
		},
		examples: {
			approveQuotation: {
				summary: 'Approve quotation',
				description: 'Approve a quotation with customer notification',
				value: {
					status: 'APPROVED',
					comments: 'Approved by sales manager - excellent customer',
					notifyCustomer: true,
					priority: 'HIGH'
				}
			},
			rejectQuotation: {
				summary: 'Reject quotation',
				description: 'Reject a quotation with reason',
				value: {
					status: 'REJECTED',
					comments: 'Customer declined due to budget constraints',
					notifyCustomer: false,
					priority: 'LOW'
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Quotation status updated successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'Quotation status updated successfully' },
				data: {
					type: 'object',
					properties: {
						quotationId: { type: 'number', example: 1234, description: 'Quotation ID' },
						previousStatus: { type: 'string', example: 'PENDING', description: 'Previous status' },
						newStatus: { type: 'string', example: 'APPROVED', description: 'New status' },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Update timestamp' },
						updatedBy: { type: 'string', example: 'Jane Doe', description: 'User who made the update' },
						notificationSent: { type: 'boolean', example: true, description: 'Whether customer was notified' }
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid status transition',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Invalid status transition from EXPIRED to APPROVED' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						currentStatus: { type: 'string', example: 'EXPIRED' },
						requestedStatus: { type: 'string', example: 'APPROVED' },
						allowedTransitions: { type: 'array', items: { type: 'string' }, example: ['REJECTED', 'DRAFT'] },
						reason: { type: 'string', example: 'Cannot approve expired quotation' }
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Quotation not found',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Quotation not found or access denied' },
				statusCode: { type: 'number', example: 404 }
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to update quotation status',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Failed to update quotation status due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async updateQuotationStatus(
		@Param('ref') ref: number,
		@Body('status') status: OrderStatus,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '🎨 Get shop promotional banners',
		description: `
# Shop Banner Management System

Retrieves comprehensive banner information for shop promotional displays with advanced targeting and analytics capabilities.

## 📊 **Banner Intelligence**
- **Dynamic Content**: Real-time banner content based on user preferences
- **Targeting Rules**: Display banners based on customer segments and behavior
- **Performance Tracking**: Monitor banner click-through rates and engagement
- **A/B Testing**: Support for multiple banner variations and testing
- **Seasonal Campaigns**: Time-based banner activation and scheduling

## 🎯 **Advanced Features**
- **Responsive Design**: Mobile-optimized banner displays
- **Interactive Elements**: Support for clickable areas and call-to-action buttons
- **Multi-language Support**: Localized banner content for different regions
- **Brand Consistency**: Enforced brand guidelines and styling standards
- **Analytics Integration**: Comprehensive tracking and reporting capabilities

## 🔧 **Business Intelligence**
- **Conversion Tracking**: Monitor banner effectiveness and ROI
- **Customer Engagement**: Track user interaction with promotional content
- **Revenue Attribution**: Measure revenue generated from banner campaigns
- **Performance Optimization**: Data-driven insights for banner optimization
- **Campaign Analytics**: Detailed metrics for promotional campaign success

## 🎪 **Use Cases**
- **Product Promotions**: Featured product and sales announcements
- **Brand Awareness**: Corporate messaging and brand building campaigns
- **Event Marketing**: Special events and seasonal promotions
- **Customer Acquisition**: New customer onboarding and welcome messages
- **Cross-selling**: Promotional content for related products and services
		`,
	})
	@ApiOkResponse({
		description: '✅ Banners retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				banners: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 123, description: 'Banner unique identifier' },
							title: { type: 'string', example: 'Summer Sale 2024', description: 'Banner title' },
							subtitle: { type: 'string', example: 'Up to 50% off selected items', description: 'Banner subtitle' },
							imageUrl: { type: 'string', example: 'https://example.com/banners/summer-sale.jpg', description: 'Banner image URL' },
							link: { type: 'string', example: '/shop/specials', description: 'Banner click destination URL' },
							active: { type: 'boolean', example: true, description: 'Whether banner is currently active' },
							priority: { type: 'number', example: 1, description: 'Display priority order' },
							startDate: { type: 'string', format: 'date-time', example: '2024-06-01T00:00:00Z', description: 'Banner activation date' },
							endDate: { type: 'string', format: 'date-time', example: '2024-08-31T23:59:59Z', description: 'Banner expiration date' },
							clickCount: { type: 'number', example: 1547, description: 'Total banner clicks' },
							impressions: { type: 'number', example: 25890, description: 'Total banner views' },
							clickThroughRate: { type: 'number', example: 5.97, description: 'Click-through rate percentage' },
							targetAudience: { type: 'string', example: 'ALL_CUSTOMERS', description: 'Target audience for banner' },
							deviceTypes: { type: 'array', items: { type: 'string' }, example: ['DESKTOP', 'MOBILE', 'TABLET'], description: 'Supported device types' },
							locations: { type: 'array', items: { type: 'string' }, example: ['HOMEPAGE', 'PRODUCT_LISTING', 'CHECKOUT'], description: 'Banner display locations' },
							createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Banner creation timestamp' },
							updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:45:00Z', description: 'Last update timestamp' },
							createdBy: { type: 'string', example: 'Marketing Team', description: 'Banner creator' },
							tags: { type: 'array', items: { type: 'string' }, example: ['sale', 'summer', 'promotion'], description: 'Banner tags' }
						},
					},
					description: 'Array of promotional banners with comprehensive metadata'
				},
				message: { type: 'string', example: 'Banners retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						totalBanners: { type: 'number', example: 12, description: 'Total number of banners' },
						activeBanners: { type: 'number', example: 8, description: 'Number of active banners' },
						inactiveBanners: { type: 'number', example: 4, description: 'Number of inactive banners' },
						averageCTR: { type: 'number', example: 4.2, description: 'Average click-through rate' },
						totalClicks: { type: 'number', example: 15470, description: 'Total clicks across all banners' },
						totalImpressions: { type: 'number', example: 368520, description: 'Total impressions across all banners' },
						lastUpdated: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Last banner update' }
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid banner request',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid banner request parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve banners',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve banners due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async getBanner(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		this.logger.log(`🎨 [ShopController] getBanner endpoint called - orgId: ${orgId}, branchId: ${branchId}`);
		const result = this.shopService.getBanner(orgId, branchId);
		this.logger.log(`🎨 [ShopController] getBanner response prepared - banners count: ${(result as any)?.banners?.length || 0}`);
		return result;
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
		summary: '🎨 Create promotional banner',
		description: `
# Banner Creation System

Creates sophisticated promotional banners with advanced targeting, scheduling, and analytics capabilities.

## 📊 **Banner Configuration**
- **Visual Design**: Support for high-resolution images and responsive design
- **Content Management**: Rich text editing for titles, subtitles, and descriptions
- **Call-to-Action**: Configurable buttons and click destinations
- **Branding**: Brand-consistent styling and color schemes
- **Multi-format**: Support for various banner sizes and formats

## 🎯 **Advanced Features**
- **Audience Targeting**: Customer segment-based banner display
- **Scheduling**: Time-based banner activation and expiration
- **A/B Testing**: Multiple banner variations for testing
- **Analytics Integration**: Built-in tracking and performance monitoring
- **Device Optimization**: Responsive design for all device types

## 🔧 **Business Intelligence**
- **Performance Tracking**: Real-time click-through rates and engagement
- **Conversion Monitoring**: Track banner effectiveness and ROI
- **Campaign Analytics**: Comprehensive metrics for promotional campaigns
- **Revenue Attribution**: Measure revenue generated from banner campaigns
- **Optimization Insights**: Data-driven recommendations for banner improvement

## 🎪 **Use Cases**
- **Product Launches**: Promotional banners for new product introductions
- **Seasonal Campaigns**: Holiday and seasonal promotional content
- **Sales Events**: Flash sales and special offer announcements
- **Brand Awareness**: Corporate messaging and brand building
- **Customer Acquisition**: Welcome banners for new customer onboarding
		`,
	})
	@ApiBody({ 
		type: CreateBannerDto,
		description: 'Banner creation data with comprehensive configuration options',
		examples: {
			seasonalBanner: {
				summary: 'Seasonal promotional banner',
				description: 'Create a banner for seasonal sale campaign',
				value: {
					title: 'Summer Sale 2024',
					subtitle: 'Up to 50% off selected items',
					imageUrl: 'https://example.com/banners/summer-sale.jpg',
					link: '/shop/specials',
					active: true,
					priority: 1,
					startDate: '2024-06-01T00:00:00Z',
					endDate: '2024-08-31T23:59:59Z',
					targetAudience: 'ALL_CUSTOMERS',
					deviceTypes: ['DESKTOP', 'MOBILE', 'TABLET'],
					locations: ['HOMEPAGE', 'PRODUCT_LISTING']
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Banner created successfully',
		schema: {
			type: 'object',
			properties: {
				banner: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 123, description: 'Banner unique identifier' },
						title: { type: 'string', example: 'Summer Sale 2024', description: 'Banner title' },
						subtitle: { type: 'string', example: 'Up to 50% off selected items', description: 'Banner subtitle' },
						imageUrl: { type: 'string', example: 'https://example.com/banners/summer-sale.jpg', description: 'Banner image URL' },
						link: { type: 'string', example: '/shop/specials', description: 'Banner click destination URL' },
						active: { type: 'boolean', example: true, description: 'Whether banner is currently active' },
						priority: { type: 'number', example: 1, description: 'Display priority order' },
						startDate: { type: 'string', format: 'date-time', example: '2024-06-01T00:00:00Z', description: 'Banner activation date' },
						endDate: { type: 'string', format: 'date-time', example: '2024-08-31T23:59:59Z', description: 'Banner expiration date' },
						targetAudience: { type: 'string', example: 'ALL_CUSTOMERS', description: 'Target audience for banner' },
						deviceTypes: { type: 'array', items: { type: 'string' }, example: ['DESKTOP', 'MOBILE', 'TABLET'], description: 'Supported device types' },
						locations: { type: 'array', items: { type: 'string' }, example: ['HOMEPAGE', 'PRODUCT_LISTING'], description: 'Banner display locations' },
						createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Banner creation timestamp' },
						createdBy: { type: 'string', example: 'Marketing Team', description: 'Banner creator' }
					},
					description: 'Created banner with comprehensive metadata'
				},
				message: { type: 'string', example: 'Banner created successfully' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid banner data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid banner data provided' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Title is required',
						'Image URL must be a valid URL',
						'Start date must be before end date',
						'Target audience must be specified'
					]
				}
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to create banner',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to create banner due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async createBanner(@Body() bannerData: CreateBannerDto, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		summary: '✏️ Update promotional banner',
		description: `
# Banner Update Management System

Provides comprehensive banner modification capabilities with advanced versioning, scheduling, and performance tracking.

## 📊 **Update Intelligence**
- **Version Control**: Maintain history of banner modifications with rollback capabilities
- **Partial Updates**: Support for updating specific banner properties without affecting others
- **Validation Rules**: Comprehensive validation of banner updates before applying changes
- **Preview Mode**: Preview banner changes before making them live
- **Batch Updates**: Update multiple banner properties in a single operation

## 🎯 **Advanced Features**
- **Scheduled Updates**: Plan banner updates for future activation
- **A/B Testing**: Update banner variations for performance testing
- **Performance Preservation**: Maintain analytics data during banner updates
- **Content Validation**: Ensure updated content meets quality and brand standards
- **Rollback Protection**: Safeguard against accidental banner modifications

## 🔧 **Business Intelligence**
- **Update Tracking**: Monitor banner update history and performance impact
- **Performance Comparison**: Compare banner performance before and after updates
- **Optimization Insights**: Data-driven recommendations for banner improvements
- **Content Analytics**: Track content effectiveness across different banner versions
- **Engagement Metrics**: Measure user engagement with updated banner content

## 🎪 **Use Cases**
- **Campaign Updates**: Modify banners for ongoing marketing campaigns
- **Seasonal Adjustments**: Update banners for seasonal promotions and events
- **Performance Optimization**: Improve banner performance based on analytics
- **Content Refresh**: Keep banner content current and engaging
- **Brand Alignment**: Ensure banners align with evolving brand guidelines
		`,
	})
	@ApiParam({ name: 'ref', description: 'Banner reference code or ID', type: 'number' })
	@ApiBody({ 
		type: UpdateBannerDto,
		description: 'Banner update data with comprehensive modification options',
		examples: {
			updateBannerContent: {
				summary: 'Update banner content',
				description: 'Update banner title, subtitle, and image',
				value: {
					title: 'Flash Sale 2024',
					subtitle: 'Limited time - 60% off everything',
					imageUrl: 'https://example.com/banners/flash-sale-2024.jpg',
					active: true
				}
			},
			updateBannerSchedule: {
				summary: 'Update banner schedule',
				description: 'Update banner activation and expiration dates',
				value: {
					startDate: '2024-02-01T00:00:00Z',
					endDate: '2024-02-29T23:59:59Z',
					active: true
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Banner updated successfully',
		schema: {
			type: 'object',
			properties: {
				banner: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 123, description: 'Banner unique identifier' },
						title: { type: 'string', example: 'Flash Sale 2024', description: 'Updated banner title' },
						subtitle: { type: 'string', example: 'Limited time - 60% off everything', description: 'Updated banner subtitle' },
						imageUrl: { type: 'string', example: 'https://example.com/banners/flash-sale-2024.jpg', description: 'Updated banner image URL' },
						link: { type: 'string', example: '/shop/specials', description: 'Updated banner destination URL' },
						active: { type: 'boolean', example: true, description: 'Updated banner active status' },
						priority: { type: 'number', example: 1, description: 'Updated display priority' },
						startDate: { type: 'string', format: 'date-time', example: '2024-02-01T00:00:00Z', description: 'Updated activation date' },
						endDate: { type: 'string', format: 'date-time', example: '2024-02-29T23:59:59Z', description: 'Updated expiration date' },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Update timestamp' },
						version: { type: 'number', example: 2, description: 'Banner version number' },
						previousVersion: {
							type: 'object',
							properties: {
								title: { type: 'string', example: 'Summer Sale 2024', description: 'Previous banner title' },
								updatedAt: { type: 'string', format: 'date-time', example: '2024-01-10T10:30:00Z', description: 'Previous update timestamp' }
							},
							description: 'Previous banner version for comparison'
						}
					},
					description: 'Updated banner with comprehensive metadata'
				},
				message: { type: 'string', example: 'Banner updated successfully' },
				updateSummary: {
					type: 'object',
					properties: {
						fieldsUpdated: { type: 'array', items: { type: 'string' }, example: ['title', 'subtitle', 'imageUrl'], description: 'Fields that were modified' },
						changeCount: { type: 'number', example: 3, description: 'Number of changes made' },
						impactLevel: { type: 'string', example: 'MODERATE', description: 'Impact level of changes' },
						previewUrl: { type: 'string', example: 'https://example.com/preview/banner/123', description: 'Preview URL for updated banner' }
					},
					description: 'Summary of banner updates'
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Banner not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Banner not found or access denied' },
				banner: { type: 'null' },
				statusCode: { type: 'number', example: 404 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid banner update data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid banner update data provided' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Image URL must be a valid URL',
						'Start date must be before end date',
						'Title cannot be empty'
					]
				},
				statusCode: { type: 'number', example: 400 }
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to update banner',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to update banner due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async updateBanner(@Param('ref') ref: number, @Body() bannerData: UpdateBannerDto, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		summary: '🗑️ Delete promotional banner',
		description: `
# Banner Deletion Management System

Provides secure banner deletion with comprehensive safety checks, backup capabilities, and impact analysis.

## 📊 **Deletion Intelligence**
- **Safety Checks**: Comprehensive validation before banner deletion
- **Active Campaign Protection**: Prevent deletion of banners in active campaigns
- **Analytics Preservation**: Maintain historical analytics data even after deletion
- **Dependency Validation**: Check for dependencies before allowing deletion
- **Soft Delete Option**: Mark banners as deleted without permanent removal

## 🎯 **Advanced Features**
- **Backup Creation**: Automatic backup of banner data before deletion
- **Recovery Options**: Ability to restore recently deleted banners
- **Impact Analysis**: Assess the impact of banner deletion on campaigns
- **Confirmation Workflow**: Multi-step confirmation for critical banner deletions
- **Batch Deletion**: Delete multiple banners with proper validation

## 🔧 **Business Intelligence**
- **Deletion Tracking**: Monitor banner deletion patterns and reasons
- **Performance Impact**: Analyze performance impact of deleted banners
- **Recovery Analytics**: Track banner recovery and restoration patterns
- **Cleanup Metrics**: Monitor system cleanup efficiency
- **Audit Compliance**: Maintain compliance with data retention policies

## 🎪 **Use Cases**
- **Campaign Cleanup**: Remove expired or obsolete promotional banners
- **Content Management**: Maintain clean and organized banner library
- **Performance Optimization**: Remove low-performing banners to improve focus
- **Compliance**: Meet data retention and privacy requirements
- **System Maintenance**: Regular cleanup of unused banner assets

## ⚠️ **Important Notes**
- Deletion is permanent and cannot be undone without backup restoration
- Active banners should be deactivated before deletion
- Consider archiving instead of deletion for historical reference
- Coordinate with marketing teams before deleting campaign banners
		`,
	})
	@ApiParam({ name: 'ref', description: 'Banner reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: '✅ Banner deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Banner deleted successfully' },
				deletedBanner: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 123, description: 'Deleted banner ID' },
						title: { type: 'string', example: 'Summer Sale 2024', description: 'Deleted banner title' },
						wasActive: { type: 'boolean', example: false, description: 'Whether banner was active when deleted' },
						deletedAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Deletion timestamp' },
						deletedBy: { type: 'string', example: 'Jane Doe', description: 'User who deleted the banner' }
					},
					description: 'Information about the deleted banner'
				},
				backupInfo: {
					type: 'object',
					properties: {
						backupId: { type: 'string', example: 'BACKUP-BANNER-2024-01-15-103000', description: 'Backup identifier' },
						backupCreated: { type: 'boolean', example: true, description: 'Whether backup was created' },
						recoveryDeadline: { type: 'string', format: 'date-time', example: '2024-01-30T10:30:00Z', description: 'Recovery deadline' },
						recoveryInstructions: { type: 'string', example: 'Contact support with backup ID to restore', description: 'Recovery instructions' }
					},
					description: 'Backup and recovery information'
				},
				impact: {
					type: 'object',
					properties: {
						campaignsAffected: { type: 'number', example: 0, description: 'Number of campaigns affected' },
						analyticsPreserved: { type: 'boolean', example: true, description: 'Whether analytics data is preserved' },
						dependenciesCleared: { type: 'number', example: 2, description: 'Number of dependencies cleared' },
						cleanupCompleted: { type: 'boolean', example: true, description: 'Whether cleanup was completed' }
					},
					description: 'Impact analysis of banner deletion'
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Banner not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Banner not found or already deleted' },
				statusCode: { type: 'number', example: 404 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: ['Check banner ID', 'Verify banner exists', 'Check deletion permissions'],
					description: 'Suggestions for resolving the issue'
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Cannot delete banner',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot delete banner - active campaign dependencies' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						reason: { type: 'string', example: 'Banner is part of active campaign', description: 'Reason for deletion failure' },
						dependencies: {
							type: 'array',
							items: { type: 'string' },
							example: ['Active Campaign: Holiday Sale 2024'],
							description: 'Active dependencies preventing deletion'
						},
						suggestions: {
							type: 'array',
							items: { type: 'string' },
							example: ['Deactivate banner first', 'End associated campaigns', 'Archive instead of delete'],
							description: 'Suggested actions to resolve the issue'
						}
					}
				}
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to delete banner',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to delete banner due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
				recovery: {
					type: 'object',
					properties: {
						bannerIntact: { type: 'boolean', example: true, description: 'Whether banner remains intact' },
						backupAvailable: { type: 'boolean', example: true, description: 'Whether backup is available' },
						retryInstructions: { type: 'string', example: 'Wait 5 minutes and retry deletion', description: 'Instructions for retry' }
					}
				}
			}
		}
	})
	async deleteBanner(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		summary: '🔧 Generate missing product SKUs',
		description: `
# Missing SKU Generation System

Intelligently generates SKUs for products that lack unique identifiers, ensuring complete inventory tracking and management.

## 📊 **SKU Generation Intelligence**
- **Smart Detection**: Automatically identifies products without SKUs
- **Pattern Recognition**: Maintains consistent SKU formatting across product catalog
- **Conflict Prevention**: Ensures generated SKUs don't conflict with existing ones
- **Batch Processing**: Efficiently handles large product catalogs
- **Error Recovery**: Robust error handling for failed SKU generation

## 🎯 **Advanced Features**
- **Category-based Patterns**: SKU generation based on product categories
- **Brand Integration**: Incorporate brand codes into SKU structure
- **Sequential Numbering**: Intelligent sequential number assignment
- **Duplicate Prevention**: Advanced algorithms to prevent SKU duplicates
- **Validation Rules**: Comprehensive validation of generated SKUs

## 🔧 **Business Intelligence**
- **Generation Reports**: Detailed reports on SKU generation process
- **Quality Metrics**: Track SKU generation success rates
- **Inventory Integrity**: Maintain complete inventory tracking
- **Audit Trail**: Complete logging of SKU generation activities
- **Performance Monitoring**: Track generation speed and efficiency

## 🎪 **Use Cases**
- **Data Migration**: Generate SKUs for imported products
- **Inventory Cleanup**: Ensure all products have unique identifiers
- **System Maintenance**: Regular SKU integrity checks
- **Compliance**: Meet inventory tracking requirements
- **Reporting**: Enable comprehensive inventory reporting
		`,
	})
	@ApiCreatedResponse({
		description: '✅ Missing SKUs generated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Missing SKUs generated successfully' },
				data: {
					type: 'object',
					properties: {
						totalProducts: { type: 'number', example: 1250, description: 'Total products in catalog' },
						productsWithoutSKUs: { type: 'number', example: 89, description: 'Products missing SKUs' },
						skusGenerated: { type: 'number', example: 89, description: 'Number of SKUs generated' },
						skusSkipped: { type: 'number', example: 0, description: 'SKUs skipped due to errors' },
						generationTime: { type: 'number', example: 2.5, description: 'Generation time in seconds' },
						patterns: {
							type: 'array',
							items: { type: 'string' },
							example: ['ELEC-001', 'FASH-002', 'HOME-003'],
							description: 'Sample of generated SKU patterns'
						}
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid SKU generation request',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid SKU generation request' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						reason: { type: 'string', example: 'No products found without SKUs' },
						organizationId: { type: 'number', example: 123 },
						branchId: { type: 'number', example: 456 }
					}
				}
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to generate SKUs',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to generate SKUs due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
	})
	async generateMissingSKUs(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
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
		summary: '🔄 Regenerate all product SKUs',
		description: `
# Complete SKU Regeneration System

Performs comprehensive regeneration of all product SKUs with advanced backup and recovery capabilities.

## ⚠️ **Critical Operation Warning**
This operation regenerates ALL product SKUs in the system. This is a destructive operation that should be used with extreme caution.

## 📊 **Regeneration Process**
- **Backup Creation**: Automatic backup of existing SKUs before regeneration
- **Pattern Consistency**: Ensures all SKUs follow the same pattern structure
- **Conflict Resolution**: Intelligent handling of potential SKU conflicts
- **Batch Processing**: Efficient processing of large product catalogs
- **Progress Tracking**: Real-time progress monitoring and reporting

## 🎯 **Advanced Features**
- **Rollback Capability**: Ability to rollback to previous SKU structure
- **Custom Patterns**: Support for custom SKU generation patterns
- **Category Mapping**: Maintain category-based SKU prefixes
- **Brand Integration**: Incorporate brand codes into regenerated SKUs
- **Validation Rules**: Comprehensive validation of regenerated SKUs

## 🔧 **Business Intelligence**
- **Impact Analysis**: Detailed analysis of regeneration impact
- **Performance Metrics**: Track regeneration success rates and timing
- **Audit Trail**: Complete logging of all SKU changes
- **Quality Assurance**: Validation of regenerated SKU uniqueness
- **Recovery Monitoring**: Track system recovery after regeneration

## 🎪 **Use Cases**
- **System Migration**: Complete SKU structure overhaul
- **Data Standardization**: Standardize SKU patterns across products
- **Compliance Updates**: Update SKUs for regulatory compliance
- **Integration Requirements**: Prepare SKUs for external system integration
- **Performance Optimization**: Optimize SKU structure for better performance

## 🚨 **Important Notes**
- This operation affects ALL products in the system
- Existing SKU references may be broken after regeneration
- Backup existing data before proceeding
- Coordinate with all system users before execution
- Consider system downtime during regeneration
		`,
	})
	@ApiCreatedResponse({
		description: '✅ All SKUs regenerated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'All SKUs regenerated successfully' },
				data: {
					type: 'object',
					properties: {
						totalProducts: { type: 'number', example: 1250, description: 'Total products processed' },
						skusRegenerated: { type: 'number', example: 1250, description: 'Number of SKUs regenerated' },
						skusSkipped: { type: 'number', example: 0, description: 'SKUs skipped due to errors' },
						backupCreated: { type: 'boolean', example: true, description: 'Whether backup was created' },
						backupId: { type: 'string', example: 'BACKUP-2024-01-15-103000', description: 'Backup identifier' },
						regenerationTime: { type: 'number', example: 45.2, description: 'Regeneration time in seconds' },
						newPatterns: {
							type: 'array',
							items: { type: 'string' },
							example: ['ELEC-001', 'FASH-002', 'HOME-003'],
							description: 'Sample of new SKU patterns'
						},
						warnings: {
							type: 'array',
							items: { type: 'string' },
							example: ['5 products had duplicate names that required manual resolution'],
							description: 'Any warnings during regeneration'
						}
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid SKU regeneration request',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid SKU regeneration request' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						reason: { type: 'string', example: 'No products found to regenerate' },
						organizationId: { type: 'number', example: 123 },
						branchId: { type: 'number', example: 456 },
						suggestion: { type: 'string', example: 'Ensure products exist before regenerating SKUs' }
					}
				}
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to regenerate SKUs',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to regenerate SKUs due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
				recovery: {
					type: 'object',
					properties: {
						backupAvailable: { type: 'boolean', example: true, description: 'Whether backup is available for recovery' },
						backupId: { type: 'string', example: 'BACKUP-2024-01-15-103000', description: 'Backup identifier for recovery' },
						recoveryInstructions: { type: 'string', example: 'Contact support to restore from backup', description: 'Recovery instructions' }
					}
				}
			}
		}
	})
	async regenerateAllSKUs(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.shopService.regenerateAllSKUs(orgId, branchId);
	}

	@Get('quotation/validate-review-token')
	@isPublic() // This makes the endpoint public (no authentication required)
	@ApiOperation({
		summary: '🔐 Validate quotation review token',
		description: `
# Quotation Review Token Validation System

Validates secure quotation review tokens and optionally performs immediate actions for streamlined customer review processes.

## 🔒 **Security Features**
- **Token-based Authentication**: Secure, time-limited access tokens for quotation review
- **Expiration Management**: Automatic token expiration to prevent unauthorized access
- **Single-use Tokens**: Prevents token reuse for enhanced security
- **Cryptographic Validation**: Advanced token verification algorithms
- **Audit Trail**: Complete logging of all token validation attempts

## 🎯 **Review Process**
- **Direct Access**: Customers can access quotations without account login
- **Action Integration**: Immediate approve/decline actions through secure links
- **Status Tracking**: Real-time quotation status updates
- **Notification System**: Automated notifications for review actions
- **Mobile Optimization**: Mobile-friendly review interface

## 📊 **Business Intelligence**
- **Engagement Tracking**: Monitor customer interaction with quotation reviews
- **Response Analytics**: Track approval/decline rates and response times
- **Conversion Metrics**: Measure review-to-order conversion rates
- **Customer Insights**: Analyze customer review behavior patterns
- **Performance Optimization**: Data-driven improvements to review process

## 🔧 **Advanced Features**
- **Conditional Logic**: Smart routing based on quotation status and customer type
- **Custom Branding**: Branded review interface for professional presentation
- **Multi-language Support**: Localized review interface for international customers
- **Integration Hooks**: Custom triggers for external system integration
- **Backup Authentication**: Alternative authentication methods for token issues

## 🎪 **Use Cases**
- **Customer Review**: Secure quotation review without account requirements
- **Email Integration**: Direct review links in quotation emails
- **Mobile Access**: Mobile-optimized quotation review experience
- **Workflow Automation**: Automated quotation processing based on customer actions
- **Compliance**: Secure review process for regulatory compliance
		`,
	})
	@ApiQuery({ name: 'token', required: true, type: 'string', description: 'Secure quotation review token' })
	@ApiQuery({
		name: 'action',
		required: false,
		enum: ['approve', 'decline'],
		description: 'Optional immediate action to perform (approve/decline)',
	})
	@ApiOkResponse({
		description: '✅ Token validation successful',
		schema: {
			type: 'object',
			properties: {
				valid: { type: 'boolean', example: true, description: 'Whether token is valid' },
				quotation: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1234, description: 'Quotation unique identifier' },
						quotationNumber: { type: 'string', example: 'QT-2024-001234', description: 'Human-readable quotation number' },
						status: { type: 'string', example: 'PENDING_CLIENT_REVIEW', description: 'Current quotation status' },
						total: { type: 'number', example: 1249.99, description: 'Total quotation amount' },
						currency: { type: 'string', example: 'USD', description: 'Quotation currency' },
						validUntil: { type: 'string', format: 'date-time', example: '2024-02-14T23:59:59Z', description: 'Quotation validity period' },
						isExpired: { type: 'boolean', example: false, description: 'Whether quotation has expired' },
						client: {
							type: 'object',
							properties: {
								name: { type: 'string', example: 'John Smith', description: 'Client name' },
								email: { type: 'string', example: 'john@example.com', description: 'Client email' },
								company: { type: 'string', example: 'ABC Corp', description: 'Client company' }
							}
						},
						items: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									product: {
										type: 'object',
										properties: {
											name: { type: 'string', example: 'Premium Wireless Headphones' },
											imageUrl: { type: 'string', example: 'https://example.com/product.jpg' }
										}
									},
									quantity: { type: 'number', example: 2 },
									unitPrice: { type: 'number', example: 299.99 },
									totalPrice: { type: 'number', example: 599.98 }
								}
							}
						},
						createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Creation timestamp' }
					},
					description: 'Complete quotation details for customer review'
				},
				message: { type: 'string', example: 'Token is valid - quotation ready for review' },
				actionPerformed: { type: 'boolean', example: false, description: 'Whether an action was performed' },
				actionResult: {
					type: 'object',
					properties: {
						success: { type: 'boolean', example: true, description: 'Whether action was successful' },
						message: { type: 'string', example: 'Quotation approved successfully', description: 'Action result message' },
						newStatus: { type: 'string', example: 'APPROVED', description: 'New quotation status after action' },
						timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Action timestamp' }
					},
					description: 'Results of performed action (if any)'
				},
				reviewOptions: {
					type: 'object',
					properties: {
						canApprove: { type: 'boolean', example: true, description: 'Whether quotation can be approved' },
						canDecline: { type: 'boolean', example: true, description: 'Whether quotation can be declined' },
						requiresComments: { type: 'boolean', example: false, description: 'Whether comments are required' },
						expirationWarning: { type: 'boolean', example: false, description: 'Whether quotation is near expiration' }
					},
					description: 'Available review options for the quotation'
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid or expired token',
		schema: {
			type: 'object',
			properties: {
				valid: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Token is invalid, expired, or already used' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						reason: { type: 'string', example: 'Token expired on 2024-01-10T10:30:00Z' },
						tokenStatus: { type: 'string', example: 'EXPIRED' },
						alternativeActions: {
							type: 'array',
							items: { type: 'string' },
							example: ['Contact sales representative', 'Request new quotation'],
							description: 'Alternative actions for invalid token'
						}
					}
				}
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Token validation failed',
		schema: {
			type: 'object',
			properties: {
				valid: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Token validation failed due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
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
		summary: '🔄 Update quotation status via secure token',
		description: `
# Token-based Quotation Status Update System

Enables secure quotation status updates through validated tokens, providing streamlined customer review processes without authentication requirements.

## 🔒 **Security & Authentication**
- **Token-based Security**: Secure, time-limited tokens for quotation status updates
- **Single-use Validation**: Prevents token reuse for enhanced security
- **Cryptographic Integrity**: Advanced token verification with tamper detection
- **Audit Trail**: Complete logging of all token-based status updates
- **IP Tracking**: Monitor and log IP addresses for security analysis

## 🎯 **Status Management**
- **Controlled Transitions**: Enforce valid status transitions for business rules
- **Customer Actions**: Direct approve/decline actions from customer review
- **Automated Workflows**: Trigger downstream processes based on status changes
- **Notification System**: Automated notifications for stakeholders
- **Integration Hooks**: Custom triggers for external system updates

## 📊 **Business Intelligence**
- **Response Tracking**: Monitor customer response patterns and timing
- **Conversion Analytics**: Track token-to-decision conversion rates
- **Customer Behavior**: Analyze customer interaction with quotation reviews
- **Performance Metrics**: Measure review process effectiveness
- **Trend Analysis**: Identify patterns in customer quotation responses

## 🔧 **Advanced Features**
- **Comment Integration**: Support for customer comments and feedback
- **Status Validation**: Comprehensive validation of status transition rules
- **Error Recovery**: Graceful handling of token and status validation errors
- **Multi-language Support**: Localized status messages and responses
- **Mobile Optimization**: Mobile-friendly status update interface

## 🎪 **Use Cases**
- **Email Reviews**: Direct status updates from email review links
- **Customer Portals**: Secure quotation review in customer portals
- **Mobile Access**: Mobile-optimized quotation review and approval
- **Workflow Automation**: Automated quotation processing based on customer actions
- **Compliance**: Secure review process for regulatory compliance requirements
		`,
	})
	@ApiBody({
		description: 'Token-based status update request with comprehensive validation',
		schema: {
			type: 'object',
			properties: {
				token: {
					type: 'string',
					example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
					description: 'Secure quotation review token'
				},
				status: {
					type: 'string',
					enum: [OrderStatus.APPROVED, OrderStatus.REJECTED],
					example: OrderStatus.APPROVED,
					description: 'New quotation status (APPROVED or REJECTED)'
				},
				comments: {
					type: 'string',
					example: 'Looks good, please proceed with the order.',
					description: 'Optional customer comments for the status update'
				},
				customerInfo: {
					type: 'object',
					properties: {
						name: { type: 'string', example: 'John Smith', description: 'Customer name' },
						email: { type: 'string', example: 'john@example.com', description: 'Customer email' },
						phone: { type: 'string', example: '+1234567890', description: 'Customer phone' }
					},
					description: 'Optional customer information for verification'
				},
				reviewData: {
					type: 'object',
					properties: {
						reviewTime: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Review timestamp' },
						userAgent: { type: 'string', example: 'Mozilla/5.0...', description: 'User agent for tracking' },
						ipAddress: { type: 'string', example: '192.168.1.1', description: 'IP address for security' }
					},
					description: 'Optional review metadata for audit trail'
				}
			},
			required: ['token', 'status'],
		},
		examples: {
			approveQuotation: {
				summary: 'Approve quotation with comments',
				description: 'Approve a quotation with customer comments',
				value: {
					token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
					status: 'APPROVED',
					comments: 'Looks good, please proceed with the order.',
					customerInfo: {
						name: 'John Smith',
						email: 'john@example.com'
					}
				}
			},
			declineQuotation: {
				summary: 'Decline quotation with reason',
				description: 'Decline a quotation with explanation',
				value: {
					token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
					status: 'REJECTED',
					comments: 'Price is too high for our budget.',
					customerInfo: {
						name: 'John Smith',
						email: 'john@example.com'
					}
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Quotation status updated successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'Quotation status updated successfully' },
				data: {
					type: 'object',
					properties: {
						quotationId: { type: 'number', example: 1234, description: 'Quotation ID' },
						quotationNumber: { type: 'string', example: 'QT-2024-001234', description: 'Quotation number' },
						previousStatus: { type: 'string', example: 'PENDING_CLIENT_REVIEW', description: 'Previous status' },
						newStatus: { type: 'string', example: 'APPROVED', description: 'New status' },
						customerComments: { type: 'string', example: 'Looks good, please proceed.', description: 'Customer comments' },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Update timestamp' },
						nextSteps: {
							type: 'array',
							items: { type: 'string' },
							example: ['Order processing will begin', 'Customer will receive confirmation email'],
							description: 'Next steps in the process'
						}
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid token or status',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Invalid token or status transition' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'object',
					properties: {
						tokenStatus: { type: 'string', example: 'EXPIRED', description: 'Token validation status' },
						currentQuotationStatus: { type: 'string', example: 'APPROVED', description: 'Current quotation status' },
						requestedStatus: { type: 'string', example: 'APPROVED', description: 'Requested status' },
						reason: { type: 'string', example: 'Token has expired or quotation is already processed', description: 'Detailed error reason' },
						alternativeActions: {
							type: 'array',
							items: { type: 'string' },
							example: ['Contact sales representative', 'Request new quotation'],
							description: 'Alternative actions for the customer'
						}
					}
				}
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Status update failed',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Status update failed due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
			}
		}
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
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.shopService.sendQuotationToClient(ref, orgId, branchId);
	}

	// ==================== PROJECT ENDPOINTS ====================

	@Post('projects')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
	)
	@ApiOperation({
		summary: '🚀 Create a new project',
		description: `
Create a new project for tracking quotations, budget, and progress.

**Key Features:**
- Comprehensive project management with budget tracking
- Client and user assignment
- Location tracking with GPS coordinates
- Progress percentage monitoring
- Customizable requirements and tags
- Automatic cache invalidation

**Business Rules:**
- Project must be assigned to a valid client
- Assigned user must exist in the system
- Current spent cannot exceed budget
- All monetary values are in the specified currency (default: ZAR)

**Examples:**
- Commercial building projects
- Residential construction
- Infrastructure development
- Renovation projects

**Role Permissions:**
- ADMIN, MANAGER, DEVELOPER, OWNER: Can create projects for any client
- SUPPORT, SUPERVISOR: Can create projects within their scope
		`,
	})
	@ApiBody({
		type: CreateProjectDto,
		description: 'Project creation data with client and user assignments',
		examples: {
			commercialBuilding: {
				summary: 'Commercial Building Project',
				description: 'Large office complex with retail spaces',
				value: {
					name: 'Sandton Business Center Phase 1',
					description: 'A modern 15-story office complex with retail spaces on ground floor and underground parking for 500 vehicles.',
					type: 'commercial_building',
					status: 'planning',
					priority: 'high',
					budget: 25000000.00,
					currentSpent: 0,
					contactPerson: 'John Smith',
					contactEmail: 'john.smith@construction.co.za',
					contactPhone: '+27 11 123 4567',
					startDate: '2024-03-01T00:00:00Z',
					endDate: '2025-12-31T00:00:00Z',
					expectedCompletionDate: '2025-11-30T00:00:00Z',
					address: {
						street: '123 Main Street',
						suburb: 'Sandton',
						city: 'Johannesburg',
						state: 'Gauteng',
						country: 'South Africa',
						postalCode: '2196'
					},
					latitude: -26.1043,
					longitude: 28.0473,
					requirements: ['HVAC system', 'Smart building controls', 'Solar panels', 'Rainwater harvesting'],
					tags: ['commercial', 'green-building', 'high-priority', 'phase-1'],
					notes: 'Client requires LEED Gold certification. Phased construction to minimize disruption.',
					currency: 'ZAR',
					progressPercentage: 0,
					client: { uid: 123 },
					assignedUser: { uid: 456 }
				}
			},
			residentialProject: {
				summary: 'Residential House Project',
				description: 'Luxury residential home construction',
				value: {
					name: 'Constantia Luxury Villa',
					description: 'Custom designed 4-bedroom villa with pool and landscaped gardens.',
					type: 'residential_house',
					status: 'design',
					priority: 'medium',
					budget: 8500000.00,
					currentSpent: 850000.00,
					contactPerson: 'Sarah Johnson',
					contactEmail: 'sarah@email.com',
					contactPhone: '+27 21 555 0123',
					startDate: '2024-02-15T00:00:00Z',
					endDate: '2024-10-30T00:00:00Z',
					address: {
						street: '45 Vineyard Road',
						suburb: 'Constantia',
						city: 'Cape Town',
						state: 'Western Cape',
						country: 'South Africa',
						postalCode: '7806'
					},
					requirements: ['Pool installation', 'Landscaping', 'Security system'],
					tags: ['residential', 'luxury', 'custom-design'],
					notes: 'High-end finishes throughout. Pool must be completed before landscaping.',
					client: { uid: 789 },
					assignedUser: { uid: 321 }
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Project created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Project created successfully' },
				project: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1001, description: 'Project unique identifier' },
						name: { type: 'string', example: 'Sandton Business Center Phase 1', description: 'Project name' },
						description: { type: 'string', example: 'A modern office complex...', description: 'Project description' },
						type: { type: 'string', example: 'commercial_building', description: 'Project type' },
						status: { type: 'string', example: 'planning', description: 'Current project status' },
						priority: { type: 'string', example: 'high', description: 'Project priority level' },
						budget: { type: 'number', example: 25000000.00, description: 'Total project budget' },
						currentSpent: { type: 'number', example: 0, description: 'Amount spent so far' },
						progressPercentage: { type: 'number', example: 0, description: 'Completion percentage' },
						contactPerson: { type: 'string', example: 'John Smith', description: 'Project contact person' },
						contactEmail: { type: 'string', example: 'john.smith@construction.co.za', description: 'Contact email' },
						contactPhone: { type: 'string', example: '+27 11 123 4567', description: 'Contact phone' },
						startDate: { type: 'string', format: 'date-time', example: '2024-03-01T00:00:00Z', description: 'Project start date' },
						endDate: { type: 'string', format: 'date-time', example: '2025-12-31T00:00:00Z', description: 'Project end date' },
						client: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123, description: 'Client ID' },
								name: { type: 'string', example: 'ABC Construction Ltd', description: 'Client name' },
								email: { type: 'string', example: 'info@abc.co.za', description: 'Client email' }
							},
							description: 'Associated client information'
						},
						assignedUser: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456, description: 'User ID' },
								name: { type: 'string', example: 'Jane Doe', description: 'User name' },
								email: { type: 'string', example: 'jane@company.com', description: 'User email' }
							},
							description: 'Assigned project manager'
						},
						createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Creation timestamp' },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Last update timestamp' }
					}
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid project data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Current spent amount cannot exceed the budget' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Client not found',
						'Assigned user not found', 
						'Budget must be greater than 0',
						'Contact person is required'
					]
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Not Found - Client or user not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client not found' }
			},
		},
	})
	async createProject(@Body() createProjectDto: CreateProjectDto, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const createdById = req.user?.uid;
		return this.projectsService.createProject(createProjectDto, orgId, branchId, createdById);
	}

	@Get('projects')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
		AccessLevel.USER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '📋 Get all projects with filtering and pagination',
		description: `
Retrieve projects with comprehensive filtering, pagination, and role-based access control.

**Filtering Capabilities:**
- Status: Filter by project status (planning, in_progress, completed, etc.)
- Priority: Filter by priority level (low, medium, high, urgent, critical)
- Type: Filter by project type (residential, commercial, industrial, etc.)
- Client: Filter by specific client
- User: Filter by assigned user
- Date Range: Filter by start/end dates
- Budget Range: Filter by budget amounts
- Progress Range: Filter by completion percentage
- Search: Text search across project name, description, client name

**Role-Based Access:**
- ADMIN/OWNER/DEVELOPER/MANAGER: Can see all projects
- SUPPORT/SUPERVISOR/USER/TECHNICIAN: Can only see assigned projects

**Performance Features:**
- Results are cached for 5 minutes
- Comprehensive database indexing
- Optimized queries with selective loading

**Pagination:**
- Default: 20 items per page
- Maximum: 100 items per page
- Returns total count and page information
		`,
	})
	@ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)', example: 1 })
	@ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)', example: 20 })
	@ApiQuery({ name: 'status', required: false, enum: ProjectStatus, description: 'Filter by project status' })
	@ApiQuery({ name: 'priority', required: false, enum: ProjectPriority, description: 'Filter by project priority' })
	@ApiQuery({ name: 'type', required: false, enum: ProjectType, description: 'Filter by project type' })
	@ApiQuery({ name: 'clientId', required: false, type: Number, description: 'Filter by client ID' })
	@ApiQuery({ name: 'assignedUserId', required: false, type: Number, description: 'Filter by assigned user ID' })
	@ApiQuery({ name: 'startDate', required: false, type: String, description: 'Filter by start date (ISO format)' })
	@ApiQuery({ name: 'endDate', required: false, type: String, description: 'Filter by end date (ISO format)' })
	@ApiQuery({ name: 'budgetMin', required: false, type: Number, description: 'Minimum budget amount' })
	@ApiQuery({ name: 'budgetMax', required: false, type: Number, description: 'Maximum budget amount' })
	@ApiQuery({ name: 'progressMin', required: false, type: Number, description: 'Minimum progress percentage' })
	@ApiQuery({ name: 'progressMax', required: false, type: Number, description: 'Maximum progress percentage' })
	@ApiQuery({ name: 'search', required: false, type: String, description: 'Search in project name, description, client name' })
	@ApiOkResponse({
		description: '✅ Projects retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1001, description: 'Project unique identifier' },
							name: { type: 'string', example: 'Office Complex Phase 1', description: 'Project name' },
							description: { type: 'string', example: 'Modern office building...', description: 'Project description' },
							type: { type: 'string', example: 'commercial_building', description: 'Project type' },
							status: { type: 'string', example: 'in_progress', description: 'Current status' },
							priority: { type: 'string', example: 'high', description: 'Priority level' },
							budget: { type: 'number', example: 25000000.00, description: 'Total budget' },
							currentSpent: { type: 'number', example: 5000000.00, description: 'Amount spent' },
							progressPercentage: { type: 'number', example: 35.5, description: 'Completion percentage' },
							client: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 123, description: 'Client ID' },
									name: { type: 'string', example: 'ABC Construction', description: 'Client name' }
								}
							},
							assignedUser: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 456, description: 'User ID' },
									name: { type: 'string', example: 'Project Manager', description: 'User name' }
								}
							},
							quotations: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 789, description: 'Quotation ID' },
										quotationNumber: { type: 'string', example: 'QUO-2024-001', description: 'Quotation number' },
										totalAmount: { type: 'number', example: 150000.00, description: 'Quotation amount' },
										status: { type: 'string', example: 'approved', description: 'Quotation status' }
									}
								},
								description: 'Associated quotations'
							},
							createdAt: { type: 'string', format: 'date-time', description: 'Creation date' },
							updatedAt: { type: 'string', format: 'date-time', description: 'Last update date' }
						}
					},
					description: 'Array of projects'
				},
				total: { type: 'number', example: 156, description: 'Total number of projects' },
				page: { type: 'number', example: 1, description: 'Current page number' },
				limit: { type: 'number', example: 20, description: 'Items per page' },
				totalPages: { type: 'number', example: 8, description: 'Total number of pages' }
			},
		},
	})
	async getAllProjects(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: ProjectStatus,
		@Query('priority') priority?: ProjectPriority,
		@Query('type') type?: ProjectType,
		@Query('clientId') clientId?: number,
		@Query('assignedUserId') assignedUserId?: number,
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('budgetMin') budgetMin?: number,
		@Query('budgetMax') budgetMax?: number,
		@Query('progressMin') progressMin?: number,
		@Query('progressMax') progressMax?: number,
		@Query('search') search?: string,
	) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const userRole = req.user?.accessLevel;
		const userId = req.user?.uid;

		const filters = {
			...(status && { status }),
			...(priority && { priority }),
			...(type && { type }),
			...(clientId && { clientId }),
			...(assignedUserId && { assignedUserId }),
			...(startDate && { startDate: new Date(startDate) }),
			...(endDate && { endDate: new Date(endDate) }),
			...(budgetMin && { budgetMin }),
			...(budgetMax && { budgetMax }),
			...(progressMin && { progressMin }),
			...(progressMax && { progressMax }),
			...(search && { search }),
			orgId,
			...(branchId && { branchId }),
		};

		const pageNum = Math.max(1, page || 1);
		const limitNum = Math.min(100, Math.max(1, limit || 20));

		return this.projectsService.findAll(filters, pageNum, limitNum, userRole, userId);
	}

	@Get('projects/:id')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
		AccessLevel.USER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '🔍 Get project by ID',
		description: `
Retrieve a specific project with complete details including all relationships.

**Included Data:**
- Complete project information
- Client details
- Assigned user information
- Associated quotations with items and products
- Organisation and branch information
- Location and timeline data
- Budget and progress tracking

**Security:**
- Role-based access control
- Organisation and branch filtering
- Soft-delete awareness

**Performance:**
- Results cached for 5 minutes
- Optimized with selective relation loading
		`,
	})
	@ApiParam({ 
		name: 'id', 
		type: 'number', 
		description: 'Project unique identifier',
		example: 1001
	})
	@ApiOkResponse({
		description: '✅ Project retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Project retrieved successfully' },
				project: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1001, description: 'Project unique identifier' },
						name: { type: 'string', example: 'Sandton Business Center', description: 'Project name' },
						description: { type: 'string', example: 'Modern office complex...', description: 'Detailed description' },
						type: { type: 'string', example: 'commercial_building', description: 'Project type' },
						status: { type: 'string', example: 'in_progress', description: 'Current status' },
						priority: { type: 'string', example: 'high', description: 'Priority level' },
						budget: { type: 'number', example: 25000000.00, description: 'Total budget in ZAR' },
						currentSpent: { type: 'number', example: 8500000.00, description: 'Amount spent so far' },
						progressPercentage: { type: 'number', example: 45.8, description: 'Completion percentage' },
						contactPerson: { type: 'string', example: 'John Smith', description: 'Project contact' },
						contactEmail: { type: 'string', example: 'john@email.com', description: 'Contact email' },
						contactPhone: { type: 'string', example: '+27 11 123 4567', description: 'Contact phone' },
						startDate: { type: 'string', format: 'date-time', example: '2024-03-01T00:00:00Z', description: 'Start date' },
						endDate: { type: 'string', format: 'date-time', example: '2025-12-31T00:00:00Z', description: 'End date' },
						expectedCompletionDate: { type: 'string', format: 'date-time', example: '2025-11-30T00:00:00Z', description: 'Expected completion' },
						address: {
							type: 'object',
							properties: {
								street: { type: 'string', example: '123 Main Street' },
								suburb: { type: 'string', example: 'Sandton' },
								city: { type: 'string', example: 'Johannesburg' },
								state: { type: 'string', example: 'Gauteng' },
								country: { type: 'string', example: 'South Africa' },
								postalCode: { type: 'string', example: '2196' }
							},
							description: 'Project location address'
						},
						latitude: { type: 'number', example: -26.1043, description: 'GPS latitude' },
						longitude: { type: 'number', example: 28.0473, description: 'GPS longitude' },
						requirements: {
							type: 'array',
							items: { type: 'string' },
							example: ['HVAC system', 'Smart controls', 'Solar panels'],
							description: 'Project requirements'
						},
						tags: {
							type: 'array',
							items: { type: 'string' },
							example: ['commercial', 'green-building', 'high-priority'],
							description: 'Project tags'
						},
						notes: { type: 'string', example: 'LEED Gold certification required...', description: 'Additional notes' },
						currency: { type: 'string', example: 'ZAR', description: 'Budget currency' },
						client: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123, description: 'Client ID' },
								name: { type: 'string', example: 'ABC Construction Ltd', description: 'Client name' },
								email: { type: 'string', example: 'info@abc.co.za', description: 'Client email' },
								contactPerson: { type: 'string', example: 'David Wilson', description: 'Client contact' }
							},
							description: 'Client information'
						},
						assignedUser: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456, description: 'User ID' },
								name: { type: 'string', example: 'Jane Doe', description: 'User name' },
								email: { type: 'string', example: 'jane@company.com', description: 'User email' },
								role: { type: 'string', example: 'Project Manager', description: 'User role' }
							},
							description: 'Assigned project manager'
						},
						quotations: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 789, description: 'Quotation ID' },
									quotationNumber: { type: 'string', example: 'QUO-2024-001234', description: 'Quotation number' },
									totalAmount: { type: 'number', example: 850000.00, description: 'Total amount' },
									status: { type: 'string', example: 'approved', description: 'Quotation status' },
									quotationDate: { type: 'string', format: 'date-time', description: 'Creation date' },
									quotationItems: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												uid: { type: 'number', example: 101, description: 'Item ID' },
												quantity: { type: 'number', example: 50, description: 'Quantity' },
												totalPrice: { type: 'number', example: 25000.00, description: 'Total price' },
												product: {
													type: 'object',
													properties: {
														uid: { type: 'number', example: 202, description: 'Product ID' },
														name: { type: 'string', example: 'Steel Beams', description: 'Product name' },
														sku: { type: 'string', example: 'SB-2024-001', description: 'Product SKU' }
													}
												}
											}
										},
										description: 'Quotation items with products'
									}
								}
							},
							description: 'Associated quotations with complete details'
						},
						createdAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z', description: 'Creation timestamp' },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-20T14:45:00Z', description: 'Last update timestamp' }
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Project not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Project not found' }
			},
		},
	})
	async getProject(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.projectsService.findOne(id, orgId, branchId);
	}

	@Patch('projects/:id')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
	)
	@ApiOperation({
		summary: '✏️ Update project',
		description: `
Update project information with comprehensive validation and business rule enforcement.

**Updateable Fields:**
- Basic information (name, description, type, status, priority)
- Budget and financial tracking
- Timeline dates (start, end, expected completion)
- Contact information
- Location and address
- Requirements and tags
- Progress percentage
- Client and user assignments

**Business Rules:**
- Current spent cannot exceed budget
- Client and user must exist if being updated
- Status transitions are tracked for analytics
- Progress percentage must be between 0-100

**Security:**
- Role-based access control
- Organisation and branch validation
- Audit trail for all changes

**Performance:**
- Automatic cache invalidation
- Optimized update queries
- Event emission for real-time updates
		`,
	})
	@ApiParam({ 
		name: 'id', 
		type: 'number', 
		description: 'Project unique identifier to update',
		example: 1001
	})
	@ApiBody({
		type: UpdateProjectDto,
		description: 'Project update data (all fields optional)',
		examples: {
			statusUpdate: {
				summary: 'Update Project Status',
				description: 'Change project status and progress',
				value: {
					status: 'in_progress',
					progressPercentage: 25.5,
					notes: 'Foundation work completed. Moving to structural phase.'
				}
			},
			budgetUpdate: {
				summary: 'Update Project Budget',
				description: 'Adjust budget and spending',
				value: {
					budget: 28000000.00,
					currentSpent: 3500000.00,
					notes: 'Budget increased due to additional requirements from client.'
				}
			},
			timelineUpdate: {
				summary: 'Update Project Timeline',
				description: 'Adjust project dates',
				value: {
					startDate: '2024-04-01T00:00:00Z',
					endDate: '2026-02-28T00:00:00Z',
					expectedCompletionDate: '2026-01-31T00:00:00Z',
					notes: 'Timeline extended due to permit delays.'
				}
			},
			contactUpdate: {
				summary: 'Update Contact Information',
				description: 'Change project contact details',
				value: {
					contactPerson: 'Michael Brown',
					contactEmail: 'michael.brown@newcompany.co.za',
					contactPhone: '+27 11 987 6543'
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Project updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Project updated successfully' },
				project: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1001, description: 'Project unique identifier' },
						name: { type: 'string', example: 'Updated Project Name', description: 'Updated project name' },
						status: { type: 'string', example: 'in_progress', description: 'Updated status' },
						progressPercentage: { type: 'number', example: 35.8, description: 'Updated progress' },
						budget: { type: 'number', example: 28000000.00, description: 'Updated budget' },
						currentSpent: { type: 'number', example: 5500000.00, description: 'Updated spending' },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-20T15:30:00Z', description: 'Last update timestamp' }
					},
					description: 'Complete updated project object with all relations'
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid update data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Current spent amount cannot exceed the budget' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Budget must be greater than current spent amount',
						'Progress percentage must be between 0 and 100',
						'End date must be after start date'
					]
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Not Found - Project, client, or user not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Project not found' }
			},
		},
	})
	async updateProject(
		@Param('id') id: number,
		@Body() updateProjectDto: UpdateProjectDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const updatedById = req.user?.uid;
		return this.projectsService.updateProject(id, updateProjectDto, orgId, branchId, updatedById);
	}

	@Delete('projects/:id')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '🗑️ Delete project (soft delete)',
		description: `
Safely delete a project with comprehensive validation and business rule enforcement.

**Safety Features:**
- Soft delete only (data preserved for audit trail)
- Validation for active quotations
- Automatic cache cleanup
- Event emission for analytics

**Business Rules:**
- Cannot delete projects with active quotations
- Must cancel or complete all quotations first
- Audit trail maintained for compliance
- Related data remains intact

**Security:**
- High-level role access only (ADMIN, MANAGER, DEVELOPER, OWNER)
- Organisation and branch validation
- Complete activity logging

**Best Practices:**
- Always check for dependencies before deletion
- Consider archiving instead of deletion
- Maintain data integrity across relationships
		`,
	})
	@ApiParam({ 
		name: 'id', 
		type: 'number', 
		description: 'Project unique identifier to delete',
		example: 1001
	})
	@ApiOkResponse({
		description: '✅ Project deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Project deleted successfully' }
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Cannot delete project with active quotations',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot delete project with active quotations. Please cancel or complete all quotations first.' }
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Project not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Project not found' }
			},
		},
	})
	async deleteProject(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const deletedById = req.user?.uid;
		return this.projectsService.deleteProject(id, orgId, branchId, deletedById);
	}

	@Post('projects/assign-quotations')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
	)
	@ApiOperation({
		summary: '🔗 Assign quotations to project',
		description: `
Assign multiple quotations to a specific project for comprehensive tracking and management.

**Key Features:**
- Bulk quotation assignment
- Client validation (quotations must belong to same client as project)
- Duplicate assignment prevention
- Comprehensive validation and error handling

**Business Rules:**
- Quotations must belong to the same client as the project
- Quotations cannot be assigned to multiple projects simultaneously
- All quotation IDs must exist and be accessible
- Automatic project value calculation updates

**Use Cases:**
- Organizing quotations by project phase
- Budget tracking per project
- Progress monitoring with financial data
- Client-specific project management

**Analytics Benefits:**
- Project-wise quotation tracking
- Budget vs actual analysis
- Progress reporting with financial context
- Client project performance metrics
		`,
	})
	@ApiBody({
		type: AssignQuotationToProjectDto,
		description: 'Quotation assignment data',
		examples: {
			singleAssignment: {
				summary: 'Assign Single Quotation',
				description: 'Assign one quotation to a project',
				value: {
					projectId: 1001,
					quotationIds: [789],
					notes: 'Main structural quotation for foundation work'
				}
			},
			bulkAssignment: {
				summary: 'Bulk Quotation Assignment',
				description: 'Assign multiple quotations to a project',
				value: {
					projectId: 1001,
					quotationIds: [789, 790, 791, 792],
					notes: 'Phase 1 quotations: foundation, electrical, plumbing, and HVAC'
				}
			},
			phaseAssignment: {
				summary: 'Project Phase Assignment',
				description: 'Assign quotations for specific project phase',
				value: {
					projectId: 1001,
					quotationIds: [793, 794, 795],
					notes: 'Phase 2 quotations: structural steel, roofing, and exterior work'
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Quotations assigned to project successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Quotations assigned to project successfully' },
				assignedCount: { type: 'number', example: 4, description: 'Number of quotations assigned' },
				project: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1001, description: 'Project ID' },
						name: { type: 'string', example: 'Office Complex Phase 1', description: 'Project name' },
						quotations: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 789, description: 'Quotation ID' },
									quotationNumber: { type: 'string', example: 'QUO-2024-001', description: 'Quotation number' },
									totalAmount: { type: 'number', example: 150000.00, description: 'Quotation amount' },
									status: { type: 'string', example: 'approved', description: 'Quotation status' },
									quotationDate: { type: 'string', format: 'date-time', description: 'Quotation date' }
								}
							},
							description: 'All project quotations including newly assigned ones'
						},
						totalQuotationValue: { type: 'number', example: 850000.00, description: 'Total value of all assigned quotations' }
					},
					description: 'Updated project with assigned quotations'
				}
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid assignment data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Quotations 456, 789 do not belong to the same client as the project' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Quotations already assigned to other projects: 456 (assigned to project 1002)',
						'Quotations do not belong to the same client as the project'
					]
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Not Found - Project or quotations not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Quotations not found: 456, 789' }
			},
		},
	})
	async assignQuotationsToProject(
		@Body() assignDto: AssignQuotationToProjectDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const assignedById = req.user?.uid;
		return this.projectsService.assignQuotationsToProject(assignDto, orgId, branchId, assignedById);
	}

	@Post('projects/unassign-quotations')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
	)
	@ApiOperation({
		summary: '🔓 Unassign quotations from projects',
		description: `
Remove quotations from their current project assignments.

**Use Cases:**
- Reassigning quotations to different projects
- Removing incorrect assignments
- Project restructuring
- Quotation management cleanup

**Features:**
- Bulk unassignment support
- Comprehensive validation
- Audit trail maintenance
- Automatic cache cleanup

**Safety:**
- Validates quotation existence
- Tracks affected projects
- Maintains data integrity
- Logs all changes for audit
		`,
	})
	@ApiBody({
		type: UnassignQuotationFromProjectDto,
		description: 'Quotation unassignment data',
		examples: {
			simpleUnassignment: {
				summary: 'Unassign Quotations',
				description: 'Remove quotations from their projects',
				value: {
					quotationIds: [789, 790],
					reason: 'Moving quotations to different project phase'
				}
			},
			cleanupUnassignment: {
				summary: 'Cleanup Unassignment',
				description: 'Remove incorrectly assigned quotations',
				value: {
					quotationIds: [791, 792, 793],
					reason: 'Quotations were assigned to wrong project - correcting assignment'
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Quotations unassigned from projects successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Quotations unassigned from projects successfully' },
				unassignedCount: { type: 'number', example: 3, description: 'Number of quotations unassigned' }
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Quotations not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Quotations not found: 456, 789' }
			},
		},
	})
	async unassignQuotationsFromProject(
		@Body() unassignDto: UnassignQuotationFromProjectDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const unassignedById = req.user?.uid;
		return this.projectsService.unassignQuotationsFromProject(unassignDto, orgId, branchId, unassignedById);
	}

	@Get('projects/me')
	@Roles(AccessLevel.CLIENT, AccessLevel.MEMBER)
	@ApiOperation({
		summary: '📋 Get my projects (current client)',
		description: 'Retrieve all projects for the authenticated client. No clientId required.',
	})
	@ApiOkResponse({
		description: '✅ Current client projects retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client projects retrieved successfully' },
				projects: {
					type: 'array',
					items: { type: 'object' },
					description: 'Array of projects for the current client',
				},
			},
		},
	})
	async getMyProjects(@Req() req: AuthenticatedRequest) {
		const clientUid = req.user?.clientUid;
		if (clientUid == null) {
			throw new UnauthorizedException('Client context not found');
		}
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.projectsService.getProjectsByClient(clientUid, orgId, branchId);
	}

	@Get('projects/client/:clientId')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
		AccessLevel.USER,
		AccessLevel.TECHNICIAN,
		AccessLevel.MEMBER,
		AccessLevel.CLIENT,
	)
	@ApiOperation({
		summary: '👥 Get projects by client',
		description: `
Retrieve all projects for a specific client with complete project details.

**Included Data:**
- All client projects (active only)
- Project details and timelines
- Associated quotations
- Assigned users
- Progress and budget information

**Performance:**
- Results cached for optimal speed
- Optimized database queries
- Role-based access control

**Use Cases:**
- Client portfolio management
- Project overview for client meetings
- Progress reporting to clients
- Budget analysis per client
		`,
	})
	@ApiParam({ 
		name: 'clientId', 
		type: 'number', 
		description: 'Client unique identifier',
		example: 123
	})
	@ApiOkResponse({
		description: '✅ Client projects retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Client projects retrieved successfully' },
				projects: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1001, description: 'Project ID' },
							name: { type: 'string', example: 'Office Complex', description: 'Project name' },
							status: { type: 'string', example: 'in_progress', description: 'Current status' },
							budget: { type: 'number', example: 25000000.00, description: 'Project budget' },
							progressPercentage: { type: 'number', example: 45.5, description: 'Completion percentage' },
							assignedUser: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 456, description: 'User ID' },
									name: { type: 'string', example: 'Project Manager', description: 'User name' }
								}
							},
							quotations: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 789, description: 'Quotation ID' },
										quotationNumber: { type: 'string', example: 'QUO-2024-001', description: 'Quotation number' },
										totalAmount: { type: 'number', example: 150000.00, description: 'Amount' }
									}
								}
							}
						}
					},
					description: 'Array of client projects'
				}
			},
		},
	})
	async getProjectsByClient(@Param('clientId') clientId: number, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		const userRole = req.user?.role || req.user?.accessLevel;

		// Security: CLIENT and MEMBER can only access their own projects (compare clientId to authenticated client's Client.uid)
		if (userRole === AccessLevel.CLIENT || userRole === AccessLevel.MEMBER) {
			const clientUid = req.user?.clientUid;
			if (clientUid == null || Number(clientId) !== Number(clientUid)) {
				throw new UnauthorizedException('You can only access your own projects');
			}
		}

		return this.projectsService.getProjectsByClient(clientId, orgId, branchId);
	}

	@Get('projects/user/:userId')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
		AccessLevel.USER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '👤 Get projects by assigned user',
		description: `
Retrieve all projects assigned to a specific user.

**Use Cases:**
- Personal project dashboard
- Workload management
- Performance tracking
- Task assignment overview

**Features:**
- Complete project details
- Associated quotations
- Client information
- Progress tracking
		`,
	})
	@ApiParam({ 
		name: 'userId', 
		type: 'number', 
		description: 'User unique identifier',
		example: 456
	})
	@ApiOkResponse({
		description: '✅ User projects retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User projects retrieved successfully' },
				projects: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1001, description: 'Project ID' },
							name: { type: 'string', example: 'Office Complex', description: 'Project name' },
							status: { type: 'string', example: 'in_progress', description: 'Current status' },
							priority: { type: 'string', example: 'high', description: 'Priority level' },
							progressPercentage: { type: 'number', example: 45.5, description: 'Completion percentage' },
							endDate: { type: 'string', format: 'date-time', description: 'Project deadline' },
							client: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 123, description: 'Client ID' },
									name: { type: 'string', example: 'ABC Construction', description: 'Client name' }
								}
							}
						}
					},
					description: 'Array of assigned projects'
				}
			},
		},
	})
	async getProjectsByUser(@Param('userId') userId: number, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.projectsService.getProjectsByUser(userId, orgId, branchId);
	}

	@Get('projects-stats')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
		AccessLevel.SUPPORT,
		AccessLevel.SUPERVISOR,
	)
	@ApiOperation({
		summary: '📊 Get project statistics and analytics',
		description: `
Comprehensive project analytics and statistics for management dashboards.

**Included Metrics:**
- Total project count
- Distribution by status, priority, and type
- Financial analytics (total budget, spent, averages)
- Progress analytics
- Upcoming deadlines and overdue projects

**Performance:**
- Cached results for fast dashboard loading
- Optimized aggregation queries
- Real-time data with 5-minute cache TTL

**Use Cases:**
- Executive dashboards
- Project portfolio management
- Resource planning
- Performance monitoring
- Risk assessment (overdue projects)
		`,
	})
	@ApiOkResponse({
		description: '✅ Project statistics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Project statistics retrieved successfully' },
				stats: {
					type: 'object',
					properties: {
						totalProjects: { type: 'number', example: 156, description: 'Total number of active projects' },
						projectsByStatus: {
							type: 'object',
							properties: {
								planning: { type: 'number', example: 25, description: 'Projects in planning phase' },
								in_progress: { type: 'number', example: 78, description: 'Projects currently in progress' },
								completed: { type: 'number', example: 45, description: 'Completed projects' },
								on_hold: { type: 'number', example: 8, description: 'Projects on hold' }
							},
							description: 'Project count by status'
						},
						projectsByPriority: {
							type: 'object',
							properties: {
								low: { type: 'number', example: 35, description: 'Low priority projects' },
								medium: { type: 'number', example: 67, description: 'Medium priority projects' },
								high: { type: 'number', example: 42, description: 'High priority projects' },
								urgent: { type: 'number', example: 12, description: 'Urgent projects' }
							},
							description: 'Project count by priority'
						},
						projectsByType: {
							type: 'object',
							properties: {
								commercial_building: { type: 'number', example: 45, description: 'Commercial projects' },
								residential_house: { type: 'number', example: 38, description: 'Residential projects' },
								industrial_facility: { type: 'number', example: 23, description: 'Industrial projects' },
								infrastructure: { type: 'number', example: 15, description: 'Infrastructure projects' }
							},
							description: 'Project count by type'
						},
						totalBudget: { type: 'number', example: 2500000000.00, description: 'Total budget across all projects' },
						totalSpent: { type: 'number', example: 1850000000.00, description: 'Total amount spent across all projects' },
						averageBudget: { type: 'number', example: 16025641.03, description: 'Average project budget' },
						averageProgress: { type: 'number', example: 42.8, description: 'Average completion percentage' },
						upcomingDeadlines: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1001, description: 'Project ID' },
									name: { type: 'string', example: 'Office Complex Phase 1', description: 'Project name' },
									endDate: { type: 'string', format: 'date-time', example: '2024-02-15T00:00:00Z', description: 'Project deadline' },
									daysRemaining: { type: 'number', example: 12, description: 'Days until deadline' },
									progressPercentage: { type: 'number', example: 78.5, description: 'Current progress' },
									client: {
										type: 'object',
										properties: {
											name: { type: 'string', example: 'ABC Construction', description: 'Client name' }
										}
									}
								}
							},
							description: 'Projects with deadlines in next 30 days'
						},
						overdueProjects: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1002, description: 'Project ID' },
									name: { type: 'string', example: 'Warehouse Renovation', description: 'Project name' },
									endDate: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00Z', description: 'Original deadline' },
									daysOverdue: { type: 'number', example: 15, description: 'Days overdue' },
									progressPercentage: { type: 'number', example: 65.2, description: 'Current progress' },
									assignedUser: {
										type: 'object',
										properties: {
											name: { type: 'string', example: 'Project Manager', description: 'Assigned user' }
										}
									}
								}
							},
							description: 'Projects past their deadline'
						}
					}
				}
			},
		},
	})
	async getProjectStats(@Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = this.toNumber(req.user?.branch?.uid);
		return this.projectsService.getProjectStats(orgId, branchId);
	}
}
