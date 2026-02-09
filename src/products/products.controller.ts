import { ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import {
	ApiOperation,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiQuery,
	ApiBearerAuth,
	ApiForbiddenResponse,
	ApiConflictResponse,
	ApiUnprocessableEntityResponse,
	ApiInternalServerErrorResponse,
	ApiConsumes,
	ApiProduces,
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, getFutureDate, getPastDate, createApiDescription } from '../lib/utils/swagger-helpers';
import { RoleGuard } from '../guards/role.guard';
import { ClerkAuthGuard } from '../clerk/clerk.guard';
import { Roles } from '../decorators/role.decorator';
import { ProductsService } from './products.service';
import { AccessLevel } from '../lib/enums/user.enums';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BulkCreateProductDto } from './dto/bulk-create-product.dto';
import { BulkUpdateProductDto } from './dto/bulk-update-product.dto';
import { PaginationQuery } from '../lib/interfaces/product.interfaces';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req, BadRequestException } from '@nestjs/common';
import { ProductAnalyticsDto } from './dto/product-analytics.dto';
import { AuthenticatedRequest, getClerkOrgId } from '../lib/interfaces/authenticated-request.interface';
import { OrganisationService } from '../organisation/organisation.service';

@ApiBearerAuth('JWT-auth')
@ApiTags('🛍️ Products') 
@Controller('products')
@UseGuards(ClerkAuthGuard, RoleGuard)
@EnterpriseOnly('products')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({ 
	description: '🔒 Unauthorized - Authentication required',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Authentication token is required' },
			error: { type: 'string', example: 'Unauthorized' },
			statusCode: { type: 'number', example: 401 }
		}
	}
})
export class ProductsController {
	constructor(
		private readonly productsService: ProductsService,
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

	private getClerkOrgIdString(req: AuthenticatedRequest): string {
		const clerkOrgId = getClerkOrgId(req);
		if (!clerkOrgId) {
			throw new BadRequestException('Organization context required');
		}
		return clerkOrgId;
	}

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
		summary: '➕ Create a new product',
		description: `
# Create Product

Creates a new product in the system with comprehensive tracking and analytics capabilities.

## 📋 **Use Cases**
- **Physical Products**: Add inventory items, merchandise, consumables
- **Digital Products**: Track software licenses, digital downloads, subscriptions
- **Services**: Register service offerings, consultation packages
- **Bundles**: Create product packages and combinations
- **Rental Items**: Add equipment or items available for rental

## 🔧 **Features**
- Automatic SKU generation and validation
- Price tier management (retail, wholesale, bulk)
- Multi-category and tag support
- Inventory tracking and low stock alerts
- Advanced analytics and performance metrics
- SEO-friendly product URLs

## 📝 **Required Fields**
- Product name and description
- Category and pricing information
- SKU and barcode details
- Inventory and stock management
- Images and media attachments

## 🚀 **Analytics Integration**
- Real-time view tracking
- Sales conversion metrics
- Customer behavior analysis
- Revenue performance tracking
		`
	})
	@ApiBody({ 
		type: CreateProductDto,
		description: 'Product creation payload with all required information',
		examples: {
			electronics: {
				summary: '📱 Electronics - Smartphone',
				description: 'Example of creating an electronics product with full specifications',
				value: {
					name: 'iPhone 15 Pro Max',
					description: 'Latest Apple smartphone with titanium design, A17 Pro chip, and advanced camera system',
					category: 'ELECTRONICS',
					price: 1199.99,
					salePrice: 1099.99,
					discount: 8.33,
					sku: 'IPH15PM-256GB-NT',
					barcode: '194253000001',
					stockQuantity: 50,
					brand: 'Apple',
					weight: 0.221,
					packageQuantity: 1,
					productReferenceCode: 'APL-IPH15PM-001',
					reorderPoint: 10,
					isOnPromotion: true,
					promotionStartDate: new Date('2024-01-01'),
					promotionEndDate: new Date('2024-12-31'),
					packageUnit: 'piece',
					dimensions: '159.9mm x 76.7mm x 8.25mm',
					manufacturer: 'Apple Inc.',
					model: 'A3108',
					color: 'Natural Titanium',
					material: 'Titanium',
					warrantyPeriod: 12,
					warrantyUnit: 'months',
					specifications: 'Display: 6.7" Super Retina XDR, Chip: A17 Pro, Storage: 256GB, Camera: 48MP Main, 12MP Ultra Wide, 12MP Telephoto',
					features: 'Face ID, 5G, Wireless Charging, Water Resistant IP68, Action Button',
					rating: 4.8,
					reviewCount: 2450,
					origin: 'China',
					isFragile: true,
					requiresSpecialHandling: false,
					storageConditions: 'Store in cool, dry place. Temperature: 0-35°C',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 5.0,
					bulkDiscountMinQty: 10
				}
			},
			clothing: {
				summary: '👔 Clothing - Business Shirt',
				description: 'Example of creating a clothing product with size variants',
				value: {
					name: 'Premium Cotton Business Shirt',
					description: 'High-quality cotton shirt perfect for professional settings with wrinkle-resistant fabric',
					category: 'CLOTHING',
					price: 89.99,
					salePrice: 79.99,
					discount: 11.11,
					sku: 'CBS-WHT-L-001',
					barcode: '123456789012',
					stockQuantity: 200,
					brand: 'Executive Style',
					weight: 0.3,
					packageQuantity: 1,
					productReferenceCode: 'EXS-CBS-001',
					reorderPoint: 25,
					isOnPromotion: true,
					packageUnit: 'piece',
					dimensions: 'Size L: Chest 42", Length 29"',
					manufacturer: 'Premium Textiles Ltd',
					model: 'ES-2024-CBS',
					color: 'White',
					material: '100% Cotton',
					warrantyPeriod: 6,
					warrantyUnit: 'months',
					specifications: 'Fabric: 100% Cotton, Weight: 120gsm, Collar: Spread, Cuffs: Barrel',
					features: 'Wrinkle-resistant, Machine washable, Breathable fabric, Professional fit',
					rating: 4.6,
					reviewCount: 890,
					origin: 'Portugal',
					isFragile: false,
					requiresSpecialHandling: false,
					storageConditions: 'Store in dry place, protect from moisture',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 15.0,
					bulkDiscountMinQty: 50
				}
			},
			food: {
				summary: '🍖 Food - Organic Beef',
				description: 'Example of creating a food product with expiration and storage requirements',
				value: {
					name: 'Organic Grass-Fed Beef Ribeye',
					description: 'Premium organic grass-fed beef ribeye steaks, aged 21 days for optimal flavor',
					category: 'MEAT_POULTRY',
					price: 32.99,
					salePrice: 29.99,
					discount: 9.09,
					sku: 'ORG-BEEF-RIB-001',
					barcode: '987654321098',
					stockQuantity: 150,
					brand: 'Organic Valley Farm',
					weight: 0.45,
					packageQuantity: 2,
					productReferenceCode: 'OVF-BEEF-001',
					reorderPoint: 30,
					isOnPromotion: true,
					packageUnit: 'steaks',
					packPrice: 29.99,
					packWeight: 0.45,
					packDimensions: '15cm x 10cm x 3cm',
					itemsPerPack: 2,
					dimensions: '12cm x 8cm x 2.5cm',
					manufacturer: 'Organic Valley Farm',
					model: 'OVF-RIB-2024',
					specifications: 'Grade: Prime, Cut: Ribeye, Aging: 21 days, Fat content: 20%',
					features: 'Organic certified, Grass-fed, No antibiotics, No hormones',
					rating: 4.9,
					reviewCount: 456,
					origin: 'New Zealand',
					isFragile: true,
					requiresSpecialHandling: true,
					storageConditions: 'Keep frozen at -18°C or below. Refrigerate at 0-4°C if thawed',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 10.0,
					bulkDiscountMinQty: 20
				}
			},
			services: {
				summary: '🔧 Services - IT Consultation',
				description: 'Example of creating a service product with hourly billing',
				value: {
					name: 'IT Infrastructure Consultation',
					description: 'Professional IT consultation service for network setup, security assessment, and system optimization',
					category: 'SERVICES',
					price: 150.00,
					sku: 'ITC-INFRA-001',
					barcode: '111222333444',
					stockQuantity: 999,
					brand: 'TechSolutions Pro',
					weight: 0,
					packageQuantity: 1,
					productReferenceCode: 'TSP-ITC-001',
					reorderPoint: 0,
					isOnPromotion: false,
					packageUnit: 'hour',
					specifications: 'Service Type: Consultation, Duration: 1 hour, Expertise: Network Infrastructure, Security, System Optimization',
					features: 'Remote or on-site, 24/7 support, Follow-up documentation, Recommendations report',
					rating: 4.7,
					reviewCount: 123,
					origin: 'Local Service',
					isFragile: false,
					requiresSpecialHandling: false,
					storageConditions: 'N/A - Service product',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 20.0,
					bulkDiscountMinQty: 10
				}
			},
			digital: {
				summary: '💻 Digital - Software License',
				description: 'Example of creating a digital product with license management',
				value: {
					name: 'CRM Software Professional License',
					description: 'Professional CRM software license with advanced features, reporting, and unlimited users',
					category: 'SOFTWARE',
					price: 299.99,
					salePrice: 199.99,
					discount: 33.33,
					sku: 'CRM-PRO-LIC-001',
					barcode: '555666777888',
					stockQuantity: 1000,
					brand: 'BusinessSoft',
					weight: 0,
					packageQuantity: 1,
					productReferenceCode: 'BS-CRM-001',
					reorderPoint: 100,
					isOnPromotion: true,
					promotionStartDate: new Date('2024-01-01'),
					promotionEndDate: new Date('2024-06-30'),
					packageUnit: 'license',
					manufacturer: 'BusinessSoft Inc.',
					model: 'CRM-PRO-2024',
					specifications: 'License Type: Professional, Users: Unlimited, Storage: 100GB, Support: 24/7',
					features: 'Advanced reporting, API access, Custom fields, Email integration, Mobile app',
					rating: 4.5,
					reviewCount: 678,
					origin: 'USA',
					isFragile: false,
					requiresSpecialHandling: false,
					storageConditions: 'Digital product - no physical storage required',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 25.0,
					bulkDiscountMinQty: 5
				}
			},
			automotive: {
				summary: '🚗 Automotive - Car Parts',
				description: 'Example of creating automotive parts with compatibility information',
				value: {
					name: 'Brake Pad Set - Front',
					description: 'High-performance ceramic brake pads for front wheels, compatible with multiple vehicle models',
					category: 'AUTOMOTIVE',
					price: 129.99,
					salePrice: 109.99,
					discount: 15.38,
					sku: 'BRK-PAD-FRT-001',
					barcode: '999888777666',
					stockQuantity: 75,
					brand: 'AutoPro',
					weight: 2.5,
					packageQuantity: 4,
					productReferenceCode: 'AP-BRK-001',
					reorderPoint: 20,
					isOnPromotion: true,
					packageUnit: 'set',
					itemsPerPack: 4,
					packWeight: 2.5,
					packDimensions: '30cm x 20cm x 10cm',
					dimensions: '25cm x 15cm x 2cm',
					manufacturer: 'AutoPro Manufacturing',
					model: 'AP-2024-FRT',
					material: 'Ceramic',
					warrantyPeriod: 24,
					warrantyUnit: 'months',
					specifications: 'Material: Ceramic, Friction coefficient: 0.45, Operating temperature: -40°C to 500°C',
					features: 'Low dust, Low noise, Extended wear life, Consistent performance',
					rating: 4.4,
					reviewCount: 234,
					origin: 'Germany',
					isFragile: false,
					requiresSpecialHandling: false,
					storageConditions: 'Store in dry place, protect from moisture and extreme temperatures',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 12.0,
					bulkDiscountMinQty: 10
				}
			},
			healthcare: {
				summary: '🏥 Healthcare - Medical Device',
				description: 'Example of creating a medical device with regulatory compliance',
				value: {
					name: 'Digital Blood Pressure Monitor',
					description: 'FDA-approved automatic blood pressure monitor with large display and memory storage',
					category: 'HEALTHCARE',
					price: 79.99,
					salePrice: 69.99,
					discount: 12.5,
					sku: 'MED-BP-MON-001',
					barcode: '333444555666',
					stockQuantity: 100,
					brand: 'MediCare Pro',
					weight: 0.8,
					packageQuantity: 1,
					productReferenceCode: 'MCP-BP-001',
					reorderPoint: 25,
					isOnPromotion: true,
					packageUnit: 'unit',
					dimensions: '14cm x 10cm x 6cm',
					manufacturer: 'MediCare Pro Ltd',
					model: 'MCP-BP-2024',
					material: 'Medical Grade Plastic',
					warrantyPeriod: 24,
					warrantyUnit: 'months',
					specifications: 'Measurement range: 0-300mmHg, Accuracy: ±3mmHg, Memory: 120 readings, Display: LCD',
					features: 'FDA approved, Automatic inflation, Memory storage, Large display, Irregular heartbeat detection',
					rating: 4.6,
					reviewCount: 456,
					origin: 'Japan',
					isFragile: true,
					requiresSpecialHandling: true,
					storageConditions: 'Store at room temperature 10-40°C, protect from moisture',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 8.0,
					bulkDiscountMinQty: 25
				}
			},
			industrial: {
				summary: '🏭 Industrial - Heavy Equipment',
				description: 'Example of creating industrial equipment with pallet pricing',
				value: {
					name: 'Industrial Steel Bolts M12x50',
					description: 'High-strength steel bolts for industrial applications, galvanized coating for corrosion resistance',
					category: 'INDUSTRIAL',
					price: 2.99,
					salePrice: 2.49,
					discount: 16.72,
					sku: 'IND-BOLT-M12-001',
					barcode: '777888999000',
					stockQuantity: 5000,
					brand: 'SteelPro Industrial',
					weight: 0.05,
					packageQuantity: 100,
					productReferenceCode: 'SPI-BOLT-001',
					reorderPoint: 1000,
					isOnPromotion: true,
					packageUnit: 'box',
					itemsPerPack: 100,
					packsPerPallet: 50,
					packPrice: 249.00,
					palletPrice: 12450.00,
					packWeight: 5.0,
					palletWeight: 250.0,
					packDimensions: '25cm x 20cm x 15cm',
					palletDimensions: '120cm x 80cm x 150cm',
					dimensions: '50mm length x 12mm diameter',
					manufacturer: 'SteelPro Industrial',
					model: 'SPI-M12-2024',
					material: 'Galvanized Steel',
					warrantyPeriod: 60,
					warrantyUnit: 'months',
					specifications: 'Thread: M12 x 1.75, Length: 50mm, Grade: 8.8, Coating: Galvanized',
					features: 'Corrosion resistant, High tensile strength, Precision threading, Industrial grade',
					rating: 4.8,
					reviewCount: 89,
					origin: 'Germany',
					isFragile: false,
					requiresSpecialHandling: false,
					storageConditions: 'Store in dry place, protect from moisture to prevent corrosion',
					minimumOrderQuantity: 100,
					bulkDiscountPercentage: 20.0,
					bulkDiscountMinQty: 1000
				}
			},
			books: {
				summary: '📚 Books - Educational',
				description: 'Example of creating educational books with ISBN tracking',
				value: {
					name: 'Advanced JavaScript Programming Guide',
					description: 'Comprehensive guide to advanced JavaScript programming concepts, ES6+, and modern frameworks',
					category: 'BOOKS',
					price: 49.99,
					salePrice: 39.99,
					discount: 20.0,
					sku: 'BOOK-JS-ADV-001',
					barcode: '9781234567890',
					stockQuantity: 300,
					brand: 'TechBooks Publishing',
					weight: 0.8,
					packageQuantity: 1,
					productReferenceCode: 'TBP-JS-001',
					reorderPoint: 50,
					isOnPromotion: true,
					packageUnit: 'book',
					dimensions: '24cm x 18cm x 3cm',
					manufacturer: 'TechBooks Publishing',
					model: 'TBP-2024-JS',
					specifications: 'Pages: 450, Format: Paperback, Language: English, Edition: 3rd',
					features: 'Code examples, Exercises, Online resources, Index, Glossary',
					rating: 4.7,
					reviewCount: 567,
					origin: 'USA',
					isFragile: false,
					requiresSpecialHandling: false,
					storageConditions: 'Store in dry place, protect from moisture and direct sunlight',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 25.0,
					bulkDiscountMinQty: 20
				}
			},
			beauty: {
				summary: '💄 Beauty - Skincare',
				description: 'Example of creating beauty products with expiration dates',
				value: {
					name: 'Vitamin C Brightening Serum',
					description: 'Anti-aging vitamin C serum with hyaluronic acid for radiant, youthful skin',
					category: 'BEAUTY',
					price: 89.99,
					salePrice: 79.99,
					discount: 11.11,
					sku: 'BTY-SER-VTC-001',
					barcode: '444555666777',
					stockQuantity: 250,
					brand: 'GlowBeauty',
					weight: 0.15,
					packageQuantity: 1,
					productReferenceCode: 'GB-SER-001',
					reorderPoint: 50,
					isOnPromotion: true,
					packageUnit: 'bottle',
					dimensions: '12cm x 4cm x 4cm',
					manufacturer: 'GlowBeauty Labs',
					model: 'GB-VTC-2024',
					material: 'Glass bottle with dropper',
					warrantyPeriod: 24,
					warrantyUnit: 'months',
					specifications: 'Volume: 30ml, Vitamin C: 20%, Hyaluronic Acid: 2%, pH: 3.5-4.0',
					features: 'Anti-aging, Brightening, Hydrating, Antioxidant protection, Dermatologist tested',
					rating: 4.5,
					reviewCount: 1234,
					origin: 'Korea',
					isFragile: true,
					requiresSpecialHandling: true,
					storageConditions: 'Store in cool, dark place. Refrigerate after opening. Use within 6 months of opening',
					minimumOrderQuantity: 1,
					bulkDiscountPercentage: 15.0,
					bulkDiscountMinQty: 12
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Product created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product created successfully' },
				product: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'iPhone 15 Pro' },
						description: { type: 'string', example: 'Latest Apple smartphone with titanium design' },
						category: { type: 'string', example: 'ELECTRONICS' },
						price: { type: 'number', example: 999.99 },
						sku: { type: 'string', example: 'IPH15P-128GB-NT' },
						barcode: { type: 'string', example: '194253000000' },
						stockQuantity: { type: 'number', example: 50 },
						isActive: { type: 'boolean', example: true },
						createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						organisation: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'Tech Solutions Ltd' }
							}
						}
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid or missing required data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed: Product name is required' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Product name must be between 3 and 100 characters',
						'SKU must be unique within the organization',
						'Price must be a positive number',
						'Stock quantity cannot be negative'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to create products in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Product already exists',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with SKU IPH15P-128GB-NT already exists' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflictingProduct: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 9876 },
						name: { type: 'string', example: 'iPhone 15 Pro' },
						sku: { type: 'string', example: 'IPH15P-128GB-NT' }
					}
				}
			}
		}
	})
	@ApiUnprocessableEntityResponse({
		description: '🔄 Unprocessable Entity - Business logic validation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot create product: Invalid pricing tier configuration' },
				error: { type: 'string', example: 'Unprocessable Entity' },
				statusCode: { type: 'number', example: 422 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Unexpected system error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while creating the product' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async createProduct(@Body() createProductDto: CreateProductDto, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = req.user?.branch?.uid;
		return this.productsService.createProduct(createProductDto, orgId, branchId);
	}

	@Post('bulk')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '📦 Create multiple products in bulk',
		description: `
# Bulk Create Products

Create multiple products at once with transaction support to ensure data consistency.

## Features
- ✅ **Transaction Support**: All products are created within a single transaction
- ✅ **Individual Error Tracking**: Failed products don't affect successful ones
- ✅ **Batch Limit**: Maximum 100 products per request for performance
- ✅ **Analytics Creation**: Automatically creates analytics records for each product
- ✅ **Cache Management**: Invalidates relevant caches after successful creation
- ✅ **Event Emission**: Triggers bulk creation events for real-time updates

## Usage
Send an array of product objects in the request body. Each product must contain all required fields.

## Response
Returns detailed results including:
- Total requested vs created counts
- Success rate percentage
- Individual product results with error details
- Processing duration

## Limits
- Minimum: 1 product
- Maximum: 100 products per request
- Products with validation errors will be skipped
- Successful products will still be created if some fail

## Organization & Branch
Products will be automatically associated with the authenticated user's organization and branch.
		`,
	})
	@ApiBody({
		type: BulkCreateProductDto,
		description: 'Array of products to create with optional organization and branch IDs',
		examples: {
			'Electronics Store': {
				summary: 'Create electronics products with detailed specifications',
				value: {
					orgId: 1,
					branchId: 1,
					products: [
						{
							name: 'iPhone 15 Pro Max 256GB Natural Titanium',
							description: 'Latest flagship iPhone with A17 Pro chip, titanium design, advanced camera system with 5x telephoto zoom, and USB-C. Perfect for professionals and tech enthusiasts.',
							category: 'ELECTRONICS',
							price: 23999.00,
							salePrice: 21999.00,
							discount: 8.3,
							barcode: '194253000001',
							sku: 'IPH15PM-256GB-NT',
							productReferenceCode: 'APPLE-IPH15PM-256-NT-001',
							brand: 'Apple',
							weight: 0.221,
							packageQuantity: 1,
							packageUnit: 'unit',
							stockQuantity: 25,
							reorderPoint: 5,
							warehouseLocation: 'A1-B2-S3',
							isOnPromotion: true,
							promotionStartDate: '2024-01-15T00:00:00Z',
							promotionEndDate: '2024-02-14T23:59:59Z',
							packageDetails: 'Includes iPhone, USB-C to Lightning cable, documentation'
						},
						{
							name: 'Samsung Galaxy S24 Ultra 512GB Titanium Black',
							description: 'Premium Android flagship with S Pen, 200MP camera, AI features, and titanium frame. Built-in S Pen for productivity and creativity.',
							category: 'ELECTRONICS',
							price: 24999.00,
							salePrice: 22499.00,
							discount: 10.0,
							barcode: '887276798001',
							sku: 'SGS24U-512GB-TB',
							productReferenceCode: 'SAMSUNG-SGS24U-512-TB-001',
							brand: 'Samsung',
							weight: 0.233,
							packageQuantity: 1,
							packageUnit: 'unit',
							stockQuantity: 18,
							reorderPoint: 3,
							warehouseLocation: 'A1-B3-S1',
							isOnPromotion: true,
							promotionStartDate: '2024-01-10T00:00:00Z',
							promotionEndDate: '2024-02-29T23:59:59Z',
							packageDetails: 'Includes phone, S Pen, USB-C cable, SIM ejector, documentation'
						},
						{
							name: 'MacBook Pro 16" M3 Pro 18GB/512GB Space Black',
							description: 'Professional laptop with M3 Pro chip, 16-inch Liquid Retina XDR display, 18GB unified memory, and 512GB SSD. Perfect for content creators and developers.',
							category: 'ELECTRONICS',
							price: 49999.00,
							salePrice: 47499.00,
							discount: 5.0,
							barcode: '195949593001',
							sku: 'MBP16-M3P-18-512-SB',
							productReferenceCode: 'APPLE-MBP16-M3P-18-512-SB-001',
							brand: 'Apple',
							weight: 2.14,
							packageQuantity: 1,
							packageUnit: 'unit',
							stockQuantity: 8,
							reorderPoint: 2,
							warehouseLocation: 'B2-C1-S2',
							isOnPromotion: true,
							promotionStartDate: '2024-01-20T00:00:00Z',
							promotionEndDate: '2024-03-15T23:59:59Z',
							packageDetails: 'Includes MacBook Pro, 140W USB-C Power Adapter, USB-C to MagSafe 3 Cable'
						}
					]
				}
			},
			'Grocery Store': {
				summary: 'Create grocery and food products with nutritional info',
				value: {
					orgId: 2,
					branchId: 3,
					products: [
						{
							name: 'Premium Grade A Beef Ribeye Steak 400g',
							description: 'Premium grass-fed beef ribeye steak, aged for 21 days for optimal tenderness and flavor. Perfect marbling for grilling or pan-searing.',
							category: 'MEAT_POULTRY',
							price: 189.99,
							salePrice: 169.99,
							discount: 10.5,
							barcode: '612345678901',
							sku: 'BEEF-RIBEYE-400G',
							productReferenceCode: 'MEAT-BEEF-RIBEYE-400-001',
							brand: 'LORO CORP Premium Meats',
							weight: 0.4,
							packageQuantity: 1,
							packageUnit: 'pack',
							stockQuantity: 45,
							reorderPoint: 10,
							warehouseLocation: 'COLD-A1-S1',
							isOnPromotion: true,
							promotionStartDate: '2024-01-01T00:00:00Z',
							promotionEndDate: '2024-01-31T23:59:59Z',
							packageDetails: 'Vacuum sealed, best before date printed on package'
						},
						{
							name: 'Organic Full Cream Milk 2L Fresh Daily',
							description: 'Fresh organic full cream milk from free-range cows. Rich in calcium, protein, and vitamins. No artificial additives or preservatives.',
							category: 'DAIRY',
							price: 34.99,
							barcode: '612345678902',
							sku: 'MILK-ORGANIC-2L',
							productReferenceCode: 'DAIRY-MILK-ORG-2L-001',
							brand: 'LORO CORP Organic Dairy',
							weight: 2.1,
							packageQuantity: 6,
							packageUnit: 'carton',
							stockQuantity: 120,
							reorderPoint: 25,
							warehouseLocation: 'COLD-B2-S3',
							packageDetails: 'Recyclable carton packaging, refrigerate after opening'
						},
						{
							name: 'Artisan Sourdough Bread 800g Freshly Baked',
							description: 'Traditional sourdough bread made with organic flour and natural starter. Slow-fermented for 24 hours for complex flavor and easier digestion.',
							category: 'BAKERY',
							price: 24.99,
							salePrice: 19.99,
							discount: 20.0,
							barcode: '612345678903',
							sku: 'BREAD-SOURDOUGH-800G',
							productReferenceCode: 'BAKERY-BREAD-SOUR-800-001',
							brand: 'LORO CORP Artisan Bakery',
							weight: 0.8,
							packageQuantity: 12,
							packageUnit: 'loaf',
							stockQuantity: 30,
							reorderPoint: 8,
							warehouseLocation: 'DRY-C1-S2',
							isOnPromotion: true,
							promotionStartDate: '2024-01-15T00:00:00Z',
							promotionEndDate: '2024-01-21T23:59:59Z',
							packageDetails: 'Paper bag packaging, best consumed within 3 days'
						}
					]
				}
			},
			'Fashion & Accessories': {
				summary: 'Create fashion products with detailed specifications',
				value: {
					products: [
						{
							name: 'Premium Cotton Business Shirt - Slim Fit White XL',
							description: 'Professional slim-fit business shirt made from 100% premium Egyptian cotton. Wrinkle-resistant with mother-of-pearl buttons and French seams.',
							category: 'FASHION',
							price: 299.99,
							salePrice: 249.99,
							discount: 16.7,
							barcode: '987654321001',
							sku: 'SHIRT-COTTON-SF-WH-XL',
							productReferenceCode: 'FASHION-SHIRT-COTTON-SF-WH-XL-001',
							brand: 'LORO CORP Executive Wear',
							weight: 0.25,
							packageQuantity: 20,
							packageUnit: 'piece',
							stockQuantity: 35,
							reorderPoint: 8,
							warehouseLocation: 'F1-A2-S4',
							isOnPromotion: true,
							promotionStartDate: '2024-01-10T00:00:00Z',
							promotionEndDate: '2024-02-10T23:59:59Z',
							packageDetails: 'Includes collar stays, care instructions, size chart'
						},
						{
							name: 'Genuine Leather Executive Briefcase Brown',
							description: 'Handcrafted executive briefcase made from full-grain Italian leather. Features multiple compartments, padded laptop section, and brass hardware.',
							category: 'ACCESSORIES',
							price: 1299.99,
							salePrice: 999.99,
							discount: 23.1,
							barcode: '987654321002',
							sku: 'BRIEFCASE-LEATHER-BR',
							productReferenceCode: 'ACC-BRIEFCASE-LEATHER-BR-001',
							brand: 'LORO CORP Luxury Goods',
							weight: 1.8,
							packageQuantity: 5,
							packageUnit: 'piece',
							stockQuantity: 12,
							reorderPoint: 3,
							warehouseLocation: 'F2-B1-S1',
							isOnPromotion: true,
							promotionStartDate: '2024-01-05T00:00:00Z',
							promotionEndDate: '2024-02-28T23:59:59Z',
							packageDetails: 'Includes dust bag, care instructions, warranty card'
						}
					]
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Bulk creation completed successfully',
		schema: {
			type: 'object',
			properties: {
				totalRequested: { type: 'number', example: 5 },
				totalCreated: { type: 'number', example: 4 },
				totalFailed: { type: 'number', example: 1 },
				successRate: { type: 'number', example: 80.0 },
				results: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							product: { type: 'object', description: 'Created product data or null if failed' },
							success: { type: 'boolean', example: true },
							error: { type: 'string', example: 'Validation error message' },
							index: { type: 'number', example: 0 },
							sku: { type: 'string', example: 'SKU001' },
							name: { type: 'string', example: 'Product Name' }
						}
					}
				},
				message: { type: 'string', example: 'Bulk creation completed: 4 products created, 1 failed' },
				errors: { 
					type: 'array', 
					items: { type: 'string' },
					example: ['Product 3 (Invalid SKU): SKU already exists']
				},
				duration: { type: 'number', example: 1250 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid bulk creation data',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'array',
					items: { type: 'string' },
					example: [
						'products must contain at least 1 element',
						'products must contain no more than 100 elements'
					]
				},
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiUnprocessableEntityResponse({
		description: '⚠️ Some validation errors occurred',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Some products failed validation' },
				statusCode: { type: 'number', example: 422 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Internal server error during bulk creation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Database transaction failed' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async createBulkProducts(@Body() bulkCreateProductDto: BulkCreateProductDto, @Req() req: AuthenticatedRequest) {
		if (!bulkCreateProductDto.orgId) {
			bulkCreateProductDto.orgId = await this.resolveOrgUid(req);
		}
		if (!bulkCreateProductDto.branchId) {
			bulkCreateProductDto.branchId = req.user?.branch?.uid;
		}
		return this.productsService.createBulkProducts(bulkCreateProductDto);
	}

	@Patch('bulk')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.OWNER,
	)
	@ApiOperation({
		summary: '📝 Update multiple products in bulk',
		description: `
# Bulk Update Products

Update multiple products at once with transaction support to ensure data consistency.

## Features
- ✅ **Transaction Support**: All updates are processed within a single transaction
- ✅ **Individual Error Tracking**: Failed updates don't affect successful ones
- ✅ **Batch Limit**: Maximum 100 products per request for performance
- ✅ **History Tracking**: Automatically tracks price and stock changes
- ✅ **Cache Management**: Invalidates relevant caches after successful updates
- ✅ **Event Emission**: Triggers bulk update events for real-time updates

## Usage
Send an array of update objects, each containing a product reference ID and the data to update.

## Response
Returns detailed results including:
- Total requested vs updated counts
- Success rate percentage
- Individual update results with error details
- List of updated fields for each product
- Processing duration

## Limits
- Minimum: 1 product update
- Maximum: 100 product updates per request
- Only existing, non-deleted products can be updated
- Invalid product IDs will be skipped with error details

## Field Updates
Any fields from the UpdateProductDto can be updated:
- Basic info (name, description, category)
- Pricing (price, salePrice, discount)
- Inventory (stockQuantity, reorderPoint)
- Product details (brand, weight, dimensions, etc.)
		`,
	})
	@ApiBody({
		type: BulkUpdateProductDto,
		description: 'Array of product updates with reference IDs and update data',
		examples: {
			'Seasonal Pricing Update': {
				summary: 'Update multiple product prices for seasonal sale',
				value: {
					updates: [
						{
							ref: 123,
							data: {
								name: 'iPhone 15 Pro Max 256GB Natural Titanium - Winter Sale',
								price: 23999.00,
								salePrice: 19999.00,
								discount: 16.7,
								stockQuantity: 35,
								isOnPromotion: true,
								promotionStartDate: '2024-12-01T00:00:00Z',
								promotionEndDate: '2024-12-31T23:59:59Z'
							}
						},
						{
							ref: 124,
							data: {
								name: 'Samsung Galaxy S24 Ultra 512GB - Holiday Special',
								price: 24999.00,
								salePrice: 21999.00,
								discount: 12.0,
								stockQuantity: 22,
								reorderPoint: 5,
								isOnPromotion: true,
								promotionStartDate: '2024-12-01T00:00:00Z',
								promotionEndDate: '2024-12-31T23:59:59Z'
							}
						},
						{
							ref: 125,
							data: {
								name: 'MacBook Pro 16" M3 Pro - Black Friday Deal',
								price: 49999.00,
								salePrice: 44999.00,
								discount: 10.0,
								stockQuantity: 15,
								isOnPromotion: true,
								promotionStartDate: '2024-11-24T00:00:00Z',
								promotionEndDate: '2024-11-30T23:59:59Z'
							}
						}
					]
				}
			},
			'Inventory Restocking': {
				summary: 'Update stock levels and warehouse locations',
				value: {
					updates: [
						{
							ref: 201,
							data: {
								stockQuantity: 150,
								reorderPoint: 30,
								warehouseLocation: 'COLD-A1-S2',
								packageQuantity: 24
							}
						},
						{
							ref: 202,
							data: {
								stockQuantity: 85,
								reorderPoint: 15,
								warehouseLocation: 'DRY-B3-S1',
								weight: 0.85
							}
						},
						{
							ref: 203,
							data: {
								stockQuantity: 200,
								reorderPoint: 40,
								warehouseLocation: 'COLD-B2-S4',
								packageDetails: 'New vacuum-sealed packaging with extended shelf life'
							}
						}
					]
				}
			},
			'Product Information Update': {
				summary: 'Update product descriptions and specifications',
				value: {
					updates: [
						{
							ref: 301,
							data: {
								name: 'Premium Grade A+ Beef Ribeye Steak 450g - Grass Fed',
								description: 'Premium grass-fed beef ribeye steak, aged for 28 days for exceptional tenderness and flavor. Now with improved marbling and certified organic feed.',
								weight: 0.45,
								brand: 'LORO CORP Premium Organic Meats',
								packageDetails: 'Vacuum sealed with freshness indicator, grass-fed certification included'
							}
						},
						{
							ref: 302,
							data: {
								name: 'Artisan Sourdough Bread 900g - Whole Grain',
								description: 'Traditional whole grain sourdough bread made with organic spelt flour and ancient grains. Slow-fermented for 36 hours for enhanced digestibility and complex flavor profile.',
								weight: 0.9,
								category: 'BAKERY',
								brand: 'LORO CORP Artisan Whole Foods',
								packageDetails: 'Compostable packaging, contains nuts and seeds, best consumed within 5 days'
							}
						}
					]
				}
			},
			'End of Season Clearance': {
				summary: 'Update products for clearance sale',
				value: {
					updates: [
						{
							ref: 401,
							data: {
								name: 'Premium Cotton Business Shirt - Clearance Sale',
								salePrice: 199.99,
								discount: 33.3,
								isOnPromotion: true,
								promotionStartDate: '2024-08-01T00:00:00Z',
								promotionEndDate: '2024-08-31T23:59:59Z',
								stockQuantity: 15
							}
						},
						{
							ref: 402,
							data: {
								name: 'Leather Executive Briefcase - Final Clearance',
								salePrice: 699.99,
								discount: 46.2,
								isOnPromotion: true,
								promotionStartDate: '2024-08-01T00:00:00Z',
								promotionEndDate: '2024-08-31T23:59:59Z',
								stockQuantity: 5,
								reorderPoint: 0
							}
						}
					]
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Bulk update completed successfully',
		schema: {
			type: 'object',
			properties: {
				totalRequested: { type: 'number', example: 5 },
				totalUpdated: { type: 'number', example: 4 },
				totalFailed: { type: 'number', example: 1 },
				successRate: { type: 'number', example: 80.0 },
				results: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							ref: { type: 'number', example: 123 },
							success: { type: 'boolean', example: true },
							error: { type: 'string', example: 'Product not found' },
							index: { type: 'number', example: 0 },
							name: { type: 'string', example: 'Product Name' },
							updatedFields: { 
								type: 'array',
								items: { type: 'string' },
								example: ['price', 'stockQuantity']
							}
						}
					}
				},
				message: { type: 'string', example: 'Bulk update completed: 4 products updated, 1 failed' },
				errors: { 
					type: 'array', 
					items: { type: 'string' },
					example: ['Product ID 999: Product not found']
				},
				duration: { type: 'number', example: 850 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid bulk update data',
		schema: {
			type: 'object',
			properties: {
				message: { 
					type: 'array',
					items: { type: 'string' },
					example: [
						'updates must contain at least 1 element',
						'updates must contain no more than 100 elements'
					]
				},
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 }
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 Some products not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Some products could not be found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Internal server error during bulk update',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Database transaction failed' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async updateBulkProducts(@Body() bulkUpdateProductDto: BulkUpdateProductDto, @Req() req: AuthenticatedRequest) {
		return this.productsService.updateBulkProducts(bulkUpdateProductDto);
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
		summary: '📋 Get paginated list of products',
		description: `
# Get Products

Retrieves a paginated list of products with comprehensive filtering and sorting capabilities.

## 📋 **Features**
- **Pagination**: Efficient page-based navigation through large product catalogs
- **Filtering**: Filter by category, status, price range, stock levels
- **Sorting**: Sort by name, price, creation date, stock quantity
- **Search**: Full-text search across product names and descriptions
- **Performance**: Optimized queries with caching for fast response times

## 🔍 **Search Capabilities**
- Product name and description search
- SKU and barcode lookup
- Category-based filtering
- Price range filtering
- Stock availability filtering

## 📊 **Response Format**
- Paginated results with metadata
- Product summary information
- Stock levels and availability
- Pricing information
- Category and tagging data

## 🎯 **Use Cases**
- Product catalog browsing
- Inventory management dashboards
- E-commerce product listings
- Stock level monitoring
- Price comparison tools
		`
	})
	@ApiQuery({ 
		name: 'page', 
		type: Number, 
		required: false, 
		description: '📄 Page number for pagination (starts from 1)',
		example: 1
	})
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: '📏 Number of products per page (max 100)',
		example: 20
	})
	@ApiQuery({
		name: 'search',
		type: String,
		required: false,
		description: '🔍 Search term for product names and descriptions',
		example: 'iPhone Pro'
	})
	@ApiQuery({
		name: 'category',
		type: String,
		required: false,
		description: '📂 Filter by product category',
		example: 'ELECTRONICS'
	})
	@ApiQuery({
		name: 'minPrice',
		type: Number,
		required: false,
		description: '💰 Minimum price filter',
		example: 100
	})
	@ApiQuery({
		name: 'maxPrice',
		type: Number,
		required: false,
		description: '💰 Maximum price filter',
		example: 1000
	})
	@ApiQuery({
		name: 'inStock',
		type: Boolean,
		required: false,
		description: '📦 Filter by stock availability',
		example: true
	})
	@ApiQuery({
		name: 'sortBy',
		type: String,
		required: false,
		description: '📊 Sort field (name, price, createdAt, stockQuantity)',
		example: 'name'
	})
	@ApiQuery({
		name: 'sortOrder',
		type: String,
		required: false,
		description: '🔄 Sort order (asc, desc)',
		example: 'asc'
	})
	@ApiQuery({
		name: 'brand',
		type: String,
		required: false,
		description: '🏷️ Filter by product brand',
		example: 'Apple'
	})
	@ApiQuery({
		name: 'sku',
		type: String,
		required: false,
		description: '🔖 Filter by SKU (exact match)',
		example: 'IPH15PM-256GB-NT'
	})
	@ApiQuery({
		name: 'barcode',
		type: String,
		required: false,
		description: '📊 Filter by barcode (exact match)',
		example: '194253000001'
	})
	@ApiQuery({
		name: 'onPromotion',
		type: Boolean,
		required: false,
		description: '🎯 Filter by promotion status',
		example: true
	})
	@ApiQuery({
		name: 'lowStock',
		type: Boolean,
		required: false,
		description: '⚠️ Filter products with low stock (below reorder point)',
		example: true
	})
	@ApiQuery({
		name: 'stockQuantity',
		type: Number,
		required: false,
		description: '📦 Minimum stock quantity filter',
		example: 10
	})
	@ApiQuery({
		name: 'material',
		type: String,
		required: false,
		description: '🧱 Filter by product material',
		example: 'Cotton'
	})
	@ApiQuery({
		name: 'color',
		type: String,
		required: false,
		description: '🎨 Filter by product color',
		example: 'Blue'
	})
	@ApiQuery({
		name: 'origin',
		type: String,
		required: false,
		description: '🌍 Filter by country of origin',
		example: 'Germany'
	})
	@ApiQuery({
		name: 'manufacturer',
		type: String,
		required: false,
		description: '🏭 Filter by manufacturer',
		example: 'Apple Inc.'
	})
	@ApiQuery({
		name: 'isFragile',
		type: Boolean,
		required: false,
		description: '💥 Filter by fragile products',
		example: true
	})
	@ApiQuery({
		name: 'requiresSpecialHandling',
		type: Boolean,
		required: false,
		description: '🔧 Filter by special handling requirement',
		example: true
	})
	@ApiQuery({
		name: 'minRating',
		type: Number,
		required: false,
		description: '⭐ Minimum rating filter (1-5)',
		example: 4.0
	})
	@ApiQuery({
		name: 'minReviewCount',
		type: Number,
		required: false,
		description: '💬 Minimum review count filter',
		example: 100
	})
	@ApiQuery({
		name: 'dateCreatedFrom',
		type: String,
		required: false,
		description: '📅 Filter products created from date (YYYY-MM-DD)',
		example: '2024-01-01'
	})
	@ApiQuery({
		name: 'dateCreatedTo',
		type: String,
		required: false,
		description: '📅 Filter products created to date (YYYY-MM-DD)',
		example: '2024-12-31'
	})
	@ApiQuery({
		name: 'includeAnalytics',
		type: Boolean,
		required: false,
		description: '📊 Include product analytics in response',
		example: true
	})
	@ApiQuery({
		name: 'packageUnit',
		type: String,
		required: false,
		description: '📦 Filter by package unit type',
		example: 'piece'
	})
	@ApiQuery({
		name: 'hasDiscount',
		type: Boolean,
		required: false,
		description: '💰 Filter products with discount',
		example: true
	})
	@ApiQuery({
		name: 'warrantyPeriod',
		type: Number,
		required: false,
		description: '🛡️ Minimum warranty period (in months)',
		example: 12
	})
	@ApiQuery({
		name: 'tags',
		type: String,
		required: false,
		description: '🏷️ Filter by comma-separated tags',
		example: 'premium,smartphone'
	})
	@ApiQuery({
		name: 'exclude',
		type: String,
		required: false,
		description: '🚫 Exclude products by comma-separated IDs',
		example: '123,456,789'
	})
	@ApiQuery({
		name: 'fields',
		type: String,
		required: false,
		description: '📋 Comma-separated fields to include in response',
		example: 'uid,name,price,stockQuantity'
	})
	@ApiOkResponse({
		description: '✅ Products retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Products retrieved successfully' },
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 12345 },
							name: { type: 'string', example: 'iPhone 15 Pro Max' },
							description: { type: 'string', example: 'Latest Apple smartphone with titanium design, A17 Pro chip, and advanced camera system' },
							category: { type: 'string', example: 'ELECTRONICS' },
							price: { type: 'number', example: 1199.99 },
							salePrice: { type: 'number', example: 1099.99 },
							discount: { type: 'number', example: 8.33 },
							sku: { type: 'string', example: 'IPH15PM-256GB-NT' },
							barcode: { type: 'string', example: '194253000001' },
							stockQuantity: { type: 'number', example: 50 },
							reorderPoint: { type: 'number', example: 10 },
							brand: { type: 'string', example: 'Apple' },
							manufacturer: { type: 'string', example: 'Apple Inc.' },
							model: { type: 'string', example: 'A3108' },
							color: { type: 'string', example: 'Natural Titanium' },
							material: { type: 'string', example: 'Titanium' },
							weight: { type: 'number', example: 0.221 },
							dimensions: { type: 'string', example: '159.9mm x 76.7mm x 8.25mm' },
							packageQuantity: { type: 'number', example: 1 },
							packageUnit: { type: 'string', example: 'piece' },
							isOnPromotion: { type: 'boolean', example: true },
							promotionStartDate: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00Z' },
							promotionEndDate: { type: 'string', format: 'date-time', example: '2024-12-31T23:59:59Z' },
							warrantyPeriod: { type: 'number', example: 12 },
							warrantyUnit: { type: 'string', example: 'months' },
							rating: { type: 'number', example: 4.8 },
							reviewCount: { type: 'number', example: 2450 },
							origin: { type: 'string', example: 'China' },
							isFragile: { type: 'boolean', example: true },
							requiresSpecialHandling: { type: 'boolean', example: false },
							storageConditions: { type: 'string', example: 'Store in cool, dry place. Temperature: 0-35°C' },
							minimumOrderQuantity: { type: 'number', example: 1 },
							bulkDiscountPercentage: { type: 'number', example: 5.0 },
							bulkDiscountMinQty: { type: 'number', example: 10 },
							specifications: { type: 'string', example: 'Display: 6.7" Super Retina XDR, Chip: A17 Pro, Storage: 256GB' },
							features: { type: 'string', example: 'Face ID, 5G, Wireless Charging, Water Resistant IP68' },
							imageUrl: { type: 'string', example: 'https://example.com/images/iphone15promax.jpg' },
							createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
							updatedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
							analytics: {
								type: 'object',
								properties: {
									totalViews: { type: 'number', example: 1250 },
									totalSales: { type: 'number', example: 45 },
									totalRevenue: { type: 'number', example: 44999.55 },
									conversionRate: { type: 'number', example: 3.6 },
									averageRating: { type: 'number', example: 4.8 },
									returnRate: { type: 'number', example: 2.1 },
									profitMargin: { type: 'number', example: 35.5 }
								}
							}
						}
					}
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 150, description: 'Total number of products' },
						page: { type: 'number', example: 1, description: 'Current page number' },
						limit: { type: 'number', example: 20, description: 'Products per page' },
						totalPages: { type: 'number', example: 8, description: 'Total number of pages' },
						hasNextPage: { type: 'boolean', example: true, description: 'Whether there are more pages' },
						hasPreviousPage: { type: 'boolean', example: false, description: 'Whether there are previous pages' },
						currentFilters: {
							type: 'object',
							properties: {
								category: { type: 'string', example: 'ELECTRONICS' },
								brand: { type: 'string', example: 'Apple' },
								priceRange: { 
									type: 'object',
									properties: {
										min: { type: 'number', example: 100 },
										max: { type: 'number', example: 2000 }
									}
								},
								inStock: { type: 'boolean', example: true },
								onPromotion: { type: 'boolean', example: true },
								minRating: { type: 'number', example: 4.0 }
							}
						}
					}
				},
				filters: {
					type: 'object',
					properties: {
						availableCategories: {
							type: 'array',
							items: { type: 'string' },
							example: ['ELECTRONICS', 'CLOTHING', 'BOOKS', 'BEAUTY', 'AUTOMOTIVE', 'HEALTHCARE', 'INDUSTRIAL', 'SERVICES', 'SOFTWARE']
						},
						availableBrands: {
							type: 'array',
							items: { type: 'string' },
							example: ['Apple', 'Samsung', 'Google', 'Microsoft', 'Sony']
						},
						availableColors: {
							type: 'array',
							items: { type: 'string' },
							example: ['Black', 'White', 'Blue', 'Red', 'Natural Titanium']
						},
						availableMaterials: {
							type: 'array',
							items: { type: 'string' },
							example: ['Titanium', 'Aluminum', 'Steel', 'Plastic', 'Glass']
						},
						priceRange: {
							type: 'object',
							properties: {
								min: { type: 'number', example: 1.99 },
								max: { type: 'number', example: 2999.99 }
							}
						},
						stockRange: {
							type: 'object',
							properties: {
								min: { type: 'number', example: 0 },
								max: { type: 'number', example: 5000 }
							}
						},
						statistics: {
							type: 'object',
							properties: {
								totalProducts: { type: 'number', example: 1534 },
								inStockProducts: { type: 'number', example: 1421 },
								onPromotionProducts: { type: 'number', example: 234 },
								lowStockProducts: { type: 'number', example: 45 },
								averagePrice: { type: 'number', example: 156.78 },
								averageRating: { type: 'number', example: 4.3 }
							}
						}
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid query parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid pagination parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Page number must be greater than 0',
						'Limit must be between 1 and 100',
						'Invalid sort field specified'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view products in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Unexpected system error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while retrieving products' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async products(@Query() query: PaginationQuery, @Req() req: AuthenticatedRequest) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = req.user?.branch?.uid;
		return this.productsService.products(query.page, query.limit, orgId, branchId);
	}

	@Get('category/:category')
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
		summary: '📂 Get products by category',
		description: `
# Get Products by Category

Retrieves a paginated list of products that belong to a specific category with advanced filtering and search capabilities.

## 📋 **Category-Based Filtering**
- **Electronics**: Smartphones, laptops, accessories, gadgets
- **Clothing**: Apparel, shoes, accessories, seasonal wear
- **Books**: Educational, fiction, technical, reference materials
- **Beauty**: Skincare, makeup, fragrances, personal care
- **Automotive**: Parts, accessories, tools, maintenance items
- **Healthcare**: Medical devices, supplements, wellness products
- **Industrial**: Equipment, tools, machinery, raw materials
- **Services**: Professional services, consultations, subscriptions
- **Software**: Applications, licenses, digital products

## 🔍 **Advanced Search Features**
- **Full-text Search**: Search across product names and descriptions
- **Price Range Filtering**: Filter products by price ranges
- **Brand Filtering**: Filter by specific brands within the category
- **Stock Availability**: Show only in-stock items
- **Promotion Status**: Filter by promotional products
- **Rating Filtering**: Filter by customer ratings
- **Sort Options**: Name, price, popularity, newest, rating

## 📊 **Pagination & Performance**
- Efficient pagination with configurable page sizes
- Optimized database queries for large catalogs
- Cached category data for improved performance
- Real-time stock level updates
- Mobile-optimized response sizes

## 🎯 **Use Cases**
- **E-commerce Browsing**: Category-based product exploration
- **Inventory Management**: Category-wise stock monitoring
- **Sales Analysis**: Category performance tracking
- **Mobile Applications**: Category-based product listings
- **Third-party Integrations**: Category data synchronization
- **Marketing Campaigns**: Category-specific promotions

## 📱 **Response Optimization**
- Essential product information for listings
- Optimized image URLs for different screen sizes
- Minimal data transfer for mobile devices
- Lazy loading support for large catalogs
		`
	})
	@ApiParam({ 
		name: 'category', 
		description: '📂 Category name or identifier to filter products', 
		type: 'string',
		examples: {
			electronics: {
				summary: 'Electronics Category',
				description: 'Get all electronics products',
				value: 'ELECTRONICS'
			},
			clothing: {
				summary: 'Clothing Category',
				description: 'Get all clothing products',
				value: 'CLOTHING'
			},
			books: {
				summary: 'Books Category',
				description: 'Get all book products',
				value: 'BOOKS'
			},
			beauty: {
				summary: 'Beauty Category',
				description: 'Get all beauty products',
				value: 'BEAUTY'
			},
			automotive: {
				summary: 'Automotive Category',
				description: 'Get all automotive products',
				value: 'AUTOMOTIVE'
			}
		}
	})
	@ApiQuery({ 
		name: 'page', 
		type: Number, 
		required: false, 
		description: '📄 Page number for pagination (starts from 1)', 
		example: 1
	})
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: '📏 Number of products per page (max 100)',
		example: 20
	})
	@ApiQuery({ 
		name: 'search', 
		type: String, 
		required: false, 
		description: '🔍 Search term for filtering products within the category',
		example: 'iPhone Pro'
	})
	@ApiQuery({
		name: 'sortBy',
		type: String,
		required: false,
		description: '📊 Sort field (name, price, createdAt, rating)',
		example: 'name'
	})
	@ApiQuery({
		name: 'sortOrder',
		type: String,
		required: false,
		description: '🔄 Sort order (asc, desc)',
		example: 'asc'
	})
	@ApiQuery({
		name: 'minPrice',
		type: Number,
		required: false,
		description: '💰 Minimum price filter',
		example: 100
	})
	@ApiQuery({
		name: 'maxPrice',
		type: Number,
		required: false,
		description: '💰 Maximum price filter',
		example: 1000
	})
	@ApiQuery({
		name: 'inStock',
		type: Boolean,
		required: false,
		description: '📦 Filter by stock availability',
		example: true
	})
	@ApiQuery({
		name: 'brand',
		type: String,
		required: false,
		description: '🏷️ Filter by product brand',
		example: 'Apple'
	})
	@ApiQuery({
		name: 'onPromotion',
		type: Boolean,
		required: false,
		description: '🎯 Filter by promotion status',
		example: true
	})
	@ApiQuery({
		name: 'minRating',
		type: Number,
		required: false,
		description: '⭐ Minimum rating filter (1-5)',
		example: 4.0
	})
	@ApiOkResponse({
		description: '✅ Products retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Products retrieved successfully' },
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 12345, description: 'Unique product identifier' },
							name: { type: 'string', example: 'iPhone 15 Pro Max', description: 'Product name' },
							description: { type: 'string', example: 'Latest Apple smartphone with titanium design', description: 'Product description' },
							category: { type: 'string', example: 'ELECTRONICS', description: 'Product category' },
							price: { type: 'number', example: 1199.99, description: 'Regular selling price' },
							salePrice: { type: 'number', example: 1099.99, description: 'Current sale price if on promotion' },
							discount: { type: 'number', example: 8.33, description: 'Discount percentage' },
							sku: { type: 'string', example: 'IPH15PM-256GB-NT', description: 'Stock Keeping Unit' },
							barcode: { type: 'string', example: '194253000001', description: 'Product barcode' },
							brand: { type: 'string', example: 'Apple', description: 'Product brand' },
							stockQuantity: { type: 'number', example: 50, description: 'Current stock level' },
							isOnPromotion: { type: 'boolean', example: true, description: 'Whether product is on promotion' },
							rating: { type: 'number', example: 4.8, description: 'Average customer rating' },
							reviewCount: { type: 'number', example: 2450, description: 'Total number of reviews' },
							imageUrl: { type: 'string', example: 'https://example.com/images/iphone15promax.jpg', description: 'Primary product image URL' },
							createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z', description: 'Creation timestamp' },
							updatedAt: { type: 'string', format: 'date-time', example: '2023-12-15T14:30:00Z', description: 'Last update timestamp' }
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 150, description: 'Total number of products in category' },
						page: { type: 'number', example: 1, description: 'Current page number' },
						limit: { type: 'number', example: 20, description: 'Products per page' },
						totalPages: { type: 'number', example: 8, description: 'Total number of pages' },
						hasNextPage: { type: 'boolean', example: true, description: 'Whether there are more pages' },
						hasPreviousPage: { type: 'boolean', example: false, description: 'Whether there are previous pages' },
						category: { type: 'string', example: 'ELECTRONICS', description: 'Current category filter' },
						searchTerm: { type: 'string', example: 'iPhone Pro', description: 'Applied search term' },
						filters: {
							type: 'object',
							properties: {
								priceRange: { 
									type: 'object',
									properties: {
										min: { type: 'number', example: 100 },
										max: { type: 'number', example: 2000 }
									}
								},
								brand: { type: 'string', example: 'Apple' },
								inStock: { type: 'boolean', example: true },
								onPromotion: { type: 'boolean', example: true },
								minRating: { type: 'number', example: 4.0 }
							}
						}
					},
				},
				categoryInfo: {
					type: 'object',
					properties: {
						name: { type: 'string', example: 'ELECTRONICS', description: 'Category name' },
						description: { type: 'string', example: 'Electronic devices and accessories', description: 'Category description' },
						productCount: { type: 'number', example: 150, description: 'Total products in category' },
						averagePrice: { type: 'number', example: 456.78, description: 'Average price in category' },
						averageRating: { type: 'number', example: 4.3, description: 'Average rating in category' },
						topBrands: {
							type: 'array',
							items: { type: 'string' },
							example: ['Apple', 'Samsung', 'Google', 'Microsoft'],
							description: 'Most popular brands in category'
						}
					}
				}
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ No products found in this category',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No products found in category ELECTRONICS' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				data: { type: 'array', items: {}, example: [] },
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 0 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 20 },
						totalPages: { type: 'number', example: 0 },
						category: { type: 'string', example: 'ELECTRONICS' }
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid category or parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid category or query parameters' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Category cannot be empty',
						'Page number must be greater than 0',
						'Limit must be between 1 and 100',
						'Invalid price range specified'
					]
				}
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view products in this category' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Unexpected system error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while retrieving products' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async productsByCategory(
		@Param('category') category: string,
		@Query('page') page: number = 1,
		@Query('limit') limit: number = 20,
		@Query('search') search: string = '',
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = await this.resolveOrgUid(req);
		const branchId = req.user?.branch?.uid;
		return this.productsService.productsByCategory(category, page, limit, search, orgId, branchId);
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
		summary: '🔍 Get product by reference code',
		description: `
# Get Product by Reference

Retrieves comprehensive information about a specific product using its reference code or unique identifier.

## 🎯 **Use Cases**
- **Product Detail Pages**: Display complete product information
- **Inventory Management**: Check specific product details and stock levels
- **Order Processing**: Validate product information during checkout
- **Customer Support**: Lookup products for support inquiries
- **Mobile Applications**: Fetch product data for mobile displays
- **Third-party Integrations**: Retrieve product data for external systems

## 📋 **Product Information Included**
- **Basic Details**: Name, description, category, brand information
- **Pricing**: Current price, sale price, discount information
- **Inventory**: Stock levels, reorder points, availability status
- **Physical Properties**: Dimensions, weight, materials, colors
- **Business Data**: SKU, barcode, warranty, handling requirements
- **Analytics**: Performance metrics, ratings, review counts
- **Relationships**: Organization and branch associations

## 🔒 **Access Control**
- All authenticated users can view basic product information
- Detailed analytics require elevated permissions
- Pricing may vary based on user role and organization
- Client users see client-specific pricing and availability

## ⚡ **Performance Features**
- Cached responses for frequently accessed products
- Optimized queries for fast retrieval
- Minimal data transfer for mobile applications
- Real-time stock level validation
		`
	})
	@ApiParam({ 
		name: 'ref', 
		description: '🔖 Product reference code or unique identifier', 
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Product retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product retrieved successfully' },
				product: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345, description: 'Unique product identifier' },
						name: { type: 'string', example: 'iPhone 15 Pro Max', description: 'Product name' },
						description: { type: 'string', example: 'Latest Apple smartphone with titanium design, A17 Pro chip, and advanced camera system', description: 'Detailed product description' },
						category: { type: 'string', example: 'ELECTRONICS', description: 'Product category' },
						price: { type: 'number', example: 1199.99, description: 'Regular selling price' },
						salePrice: { type: 'number', example: 1099.99, description: 'Current sale price if on promotion' },
						discount: { type: 'number', example: 8.33, description: 'Discount percentage' },
						sku: { type: 'string', example: 'IPH15PM-256GB-NT', description: 'Stock Keeping Unit' },
						barcode: { type: 'string', example: '194253000001', description: 'Product barcode' },
						brand: { type: 'string', example: 'Apple', description: 'Product brand' },
						manufacturer: { type: 'string', example: 'Apple Inc.', description: 'Manufacturer name' },
						model: { type: 'string', example: 'A3108', description: 'Product model number' },
						color: { type: 'string', example: 'Natural Titanium', description: 'Product color' },
						material: { type: 'string', example: 'Titanium', description: 'Primary material' },
						weight: { type: 'number', example: 0.221, description: 'Product weight in kg' },
						dimensions: { type: 'string', example: '159.9mm x 76.7mm x 8.25mm', description: 'Product dimensions' },
						stockQuantity: { type: 'number', example: 50, description: 'Current stock level' },
						reorderPoint: { type: 'number', example: 10, description: 'Minimum stock before reorder' },
						packageQuantity: { type: 'number', example: 1, description: 'Quantity per package' },
						packageUnit: { type: 'string', example: 'piece', description: 'Package unit type' },
						isOnPromotion: { type: 'boolean', example: true, description: 'Whether product is on promotion' },
						promotionStartDate: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00Z', description: 'Promotion start date' },
						promotionEndDate: { type: 'string', format: 'date-time', example: '2024-12-31T23:59:59Z', description: 'Promotion end date' },
						warrantyPeriod: { type: 'number', example: 12, description: 'Warranty period' },
						warrantyUnit: { type: 'string', example: 'months', description: 'Warranty time unit' },
						rating: { type: 'number', example: 4.8, description: 'Average customer rating (1-5)' },
						reviewCount: { type: 'number', example: 2450, description: 'Total number of reviews' },
						origin: { type: 'string', example: 'China', description: 'Country of origin' },
						isFragile: { type: 'boolean', example: true, description: 'Whether product is fragile' },
						requiresSpecialHandling: { type: 'boolean', example: false, description: 'Whether special handling is required' },
						storageConditions: { type: 'string', example: 'Store in cool, dry place. Temperature: 0-35°C', description: 'Storage requirements' },
						minimumOrderQuantity: { type: 'number', example: 1, description: 'Minimum order quantity' },
						bulkDiscountPercentage: { type: 'number', example: 5.0, description: 'Bulk order discount percentage' },
						bulkDiscountMinQty: { type: 'number', example: 10, description: 'Minimum quantity for bulk discount' },
						specifications: { type: 'string', example: 'Display: 6.7" Super Retina XDR, Chip: A17 Pro, Storage: 256GB', description: 'Technical specifications' },
						features: { type: 'string', example: 'Face ID, 5G, Wireless Charging, Water Resistant IP68', description: 'Key product features' },
						imageUrl: { type: 'string', example: 'https://example.com/images/iphone15promax.jpg', description: 'Primary product image URL' },
						isActive: { type: 'boolean', example: true, description: 'Whether product is active' },
						createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z', description: 'Product creation timestamp' },
						updatedAt: { type: 'string', format: 'date-time', example: '2023-12-15T14:30:00Z', description: 'Last update timestamp' },
						organisation: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 1, description: 'Organization ID' },
								name: { type: 'string', example: 'Tech Solutions Ltd', description: 'Organization name' }
							},
							description: 'Associated organization'
						},
						branch: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 5, description: 'Branch ID' },
								name: { type: 'string', example: 'Main Store', description: 'Branch name' }
							},
							description: 'Associated branch'
						}
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with reference 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				product: { type: 'null', example: null }
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid reference code',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid product reference code format' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Reference code must be a positive number',
						'Reference code cannot be empty'
					]
				}
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view this product' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Unexpected system error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while retrieving the product' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async getProductByref(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = this.getClerkOrgIdString(req);
		const branchId = req.user?.branch?.uid;
		return this.productsService.getProductByref(ref, orgId, branchId);
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
		summary: '✏️ Update a product',
		description: `
# Update Product

Updates an existing product with the provided information. Supports partial updates - only the fields provided will be updated.

## 🔧 **Update Types**
- **Basic Info**: Update name, description, category
- **Pricing**: Update price, discount, promotion settings
- **Inventory**: Update stock quantity, reorder points
- **Metadata**: Update specifications, features, ratings
- **Physical Properties**: Update dimensions, weight, materials
- **Business Logic**: Update warranty, handling requirements

## 📝 **Partial Update Support**
- Only provide fields that need to be updated
- All other fields remain unchanged
- Validation only applies to provided fields
- Supports bulk operations with field filtering

## 🔄 **Use Cases**
- Price adjustments and promotions
- Stock level updates
- Product information corrections
- Seasonal promotion management
- Inventory management
- Product lifecycle updates
		`
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Product reference code or ID', 
		type: 'number',
		example: 12345
	})
	@ApiBody({ 
		type: UpdateProductDto,
		description: 'Product update payload with fields to be updated',
		examples: {
			priceUpdate: {
				summary: '💰 Price & Promotion Update',
				description: 'Update pricing and promotion information',
				value: {
					price: 899.99,
					salePrice: 799.99,
					discount: 11.11,
					isOnPromotion: true,
					promotionStartDate: new Date('2024-01-15'),
					promotionEndDate: new Date('2024-02-15')
				}
			},
			stockUpdate: {
				summary: '📦 Stock & Inventory Update',
				description: 'Update stock quantities and reorder points',
				value: {
					stockQuantity: 150,
					reorderPoint: 25,
					warehouseLocation: 'A-15-B3'
				}
			},
			basicInfoUpdate: {
				summary: '📝 Basic Information Update',
				description: 'Update product name, description, and category',
				value: {
					name: 'iPhone 15 Pro Max - Updated',
					description: 'Latest Apple smartphone with titanium design, A17 Pro chip, and advanced camera system - Now with enhanced features',
					category: 'ELECTRONICS'
				}
			},
			specificationUpdate: {
				summary: '🔧 Specifications Update',
				description: 'Update product specifications and features',
				value: {
					specifications: 'Display: 6.7" Super Retina XDR, Chip: A17 Pro, Storage: 512GB, Camera: 48MP Main, 12MP Ultra Wide, 12MP Telephoto',
					features: 'Face ID, 5G, Wireless Charging, Water Resistant IP68, Action Button, USB-C',
					model: 'A3108-512GB',
					warrantyPeriod: 24,
					warrantyUnit: 'months'
				}
			},
			physicalPropertiesUpdate: {
				summary: '📏 Physical Properties Update',
				description: 'Update physical attributes and materials',
				value: {
					weight: 0.221,
					dimensions: '159.9mm x 76.7mm x 8.25mm',
					material: 'Titanium Grade 5',
					color: 'Space Black',
					packDimensions: '20cm x 15cm x 10cm',
					packWeight: 0.5
				}
			},
			businessUpdate: {
				summary: '🏢 Business Logic Update',
				description: 'Update business-related fields',
				value: {
					minimumOrderQuantity: 2,
					bulkDiscountPercentage: 8.0,
					bulkDiscountMinQty: 15,
					isFragile: true,
					requiresSpecialHandling: true,
					storageConditions: 'Store in cool, dry place. Temperature: 0-35°C, Humidity: <60%'
				}
			},
			ratingUpdate: {
				summary: '⭐ Rating & Review Update',
				description: 'Update product ratings and reviews',
				value: {
					rating: 4.9,
					reviewCount: 3250,
					origin: 'China - Foxconn Factory'
				}
			},
			packageUpdate: {
				summary: '📦 Package & Shipping Update',
				description: 'Update packaging and shipping information',
				value: {
					packageQuantity: 1,
					packageUnit: 'piece',
					itemsPerPack: 1,
					packPrice: 1199.99,
					packageDetails: 'Includes device, USB-C cable, documentation'
				}
			},
			promotionEnd: {
				summary: '🎯 End Promotion',
				description: 'End current promotion and revert to regular pricing',
				value: {
					isOnPromotion: false,
					promotionStartDate: null,
					promotionEndDate: null,
					salePrice: null,
					discount: null
				}
			},
			statusUpdate: {
				summary: '🔄 Status Update',
				description: 'Update product status and availability',
				value: {
					status: 'ACTIVE',
					isDeleted: false
				}
			},
			multiFieldUpdate: {
				summary: '🔄 Multi-Field Update',
				description: 'Update multiple fields simultaneously',
				value: {
					name: 'iPhone 15 Pro Max 1TB',
					price: 1399.99,
					salePrice: 1299.99,
					discount: 7.14,
					stockQuantity: 25,
					reorderPoint: 5,
					model: 'A3108-1TB',
					specifications: 'Display: 6.7" Super Retina XDR, Chip: A17 Pro, Storage: 1TB, Camera: 48MP Main, 12MP Ultra Wide, 12MP Telephoto',
					isOnPromotion: true,
					promotionStartDate: new Date('2024-01-01'),
					promotionEndDate: new Date('2024-03-31'),
					rating: 4.8,
					reviewCount: 1876
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Product updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product updated successfully' },
				product: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'iPhone 15 Pro Max - Updated' },
						description: { type: 'string', example: 'Latest Apple smartphone with titanium design, A17 Pro chip, and advanced camera system - Now with enhanced features' },
						category: { type: 'string', example: 'ELECTRONICS' },
						price: { type: 'number', example: 899.99 },
						salePrice: { type: 'number', example: 799.99 },
						discount: { type: 'number', example: 11.11 },
						sku: { type: 'string', example: 'IPH15PM-256GB-NT' },
						barcode: { type: 'string', example: '194253000001' },
						stockQuantity: { type: 'number', example: 150 },
						reorderPoint: { type: 'number', example: 25 },
						brand: { type: 'string', example: 'Apple' },
						manufacturer: { type: 'string', example: 'Apple Inc.' },
						model: { type: 'string', example: 'A3108' },
						color: { type: 'string', example: 'Space Black' },
						material: { type: 'string', example: 'Titanium Grade 5' },
						weight: { type: 'number', example: 0.221 },
						dimensions: { type: 'string', example: '159.9mm x 76.7mm x 8.25mm' },
						isOnPromotion: { type: 'boolean', example: true },
						promotionStartDate: { type: 'string', format: 'date-time', example: '2024-01-15T00:00:00Z' },
						promotionEndDate: { type: 'string', format: 'date-time', example: '2024-02-15T23:59:59Z' },
						warrantyPeriod: { type: 'number', example: 24 },
						warrantyUnit: { type: 'string', example: 'months' },
						rating: { type: 'number', example: 4.9 },
						reviewCount: { type: 'number', example: 3250 },
						isFragile: { type: 'boolean', example: true },
						requiresSpecialHandling: { type: 'boolean', example: true },
						storageConditions: { type: 'string', example: 'Store in cool, dry place. Temperature: 0-35°C, Humidity: <60%' },
						minimumOrderQuantity: { type: 'number', example: 2 },
						bulkDiscountPercentage: { type: 'number', example: 8.0 },
						bulkDiscountMinQty: { type: 'number', example: 15 },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
						updatedBy: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456 },
								name: { type: 'string', example: 'John Doe' },
								email: { type: 'string', example: 'john@example.com' }
							}
						}
					}
				},
				changes: {
					type: 'object',
					properties: {
						fieldsUpdated: { 
							type: 'array',
							items: { type: 'string' },
							example: ['price', 'salePrice', 'discount', 'isOnPromotion', 'promotionStartDate', 'promotionEndDate']
						},
						previousValues: {
							type: 'object',
							properties: {
								price: { type: 'number', example: 999.99 },
								salePrice: { type: 'number', example: 899.99 },
								discount: { type: 'number', example: 10.0 },
								isOnPromotion: { type: 'boolean', example: false }
							}
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with reference 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for product update' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Price must be a positive number',
						'Stock quantity cannot be negative',
						'Discount percentage must be between 0 and 100',
						'Promotion end date must be after start date'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to update products in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Business rule violation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot update product: SKU already exists in organization' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflictingField: { type: 'string', example: 'sku' },
				conflictingValue: { type: 'string', example: 'IPH15PM-256GB-NT' }
			}
		}
	})
	@ApiUnprocessableEntityResponse({
		description: '🔄 Unprocessable Entity - Business logic validation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot update product: Invalid promotion date range' },
				error: { type: 'string', example: 'Unprocessable Entity' },
				statusCode: { type: 'number', example: 422 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Promotion end date must be after start date',
						'Cannot set promotion without discount percentage',
						'Sale price cannot be higher than regular price'
					]
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Unexpected system error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while updating the product' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	updateProduct(@Param('ref') ref: number, @Body() updateProductDto: UpdateProductDto) {
		return this.productsService.updateProduct(ref, updateProductDto);
	}

	@Patch('restore/:ref')
	@ApiOperation({
		summary: '🔄 Restore a deleted product',
		description: `
# Restore Deleted Product

Restores a previously soft-deleted product back to active status with full functionality restoration.

## 🔄 **Restoration Process**
- **Status Reactivation**: Changes product status from deleted to active
- **Inventory Restoration**: Restores stock levels to pre-deletion state
- **Search Visibility**: Product becomes visible in search results again
- **Analytics Recovery**: Resumes analytics tracking and performance monitoring
- **Promotion Reactivation**: Restores any active promotions that were suspended

## 📋 **Business Rules**
- Only soft-deleted products can be restored
- Inventory levels are restored to the last known state
- Historical analytics data is preserved and continues
- Product relationships with orders and categories are maintained
- All product variants and associations are restored

## 🔧 **Use Cases**
- **Accidental Deletion Recovery**: Restore products deleted by mistake
- **Seasonal Products**: Reactivate products for seasonal availability
- **Inventory Management**: Restore products when stock becomes available
- **Catalog Management**: Reactivate products after discontinuation review
- **Data Recovery**: Restore products after system maintenance

## 🎯 **Post-Restoration Actions**
- Product becomes available for new orders
- Search indexing is updated
- Analytics tracking resumes
- Inventory levels are validated
- Notification to relevant stakeholders
- Audit log entry for restoration

## ⚠️ **Important Notes**
- Restoration preserves all original product data
- Stock levels return to pre-deletion state
- All historical data remains intact
- Product relationships are fully restored
		`
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Product reference code or unique identifier', 
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Product restored successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product restored successfully' },
				restoredProduct: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'iPhone 15 Pro Max' },
						sku: { type: 'string', example: 'IPH15PM-256GB-NT' },
						category: { type: 'string', example: 'ELECTRONICS' },
						price: { type: 'number', example: 1199.99 },
						stockQuantity: { type: 'number', example: 50 },
						isDeleted: { type: 'boolean', example: false },
						isActive: { type: 'boolean', example: true },
						restoredAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
						restoredBy: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456 },
								name: { type: 'string', example: 'John Doe' },
								email: { type: 'string', example: 'john@example.com' }
							}
						}
					}
				},
				restoration: {
					type: 'object',
					properties: {
						inventoryRestored: { type: 'number', example: 50, description: 'Stock quantity restored' },
						promotionsReactivated: { type: 'number', example: 2, description: 'Number of promotions reactivated' },
						searchIndexUpdated: { type: 'boolean', example: true, description: 'Whether search index was updated' },
						analyticsResumed: { type: 'boolean', example: true, description: 'Whether analytics tracking resumed' }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found or not deleted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with reference 12345 not found or not deleted' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid reference code or product cannot be restored',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product cannot be restored or invalid reference code' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Product is not deleted',
						'Reference code must be a positive number',
						'Product restoration period has expired'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to restore products in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Restoration failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while restoring the product' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	restoreProduct(@Param('ref') ref: number) {
		return this.productsService.restoreProduct(ref);
	}

	@Delete(':ref')
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
		summary: '🗑️ Soft delete a product',
		description: `
# Delete Product (Soft Delete)

Marks a product as deleted without removing it from the database. This is a soft delete operation that maintains data integrity and allows for potential recovery.

## ⚠️ **Important Notes**
- **Soft Delete**: Product is marked as deleted but remains in the database
- **Reversible**: Deleted products can be restored using the restore endpoint
- **Data Integrity**: Maintains relationships with orders, analytics, and other entities
- **Audit Trail**: Preserves deletion history and timestamps

## 🔒 **Business Rules**
- Only admin/manager level users can delete products
- Products with active orders cannot be deleted
- Inventory adjustments are automatically handled
- Analytics data is preserved for historical reporting

## 🔄 **Impact Areas**
- **Inventory**: Stock is removed from available inventory
- **Sales**: No longer available for new orders
- **Analytics**: Historical data remains intact
- **Reporting**: Excluded from active product reports
- **Search**: Removed from public search results

## 📋 **Post-Deletion Actions**
- Automatic inventory adjustment
- Notification to relevant stakeholders
- Audit log entry creation
- Analytics data preservation
- Related promotion deactivation
		`
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Product reference code or ID', 
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Product deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product deleted successfully' },
				deletedProduct: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 12345 },
						name: { type: 'string', example: 'iPhone 15 Pro Max' },
						sku: { type: 'string', example: 'IPH15PM-256GB-NT' },
						category: { type: 'string', example: 'ELECTRONICS' },
						price: { type: 'number', example: 1199.99 },
						stockQuantity: { type: 'number', example: 50 },
						isDeleted: { type: 'boolean', example: true },
						deletedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
						deletedBy: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456 },
								name: { type: 'string', example: 'John Doe' },
								email: { type: 'string', example: 'john@example.com' }
							}
						}
					}
				},
				impact: {
					type: 'object',
					properties: {
						inventoryAdjustment: { type: 'number', example: -50, description: 'Stock quantity removed from inventory' },
						activePromotionsDeactivated: { type: 'number', example: 2, description: 'Number of promotions deactivated' },
						relatedOrdersAffected: { type: 'number', example: 0, description: 'Number of pending orders affected' },
						analyticsPreserved: { type: 'boolean', example: true, description: 'Whether analytics data is preserved' }
					}
				},
				recovery: {
					type: 'object',
					properties: {
						canRestore: { type: 'boolean', example: true, description: 'Whether the product can be restored' },
						restoreEndpoint: { type: 'string', example: 'PATCH /products/restore/12345', description: 'Endpoint to restore the product' },
						retentionPeriod: { type: 'string', example: '90 days', description: 'How long deleted data is retained' }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with reference 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to delete products in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Cannot delete product with active dependencies',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot delete product: Product has active orders or dependencies' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'object',
					properties: {
						activeOrders: { type: 'number', example: 5, description: 'Number of active orders' },
						pendingShipments: { type: 'number', example: 2, description: 'Number of pending shipments' },
						activePromotions: { type: 'number', example: 1, description: 'Number of active promotions' },
						reservedInventory: { type: 'number', example: 15, description: 'Units reserved for orders' }
					}
				},
				resolution: {
					type: 'object',
					properties: {
						suggestedActions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Complete or cancel active orders',
								'Process pending shipments',
								'End active promotions',
								'Release reserved inventory'
							]
						},
						alternativeEndpoint: { type: 'string', example: 'PATCH /products/12345/deactivate', description: 'Alternative to deactivate instead of delete' }
					}
				}
			}
		}
	})
	@ApiUnprocessableEntityResponse({
		description: '🔄 Unprocessable Entity - Business rule violation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot delete product: Product is part of a bundle or has special restrictions' },
				error: { type: 'string', example: 'Unprocessable Entity' },
				statusCode: { type: 'number', example: 422 },
				restrictions: {
					type: 'object',
					properties: {
						isPartOfBundle: { type: 'boolean', example: true, description: 'Product is part of a bundle' },
						hasSpecialContract: { type: 'boolean', example: false, description: 'Product has special contract terms' },
						isSubscriptionProduct: { type: 'boolean', example: false, description: 'Product is a subscription' },
						requiresApproval: { type: 'boolean', example: true, description: 'Deletion requires additional approval' }
					}
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Unexpected system error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while deleting the product' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	deleteProduct(@Param('ref') ref: number) {
		return this.productsService.deleteProduct(ref);
	}

	@Get('analytics/:id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '📊 Get product analytics',
		description: `
# Get Product Analytics

Retrieves comprehensive analytics data for a specific product, including performance metrics, user engagement data, and business insights.

## 📈 **Analytics Categories**
- **Engagement Metrics**: Views, clicks, time spent, bounce rate
- **Conversion Metrics**: Cart adds, wishlist adds, purchases, conversion rates
- **Performance Metrics**: Sales velocity, inventory turnover, profit margins
- **User Behavior**: Customer segments, repeat purchases, abandonment rates
- **Financial Metrics**: Revenue, costs, ROI, profit analysis

## 🎯 **Key Performance Indicators**
- **Conversion Rate**: Percentage of views that result in purchases
- **Average Order Value**: Mean purchase amount for this product
- **Customer Lifetime Value**: Long-term value of customers who bought this product
- **Return Rate**: Percentage of products returned
- **Review Score**: Average customer satisfaction rating

## 📊 **Time-Series Data**
- Daily, weekly, monthly trends
- Seasonal patterns and variations
- Comparison with previous periods
- Growth rate calculations
- Forecasting projections

## 🎪 **Business Intelligence**
- Top customer segments
- Geographic performance
- Channel effectiveness
- Competitive positioning
- Market share analysis
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Product ID', 
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Product analytics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product analytics retrieved successfully' },
				analytics: {
					type: 'object',
					properties: {
						productInfo: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								name: { type: 'string', example: 'iPhone 15 Pro Max' },
								sku: { type: 'string', example: 'IPH15PM-256GB-NT' },
								category: { type: 'string', example: 'ELECTRONICS' },
								brand: { type: 'string', example: 'Apple' },
								currentPrice: { type: 'number', example: 1199.99 },
								lastUpdated: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' }
							}
						},
						engagementMetrics: {
							type: 'object',
							properties: {
								totalViews: { type: 'number', example: 15847, description: 'Total number of product views' },
								uniqueViews: { type: 'number', example: 12654, description: 'Number of unique users who viewed the product' },
								averageTimeOnPage: { type: 'number', example: 156.5, description: 'Average time spent viewing product (seconds)' },
								bounceRate: { type: 'number', example: 23.4, description: 'Percentage of users who left without interaction' },
								clickThroughRate: { type: 'number', example: 8.7, description: 'Percentage of impressions that resulted in clicks' },
								shareCount: { type: 'number', example: 234, description: 'Number of times product was shared' },
								reviewsCount: { type: 'number', example: 1876, description: 'Total number of reviews' },
								averageRating: { type: 'number', example: 4.8, description: 'Average customer rating (1-5)' }
							}
						},
						conversionMetrics: {
							type: 'object',
							properties: {
								cartAdds: { type: 'number', example: 1847, description: 'Number of times added to cart' },
								wishlistAdds: { type: 'number', example: 987, description: 'Number of times added to wishlist' },
								purchases: { type: 'number', example: 432, description: 'Total number of purchases' },
								conversionRate: { type: 'number', example: 2.73, description: 'Conversion rate (purchases/views)' },
								cartConversionRate: { type: 'number', example: 23.4, description: 'Cart to purchase conversion rate' },
								wishlistConversionRate: { type: 'number', example: 15.2, description: 'Wishlist to purchase conversion rate' },
								abandonmentRate: { type: 'number', example: 76.6, description: 'Cart abandonment rate' },
								repeatPurchaseRate: { type: 'number', example: 18.5, description: 'Percentage of repeat customers' }
							}
						},
						financialMetrics: {
							type: 'object',
							properties: {
								totalRevenue: { type: 'number', example: 518357.68, description: 'Total revenue generated' },
								averageOrderValue: { type: 'number', example: 1199.99, description: 'Average order value' },
								totalCost: { type: 'number', example: 311014.61, description: 'Total cost of goods sold' },
								grossProfit: { type: 'number', example: 207343.07, description: 'Gross profit (revenue - cost)' },
								profitMargin: { type: 'number', example: 39.98, description: 'Profit margin percentage' },
								roi: { type: 'number', example: 66.67, description: 'Return on investment percentage' },
								inventoryTurnover: { type: 'number', example: 12.5, description: 'Inventory turnover rate' },
								salesVelocity: { type: 'number', example: 14.4, description: 'Average units sold per day' }
							}
						},
						customerMetrics: {
							type: 'object',
							properties: {
								totalCustomers: { type: 'number', example: 398, description: 'Total unique customers' },
								newCustomers: { type: 'number', example: 324, description: 'New customers acquired' },
								returningCustomers: { type: 'number', example: 74, description: 'Returning customers' },
								customerLifetimeValue: { type: 'number', example: 1456.78, description: 'Average customer lifetime value' },
								customerAcquisitionCost: { type: 'number', example: 45.67, description: 'Cost to acquire a customer' },
								customerRetentionRate: { type: 'number', example: 18.6, description: 'Customer retention rate' },
								referralRate: { type: 'number', example: 12.3, description: 'Percentage of customers who referred others' }
							}
						},
						performanceMetrics: {
							type: 'object',
							properties: {
								salesRank: { type: 'number', example: 5, description: 'Sales rank in category' },
								marketShare: { type: 'number', example: 23.5, description: 'Market share percentage in category' },
								competitorComparison: { type: 'number', example: 15.4, description: 'Performance vs competitors' },
								seasonalIndex: { type: 'number', example: 1.23, description: 'Seasonal performance index' },
								trendScore: { type: 'number', example: 8.7, description: 'Trend popularity score (1-10)' },
								growthRate: { type: 'number', example: 12.8, description: 'Month-over-month growth rate' },
								stockoutRate: { type: 'number', example: 2.1, description: 'Percentage of time out of stock' }
							}
						},
						timeSeriesData: {
							type: 'object',
							properties: {
								dailyViews: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											date: { type: 'string', format: 'date', example: '2024-01-15' },
											views: { type: 'number', example: 156 },
											sales: { type: 'number', example: 8 }
										}
									}
								},
								weeklyTrends: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											week: { type: 'string', example: '2024-W03' },
											views: { type: 'number', example: 1087 },
											sales: { type: 'number', example: 54 },
											revenue: { type: 'number', example: 64799.46 }
										}
									}
								},
								monthlyPerformance: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											month: { type: 'string', example: '2024-01' },
											views: { type: 'number', example: 4567 },
											sales: { type: 'number', example: 234 },
											revenue: { type: 'number', example: 280797.66 }
										}
									}
								}
							}
						},
						insights: {
							type: 'object',
							properties: {
								topPerformingChannels: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											channel: { type: 'string', example: 'web' },
											views: { type: 'number', example: 8456 },
											conversions: { type: 'number', example: 234 },
											revenue: { type: 'number', example: 280797.66 }
										}
									}
								},
								topCustomerSegments: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											segment: { type: 'string', example: 'Premium Tech Enthusiasts' },
											customers: { type: 'number', example: 156 },
											averageOrderValue: { type: 'number', example: 1299.99 },
											loyaltyScore: { type: 'number', example: 8.7 }
										}
									}
								},
								recommendations: {
									type: 'array',
									items: { type: 'string' },
									example: [
										'Increase inventory by 25% for next quarter based on growth trend',
										'Consider bundle offers with accessories to increase AOV',
										'Implement retargeting campaign for cart abandoners',
										'Optimize product images to reduce bounce rate'
									]
								}
							}
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view product analytics' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Analytics calculation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while retrieving product analytics' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async getProductAnalytics(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		// Note: The analytics service methods don't need to filter by org/branch
		// since we'll be fetching a product that's already filtered
		const product = await this.productsService.getProductByref(id);
		if (!product.product) {
			return { message: 'Product not found', analytics: null };
		}
		return this.productsService.getProductAnalytics(id);
	}

	@Patch('analytics/:id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '📊 Update product analytics data',
		description: `
# Update Product Analytics

Updates comprehensive analytics data for a specific product with real-time performance metrics and business intelligence tracking.

## 📈 **Analytics Categories**
- **Performance Metrics**: Sales velocity, conversion rates, revenue tracking
- **User Engagement**: View counts, interaction rates, session duration
- **Inventory Insights**: Stock turnover, reorder predictions, demand forecasting
- **Customer Behavior**: Purchase patterns, review sentiments, return rates
- **Marketing Analytics**: Campaign effectiveness, promotional impact, ROI metrics

## 🎯 **Update Capabilities**
- **Real-time Tracking**: Instant updates to performance indicators
- **Bulk Data Import**: Import analytics from external sources and systems
- **Historical Corrections**: Adjust past data for accuracy and compliance
- **Forecast Adjustments**: Update predictive models and forecasting algorithms
- **Custom Metrics**: Add product-specific KPIs and business metrics

## 🔧 **Advanced Features**
- **Data Validation**: Ensures analytics integrity and consistency
- **Audit Trail**: Maintains complete history of analytics modifications
- **Performance Optimization**: Intelligent caching and data aggregation
- **Integration Support**: Seamless sync with external analytics platforms
- **Automated Alerts**: Trigger notifications based on performance thresholds

## 📋 **Business Intelligence**
- **Trend Analysis**: Identify patterns and market opportunities
- **Competitive Insights**: Track performance against market benchmarks
- **Customer Segmentation**: Analyze behavior across different user groups
- **Revenue Optimization**: Data-driven pricing and promotion strategies
- **Risk Assessment**: Early warning systems for inventory and performance issues

## 🎪 **Use Cases**
- **Performance Monitoring**: Track KPIs and business metrics in real-time
- **Data Correction**: Fix inaccurate historical analytics data
- **Forecast Updates**: Adjust predictions based on new market data
- **Campaign Analysis**: Measure and optimize marketing effectiveness
- **Inventory Planning**: Data-driven stock management and procurement
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Product unique identifier for analytics update', 
		type: 'number',
		example: 12345
	})
	@ApiBody({ 
		type: ProductAnalyticsDto,
		description: 'Analytics data payload with metrics to update',
		examples: {
			performanceUpdate: {
				summary: '📈 Performance Metrics Update',
				description: 'Update key performance indicators and sales metrics',
				value: {
					totalViews: 15847,
					uniqueViews: 12654,
					cartAdds: 1847,
					purchases: 432,
					conversionRate: 2.73,
					averageOrderValue: 1199.99,
					totalRevenue: 518357.68,
					returnRate: 2.1,
					customerSatisfaction: 4.8,
					reviewCount: 2450
				}
			},
			engagementUpdate: {
				summary: '👥 User Engagement Update',
				description: 'Update user interaction and engagement metrics',
				value: {
					averageTimeOnPage: 156.5,
					bounceRate: 23.4,
					shareCount: 234,
					wishlistAdds: 987,
					reviewsCount: 1876,
					clickThroughRate: 8.7,
					socialEngagement: 145,
					emailOpens: 2341
				}
			},
			inventoryUpdate: {
				summary: '📦 Inventory Analytics Update',
				description: 'Update inventory performance and turnover metrics',
				value: {
					inventoryTurnover: 12.5,
					stockoutRate: 2.1,
					salesVelocity: 14.4,
					demandForecast: 567,
					seasonalIndex: 1.23,
					reorderPoint: 25,
					leadTime: 7,
					warehouseEfficiency: 94.2
				}
			},
			marketingUpdate: {
				summary: '📢 Marketing Analytics Update',
				description: 'Update marketing campaign and promotional effectiveness',
				value: {
					campaignReach: 45000,
					impressions: 125000,
					adSpend: 5000.00,
					costPerAcquisition: 45.67,
					marketingROI: 450.5,
					organicTraffic: 8500,
					referralTraffic: 1200,
					socialMediaReach: 15000
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Product analytics updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product analytics updated successfully' },
				analytics: {
					type: 'object',
					properties: {
						productId: { type: 'number', example: 12345 },
						updatedMetrics: {
							type: 'array',
							items: { type: 'string' },
							example: ['totalViews', 'conversionRate', 'totalRevenue', 'customerSatisfaction']
						},
						previousValues: {
							type: 'object',
							properties: {
								totalViews: { type: 'number', example: 14500 },
								conversionRate: { type: 'number', example: 2.45 },
								totalRevenue: { type: 'number', example: 487642.33 }
							}
						},
						newValues: {
							type: 'object',
							properties: {
								totalViews: { type: 'number', example: 15847 },
								conversionRate: { type: 'number', example: 2.73 },
								totalRevenue: { type: 'number', example: 518357.68 }
							}
						},
						updateTimestamp: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
						updatedBy: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 456 },
								name: { type: 'string', example: 'Analytics Admin' },
								email: { type: 'string', example: 'admin@example.com' }
							}
						}
					}
				},
				insights: {
					type: 'object',
					properties: {
						performanceImprovement: { type: 'number', example: 11.4, description: 'Percentage improvement in overall performance' },
						trendDirection: { type: 'string', example: 'upward', description: 'Overall trend direction' },
						alertsTriggered: {
							type: 'array',
							items: { type: 'string' },
							example: ['high-conversion-rate', 'revenue-milestone'],
							description: 'Performance alerts triggered by the update'
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid analytics data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid analytics data provided' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Conversion rate must be between 0 and 100',
						'Total views cannot be negative',
						'Revenue must be a positive number',
						'Review count cannot exceed total views'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to update product analytics' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Analytics update failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while updating analytics' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async updateProductAnalytics(
		@Param('id') id: number,
		@Body() analyticsDto: ProductAnalyticsDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		// First verify the product exists and belongs to the org/branch
		const product = await this.productsService.getProductByref(id);
		if (!product.product) {
			return { message: 'Product not found', analytics: null };
		}
		return this.productsService.updateProductAnalytics(id, analyticsDto);
	}

	@Post('view/:id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '👁️ Record product view tracking',
		description: `
# Record Product View

Tracks and records a product view event for analytics and engagement measurement purposes.

## 📊 **View Tracking Features**
- **Real-time Analytics**: Instant view count updates for live analytics
- **User Behavior Tracking**: Anonymous view tracking for engagement analysis
- **Performance Metrics**: Contributes to conversion rate and engagement calculations
- **Geographic Insights**: Optional location-based view tracking
- **Device Analytics**: Track views across different platforms and devices

## 🎯 **Analytics Integration**
- **Engagement Metrics**: Feeds into overall product engagement scoring
- **Conversion Funnel**: Essential data point for view-to-purchase analysis
- **Popularity Ranking**: Influences product ranking and recommendation algorithms
- **Market Research**: Provides insights into product demand and interest
- **Performance Optimization**: Helps identify high-performing products

## 🔧 **Technical Implementation**
- **Efficient Processing**: Optimized for high-volume view tracking
- **Data Aggregation**: Smart batching for performance optimization
- **Duplicate Prevention**: Built-in safeguards against view inflation
- **Privacy Compliant**: GDPR and privacy regulation compliant tracking
- **Real-time Updates**: Immediate analytics dashboard updates

## 📈 **Business Value**
- **Market Intelligence**: Understand customer interest and demand patterns
- **Inventory Planning**: View data informs stock level decisions
- **Marketing Strategy**: Identify products for promotional campaigns
- **User Experience**: Optimize product discovery and recommendation
- **Revenue Optimization**: Data-driven decisions for pricing and promotions
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Product unique identifier for view tracking', 
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Product view recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product view recorded successfully' },
				analytics: {
					type: 'object',
					properties: {
						productId: { type: 'number', example: 12345 },
						totalViews: { type: 'number', example: 15848, description: 'Updated total view count' },
						uniqueViews: { type: 'number', example: 12655, description: 'Unique viewers count' },
						viewsToday: { type: 'number', example: 156, description: 'Views recorded today' },
						averageViewsPerDay: { type: 'number', example: 47.2, description: 'Average daily views' },
						popularityRank: { type: 'number', example: 5, description: 'Product popularity ranking' },
						conversionRate: { type: 'number', example: 2.73, description: 'Current view-to-purchase rate' },
						lastViewedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' }
					}
				},
				tracking: {
					type: 'object',
					properties: {
						sessionId: { type: 'string', example: 'sess_abc123def456', description: 'Session tracking identifier' },
						timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
						source: { type: 'string', example: 'search', description: 'View source (search, category, recommendation)' },
						deviceType: { type: 'string', example: 'desktop', description: 'Device type used for viewing' }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to record product views' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - View tracking failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while recording the product view' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async recordProductView(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		// First verify the product exists and belongs to the org/branch
		const product = await this.productsService.getProductByref(id);
		if (!product.product) {
			return { message: 'Product not found' };
		}
		return this.productsService.recordView(id);
	}

	@Post('cart/:id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '🛒 Record cart add tracking',
		description: `
# Record Cart Add Event

Tracks when a product is added to cart for comprehensive e-commerce analytics and conversion optimization.

## 📊 **Cart Analytics Features**
- **Conversion Tracking**: Essential data for cart-to-purchase conversion rates
- **Abandonment Analysis**: Identifies products with high cart abandonment rates
- **Purchase Intent**: Measures customer buying intent and product appeal
- **Inventory Signals**: Indicates demand for inventory planning
- **User Behavior**: Tracks customer journey from view to cart addition

## 🎯 **E-commerce Insights**
- **Sales Funnel Analysis**: Critical conversion point in the purchase journey
- **Product Performance**: Measures product attractiveness and desirability
- **Pricing Strategy**: Correlates cart additions with price points
- **Marketing ROI**: Tracks effectiveness of promotional campaigns
- **Customer Engagement**: Indicates serious buying interest

## 🔧 **Technical Implementation**
- **Real-time Tracking**: Instant cart addition analytics updates
- **Session Correlation**: Links cart events to user sessions
- **Duplicate Prevention**: Prevents inflated cart addition counts
- **Performance Optimized**: Efficient processing for high-traffic scenarios
- **Privacy Compliant**: Anonymized tracking respecting user privacy

## 📈 **Business Intelligence**
- **Demand Forecasting**: Cart additions predict future sales trends
- **Inventory Optimization**: Data-driven stock level management
- **Marketing Targeting**: Identify high-intent customer segments
- **Product Development**: Insights for product improvement and new launches
- **Revenue Optimization**: Optimize pricing and promotional strategies

## 🎪 **Use Cases**
- **E-commerce Analytics**: Track conversion funnel performance
- **Inventory Planning**: Predict demand based on cart activity
- **Marketing Campaigns**: Measure campaign effectiveness on buying intent
- **Product Optimization**: Identify popular vs struggling products
- **Customer Journey Analysis**: Understand path to purchase behavior
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Product unique identifier for cart tracking', 
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Cart add recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cart add recorded successfully' },
				analytics: {
					type: 'object',
					properties: {
						productId: { type: 'number', example: 12345 },
						totalCartAdds: { type: 'number', example: 1848, description: 'Updated total cart additions' },
						cartAddsToday: { type: 'number', example: 23, description: 'Cart additions recorded today' },
						averageCartAddsPerDay: { type: 'number', example: 15.7, description: 'Average daily cart additions' },
						cartConversionRate: { type: 'number', example: 23.4, description: 'Cart-to-purchase conversion rate' },
						cartAbandonmentRate: { type: 'number', example: 76.6, description: 'Cart abandonment rate' },
						averageTimeToCart: { type: 'number', example: 245.8, description: 'Average seconds from view to cart' },
						lastCartAddedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' }
					}
				},
				tracking: {
					type: 'object',
					properties: {
						sessionId: { type: 'string', example: 'sess_abc123def456', description: 'Session tracking identifier' },
						timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
						source: { type: 'string', example: 'product_page', description: 'Cart addition source' },
						deviceType: { type: 'string', example: 'desktop', description: 'Device type used' },
						userAgent: { type: 'string', example: 'Mozilla/5.0...', description: 'User agent string' }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to record cart additions' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Cart tracking failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while recording the cart addition' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async recordCartAdd(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		// First verify the product exists and belongs to the org/branch
		const product = await this.productsService.getProductByref(id);
		if (!product.product) {
			return { message: 'Product not found' };
		}
		return this.productsService.recordCartAdd(id);
	}

	@Post('wishlist/:id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '💝 Record wishlist add tracking',
		description: `
# Record Wishlist Addition

Tracks when a product is added to wishlist for customer preference analysis and future marketing opportunities.

## 📊 **Wishlist Analytics Features**
- **Customer Preferences**: Understand customer interests and desires
- **Future Purchase Intent**: Track products customers want but haven't purchased
- **Marketing Opportunities**: Identify products for targeted campaigns
- **Inventory Insights**: Gauge demand for products not immediately purchased
- **Customer Engagement**: Track deeper customer interaction with products

## 🎯 **Marketing Intelligence**
- **Targeted Campaigns**: Create personalized marketing for wishlisted items
- **Price Drop Alerts**: Notify customers when wishlisted products go on sale
- **Inventory Planning**: Understand latent demand for products
- **Customer Retention**: Re-engage customers through wishlist reminders
- **Product Development**: Insights into desired but unavailable products

## 🔧 **Technical Implementation**
- **Real-time Tracking**: Instant wishlist analytics updates
- **User Correlation**: Links wishlist events to customer profiles
- **Duplicate Prevention**: Prevents multiple wishlist entries
- **Performance Optimized**: Efficient processing for customer data
- **Privacy Compliant**: Secure handling of customer preference data

## 📈 **Business Intelligence**
- **Customer Segmentation**: Group customers by preferences and interests
- **Seasonal Trends**: Identify wishlist patterns throughout the year
- **Price Sensitivity**: Analyze wishlist behavior vs actual purchases
- **Product Popularity**: Measure long-term product interest
- **Marketing ROI**: Track conversion from wishlist to purchase

## 🎪 **Use Cases**
- **Customer Retention**: Re-engage customers with personalized offers
- **Inventory Management**: Plan stock based on wishlist demand
- **Marketing Campaigns**: Target customers with relevant promotions
- **Product Analysis**: Understand customer preferences and desires
- **Sales Optimization**: Convert wishlist items to actual purchases
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Product unique identifier for wishlist tracking', 
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Wishlist add recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Wishlist add recorded successfully' },
				analytics: {
					type: 'object',
					properties: {
						productId: { type: 'number', example: 12345 },
						totalWishlistAdds: { type: 'number', example: 988, description: 'Updated total wishlist additions' },
						wishlistAddsToday: { type: 'number', example: 12, description: 'Wishlist additions recorded today' },
						averageWishlistAddsPerDay: { type: 'number', example: 8.4, description: 'Average daily wishlist additions' },
						wishlistConversionRate: { type: 'number', example: 15.7, description: 'Wishlist-to-purchase conversion rate' },
						averageTimeToWishlist: { type: 'number', example: 189.3, description: 'Average seconds from view to wishlist' },
						popularityScore: { type: 'number', example: 7.8, description: 'Product popularity based on wishlist activity' },
						lastWishlistAddedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' }
					}
				},
				tracking: {
					type: 'object',
					properties: {
						sessionId: { type: 'string', example: 'sess_abc123def456', description: 'Session tracking identifier' },
						timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
						source: { type: 'string', example: 'product_page', description: 'Wishlist addition source' },
						deviceType: { type: 'string', example: 'mobile', description: 'Device type used' },
						customerSegment: { type: 'string', example: 'premium', description: 'Customer segment classification' }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to record wishlist additions' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Wishlist tracking failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while recording the wishlist addition' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async recordWishlist(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		// First verify the product exists and belongs to the org/branch
		const product = await this.productsService.getProductByref(id);
		if (!product.product) {
			return { message: 'Product not found' };
		}
		return this.productsService.recordWishlist(id);
	}

	@Get('performance/:id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER)
	@ApiOperation({
		summary: '📈 Calculate product performance metrics',
		description: `
# Calculate Product Performance

Computes comprehensive performance metrics for a product based on analytics data, sales history, and market trends.

## 📊 **Performance Metrics**
- **Sales Performance**: Revenue, growth rate, and sales velocity tracking
- **Engagement Metrics**: View-to-purchase conversion and customer interaction rates
- **Market Position**: Competitive analysis and market share insights
- **Inventory Efficiency**: Stock turnover and inventory optimization metrics
- **Customer Satisfaction**: Reviews, ratings, and return rate analysis

## 🎯 **Performance Categories**
- **Revenue Performance**: Total revenue, growth trends, and profitability analysis
- **Conversion Metrics**: View-to-cart, cart-to-purchase, and overall conversion rates
- **Customer Engagement**: Average session time, repeat views, and interaction depth
- **Market Competitiveness**: Price positioning and competitive advantage metrics
- **Operational Efficiency**: Inventory turnover, fulfillment speed, and cost metrics

## 🔧 **Calculation Features**
- **Real-time Analysis**: Live performance calculations based on current data
- **Historical Trends**: Performance comparisons over time periods
- **Predictive Analytics**: Forecasting future performance based on trends
- **Benchmarking**: Comparison against category and industry averages
- **Custom Metrics**: Configurable KPIs for specific business needs

## 📈 **Business Intelligence**
- **Strategic Planning**: Data-driven decisions for product roadmap
- **Inventory Management**: Optimize stock levels based on performance
- **Marketing Optimization**: Identify high-performing products for promotion
- **Pricing Strategy**: Performance-based pricing recommendations
- **Resource Allocation**: Focus resources on best-performing products

## 🎪 **Use Cases**
- **Product Portfolio Management**: Optimize product mix and allocation
- **Performance Monitoring**: Track KPIs and identify improvement opportunities
- **Investment Decisions**: Data-driven product development and marketing spend
- **Market Analysis**: Understand product position in competitive landscape
- **Strategic Planning**: Long-term product and business strategy development
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Product unique identifier for performance calculation', 
		type: 'number',
		example: 12345
	})
	@ApiOkResponse({
		description: '✅ Product performance calculated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product performance calculated successfully' },
				performance: {
					type: 'object',
					properties: {
						overallScore: { type: 'number', example: 8.7, description: 'Overall performance score (0-10)' },
						productId: { type: 'number', example: 12345 },
						calculatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
						salesPerformance: {
							type: 'object',
							properties: {
								totalRevenue: { type: 'number', example: 518357.68, description: 'Total revenue generated' },
								salesGrowthRate: { type: 'number', example: 15.4, description: 'Sales growth percentage' },
								salesVelocity: { type: 'number', example: 12.8, description: 'Units sold per day' },
								profitMargin: { type: 'number', example: 34.2, description: 'Profit margin percentage' },
								score: { type: 'number', example: 9.1, description: 'Sales performance score' }
							}
						},
						conversionMetrics: {
							type: 'object',
							properties: {
								viewToCartRate: { type: 'number', example: 11.6, description: 'View-to-cart conversion rate' },
								cartToPurchaseRate: { type: 'number', example: 23.4, description: 'Cart-to-purchase conversion rate' },
								overallConversionRate: { type: 'number', example: 2.73, description: 'Overall conversion rate' },
								averageOrderValue: { type: 'number', example: 1199.99, description: 'Average order value' },
								score: { type: 'number', example: 8.2, description: 'Conversion performance score' }
							}
						},
						customerEngagement: {
							type: 'object',
							properties: {
								averageTimeOnProduct: { type: 'number', example: 156.5, description: 'Average time spent viewing product' },
								repeatViewRate: { type: 'number', example: 18.7, description: 'Percentage of repeat views' },
								shareRate: { type: 'number', example: 4.2, description: 'Social sharing rate' },
								wishlistRate: { type: 'number', example: 6.8, description: 'Wishlist addition rate' },
								score: { type: 'number', example: 7.9, description: 'Engagement performance score' }
							}
						},
						marketPosition: {
							type: 'object',
							properties: {
								categoryRank: { type: 'number', example: 3, description: 'Rank within product category' },
								marketSharePercentage: { type: 'number', example: 12.4, description: 'Market share percentage' },
								competitiveAdvantage: { type: 'number', example: 8.1, description: 'Competitive advantage score' },
								priceCompetitiveness: { type: 'number', example: 7.6, description: 'Price competitiveness score' },
								score: { type: 'number', example: 8.8, description: 'Market position score' }
							}
						},
						inventoryEfficiency: {
							type: 'object',
							properties: {
								turnoverRate: { type: 'number', example: 12.5, description: 'Inventory turnover rate' },
								stockoutRate: { type: 'number', example: 2.1, description: 'Stockout occurrence rate' },
								fulfillmentSpeed: { type: 'number', example: 1.8, description: 'Average fulfillment time in days' },
								warehouseEfficiency: { type: 'number', example: 94.2, description: 'Warehouse efficiency percentage' },
								score: { type: 'number', example: 9.3, description: 'Inventory efficiency score' }
							}
						},
						customerSatisfaction: {
							type: 'object',
							properties: {
								averageRating: { type: 'number', example: 4.8, description: 'Average customer rating' },
								reviewCount: { type: 'number', example: 2450, description: 'Total number of reviews' },
								returnRate: { type: 'number', example: 2.1, description: 'Product return rate' },
								recommendationRate: { type: 'number', example: 87.3, description: 'Customer recommendation rate' },
								score: { type: 'number', example: 9.0, description: 'Customer satisfaction score' }
							}
						}
					}
				},
				insights: {
					type: 'object',
					properties: {
						strengths: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Excellent customer satisfaction ratings',
								'High inventory turnover efficiency',
								'Strong sales growth trajectory',
								'Competitive pricing advantage'
							]
						},
						improvementAreas: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Cart abandonment rate could be reduced',
								'Social sharing engagement needs improvement',
								'Time on product page below category average'
							]
						},
						recommendations: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Implement cart abandonment email campaigns',
								'Add social sharing incentives',
								'Optimize product page content for engagement',
								'Consider bundle offers to increase AOV'
							]
						},
						performanceTrend: { type: 'string', example: 'improving', description: 'Overall performance trend' }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to calculate product performance' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Performance calculation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while calculating product performance' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	async calculateProductPerformance(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = getClerkOrgId(req);
		if (!orgId) {
			throw new BadRequestException('Organization context required');
		}
		const branchId = req.user?.branch?.uid;
		// First verify the product exists and belongs to the org/branch
		const product = await this.productsService.getProductByref(id);
		if (!product.product) {
			return { message: 'Product not found' };
		}
		return this.productsService.calculateProductPerformance(id);
	}
}
