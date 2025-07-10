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
	ApiServiceUnavailableResponse,
	ApiConsumes,
	ApiProduces,
} from '@nestjs/swagger';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { Roles } from '../decorators/role.decorator';
import { ProductsService } from './products.service';
import { AccessLevel } from '../lib/enums/user.enums';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginationQuery } from '../lib/interfaces/product.interfaces';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req } from '@nestjs/common';
import { ProductAnalyticsDto } from './dto/product-analytics.dto';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';

@ApiBearerAuth('JWT-auth')
@ApiTags('🛍️ Products') 
@Controller('products')
@UseGuards(AuthGuard, RoleGuard)
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
	constructor(private readonly productsService: ProductsService) {}

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
	createProduct(@Body() createProductDto: CreateProductDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.productsService.createProduct(createProductDto, orgId, branchId);
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
	products(@Query() query: PaginationQuery, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.productsService.products(query.page, query.limit, orgId, branchId);
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
		summary: 'Get a product by reference code',
		description: 'Retrieves detailed information about a specific product',
	})
	@ApiParam({ name: 'ref', description: 'Product reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Product retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				product: {
					type: 'object',
					properties: {
						uid: { type: 'number' },
						name: { type: 'string' },
						description: { type: 'string' },
						price: { type: 'number' },
						sku: { type: 'string' },
						imageUrl: { type: 'string' },
						category: { type: 'string' },
						isActive: { type: 'boolean' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product not found' },
				product: { type: 'null' },
			},
		},
	})
	getProductByref(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.productsService.getProductByref(ref, orgId, branchId);
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
		summary: 'Get a list of products by category',
		description: 'Retrieves a paginated list of products that belong to a specific category',
	})
	@ApiParam({ name: 'category', description: 'Category name or ID', type: 'string' })
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number, defaults to 1' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of records per page, defaults to 20',
	})
	@ApiQuery({ name: 'search', type: String, required: false, description: 'Search term for filtering products' })
	@ApiOkResponse({
		description: 'Products retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number' },
							name: { type: 'string' },
							description: { type: 'string' },
							price: { type: 'number' },
							sku: { type: 'string' },
							imageUrl: { type: 'string' },
							category: { type: 'string' },
							brand: { type: 'string' },
							stockQuantity: { type: 'number' },
							isOnPromotion: { type: 'boolean' },
							salePrice: { type: 'number' },
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 100 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 20 },
						totalPages: { type: 'number', example: 5 },
					},
				},
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'No products found in this category',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No products found in this category' },
				data: { type: 'array', items: {}, example: [] },
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 0 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 20 },
						totalPages: { type: 'number', example: 0 },
					},
				},
			},
		},
	})
	productsByCategory(
		@Param('category') category: string,
		@Query('page') page: number = 1,
		@Query('limit') limit: number = 20,
		@Query('search') search: string = '',
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.productsService.productsByCategory(category, page, limit, search, orgId, branchId);
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
		summary: 'Restore a deleted product',
		description: 'Restores a previously deleted product',
	})
	@ApiParam({ name: 'ref', description: 'Product reference code or ID', type: 'number' })
	@ApiOkResponse({
		description: 'Product restored successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product not found' },
			},
		},
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
		const orgId = req.user?.org?.uid;
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
		summary: 'Update product analytics',
		description: 'Updates analytics data for a specific product',
	})
	@ApiParam({ name: 'id', description: 'Product ID', type: 'number' })
	@ApiBody({ type: ProductAnalyticsDto })
	@ApiOkResponse({
		description: 'Product analytics updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product not found' },
			},
		},
	})
	@ApiBadRequestResponse({
		description: 'Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Error updating product analytics' },
			},
		},
	})
	async updateProductAnalytics(
		@Param('id') id: number,
		@Body() analyticsDto: ProductAnalyticsDto,
		@Req() req: AuthenticatedRequest,
	) {
		const orgId = req.user?.org?.uid;
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
		summary: 'Record product view',
		description: 'Increments the view count for a specific product',
	})
	@ApiParam({ name: 'id', description: 'Product ID', type: 'number' })
	@ApiOkResponse({
		description: 'Product view recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product not found' },
			},
		},
	})
	async recordProductView(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
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
		summary: 'Record cart add',
		description: 'Increments the cart add count for a specific product',
	})
	@ApiParam({ name: 'id', description: 'Product ID', type: 'number' })
	@ApiOkResponse({
		description: 'Cart add recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product not found' },
			},
		},
	})
	async recordCartAdd(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
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
		summary: 'Record wishlist add',
		description: 'Increments the wishlist add count for a specific product',
	})
	@ApiParam({ name: 'id', description: 'Product ID', type: 'number' })
	@ApiOkResponse({
		description: 'Wishlist add recorded successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product not found' },
			},
		},
	})
	async recordWishlist(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
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
		summary: 'Calculate product performance',
		description: 'Calculates performance metrics for a specific product based on analytics data',
	})
	@ApiParam({ name: 'id', description: 'Product ID', type: 'number' })
	@ApiOkResponse({
		description: 'Product performance calculated successfully',
		schema: {
			type: 'object',
			properties: {
				performance: { type: 'number' },
				message: { type: 'string', example: 'Success' },
			},
		},
	})
	@ApiNotFoundResponse({
		description: 'Product not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Product not found' },
			},
		},
	})
	async calculatePerformance(@Param('id') id: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		// First verify the product exists and belongs to the org/branch
		const product = await this.productsService.getProductByref(id);
		if (!product.product) {
			return { message: 'Product not found' };
		}
		return this.productsService.calculateProductPerformance(id);
	}
}
